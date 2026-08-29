const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const players = {};
const tiles = [];
const mysteryBoxes = [];
const MAP_SIZE = 4000; // ขยายแผนที่เป็น 4000x4000 สำหรับ 80 คน

// เพิ่มจำนวนเบี้ยและกล่องให้สมกับแผนที่ใหญ่
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

    players[socket.id] = {
        socketId: socket.id,
        name: 'จอมเวทย์ฝึกหัด',
        avatar: 'hero',
        outfitColor: '#3498db',
        hat: 'none',
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        isMoving: false
    };

    socket.emit('initGame', { id: socket.id, tiles, mysteryBoxes, mapSize: MAP_SIZE });

    socket.on('setupPlayer', (data) => {
        if (players[socket.id]) {
            players[socket.id].name = data.name ? data.name.substring(0, 15) : 'จอมเวทย์ฝึกหัด';
            players[socket.id].avatar = data.avatar || 'hero';
            players[socket.id].outfitColor = data.outfitColor || '#3498db';
            players[socket.id].hat = data.hat || 'none';
            io.emit('updateLeaderboard', players);
        }
    });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = Math.max(50, Math.min(MAP_SIZE - 50, data.x));
            players[socket.id].y = Math.max(50, Math.min(MAP_SIZE - 50, data.y));
            players[socket.id].isMoving = data.isMoving;

            // ตรวจสอบการเก็บเบี้ย
            for (let i = tiles.length - 1; i >= 0; i--) {
                let dx = players[socket.id].x - tiles[i].x;
                let dy = players[socket.id].y - tiles[i].y;
                if (Math.hypot(dx, dy) < 40) {
                    let collectedTile = tiles[i];
                    tiles.splice(i, 1);
                    io.emit('tileRemoved', collectedTile.id);
                    socket.emit('tileCollected', collectedTile);
                    spawnTile();
                    io.emit('newTile', tiles[tiles.length - 1]);
                }
            }

            // ตรวจสอบการเก็บกล่องปริศนา
            for (let i = mysteryBoxes.length - 1; i >= 0; i--) {
                let dx = players[socket.id].x - mysteryBoxes[i].x;
                let dy = players[socket.id].y - mysteryBoxes[i].y;
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
        }
    });

    socket.on('submitEquation', (eqStr) => {
        try {
            let parts = eqStr.split('=');
            if (parts.length === 2 && parts[0] && parts[1]) {
                let left = eval(parts[0].replace(/\b0+(\d)/g, '$1'));
                let right = eval(parts[1].replace(/\b0+(\d)/g, '$1'));

                if (left === right) {
                    players[socket.id].score += eqStr.length * 15;
                    socket.emit('equationResult', { success: true, score: players[socket.id].score });
                    io.emit('updateLeaderboard', players);
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
        if (players[socket.id]) {
            if (parseInt(data.userAns) === parseInt(data.correctAns)) {
                players[socket.id].score += 60;
                socket.emit('mysteryResult', { success: true });
                io.emit('updateLeaderboard', players);
            } else {
                socket.emit('mysteryResult', { success: false });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('updateLeaderboard', players);
    });
});

setInterval(() => {
    io.emit('stateUpdate', players);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
