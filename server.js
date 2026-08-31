"use strict";

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const CONFIG = require("./shared/game-config");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

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
    {
      team: teamId,
      x: team.spawn.x,
      y: team.spawn.y,
      hp: CONFIG.BASE_MAX_HP,
      maxHp: CONFIG.BASE_MAX_HP,
      alive: true
    }
  ])
);

const statistics = Object.fromEntries(
  Object.keys(CONFIG.CLASSES).map((id) => [
    id,
    {
      selections: 0,
      equations: 0,
      score: 0,
      activeUses: 0,
      teamUses: 0,
      wins: 0
    }
  ])
);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sanitizeName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/[<>]/g, "").slice(0, 16);
  return name.length >= 2 ? name : null;
}

function randomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function validateCosmetics(input) {
  const source = input && typeof input === "object" ? input : {};
  const output = {};

  for (const [key, allowed] of Object.entries(CONFIG.COSMETICS)) {
    const fallback = allowed[0];
    output[key] = allowed.includes(source[key]) ? source[key] : fallback;
  }

  output.primary = CONFIG.COSMETICS.colors.includes(source.primary)
    ? source.primary
    : "#3b82f6";

  output.secondary = CONFIG.COSMETICS.colors.includes(source.secondary)
    ? source.secondary
    : "#f8fafc";

  return output;
}

function teamPopulation(teamId) {
  let total = 0;
  for (const player of players.values()) {
    if (player.team === teamId) total += 1;
  }
  return total;
}

function spawnPosition(teamId) {
  const spawn = CONFIG.TEAMS[teamId].spawn;
  return {
    x: spawn.x + (Math.random() - 0.5) * 120,
    y: spawn.y + (Math.random() - 0.5) * 120
  };
}

function createTile() {
  const operators = ["+", "-", "×", "÷", "="];
  const useOperator = Math.random() < 0.35;
  const value = useOperator
    ? randomFrom(operators)
    : String(Math.floor(Math.random() * 13));

  let x;
  let y;
  let attempts = 0;

  do {
    x = 120 + Math.random() * (CONFIG.WORLD_WIDTH - 240);
    y = 120 + Math.random() * (CONFIG.WORLD_HEIGHT - 240);
    attempts += 1;
  } while (isBlocked(x, y, 22) && attempts < 50);

  const tile = {
    id: `tile-${tileCounter++}`,
    value,
    x,
    y
  };

  tiles.set(tile.id, tile);
}

function refillTiles() {
  while (tiles.size < 180) createTile();
}

function circleRectCollision(x, y, radius, rect) {
  const nearestX = clamp(x, rect.x, rect.x + rect.w);
  const nearestY = clamp(y, rect.y, rect.y + rect.h);
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}

function isBlocked(x, y, radius) {
  if (
    x - radius < 0 ||
    y - radius < 0 ||
    x + radius > CONFIG.WORLD_WIDTH ||
    y + radius > CONFIG.WORLD_HEIGHT
  ) {
    return true;
  }

  for (const obstacle of CONFIG.OBSTACLES) {
    if (circleRectCollision(x, y, radius, obstacle)) return true;
  }

  for (const base of Object.values(bases)) {
    if (base.alive && Math.hypot(x - base.x, y - base.y) < radius + CONFIG.BASE_RADIUS) {
      return true;
    }
  }

  return false;
}

function addEffect(type, data, duration) {
  effects.push({
    id: `effect-${effectCounter++}`,
    type,
    createdAt: Date.now(),
    expiresAt: Date.now() + duration,
    ...data
  });
}

function cleanEffects() {
  const now = Date.now();
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    if (effects[index].expiresAt <= now) effects.splice(index, 1);
  }
}

function nearbyEffect(player, type, radiusOverride) {
  const now = Date.now();

  return effects.find((effect) => {
    if (effect.type !== type || effect.expiresAt <= now) return false;
    if (effect.team !== player.team) return false;
    const radius = radiusOverride || effect.radius || 0;
    return Math.hypot(player.x - effect.x, player.y - effect.y) <= radius;
  });
}

