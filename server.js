const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const activePlayers = {};
const tiles = [];
const mysteryBoxes = [];
const MAP_SIZE = 4000;
let globalGameStarted = false;

let gameSettings = {
    baseMaxHp: 3000,
    scoreMultiplier: 15
};

let redBase = { x: 800, y: 800, hp: 3000, maxHp: 3000, name: 'Red Fortress', team: 'red', isAlive: true };
let blueBase = { x: MAP_SIZE - 800, y: 800, hp: 3000, maxHp: 3000, name: 'Blue Fortress', team: 'blue', isAlive: true };
let greenBase = { x: 800, y: MAP_SIZE - 800, hp: 3000, maxHp: 3000, name: 'Green Fortress', team: 'green', isAlive: true };
let yellowBase = { x: MAP_SIZE - 800, y: MAP_SIZE - 800, hp: 3000, maxHp: 3000, name: 'Yellow Fortress', team: 'yellow', isAlive: true };

const AMATH_SCORES = {
    "0": 1, "1": 1, "2": 1, "3": 1,
    "4": 2, "5": 2, "6": 2, "7": 2, "8": 2, "9": 2,
    "10": 3, "11": 4, "12": 3, "13": 6, "14": 4,
    "15": 4, "16": 4, "17": 6, "18": 4, "19": 7, "20": 5,
    "+": 2, "-": 2, "+/-": 1, "×": 2, "÷": 2, "×/÷": 1, "=": 1, "BLANK": 0
};

function calculateAMathScore(eqStr) {
    let baseScore = 0;
    let i = 0;
    while (i < eqStr.length) {
        let char = eqStr[i];
        if (i + 1 < eqStr.length && !isNaN(char) && !isNaN(eqStr[i + 1])) {
            let twoDigit = char + eqStr[i + 1];
            if (AMATH_SCORES[twoDigit] !== undefined) {
                baseScore += AMATH_SCORES[twoDigit];
                i += 2;
                continue;
            }
        }
        let token = char;
        if (char === '*') token = '×';
        if (char === '/') token = '÷';
        if (AMATH_SCORES[token] !== undefined) {
            baseScore += AMATH_SCORES[token];
        } else if (!isNaN(char)) {
            baseScore += AMATH_SCORES[char] || 1;
        }
        i++;
    }
    let complexityMultiplier = (eqStr.includes('*') || eqStr.includes('/') || eqStr.includes('×') || eqStr.includes('÷')) ? 2 : 1;
    let finalScore = baseScore * complexityMultiplier * (gameSettings.scoreMultiplier || 15);
    return Math.max(10, finalScore);
}

for (let i = 0; i < 150; i++) spawnTile();
for (let i = 0; i < 35; i++) spawnMysteryBox();

function spawnTile() {
    let randType = Math.random();
    let char, type;
    if (randType < 0.65) {
        let numRand = Math.random();
        char = numRand < 0.8 ? Math.floor(Math.random() * 10).toString() : Math.floor(Math.random() * 11 + 10).toString();
        type = 'num';
    } else if (randType < 0.9) {
        const ops = ['+', '-', '×', '÷'];
        char = ops[Math.floor(Math.random() * ops.length)];
        type = 'op';
    } else {
        char = '=';
        type = 'eq';
    }
    tiles.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * (MAP_SIZE - 400) + 200,
        y: Math.random() * (MAP_SIZE - 400) + 200,
        char: char,
        type: type
    });
}

function spawnMysteryBox() {
    mysteryBoxes.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * (MAP_SIZE - 400) + 200,
        y: Math.random() * (MAP_SIZE - 400) + 200
    });
}

function getTeamCounts() {
    let counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (let id in activePlayers) {
        let pl = activePlayers[id];
        if (pl.loggedIn && !pl.isHost && counts[pl.team] !== undefined) {
            counts[pl.team]++;
        }
    }
    return counts;
}

