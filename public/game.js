"use strict";

const socket = io();
const CONFIG = window.GAME_CONFIG;
const renderer = window.CharacterRenderer;

const setupScreen = document.querySelector("#setupScreen");
const gameScreen = document.querySelector("#gameScreen");
const gameCanvas = document.querySelector("#gameCanvas");
const gameContext = gameCanvas.getContext("2d");
const previewCanvas = document.querySelector("#previewCanvas");
const previewContext = previewCanvas.getContext("2d");

const playerNameInput = document.querySelector("#playerName");
const teamOptions = document.querySelector("#teamOptions");
const classOptions = document.querySelector("#classOptions");
const classDescription = document.querySelector("#classDescription");
const cosmeticControls = document.querySelector("#cosmeticControls");
const primaryColor = document.querySelector("#primaryColor");
const secondaryColor = document.querySelector("#secondaryColor");
const setupError = document.querySelector("#setupError");
const joinButton = document.querySelector("#joinButton");

const identityText = document.querySelector("#identityText");
const scoreText = document.querySelector("#scoreText");
const capacityText = document.querySelector("#capacityText");
const inventoryElement = document.querySelector("#inventory");
const equationBuilder = document.querySelector("#equationBuilder");
const baseBars = document.querySelector("#baseBars");
const leaderboard = document.querySelector("#leaderboard");
const noticeElement = document.querySelector("#notice");
const roundOverlay = document.querySelector("#roundOverlay");
const winnerText = document.querySelector("#winnerText");

const state = {
  playerId: null,
  joined: false,
  selectedTeam: "red",
  selectedClass: "warrior",
  cosmetics: {},
  players: new Map(),
  tiles: [],
  bases: [],
  effects: [],
  inventory: [],
  equationIds: [],
  revealedTileIds: new Set(),
  revealUntil: 0,
  camera: { x: 0, y: 0 },
  keys: {
    up: false,
    down: false,
    left: false,
    right: false
  },
  inputSequence: 0,
  previewDirection: "down"
};

const cosmeticLabels = {
  skin: "สีผิว",
  hair: "ทรงผม",
  hairColor: "สีผม",
  face: "ใบหน้า",
  eyes: "สีตา",
  shirt: "เสื้อ",
  pants: "กางเกง",
  shoes: "รองเท้า",
  hat: "หมวก",
  glasses: "แว่นตา",
  back: "ของด้านหลัง",
  effect: "เอฟเฟกต์"
};

function loadCosmetics() {
  const defaults = {};

  for (const [key, values] of Object.entries(CONFIG.COSMETICS)) {
    defaults[key] = values[0];
  }

  try {
    const saved = JSON.parse(localStorage.getItem("mathio-cosmetics"));
    state.cosmetics = { ...defaults, ...(saved || {}) };
  } catch {
    state.cosmetics = defaults;
  }

  state.cosmetics.primary = state.cosmetics.primary || "#3b82f6";
  state.cosmetics.secondary = state.cosmetics.secondary || "#f8fafc";
}

function saveCosmetics() {
  localStorage.setItem("mathio-cosmetics", JSON.stringify(state.cosmetics));
}

function createSetupUI() {
  for (const [teamId, team] of Object.entries(CONFIG.TEAMS)) {
    const button = document.createElement("button");
    button.className = "option-button";
    button.textContent = team.name;
    button.style.borderColor = team.color;

    button.addEventListener("click", () => {
      state.selectedTeam = teamId;
      refreshSelections();
    });

    button.dataset.team = teamId;
    teamOptions.append(button);
  }

  for (const [classId, classData] of Object.entries(CONFIG.CLASSES)) {
    const button = document.createElement("button");
    button.className = "class-button";
    button.dataset.class = classId;
    button.innerHTML = `
      <strong>${classData.name}</strong>
      <small>${classData.role}</small>
    `;

    button.addEventListener("click", () => {
      state.selectedClass = classId;
      refreshSelections();
    });

    classOptions.append(button);
  }

  for (const [key, values] of Object.entries(CONFIG.COSMETICS)) {
    if (key === "colors") continue;

    const label = document.createElement("label");
    label.textContent = cosmeticLabels[key] || key;

    if (key === "hairColor" || key === "eyes") {
      const input = document.createElement("input");
      input.type = "color";
      input.value = state.cosmetics[key];

      input.addEventListener("input", () => {
        state.cosmetics[key] = input.value;
        saveCosmetics();
      });

      label.append(input);
    } else {
      const select = document.createElement("select");

      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value.replace(`${key}-`, "").replaceAll("-", " ");
        option.selected = value === state.cosmetics[key];
        select.append(option);
      }

      select.addEventListener("change", () => {
        state.cosmetics[key] = select.value;
        saveCosmetics();
      });

      label.append(select);
    }

    label.dataset.cosmetic = key;
    cosmeticControls.append(label);
  }

  primaryColor.value = state.cosmetics.primary;
  secondaryColor.value = state.cosmetics.secondary;

  primaryColor.addEventListener("input", () => {
    state.cosmetics.primary = primaryColor.value;
    saveCosmetics();
  });

  secondaryColor.addEventListener("input", () => {
    state.cosmetics.secondary = secondaryColor.value;
    saveCosmetics();
  });

  refreshSelections();
}