function cooldownReady(player, key, duration) {
  const now = Date.now();
  const last = player.cooldowns[key] || 0;
  return now - last >= duration && now - player.lastSkillAt >= CONFIG.GLOBAL_SKILL_COOLDOWN;
}

function spendScore(player, amount) {
  if (player.score < amount) return false;
  player.score -= amount;
  return true;
}

function getSpeed(player) {
  const classData = CONFIG.CLASSES[player.classId];
  let bonus = 0;
  const now = Date.now();

  if (player.classId === "runner" && player.runnerPickupUntil > now) {
    bonus += 0.05;
  }

  if (player.sprintUntil > now) {
    bonus += 0.3;
  }

  if (nearbyEffect(player, "warrior-zone")) {
    bonus += 0.08;
  }

  if (nearbyEffect(player, "speed-trail")) {
    bonus += 0.12;
  }

  if (
    player.classId === "engineer" &&
    player.inventory.length >= classData.capacity - 3
  ) {
    bonus -= 0.05;
  }

  return classData.speed * (1 + clamp(bonus, -0.2, CONFIG.MAX_SPEED_BONUS));
}

function pickupTiles(player) {
  if (player.sprintUntil > Date.now()) return;

  const capacity = CONFIG.CLASSES[player.classId].capacity;
  if (player.inventory.length >= capacity) return;

  for (const tile of tiles.values()) {
    if (Math.hypot(player.x - tile.x, player.y - tile.y) <= CONFIG.PICKUP_RADIUS) {
      tiles.delete(tile.id);
      player.inventory.push({
        id: tile.id,
        value: tile.value
      });

      if (player.classId === "runner") {
        player.runnerPickupUntil = Date.now() + 2000;
      }

      io.to(player.id).emit("inventory", player.inventory);
      setTimeout(refillTiles, 1000);
      break;
    }
  }
}

function movePlayer(player, deltaSeconds) {
  let dx = 0;
  let dy = 0;

  if (player.input.left) dx -= 1;
  if (player.input.right) dx += 1;
  if (player.input.up) dy -= 1;
  if (player.input.down) dy += 1;

  if (dx === 0 && dy === 0) {
    player.moving = false;
    return;
  }

  const length = Math.hypot(dx, dy);
  dx /= length;
  dy /= length;

  const speed = getSpeed(player);
  const stepX = dx * speed * deltaSeconds;
  const stepY = dy * speed * deltaSeconds;

  const nextX = clamp(
    player.x + stepX,
    CONFIG.PLAYER_RADIUS,
    CONFIG.WORLD_WIDTH - CONFIG.PLAYER_RADIUS
  );
  const nextY = clamp(
    player.y + stepY,
    CONFIG.PLAYER_RADIUS,
    CONFIG.WORLD_HEIGHT - CONFIG.PLAYER_RADIUS
  );

  if (!isBlocked(nextX, player.y, CONFIG.PLAYER_RADIUS)) {
    player.x = nextX;
  }

  if (!isBlocked(player.x, nextY, CONFIG.PLAYER_RADIUS)) {
    player.y = nextY;
  }

  player.direction =
    Math.abs(dx) > Math.abs(dy)
      ? dx > 0
        ? "right"
        : "left"
      : dy > 0
        ? "down"
        : "up";

  player.moving = true;
}

function normalizeOperator(value) {
  if (value === "×") return "*";
  if (value === "÷") return "/";
  return value;
}

