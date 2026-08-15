const socket = io();

let myName = null;
let currentRoomId = null;
let pendingJoinRoomId = null;
let isHost = false;

// Bağlantı her koptuğunda/yeniden kurulduğunda ismi sunucuya tekrar bildir
socket.on('connect', () => {
  if (myName) {
    socket.emit('setName', myName, () => {});
  }
});

// ---- Screen helpers ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---- Name screen ----
const nameInput = document.getElementById('nameInput');
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitName();
});

let selectedSkin = 'blue';
document.querySelectorAll('.skin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSkin = btn.dataset.skin;
  });
});

function submitName() {
  const val = nameInput.value.trim();
  if (!val) return;
  socket.emit('setName', val, (res) => {
    myName = res.name;
    socket.emit('setSkin', selectedSkin, () => {
      enterRoomList();
    });
  });
}

// ---- Room list screen ----
function enterRoomList() {
  showScreen('screen-roomlist');
  socket.emit('enterLobbyBrowser', (data) => {
    renderRoomList(data.rooms);
    renderGlobalStats(data.stats);
  });
}

function renderGlobalStats(stats) {
  document.getElementById('globalStats').textContent =
    `${stats.totalPlayers} oyuncu, ${stats.totalRooms} oda`;
}

function renderRoomList(rooms) {
  const body = document.getElementById('roomListBody');
  const empty = document.getElementById('roomListEmpty');
  body.innerHTML = '';
  if (!rooms.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  rooms.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="room-name-cell">${r.locked ? '🔒' : ''} ${escapeHtml(r.name)}</td>
      <td>${r.players}/${r.maxPlayers}</td>
      <td>${r.hasPassword ? 'Evet' : 'Hayır'}</td>
      <td><button class="btn btn-small" data-room="${r.id}">Katıl</button></td>
    `;
    body.appendChild(tr);
  });
  body.querySelectorAll('button[data-room]').forEach(btn => {
    btn.addEventListener('click', () => attemptJoinSmart(btn.dataset.room));
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

socket.on('roomListUpdate', (rooms) => {
  if (!document.getElementById('screen-roomlist').classList.contains('hidden')) {
    renderRoomList(rooms);
  }
});
socket.on('globalStats', (stats) => renderGlobalStats(stats));

document.getElementById('btnRefresh').addEventListener('click', () => {
  socket.emit('enterLobbyBrowser', (data) => {
    renderRoomList(data.rooms);
    renderGlobalStats(data.stats);
  });
});

function attemptJoinSmart(roomId) {
  socket.emit('joinRoom', { roomId, password: '' }, (res) => {
    if (res.ok) {
      currentRoomId = res.roomId;
      enterLobby();
      return;
    }
    if (res.error === 'Şifre yanlış') {
      pendingJoinRoomId = roomId;
      document.getElementById('joinRoomPassword').value = '';
      document.getElementById('modal-password').classList.remove('hidden');
    } else {
      showToast(res.error);
    }
  });
}

document.getElementById('btnCancelPassword').addEventListener('click', () => {
  document.getElementById('modal-password').classList.add('hidden');
  pendingJoinRoomId = null;
});
document.getElementById('btnConfirmPassword').addEventListener('click', () => {
  const pw = document.getElementById('joinRoomPassword').value;
  socket.emit('joinRoom', { roomId: pendingJoinRoomId, password: pw }, (res) => {
    if (res.ok) {
      currentRoomId = res.roomId;
      document.getElementById('modal-password').classList.add('hidden');
      enterLobby();
    } else {
      showToast(res.error);
    }
  });
});

// ---- Create room modal ----
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  document.getElementById('createRoomName').value = myName ? `${myName}'in odası` : '';
  document.getElementById('createRoomPassword').value = '';
  document.getElementById('createRoomMax').value = 12;
  document.getElementById('createRoomShow').checked = true;
  document.getElementById('modal-create').classList.remove('hidden');
});
document.getElementById('btnCancelCreate').addEventListener('click', () => {
  document.getElementById('modal-create').classList.add('hidden');
});
document.getElementById('btnConfirmCreate').addEventListener('click', () => {
  const opts = {
    name: document.getElementById('createRoomName').value.trim(),
    password: document.getElementById('createRoomPassword').value,
    maxPlayers: document.getElementById('createRoomMax').value,
    showInList: document.getElementById('createRoomShow').checked,
  };
  socket.emit('createRoom', opts, (res) => {
    if (res.ok) {
      currentRoomId = res.roomId;
      document.getElementById('modal-create').classList.add('hidden');
      enterLobby();
    } else {
      showToast(res.error || 'Oda oluşturulamadı');
    }
  });
});