function refreshSelections() {
  document.querySelectorAll("[data-team]").forEach((element) => {
    element.classList.toggle("selected", element.dataset.team === state.selectedTeam);
  });

  document.querySelectorAll("[data-class]").forEach((element) => {
    element.classList.toggle("selected", element.dataset.class === state.selectedClass);
  });

  const classData = CONFIG.CLASSES[state.selectedClass];
  classDescription.innerHTML = `
    <strong>${classData.name} — ${classData.role}</strong><br>
    ${classData.description}<br>
    ความเร็ว ${classData.speed} · กระเป๋า ${classData.capacity} ช่อง
  `;
}

function syncCosmeticControls() {
  document.querySelectorAll("[data-cosmetic]").forEach((label) => {
    const key = label.dataset.cosmetic;
    const control = label.querySelector("select, input");
    control.value = state.cosmetics[key];
  });

  primaryColor.value = state.cosmetics.primary;
  secondaryColor.value = state.cosmetics.secondary;
}

function randomizeCosmetics() {
  for (const [key, values] of Object.entries(CONFIG.COSMETICS)) {
    if (key === "colors") continue;
    state.cosmetics[key] = values[Math.floor(Math.random() * values.length)];
  }

  state.cosmetics.primary =
    CONFIG.COSMETICS.colors[Math.floor(Math.random() * CONFIG.COSMETICS.colors.length)];

  state.cosmetics.secondary =
    CONFIG.COSMETICS.colors[Math.floor(Math.random() * CONFIG.COSMETICS.colors.length)];

  saveCosmetics();
  syncCosmeticControls();
}

function resetCosmetics() {
  localStorage.removeItem("mathio-cosmetics");
  loadCosmetics();
  syncCosmeticControls();
}

document.querySelector("#randomizeButton").addEventListener("click", randomizeCosmetics);
document.querySelector("#resetButton").addEventListener("click", resetCosmetics);

function showNotice(message) {
  noticeElement.textContent = message;
  noticeElement.classList.add("visible");
  clearTimeout(showNotice.timeout);
  showNotice.timeout = setTimeout(() => {
    noticeElement.classList.remove("visible");
  }, 2500);
}

function joinGame() {
  setupError.textContent = "";
  joinButton.disabled = true;

  socket.emit(
    "joinGame",
    {
      name: playerNameInput.value,
      team: state.selectedTeam,
      classId: state.selectedClass,
      cosmetics: state.cosmetics
    },
    (response) => {
      joinButton.disabled = false;

      if (!response?.ok) {
        setupError.textContent = response?.message || "ไม่สามารถเข้าเกมได้";
        return;
      }

      state.playerId = response.playerId;
      state.joined = true;
      state.inventory = response.inventory || [];
      setupScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      resizeCanvas();
      renderInventory();
    }
  );
}

joinButton.addEventListener("click", joinGame);

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  gameCanvas.width = Math.floor(window.innerWidth * ratio);
  gameCanvas.height = Math.floor(window.innerHeight * ratio);
  gameCanvas.style.width = `${window.innerWidth}px`;
  gameCanvas.style.height = `${window.innerHeight}px`;
  gameContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}

window.addEventListener("resize", resizeCanvas);

