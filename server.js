'use strict';

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: false },
    transports: ['websocket', 'polling']
});

app.disable('x-powered-by');
app.use(express.static('public'));

const PORT = Number(process.env.PORT) || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'change-this-password';

const MAP_SIZE = 4000;
const MAX_TEAM_PLAYERS = 10;
const REQUIRED_PLAYERS = 40;
const MAX_INVENTORY = 16;
const MAX_EQUATION_TILES = 20;

const NORMAL_SPEED = 500;
const BOOST_SPEED = 750;
const SLOW_SPEED = 300;

const TILE_COUNT = 350;
const MYSTERY_BOX_COUNT = 70;

const VALID_TEAMS = new Set(['red', 'blue', 'green', 'yellow']);
const VALID_CLASSES = new Set([
    'Assassin',
    'Warrior',
    'Tank',
    'Archer',
    'Mage',
    'Support',
    'Monk',
    'Berserker'
]);

const TEAM_SPAWNS = {
    red: { x: 1200, y: 1200 },
    blue: { x: MAP_SIZE - 1200, y: 1200 },
    green: { x: 1200, y: MAP_SIZE - 1200 },
    yellow: { x: MAP_SIZE - 1200, y: MAP_SIZE - 1200 }
};

const CLASS_COOLDOWNS = {
    Assassin: 3000,
    Warrior: 6000,
    Tank: 9000,
    Archer: 5000,
    Mage: 5000,
    Support: 6000,
    Monk: 4000,
    Berserker: 6000
};

const AMATH_SCORES = {
    '0': 1, '1': 1, '2': 1, '3': 1,
    '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2,
    '10': 3, '11': 4, '12': 3, '13': 6, '14': 4,
    '15': 4, '16': 4, '17': 6, '18': 4, '19': 7, '20': 5,
    '+': 2, '-': 2, '×': 2, '÷': 2, '=': 1
};

const activePlayers = Object.create(null);
const tiles = [];
const mysteryBoxes = [];

let gameStarted = false;
let gameEnding = false;

const gameSettings = {
    baseMaxHp: 3000,
    scoreMultiplier: 15
};

let bases = createBases();