// ---- Lobby screen ----
let mapsLoaded = false;
function enterLobby() {
  showScreen('screen-lobby');
  socket.emit('getMaps', (maps) => {
    const sel = document.getElementById('settingMap');
    if (!maps.length) {
      sel.innerHTML = `<option value="">(harita yok)</option>`;
    } else {
      sel.innerHTML = maps.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    }
    mapsLoaded = true;
    if (window._lastRoomState) applyMapSelection(window._lastRoomState.settings.map);
  });
}

function applyMapSelection(mapId) {
  const sel = document.getElementById('settingMap');
  if (mapId && [...sel.options].some(o => o.value === mapId)) sel.value = mapId;
}

socket.on('roomState', (room) => {
  renderLobby(room);
});

function renderLobby(room) {
  document.getElementById('lobbyRoomName').textContent = room.name;
  document.getElementById('lobbyRoomCode').textContent = 'Kod: ' + room.id;

  const me = room.players.find(p => p.id === socket.id);
  isHost = !!(me && me.isHost);

  const redList = document.getElementById('teamRedList');
  const blueList = document.getElementById('teamBlueList');
  const specList = document.getElementById('teamSpecList');
  redList.innerHTML = ''; blueList.innerHTML = ''; specList.innerHTML = '';

  room.players.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerHTML = `<span>${escapeHtml(p.name)}</span>` + (p.isHost ? '<span class="host-star">★</span>' : '');
    if (p.team === 'red') redList.appendChild(chip);
    else if (p.team === 'blue') blueList.appendChild(chip);
    else specList.appendChild(chip);
  });

  document.getElementById('hostTools').classList.toggle('hidden', !isHost);
  document.getElementById('btnStartGame').classList.toggle('hidden', !isHost);
  document.getElementById('notHostHint').classList.toggle('hidden', isHost);

  window._lastRoomState = room;
  document.getElementById('settingTime').value = room.settings.timeLimit;
  document.getElementById('settingStock').value = room.settings.stockLimit;
  if (mapsLoaded) applyMapSelection(room.settings.map);

  [document.getElementById('settingTime'), document.getElementById('settingStock'), document.getElementById('settingMap')]
    .forEach(el => el.disabled = !isHost);
}

document.getElementById('btnToRed').addEventListener('click', () => socket.emit('changeTeam', 'red'));
document.getElementById('btnToBlue').addEventListener('click', () => socket.emit('changeTeam', 'blue'));

document.getElementById('hostTools').addEventListener('click', (e) => {
  const tool = e.target.dataset.tool;
  if (tool) socket.emit('hostTool', tool);
});

['settingTime', 'settingStock', 'settingMap'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (!isHost) return;
    socket.emit('updateSettings', {
      timeLimit: document.getElementById('settingTime').value,
      stockLimit: document.getElementById('settingStock').value,
      map: document.getElementById('settingMap').value,
    });
  });
});

document.getElementById('btnStartGame').addEventListener('click', () => {
  socket.emit('startGame');
});

document.getElementById('btnLeaveRoom').addEventListener('click', () => {
  socket.emit('leaveRoom');
  currentRoomId = null;
  enterRoomList();
});

socket.on('errorMsg', (msg) => showToast(msg));