function evaluateSide(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length % 2 === 0) {
    throw new Error("รูปแบบสมการไม่ถูกต้อง");
  }

  const numbers = [];
  const operators = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (index % 2 === 0) {
      if (!/^(?:[0-9]|1[0-2])$/.test(token)) {
        throw new Error("ตำแหน่งนี้ต้องเป็นตัวเลข 0–12");
      }
      numbers.push(Number(token));
    } else {
      const operator = normalizeOperator(token);
      if (!["+", "-", "*", "/"].includes(operator)) {
        throw new Error("เครื่องหมายไม่ถูกต้อง");
      }
      operators.push(operator);
    }
  }

  const reducedNumbers = [numbers[0]];
  const reducedOperators = [];

  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const nextNumber = numbers[index + 1];

    if (operator === "*" || operator === "/") {
      const previous = reducedNumbers.pop();

      if (operator === "/" && nextNumber === 0) {
        throw new Error("ไม่สามารถหารด้วยศูนย์");
      }

      reducedNumbers.push(
        operator === "*" ? previous * nextNumber : previous / nextNumber
      );
    } else {
      reducedOperators.push(operator);
      reducedNumbers.push(nextNumber);
    }
  }

  let result = reducedNumbers[0];

  for (let index = 0; index < reducedOperators.length; index += 1) {
    result =
      reducedOperators[index] === "+"
        ? result + reducedNumbers[index + 1]
        : result - reducedNumbers[index + 1];
  }

  return result;
}

function getTeamEquationBonus(player) {
  let bonus = 0;

  for (const teammate of players.values()) {
    if (teammate.team !== player.team || teammate.id === player.id) continue;
    const range = Math.hypot(player.x - teammate.x, player.y - teammate.y);

    if (teammate.classId === "warrior" && range <= 250) {
      bonus = Math.max(bonus, 0.05);
    }
  }

  if (nearbyEffect(player, "knowledge-zone")) {
    bonus = Math.max(bonus, 0.06);
  }

  return bonus;
}

function scoreEquation(player, values) {
  const operatorCount = values.filter((value) =>
    ["+", "-", "×", "÷"].includes(value)
  ).length;

  const numberCount = values.filter((value) =>
    /^(?:[0-9]|1[0-2])$/.test(value)
  ).length;

  const operatorTypes = new Set(
    values.filter((value) => ["+", "-", "×", "÷"].includes(value))
  );

  let bonus = getTeamEquationBonus(player);

  if (
    player.classId === "mage" &&
    numberCount >= 3 &&
    values.some((value) => value === "×" || value === "÷")
  ) {
    bonus += 0.1;
  }

  if (player.classId === "mathematician") {
    if (numberCount >= 5) bonus += operatorTypes.size >= 2 ? 0.15 : 0.1;
    else if (numberCount === 4) bonus += 0.1;
    else if (numberCount === 3) bonus += 0.05;
  }

  const baseScore = values.length * 2 + operatorCount * 3;
  const finalScore = Math.floor(
    baseScore * (1 + Math.min(bonus, CONFIG.MAX_SCORE_BONUS))
  );

  return { baseScore, finalScore, bonus };
}

function submitEquation(player, ids) {
  if (!Array.isArray(ids) || ids.length < 3 || ids.length > 17) {
    throw new Error("จำนวนเบี้ยไม่ถูกต้อง");
  }

  if (new Set(ids).size !== ids.length) {
    throw new Error("มีการใช้เบี้ยซ้ำ");
  }

  const inventoryMap = new Map(player.inventory.map((tile) => [tile.id, tile]));
  const selected = ids.map((id) => inventoryMap.get(id));

  if (selected.some((tile) => !tile)) {
    throw new Error("ไม่พบเบี้ยบางชิ้นในกระเป๋า");
  }

  const values = selected.map((tile) => tile.value);
  const equalPositions = values
    .map((value, index) => (value === "=" ? index : -1))
    .filter((index) => index >= 0);

  if (equalPositions.length !== 1) {
    throw new Error("สมการต้องมีเครื่องหมาย = หนึ่งตัว");
  }

  const equalIndex = equalPositions[0];
  const left = values.slice(0, equalIndex);
  const right = values.slice(equalIndex + 1);

  const leftResult = evaluateSide(left);
  const rightResult = evaluateSide(right);

  if (Math.abs(leftResult - rightResult) > 0.000001) {
    throw new Error("สมการยังไม่เป็นจริง");
  }

  const result = scoreEquation(player, values);
  const used = new Set(ids);

  player.inventory = player.inventory.filter((tile) => !used.has(tile.id));
  player.score += result.finalScore;

  statistics[player.classId].equations += 1;
  statistics[player.classId].score += result.finalScore;

  io.to(player.id).emit("inventory", player.inventory);

  return {
    expression: values.join(" "),
    ...result
  };
}