function createId(prefix = '') {
    return prefix + crypto.randomUUID();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeName(value) {
    return String(value || '')
        .replace(/[<>&"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15) || 'Player';
}

function sanitizeColor(value) {
    const color = String(value || '');
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#9b59b6';
}

function createBases() {
    const hp = gameSettings.baseMaxHp;

    return {
        red: {
            x: 800,
            y: 800,
            hp,
            maxHp: hp,
            name: 'Red Fortress',
            team: 'red',
            isAlive: true
        },
        blue: {
            x: MAP_SIZE - 800,
            y: 800,
            hp,
            maxHp: hp,
            name: 'Blue Fortress',
            team: 'blue',
            isAlive: true
        },
        green: {
            x: 800,
            y: MAP_SIZE - 800,
            hp,
            maxHp: hp,
            name: 'Green Fortress',
            team: 'green',
            isAlive: true
        },
        yellow: {
            x: MAP_SIZE - 800,
            y: MAP_SIZE - 800,
            hp,
            maxHp: hp,
            name: 'Yellow Fortress',
            team: 'yellow',
            isAlive: true
        }
    };
}

function basesPayload() {
    return {
        redBase: bases.red,
        blueBase: bases.blue,
        greenBase: bases.green,
        yellowBase: bases.yellow
    };
}

function getTeamCounts() {
    const counts = {
        red: 0,
        blue: 0,
        green: 0,
        yellow: 0
    };

    for (const player of Object.values(activePlayers)) {
        if (
            player.loggedIn &&
            !player.isHost &&
            VALID_TEAMS.has(player.team)
        ) {
            counts[player.team]++;
        }
    }

    return counts;
}

function getPlayerCount() {
    return Object.values(activePlayers).filter(
        player => player.loggedIn && !player.isHost
    ).length;
}

function publicPlayers() {
    const result = {};

    for (const [id, player] of Object.entries(activePlayers)) {
        result[id] = {
            socketId: id,
            playerId: player.playerId,
            name: player.name,
            playerClass: player.playerClass,
            outfitColor: player.outfitColor,
            team: player.team,
            isHost: player.isHost,
            x: player.x,
            y: player.y,
            score: player.score,
            baseDamage: player.baseDamage,
            isMoving: player.isMoving,
            loggedIn: player.loggedIn
        };
    }

    return result;
}

function emitRoomStatus() {
    io.emit('roomStatus', {
        count: getPlayerCount(),
        required: REQUIRED_PLAYERS,
        gameStarted
    });

    io.emit('teamCountsUpdate', getTeamCounts());
}

function emitLeaderboard() {
    io.emit('updateLeaderboard', publicPlayers());
}

function spawnTile() {
    const randomType = Math.random();

    let char;
    let type;

    if (randomType < 0.65) {
        char = Math.random() < 0.8
            ? String(Math.floor(Math.random() * 10))
            : String(Math.floor(Math.random() * 11) + 10);

        type = 'num';
    } else if (randomType < 0.9) {
        const operators = ['+', '-', '×', '÷'];
        char = operators[Math.floor(Math.random() * operators.length)];
        type = 'op';
    } else {
        char = '=';
        type = 'eq';
    }

    const tile = {
        id: createId('TILE_'),
        x: Math.random() * (MAP_SIZE - 400) + 200,
        y: Math.random() * (MAP_SIZE - 400) + 200,
        char,
        type
    };

    tiles.push(tile);
    return tile;
}

function spawnMysteryBox() {
    const box = {
        id: createId('BOX_'),
        x: Math.random() * (MAP_SIZE - 400) + 200,
        y: Math.random() * (MAP_SIZE - 400) + 200
    };

    mysteryBoxes.push(box);
    return box;
}

function refillWorld() {
    while (tiles.length < TILE_COUNT) {
        spawnTile();
    }

    while (mysteryBoxes.length < MYSTERY_BOX_COUNT) {
        spawnMysteryBox();
    }
}

function generateMysteryQuestion() {
    const number1 = Math.floor(Math.random() * 20) + 1;
    const number2 = Math.floor(Math.random() * 20) + 1;
    const operators = ['+', '-', '×'];
    const operator = operators[Math.floor(Math.random() * operators.length)];

    let answer;

    if (operator === '+') answer = number1 + number2;
    else if (operator === '-') answer = number1 - number2;
    else answer = number1 * number2;

    return {
        question: `${number1} ${operator} ${number2} = ?`,
        answer
    };
}

function calculateAMathScore(equationTiles) {
    let baseScore = 0;
    let hasAdvancedOperator = false;

    for (const tile of equationTiles) {
        baseScore += AMATH_SCORES[tile.char] ?? 0;

        if (tile.char === '×' || tile.char === '÷') {
            hasAdvancedOperator = true;
        }
    }

    const complexityMultiplier = hasAdvancedOperator ? 2 : 1;

    return Math.max(
        10,
        baseScore *
        complexityMultiplier *
        gameSettings.scoreMultiplier
    );
}

/*
 * ตัวประเมินสมการแบบปลอดภัย
 * ไม่ใช้ eval() และไม่อนุญาต JavaScript แทรกเข้ามา
 */
function evaluateExpression(tokens) {
    let index = 0;

    function parseNumber() {
        const token = tokens[index];

        if (!token || !/^\d+$/.test(token)) {
            throw new Error('ต้องมีตัวเลขในตำแหน่งนี้');
        }

        index++;
        return Number(token);
    }

    function parseTerm() {
        let value = parseNumber();

        while (index < tokens.length) {
            const operator = tokens[index];

            if (operator !== '×' && operator !== '÷') break;

            index++;
            const right = parseNumber();

            if (operator === '×') {
                value *= right;
            } else {
                if (right === 0) {
                    throw new Error('ไม่สามารถหารด้วยศูนย์ได้');
                }

                value /= right;
            }
        }

        return value;
    }

    function parseExpression() {
        let value = parseTerm();

        while (index < tokens.length) {
            const operator = tokens[index];

            if (operator !== '+' && operator !== '-') break;

            index++;
            const right = parseTerm();

            if (operator === '+') value += right;
            else value -= right;
        }

        return value;
    }

    const result = parseExpression();

    if (index !== tokens.length || !Number.isFinite(result)) {
        throw new Error('รูปแบบสมการไม่ถูกต้อง');
    }

    return result;
}

function validateEquation(player, submittedTiles) {
    if (!Array.isArray(submittedTiles)) {
        throw new Error('ข้อมูลสมการไม่ถูกต้อง');
    }

    if (
        submittedTiles.length < 3 ||
        submittedTiles.length > MAX_EQUATION_TILES
    ) {
        throw new Error(`สมการต้องมี 3-${MAX_EQUATION_TILES} เบี้ย`);
    }

    const submittedIds = new Set();

    for (const submittedTile of submittedTiles) {
        if (
            !submittedTile ||
            typeof submittedTile.id !== 'string' ||
            submittedIds.has(submittedTile.id)
        ) {
            throw new Error('พบเบี้ยซ้ำหรือเบี้ยไม่ถูกต้อง');
        }

        submittedIds.add(submittedTile.id);
    }

    const actualTiles = submittedTiles.map(submittedTile => {
        const inventoryTile = player.inventory.find(
            tile => tile.id === submittedTile.id
        );

        if (!inventoryTile) {
            throw new Error('คุณไม่มีเบี้ยที่ส่งมา');
        }

        if (
            inventoryTile.char !== submittedTile.char ||
            inventoryTile.type !== submittedTile.type
        ) {
            throw new Error('ข้อมูลเบี้ยถูกเปลี่ยนแปลง');
        }

        return inventoryTile;
    });

    const equalsIndexes = [];

    actualTiles.forEach((tile, index) => {
        if (tile.char === '=') equalsIndexes.push(index);
    });

    if (equalsIndexes.length !== 1) {
        throw new Error('สมการต้องมีเครื่องหมาย = หนึ่งตัว');
    }

    const equalsIndex = equalsIndexes[0];

    if (
        equalsIndex === 0 ||
        equalsIndex === actualTiles.length - 1
    ) {
        throw new Error('เครื่องหมาย = อยู่ผิดตำแหน่ง');
    }

    const leftTokens = actualTiles
        .slice(0, equalsIndex)
        .map(tile => tile.char);

    const rightTokens = actualTiles
        .slice(equalsIndex + 1)
        .map(tile => tile.char);

    const leftValue = evaluateExpression(leftTokens);
    const rightValue = evaluateExpression(rightTokens);

    if (Math.abs(leftValue - rightValue) > 1e-9) {
        throw new Error('สมการไม่ถูกต้อง');
    }

    return {
        tiles: actualTiles,
        ids: submittedIds
    };
}

function getMovementSpeed(player, now) {
    if (player.effects.speedBoostUntil > now) {
        return BOOST_SPEED;
    }

    if (
        player.effects.slowUntil > now &&
        player.effects.cleanseUntil <= now
    ) {
        return SLOW_SPEED;
    }

    return NORMAL_SPEED;
}

function removeExpiredEffects(player, now) {
    for (const key of Object.keys(player.effects)) {
        if (player.effects[key] <= now) {
            player.effects[key] = 0;
        }
    }
}

function collectNearbyObjects(socket, player) {
    if (player.inventory.length < MAX_INVENTORY) {
        for (let index = tiles.length - 1; index >= 0; index--) {
            const tile = tiles[index];

            if (Math.hypot(player.x - tile.x, player.y - tile.y) >= 45) {
                continue;
            }

            const collectedTile = tiles.splice(index, 1)[0];
            player.inventory.push(collectedTile);

            io.emit('tileRemoved', collectedTile.id);
            socket.emit('tileCollected', collectedTile);

            const newTile = spawnTile();
            io.emit('newTile', newTile);

            break;
        }
    }

    if (
        player.pendingMystery &&
        player.pendingMystery.expiresAt > Date.now()
    ) {
        return;
    }

    for (let index = mysteryBoxes.length - 1; index >= 0; index--) {
        const box = mysteryBoxes[index];

        if (Math.hypot(player.x - box.x, player.y - box.y) >= 45) {
            continue;
        }

        mysteryBoxes.splice(index, 1);
        io.emit('mysteryBoxRemoved', box.id);

        const mystery = generateMysteryQuestion();

        player.pendingMystery = {
            answer: mystery.answer,
            expiresAt: Date.now() + 15000
        };

        socket.emit('openMysteryBox', {
            q: mystery.question,
            expiresIn: 15000
        });

        const newBox = spawnMysteryBox();
        io.emit('newMysteryBox', newBox);

        break;
    }
}

function resetMatch() {
    gameStarted = false;
    gameEnding = false;
    bases = createBases();

    for (const player of Object.values(activePlayers)) {
        player.score = 0;
        player.baseDamage = 0;
        player.inventory = [];
        player.pendingMystery = null;
        player.lastSkillTime = 0;
        player.lastAttackTime = 0;
        player.effects = createEffects();

        if (!player.isHost && TEAM_SPAWNS[player.team]) {
            player.x = TEAM_SPAWNS[player.team].x;
            player.y = TEAM_SPAWNS[player.team].y;
        }
    }

    io.emit('basesUpdate', basesPayload());
    io.emit('roomStatus', {
        count: getPlayerCount(),
        required: REQUIRED_PLAYERS,
        gameStarted: false
    });
}

function createEffects() {
    return {
        speedBoostUntil: 0,
        slowUntil: 0,
        cleanseUntil: 0,
        scoreBoostUntil: 0,
        doubleScoreUntil: 0,
        warriorUntil: 0
    };
}

function checkWinner() {
    const livingBases = Object.values(bases).filter(base => base.isAlive);

    if (livingBases.length > 1 || gameEnding) {
        return;
    }

    gameEnding = true;
    gameStarted = false;

    const winner = livingBases[0];

    io.emit('gameOverEvent', {
        msg: winner
            ? `🏆 ${winner.name} เป็นปราสาทสุดท้ายที่เหลืออยู่!`
            : '⚔️ ทุกปราสาทถูกทำลาย ไม่มีทีมชนะ'
    });

    setTimeout(resetMatch, 5500);
}

refillWorld();

io.on('connection', socket => {
    activePlayers[socket.id] = {
        socketId: socket.id,
        playerId: createId('PLY_'),
        name: '',
        playerClass: 'Warrior',
        outfitColor: '#9b59b6',
        team: 'red',
        isHost: false,
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        baseDamage: 0,
        isMoving: false,
        loggedIn: false,
        inventory: [],
        pendingMystery: null,
        effects: createEffects(),
        lastMoveTime: Date.now(),
        lastSkillTime: 0,
        lastAttackTime: 0
    };

    socket.emit('initGame', {
        id: socket.id,
        tiles,
        mysteryBoxes,
        mapSize: MAP_SIZE,
        ...basesPayload(),
        teamCounts: getTeamCounts(),
        settings: gameSettings,
        gameStarted
    });

    socket.on('joinGame', rawData => {
        const data = rawData && typeof rawData === 'object'
            ? rawData
            : {};

        const player = activePlayers[socket.id];

        if (!player || player.loggedIn) return;

        const wantsHost = data.hostPassword !== undefined;

        if (wantsHost) {
            if (
                typeof data.hostPassword !== 'string' ||
                data.hostPassword !== HOST_PASSWORD
            ) {
                socket.emit('joinResult', {
                    success: false,
                    msg: '❌ รหัสผ่าน Host ไม่ถูกต้อง'
                });
                return;
            }

            player.name = 'Host';
            player.playerClass = 'Warrior';
            player.outfitColor = '#f1c40f';
            player.team = 'host';
            player.isHost = true;
            player.loggedIn = true;

            socket.emit('joinResult', {
                success: true,
                team: 'host',
                isHost: true,
                gameStarted
            });

            emitRoomStatus();
            emitLeaderboard();
            return;
        }

        let requestedTeam = String(data.team || 'red');

        if (!VALID_TEAMS.has(requestedTeam)) {
            requestedTeam = 'red';
        }

        const teamCounts = getTeamCounts();

        if (teamCounts[requestedTeam] >= MAX_TEAM_PLAYERS) {
            socket.emit('joinResult', {
                success: false,
                msg: `❌ ทีมนี้เต็มแล้ว จำกัด ${MAX_TEAM_PLAYERS} คน`
            });
            return;
        }

        const playerClass = VALID_CLASSES.has(data.playerClass)
            ? data.playerClass
            : 'Warrior';

        player.name = sanitizeName(data.name);
        player.playerClass = playerClass;
        player.outfitColor = sanitizeColor(data.outfitColor);
        player.team = requestedTeam;
        player.isHost = false;
        player.loggedIn = true;
        player.x = TEAM_SPAWNS[requestedTeam].x;
        player.y = TEAM_SPAWNS[requestedTeam].y;
        player.lastMoveTime = Date.now();

        socket.emit('joinResult', {
            success: true,
            team: requestedTeam,
            isHost: false,
            gameStarted
        });

        emitRoomStatus();
        emitLeaderboard();
    });

    socket.on('forceStartGame', () => {
        const player = activePlayers[socket.id];

        if (!player?.loggedIn || !player.isHost || gameStarted) return;

        if (getPlayerCount() < 1) {
            socket.emit('skillResult', {
                success: false,
                msg: '❌ ต้องมีผู้เล่นอย่างน้อย 1 คน'
            });
            return;
        }

        gameStarted = true;
        gameEnding = false;

        io.emit('gameStartedEvent', {
            msg: '🚀 Host สั่งเริ่มศึก 4 ปราสาทแล้ว!'
        });

        emitRoomStatus();
    });

    socket.on('updateGameSettings', newSettings => {
        const player = activePlayers[socket.id];

        if (!player?.loggedIn || !player.isHost) return;

        if (gameStarted) {
            socket.emit('skillResult', {
                success: false,
                msg: '❌ ไม่สามารถเปลี่ยนค่าระหว่างการแข่งขัน'
            });
            return;
        }

        const baseMaxHp = clamp(
            Number.parseInt(newSettings?.baseMaxHp, 10) || 3000,
            500,
            50000
        );

        const scoreMultiplier = clamp(
            Number.parseInt(newSettings?.scoreMultiplier, 10) || 15,
            1,
            100
        );

        gameSettings.baseMaxHp = baseMaxHp;
        gameSettings.scoreMultiplier = scoreMultiplier;
        bases = createBases();

        io.emit('settingsUpdated', {
            settings: gameSettings,
            ...basesPayload()
        });

        io.emit('basesUpdate', basesPayload());

        socket.emit('skillResult', {
            success: true,
            msg: '⚙️ บันทึกการตั้งค่าแล้ว'
        });
    });

    socket.on('move', data => {
        const player = activePlayers[socket.id];

        if (
            !gameStarted ||
            !player?.loggedIn ||
            player.isHost ||
            !isFiniteNumber(data?.x) ||
            !isFiniteNumber(data?.y)
        ) {
            return;
        }

        const now = Date.now();
        removeExpiredEffects(player, now);

        const elapsedSeconds = clamp(
            (now - player.lastMoveTime) / 1000,
            0.001,
            0.25
        );

        player.lastMoveTime = now;

        const requestedX = clamp(data.x, 50, MAP_SIZE - 50);
        const requestedY = clamp(data.y, 50, MAP_SIZE - 50);

        const deltaX = requestedX - player.x;
        const deltaY = requestedY - player.y;
        const distance = Math.hypot(deltaX, deltaY);

        const allowedDistance =
            getMovementSpeed(player, now) * elapsedSeconds + 3;

        if (distance > 0) {
            const ratio = Math.min(1, allowedDistance / distance);

            player.x = clamp(
                player.x + deltaX * ratio,
                50,
                MAP_SIZE - 50
            );

            player.y = clamp(
                player.y + deltaY * ratio,
                50,
                MAP_SIZE - 50
            );
        }

        player.isMoving =
            Boolean(data.isMoving) && distance > 0.1;

        collectNearbyObjects(socket, player);
    });

    socket.on('dropTile', tileData => {
        const player = activePlayers[socket.id];

        if (
            !gameStarted ||
            !player?.loggedIn ||
            player.isHost ||
            typeof tileData?.id !== 'string'
        ) {
            return;
        }

        const index = player.inventory.findIndex(
            tile => tile.id === tileData.id
        );

        if (index === -1) {
            socket.emit('skillResult', {
                success: false,
                msg: '❌ ไม่พบเบี้ยนี้ในกระเป๋า'
            });
            return;
        }

        const inventoryTile = player.inventory.splice(index, 1)[0];

        const droppedTile = {
            ...inventoryTile,
            id: createId('TILE_'),
            x: clamp(
                player.x + (Math.random() - 0.5) * 50,
                50,
                MAP_SIZE - 50
            ),
            y: clamp(
                player.y + (Math.random() - 0.5) * 50,
                50,
                MAP_SIZE - 50
            )
        };

        tiles.push(droppedTile);
        io.emit('newTile', droppedTile);
    });

    socket.on('submitEquation', submittedTiles => {
        const player = activePlayers[socket.id];

        if (!gameStarted || !player?.loggedIn || player.isHost) return;

        try {
            const validation = validateEquation(
                player,
                submittedTiles
            );

            let earnedScore = calculateAMathScore(
                validation.tiles
            );

            const now = Date.now();

            if (player.effects.doubleScoreUntil > now) {
                earnedScore *= 2;
                player.effects.doubleScoreUntil = 0;
            } else if (player.effects.scoreBoostUntil > now) {
                earnedScore = Math.round(earnedScore * 1.3);
            }

            player.inventory = player.inventory.filter(
                tile => !validation.ids.has(tile.id)
            );

            player.score += earnedScore;

            socket.emit('equationResult', {
                success: true,
                score: player.score,
                earnedScore
            });

            emitLeaderboard();
        } catch (error) {
            socket.emit('equationResult', {
                success: false,
                msg: error.message || 'สมการไม่ถูกต้อง'
            });
        }
    });

    socket.on('submitMysteryAnswer', data => {
        const player = activePlayers[socket.id];

        if (!gameStarted || !player?.loggedIn || player.isHost) return;

        const pending = player.pendingMystery;
        player.pendingMystery = null;

        if (!pending || pending.expiresAt < Date.now()) {
            socket.emit('mysteryResult', {
                success: false,
                msg: 'หมดเวลาตอบคำถาม'
            });
            return;
        }

        const answer = Number(data?.userAns);

        if (
            Number.isFinite(answer) &&
            answer === pending.answer
        ) {
            player.score += 60;

            socket.emit('mysteryResult', {
                success: true,
                earnedScore: 60
            });

            emitLeaderboard();
        } else {
            socket.emit('mysteryResult', {
                success: false
            });
        }
    });

    socket.on('attackBase', targetTeam => {
        const player = activePlayers[socket.id];

        if (!gameStarted || !player?.loggedIn || player.isHost) return;
        if (!VALID_TEAMS.has(targetTeam)) return;

        const now = Date.now();

        if (now - player.lastAttackTime < 600) {
            return;
        }

        player.lastAttackTime = now;

        const targetBase = bases[targetTeam];

        if (targetTeam === player.team) {
            socket.emit('skillResult', {
                success: false,
                msg: '❌ ไม่สามารถโจมตีฐานทีมตัวเอง'
            });
            return;
        }

        if (!targetBase.isAlive) {
            socket.emit('skillResult', {
                success: false,
                msg: '🏰 ฐานนี้ถูกทำลายแล้ว'
            });
            return;
        }

        const distance = Math.hypot(
            player.x - targetBase.x,
            player.y - targetBase.y
        );

        if (distance > 450) {
            socket.emit('skillResult', {
                success: false,
                msg: '❌ ต้องอยู่ใกล้ฐานไม่เกินระยะ 450'
            });
            return;
        }

        const scoreCost = 50;

        if (player.score < scoreCost) {
            socket.emit('skillResult', {
                success: false,
                msg: `❌ ต้องการอย่างน้อย ${scoreCost} คะแนน`
            });
            return;
        }

        player.score -= scoreCost;

        let damage = 150;

        if (player.effects.warriorUntil > now) {
            damage += 200;
            player.effects.warriorUntil = 0;
        }

        damage = Math.min(damage, targetBase.hp);
        targetBase.hp -= damage;
        player.baseDamage += damage;

        if (targetBase.hp <= 0) {
            targetBase.hp = 0;
            targetBase.isAlive = false;

            io.emit('skillResult', {
                success: true,
                msg: `💥 ${targetBase.name} ถูกทำลายแล้ว!`
            });
        } else {
            socket.emit('skillResult', {
                success: true,
                msg: `🔥 สร้างความเสียหาย ${damage} HP`
            });
        }

        io.emit('basesUpdate', basesPayload());
        emitLeaderboard();
        checkWinner();
    });

    socket.on('castSkill', () => {
        const player = activePlayers[socket.id];

        if (!gameStarted || !player?.loggedIn || player.isHost) return;

        const now = Date.now();
        const cooldown = CLASS_COOLDOWNS[player.playerClass] || 5000;
        const remaining = cooldown - (now - player.lastSkillTime);

        if (remaining > 0) {
            socket.emit('skillResult', {
                success: false,
                msg: `⏳ รอคูลดาวน์อีก ${Math.ceil(remaining / 1000)} วินาที`
            });
            return;
        }

        if (
            player.playerClass === 'Berserker' &&
            player.score < 20
        ) {
            socket.emit('skillResult', {
                success: false,
                msg: '❌ ต้องมีอย่างน้อย 20 คะแนน'
            });
            return;
        }

        player.lastSkillTime = now;
        let message = '';

        switch (player.playerClass) {
            case 'Assassin':
                player.effects.speedBoostUntil = now + 3000;
                socket.emit('applyBuff', {
                    type: 'speedBoost',
                    duration: 3000
                });
                message = '⚡ Dash เพิ่มความเร็ว 3 วินาที!';
                break;

            case 'Warrior':
                player.effects.warriorUntil = now + 5000;
                socket.emit('applyBuff', {
                    type: 'berserkDmg',
                    duration: 5000
                });
                message = '⚔️ การโจมตีฐานถัดไปเพิ่ม 200 ดาเมจ!';
                break;

            case 'Tank': {
                const ownBase = bases[player.team];

                if (!ownBase?.isAlive) {
                    player.lastSkillTime = 0;
                    socket.emit('skillResult', {
                        success: false,
                        msg: '❌ ฐานถูกทำลายแล้ว ไม่สามารถซ่อมได้'
                    });
                    return;
                }

                const healed = Math.min(
                    150,
                    ownBase.maxHp - ownBase.hp
                );

                ownBase.hp += healed;
                io.emit('basesUpdate', basesPayload());
                message = `🛡️ ซ่อมฐานสำเร็จ +${healed} HP`;
                break;
            }

            case 'Archer': {
                let affected = 0;

                for (const [id, target] of Object.entries(activePlayers)) {
                    if (
                        id === socket.id ||
                        !target.loggedIn ||
                        target.isHost ||
                        target.team === player.team
                    ) {
                        continue;
                    }

                    const distance = Math.hypot(
                        player.x - target.x,
                        player.y - target.y
                    );

                    if (distance > 350) continue;
                    if (target.effects.cleanseUntil > now) continue;

                    target.effects.slowUntil = now + 3000;
                    affected++;

                    io.to(id).emit('trolledEffect', {
                        type: 'slow',
                        duration: 3000,
                        msg: `🏹 ถูก ${player.name} ยิงสโลว์!`
                    });
                }

                message = `🏹 ยิงสโลว์โดนศัตรู ${affected} คน`;
                break;
            }

            case 'Mage': {
                let pulledCount = 0;

                for (const tile of tiles) {
                    if (
                        Math.hypot(
                            player.x - tile.x,
                            player.y - tile.y
                        ) <= 300
                    ) {
                        tile.x = clamp(
                            player.x + (Math.random() - 0.5) * 70,
                            50,
                            MAP_SIZE - 50
                        );

                        tile.y = clamp(
                            player.y + (Math.random() - 0.5) * 70,
                            50,
                            MAP_SIZE - 50
                        );

                        pulledCount++;
                    }
                }

                message = `🔮 ดูดเบี้ยเข้ามา ${pulledCount} ชิ้น`;
                break;
            }

            case 'Support':
                player.effects.scoreBoostUntil = now + 5000;
                socket.emit('applyBuff', {
                    type: 'scoreBoost',
                    duration: 5000
                });
                message = '✨ คะแนนสมการเพิ่ม 30% เป็นเวลา 5 วินาที!';
                break;

            case 'Monk':
                player.effects.slowUntil = 0;
                player.effects.cleanseUntil = now + 3000;
                socket.emit('applyBuff', {
                    type: 'cleanse',
                    duration: 3000
                });
                message = '🥋 ล้างดีบัฟและต้านสถานะ 3 วินาที!';
                break;

            case 'Berserker':
                player.score -= 20;
                player.effects.doubleScoreUntil = now + 5000;
                socket.emit('applyBuff', {
                    type: 'doubleScore',
                    duration: 5000
                });
                message = '🔥 สมการถัดไปได้คะแนนคูณสอง!';
                break;
        }

        io.emit('playerCastSkill', {
            socketId: socket.id,
            x: player.x,
            y: player.y,
            playerClass: player.playerClass,
            team: player.team
        });

        socket.emit('skillResult', {
            success: true,
            msg: message
        });

        emitLeaderboard();
    });

    socket.on('disconnect', () => {
        delete activePlayers[socket.id];
        emitRoomStatus();
        emitLeaderboard();
    });
});

setInterval(() => {
    io.emit('stateUpdate', {
        players: publicPlayers(),
        ...basesPayload()
    });
}, 1000 / 20);

server.listen(PORT, () => {
    console.log(`Math.io server running on port ${PORT}`);
});