// ---- Basit oyun prototipi: platform fiziği + sprite animasyon + silah ----
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WORLD_W = 1280, WORLD_H = 720, SQUARE = 40;
const DRAW_W = 60, DRAW_H = 75; // karakterin gorsel boyutu (cizim + isabet kutusu icin ortak)
const MOVE_SPEED = 300;
const GRAVITY = 1300;
const JUMP_VELOCITY = -620;
const DROP_THROUGH_MS = 350;

let gamePlayers = {};
let myPos = { x: 0, y: 0 };
let myVel = { x: 0, y: 0 };
let onGround = false;
let dropThroughUntil = 0;
let stunUntil = 0;
let jumpRequested = false;
let dropRequested = false;
let fireRequested = false;
let keys = { w: false, a: false, s: false, d: false, u: false };
let gameLoopRunning = false;
let lastFrameTime = 0;
let lastSendTime = 0;
let currentMap = null;
let mapBgImage = null;

// ---- Karakter sprite / renklendirme ----
const SKIN_COLORS = { blue: '#3d6fb0', green: '#3d8f4a', black: '#2a2a2a', purple: '#7a3d9e' };
const WALK_FRAME_COUNT = 4;
const walkFramesRaw = [];
const tintedCache = {};
let framesLoadedCount = 0;

for (let i = 1; i <= WALK_FRAME_COUNT; i++) {
  const img = new Image();
  img.onload = () => {
    framesLoadedCount++;
    if (framesLoadedCount === WALK_FRAME_COUNT) precomputeTints();
  };
  img.src = `/assets/character/walk_${i}.png`;
  walkFramesRaw.push(img);
}

function tintFrame(img, colorHex) {
  const off = document.createElement('canvas');
  off.width = img.width; off.height = img.height;
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0);
  const imgData = octx.getImageData(0, 0, off.width, off.height);
  const d = imgData.data;
  const cr = parseInt(colorHex.slice(1, 3), 16);
  const cg = parseInt(colorHex.slice(3, 5), 16);
  const cb = parseInt(colorHex.slice(5, 7), 16);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    if (maxc - minc < 25 && r < 195) { // gri ton VE beyaza yakın değil -> boya (göz beyazı/karın beyaz kalır)
      const lum = r / 255;
      d[i] = lum * cr; d[i + 1] = lum * cg; d[i + 2] = lum * cb;
    }
  }
  octx.putImageData(imgData, 0, 0);
  return off;
}

function precomputeTints() {
  Object.keys(SKIN_COLORS).forEach(skin => {
    walkFramesRaw.forEach((img, idx) => {
      tintedCache[skin + '_' + idx] = tintFrame(img, SKIN_COLORS[skin]);
    });
  });
}
function getTintedFrame(skin, frameIdx) {
  return tintedCache[(skin || 'blue') + '_' + frameIdx] || null;
}

let playerVisual = {};
let remoteMoveInfo = {};

// ---- Silah (pistol - test) ----
const PISTOL = {
  fireRateMs: 333,     // saniyede 3 atis
  bulletSpeed: 700,    // px/sn
  lifespanMs: 1000,
  knockback: 340,
};
let bullets = []; // {id, ownerId, x, y, vx, vy, spawnTime}
let lastFireTime = -9999;
let bulletIdCounter = 0;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!(k in keys)) return;
  if (k === 'w' && !keys.w) jumpRequested = true;
  if (k === 's' && !keys.s) dropRequested = true;
  if (k === 'u' && !keys.u) fireRequested = true;
  keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
});

// Sekme arka plana geçince/pencere odak kaybedince basili tuslar "takili" kalabiliyor - guvenlik icin sifirla
function releaseAllKeys() {
  keys.w = false; keys.a = false; keys.s = false; keys.d = false; keys.u = false;
}
window.addEventListener('blur', releaseAllKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllKeys();
});