io.on('connection', (socket) => {
    activePlayers[socket.id] = {
        socketId: socket.id,
        playerId: 'PLY_' + Math.random().toString(36).substr(2, 9),
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
        loggedIn: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE, redBase, blueBase, greenBase, yellowBase, teamCounts: getTeamCounts(), settings: gameSettings, gameStarted: globalGameStarted });

    socket.on('joinGame', (data) => {
        let name = data.name ? data.name.trim() : 'Player';
        if (name.length === 0) name = 'Player';

        let isHostUser = (data.hostPassword === '007007' || name.toLowerCase() === 'do' || name === 'โด้');

        if (isHostUser) {
            let p = activePlayers[socket.id];
            p.name = 'Host (โด้)';
            p.playerClass = data.playerClass || 'Warrior';
            p.outfitColor = data.outfitColor || '#f1c40f';
            p.team = 'host';
            p.isHost = true;
            p.loggedIn = true;
            p.x = MAP_SIZE / 2;
            p.y = MAP_SIZE / 2;

            let totalIngame = Object.values(activePlayers).filter(pl => pl.loggedIn && !pl.isHost).length;
            io.emit('roomStatus', { count: totalIngame, required: 40, gameStarted: globalGameStarted });
            io.emit('teamCountsUpdate', getTeamCounts());
            socket.emit('joinResult', { success: true, team: 'host', isHost: true, gameStarted: globalGameStarted });
            io.emit('updateLeaderboard', activePlayers);
            return;
        }

        let requestedTeam = data.team || 'red';
        if (!['red', 'blue', 'green', 'yellow'].includes(requestedTeam)) {
            requestedTeam = 'red';
        }

        let counts = getTeamCounts();
        if (counts[requestedTeam] >= 10) {
            socket.emit('joinResult', { success: false, msg: '❌ ทีมนี้เต็มแล้ว (จำกัด 10 คนต่อทีม)' });
            return;
        }

        let p = activePlayers[socket.id];
        p.name = name;
        p.playerClass = data.playerClass || 'Warrior';
        p.outfitColor = data.outfitColor || '#9b59b6';
        p.team = requestedTeam;
        p.isHost = false;
        p.loggedIn = true;

        if (requestedTeam === 'red') { p.x = 1200; p.y = 1200; }
        else if (requestedTeam === 'blue') { p.x = MAP_SIZE - 1200; p.y = 1200; }
        else if (requestedTeam === 'green') { p.x = 1200; p.y = MAP_SIZE - 1200; }
        else if (requestedTeam === 'yellow') { p.x = MAP_SIZE - 1200; p.y = MAP_SIZE - 1200; }

        let totalIngame = Object.values(activePlayers).filter(pl => pl.loggedIn && !pl.isHost).length;
        io.emit('roomStatus', { count: totalIngame, required: 40, gameStarted: globalGameStarted });
        io.emit('teamCountsUpdate', getTeamCounts());
        socket.emit('joinResult', { success: true, team: requestedTeam, isHost: false, gameStarted: globalGameStarted });
        io.emit('updateLeaderboard', activePlayers);
    });

    socket.on('forceStartGame', () => {
        let p = activePlayers[socket.id];
        if (p && p.isHost) {
            globalGameStarted = true;
            io.emit('gameStartedEvent', { msg: '🚀 โด้ (Host) สั่งเริ่มศึก 4 ปราสาทแล้ว!' });
        }
    });

    socket.on('updateGameSettings', (newSettings) => {
        let p = activePlayers[socket.id];
        if (p && p.isHost) {
            gameSettings.baseMaxHp = parseInt(newSettings.baseMaxHp) || 3000;
            gameSettings.scoreMultiplier = parseInt(newSettings.scoreMultiplier) || 15;

            redBase.maxHp = gameSettings.baseMaxHp;
            blueBase.maxHp = gameSettings.baseMaxHp;
            greenBase.maxHp = gameSettings.baseMaxHp;
            yellowBase.maxHp = gameSettings.baseMaxHp;

            if (redBase.hp > redBase.maxHp) redBase.hp = redBase.maxHp;
            if (blueBase.hp > blueBase.maxHp) blueBase.hp = blueBase.maxHp;
            if (greenBase.hp > greenBase.maxHp) greenBase.hp = greenBase.maxHp;
            if (yellowBase.hp > yellowBase.maxHp) yellowBase.hp = yellowBase.maxHp;

            io.emit('settingsUpdated', { settings: gameSettings, redBase, blueBase, greenBase, yellowBase });
            socket.emit('skillResult', { success: true, msg: '⚙️ บันทึกการตั้งค่าฐานสำเร็จ!' });
        }
    });

    socket.on('attackBase', (targetTeam) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.isHost) return;

        let basesMap = { red: redBase, blue: blueBase, green: greenBase, yellow: yellowBase };
        let targetBase = basesMap[targetTeam];

        if (!targetBase || targetBase.team === p.team) {
            socket.emit('skillResult', { success: false, msg: '❌ ไม่สามารถโจมตีฐานทีมตัวเองได้!' });
            return;
        }
        if (!targetBase.isAlive) {
            socket.emit('skillResult', { success: false, msg: '🏰 ฐานนี้ถูกทำลายไปแล้ว!' });
            return;
        }

        let dist = Math.hypot(p.x - targetBase.x, p.y - targetBase.y);
        if (dist > 450) {
            socket.emit('skillResult', { success: false, msg: '❌ อยู่ไกลจากฐานเป้าหมายเกินไป' });
            return;
        }

        let scoreCost = 50;
        if (p.score < scoreCost) {
            socket.emit('skillResult', { success: false, msg: `❌ คะแนนไม่พอ (ต้องการ ${scoreCost} แต้ม)` });
            return;
        }

        p.score -= scoreCost;
        let damage = 150;
        targetBase.hp -= damage;
        p.baseDamage = (p.baseDamage || 0) + damage;

        if (targetBase.hp <= 0) {
            targetBase.hp = 0;
            targetBase.isAlive = false;
            io.emit('gameOverEvent', { msg: `💥 ฐาน ${targetBase.name} ถูกถล่มราบคาบ!` });
        }

        io.emit('basesUpdate', { redBase, blueBase, greenBase, yellowBase });
        io.emit('updateLeaderboard', activePlayers);
        socket.emit('skillResult', { success: true, msg: `🔥 โจมตี ${targetBase.name} เสียหาย ${damage} แต้ม!` });
    });

    socket.on('castSkill', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.isHost) return;
        let now = Date.now();
        if (p.lastSkillTime && now - p.lastSkillTime < 5000) {
            socket.emit('skillResult', { success: false, msg: '⏳ สกิลกำลัง Cool Down (รอ 5 วิ)' });
            return;
        }
        p.lastSkillTime = now;
        let affectedCount = 0;
        for (let id in activePlayers) {
            if (id !== socket.id) {
                let target = activePlayers[id];
                if (target.team !== p.team && target.loggedIn && !target.isHost) {
                    let dist = Math.hypot(p.x - target.x, p.y - target.y);
                    if (dist < 350) {
                        affectedCount++;
                        io.to(id).emit('trolledEffect', { type: 'blind', msg: `⚡ โดนสกิลป่วนจาก ${p.name}!` });
                    }
                }
            }
        }
        io.emit('playerCastSkill', { socketId: socket.id, x: p.x, y: p.y, playerClass: p.playerClass, team: p.team });
        socket.emit('skillResult', { success: true, msg: affectedCount > 0 ? `✨ ใช้สกิลป่วนทีมอื่นสำเร็จ ${affectedCount} คน!` : `✨ ร่ายสกิลสำเร็จ!` });
    });

    socket.on('move', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.isHost) return;

        p.x = Math.max(50, Math.min(MAP_SIZE - 50, data.x));
        p.y = Math.max(50, Math.min(MAP_SIZE - 50, data.y));
        p.isMoving = data.isMoving;

        for (let i = tiles.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - tiles[i].x, p.y - tiles[i].y) < 45) {
                let collectedTile = tiles.splice(i, 1)[0];
                io.emit('tileRemoved', collectedTile.id);
                socket.emit('tileCollected', collectedTile);
                spawnTile();
                io.emit('newTile', tiles[tiles.length - 1]);
            }
        }

        for (let i = mysteryBoxes.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - mysteryBoxes[i].x, p.y - mysteryBoxes[i].y) < 45) {
                let box = mysteryBoxes.splice(i, 1)[0];
                io.emit('mysteryBoxRemoved', box.id);
                let n1 = Math.floor(Math.random() * 20) + 1, n2 = Math.floor(Math.random() * 20) + 1;
                let ops = ['+', '-', '*'], op = ops[Math.floor(Math.random() * ops.length)];
                let ans = eval(`${n1} ${op} ${n2}`);
                socket.emit('openMysteryBox', { q: `${n1} ${op === '*' ? '×' : op} ${n2} = ?`, ans: ans });
                spawnMysteryBox();
                io.emit('newMysteryBox', mysteryBoxes[mysteryBoxes.length - 1]);
            }
        }
    });

    socket.on('dropTile', (tileData) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.isHost) return;
        let dropped = { id: Math.random().toString(36).substr(2, 9), x: p.x + (Math.random() - 0.5) * 30, y: p.y + (Math.random() - 0.5) * 30, char: tileData.char, type: tileData.type };
        tiles.push(dropped);
        io.emit('newTile', dropped);
    });

    socket.on('submitEquation', (eqStr) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.isHost) return;
        try {
            let parts = eqStr.split('=');
            if (parts.length === 2 && parts[0] && parts[1]) {
                let cleanL = parts[0].replace(/×/g, '*').replace(/÷/g, '/');
                let cleanR = parts[1].replace(/×/g, '*').replace(/÷/g, '/');
                if (eval(cleanL) === eval(cleanR)) {
                    let earned = calculateAMathScore(eqStr);
                    p.score += earned;
                    socket.emit('equationResult', { success: true, score: p.score, earnedScore: earned });
                    io.emit('updateLeaderboard', activePlayers);
                } else {
                    socket.emit('equationResult', { success: false, msg: "สมการไม่ถูกต้อง" });
                }
            }
        } catch (e) {
            socket.emit('equationResult', { success: false, msg: "โครงสร้างทางคณิตศาสตร์ผิดพลาด" });
        }
    });

    socket.on('submitMysteryAnswer', (data) => {
        let p = activePlayers[socket.id];
        if (p && p.loggedIn && !p.isHost && parseInt(data.userAns) === parseInt(data.correctAns)) {
            p.score += 60;
            socket.emit('mysteryResult', { success: true });
            io.emit('updateLeaderboard', activePlayers);
        } else {
            socket.emit('mysteryResult', { success: false });
        }
    });

    socket.on('disconnect', () => {
        delete activePlayers[socket.id];
        let totalIngame = Object.values(activePlayers).filter(pl => pl.loggedIn && !pl.isHost).length;
        io.emit('roomStatus', { count: totalIngame, required: 40, gameStarted: globalGameStarted });
        io.emit('teamCountsUpdate', getTeamCounts());
        io.emit('updateLeaderboard', activePlayers);
    });
});

setInterval(() => {
    io.emit('stateUpdate', { players: activePlayers, redBase, blueBase, greenBase, yellowBase });
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