function findEquationHint(inventory) {
  const numbers = inventory.filter((tile) => /^\d+$/.test(tile.value));
  const equals = inventory.find((tile) => tile.value === "=");
  const plus = inventory.find((tile) => tile.value === "+");
  const minus = inventory.find((tile) => tile.value === "-");

  if (!equals) return null;

  for (const a of numbers) {
    for (const b of numbers) {
      if (a.id === b.id) continue;

      for (const c of numbers) {
        if (c.id === a.id || c.id === b.id) continue;

        if (plus && Number(a.value) + Number(b.value) === Number(c.value)) {
          return [a, plus, b, equals, c];
        }

        if (minus && Number(a.value) - Number(b.value) === Number(c.value)) {
          return [a, minus, b, equals, c];
        }
      }
    }
  }

  return null;
}

function activateSkill(player, payload) {
  const classData = CONFIG.CLASSES[player.classId];

  if (!cooldownReady(player, "active", classData.activeCooldown)) {
    throw new Error("สกิลกำลังคูลดาวน์");
  }

  if (player.score < classData.activeCost) {
    throw new Error("คะแนนไม่เพียงพอ");
  }

  const now = Date.now();

  if (player.classId === "warrior") {
    if (
      Object.values(bases).some(
        (base) =>
          base.team !== player.team &&
          base.alive &&
          Math.hypot(player.x - base.x, player.y - base.y) < 260
      )
    ) {
      throw new Error("ใช้เขตป้องกันใกล้ฐานศัตรูไม่ได้");
    }

    addEffect(
      "warrior-zone",
      {
        team: player.team,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        radius: 150
      },
      5000
    );
  }

  if (player.classId === "mage") {
    const tileId = typeof payload.tileId === "string" ? payload.tileId : "";
    const tile = player.inventory.find((item) => item.id === tileId);

    if (!tile || !["+", "-", "×", "÷"].includes(tile.value)) {
      throw new Error("กรุณาเลือกเบี้ยเครื่องหมาย");
    }

    const choices = ["+", "-", "×", "÷"].filter((value) => value !== tile.value);
    tile.id = `tile-${tileCounter++}`;
    tile.value = randomFrom(choices);
    io.to(player.id).emit("inventory", player.inventory);
  }

  if (player.classId === "runner") {
    player.sprintUntil = now + 2500;
  }

  if (player.classId === "engineer") {
    const tileIds = Array.isArray(payload.tileIds) ? payload.tileIds.slice(0, 2) : [];
    if (new Set(tileIds).size !== 2) throw new Error("ต้องเลือกตัวเลข 2 ชิ้น");

    const selected = tileIds.map((id) =>
      player.inventory.find((tile) => tile.id === id)
    );

    if (
      selected.some(
        (tile) => !tile || !/^(?:[0-9]|1[0-2])$/.test(tile.value)
      )
    ) {
      throw new Error("เลือกได้เฉพาะเบี้ยตัวเลข 2 ชิ้น");
    }

    const removed = new Set(tileIds);
    player.inventory = player.inventory.filter((tile) => !removed.has(tile.id));
    player.inventory.push({
      id: `tile-${tileCounter++}`,
      value: String(Math.floor(Math.random() * 13))
    });

    io.to(player.id).emit("inventory", player.inventory);
  }

  if (player.classId === "mathematician") {
    const hint = findEquationHint(player.inventory);
    if (!hint) {
      io.to(player.id).emit("notice", "ไม่พบคำใบ้จากเบี้ยปัจจุบัน");
      return false;
    }

    io.to(player.id).emit("equationHint", hint.map((tile) => tile.id));
  }

  spendScore(player, classData.activeCost);
  player.cooldowns.active = now;
  player.lastSkillAt = now;
  statistics[player.classId].activeUses += 1;

  return true;
}

