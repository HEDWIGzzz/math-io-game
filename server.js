const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'database.json');

function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Database load error:', e);
    }
    return {};
}

function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Database save error:', e);
    }
}

let playersDb = loadDatabase();
const activePlayers = {};
const tiles = [];
const mysteryBoxes = [];
const MAP_SIZE = 4000;

// ⚙️ ตั้งค่าระบบเกม (Admin Configurable)
let gameSettings = {
    bossMaxHp: 5000,
    bossSpeed: 1.8,
    scoreMultiplier: 15,
    bossPenalty: 20
};

// 📐 พจนานุกรมคะแนนอิงตามเบี้ย A-Math ของโด้
const AMATH_SCORES = {
    "0": 1, "1": 1, "2": 1, "3": 1,
    "4": 2, "5": 2, "6": 2, "7": 2, "8": 2, "9": 2,
    "10": 3, "11": 4, "12": 3, "13": 6, "14": 4,
    "15": 4, "16": 4, "17": 6, "18": 4, "19": 7, "20": 5,
    "+": 2, "-": 2, "+/-": 1, "×": 2, "÷": 2, "×/÷": 1, "=": 1, "BLANK": 0
};

// 📐 ฟังก์ชันคำนวณคะแนนตามตาราง AMATH_SCORES (รองรับตัวเลข 2 หลักและเครื่องหมาย)
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

