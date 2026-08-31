"use strict";

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const CONFIG = require("./shared/game-config");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.use("/shared", express.static(path.join(__dirname, "shared")));

const players = new Map();
const tiles = new Map();
const effects = [];
const repairHistory = new Map();

let tileCounter = 1;
let effectCounter = 1;
let roundEnding = false;
let lastSnapshot = 0;

const bases = Object.fromEntries(
  Object.entries(CONFIG.TEAMS).map(([teamId, team]) => [
    teamId,
    { team: teamId, x: team.spawn.x, y: team.spawn.y, hp: CONFIG.BASE_MAX_HP, maxHp: CONFIG.BASE_MAX_HP, alive: true }
  ])
);

const statistics = Object.fromEntries(
  Object.keys(CONFIG.CLASSES).map((id) => [id, { selections: 0, equations: 0, score: 0, activeUses: 0, teamUses: 0, wins: 0 }])
);

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function sanitizeName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/[<>]/g, "").slice(0, 16);
  return name.length >= 2 ? name : null;
}
function randomFrom(array) { return array[Math.floor(Math.random() * array.length)]; }

function validateCosmetics(input) {
  const source = input && typeof input === "object" ? input : {};
  const output = {};
  for (const [key, allowed] of Object.entries(CONFIG.COSMETICS)) {
    output[key] = allowed.includes(source[key]) ? source[key] : allowed[0];
  }
  output.primary = CONFIG.COSMETICS.colors.includes(source.primary) ? source.primary : "#3b82f6";
  output.secondary = CONFIG.COSMETICS.colors.includes(source.secondary) ? source.secondary : "#f8fafc";
  return output;
}

function teamPopulation(teamId) {
  let total = 0;
  for (const player of players.values()) if (player.team === teamId) total += 1;
  return total;
}

function spawnPosition(teamId) {
  const team = CONFIG.TEAMS[teamId];
  const base = team ? team.spawn : { x: CONFIG.WORLD_WIDTH / 2, y: CONFIG.WORLD_HEIGHT / 2 };
  const centerX = CONFIG.WORLD_WIDTH / 2;
  const centerY = CONFIG.WORLD_HEIGHT / 2;

  let directionX = centerX - base.x;
  let directionY = centerY - base.y;
  const directionLength = Math.hypot(directionX, directionY) || 1;
  directionX /= directionLength;
  directionY /= directionLength;

  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const minDist = CONFIG.BASE_RADIUS + CONFIG.PLAYER_RADIUS + 50;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const dist = minDist + attempt * 10;
    const side = (Math.random() - 0.5) * 150;
    const x = clamp(base.x + directionX * dist + perpendicularX * side, CONFIG.PLAYER_RADIUS, CONFIG.WORLD_WIDTH - CONFIG.PLAYER_RADIUS);
    const y = clamp(base.y + directionY * dist + perpendicularY * side, CONFIG.PLAYER_RADIUS, CONFIG.WORLD_HEIGHT - CONFIG.PLAYER_RADIUS);
    if (!isBlocked(x, y, CONFIG.PLAYER_RADIUS)) return { x, y };
  }
  return { x: base.x + directionX * (minDist + 100), y: base.y + directionY * (minDist + 100) };
}

function createTile() {
  const value = Math.random() < 0.35 ? randomFrom(["+", "-", "×", "÷", "="]) : String(Math.floor(Math.random() * 13));
  let x, y, attempts = 0;
  do {
    x = 100 + Math.random() * (CONFIG.WORLD_WIDTH - 200);
    y = 100 + Math.random() * (CONFIG.WORLD_HEIGHT - 200);
  } while (isBlocked(x, y, 22) && attempts++ < 50);
  tiles.set(`tile-${tileCounter++}`, { id: `tile-${tileCounter}`, value, x, y });
}

function refillTiles() { while (tiles.size < 180) createTile(); }

function circleRectCollision(x, y, radius, rect) {
  return Math.hypot(x - clamp(x, rect.x, rect.x + rect.w), y - clamp(y, rect.y, rect.y + rect.h)) < radius;
}

