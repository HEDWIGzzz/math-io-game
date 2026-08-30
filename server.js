const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const players = {};
const tiles = [];
const MAP_SIZE = 3000;
let gameStarted = false;

// 4 ปราสาท 4 มุมแผนที่
let bases = {
    red: { x: 600, y: 600, hp: 3000, maxHp: 3000, name: 'Red Castle', alive: true },
    blue: { x: MAP_SIZE - 600, y: 600, hp: 3000, maxHp: 3000, name: 'Blue Castle', alive: true },
    green: { x: 600, y: MAP_SIZE - 600, hp: 3000, maxHp: 3000, name: 'Green Castle', alive: true },
    yellow: { x: MAP_SIZE - 600, y: MAP_SIZE - 600, hp: 3000, maxHp: 3000, name: 'Yellow Castle', alive: true }
};

// สร้างเบี้ยคณิตศาสตร์บนแผนที่
function spawnTile() {
    const chars = ['0','1','2','3','4','5','6','7','8','9','+','-','×','÷','='];
    const char = chars[Math.floor(Math.random() * chars.length)];
    const type = (char >= '0' && char <= '9') ? 'num' : (char === '=' ? 'eq' : 'op');
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * (MAP_SIZE - 400) + 200,
        y: Math.random() * (MAP_SIZE - 400) + 200,
        char,
        type
    };
}

for (let i = 0; i < 100; i++) tiles.push(spawnTile());

function getTeamCounts() {
    let counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (let id in players) {
        let p = players[id];
        if (p.joined && !p.isHost && counts[p.team] !== undefined) {
            counts[p.team]++;
        }
    }
    return counts;
}

io.on('connection', (socket) => {
    players[socket.id] = {
        id: socket.id,
        name: '',
        team: 'red',
        class: 'Warrior',
        color: '#9b59b6',
        x: MAP_SIZE / 2,
        y: MAP_SIZE / 2,
        score: 0,
        damageDealt: 0,
        joined: false,
        isHost: false
    };

    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, bases, tiles, teamCounts: getTeamCounts() });

    socket.on('joinGame', (data) => {
        let name = data.name ? data.name.trim() : 'Player';
        let isHostUser = (data.password === '007007' || name.toLowerCase() === 'do' || name === 'โด้');

        if (isHostUser) {
            players[socket.id].name = 'Host (โด้)';
            players[socket.id].team = 'host';
            players[socket.id].isHost = true;
            players[socket.id].joined = true;
            socket.emit('joined', { success: true, isHost: true });
            io.emit('teamCounts', getTeamCounts());
            return;
        }

        let team = data.team || 'red';
        let counts = getTeamCounts();
        if (counts[team] >= 10) {
            socket.emit('joined', { success: false, msg: '❌ ทีมนี้เต็มแล้ว (จำกัด 10 คน)' });
            return;
        }

        players[socket.id].name = name;
        players[socket.id].team = team;
        players[socket.id].class = data.class || 'Warrior';
        players[socket.id].color = data.color || '#9b59b6';
        players[socket.id].joined = true;

        // จุดเกิดตามทีม
        if (team === 'red') { players[socket.id].x = 800; players[socket.id].y = 800; }
        else if (team === 'blue') { players[socket.id].x = MAP_SIZE - 800; players[socket.id].y = 800; }
        else if (team === 'green') { players[socket.id].x = 800; players[socket.id].y = MAP_SIZE - 800; }
        else if (team === 'yellow') { players[socket.id].x = MAP_SIZE - 800; players[socket.id].y = MAP_SIZE - 800; }

        socket.emit('joined', { success: true, isHost: false });
        io.emit('teamCounts', getTeamCounts());
        io.emit('leaderboard', players);
    });

    socket.on('startGame', () => {
        if (players[socket.id] && players[socket.id].isHost) {
            gameStarted = true;
            io.emit('gameStarted', '🚀 สงคราม 4 ปราสาทเริ่มขึ้นแล้ว!');
        }
    });

    socket.on('move', (pos) => {
        let p = players[socket.id];
        if (!p || !p.joined || p.isHost) return;

        p.x = Math.max(50, Math.min(MAP_SIZE - 50, pos.x));
        p.y = Math.max(50, Math.min(MAP_SIZE - 50, pos.y));

        // ตรวจสอบการเก็บเบี้ย
        for (let i = tiles.length - 1; i >= 0; i--) {
            let t = tiles[i];
            if (Math.hypot(p.x - t.x, p.y - t.y) < 40) {
                let collected = tiles.splice(i, 1)[0];
                socket.emit('tileCollected', collected);
                tiles.push(spawnTile());
                io.emit('updateTiles', tiles);
                break;
            }
        }
    });

    socket.on('submitEquation', (eqStr) => {
        let p = players[socket.id];
        if (!p || !p.joined || p.isHost) return;

        try {
            let parts = eqStr.split('=');
            if (parts.length === 2 && eval(parts[0]) === eval(parts[1])) {
                let earned = eqStr.length * 15;
                p.score += earned;
                socket.emit('eqResult', { success: true, score: p.score, earned });
                io.emit('leaderboard', players);
            } else {
                socket.emit('eqResult', { success: false, msg: 'สมการไม่ถูกต้อง' });
            }
        } catch (e) {
            socket.emit('eqResult', { success: false, msg: 'คำนวณไม่ได้' });
        }
    });

    socket.on('attackBase', (targetTeam) => {
        let p = players[socket.id];
        if (!p || !p.joined || p.isHost) return;

        let target = bases[targetTeam];
        if (!target || target.team === p.team || !target.alive) return;

        let dist = Math.hypot(p.x - target.x, p.y - target.y);
        if (dist > 400) {
            socket.emit('msg', '❌ อยู่ใกล้ปราสาทเป้าหมายไม่พอ (เข้าใกล้กว่า 400)');
            return;
        }

        if (p.score < 50) {
            socket.emit('msg', '❌ คะแนนไม่พอโจมตี (ต้องการ 50 แต้ม)');
            return;
        }

        p.score -= 50;
        target.hp -= 150;
        p.damageDealt += 150;

        if (target.hp <= 0) {
            target.hp = 0;
            target.alive = false;
            io.emit('msg', `💥 ปราสาท ${target.name} ถูกทำลายราบคาบ!`);
        }

        io.emit('basesUpdate', bases);
        io.emit('leaderboard', players);
        socket.emit('msg', `🔥 โจมตี ${target.name} เสียหาย 150!`);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('teamCounts', getTeamCounts());
        io.emit('leaderboard', players);
    });
});

setInterval(() => {
    io.emit('state', { players, bases });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
