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
        characterData: {},
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        isMoving: false,
        inLobby: true,
        loggedIn: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE });

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
        activePlayers[socket.id].characterData = pData.characterData || {};

        socket.emit('authResult', { success: true, action: 'login', playerData: pData });
    });

    socket.on('saveCharacter', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.name) return;

        p.playerClass = data.playerClass || 'Warrior';
        p.outfitColor = data.outfitColor || '#9b59b6';
        p.hat = data.hat || 'none';
        p.characterData = data.characterData || {};

        if (playersDb[p.name]) {
            playersDb[p.name].playerClass = p.playerClass;
            playersDb[p.name].outfitColor = p.outfitColor;
            playersDb[p.name].hat = p.hat;
            playersDb[p.name].characterData = p.characterData;
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

    // ⚡ ระบบสกิลเฉพาะตาม 8 คลาส (Unique Class Prank Skills)
    socket.on('castSkill', () => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.inLobby) return;

        let now = Date.now();
        if (p.lastSkillTime && now - p.lastSkillTime < 4500) {
            socket.emit('skillResult', { success: false, msg: '⏳ สกิลกำลัง Cool Down (รอ 4.5 วินาที)' });
            return;
        }
        p.lastSkillTime = now;

        let affectedCount = 0;
        let pClass = p.playerClass;

        for (let id in activePlayers) {
            if (id !== socket.id) {
                let target = activePlayers[id];
                let dist = Math.hypot(p.x - target.x, p.y - target.y);
                
                if (dist < 300) {
                    affectedCount++;
                    let effectType = 'blind'; // ค่าเริ่มต้น

                    if (pClass === 'Assassin') {
                        effectType = 'blind'; // มองไม่เห็น + ปุ่มกลับด้าน
                        io.to(id).emit('trolledEffect', { type: 'blind', msg: `🌑 โดน [Assassin] ${p.name} ปล่อยควันมืดใส่จอ!` });
                    } 
                    else if (pClass === 'Warrior') {
                        effectType = 'push'; // กระเด็นถอยหลัง
                        let angle = Math.atan2(target.y - p.y, target.x - p.x);
                        target.x = Math.max(50, Math.min(MAP_SIZE - 50, target.x + Math.cos(angle) * 150));
                        target.y = Math.max(50, Math.min(MAP_SIZE - 50, target.y + Math.sin(angle) * 150));
                        io.to(id).emit('trolledEffect', { type: 'push', msg: `⚔️ โดน [Warrior] ${p.name} ฟาดคลื่นกระเด็น!` });
                    } 
                    else if (pClass === 'Tank') {
                        effectType = 'stun'; // สตันขยับไม่ได้ 2 วิ
                        target.stunnedUntil = Date.now() + 2000;
                        io.to(id).emit('trolledEffect', { type: 'stun', msg: `🛡️ โดน [Tank] ${p.name} กระแทกพื้นจนสตัน!` });
                    } 
                    else if (pClass === 'Archer') {
                        effectType = 'snip'; // ขโมยคะแนน
                        if (target.score >= 15) {
                            target.score -= 15;
                            p.score += 15;
                            if (playersDb[target.name]) playersDb[target.name].score = target.score;
                            if (playersDb[p.name]) playersDb[p.name].score = p.score;
                            saveDatabase(playersDb);
                        }
                        io.to(id).emit('trolledEffect', { type: 'snip', msg: `🏹 โดน [Archer] ${p.name} แอบชิ่งคะแนนไป 15 แต้ม!` });
                    } 
                    else if (pClass === 'Mage') {
                        effectType = 'swap'; // วาร์ปสลับตำแหน่ง!
                        let tempX = p.x; let tempY = p.y;
                        p.x = target.x; p.y = target.y;
                        target.x = tempX; target.y = tempY;
                        io.to(id).emit('trolledEffect', { type: 'swap', msg: `🔮 โดน [Mage] ${p.name} ร่ายเวทสลับร่างวาร์ป!` });
                    } 
                    else if (pClass === 'Support') {
                        effectType = 'invert'; // จอสีเพี้ยน Negative
                        io.to(id).emit('trolledEffect', { type: 'invert', msg: `✨ โดน [Support] ${p.name} สาดแสงเวทจอเพี้ยน!` });
                    } 
                    else if (pClass === 'Monk') {
                        effectType = 'spin'; // หมุนติ้ว
                        io.to(id).emit('trolledEffect', { type: 'spin', msg: `🥋 โโดน [Monk] ${p.name} ต่อยชุดใหญ่จนหัวหมุน!` });
                    } 
                    else if (pClass === 'Berserker') {
                        effectType = 'rage'; // กระเด็น + สตันสั้นๆ
                        let angle = Math.atan2(target.y - p.y, target.x - p.x);
                        target.x += Math.cos(angle) * 100;
                        target.y += Math.sin(angle) * 100;
                        target.stunnedUntil = Date.now() + 1500;
                        io.to(id).emit('trolledEffect', { type: 'rage', msg: `🔥 โดนคำรามบ้าคลั่งจาก [Berserker] ${p.name}!` });
                    }
                }
            }
        }

        socket.emit('skillResult', { 
            success: true, 
            msg: affectedCount > 0 ? `✨ ใช้สกิล [${pClass}] ป่วนสำเร็จโดนเพื่อน ${affectedCount} คน!` : `✨ ร่ายสกิลประจำคลาสสำเร็จ!` 
        });
        io.emit('updateLeaderboard', activePlayers);
    });

    socket.on('move', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn || p.inLobby) return;

        // ถ้าติดสถานะ Stun ขยับไม่ได้
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
                    p.score += eqStr.length * 15;
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
