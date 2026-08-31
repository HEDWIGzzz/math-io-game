'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;

const MAP_SIZE = 2400;
const PLAYER_SPEED = 260;
const PLAYER_RADIUS = 20;
const TILE_RADIUS = 26;
const MAX_INVENTORY = 14;
const MAX_TEAM_PLAYERS = 10;
const TILE_TARGET = 220;

const ATTACK_RANGE = 230;
const ATTACK_COST = 20;
const ATTACK_DAMAGE = 100;
const ATTACK_COOLDOWN = 700;

const TEAMS = ['red', 'blue', 'green', 'yellow'];

const TEAM_COLORS = {
    red: '#ef4444',
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#eab308'
};

const BASE_POSITIONS = {
    red: { x: 220, y: 220 },
    blue: { x: MAP_SIZE - 220, y: 220 },
    green: { x: 220, y: MAP_SIZE - 220 },
    yellow: {
        x: MAP_SIZE - 220,
        y: MAP_SIZE - 220
    }
};

const SPAWN_POSITIONS = {
    red: { x: 360, y: 360 },
    blue: { x: MAP_SIZE - 360, y: 360 },
    green: { x: 360, y: MAP_SIZE - 360 },
    yellow: {
        x: MAP_SIZE - 360,
        y: MAP_SIZE - 360
    }
};

const TILE_POINTS = {
    '0': 1,
    '1': 1,
    '2': 1,
    '3': 1,
    '4': 2,
    '5': 2,
    '6': 2,
    '7': 2,
    '8': 2,
    '9': 2,
    '10': 3,
    '11': 4,
    '12': 4,
    '+': 2,
    '-': 2,
    '×': 3,
    '÷': 3,
    '=': 1
};

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

const players = new Map();
const tiles = new Map();

let bases = createBases();
let roundEnding = false;

