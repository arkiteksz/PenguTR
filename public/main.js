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
function submitName() {
  const val = nameInput.value.trim();
  if (!val) return;
  socket.emit('setName', val, (res) => {
    myName = res.name;
    enterRoomList();
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
    btn.addEventListener('click', () => attemptJoin(btn.dataset.room));
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

function attemptJoin(roomId, password) {
  socket.emit('joinRoom', { roomId, password }, (res) => {
    if (res.ok) {
      currentRoomId = res.roomId;
      enterLobby();
    } else if (res.error === 'Şifre yanlış' || res.error === 'Oda bulunamadı') {
      if (res.error === 'Şifre yanlış') {
        showToast('Şifre yanlış');
      } else {
        pendingJoinRoomId = roomId;
        document.getElementById('modal-password').classList.remove('hidden');
      }
    } else {
      showToast(res.error);
    }
  });
}

// try join first without password; if it needs one, prompt
document.getElementById('roomListBody').addEventListener('click', () => {});

// override attemptJoin to detect password-required rooms properly:
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
// re-bind room list buttons to smart join
const origRenderRoomList = renderRoomList;
renderRoomList = function (rooms) {
  origRenderRoomList(rooms);
  document.getElementById('roomListBody').querySelectorAll('button[data-room]').forEach(btn => {
    btn.onclick = () => attemptJoinSmart(btn.dataset.room);
  });
};

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
    // sunucudan gelen mevcut oda ayarını uygula (varsa)
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

// ---- Basit oyun prototipi: platform fiziği (yerçekimi, zıplama, çarpışma) ----
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WORLD_W = 1280, WORLD_H = 720, SQUARE = 40;
const MOVE_SPEED = 300;      // px/sn yatay hız
const GRAVITY = 1300;        // px/sn^2
const JUMP_VELOCITY = -620;  // zıplama ilk hızı
const DROP_THROUGH_MS = 350; // S ile platformdan inme süresi

let gamePlayers = {}; // socket.id -> {x,y,name,team}
let myPos = { x: 0, y: 0 };
let myVel = { x: 0, y: 0 };
let onGround = false;
let dropThroughUntil = 0;
let jumpRequested = false;
let dropRequested = false;
let keys = { w: false, a: false, s: false, d: false };
let gameLoopRunning = false;
let lastFrameTime = 0;
let lastSendTime = 0;
let currentMap = null; // {width,height,platforms,image}
let mapBgImage = null;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!(k in keys)) return;
  if (k === 'w' && !keys.w) jumpRequested = true;
  if (k === 's' && !keys.s) dropRequested = true;
  keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
});

socket.on('gameStarting', (data) => {
  gamePlayers = data.players || {};
  currentMap = data.map || null;
  mapBgImage = null;
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
  showScreen('screen-game');
  if (!gameLoopRunning) {
    gameLoopRunning = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(gameLoop);
  }
});

socket.on('playersUpdate', (players) => {
  gamePlayers = players;
});

function getPlatforms() {
  return (currentMap && currentMap.platforms) ? currentMap.platforms : [];
}

function gameLoop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  // ---- Yatay hareket ----
  let dx = 0;
  if (keys.a) dx -= 1;
  if (keys.d) dx += 1;
  myVel.x = dx * MOVE_SPEED;
  myPos.x = clampNum(myPos.x + myVel.x * dt, 0, WORLD_W - SQUARE);

  // ---- Platformdan aşağı inme (S) ----
  if (dropRequested) {
    dropRequested = false;
    if (onGround) dropThroughUntil = now + DROP_THROUGH_MS;
  }
  const droppingThrough = now < dropThroughUntil;

  // ---- Zıplama ----
  if (jumpRequested) {
    jumpRequested = false;
    if (onGround) {
      myVel.y = JUMP_VELOCITY;
      onGround = false;
    }
  }

  // ---- Yerçekimi ----
  myVel.y += GRAVITY * dt;
  const prevBottom = myPos.y + SQUARE;
  myPos.y += myVel.y * dt;
  let newBottom = myPos.y + SQUARE;
  onGround = false;

  if (myVel.y >= 0) {
    getPlatforms().forEach(pl => {
      const isThin = pl.h <= 20;
      if (droppingThrough && isThin) return; // ince platformlardan geçiliyor
      const withinX = myPos.x + SQUARE > pl.x && myPos.x < pl.x + pl.w;
      if (withinX && prevBottom <= pl.y + 1 && newBottom >= pl.y) {
        myPos.y = pl.y - SQUARE;
        myVel.y = 0;
        onGround = true;
        newBottom = pl.y;
      }
    });
  }

  // Dünyanın altı geçici zemin (elenme sistemi henüz eklenmedi)
  if (myPos.y + SQUARE >= WORLD_H) {
    myPos.y = WORLD_H - SQUARE;
    myVel.y = 0;
    onGround = true;
  }
  if (myPos.y < 0) { myPos.y = 0; myVel.y = 0; }

  if (now - lastSendTime > 40) { // ~25hz
    lastSendTime = now;
    socket.emit('playerMove', { x: myPos.x, y: myPos.y });
  }

  // local prediction: reflect my own latest position immediately
  if (gamePlayers[socket.id]) {
    gamePlayers[socket.id].x = myPos.x;
    gamePlayers[socket.id].y = myPos.y;
  }

  renderGame();
  requestAnimationFrame(gameLoop);
}

function clampNum(v, min, max) { return Math.min(Math.max(v, min), max); }

function renderGame() {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = '#223522';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  if (mapBgImage) {
    ctx.drawImage(mapBgImage, 0, 0, WORLD_W, WORLD_H);
  }
  // Platformlar görünmez - sadece arka plan görselindeki çizim kullanılıyor

  Object.entries(gamePlayers).forEach(([id, p]) => {
    ctx.fillStyle = p.team === 'red' ? '#e05c3f' : '#4a90d9';
    if (id === socket.id) ctx.fillStyle = '#f0c040';
    ctx.fillRect(p.x, p.y, SQUARE, SQUARE);

    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x + SQUARE / 2, p.y - 8);
  });
}