socket.on('gameStarting', (data) => {
  gamePlayers = data.players || {};
  currentMap = data.map || null;
  mapBgImage = null;
  bullets = [];
  if (currentMap && currentMap.image) {
    const img = new Image();
    img.onload = () => { mapBgImage = img; };
    img.src = currentMap.image;
  }
  if (gamePlayers[socket.id]) {
    myPos.x = gamePlayers[socket.id].x;
    myPos.y = gamePlayers[socket.id].y;
  } else {
    myPos.x = WORLD_W / 2;
    myPos.y = WORLD_H / 2;
  }
  myVel.x = 0; myVel.y = 0;
  onGround = false;
  dropThroughUntil = 0;
  stunUntil = 0;
  amEliminated = false;
  matchEndedInfo = null;
  showScreen('screen-game');
  if (!gameLoopRunning) {
    gameLoopRunning = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(gameLoop);
  }
});

socket.on('playersUpdate', (players) => {
  const now = performance.now();
  Object.entries(players).forEach(([id, p]) => {
    if (id === socket.id) return;
    const prev = gamePlayers[id];
    if (prev) {
      const dx = p.x - prev.x;
      if (Math.abs(dx) > 0.5) {
        remoteMoveInfo[id] = { facing: dx > 0 ? 1 : -1, movingUntil: now + 250 };
      }
    }
  });
  gamePlayers = players;
});

// Baskasi ates etti
socket.on('playerShot', (data) => {
  spawnBullet(data.id, data.shooterId, data.x, data.y, data.dirX);
});

// Ben vuruldum
socket.on('youWereHit', ({ dirX, force }) => {
  myVel.x = dirX * force;
  myVel.y = -260;
  onGround = false;
  stunUntil = performance.now() + 220;
});

socket.on('bulletRemoved', ({ bulletId }) => {
  bullets = bullets.filter(b => b.id !== bulletId);
});

// Stok kaybedip yeniden dogdum
socket.on('youRespawned', ({ x, y }) => {
  myPos.x = x; myPos.y = y;
  myVel.x = 0; myVel.y = 0;
  onGround = false;
  stunUntil = 0;
  dropThroughUntil = 0;
});

let amEliminated = false;
let matchEndedInfo = null;

socket.on('matchEnded', (data) => {
  matchEndedInfo = data;
});


function spawnBullet(id, ownerId, x, y, dirX) {
  bullets.push({
    id,
    ownerId,
    x, y,
    vx: dirX * PISTOL.bulletSpeed,
    vy: 0,
    spawnTime: performance.now(),
  });
}

function respawnPlayer() {
  const myTeam = (gamePlayers[socket.id] && gamePlayers[socket.id].team) || 'red';
  const spawnList = (currentMap && currentMap.spawns && currentMap.spawns[myTeam] && currentMap.spawns[myTeam].length)
    ? currentMap.spawns[myTeam] : [{ x: WORLD_W / 2, y: WORLD_H / 2 }];
  const sp = spawnList[Math.floor(Math.random() * spawnList.length)];
  myPos.x = sp.x; myPos.y = sp.y;
  myVel.x = 0; myVel.y = 0;
  onGround = false;
  stunUntil = 0;
  dropThroughUntil = 0;
  socket.emit('playerMove', { x: myPos.x, y: myPos.y });
}

function checkKillZones() {
  const zones = (currentMap && currentMap.killZones) ? currentMap.killZones : [];
  for (const z of zones) {
    if (myPos.x + SQUARE > z.x && myPos.x < z.x + z.w && myPos.y + SQUARE > z.y && myPos.y < z.y + z.h) {
      respawnPlayer();
      socket.emit('selfDestruct');
      return;
    }
  }
}

function getPlatforms() {
  return (currentMap && currentMap.platforms) ? currentMap.platforms : [];
}