function setKey(code, pressed) {
  const mapping = {
    KeyW: "up",
    ArrowUp: "up",
    KeyS: "down",
    ArrowDown: "down",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right"
  };

  if (mapping[code]) {
    state.keys[mapping[code]] = pressed;
    return true;
  }

  return false;
}

window.addEventListener("keydown", (event) => {
  if (!state.joined) return;

  if (setKey(event.code, true)) {
    event.preventDefault();
  }

  if (!event.repeat && (event.code === "ShiftLeft" || event.code === "Space")) {
    useActiveSkill();
  }

  if (!event.repeat && event.code === "KeyE") {
    attack();
  }
});

window.addEventListener("keyup", (event) => {
  if (setKey(event.code, false)) event.preventDefault();
});

document.querySelectorAll(".dpad button").forEach((button) => {
  const key = button.dataset.key;

  const press = (event) => {
    event.preventDefault();
    state.keys[key] = true;
  };

  const release = (event) => {
    event.preventDefault();
    state.keys[key] = false;
  };

  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
});

setInterval(() => {
  if (!state.joined) return;

  socket.emit("input", {
    ...state.keys,
    sequence: ++state.inputSequence
  });
}, 50);

function renderInventory() {
  inventoryElement.replaceChildren();
  equationBuilder.replaceChildren();

  const classData = CONFIG.CLASSES[state.selectedClass];
  capacityText.textContent = `${state.inventory.length}/${classData.capacity}`;

  for (const tile of state.inventory) {
    const button = document.createElement("button");
    button.className = "math-tile";
    button.textContent = tile.value;

    if (state.equationIds.includes(tile.id)) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      if (state.equationIds.includes(tile.id)) {
        state.equationIds = state.equationIds.filter((id) => id !== tile.id);
      } else {
        state.equationIds.push(tile.id);
      }
      renderInventory();
    });

    inventoryElement.append(button);
  }

  for (const id of state.equationIds) {
    const tile = state.inventory.find((item) => item.id === id);
    if (!tile) continue;

    const button = document.createElement("button");
    button.className = "math-tile";
    button.textContent = tile.value;

    button.addEventListener("click", () => {
      state.equationIds = state.equationIds.filter(
        (selectedId) => selectedId !== id
      );
      renderInventory();
    });

    equationBuilder.append(button);
  }
}

document.querySelector("#clearEquation").addEventListener("click", () => {
  state.equationIds = [];
  renderInventory();
});

document.querySelector("#submitEquation").addEventListener("click", () => {
  socket.emit(
    "submitEquation",
    { tileIds: state.equationIds },
    (response) => {
      if (!response?.ok) {
        showNotice(response?.message || "สมการไม่ถูกต้อง");
        return;
      }

      showNotice(
        `${response.expression} ถูกต้อง! ได้ ${response.finalScore} คะแนน`
      );

      state.equationIds = [];
      renderInventory();
    }
  );
});

function activeSkillPayload() {
  if (state.selectedClass === "mage") {
    const tileId = state.equationIds.find((id) => {
      const tile = state.inventory.find((item) => item.id === id);
      return tile && ["+", "-", "×", "÷"].includes(tile.value);
    });

    return { tileId };
  }

  if (state.selectedClass === "engineer") {
    const tileIds = state.equationIds.filter((id) => {
      const tile = state.inventory.find((item) => item.id === id);
      return tile && /^\d+$/.test(tile.value);
    }).slice(0, 2);

    return { tileIds };
  }

  return {};
}

function useActiveSkill() {
  socket.emit("useSkill", activeSkillPayload(), (response) => {
    showNotice(response?.ok ? "ใช้สกิลสำเร็จ" : response?.message || "ใช้สกิลไม่ได้");
  });
}

function useTeamSkill() {
  socket.emit("useTeamSkill", {}, (response) => {
    showNotice(
      response?.ok ? "ใช้สกิลทีมสำเร็จ" : response?.message || "ใช้สกิลทีมไม่ได้"
    );
  });
}

function attack() {
  socket.emit("interact", {}, (response) => {
    showNotice(response?.ok ? "โจมตีฐานสำเร็จ" : response?.message || "โจมตีไม่ได้");
  });
}