function useTeamSkill(player) {
  const classData = CONFIG.CLASSES[player.classId];

  if (!cooldownReady(player, "team", classData.teamCooldown)) {
    throw new Error("สกิลทีมกำลังคูลดาวน์");
  }

  if (player.score < classData.teamCost) {
    throw new Error("คะแนนไม่เพียงพอ");
  }

  const now = Date.now();

  if (player.classId === "warrior") {
    addEffect(
      "warrior-zone",
      {
        team: player.team,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        radius: 190
      },
      7000
    );
  }

  if (player.classId === "mage") {
    const nearbyOperators = [...tiles.values()]
      .filter(
        (tile) =>
          ["+", "-", "×", "÷", "="].includes(tile.value) &&
          Math.hypot(tile.x - player.x, tile.y - player.y) <= 500
      )
      .map((tile) => tile.id);

    for (const teammate of players.values()) {
      if (teammate.team === player.team) {
        io.to(teammate.id).emit("revealTiles", {
          ids: nearbyOperators,
          duration: 6000
        });
      }
    }
  }

  if (player.classId === "runner") {
    addEffect(
      "speed-trail",
      {
        team: player.team,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        radius: 125
      },
      5000
    );
  }

  if (player.classId === "engineer") {
    const base = bases[player.team];

    if (!base.alive || Math.hypot(player.x - base.x, player.y - base.y) > 155) {
      throw new Error("ต้องอยู่ใกล้ฐานของทีม");
    }

    const history = repairHistory.get(player.team) || [];
    const recent = history.filter((entry) => now - entry.time < 30000);
    const repaired = recent.reduce((total, entry) => total + entry.amount, 0);
    const amount = Math.min(80, 160 - repaired, base.maxHp - base.hp);

    if (amount <= 0) {
      throw new Error("ฐานยังซ่อมไม่ได้หรือมี HP เต็มแล้ว");
    }

    io.to(player.id).emit("notice", "กำลังซ่อมฐาน ห้ามออกจากพื้นที่ 3 วินาที");

    setTimeout(() => {
      const current = players.get(player.id);
      if (!current || !base.alive) return;

      if (Math.hypot(current.x - base.x, current.y - base.y) > 155) {
        io.to(player.id).emit("notice", "ยกเลิกการซ่อมเพราะออกนอกพื้นที่");
        return;
      }

      if (!spendScore(current, classData.teamCost)) return;

      const heal = Math.min(amount, base.maxHp - base.hp);
      base.hp += heal;
      repairHistory.set(player.team, [
        ...recent,
        { time: Date.now(), amount: heal }
      ]);

      current.cooldowns.team = Date.now();
      current.lastSkillAt = Date.now();
      statistics[current.classId].teamUses += 1;

      addEffect(
        "repair",
        {
          team: current.team,
          x: base.x,
          y: base.y,
          radius: 100
        },
        1200
      );

      io.to(player.id).emit("notice", `ซ่อมฐานสำเร็จ +${heal} HP`);
    }, 3000);

    return false;
  }

  if (player.classId === "mathematician") {
    addEffect(
      "knowledge-zone",
      {
        team: player.team,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        radius: 260
      },
      8000
    );
  }

  spendScore(player, classData.teamCost);
  player.cooldowns.team = now;
  player.lastSkillAt = now;
  statistics[player.classId].teamUses += 1;

  return true;
}

function baseDamageReduction(base) {
  let reduction = 0;

  for (const player of players.values()) {
    if (
      player.team === base.team &&
      player.classId === "warrior" &&
      Math.hypot(player.x - base.x, player.y - base.y) <= 220
    ) {
      reduction = Math.max(reduction, 0.1);
    }
  }

  const protectiveZone = effects.some(
    (effect) =>
      effect.type === "warrior-zone" &&
      effect.team === base.team &&
      effect.expiresAt > Date.now() &&
      Math.hypot(effect.x - base.x, effect.y - base.y) <= effect.radius
  );

  if (protectiveZone) reduction += 0.15;
  return Math.min(reduction, CONFIG.MAX_DAMAGE_REDUCTION);
}

