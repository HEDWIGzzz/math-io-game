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
    if (fs.existsSync(DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let playersDb = loadDatabase();
const activePlayers = {};
const tiles = [];
const mysteryBoxes = [];
const MAP_SIZE = 4000;

// 👹 ข้อมูลบอสปีศาจประจำเซิร์ฟเวอร์
let demonBoss = {
    x: MAP_SIZE / 2,
    y: MAP_SIZE / 2 - 150,
    hp: 5000,
    maxHp: 5000,
    name: 'Demon Lord X',
    isAlive: true
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
    console.log('Player connected:', socket.id);

    activePlayers[socket.id] = {
        socketId: socket.id,
        playerId: 'PLY_' + Math.random().toString(36).substr(2, 9),
        name: '',
        playerClass: 'Warrior',
        outfitColor: '#9b59b6',
        hat: 'none',
        upgrades: { speedLevel: 1, damageLevel: 1, luckLevel: 1 },
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        isMoving: false,
        inLobby: true,
        loggedIn: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE, boss: demonBoss });

    socket.on('registerPlayer', async (data) => {
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
            hat: 'none',
            upgrades: { speedLevel: 1, damageLevel: 1, luckLevel: 1 },
            characterData: {}
        };
        saveDatabase(playersDb);

        activePlayers[socket.id].name = name;
        activePlayers[socket.id].playerId = newPlayerId;

        socket.emit('authResult', { success: true, action: 'register', msg: 'ACCOUNT CREATED!' });
    });

    socket.on('loginPlayer', async (data) => {
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
        activePlayers[socket.id].upgrades = pData.upgrades || { speedLevel: 1, damageLevel: 1, luckLevel: 1 };

        socket.emit('authResult', { success: true, action: 'login', playerData: pData });
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

    socket.on('enterGameLobby', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.name) return;
        p.loggedIn = true;
        p.inLobby = false;
        io.emit('updateLeaderboard', activePlayers);
    });

    // ⚔️ ระบบใช้คะแนนโจมตีบอสประจำเซิร์ฟเวอร์ (ใช้ 50 คะแนนต่อครั้ง)
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
            socket.emit('skillResult', { success: false, msg: `❌ คะแนนไม่พอโจมตี (ต้องการ ${scoreCost} แต้ม สะสมจากสมการก่อน!)` });
            return;
        }

        p.score -= scoreCost; // หักคะแนนผู้เล่นเพื่อใช้เป็นพลังงานโจมตี
        let damage = 80 * (p.upgrades.damageLevel || 1);
        demonBoss.hp -= damage;

        if (playersDb[p.name]) playersDb[p.name].score = p.score;
        saveDatabase(playersDb);

        if (demonBoss.hp <= 0) {
            demonBoss.hp = 0;
            demonBoss.isAlive = false;
            io.emit('bossDefeated', { msg: `🎉 มหาเทพปีศาจ ${demonBoss.name} ถูกกำจัดราบคาบด้วยพลังคะแนนของทุกคน!` });
            
            setTimeout(() => {
                demonBoss.hp = demonBoss.maxHp;
                demonBoss.isAlive = true;
                io.emit('bossRespawn', { msg: `⚠️ ปีศาจตนใหม่ฟื้นคืนชีพกลับมาแล้ว!` });
            }, 30000);
        }

        io.emit('bossUpdate', demonBoss);
        io.emit('updateLeaderboard', activePlayers);
        socket.emit('skillResult', { success: true, msg: `🔥 ใช้ ${scoreCost} คะแนนระเบิดพลังใส่บอส สร้างดาเมจ ${damage} แต้ม!` });
    });

    socket.on('buyUpgrade', (type) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn) return;

        let cost = 100;
        if (type === 'damage' && p.score >= cost) {
            p.score -= cost;
            p.upgrades.damageLevel++;
        } else if (type === 'luck' && p.score >= cost) {
            p.score -= cost;
            p.upgrades.luckLevel++;
        } else {
            socket.emit('skillResult', { success: false, msg: '❌ คะแนนไม่พออัปเกรด (ต้องการ 100 คะแนน)' });
            return;
        }

        if (playersDb[p.name]) {
            playersDb[p.name].score = p.score;
            playersDb[p.name].upgrades = p.upgrades;
            saveDatabase(playersDb);
        }

        socket.emit('upgradeResult', { success: true, upgrades: p.upgrades, score: p.score });
        io.emit('updateLeaderboard', activePlayers);
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

        let affectedCount = 0;
        let pClass = p.playerClass;

        for (let id in activePlayers) {
            if (id !== socket.id) {
                let target = activePlayers[id];
                let dist = Math.hypot(p.x - target.x, p.y - target.y);
                
                if (dist < 280) {
                    affectedCount++;
                    if (pClass === 'Assassin') {
                        io.to(id).emit('trolledEffect', { type: 'blind', msg: `🌑 โดน [Assassin] ${p.name} ปล่อยควันมืดใส่จอ!` });
                    } else if (pClass === 'Warrior') {
                        let angle = Math.atan2(target.y - p.y, target.x - p.x);
                        target.x = Math.max(50, Math.min(MAP_SIZE - 50, target.x + Math.cos(angle) * 150));
                        target.y = Math.max(50, Math.min(MAP_SIZE - 50, target.y + Math.sin(angle) * 150));
                        io.to(id).emit('trolledEffect', { type: 'push', msg: `⚔️ โดน [Warrior] ${p.name} ฟาดคลื่นกระเด็น!` });
                    } else if (pClass === 'Tank') {
                        target.stunnedUntil = Date.now() + 2000;
                        io.to(id).emit('trolledEffect', { type: 'stun', msg: `🛡️ โดน [Tank] ${p.name} กระแทกพื้นจนสตัน!` });
                    } else if (pClass === 'Archer') {
                        if (target.score >= 15) {
                            target.score -= 15;
                            p.score += 15;
                            if (playersDb[target.name]) playersDb[target.name].score = target.score;
                            if (playersDb[p.name]) playersDb[p.name].score = p.score;
                            saveDatabase(playersDb);
                        }
                        io.to(id).emit('trolledEffect', { type: 'snip', msg: `🏹 โดน [Archer] ${p.name} แอบชิ่งคะแนนไป!` });
                    } else if (pClass === 'Mage') {
                        let tempX = p.x; let tempY = p.y;
                        p.x = target.x; p.y = target.y;
                        target.x = tempX; target.y = tempY;
                        io.to(id).emit('trolledEffect', { type: 'swap', msg: `🔮 โดน [Mage] ${p.name} ร่ายเวทสลับร่าง!` });
                    } else if (pClass === 'Support') {
                        io.to(id).emit('trolledEffect', { type: 'invert', msg: `✨ โดน [Support] ${p.name} สาดแสงจอเพี้ยน!` });
                    } else if (pClass === 'Monk') {
                        io.to(id).emit('trolledEffect', { type: 'spin', msg: `🥋 โดน [Monk] ${p.name} ต่อยจนหัวหมุน!` });
                    } else if (pClass === 'Berserker') {
                        let angle = Math.atan2(target.y - p.y, target.x - p.x);
                        target.x += Math.cos(angle) * 100;
                        target.y += Math.sin(angle) * 100;
                        target.stunnedUntil = Date.now() + 1500;
                        io.to(id).emit('trolledEffect', { type: 'rage', msg: `🔥 โดนคำรามคลั่งจาก [Berserker] ${p.name}!` });
                    }
                }
            }
        }

        socket.emit('skillResult', { success: true, msg: affectedCount > 0 ? `✨ ใช้สกิลป่วนสำเร็จโดนเพื่อน ${affectedCount} คน!` : `✨ ร่ายสกิลประจำคลาสสำเร็จ!` });
        io.emit('updateLeaderboard', activePlayers);
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
                    let bonusMultiplier = p.upgrades.luckLevel || 1;
                    let earnedScore = eqStr.length * 15 * bonusMultiplier;
                    p.score += earnedScore;
                    playersDb[p.name].score = p.score;
                    saveDatabase(playersDb);

                    socket.emit('equationResult', { success: true, score: p.score });
                    io.emit('updateLeaderboard', activePlayers);
                } else {
                    socket.emit('equationResult', { success: false, msg: "สมการไม่ถูกต้อง (ผลลัพธ์สองฝั่งไม่เท่ากัน)" });
                }
            } else {
                socket.emit('equationResult', { success: false, msg: "รูปแบบสมการต้องมีเครื่องหมาย = คั่นกลาง" });
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
                playersDb[p.name].score = p.score;
                saveDatabase(playersDb);

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
    io.emit('stateUpdate', activePlayers);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
