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

let gameSettings = {
    bossMaxHp: 5000,
    bossSpeed: 1.8,
    scoreMultiplier: 15,
    bossPenalty: 20
};

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

let demonBoss = {
    x: MAP_SIZE / 2,
    y: MAP_SIZE / 2,
    targetX: MAP_SIZE / 2,
    targetY: MAP_SIZE / 2,
    hp: 5000,
    maxHp: 5000,
    name: 'Demon Goat Lord',
    isAlive: true,
    slowedUntil: 0,
    poisonedUntil: 0
};

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
        x: Math.random() * (MAP_SIZE - 200) + 100,
        y: Math.random() * (MAP_SIZE - 200) + 100,
        char: char,
        type: type
    });
}

function spawnMysteryBox() {
    mysteryBoxes.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * (MAP_SIZE - 200) + 100,
        y: Math.random() * (MAP_SIZE - 200) + 100
    });
}

io.on('connection', (socket) => {
    activePlayers[socket.id] = {
        socketId: socket.id,
        playerId: 'PLY_' + Math.random().toString(36).substr(2, 9),
        name: '',
        playerClass: 'Warrior',
        outfitColor: '#9b59b6',
        team: 'red',
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        bossDamage: 0,
        isMoving: false,
        loggedIn: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE, boss: demonBoss, settings: gameSettings });

    // 🚀 เข้าเกมทันทีโดยไม่ต้องสมัครสมาชิก
    socket.on('joinGame', (data) => {
        let name = data.name ? data.name.trim() : 'Player';
        if (name.length === 0) name = 'Player';

        // จัดสมดุลทีม Red / Blue
        let redCount = 0, blueCount = 0;
        for (let id in activePlayers) {
            if (activePlayers[id].loggedIn) {
                if (activePlayers[id].team === 'red') redCount++;
                else blueCount++;
            }
        }
        let assignedTeam = redCount <= blueCount ? 'red' : 'blue';

        let p = activePlayers[socket.id];
        p.name = name;
        p.playerClass = data.playerClass || 'Warrior';
        p.outfitColor = data.outfitColor || '#9b59b6';
        p.team = assignedTeam;
        p.loggedIn = true;
        p.x = MAP_SIZE / 2 + (Math.random() - 0.5) * 300;
        p.y = MAP_SIZE / 2 + (Math.random() - 0.5) * 300;

        let totalIngame = Object.values(activePlayers).filter(pl => pl.loggedIn).length;
        io.emit('roomStatus', { count: totalIngame, required: 20 });
        socket.emit('joinResult', { success: true, team: assignedTeam });
        io.emit('updateLeaderboard', activePlayers);
    });

    socket.on('attackBoss', () => {
        let p = activePlayers[socket.id];
        let totalIngame = Object.values(activePlayers).filter(pl => pl.loggedIn).length;
        
        if (totalIngame < 20) {
            socket.emit('skillResult', { success: false, msg: `⏳ รอผู้เล่นเข้าห้องครบ 20 คน (${totalIngame}/20)` });
            return;
        }

        if (!p || !p.loggedIn || !demonBoss.isAlive) return;

        let dist = Math.hypot(p.x - demonBoss.x, p.y - demonBoss.y);
        if (dist > 350) { socket.emit('skillResult', { success: false, msg: '❌ อยู่ไกลจากบอสเกินไป' }); return; }

        let scoreCost = 50;
        if (p.score < scoreCost) { socket.emit('skillResult', { success: false, msg: `❌ คะแนนไม่พอ (ต้องการ ${scoreCost} แต้ม)` }); return; }

        p.score -= scoreCost;
        let damage = 150;
        demonBoss.hp -= damage;
        p.bossDamage = (p.bossDamage || 0) + damage;

        if (demonBoss.hp <= 0) {
            demonBoss.hp = 0;
            demonBoss.isAlive = false;
            io.emit('bossDefeated', { msg: `🎉 แพะปีศาจถูกกำจัดแล้ว!` });
            setTimeout(() => {
                demonBoss.hp = demonBoss.maxHp;
                demonBoss.isAlive = true;
                io.emit('bossRespawn', { msg: `⚠️ แพะปีศาจฟื้นคืนชีพ!` });
            }, 30000);
        }

        io.emit('bossUpdate', demonBoss);
        io.emit('updateLeaderboard', activePlayers);
        socket.emit('skillResult', { success: true, msg: `🔥 ทำดาเมจใส่บอส ${damage} แต้ม!` });
    });

    socket.on('castSkill', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn) return;

        let now = Date.now();
        if (p.lastSkillTime && now - p.lastSkillTime < 4500) { socket.emit('skillResult', { success: false, msg: '⏳ สกิล Cool Down' }); return; }
        p.lastSkillTime = now;

        let affectedCount = 0;
        for (let id in activePlayers) {
            if (id !== socket.id) {
                let target = activePlayers[id];
                if (target.team !== p.team && target.loggedIn) {
                    let dist = Math.hypot(p.x - target.x, p.y - target.y);
                    if (dist < 300) {
                        affectedCount++;
                        io.to(id).emit('trolledEffect', { type: 'blind', msg: `🌑 โดนสกิลป่วนจากทีมตรงข้าม (${p.name})!` });
                    }
                }
            }
        }
        socket.emit('skillResult', { success: true, msg: affectedCount > 0 ? `✨ ป่วนทีมตรงข้ามสำเร็จ ${affectedCount} คน!` : `✨ ร่ายสกิลสำเร็จ!` });
    });

    socket.on('move', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn) return;

        p.x = Math.max(50, Math.min(MAP_SIZE - 50, data.x));
        p.y = Math.max(50, Math.min(MAP_SIZE - 50, data.y));
        p.isMoving = data.isMoving;

        for (let i = tiles.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - tiles[i].x, p.y - tiles[i].y) < 40) {
                let collected = tiles.splice(i, 1)[0];
                io.emit('tileRemoved', collected.id);
                socket.emit('tileCollected', collected);
                spawnTile();
                io.emit('newTile', tiles[tiles.length - 1]);
            }
        }

        for (let i = mysteryBoxes.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - mysteryBoxes[i].x, p.y - mysteryBoxes[i].y) < 40) {
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
        if (!p || !p.loggedIn) return;
        let dropped = { id: Math.random().toString(36).substr(2, 9), x: p.x + (Math.random() - 0.5) * 30, y: p.y + (Math.random() - 0.5) * 30, char: tileData.char, type: tileData.type };
        tiles.push(dropped);
        io.emit('newTile', dropped);
    });

    socket.on('submitEquation', (eqStr) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn) return;
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
        if (p && p.loggedIn && parseInt(data.userAns) === parseInt(data.correctAns)) {
            p.score += 60;
            socket.emit('mysteryResult', { success: true });
            io.emit('updateLeaderboard', activePlayers);
        } else {
            socket.emit('mysteryResult', { success: false });
        }
    });

    socket.on('disconnect', () => {
        delete activePlayers[socket.id];
        let totalIngame = Object.values(activePlayers).filter(pl => pl.loggedIn).length;
        io.emit('roomStatus', { count: totalIngame, required: 20 });
        io.emit('updateLeaderboard', activePlayers);
    });
});

setInterval(() => {
    if (demonBoss.isAlive) {
        let speed = (demonBoss.slowedUntil && Date.now() < demonBoss.slowedUntil) ? gameSettings.bossSpeed * 0.4 : gameSettings.bossSpeed;
        let dx = demonBoss.targetX - demonBoss.x, dy = demonBoss.targetY - demonBoss.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 15) {
            demonBoss.targetX = MAP_SIZE/2 + (Math.random() - 0.5) * 800;
            demonBoss.targetY = MAP_SIZE/2 + (Math.random() - 0.5) * 800;
        } else if (dist > 0) {
            demonBoss.x += (dx / dist) * speed;
            demonBoss.y += (dy / dist) * speed;
        }
    }
}, 50);

setInterval(() => {
    io.emit('stateUpdate', { players: activePlayers, boss: demonBoss });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