function attackBase(player) {
  if (Date.now() - player.lastAttackAt < CONFIG.ATTACK_COOLDOWN) {
    throw new Error("การโจมตีกำลังคูลดาวน์");
  }

  const target = Object.values(bases)
    .filter(
      (base) =>
        base.alive &&
        base.team !== player.team &&
        Math.hypot(player.x - base.x, player.y - base.y) <= CONFIG.ATTACK_RANGE
    )
    .sort((a, b) => distance(player, a) - distance(player, b))[0];

  if (!target) throw new Error("ไม่มีฐานศัตรูอยู่ในระยะ");
  if (!spendScore(player, CONFIG.ATTACK_COST)) {
    throw new Error("ต้องใช้ 20 คะแนนในการโจมตี");
  }

  const reduction = baseDamageReduction(target);
  const damage = Math.round(CONFIG.ATTACK_DAMAGE * (1 - reduction));

  target.hp = Math.max(0, target.hp - damage);
  target.alive = target.hp > 0;
  player.lastAttackAt = Date.now();

  addEffect(
    "attack",
    {
      team: player.team,
      x: target.x,
      y: target.y,
      radius: 110
    },
    650
  );

  if (!target.alive) {
    io.emit("notice", `ฐานทีม${CONFIG.TEAMS[target.team].name}ถูกทำลายแล้ว`);
    checkWinner();
  }
}

function checkWinner() {
  const alive = Object.values(bases).filter((base) => base.alive);
  if (alive.length !== 1 || roundEnding) return;

  roundEnding = true;
  const winner = alive[0].team;
  statisticsForWinningTeam(winner);

  io.emit("roundEnded", {
    winner,
    teamName: CONFIG.TEAMS[winner].name,
    resetIn: CONFIG.ROUND_RESET_MS
  });

  console.table(statistics);

  setTimeout(resetRound, CONFIG.ROUND_RESET_MS);
}

function statisticsForWinningTeam(teamId) {
  const winningClasses = new Set(
    [...players.values()]
      .filter((player) => player.team === teamId)
      .map((player) => player.classId)
  );

  for (const classId of winningClasses) {
    statistics[classId].wins += 1;
  }
}

function resetRound() {
  for (const base of Object.values(bases)) {
    base.hp = base.maxHp;
    base.alive = true;
  }

  effects.length = 0;
  repairHistory.clear();

  for (const player of players.values()) {
    const spawn = spawnPosition(player.team);
    player.x = spawn.x;
    player.y = spawn.y;
    player.score = 0;
    player.inventory = [];
    player.cooldowns = {};
    player.lastAttackAt = 0;
    player.lastSkillAt = Date.now();
    player.sprintUntil = 0;
    player.runnerPickupUntil = 0;
    io.to(player.id).emit("inventory", []);
  }

  tiles.clear();
  refillTiles();
  roundEnding = false;
  io.emit("roundStarted");
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    classId: player.classId,
    x: Math.round(player.x * 10) / 10,
    y: Math.round(player.y * 10) / 10,
    direction: player.direction,
    moving: player.moving,
    score: player.score,
    cosmetics: player.cosmetics,
    cooldowns: player.cooldowns,
    sprintUntil: player.sprintUntil
  };
}

function broadcastState() {
  io.emit("state", {
    serverTime: Date.now(),
    players: [...players.values()].map(serializePlayer),
    tiles: [...tiles.values()],
    bases: Object.values(bases),
    effects: effects.filter((effect) => effect.expiresAt > Date.now())
  });
}