function gameLoop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  if (gamePlayers[socket.id]) amEliminated = !!gamePlayers[socket.id].eliminated;
  const frozen = amEliminated || !!matchEndedInfo;

  if (!frozen) {
    // ---- Yatay hareket ----
    if (now < stunUntil) {
      myVel.x *= 0.94; // sersemlemis durumda surtunerek yavasla, tus girisini yok say
    } else {
      let dx = 0;
      if (keys.a) dx -= 1;
      if (keys.d) dx += 1;
      myVel.x = dx * MOVE_SPEED;
    }
    myPos.x = clampNum(myPos.x + myVel.x * dt, 0, WORLD_W - SQUARE);

    // ---- Platformdan asagi inme (S) ----
    if (dropRequested) {
      dropRequested = false;
      if (onGround) dropThroughUntil = now + DROP_THROUGH_MS;
    }
    const droppingThrough = now < dropThroughUntil;

    // ---- Ziplama ----
    if (jumpRequested) {
      jumpRequested = false;
      if (onGround) {
        myVel.y = JUMP_VELOCITY;
        onGround = false;
      }
    }

    // ---- Atesv (U) ----
    if (fireRequested) {
      fireRequested = false;
      if (now - lastFireTime > PISTOL.fireRateMs) {
        lastFireTime = now;
        const vs = playerVisual[socket.id];
        const facing = vs ? vs.facing : 1;
        const spawnX = myPos.x + SQUARE / 2 + facing * (SQUARE / 2 + 4);
        const spawnY = myPos.y + SQUARE * 0.4;
        const bulletId = socket.id + '_' + (bulletIdCounter++);
        spawnBullet(bulletId, socket.id, spawnX, spawnY, facing);
        socket.emit('playerShoot', { id: bulletId, x: spawnX, y: spawnY, dirX: facing, weapon: 'pistol' });
      }
    }

    // ---- Yercekimi ----
    myVel.y += GRAVITY * dt;
    const prevBottom = myPos.y + SQUARE;
    myPos.y += myVel.y * dt;
    let newBottom = myPos.y + SQUARE;
    onGround = false;

    if (myVel.y >= 0) {
      getPlatforms().forEach(pl => {
        const isThin = pl.h <= 20;
        if (droppingThrough && isThin) return;
        const withinX = myPos.x + SQUARE > pl.x && myPos.x < pl.x + pl.w;
        if (withinX && prevBottom <= pl.y + 1 && newBottom >= pl.y) {
          myPos.y = pl.y - SQUARE;
          myVel.y = 0;
          onGround = true;
          newBottom = pl.y;
        }
      });
    }

    if (myPos.y + SQUARE >= WORLD_H) {
      myPos.y = WORLD_H - SQUARE;
      myVel.y = 0;
      onGround = true;
    }
    if (myPos.y < 0) { myPos.y = 0; myVel.y = 0; }

    checkKillZones();

    if (now - lastSendTime > 40) {
      lastSendTime = now;
      socket.emit('playerMove', { x: myPos.x, y: myPos.y });
    }

    if (gamePlayers[socket.id]) {
      gamePlayers[socket.id].x = myPos.x;
      gamePlayers[socket.id].y = myPos.y;
    }
  }

  updateVisualStates(dt, now);
  updateBullets(dt, now);
  renderGame();
  requestAnimationFrame(gameLoop);
}

function updateBullets(dt, now) {
  const solidPlatforms = getPlatforms().filter(pl => pl.h > 20);
  bullets = bullets.filter(b => {
    if (now - b.spawnTime > PISTOL.lifespanMs) return false;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < -20 || b.x > WORLD_W + 20 || b.y < -20 || b.y > WORLD_H + 20) return false;

    // Kati platforma carpma
    for (const pl of solidPlatforms) {
      if (b.x > pl.x && b.x < pl.x + pl.w && b.y > pl.y && b.y < pl.y + pl.h) return false;
    }

    // Isabet kontrolu - sadece kendi merminse (gorsel sprite boyutuyla ayni kutu kullanilir)
    if (b.ownerId === socket.id) {
      for (const [id, p] of Object.entries(gamePlayers)) {
        if (id === socket.id) continue;
        if (p.eliminated || p.invulnerable) continue;
        const hitLeft = p.x + SQUARE / 2 - DRAW_W / 2;
        const hitRight = p.x + SQUARE / 2 + DRAW_W / 2;
        const hitBottom = p.y + SQUARE;
        const hitTop = hitBottom - DRAW_H;
        if (b.x > hitLeft && b.x < hitRight && b.y > hitTop && b.y < hitBottom) {
          socket.emit('playerHit', { targetId: id, dirX: b.vx >= 0 ? 1 : -1, weapon: 'pistol', bulletId: b.id });
          return false;
        }
      }
    }
    return true;
  });
}

