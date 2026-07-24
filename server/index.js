const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- In-memory state ----
// rooms: Map<roomId, RoomState>
const rooms = new Map();

// socket.id -> { name, roomId }
const players = new Map();

const MAPS = ['Klasik Buz', 'Kutup Kalesi', 'Kırık Adalar'];

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function publicRoomList() {
  return Array.from(rooms.values())
    .filter(r => r.showInList)
    .map(r => ({
      id: r.id,
      name: r.name,
      players: r.players.size,
      maxPlayers: r.maxPlayers,
      hasPassword: !!r.password,
      locked: r.locked,
    }));
}

function broadcastGlobalStats() {
  const totalPlayers = players.size;
  const totalRooms = rooms.size;
  io.emit('globalStats', { totalPlayers, totalRooms });
}

function broadcastRoomList() {
  io.to('lobby-browser').emit('roomListUpdate', publicRoomList());
}

function roomStateForClient(room) {
  return {
    id: room.id,
    name: room.name,
    maxPlayers: room.maxPlayers,
    hasPassword: !!room.password,
    locked: room.locked,
    settings: room.settings,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      isHost: p.isHost,
    })),
  };
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('roomState', roomStateForClient(room));
}

function removePlayerFromRoom(socket) {
  const info = players.get(socket.id);
  if (!info || !info.roomId) return;
  const room = rooms.get(info.roomId);
  if (!room) return;

  room.players.delete(socket.id);
  socket.leave(info.roomId);
  info.roomId = null;

  if (room.players.size === 0) {
    rooms.delete(room.id);
  } else {
    // reassign host if the host left
    const stillHasHost = Array.from(room.players.values()).some(p => p.isHost);
    if (!stillHasHost) {
      const next = room.players.values().next().value;
      next.isHost = true;
    }
    broadcastRoomState(room.id);
  }
  broadcastRoomList();
  broadcastGlobalStats();
}

io.on('connection', (socket) => {
  players.set(socket.id, { name: null, roomId: null });

  socket.on('setName', (name, cb) => {
    name = (name || '').toString().trim().slice(0, 20);
    if (!name) name = 'Penguen' + Math.floor(Math.random() * 1000);
    players.get(socket.id).name = name;
    cb && cb({ ok: true, name });
  });

  socket.on('enterLobbyBrowser', (cb) => {
    socket.join('lobby-browser');
    cb && cb({ rooms: publicRoomList(), stats: { totalPlayers: players.size, totalRooms: rooms.size } });
  });

  socket.on('leaveLobbyBrowser', () => {
    socket.leave('lobby-browser');
  });

  socket.on('createRoom', (opts, cb) => {
    const info = players.get(socket.id);
    if (!info || !info.name) return cb && cb({ ok: false, error: 'İsim belirlenmedi' });

    const id = genRoomId();
    const room = {
      id,
      name: (opts.name || `${info.name}'in odası`).toString().slice(0, 30),
      password: (opts.password || '').toString(),
      maxPlayers: Math.min(Math.max(parseInt(opts.maxPlayers) || 12, 2), 30),
      showInList: opts.showInList !== false,
      locked: false,
      players: new Map(),
      settings: { timeLimit: 3, stockLimit: 3, map: MAPS[0] },
    };
    rooms.set(id, room);

    joinRoomInternal(socket, room, opts.password, true);
    broadcastRoomList();
    broadcastGlobalStats();
    cb && cb({ ok: true, roomId: id });
  });

  socket.on('joinRoom', ({ roomId, password }, cb) => {
    const room = rooms.get((roomId || '').toUpperCase());
    if (!room) return cb && cb({ ok: false, error: 'Oda bulunamadı' });
    if (room.locked) return cb && cb({ ok: false, error: 'Oda kilitli' });
    if (room.players.size >= room.maxPlayers) return cb && cb({ ok: false, error: 'Oda dolu' });
    if (room.password && room.password !== password) return cb && cb({ ok: false, error: 'Şifre yanlış' });

    joinRoomInternal(socket, room, password, false);
    broadcastRoomList();
    broadcastGlobalStats();
    cb && cb({ ok: true, roomId: room.id });
  });

  function joinRoomInternal(socket, room, password, isHost) {
    const info = players.get(socket.id);
    info.roomId = room.id;
    socket.join(room.id);
    room.players.set(socket.id, {
      id: socket.id,
      name: info.name,
      team: 'spectator',
      isHost,
    });
    socket.leave('lobby-browser');
    broadcastRoomState(room.id);
  }

  socket.on('leaveRoom', () => {
    removePlayerFromRoom(socket);
  });

  socket.on('changeTeam', (team) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room) return;
    if (!['red', 'blue', 'spectator'].includes(team)) return;
    const p = room.players.get(socket.id);
    if (p) p.team = team;
    broadcastRoomState(room.id);
  });

  socket.on('hostTool', (tool) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room) return;
    const requester = room.players.get(socket.id);
    if (!requester || !requester.isHost) return;

    const list = Array.from(room.players.values());
    if (tool === 'auto') {
      list.forEach((p, i) => { p.team = i % 2 === 0 ? 'red' : 'blue'; });
    } else if (tool === 'rand') {
      const shuffled = list.filter(p => p.team !== 'spectator').sort(() => Math.random() - 0.5);
      shuffled.forEach((p, i) => { p.team = i % 2 === 0 ? 'red' : 'blue'; });
    } else if (tool === 'reset') {
      list.forEach(p => { p.team = 'spectator'; });
    } else if (tool === 'lock') {
      room.locked = !room.locked;
      broadcastRoomList();
    }
    broadcastRoomState(room.id);
  });

  socket.on('updateSettings', (settings) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room) return;
    const requester = room.players.get(socket.id);
    if (!requester || !requester.isHost) return;

    if (settings.timeLimit !== undefined) room.settings.timeLimit = Math.min(Math.max(parseInt(settings.timeLimit) || 0, 0), 60);
    if (settings.stockLimit !== undefined) room.settings.stockLimit = Math.min(Math.max(parseInt(settings.stockLimit) || 1, 1), 20);
    if (settings.map !== undefined && MAPS.includes(settings.map)) room.settings.map = settings.map;
    broadcastRoomState(room.id);
  });

  socket.on('startGame', () => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room) return;
    const requester = room.players.get(socket.id);
    if (!requester || !requester.isHost) return;

    const reds = Array.from(room.players.values()).filter(p => p.team === 'red').length;
    const blues = Array.from(room.players.values()).filter(p => p.team === 'blue').length;
    if (reds === 0 || blues === 0) {
      socket.emit('errorMsg', 'Her iki takımda da en az 1 oyuncu olmalı');
      return;
    }
    io.to(room.id).emit('gameStarting', { settings: room.settings });
  });

  socket.on('getMaps', (cb) => cb && cb(MAPS));

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
    players.delete(socket.id);
    broadcastGlobalStats();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
