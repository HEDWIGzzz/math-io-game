const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// เปิดให้บริการไฟล์ในโฟลเดอร์ public
app.use(express.static('public'));

const players = {};
const tiles = [];

// สร้างเบี้ยเริ่มต้น 40 ตัวบนแผนที่ขนาด 1500x1500
for(let i=0; i<40; i++) spawnTile();

function spawnTile() {
    const types = [
        {char: Math.floor(Math.random()*10).toString(), t: 'num'},
        {char: '+', t: 'op'}, {char: '-', t: 'op'}, {char: '*', t: 'op'}, {char: '/', t: 'op'},
        {char: '=', t: 'eq'}
    ];
    let rand = Math.random();
    let selected = (rand < 0.65) ? types[0] : (rand < 0.9 ? types[Math.floor(Math.random()*4)+1] : types[5]);

    tiles.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * 1400 + 50,
        y: Math.random() * 1400 + 50,
        char: selected.char,
        type: selected.t
    });
}

// เมื่อผู้เล่นเชื่อมต่อเข้ามา
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    players[socket.id] = {
        x: 750, y: 750, score: 0,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        inventory: []
    };

    // ส่งข้อมูลเบี้ยทั้งหมดให้ผู้เล่นใหม่
    socket.emit('initGame', { id: socket.id, tiles });

    // รับข้อมูลการเคลื่อนไหว
    socket.on('move', (data) => {
        if(players[socket.id]) {
            players[socket.id].x = Math.max(20, Math.min(1480, data.x));
            players[socket.id].y = Math.max(20, Math.min(1480, data.y));

            // ตรวจสอบการเก็บเบี้ย
            for (let i = tiles.length - 1; i >= 0; i--) {
                let dx = players[socket.id].x - tiles[i].x;
                let dy = players[socket.id].y - tiles[i].y;
                if (Math.hypot(dx, dy) < 30) {
                    let collectedTile = tiles[i];
                    tiles.splice(i, 1);
                    
                    // ส่งสัญญาณบอกทุกคนว่าเบี้ยนี้ถูกเก็บไปแล้ว
                    io.emit('tileRemoved', collectedTile.id);
                    
                    // ส่งเบี้ยเข้าตัวผู้เล่น
                    socket.emit('tileCollected', collectedTile);

                    // สร้างเบี้ยใหม่ทดแทน
                    spawnTile();
                    io.emit('newTile', tiles[tiles.length - 1]);
                }
            }
        }
    });

    // รับสมการที่ผู้เล่นส่งมาตรวจ
    socket.on('submitEquation', (eqStr) => {
        try {
            let parts = eqStr.split('=');
            if (parts.length === 2 && parts[0] && parts[1]) {
                let left = eval(parts[0].replace(/\b0+(\d)/g, '$1'));
                let right = eval(parts[1].replace(/\b0+(\d)/g, '$1'));
                
                if (left === right) {
                    players[socket.id].score += eqStr.length * 10;
                    socket.emit('equationResult', { success: true, score: players[socket.id].score });
                    io.emit('updateLeaderboard', players);
                } else {
                    socket.emit('equationResult', { success: false, msg: "สมการไม่ถูกต้อง (ค่าสองฝั่งไม่เท่ากัน)" });
                }
            } else {
                socket.emit('equationResult', { success: false, msg: "รูปแบบสมการต้องมีเครื่องหมาย =" });
            }
        } catch (e) {
            socket.emit('equationResult', { success: false, msg: "โครงสร้างทางคณิตศาสตร์ผิดพลาด" });
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('updateLeaderboard', players);
    });
});

// ส่งสถานะเกมให้ทุกคน 60 FPS
setInterval(() => {
    io.emit('stateUpdate', players);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});