document.querySelector("#activeSkill").addEventListener("click", useActiveSkill);
document.querySelector("#teamSkill").addEventListener("click", useTeamSkill);
document.querySelector("#attackButton").addEventListener("click", attack);
document.querySelector("#mobileSkill").addEventListener("click", useActiveSkill);
document.querySelector("#mobileAttack").addEventListener("click", attack);

socket.on("inventory", (inventory) => {
  state.inventory = Array.isArray(inventory) ? inventory : [];
  state.equationIds = state.equationIds.filter((id) =>
    state.inventory.some((tile) => tile.id === id)
  );
  renderInventory();
});

socket.on("notice", showNotice);

socket.on("equationHint", (ids) => {
  state.equationIds = Array.isArray(ids) ? ids : [];
  renderInventory();
  showNotice("พบคำใบ้สมการแล้ว");
});

socket.on("revealTiles", ({ ids, duration }) => {
  state.revealedTileIds = new Set(ids);
  state.revealUntil = Date.now() + duration;
  showNotice("มองเห็นเบี้ยเครื่องหมายใกล้เคียงแล้ว");
});

socket.on("roundEnded", ({ teamName }) => {
  winnerText.textContent = `ทีม${teamName}ชนะ!`;
  roundOverlay.classList.remove("hidden");
});

socket.on("roundStarted", () => {
  roundOverlay.classList.add("hidden");
  state.equationIds = [];
  showNotice("เริ่มรอบใหม่");
});

socket.on("state", (snapshot) => {
  const nextIds = new Set();

  for (const player of snapshot.players || []) {
    nextIds.add(player.id);
    const current = state.players.get(player.id);

    if (current) {
      current.targetX = player.x;
      current.targetY = player.y;
      Object.assign(current, player);

      if (player.id !== state.playerId) {
        current.x = current.renderX ?? player.x;
        current.y = current.renderY ?? player.y;
      }
    } else {
      state.players.set(player.id, {
        ...player,
        renderX: player.x,
        renderY: player.y,
        targetX: player.x,
        targetY: player.y
      });
    }
  }

  for (const id of state.players.keys()) {
    if (!nextIds.has(id)) state.players.delete(id);
  }

  state.tiles = snapshot.tiles || [];
  state.bases = snapshot.bases || [];
  state.effects = snapshot.effects || [];

  updateHUD();
});

