const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Stick Man Unit [Battle Cat] Server Online. Rooms: ' + Object.keys(rooms).length);
});

const wss = new WebSocketServer({ server: httpServer });
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function send(ws, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(code, data) {
  const room = rooms[code]; if (!room) return;
  [room.host, ...room.clients].filter(Boolean).forEach(ws => send(ws, data));
}

function getPlayerList(code) {
  const room = rooms[code]; if (!room) return [];
  return room.players.map(p => ({ name: p.name, idx: p.idx, loadout: p.loadout || ['basic'] }));
}

function removePlayer(ws) {
  for (const code in rooms) {
    const room = rooms[code];
    if (room.host === ws) {
      broadcast(code, { t: 'host_left' });
      delete rooms[code];
      return;
    }
    const i = room.clients.indexOf(ws);
    if (i !== -1) {
      room.clients.splice(i, 1);
      room.players = room.players.filter(p => p.ws !== ws);
      // Re-index players
      room.players.forEach((p, idx) => p.idx = idx);
      broadcast(code, { t: 'sync', players: getPlayerList(code) });
      return;
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let d; try { d = JSON.parse(raw); } catch { return; }

    if (d.t === 'create') {
      const code = genCode();
      rooms[code] = {
        host: ws, clients: [],
        players: [{ name: d.name || 'Host', idx: 0, ws, loadout: d.loadout || ['basic'] }],
        status: 'waiting'
      };
      ws._room = code; ws._idx = 0;
      send(ws, { t: 'created', code, yourIdx: 0, players: getPlayerList(code), mode: d.mode || 'coop' });
    }

    else if (d.t === 'join') {
      const room = rooms[d.code];
      if (!room)                    { send(ws, { t: 'err', msg: 'Room tidak ada!' }); return; }
      if (room.status === 'started'){ send(ws, { t: 'err', msg: 'Game sudah mulai!' }); return; }
      if (room.players.length >= 3) { send(ws, { t: 'err', msg: 'Room penuh!' }); return; }

      const idx = room.players.length;
      room.clients.push(ws);
      room.players.push({ name: d.name || ('Player' + (idx+1)), idx, ws, loadout: d.loadout || ['basic'] });
      ws._room = d.code; ws._idx = idx;

      // Tell joiner: welcome + full player list
      send(ws, { t: 'joined', yourIdx: idx, players: getPlayerList(d.code), mode: rooms[d.code].mode || 'coop' });
      // Tell EVERYONE (including host) the new player list
      broadcast(d.code, { t: 'sync', players: getPlayerList(d.code), mode: rooms[d.code].mode || 'coop' });
    }

    else if (d.t === 'start') {
      const code = ws._room; const room = rooms[code];
      if (!room || room.host !== ws) return;
      room.status = 'started';
      broadcast(code, { t: 'start', players: getPlayerList(code) });
    }

    else if (d.t === 'action') {
      const code = ws._room; if (!code) return;
      // Relay to all OTHER players
      const room = rooms[code]; if (!room) return;
      [room.host, ...room.clients].filter(Boolean).forEach(w => {
        if (w !== ws) send(w, { t: 'action', action: d.action, from: ws._idx });
      });
    }

    else if (d.t === 'ping') { send(ws, { t: 'pong' }); }
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

setInterval(() => {
  for (const code in rooms) {
    if (!rooms[code].host || rooms[code].host.readyState !== 1) delete rooms[code];
  }
}, 5 * 60 * 1000);

httpServer.listen(PORT, () => console.log('Server on port', PORT));