// 🐐 ข้อมูลบอสแพะปีศาจ
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
    const types = [
        { char: Math.floor(Math.random() * 10).toString(), t: 'num' },
        { char: '+', t: 'op' }, { char: '-', t: 'op' }, { char: '*', t: 'op' }, { char: '/', t: 'op' },
        { char: '=', t: 'eq' }
    ];
    let rand = Math.random();
    let selected = (rand < 0.65) ? types[0] : (rand < 0.9 ? types[Math.floor(Math.random() * 4) + 1] : types[5]);

    tiles.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * (MAP_SIZE - 200) + 100,
        y: Math.random() * (MAP_SIZE - 200) + 100,
        char: selected.char,
        type: selected.t
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
    console.log('Student/Player connected:', socket.id);

    activePlayers[socket.id] = {
        socketId: socket.id,
        playerId: 'PLY_' + Math.random().toString(36).substr(2, 9),
        name: '',
        playerClass: 'Warrior',
        outfitColor: '#9b59b6',
        hat: 'none',
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        isMoving: false,
        inLobby: true,
        loggedIn: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE, boss: demonBoss, settings: gameSettings });

    socket.on('registerPlayer', async (data) => {
        try {
            let name = data.name ? data.name.trim() : '';
            let password = data.password ? data.password.trim() : '';
            let confirmPassword = data.confirmPassword ? data.confirmPassword.trim() : '';

            if (!name || !password || !confirmPassword) {
                socket.emit('authResult', { success: false, msg: 'กรุณากรอกข้อมูลให้ครบ' });
                return;
            }
            if (name.length < 3 || name.length > 15) {
                socket.emit('authResult', { success: false, msg: 'ชื่อผู้เล่นต้องมีความยาว 3-15 ตัวอักษร' });
                return;
            }
            if (password.length < 6) {
                socket.emit('authResult', { success: false, msg: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
                return;
            }
            if (password !== confirmPassword) {
                socket.emit('authResult', { success: false, msg: 'รหัสผ่านไม่ตรงกัน' });
                return;
            }
            if (playersDb[name]) {
                socket.emit('authResult', { success: false, msg: 'ชื่อนี้ถูกใช้งานแล้ว' });
                return;
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const newPlayerId = 'PLY_' + Math.random().toString(36).substr(2, 9);

            playersDb[name] = {
                playerId: newPlayerId,
                password: hashedPassword,
                score: 0,
                playerClass: 'Warrior',
                outfitColor: '#9b59b6',
                hat: 'none'
            };
            saveDatabase(playersDb);

            activePlayers[socket.id].name = name;
            activePlayers[socket.id].playerId = newPlayerId;

            socket.emit('authResult', { success: true, action: 'register', msg: 'ACCOUNT CREATED!' });
        } catch (e) {
            socket.emit('authResult', { success: false, msg: 'เกิดข้อผิดพลาดในระบบ' });
        }
    });

    socket.on('loginPlayer', async (data) => {
        try {
            let name = data.name ? data.name.trim() : '';
            let password = data.password ? data.password.trim() : '';

            if (!name || !password) {
                socket.emit('authResult', { success: false, msg: 'กรุณากรอกข้อมูลให้ครบ' });
                return;
            }
            if (!playersDb[name]) {
                socket.emit('authResult', { success: false, msg: 'ไม่พบชื่อผู้ใช้นี้' });
                return;
            }

            const isMatch = await bcrypt.compare(password, playersDb[name].password);
            if (!isMatch) {
                socket.emit('authResult', { success: false, msg: 'รหัสผ่านไม่ถูกต้อง' });
                return;
            }

            let pData = playersDb[name];
            activePlayers[socket.id].name = name;
            activePlayers[socket.id].playerId = pData.playerId;
            activePlayers[socket.id].score = pData.score || 0;
            activePlayers[socket.id].playerClass = pData.playerClass || 'Warrior';
            activePlayers[socket.id].outfitColor = pData.outfitColor || '#9b59b6';
            activePlayers[socket.id].hat = pData.hat || 'none';

            socket.emit('authResult', { success: true, action: 'login', playerData: pData });
        } catch (e) {
            socket.emit('authResult', { success: false, msg: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
        }
    });

    socket.on('saveCharacter', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.name) return;

        p.playerClass = data.playerClass || 'Warrior';
        p.outfitColor = data.outfitColor || '#9b59b6';
        p.hat = data.hat || 'none';

        if (playersDb[p.name]) {
            playersDb[p.name].playerClass = p.playerClass;
            playersDb[p.name].outfitColor = p.outfitColor;
            playersDb[p.name].hat = p.hat;
            saveDatabase(playersDb);
        }

        socket.emit('saveResult', { success: true, msg: 'CHARACTER SAVED!' });
    });

    socket.on('updateAdminSettings', (newSettings) => {
        let p = activePlayers[socket.id];
        if (!p || (p.name !== 'admin' && p.name !== 'Do')) {
            socket.emit('skillResult', { success: false, msg: '❌ ไม่มีสิทธิ์ใช้งานระบบ Admin!' });
            return;
        }

        gameSettings.bossMaxHp = parseInt(newSettings.bossMaxHp) || 5000;
        gameSettings.bossSpeed = parseFloat(newSettings.bossSpeed) || 1.8;
        gameSettings.scoreMultiplier = parseInt(newSettings.scoreMultiplier) || 15;
        gameSettings.bossPenalty = parseInt(newSettings.bossPenalty) || 20;

        if (demonBoss.hp >= demonBoss.maxHp) {
            demonBoss.maxHp = gameSettings.bossMaxHp;
            demonBoss.hp = gameSettings.bossMaxHp;
        } else {
            demonBoss.maxHp = gameSettings.bossMaxHp;
        }

        io.emit('settingsUpdated', { settings: gameSettings, boss: demonBoss });
        socket.emit('skillResult', { success: true, msg: '⚙️ บันทึกการตั้งค่า Admin สำเร็จ!' });
    });

    socket.on('enterGameLobby', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.name) return;
        p.loggedIn = true;
        p.inLobby = false;
        io.emit('updateLeaderboard', activePlayers);
    });

    socket.on('attackBoss', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.inLobby || !demonBoss.isAlive) return;

        let dist = Math.hypot(p.x - demonBoss.x, p.y - demonBoss.y);
        if (dist > 350) {
            socket.emit('skillResult', { success: false, msg: '❌ อยู่ไกลจากบอสเกินไป (เข้าใกล้รัศมี 350)' });
            return;
        }

        let scoreCost = 50;
        if (p.score < scoreCost) {
            socket.emit('skillResult', { success: false, msg: `❌ คะแนนไม่พอโจมตี (ต้องการ ${scoreCost} แต้ม)` });
            return;
        }

        p.score -= scoreCost;
        let damage = 150;
        demonBoss.hp -= damage;

        if (playersDb[p.name]) {
            playersDb[p.name].score = p.score;
            saveDatabase(playersDb);
        }

        if (demonBoss.hp <= 0) {
            demonBoss.hp = 0;
            demonBoss.isAlive = false;
            io.emit('bossDefeated', { msg: `🎉 แพะปีศาจ ${demonBoss.name} ถูกกำจัดราบคาบ!` });
            
            setTimeout(() => {
                demonBoss.hp = demonBoss.maxHp;
                demonBoss.isAlive = true;
                io.emit('bossRespawn', { msg: `⚠️ แพะปีศาจฟื้นคืนชีพแล้ว!` });
            }, 30000);
        }

        io.emit('bossUpdate', demonBoss);
        io.emit('updateLeaderboard', activePlayers);
        socket.emit('skillResult', { success: true, msg: `🔥 ใช้ ${scoreCost} คะแนนโจมตีบอส สร้างดาเมจ ${damage} แต้ม!` });
    });

    socket.on('castSkill', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.inLobby) return;

        let now = Date.now();
        if (p.lastSkillTime && now - p.lastSkillTime < 4500) {
            socket.emit('skillResult', { success: false, msg: '⏳ สกิลกำลัง Cool Down' });
            return;
        }
        p.lastSkillTime = now;

        let pClass = p.playerClass;
        let distToBoss = Math.hypot(p.x - demonBoss.x, p.y - demonBoss.y);
        let bossHit = false;

        if (distToBoss < 280 && demonBoss.isAlive) {
            bossHit = true;
            if (pClass === 'Mage' || pClass === 'Support') {
                demonBoss.slowedUntil = Date.now() + 5000;
                io.emit('bossDebuff', { type: 'slow', msg: `🔮 [${p.name}] ร่ายเวทแช่แข็งใส่แพะปีศาจ!` });
            } else if (pClass === 'Assassin' || pClass === 'Archer') {
                demonBoss.poisonedUntil = Date.now() + 6000;
                io.emit('bossDebuff', { type: 'poison', msg: `🧪 [${p.name}] ปล่อยพิษใส่แพะปีศาจ!` });
            } else {
                demonBoss.slowedUntil = Date.now() + 3000;
                io.emit('bossDebuff', { type: 'stun', msg: `⚔️ [${p.name}] โจมตีหนักใส่แพะปีศาจจนชะงัก!` });
            }
        }

        let affectedCount = 0;
        for (let id in activePlayers) {
            if (id !== socket.id) {
                let target = activePlayers[id];
                let dist = Math.hypot(p.x - target.x, p.y - target.y);
                if (dist < 280) {
                    affectedCount++;
                    io.to(id).emit('trolledEffect', { type: 'blind', msg: `🌑 โดนสกิลป่วนจาก [${pClass}] ${p.name}!` });
                }
            }
        }

        let resMsg = bossHit ? `✨ ใช้สกิล [${pClass}] โดนแพะปีศาจเต็มๆ!` : (affectedCount > 0 ? `✨ ใช้สกิลป่วนโดนเพื่อน ${affectedCount} คน!` : `✨ ร่ายสกิลสำเร็จ!`);
        socket.emit('skillResult', { success: true, msg: resMsg });
    });

    socket.on('move', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.inLobby) return;
        if (p.stunnedUntil && Date.now() < p.stunnedUntil) return;

        p.x = Math.max(50, Math.min(MAP_SIZE - 50, data.x));
        p.y = Math.max(50, Math.min(MAP_SIZE - 50, data.y));
        p.isMoving = data.isMoving;

        for (let i = tiles.length - 1; i >= 0; i--) {
            let dx = p.x - tiles[i].x;
            let dy = p.y - tiles[i].y;
            if (Math.hypot(dx, dy) < 40) {
                let collectedTile = tiles[i];
                tiles.splice(i, 1);
                io.emit('tileRemoved', collectedTile.id);
                socket.emit('tileCollected', collectedTile);
                spawnTile();
                io.emit('newTile', tiles[tiles.length - 1]);
            }
        }

        for (let i = mysteryBoxes.length - 1; i >= 0; i--) {
            let dx = p.x - mysteryBoxes[i].x;
            let dy = p.y - mysteryBoxes[i].y;
            if (Math.hypot(dx, dy) < 40) {
                let box = mysteryBoxes[i];
                mysteryBoxes.splice(i, 1);
                io.emit('mysteryBoxRemoved', box.id);
                
                let n1 = Math.floor(Math.random() * 20) + 1;
                let n2 = Math.floor(Math.random() * 20) + 1;
                let ops = ['+', '-', '*'];
                let op = ops[Math.floor(Math.random() * ops.length)];
                let ans = eval(`${n1} ${op} ${n2}`);
                
                socket.emit('openMysteryBox', { q: `${n1} ${op} ${n2} = ?`, ans: ans });
                spawnMysteryBox();
                io.emit('newMysteryBox', mysteryBoxes[mysteryBoxes.length - 1]);
            }
        }
    });

    socket.on('submitEquation', (eqStr) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.inLobby) return;
        try {
            let parts = eqStr.split('=');
            if (parts.length === 2 && parts[0] && parts[1]) {
                let left = eval(parts[0].replace(/\b0+(\d)/g, '$1'));
                let right = eval(parts[1].replace(/\b0+(\d)/g, '$1'));

                if (left === right) {
                    let earnedScore = calculateAMathScore(eqStr);
                    p.score += earnedScore;
                    if (playersDb[p.name]) {
                        playersDb[p.name].score = p.score;
                        saveDatabase(playersDb);
                    }

                    socket.emit('equationResult', { success: true, score: p.score });
                    io.emit('updateLeaderboard', activePlayers);
                } else {
                    socket.emit('equationResult', { success: false, msg: "สมการไม่ถูกต้อง" });
                }
            } else {
                socket.emit('equationResult', { success: false, msg: "รูปแบบสมการต้องมีเครื่องหมาย =" });
            }
        } catch (e) {
            socket.emit('equationResult', { success: false, msg: "โครงสร้างทางคณิตศาสตร์ผิดพลาด" });
        }
    });

    socket.on('submitMysteryAnswer', (data) => {
        let p = activePlayers[socket.id];
        if (p && p.loggedIn && !p.inLobby) {
            if (parseInt(data.userAns) === parseInt(data.correctAns)) {
                p.score += 60;
                if (playersDb[p.name]) {
                    playersDb[p.name].score = p.score;
                    saveDatabase(playersDb);
                }
                socket.emit('mysteryResult', { success: true });
                io.emit('updateLeaderboard', activePlayers);
            } else {
                socket.emit('mysteryResult', { success: false });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete activePlayers[socket.id];
        io.emit('updateLeaderboard', activePlayers);
    });
});