function id(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function createBases() {
    const result = {};

    for (const team of TEAMS) {
        result[team] = {
            team,
            x: BASE_POSITIONS[team].x,
            y: BASE_POSITIONS[team].y,
            hp: 2000,
            maxHp: 2000,
            alive: true
        };
    }

    return result;
}

function sanitizeName(value) {
    const result = String(value || '')
        .replace(/[<>&"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 16);

    return result || 'Player';
}

function getTeamCounts() {
    const counts = {
        red: 0,
        blue: 0,
        green: 0,
        yellow: 0
    };

    for (const player of players.values()) {
        if (TEAMS.includes(player.team)) {
            counts[player.team]++;
        }
    }

    return counts;
}

function randomTileCharacter() {
    const chance = Math.random();

    if (chance < 0.64) {
        return String(Math.floor(Math.random() * 10));
    }

    if (chance < 0.76) {
        return String(Math.floor(Math.random() * 3) + 10);
    }

    if (chance < 0.94) {
        const operators = ['+', '-', '×', '÷'];
        return operators[
            Math.floor(Math.random() * operators.length)
        ];
    }

    return '=';
}

function createTile() {
    const character = randomTileCharacter();

    return {
        id: id('tile'),
        x: Math.random() * (MAP_SIZE - 240) + 120,
        y: Math.random() * (MAP_SIZE - 240) + 120,
        char: character,
        type: /^\d+$/.test(character)
            ? 'number'
            : character === '='
                ? 'equals'
                : 'operator'
    };
}

function refillTiles() {
    while (tiles.size < TILE_TARGET) {
        const tile = createTile();
        tiles.set(tile.id, tile);
    }
}

function publicPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        team: player.team,
        x: player.x,
        y: player.y,
        score: player.score
    };
}

function publicPlayers() {
    return Array.from(players.values(), publicPlayer);
}

function emitTeamCounts() {
    io.emit('teamCounts', getTeamCounts());
}

function emitInventory(socket, player) {
    socket.emit('inventory', player.inventory);
}

function parseMathExpression(tokens) {
    let index = 0;

    function parseNumber() {
        const token = tokens[index];

        if (!token || !/^\d+$/.test(token)) {
            throw new Error('ตำแหน่งนี้ต้องเป็นตัวเลข');
        }

        index++;
        return Number(token);
    }

    function parseTerm() {
        let result = parseNumber();

        while (
            tokens[index] === '×' ||
            tokens[index] === '÷'
        ) {
            const operator = tokens[index++];
            const right = parseNumber();

            if (operator === '×') {
                result *= right;
            } else {
                if (right === 0) {
                    throw new Error('ไม่สามารถหารด้วยศูนย์ได้');
                }

                result /= right;
            }
        }

        return result;
    }

    function parseExpression() {
        let result = parseTerm();

        while (
            tokens[index] === '+' ||
            tokens[index] === '-'
        ) {
            const operator = tokens[index++];
            const right = parseTerm();

            if (operator === '+') {
                result += right;
            } else {
                result -= right;
            }
        }

        return result;
    }

    const result = parseExpression();

    if (
        index !== tokens.length ||
        !Number.isFinite(result)
    ) {
        throw new Error('รูปแบบสมการไม่ถูกต้อง');
    }

    return result;
}

function validateEquation(player, submittedIds) {
    if (!Array.isArray(submittedIds)) {
        throw new Error('ข้อมูลสมการไม่ถูกต้อง');
    }

    if (
        submittedIds.length < 3 ||
        submittedIds.length > MAX_INVENTORY
    ) {
        throw new Error('สมการต้องใช้เบี้ยอย่างน้อย 3 ชิ้น');
    }

    const uniqueIds = new Set(submittedIds);

    if (uniqueIds.size !== submittedIds.length) {
        throw new Error('ไม่สามารถใช้เบี้ยซ้ำได้');
    }

    const equationTiles = submittedIds.map(tileId => {
        if (typeof tileId !== 'string') {
            throw new Error('รหัสเบี้ยไม่ถูกต้อง');
        }

        const tile = player.inventory.find(
            item => item.id === tileId
        );

        if (!tile) {
            throw new Error('ไม่พบเบี้ยในกระเป๋า');
        }

        return tile;
    });

    const tokens = equationTiles.map(tile => tile.char);
    const equalsPositions = [];

    tokens.forEach((token, index) => {
        if (token === '=') {
            equalsPositions.push(index);
        }
    });

    if (equalsPositions.length !== 1) {
        throw new Error('ต้องมีเครื่องหมาย = หนึ่งตัว');
    }

    const equalsIndex = equalsPositions[0];

    if (
        equalsIndex === 0 ||
        equalsIndex === tokens.length - 1
    ) {
        throw new Error('เครื่องหมาย = อยู่ผิดตำแหน่ง');
    }

    const left = parseMathExpression(
        tokens.slice(0, equalsIndex)
    );

    const right = parseMathExpression(
        tokens.slice(equalsIndex + 1)
    );

    if (Math.abs(left - right) > 0.000000001) {
        throw new Error('สมการไม่เท่ากัน');
    }

    return equationTiles;
}

function calculateEquationScore(equationTiles) {
    const baseScore = equationTiles.reduce(
        (total, tile) => total + (TILE_POINTS[tile.char] || 0),
        0
    );

    const hasAdvancedOperator = equationTiles.some(
        tile => tile.char === '×' || tile.char === '÷'
    );

    return baseScore * (hasAdvancedOperator ? 20 : 10);
}

function collectNearbyTile(socket, player) {
    if (player.inventory.length >= MAX_INVENTORY) {
        return;
    }

    for (const tile of tiles.values()) {
        const distance = Math.hypot(
            player.x - tile.x,
            player.y - tile.y
        );

        if (distance > PLAYER_RADIUS + TILE_RADIUS) {
            continue;
        }

        tiles.delete(tile.id);
        player.inventory.push(tile);

        io.emit('tileRemoved', tile.id);
        emitInventory(socket, player);

        const replacement = createTile();
        tiles.set(replacement.id, replacement);
        io.emit('tileAdded', replacement);

        break;
    }
}

function findAttackTarget(player) {
    let selectedBase = null;
    let selectedDistance = Infinity;

    for (const team of TEAMS) {
        const base = bases[team];

        if (
            team === player.team ||
            !base.alive
        ) {
            continue;
        }

        const distance = Math.hypot(
            player.x - base.x,
            player.y - base.y
        );

        if (
            distance <= ATTACK_RANGE &&
            distance < selectedDistance
        ) {
            selectedBase = base;
            selectedDistance = distance;
        }
    }

    return selectedBase;
}

function checkWinner() {
    if (roundEnding) return;

    const livingBases = Object.values(bases).filter(
        base => base.alive
    );

    if (livingBases.length > 1) return;

    roundEnding = true;

    const winner = livingBases[0];

    io.emit('roundEnded', {
        winner: winner?.team || null,
        message: winner
            ? `ทีม ${winner.team.toUpperCase()} ชนะ!`
            : 'ไม่มีทีมชนะ'
    });

    setTimeout(resetRound, 6000);
}

function resetRound() {
    bases = createBases();
    roundEnding = false;

    for (const player of players.values()) {
        const spawn = SPAWN_POSITIONS[player.team];

        player.x = spawn.x;
        player.y = spawn.y;
        player.score = 0;
        player.inventory = [];
        player.inputX = 0;
        player.inputY = 0;
        player.lastAttack = 0;

        const socket = io.sockets.sockets.get(player.id);

        if (socket) {
            emitInventory(socket, player);
        }
    }

    io.emit('roundReset', {
        bases
    });
}

refillTiles();

io.on('connection', socket => {
    socket.emit('initialData', {
        socketId: socket.id,
        mapSize: MAP_SIZE,
        teamColors: TEAM_COLORS,
        tiles: Array.from(tiles.values()),
        bases,
        players: publicPlayers(),
        teamCounts: getTeamCounts()
    });

    socket.on('joinGame', data => {
        if (players.has(socket.id)) {
            return;
        }

        const requestedTeam = String(data?.team || '');

        if (!TEAMS.includes(requestedTeam)) {
            socket.emit('joinResult', {
                success: false,
                message: 'ทีมไม่ถูกต้อง'
            });
            return;
        }

        const counts = getTeamCounts();

        if (counts[requestedTeam] >= MAX_TEAM_PLAYERS) {
            socket.emit('joinResult', {
                success: false,
                message: 'ทีมนี้เต็มแล้ว'
            });
            return;
        }

        const spawn = SPAWN_POSITIONS[requestedTeam];

        const player = {
            id: socket.id,
            name: sanitizeName(data?.name),
            team: requestedTeam,
            x: spawn.x,
            y: spawn.y,
            score: 0,
            inventory: [],
            inputX: 0,
            inputY: 0,
            lastAttack: 0
        };

        players.set(socket.id, player);

        socket.emit('joinResult', {
            success: true,
            player: publicPlayer(player)
        });

        emitInventory(socket, player);
        emitTeamCounts();

        io.emit('notification', {
            message: `${player.name} เข้าร่วมทีม ${player.team}`
        });
    });

    socket.on('movementInput', data => {
        const player = players.get(socket.id);

        if (!player || roundEnding) return;

        const rawX = Number(data?.x);
        const rawY = Number(data?.y);

        if (
            !Number.isFinite(rawX) ||
            !Number.isFinite(rawY)
        ) {
            return;
        }

        let x = clamp(rawX, -1, 1);
        let y = clamp(rawY, -1, 1);

        const length = Math.hypot(x, y);

        if (length > 1) {
            x /= length;
            y /= length;
        }

        player.inputX = x;
        player.inputY = y;
    });

    socket.on('submitEquation', submittedIds => {
        const player = players.get(socket.id);

        if (!player || roundEnding) return;

        try {
            const equationTiles = validateEquation(
                player,
                submittedIds
            );

            const usedIds = new Set(
                equationTiles.map(tile => tile.id)
            );

            const earnedScore = calculateEquationScore(
                equationTiles
            );

            player.inventory = player.inventory.filter(
                tile => !usedIds.has(tile.id)
            );

            player.score += earnedScore;

            emitInventory(socket, player);

            socket.emit('equationResult', {
                success: true,
                earnedScore,
                score: player.score,
                message: `สมการถูกต้อง +${earnedScore} คะแนน`
            });
        } catch (error) {
            socket.emit('equationResult', {
                success: false,
                message: error.message || 'สมการไม่ถูกต้อง'
            });
        }
    });

    socket.on('attackBase', () => {
        const player = players.get(socket.id);

        if (!player || roundEnding) return;

        const now = Date.now();

        if (now - player.lastAttack < ATTACK_COOLDOWN) {
            return;
        }

        player.lastAttack = now;

        const target = findAttackTarget(player);

        if (!target) {
            socket.emit('attackResult', {
                success: false,
                message: 'ต้องอยู่ใกล้ฐานของฝ่ายตรงข้าม'
            });
            return;
        }

        if (player.score < ATTACK_COST) {
            socket.emit('attackResult', {
                success: false,
                message: `ต้องใช้ ${ATTACK_COST} คะแนน`
            });
            return;
        }

        player.score -= ATTACK_COST;
        target.hp = Math.max(
            0,
            target.hp - ATTACK_DAMAGE
        );

        if (target.hp === 0) {
            target.alive = false;

            io.emit('notification', {
                message:
                    `ฐานทีม ${target.team.toUpperCase()} ` +
                    `ถูกทำลายแล้ว!`
            });
        }

        socket.emit('attackResult', {
            success: true,
            message:
                `โจมตีฐาน ${target.team.toUpperCase()} ` +
                `${ATTACK_DAMAGE} damage`
        });

        io.emit('baseHit', {
            team: target.team,
            hp: target.hp,
            alive: target.alive
        });

        checkWinner();
    });

    socket.on('disconnect', () => {
        const player = players.get(socket.id);

        if (!player) return;

        players.delete(socket.id);
        emitTeamCounts();

        io.emit('notification', {
            message: `${player.name} ออกจากเกม`
        });
    });
});

let previousTick = Date.now();

setInterval(() => {
    const now = Date.now();
    const deltaTime = Math.min(
        (now - previousTick) / 1000,
        0.1
    );

    previousTick = now;

    if (roundEnding) return;

    for (const player of players.values()) {
        player.x = clamp(
            player.x +
                player.inputX *
                PLAYER_SPEED *
                deltaTime,
            PLAYER_RADIUS,
            MAP_SIZE - PLAYER_RADIUS
        );

        player.y = clamp(
            player.y +
                player.inputY *
                PLAYER_SPEED *
                deltaTime,
            PLAYER_RADIUS,
            MAP_SIZE - PLAYER_RADIUS
        );

        const socket = io.sockets.sockets.get(player.id);

        if (socket) {
            collectNearbyTile(socket, player);
        }
    }
}, 1000 / 30);

setInterval(() => {
    io.emit('worldState', {
        players: publicPlayers(),
        bases
    });
}, 1000 / 15);

server.listen(PORT, () => {
    console.log(`Math.io running at http://localhost:${PORT}`);
});