function updateHUD() {
  const local = state.players.get(state.playerId);
  if (!local) return;

  identityText.textContent =
    `${local.name} · ${CONFIG.CLASSES[local.classId].name} · ทีม${CONFIG.TEAMS[local.team].name}`;

  scoreText.textContent = `คะแนน ${local.score}`;

  baseBars.innerHTML = state.bases
    .map((base) => {
      const team = CONFIG.TEAMS[base.team];
      const percent = Math.max(0, (base.hp / base.maxHp) * 100);

      return `
        <div class="base-bar">
          <label>ทีม${team.name} ${base.hp}/${base.maxHp}</label>
          <div class="base-fill" style="width:${percent}%;background:${team.color}"></div>
        </div>
      `;
    })
    .join("");

  const leaders = [...state.players.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  leaderboard.innerHTML = `
    <strong>อันดับ</strong>
    ${leaders
      .map(
        (player, index) =>
          `<span>${index + 1}. ${player.name} — ${player.score}</span>`
      )
      .join("")}
  `;
}

function worldToScreen(x, y) {
  return {
    x: x - state.camera.x + window.innerWidth / 2,
    y: y - state.camera.y + window.innerHeight / 2
  };
}

function drawGrid() {
  const size = 80;
  const startX =
    Math.floor((state.camera.x - window.innerWidth / 2) / size) * size;
  const startY =
    Math.floor((state.camera.y - window.innerHeight / 2) / size) * size;

  gameContext.strokeStyle = "rgba(255,255,255,0.045)";
  gameContext.lineWidth = 1;

  for (
    let x = startX;
    x <= state.camera.x + window.innerWidth / 2 + size;
    x += size
  ) {
    const point = worldToScreen(x, 0);
    gameContext.beginPath();
    gameContext.moveTo(point.x, 0);
    gameContext.lineTo(point.x, window.innerHeight);
    gameContext.stroke();
  }

  for (
    let y = startY;
    y <= state.camera.y + window.innerHeight / 2 + size;
    y += size
  ) {
    const point = worldToScreen(0, y);
    gameContext.beginPath();
    gameContext.moveTo(0, point.y);
    gameContext.lineTo(window.innerWidth, point.y);
    gameContext.stroke();
  }
}

function drawWorldBoundary() {
  const topLeft = worldToScreen(0, 0);
  gameContext.strokeStyle = "#94a3b8";
  gameContext.lineWidth = 8;
  gameContext.strokeRect(
    topLeft.x,
    topLeft.y,
    CONFIG.WORLD_WIDTH,
    CONFIG.WORLD_HEIGHT
  );
}

function drawObstacles() {
  for (const obstacle of CONFIG.OBSTACLES) {
    const point = worldToScreen(obstacle.x, obstacle.y);
    gameContext.fillStyle = "#334155";
    gameContext.fillRect(point.x, point.y, obstacle.w, obstacle.h);
    gameContext.strokeStyle = "#64748b";
    gameContext.lineWidth = 3;
    gameContext.strokeRect(point.x, point.y, obstacle.w, obstacle.h);
  }
}

function drawBases() {
  for (const base of state.bases) {
    const point = worldToScreen(base.x, base.y);
    const team = CONFIG.TEAMS[base.team];

    gameContext.globalAlpha = base.alive ? 1 : 0.25;
    gameContext.fillStyle = team.color;
    gameContext.strokeStyle = "#f8fafc";
    gameContext.lineWidth = 5;

    gameContext.beginPath();
    gameContext.arc(point.x, point.y, CONFIG.BASE_RADIUS, 0, Math.PI * 2);
    gameContext.fill();
    gameContext.stroke();

    gameContext.fillStyle = "#07111f";
    gameContext.fillRect(point.x - 38, point.y - 20, 76, 40);
    gameContext.fillStyle = "#f8fafc";
    gameContext.font = "bold 13px sans-serif";
    gameContext.textAlign = "center";
    gameContext.fillText(`ฐาน ${base.hp}`, point.x, point.y + 5);
    gameContext.globalAlpha = 1;
  }
}

function drawTiles() {
  const revealActive = state.revealUntil > Date.now();

  for (const tile of state.tiles) {
    const point = worldToScreen(tile.x, tile.y);
    const revealed = revealActive && state.revealedTileIds.has(tile.id);

    if (
      point.x < -50 ||
      point.y < -50 ||
      point.x > window.innerWidth + 50 ||
      point.y > window.innerHeight + 50
    ) {
      continue;
    }

    if (revealed) {
      gameContext.fillStyle = "rgba(56,189,248,0.25)";
      gameContext.beginPath();
      gameContext.arc(point.x, point.y, 28, 0, Math.PI * 2);
      gameContext.fill();
    }

    gameContext.fillStyle = "#fbbf24";
    gameContext.strokeStyle = revealed ? "#38bdf8" : "#92400e";
    gameContext.lineWidth = revealed ? 4 : 2;
    gameContext.beginPath();
    gameContext.roundRect(point.x - 17, point.y - 17, 34, 34, 7);
    gameContext.fill();
    gameContext.stroke();

    gameContext.fillStyle = "#422006";
    gameContext.font = "bold 16px sans-serif";
    gameContext.textAlign = "center";
    gameContext.fillText(tile.value, point.x, point.y + 6);
  }
}

function drawEffects(time) {
  for (const effect of state.effects) {
    const point = worldToScreen(effect.x, effect.y);
    const progress = Math.max(
      0,
      Math.min(1, (effect.expiresAt - Date.now()) / 1000)
    );

    gameContext.save();
    gameContext.globalAlpha = Math.min(0.5, progress);

    if (effect.type === "warrior-zone") {
      gameContext.fillStyle = CONFIG.TEAMS[effect.team].color;
      gameContext.beginPath();
      gameContext.arc(point.x, point.y, effect.radius, 0, Math.PI * 2);
      gameContext.fill();
    } else if (effect.type === "speed-trail") {
      gameContext.fillStyle = "#38bdf8";
      gameContext.beginPath();
      gameContext.arc(point.x, point.y, effect.radius, 0, Math.PI * 2);
      gameContext.fill();
    } else if (effect.type === "knowledge-zone") {
      gameContext.strokeStyle = "#c084fc";
      gameContext.lineWidth = 5;
      gameContext.beginPath();
      gameContext.arc(
        point.x,
        point.y,
        effect.radius + Math.sin(time * 0.006) * 5,
        0,
        Math.PI * 2
      );
      gameContext.stroke();
    } else {
      gameContext.fillStyle =
        effect.type === "repair" ? "#22c55e" : "#f97316";
      gameContext.beginPath();
      gameContext.arc(
        point.x,
        point.y,
        30 + Math.sin(time * 0.02) * 20,
        0,
        Math.PI * 2
      );
      gameContext.fill();
    }

    gameContext.restore();
  }
}

function drawPlayers(time) {
  const ordered = [...state.players.values()].sort(
    (a, b) => (a.renderY ?? a.y) - (b.renderY ?? b.y)
  );

  for (const player of ordered) {
    if (player.id !== state.playerId) {
      player.renderX += (player.targetX - player.renderX) * 0.18;
      player.renderY += (player.targetY - player.renderY) * 0.18;
    } else {
      player.renderX = player.x;
      player.renderY = player.y;
    }

    const point = worldToScreen(player.renderX, player.renderY);

    renderer.drawCharacter(gameContext, {
      x: point.x,
      y: point.y,
      direction: player.direction,
      moving: player.moving,
      classId: player.classId,
      teamColor: CONFIG.TEAMS[player.team].color,
      cosmetics: player.cosmetics,
      time
    });

    gameContext.textAlign = "center";
    gameContext.font = "bold 12px sans-serif";
    gameContext.lineWidth = 4;
    gameContext.strokeStyle = "rgba(2,6,23,0.9)";
    gameContext.strokeText(
      `${player.name} · ${CONFIG.CLASSES[player.classId].name}`,
      point.x,
      point.y - 53
    );
    gameContext.fillStyle = CONFIG.TEAMS[player.team].color;
    gameContext.fillText(
      `${player.name} · ${CONFIG.CLASSES[player.classId].name}`,
      point.x,
      point.y - 53
    );

    gameContext.font = "11px sans-serif";
    gameContext.fillStyle = "#f8fafc";
    gameContext.fillText(`${player.score} คะแนน`, point.x, point.y - 39);
  }
}

function predictCamera() {
  const local = state.players.get(state.playerId);
  if (!local) return;

  let predictedX = local.x;
  let predictedY = local.y;

  const horizontal = Number(state.keys.right) - Number(state.keys.left);
  const vertical = Number(state.keys.down) - Number(state.keys.up);
  const length = Math.hypot(horizontal, vertical) || 1;
  const speed = CONFIG.CLASSES[local.classId].speed;

  predictedX += (horizontal / length) * speed * 0.055;
  predictedY += (vertical / length) * speed * 0.055;

  state.camera.x += (predictedX - state.camera.x) * 0.11;
  state.camera.y += (predictedY - state.camera.y) * 0.11;
}

function renderPreview(time) {
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  const team = CONFIG.TEAMS[state.selectedTeam];

  renderer.drawCharacter(previewContext, {
    x: previewCanvas.width / 2,
    y: previewCanvas.height / 2 + 28,
    scale: 2.5,
    direction: state.previewDirection,
    moving: true,
    classId: state.selectedClass,
    teamColor: team.color,
    cosmetics: state.cosmetics,
    time
  });

  previewContext.fillStyle = "#f8fafc";
  previewContext.font = "bold 17px sans-serif";
  previewContext.textAlign = "center";
  previewContext.fillText(
    CONFIG.CLASSES[state.selectedClass].name,
    previewCanvas.width / 2,
    35
  );
}

previewCanvas.addEventListener("click", () => {
  const directions = ["down", "left", "up", "right"];
  const index = directions.indexOf(state.previewDirection);
  state.previewDirection = directions[(index + 1) % directions.length];
});

function render(time) {
  requestAnimationFrame(render);
  renderPreview(time);

  if (!state.joined) return;

  predictCamera();
  gameContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  gameContext.fillStyle = "#163929";
  gameContext.fillRect(0, 0, window.innerWidth, window.innerHeight);

  drawGrid();
  drawWorldBoundary();
  drawObstacles();
  drawEffects(time);
  drawBases();
  drawTiles();
  drawPlayers(time);
}

loadCosmetics();
createSetupUI();
resizeCanvas();
requestAnimationFrame(render);