setInterval(() => {
    if (demonBoss.isAlive) {
        if (demonBoss.poisonedUntil && Date.now() < demonBoss.poisonedUntil) {
            demonBoss.hp -= 2;
            if (demonBoss.hp <= 0) {
                demonBoss.hp = 0;
                demonBoss.isAlive = false;
                io.emit('bossDefeated', { msg: `🎉 พิษสังหารแพะปีศาจจนสิ้นใจ!` });
                setTimeout(() => {
                    demonBoss.hp = demonBoss.maxHp;
                    demonBoss.isAlive = true;
                    io.emit('bossRespawn', { msg: `⚠️ แพะปีศาจฟื้นคืนชีพแล้ว!` });
                }, 30000);
            }
        }

        let currentSpeed = (demonBoss.slowedUntil && Date.now() < demonBoss.slowedUntil) ? (gameSettings.bossSpeed * 0.4) : gameSettings.bossSpeed;

        let dx = demonBoss.targetX - demonBoss.x;
        let dy = demonBoss.targetY - demonBoss.y;
        let dist = Math.hypot(dx, dy);

        if (dist < 15) {
            let center = MAP_SIZE / 2;
            demonBoss.targetX = center + (Math.random() - 0.5) * 800;
            demonBoss.targetY = center + (Math.random() - 0.5) * 800;
        } else {
            demonBoss.x += (dx / dist) * currentSpeed;
            demonBoss.y += (dy / dist) * currentSpeed;
        }

        for (let id in activePlayers) {
            let p = activePlayers[id];
            if (p.loggedIn && !p.inLobby) {
                let distToPlayer = Math.hypot(p.x - demonBoss.x, p.y - demonBoss.y);
                if (distToPlayer < 100) {
                    let now = Date.now();
                    if (!p.lastBossAttack || now - p.lastBossAttack > 1500) {
                        p.lastBossAttack = now;
                        let penalty = gameSettings.bossPenalty;
                        p.score = Math.max(0, p.score - penalty);
                        if (playersDb[p.name]) {
                            playersDb[p.name].score = p.score;
                            saveDatabase(playersDb);
                        }

                        let angle = Math.atan2(p.y - demonBoss.y, p.x - demonBoss.x);
                        p.x = Math.max(50, Math.min(MAP_SIZE - 50, p.x + Math.cos(angle) * 100));
                        p.y = Math.max(50, Math.min(MAP_SIZE - 50, p.y + Math.sin(angle) * 100));

                        io.to(id).emit('bossHitPlayer', { msg: `💥 โดนแพะปีศาจฟาดกระเด็น! เสีย ${penalty} คะแนน!` });
                    }
                }
            }
        }
    }
}, 50);

setInterval(() => {
    io.emit('stateUpdate', { players: activePlayers, boss: demonBoss });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