function isBlocked(x, y, radius) {
  if (x - radius < 0 || y - radius < 0 || x + radius > CONFIG.WORLD_WIDTH || y + radius > CONFIG.WORLD_HEIGHT) return true;
  for (const obs of CONFIG.OBSTACLES) if (circleRectCollision(x, y, radius, obs)) return true;
  for (const b of Object.values(bases)) if (b.alive && Math.hypot(x - b.x, y - b.y) < CONFIG.BASE_RADIUS + radius) return true;
  return false;
}

function movePlayer(player, deltaSeconds) {
  let dx = 0, dy = 0;
  if (player.input.left) dx -= 1;
  if (player.input.right) dx += 1;
  if (player.input.up) dy -= 1;
  if (player.input.down) dy += 1;
  if (dx === 0 && dy === 0) { player.moving = false; return; }

  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;
  const speed = getSpeed(player);
  const mx = dx * speed * deltaSeconds;
  const my = dy * speed * deltaSeconds;

  if (!isBlocked(player.x + mx, player.y, CONFIG.PLAYER_RADIUS)) player.x += mx;
  if (!isBlocked(player.x, player.y + my, CONFIG.PLAYER_RADIUS)) player.y += my;
  player.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  player.moving = true;
}

function getSpeed(player) {
  let bonus = 0;
  if (player.classId === "runner" && player.runnerPickupUntil > Date.now()) bonus += 0.05;
  if (player.sprintUntil > Date.now()) bonus += 0.3;
  return CONFIG.CLASSES[player.classId].speed * (1 + clamp(bonus, -0.2, CONFIG.MAX_SPEED_BONUS));
}

function pickupTiles(player) {
  if (player.sprintUntil > Date.now() || player.inventory.length >= CONFIG.CLASSES[player.classId].capacity) return;
  for (const [id, tile] of tiles) {
    if (Math.hypot(player.x - tile.x, player.y - tile.y) <= CONFIG.PICKUP_RADIUS) {
      tiles.delete(id);
      player.inventory.push({ id, value: tile.value });
      if (player.classId === "runner") player.runnerPickupUntil = Date.now() + 2000;
      io.to(player.id).emit("inventory", player.inventory);
      setTimeout(refillTiles, 1000);
      break;
    }
  }
}

// ... (ส่วนฟังก์ชันอื่นๆ เช่น evaluateSide, submitEquation, attackBase คงเดิมตามไฟล์ต้นฉบับ)

io.on("connection", (socket) => {
  socket.on("joinGame", (payload, callback) => {
    try {
      const name = sanitizeName(payload?.name);
      const team = payload?.team;
      const classId = payload?.classId;
      if (!name || !CONFIG.TEAMS[team] || !CONFIG.CLASSES[classId]) throw new Error("ข้อมูลไม่ถูกต้อง");
      const spawn = spawnPosition(team);
      const player = {
        id: socket.id, name, team, classId, cosmetics: validateCosmetics(payload?.cosmetics),
        x: spawn.x, y: spawn.y, direction: "down", moving: false, score: 0, inventory: [],
        input: { up: false, down: false, left: false, right: false }, lastInputSequence: 0,
        cooldowns: {}, lastSkillAt: Date.now(), lastAttackAt: 0, sprintUntil: 0, runnerPickupUntil: 0
      };
      players.set(socket.id, player);
      callback?.({ ok: true, playerId: socket.id });
    } catch (e) { callback?.({ ok: false, message: e.message }); }
  });

  socket.on("input", (p) => {
    const pl = players.get(socket.id);
    if (pl && p.sequence > pl.lastInputSequence) {
      pl.lastInputSequence = p.sequence;
      pl.input = { up: !!p.up, down: !!p.down, left: !!p.left, right: !!p.right };
    }
  });

  // ... (ฟังก์ชัน handle อื่นๆ ที่เหลือ)
});

setInterval(() => {
  const now = Date.now();
  const delta = Math.min((now - (global.lastTime || now)) / 1000, 0.05);
  global.lastTime = now;
  if (!roundEnding) {
    for (const p of players.values()) { movePlayer(p, delta); pickupTiles(p); }
  }
  if (now - lastSnapshot >= 66) { lastSnapshot = now; io.emit("state", { players: [...players.values()], tiles: [...tiles.values()], bases: Object.values(bases), effects }); }
}, 16);

server.listen(3000, () => console.log("Math.io running at http://localhost:3000"));