io.on("connection", (socket) => {
  socket.on("joinGame", (payload, callback) => {
    try {
      if (players.has(socket.id)) throw new Error("คุณอยู่ในเกมแล้ว");

      const name = sanitizeName(payload?.name);
      const team = payload?.team;
      const classId = payload?.classId;

      if (!name) throw new Error("ชื่อต้องมี 2–16 ตัวอักษร");
      if (!CONFIG.TEAMS[team]) throw new Error("ทีมไม่ถูกต้อง");
      if (!CONFIG.CLASSES[classId]) throw new Error("สายตัวละครไม่ถูกต้อง");
      if (teamPopulation(team) >= CONFIG.TEAM_LIMIT) {
        throw new Error("ทีมนี้เต็มแล้ว");
      }

      const spawn = spawnPosition(team);
      const player = {
        id: socket.id,
        name,
        team,
        classId,
        cosmetics: validateCosmetics(payload?.cosmetics),
        x: spawn.x,
        y: spawn.y,
        direction: "down",
        moving: false,
        score: 0,
        inventory: [],
        input: {
          up: false,
          down: false,
          left: false,
          right: false
        },
        lastInputSequence: 0,
        cooldowns: {},
        lastSkillAt: Date.now(),
        lastAttackAt: 0,
        sprintUntil: 0,
        runnerPickupUntil: 0,
        eventWindow: []
      };

      players.set(socket.id, player);
      statistics[classId].selections += 1;

      callback?.({
        ok: true,
        playerId: socket.id,
        inventory: [],
        config: {
          worldWidth: CONFIG.WORLD_WIDTH,
          worldHeight: CONFIG.WORLD_HEIGHT
        }
      });

      io.emit("notice", `${name} เข้าร่วมทีม${CONFIG.TEAMS[team].name}`);
    } catch (error) {
      callback?.({ ok: false, message: error.message });
    }
  });

  socket.on("input", (payload) => {
    const player = players.get(socket.id);
    if (!player || !payload || typeof payload !== "object") return;

    const sequence = Number(payload.sequence) || 0;
    if (sequence <= player.lastInputSequence) return;
    player.lastInputSequence = sequence;

    player.input = {
      up: payload.up === true,
      down: payload.down === true,
      left: payload.left === true,
      right: payload.right === true
    };
  });

  socket.on("submitEquation", (payload, callback) => {
    const player = players.get(socket.id);

    try {
      if (!player || roundEnding) throw new Error("ยังไม่สามารถส่งสมการได้");
      const result = submitEquation(player, payload?.tileIds);
      callback?.({ ok: true, ...result });
    } catch (error) {
      callback?.({ ok: false, message: error.message });
    }
  });

  socket.on("useSkill", (payload, callback) => {
    const player = players.get(socket.id);

    try {
      if (!player || roundEnding) throw new Error("ยังไม่สามารถใช้สกิลได้");
      activateSkill(player, payload || {});
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, message: error.message });
    }
  });

  socket.on("useTeamSkill", (_, callback) => {
    const player = players.get(socket.id);

    try {
      if (!player || roundEnding) throw new Error("ยังไม่สามารถใช้สกิลทีมได้");
      useTeamSkill(player);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, message: error.message });
    }
  });

  socket.on("interact", (_, callback) => {
    const player = players.get(socket.id);

    try {
      if (!player || roundEnding) throw new Error("ยังไม่สามารถโจมตีได้");
      attackBase(player);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, message: error.message });
    }
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (!player) return;

    players.delete(socket.id);
    io.emit("notice", `${player.name} ออกจากเกม`);
  });
});

refillTiles();

let previousTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;

  if (!roundEnding) {
    for (const player of players.values()) {
      movePlayer(player, deltaSeconds);
      pickupTiles(player);
    }
  }

  cleanEffects();

  if (now - lastSnapshot >= 1000 / CONFIG.SNAPSHOT_RATE) {
    lastSnapshot = now;
    broadcastState();
  }
}, 1000 / CONFIG.TICK_RATE);

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, () => {
  console.log(`Math.io running at http://localhost:${PORT}`);
});