function clampNum(v, min, max) { return Math.min(Math.max(v, min), max); }

function updateVisualStates(dt, now) {
  Object.entries(gamePlayers).forEach(([id, p]) => {
    if (!playerVisual[id]) playerVisual[id] = { facing: 1, frame: 0, timer: 0, moving: false };
    const vs = playerVisual[id];

    if (id === socket.id) {
      if (keys.a && !keys.d) vs.facing = -1;
      else if (keys.d && !keys.a) vs.facing = 1;
      vs.moving = keys.a || keys.d;
    } else {
      const info = remoteMoveInfo[id];
      const moving = !!(info && now < info.movingUntil);
      if (moving) vs.facing = info.facing;
      vs.moving = moving;
    }

    if (vs.moving) {
      vs.timer += dt;
      if (vs.timer > 0.12) { vs.timer = 0; vs.frame = (vs.frame + 1) % WALK_FRAME_COUNT; }
    } else {
      vs.frame = 0; vs.timer = 0;
    }
  });
}

function renderGame() {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = '#223522';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  if (mapBgImage) {
    ctx.drawImage(mapBgImage, 0, 0, WORLD_W, WORLD_H);
  }

  Object.entries(gamePlayers).forEach(([id, p]) => {
    if (p.eliminated) return; // elenen oyuncu artik sahnede gorunmez

    const vs = playerVisual[id] || { facing: 1, frame: 0 };
    const tinted = getTintedFrame(p.skin, vs.frame);
    const cx = p.x + SQUARE / 2;
    const bottomY = p.y + SQUARE;

    ctx.save();
    if (p.invulnerable && Math.floor(performance.now() / 100) % 2 === 0) {
      ctx.globalAlpha = 0.4; // dokunulmazken yanip sonme efekti
    }
    ctx.translate(cx, bottomY);
    if (vs.facing === -1) ctx.scale(-1, 1);
    if (tinted) {
      ctx.drawImage(tinted, -DRAW_W / 2, -DRAW_H, DRAW_W, DRAW_H);
    } else {
      ctx.fillStyle = SKIN_COLORS[p.skin] || '#888';
      ctx.fillRect(-SQUARE / 2, -SQUARE, SQUARE, SQUARE);
    }
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, cx, bottomY - DRAW_H - 6);

    // Gecici can/stok yazisi (asil HUD kartlari sonraki adimda gelecek)
    if (typeof p.health === 'number') {
      ctx.fillStyle = p.health > 50 ? '#8fe08a' : (p.health > 20 ? '#f0c040' : '#e05c3f');
      ctx.font = '11px sans-serif';
      ctx.fillText(`${Math.round(p.health)} can | ${p.stocks} stok`, cx, bottomY - DRAW_H - 20);
    }
  });

  // ---- Mermiler ----
  ctx.fillStyle = '#fff566';
  ctx.strokeStyle = '#c9a800';
  ctx.lineWidth = 1;
  bullets.forEach(b => {
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  if (amEliminated && !matchEndedInfo) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, WORLD_W, 40);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Elendin - maç bitene kadar izliyorsun', WORLD_W / 2, 26);
  }

  if (matchEndedInfo) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, WORLD_H / 2 - 50, WORLD_W, 100);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    const w = matchEndedInfo.winner;
    const text = w === 'draw' ? 'Berabere!' : (w === 'red' ? 'Kırmızı Takım Kazandı!' : 'Mavi Takım Kazandı!');
    ctx.fillText(text, WORLD_W / 2, WORLD_H / 2 + 10);
  }
}
