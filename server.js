const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Simple HTTP server (Railway needs this to stay alive)
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'Stick Man Unit [Battle Cat] - Server Online',
    rooms: Object.keys(rooms).length,
    players: [...wss.clients].length
  }));
});

// WebSocket Server
const wss = new WebSocketServer({ server: httpServer });

// Room storage: { roomCode: { host: ws, clients: [ws, ws], players: [...], status: 'waiting'|'started' } }
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function broadcast(room, data, exclude = null) {
  const msg = JSON.stringify(data);
  if (rooms[room]) {
    const all = [rooms[room].host, ...rooms[room].clients].filter(Boolean);
    all.forEach(ws => {
      if (ws !== exclude && ws && ws.readyState === 1) {
        ws.send(msg);
      }
    });
  }
}

function sendTo(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function removePlayer(ws) {
  // Find which room this ws belongs to
  for (const code in rooms) {
    const room = rooms[code];
    if (room.host === ws) {
      // Host left - notify all clients and delete room
      broadcast(code, { t: 'host_left' }, ws);
      delete rooms[code];
      console.log(`Room ${code} deleted (host left)`);
      return;
    }
    const idx = room.clients.indexOf(ws);
    if (idx !== -1) {
      room.clients.splice(idx, 1);
      room.players = room.players.filter(p => p.ws !== ws);
      // Notify remaining players
      const list = room.players.map(p => ({ name: p.name, idx: p.idx }));
      broadcast(code, { t: 'player_list', players: list });
      console.log(`Player left room ${code}`);
      return;
    }
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected, total:', wss.clients.size);
  ws._room = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    const { t } = data;

    // ===== CREATE ROOM (HOST) =====
    if (t === 'create_room') {
      const code = genCode();
      rooms[code] = {
        host: ws,
        clients: [],
        players: [{ name: data.name || 'Host', idx: 0, ws }],
        status: 'waiting'
      };
      ws._room = code;
      ws._idx = 0;
      sendTo(ws, { t: 'room_created', code, yourIdx: 0 });
      console.log(`Room ${code} created by ${data.name}`);
    }

    // ===== JOIN ROOM =====
    else if (t === 'join_room') {
      const code = data.code;
      const room = rooms[code];
      if (!room) { sendTo(ws, { t: 'join_fail', reason: 'Room tidak ada!' }); return; }
      if (room.status === 'started') { sendTo(ws, { t: 'join_fail', reason: 'Game sudah berjalan!' }); return; }
      if (room.players.length >= 3) { sendTo(ws, { t: 'join_fail', reason: 'Room penuh!' }); return; }

      const idx = room.players.length;
      room.clients.push(ws);
      room.players.push({ name: data.name || `Player${idx + 1}`, idx, ws });
      ws._room = code;
      ws._idx = idx;

      const list = room.players.map(p => ({ name: p.name, idx: p.idx }));
      // Tell joiner their index + player list
      sendTo(ws, { t: 'join_ok', yourIdx: idx, players: list });
      // Tell everyone the updated list
      broadcast(code, { t: 'player_list', players: list }, ws);
      // Tell host someone joined
      sendTo(room.host, { t: 'player_joined', name: data.name, idx, players: list });
      console.log(`${data.name} joined room ${code} as player ${idx}`);
    }

    // ===== START GAME (HOST ONLY) =====
    else if (t === 'start_game') {
      const code = ws._room;
      const room = rooms[code];
      if (!room || room.host !== ws) return;
      room.status = 'started';
      broadcast(code, { t: 'game_started' });
      console.log(`Game started in room ${code}`);
    }

    // ===== IN-GAME ACTIONS (spawn unit, cannon, etc) =====
    else if (t === 'action') {
      const code = ws._room;
      if (!code || !rooms[code]) return;
      // Relay to all OTHER players in the room
      broadcast(code, { t: 'action', action: data.action, from: ws._idx }, ws);
    }

    // ===== PING =====
    else if (t === 'ping') {
      sendTo(ws, { t: 'pong' });
    }
  });

  ws.on('close', () => {
    removePlayer(ws);
    console.log('Client disconnected, total:', wss.clients.size);
  });

  ws.on('error', () => {
    removePlayer(ws);
  });
});

// Cleanup empty rooms every 5 minutes
setInterval(() => {
  for (const code in rooms) {
    const room = rooms[code];
    if (!room.host || room.host.readyState !== 1) {
      delete rooms[code];
      console.log(`Cleaned up dead room ${code}`);
    }
  }
}, 5 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`✅ Stick Man Unit Server running on port ${PORT}`);
});
