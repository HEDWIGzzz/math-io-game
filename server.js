const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

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
        name: 'จอมเวทย์ฝึกหัด',
        avatar: 'hero',
        outfitColor: '#3498db',
        hat: 'none',
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        isMoving: false,
        loggedIn: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE });

    // ระบบจัดการเข้าสู่ระบบและสมัครสมาชิก
    socket.on('authPlayer', (data) => {
        let name = data.name ? data.name.trim().substring(0, 15) : '';
        let password = data.password ? data.password.trim() : '';
        let isRegister = data.isRegister;

        if (!name || !password) {
            socket.emit('authResult', { success: false, msg: 'กรุณากรอกชื่อและรหัสผ่านให้ครบถ้วน' });
            return;
        }

        if (isRegister) {
            if (playersDb[name]) {
                socket.emit('authResult', { success: false, msg: 'ชื่อนี้มีผู้ใช้งานแล้ว กรุณาเลือกชื่ออื่นหรือเข้าสู่ระบบ' });
                return;
            }
            // สมัครสมาชิกใหม่
            playersDb[name] = { password: password, score: 0 };
            saveDatabase(playersDb);
        } else {
            // เข้าสู่ระบบ
            if (!playersDb[name]) {
                socket.emit('authResult', { success: false, msg: 'ไม่พบชื่อผู้ใช้นี้ กรุณาสมัครสมาชิกก่อน' });
                return;
            }
            if (playersDb[name].password !== password) {
                socket.emit('authResult', { success: false, msg: 'รหัสผ่านไม่ถูกต้อง!' });
                return;
            }
        }

        activePlayers[socket.id].name = name;
        activePlayers[socket.id].score = playersDb[name].score || 0;
        activePlayers[socket.id].avatar = data.avatar || 'hero';
        activePlayers[socket.id].outfitColor = data.outfitColor || '#3498db';
        activePlayers[socket.id].hat = data.hat || 'none';
        activePlayers[socket.id].loggedIn = true;

        socket.emit('authResult', { success: true, score: activePlayers[socket.id].score });
        io.emit('updateLeaderboard', activePlayers);
    });

    socket.on('move', (data) => {
        let p = activePlayers[socket.id];
        if (!p || !p.loggedIn) return;

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
        if (!p || !p.loggedIn) return;
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
        if (p && p.loggedIn) {
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
