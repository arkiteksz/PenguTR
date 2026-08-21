const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- In-memory state ----
const rooms = new Map();     // roomId -> RoomState
const players = new Map();   // socket.id -> { name, roomId, skin }

const MAPS_DIR = path.join(__dirname, '..', 'public', 'maps');

function loadMaps() {
  const result = new Map();
  if (!fs.existsSync(MAPS_DIR)) return result;
  const files = fs.readdirSync(MAPS_DIR).filter(f => f.endsWith('.json'));
  files.forEach(f => {
    try {
      const raw = fs.readFileSync(path.join(MAPS_DIR, f), 'utf-8');
      const data = JSON.parse(raw);
      const id = f.replace(/\.json$/, '');
      result.set(id, {
        id,
        name: data.name || id,
        width: data.width || 1280,
        height: data.height || 720,
        platforms: data.platforms || [],
        killZones: data.killZones || [],
        spawns: data.spawns || { red: [], blue: [] },
        image: `/maps/${id}.png`,
      });
    } catch (e) {
      console.error('Harita okunamadı:', f, e.message);
    }
  });
  return result;
}

let MAPS = loadMaps();
function getDefaultMapId() {
  const keys = Array.from(MAPS.keys());
  return keys.length ? keys[0] : null;
}

// Silah istatistikleri - hile riskine karsi hasar/knockback/mermi burada, sunucuda tutulur
const WEAPON_CONFIG = {
  pistol:  { name: 'Pistol',  damage: 8,  knockback: 340, fireRateMs: 333,  totalAmmo: Infinity, bulletSpeed: 700,  explosive: false },
  smg:     { name: 'SMG',     damage: 4,  knockback: 150, fireRateMs: 100,  totalAmmo: 60,        bulletSpeed: 750,  explosive: false },
  shotgun: { name: 'Shotgun', damage: 6,  knockback: 420, fireRateMs: 800,  totalAmmo: 20,        bulletSpeed: 550,  explosive: false, pelletCount: 5, spreadDeg: 26 },
  sniper:  { name: 'Sniper',  damage: 30, knockback: 620, fireRateMs: 1400, totalAmmo: 6,         bulletSpeed: 1500, explosive: false },
  rocket:  { name: 'Roket',   damage: 20, knockback: 520, fireRateMs: 1200, totalAmmo: 4,         bulletSpeed: 420,  explosive: true, explosionRadius: 110 },
  grenade: { name: 'Granat',  damage: 16, knockback: 460, fireRateMs: 1100, totalAmmo: 5,         bulletSpeed: 480,  explosive: true, explosionRadius: 100, arcing: true },
};
const PICKUP_WEAPONS = ['smg', 'shotgun', 'sniper', 'rocket', 'grenade'];

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
  io.emit('globalStats', { totalPlayers: players.size, totalRooms: rooms.size });
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
      skin: p.skin,
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
  if (room.game && room.game.players[socket.id]) {
    delete room.game.players[socket.id];
    io.to(room.id).emit('playersUpdate', room.game.players);
    if (room.game.active) checkEliminationWin(room);
  }
  info.roomId = null;

  if (room.players.size === 0) {
    rooms.delete(room.id);
  } else {
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

function endMatch(room, winner, reason, winnerName) {
  if (!room.game || !room.game.active) return;
  room.game.active = false;
  if (room.game.endTimerHandle) { clearTimeout(room.game.endTimerHandle); room.game.endTimerHandle = null; }
  if (room.game.crateTimerHandle) { clearTimeout(room.game.crateTimerHandle); room.game.crateTimerHandle = null; }
  io.to(room.id).emit('matchEnded', { winner, reason, winnerName: winnerName || null, mode: room.settings.mode });
}

const CRATE_MAX_ACTIVE = 3;
function scheduleNextCrate(room) {
  const delay = 15000 + Math.random() * 5000; // 15-20 sn
  room.game.crateTimerHandle = setTimeout(() => {
    if (!room.game || !room.game.active) return;
    spawnCrate(room);
    scheduleNextCrate(room);
  }, delay);
}

function spawnCrate(room) {
  if (Object.keys(room.game.crates).length >= CRATE_MAX_ACTIVE) return;
  const platforms = (room.game.mapData.platforms || []);
  if (!platforms.length) return;
  const pl = platforms[Math.floor(Math.random() * platforms.length)];
  const x = pl.x + 20 + Math.random() * Math.max(1, pl.w - 40);
  const y = pl.y - 34;
  const weapon = PICKUP_WEAPONS[Math.floor(Math.random() * PICKUP_WEAPONS.length)];
  const id = 'crate' + Math.random().toString(36).slice(2, 9);
  room.game.crates[id] = { id, x, y, weapon };
  io.to(room.id).emit('crateSpawned', room.game.crates[id]);
}

function endMatchByTime(room) {
  if (!room.game || !room.game.active) return;
  if (room.settings.mode === 'ffa') {
    let best = null;
    Object.entries(room.game.players).forEach(([id, p]) => {
      const score = p.stocks * 1000 + p.health;
      if (!best || score > best.score) best = { id, score, name: p.name };
    });
    endMatch(room, best ? best.id : 'draw', 'time', best ? best.name : null);
    return;
  }
  const teamScore = { red: 0, blue: 0 };
  Object.values(room.game.players).forEach(p => {
    teamScore[p.team] += p.stocks * 1000 + p.health; // stok once, sonra can esitlik bozar
  });
  let winner = 'draw';
  if (teamScore.red > teamScore.blue) winner = 'red';
  else if (teamScore.blue > teamScore.red) winner = 'blue';
  endMatch(room, winner, 'time');
}

function checkEliminationWin(room) {
  if (room.settings.mode === 'ffa') {
    const alive = Object.entries(room.game.players).filter(([id, p]) => !p.eliminated);
    if (alive.length <= 1) {
      const winner = alive.length === 1 ? alive[0][0] : 'draw';
      const winnerName = alive.length === 1 ? alive[0][1].name : null;
      endMatch(room, winner, 'elimination', winnerName);
    }
    return;
  }
  const players = Object.values(room.game.players);
  const redAlive = players.some(p => p.team === 'red' && !p.eliminated);
  const blueAlive = players.some(p => p.team === 'blue' && !p.eliminated);
  if (!redAlive && !blueAlive) { endMatch(room, 'draw', 'elimination'); return; }
  if (!redAlive) { endMatch(room, 'blue', 'elimination'); return; }
  if (!blueAlive) { endMatch(room, 'red', 'elimination'); return; }
}

io.on('connection', (socket) => {
  players.set(socket.id, { name: null, roomId: null, skin: 'blue' });

  socket.on('setName', (name, cb) => {
    name = (name || '').toString().trim().slice(0, 20);
    if (!name) name = 'Penguen' + Math.floor(Math.random() * 1000);
    players.get(socket.id).name = name;
    cb && cb({ ok: true, name });
  });

  socket.on('setSkin', (skin, cb) => {
    const info = players.get(socket.id);
    if (!info) return;
    const allowed = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'black', 'white', 'skin', 'brownLight', 'brownDark'];
    info.skin = allowed.includes(skin) ? skin : 'blue';
    cb && cb({ ok: true, skin: info.skin });
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
      settings: { timeLimit: 3, stockLimit: 3, map: getDefaultMapId(), mode: 'teams' },
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
      skin: info.skin || 'blue',
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
    if (settings.map !== undefined && MAPS.has(settings.map)) room.settings.map = settings.map;
    if (settings.mode !== undefined && ['teams', 'ffa'].includes(settings.mode)) room.settings.mode = settings.mode;
    broadcastRoomState(room.id);
  });

  socket.on('startGame', () => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room) return;
    const requester = room.players.get(socket.id);
    if (!requester || !requester.isHost) return;

    const isFFA = room.settings.mode === 'ffa';
    const reds = Array.from(room.players.values()).filter(p => p.team === 'red').length;
    const blues = Array.from(room.players.values()).filter(p => p.team === 'blue').length;
    if (isFFA) {
      if (reds + blues < 2) {
        socket.emit('errorMsg', 'FFA için en az 2 oyuncu olmalı');
        return;
      }
    } else if (reds === 0 || blues === 0) {
      socket.emit('errorMsg', 'Her iki takımda da en az 1 oyuncu olmalı');
      return;
    }

    MAPS = loadMaps();
    const mapData = MAPS.get(room.settings.map) || Array.from(MAPS.values())[0];
    if (!mapData) {
      socket.emit('errorMsg', 'Hiç harita bulunamadı, public/maps klasörüne bir harita ekle');
      return;
    }

    room.game = { active: true, players: {}, mapId: mapData.id, mapData, endTimerHandle: null, crates: {}, crateTimerHandle: null };
    if (isFFA) {
      const allSpawns = [...(mapData.spawns.red || []), ...(mapData.spawns.blue || [])];
      const spawnList = allSpawns.length ? allSpawns : [{ x: 640, y: 400 }];
      let idx = 0;
      room.players.forEach(p => {
        if (p.team === 'spectator') return;
        const sp = spawnList[idx % spawnList.length];
        idx++;
        room.game.players[p.id] = { x: sp.x, y: sp.y, name: p.name, team: p.team, skin: p.skin, health: 100, stocks: room.settings.stockLimit, eliminated: false, invulnerable: false, weapon: 'pistol', ammo: Infinity, lastShotAt: 0, lastDodgeAt: 0 };
      });
    } else {
      let ri = 0, bi = 0;
      const redSpawns = mapData.spawns.red && mapData.spawns.red.length ? mapData.spawns.red : [{ x: 200, y: 500 }];
      const blueSpawns = mapData.spawns.blue && mapData.spawns.blue.length ? mapData.spawns.blue : [{ x: 1080, y: 500 }];
      room.players.forEach(p => {
        if (p.team === 'red') {
          const sp = redSpawns[ri % redSpawns.length];
          room.game.players[p.id] = { x: sp.x, y: sp.y, name: p.name, team: p.team, skin: p.skin, health: 100, stocks: room.settings.stockLimit, eliminated: false, invulnerable: false, weapon: 'pistol', ammo: Infinity, lastShotAt: 0, lastDodgeAt: 0 };
          ri++;
        } else if (p.team === 'blue') {
          const sp = blueSpawns[bi % blueSpawns.length];
          room.game.players[p.id] = { x: sp.x, y: sp.y, name: p.name, team: p.team, skin: p.skin, health: 100, stocks: room.settings.stockLimit, eliminated: false, invulnerable: false, weapon: 'pistol', ammo: Infinity, lastShotAt: 0, lastDodgeAt: 0 };
          bi++;
        }
      });
    }

    if (room.settings.timeLimit > 0) {
      room.game.endTimerHandle = setTimeout(() => endMatchByTime(room), room.settings.timeLimit * 60 * 1000);
    }
    scheduleNextCrate(room);

    io.to(room.id).emit('gameStarting', { settings: room.settings, players: room.game.players, map: mapData });
  });

  socket.on('playerMove', (pos) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active) return;
    const p = room.game.players[socket.id];
    if (!p) return;
    p.x = Math.min(Math.max(parseFloat(pos.x) || 0, 0), 1280);
    p.y = Math.min(Math.max(parseFloat(pos.y) || 0, 0), 720);
    io.to(room.id).emit('playersUpdate', room.game.players);
  });

  // ---- Silah sistemi: ates etme ve isabet aktarimi ----
  socket.on('playerShoot', (data) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active) return;
    const shooter = room.game.players[socket.id];
    if (!shooter || shooter.eliminated) return;

    const wep = WEAPON_CONFIG[shooter.weapon] || WEAPON_CONFIG.pistol;
    const now = Date.now();
    if (now - shooter.lastShotAt < wep.fireRateMs - 20) return; // hile/asiri hizli ates onleme (kucuk tolerans)
    if (wep.totalAmmo !== Infinity && shooter.ammo <= 0) return;

    shooter.lastShotAt = now;
    if (wep.totalAmmo !== Infinity) {
      shooter.ammo -= 1;
      if (shooter.ammo <= 0) {
        shooter.weapon = 'pistol';
        shooter.ammo = Infinity;
      }
      io.to(room.id).emit('playersUpdate', room.game.players);
    }

    socket.to(room.id).emit('playerShot', {
      shooterId: socket.id,
      id: data.id,
      x: data.x,
      y: data.y,
      dirX: data.dirX,
      weapon: shooter.weapon,
    });
  });

  socket.on('selfDestruct', () => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active) return;
    const target = room.game.players[socket.id];
    if (!target || target.eliminated || target.invulnerable) return;
    target.health = 0;
    applyDeathOrRespawn(room, socket.id, target);
    io.to(room.id).emit('playersUpdate', room.game.players);
    if (target.eliminated) checkEliminationWin(room);
  });

  function applyDeathOrRespawn(room, targetId, target) {
    target.stocks -= 1;
    if (target.stocks <= 0) {
      target.eliminated = true;
      target.health = 0;
    } else {
      const spawns = target.team === 'red' ? room.game.mapData.spawns.red : room.game.mapData.spawns.blue;
      const spawnList = (spawns && spawns.length) ? spawns : [{ x: 200, y: 500 }];
      const sp = spawnList[Math.floor(Math.random() * spawnList.length)];
      target.x = sp.x; target.y = sp.y;
      target.health = 100;
      target.weapon = 'pistol';
      target.ammo = Infinity;
      target.invulnerable = true;
      io.to(targetId).emit('youRespawned', { x: sp.x, y: sp.y });
      setTimeout(() => {
        if (room.game && room.game.players[targetId]) {
          room.game.players[targetId].invulnerable = false;
          io.to(room.id).emit('playersUpdate', room.game.players);
        }
      }, 2000);
    }
  }

  function applyDamage(room, shooterSocket, targetId, weaponKey, dirX, bulletId) {
    const target = room.game.players[targetId];
    if (!target || target.eliminated || target.invulnerable) return;
    const wep = WEAPON_CONFIG[weaponKey] || WEAPON_CONFIG.pistol;

    const healthAfter = Math.max(0, target.health - wep.damage);
    const t = (100 - healthAfter) / 100;
    const multiplier = 1 + 2 * t * t; // can azaldikca ustel artan knockback (1x -> 3x)
    const force = wep.knockback * multiplier;

    target.health = healthAfter;
    io.to(targetId).emit('youWereHit', { byId: shooterSocket.id, dirX: Math.sign(dirX) || 1, force });
    if (bulletId) io.to(room.id).emit('bulletRemoved', { bulletId });

    if (healthAfter <= 0) applyDeathOrRespawn(room, targetId, target);

    io.to(room.id).emit('playersUpdate', room.game.players);
    if (target.eliminated) checkEliminationWin(room);
  }

  socket.on('playerHit', ({ targetId, dirX, weapon, bulletId }) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active) return;
    applyDamage(room, socket, targetId, weapon, dirX, bulletId);
  });

  socket.on('explosionHit', ({ targets, x, y, weapon, bulletId }) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active) return;
    (targets || []).slice(0, 16).forEach(t => {
      applyDamage(room, socket, t.id, weapon, t.dirX, null);
    });
    if (bulletId) io.to(room.id).emit('bulletRemoved', { bulletId });
    io.to(room.id).emit('explosionFx', { x, y });
  });

  const DODGE_COOLDOWN_MS = 3000;
  const DODGE_DURATION_MS = 500;
  socket.on('activateDodge', () => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active) return;
    const player = room.game.players[socket.id];
    if (!player || player.eliminated || player.invulnerable) return;

    const now = Date.now();
    if (now - player.lastDodgeAt < DODGE_COOLDOWN_MS - 50) return; // hile/erken tekrar onleme
    player.lastDodgeAt = now;
    player.invulnerable = true;
    io.to(room.id).emit('playersUpdate', room.game.players);
    setTimeout(() => {
      if (room.game && room.game.players[socket.id]) {
        room.game.players[socket.id].invulnerable = false;
        io.to(room.id).emit('playersUpdate', room.game.players);
      }
    }, DODGE_DURATION_MS);
  });

  socket.on('pickupCrate', ({ crateId }) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    const room = rooms.get(info.roomId);
    if (!room || !room.game || !room.game.active || !room.game.crates) return;
    const crate = room.game.crates[crateId];
    if (!crate) return;
    const player = room.game.players[socket.id];
    if (!player || player.eliminated) return;

    delete room.game.crates[crateId];
    io.to(room.id).emit('crateRemoved', { crateId });

    player.weapon = crate.weapon;
    player.ammo = WEAPON_CONFIG[crate.weapon].totalAmmo;
    io.to(room.id).emit('playersUpdate', room.game.players);
  });

  socket.on('chatMessage', (text) => {
    const info = players.get(socket.id);
    if (!info || !info.roomId) return;
    text = (text || '').toString().trim().slice(0, 200);
    if (!text) return;
    io.to(info.roomId).emit('chatMessage', { name: info.name, text, ts: Date.now() });
  });

  socket.on('getMaps', (cb) => {
    MAPS = loadMaps();
    const list = Array.from(MAPS.values()).map(m => ({ id: m.id, name: m.name }));
    cb && cb(list);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
    players.delete(socket.id);
    broadcastGlobalStats();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
