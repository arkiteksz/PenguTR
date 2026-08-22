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
  if (selectedSkin) {
    socket.emit('setSkin', selectedSkin, () => {});
  }
  if (typeof selectedAppearance !== 'undefined') {
    Object.keys(selectedAppearance).forEach(cat => {
      socket.emit('setAppearance', { category: cat, value: selectedAppearance[cat] }, () => {});
    });
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

// ---- Karakter rengi secici (sayfali, canli onizlemeli) ----
let selectedSkin = 'blue';
let colorWindowStart = 0;
const COLOR_WINDOW_SIZE = 4;

function getColorOrder() {
  return Object.keys(SKIN_COLORS);
}

function renderColorRow() {
  const order = getColorOrder();
  const row = document.getElementById('colorRow');
  if (!row) return;
  row.innerHTML = '';
  for (let i = 0; i < COLOR_WINDOW_SIZE; i++) {
    const key = order[(colorWindowStart + i) % order.length];
    const dot = document.createElement('div');
    dot.className = 'menu-color-swatch' + (key === selectedSkin ? ' active' : '');
    dot.style.background = SKIN_COLORS[key];
    dot.title = SKIN_NAMES[key] || key;
    dot.addEventListener('click', () => {
      selectedSkin = key;
      renderColorRow();
      drawAvatarPreview();
    });
    row.appendChild(dot);
  }
}

document.getElementById('colorPrev').addEventListener('click', () => {
  const order = getColorOrder();
  colorWindowStart = (colorWindowStart - 1 + order.length) % order.length;
  renderColorRow();
});
document.getElementById('colorNext').addEventListener('click', () => {
  const order = getColorOrder();
  colorWindowStart = (colorWindowStart + 1) % order.length;
  renderColorRow();
});

function drawAvatarPreview() {
  const canvas = document.getElementById('avatarPreview');
  if (!canvas) return;
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0, 0, canvas.width, canvas.height);
  const tinted = getTintedFrame(selectedSkin, 0);
  if (!tinted) return; // sprite kareleri henuz yuklenmedi, birazdan tekrar cizilecek
  const scale = Math.min(canvas.width / tinted.width, canvas.height / tinted.height);
  const dw = tinted.width * scale;
  const dh = tinted.height * scale;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2;
  ctx2.drawImage(tinted, dx, dy, dw, dh);
  ctx2.save();
  ctx2.translate(dx + dw / 2, dy + dh);
  drawAppearanceLayers(ctx2, selectedAppearance, dw, dh);
  ctx2.restore();
}

// ---- Kiyafet/aksesuar secimi (Sac, Sakal, Sapka, Gozluk, Aksesuar - ortak sistem) ----
const APPEARANCE_LABELS = { hat: 'Şapka', hair: 'Saç', beard: 'Sakal', glasses: 'Gözlük', accessory: 'Aksesuar' };
// Katmanlarin cizim sirasi (alttan uste): sac -> sakal -> gozluk -> aksesuar -> sapka en ustte
const APPEARANCE_LAYER_ORDER = ['hair', 'beard', 'glasses', 'accessory', 'hat'];

let selectedAppearance = { hat: 'none', hair: 'none', beard: 'none', glasses: 'none', accessory: 'none' };
const appearanceOptions = { hat: [], hair: [], beard: [], glasses: [], accessory: [] };
const appearanceImages = { hat: {}, hair: {}, beard: {}, glasses: {}, accessory: {} };
let currentAppearanceCategory = null;

function ensureAppearanceImageLoaded(category, id) {
  if (appearanceImages[category][id]) return;
  const img = new Image();
  img.src = `/assets/${category === 'hat' ? 'hats' : category}/${id}.png`;
  appearanceImages[category][id] = img;
}

function loadAppearanceList(category, callback) {
  socket.emit('getAppearanceList', category, (ids) => {
    appearanceOptions[category] = ids || [];
    (ids || []).forEach(id => ensureAppearanceImageLoaded(category, id));
    callback && callback();
  });
}

function loadAllAppearanceLists() {
  Object.keys(APPEARANCE_LABELS).forEach(cat => loadAppearanceList(cat));
}

function drawAppearanceLayer(ctxTarget, category, id, w, h) {
  if (!id || id === 'none') return;
  const img = appearanceImages[category] && appearanceImages[category][id];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  ctxTarget.drawImage(img, -w / 2, -h, w, h);
}

// Bir karakterin uzerine, secili tum katmanlari dogru sirada ciz (onizleme + oyun ici ortak kullanir)
function drawAppearanceLayers(ctxTarget, appearance, w, h) {
  APPEARANCE_LAYER_ORDER.forEach(cat => drawAppearanceLayer(ctxTarget, cat, appearance[cat], w, h));
}

function renderAppearanceGrid(category) {
  const grid = document.getElementById('appearanceGrid');
  grid.innerHTML = '';
  const options = [{ id: 'none', name: 'Yok' }, ...appearanceOptions[category].map(id => ({ id, name: id }))];
  options.forEach(opt => {
    const item = document.createElement('div');
    const isActive = opt.id === selectedAppearance[category];
    item.className = 'hat-item' + (opt.id === 'none' ? ' none-item' : '') + (isActive ? ' active' : '');
    if (opt.id === 'none') {
      item.innerHTML = `<span>🚫</span><span>${opt.name}</span>`;
    } else {
      const c = document.createElement('canvas');
      c.width = 140; c.height = 174;
      const cctx = c.getContext('2d');
      const bodyTinted = getTintedFrame(selectedSkin, 0);
      if (bodyTinted) {
        const scale = Math.min(c.width / bodyTinted.width, c.height / bodyTinted.height);
        const dw = bodyTinted.width * scale, dh = bodyTinted.height * scale;
        cctx.drawImage(bodyTinted, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      }
      cctx.save();
      cctx.translate(c.width / 2, c.height);
      drawAppearanceLayer(cctx, category, opt.id, c.width * 0.95, c.height * 0.98);
      cctx.restore();
      item.appendChild(c);
      const label = document.createElement('span');
      label.textContent = opt.name;
      item.appendChild(label);
    }
    item.addEventListener('click', () => {
      selectedAppearance[category] = opt.id;
      document.getElementById('modal-appearance').classList.add('hidden');
      drawAvatarPreview();
    });
    grid.appendChild(item);
  });
}

document.querySelectorAll('.menu-opt-btn[data-category]').forEach(btn => {
  btn.addEventListener('click', () => {
    const category = btn.dataset.category;
    currentAppearanceCategory = category;
    document.getElementById('appearanceModalTitle').textContent = (APPEARANCE_LABELS[category] || '') + ' Seç';
    loadAppearanceList(category, () => {
      renderAppearanceGrid(category);
      document.getElementById('modal-appearance').classList.remove('hidden');
    });
  });
});
document.getElementById('btnCloseAppearanceModal').addEventListener('click', () => {
  document.getElementById('modal-appearance').classList.add('hidden');
  nameInput.focus();
});

document.getElementById('btnBang').addEventListener('click', submitName);

function submitName() {
  const val = nameInput.value.trim();
  if (!val) return;
  socket.emit('setName', val, (res) => {
    myName = res.name;
    socket.emit('setSkin', selectedSkin, () => {
      const categories = Object.keys(selectedAppearance);
      let i = 0;
      function sendNext() {
        if (i >= categories.length) { enterRoomList(); return; }
        const cat = categories[i++];
        socket.emit('setAppearance', { category: cat, value: selectedAppearance[cat] }, () => sendNext());
      }
      sendNext();
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

  const isFFA = room.settings.mode === 'ffa';
  document.getElementById('teamBlueCol').classList.toggle('hidden', isFFA);
  document.getElementById('redTeamLabel').textContent = isFFA ? 'Oyuncular' : 'Red';

  window._lastRoomState = room;
  document.getElementById('settingMode').value = room.settings.mode || 'teams';
  document.getElementById('settingTime').value = room.settings.timeLimit;
  document.getElementById('settingStock').value = room.settings.stockLimit;
  if (mapsLoaded) applyMapSelection(room.settings.map);

  [document.getElementById('settingMode'), document.getElementById('settingTime'), document.getElementById('settingStock'), document.getElementById('settingMap')]
    .forEach(el => el.disabled = !isHost);
}

document.getElementById('btnToRed').addEventListener('click', () => socket.emit('changeTeam', 'red'));
document.getElementById('btnToBlue').addEventListener('click', () => socket.emit('changeTeam', 'blue'));

document.getElementById('hostTools').addEventListener('click', (e) => {
  const tool = e.target.dataset.tool;
  if (tool) socket.emit('hostTool', tool);
});

['settingMode', 'settingTime', 'settingStock', 'settingMap'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (!isHost) return;
    socket.emit('updateSettings', {
      mode: document.getElementById('settingMode').value,
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
let lastDodgeTimeLocal = -9999;
const DODGE_COOLDOWN_MS = 3000;
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
const SKIN_COLORS = {
  red:         '#d9382c',
  orange:      '#e8791f',
  yellow:      '#f0c419',
  green:       '#3d8f4a',
  blue:        '#3d6fb0',
  purple:      '#7a3d9e',
  pink:        '#e0559c',
  black:       '#2a2a2a',
  white:       '#e6e6e6',
  skin:        '#d9a066',
  brownLight:  '#a06a3a',
  brownDark:   '#5c3a1e',
};
const SKIN_NAMES = {
  red: 'Kırmızı', orange: 'Turuncu', yellow: 'Sarı', green: 'Yeşil',
  blue: 'Mavi', purple: 'Mor', pink: 'Pembe', black: 'Siyah',
  white: 'Beyaz', skin: 'Ten', brownLight: 'Açık Kahve', brownDark: 'Koyu Kahve',
};

// ---- Silah gorselleri (elde tutulan PNG) ----
// offsetX/offsetY: karakterin ayak-orta noktasina (cx, bottomY) gore konum, saga bakarken.
// width: gorselin ekranda kac piksel genislikte cizilecegi (oran korunur). Ince ayar icin bu sayilari degistir.
const WEAPON_SPRITES = {
  pistol:  { src: '/assets/weapons/pistol.png',  offsetX: 0,   offsetY: -28, width: 30 },
  smg:     { src: '/assets/weapons/smg.png',     offsetX: -10, offsetY: -45, width: 60 },
  shotgun: { src: '/assets/weapons/shotgun.png', offsetX: -20, offsetY: -26, width: 70 },
  sniper:  { src: '/assets/weapons/sniper.png',  offsetX: -10, offsetY: -30, width: 80 },
  rocket:  { src: '/assets/weapons/rocket.png',  offsetX: -33, offsetY: -36, width: 80 },
  grenade: { src: '/assets/weapons/grenade.png', offsetX: 8,   offsetY: -34, width: 16 },
};
const weaponImages = {};
Object.entries(WEAPON_SPRITES).forEach(([key, cfg]) => {
  const img = new Image();
  img.src = cfg.src; // dosya henuz yoksa sessizce yuklenmez, oyun bozulmaz
  weaponImages[key] = img;
});
const WALK_FRAME_COUNT = 4;
const walkFramesRaw = [];
const tintedCache = {};
let framesLoadedCount = 0;

for (let i = 1; i <= WALK_FRAME_COUNT; i++) {
  const img = new Image();
  img.onload = () => {
    framesLoadedCount++;
    if (framesLoadedCount === WALK_FRAME_COUNT) {
      precomputeTints();
      if (typeof drawAvatarPreview === 'function') drawAvatarPreview();
    }
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

const portraitUrlCache = {};
function getSkinPortraitUrl(skin) {
  const key = skin || 'blue';
  if (portraitUrlCache[key]) return portraitUrlCache[key];
  const c = getTintedFrame(key, 0);
  if (!c) return null;
  const url = c.toDataURL();
  portraitUrlCache[key] = url;
  return url;
}

let playerVisual = {};
let remoteMoveInfo = {};

// ---- HUD kartlari ----
const hudCardEls = {}; // playerId -> {root, portrait, name, lives, weapon, bar}
function initHudCards() {
  const container = document.getElementById('hudCards');
  container.innerHTML = '';
  Object.keys(hudCardEls).forEach(k => delete hudCardEls[k]);
  Object.entries(gamePlayers).forEach(([id, p]) => {
    const root = document.createElement('div');
    const isFFA = currentMatchMode === 'ffa';
    root.className = 'hud-card' + (isFFA ? '' : ' team-' + (p.team || 'red'));
    if (isFFA) root.style.borderTopColor = SKIN_COLORS[p.skin] || '#999';
    root.innerHTML = `
      <div class="hud-card-top">
        <div class="hud-card-portrait"></div>
        <div class="hud-card-nameblock">
          <div class="hud-card-name">${escapeHtml(p.name || '')}</div>
          <div class="hud-card-lives">3</div>
        </div>
      </div>
      <div class="hud-card-weapon">Pistol</div>
      <div class="hud-card-healthbar-wrap"><div class="hud-card-healthbar"></div></div>
    `;
    container.appendChild(root);
    hudCardEls[id] = {
      root,
      portrait: root.querySelector('.hud-card-portrait'),
      lives: root.querySelector('.hud-card-lives'),
      bar: root.querySelector('.hud-card-healthbar'),
      weapon: root.querySelector('.hud-card-weapon'),
    };
    const url = getSkinPortraitUrl(p.skin);
    if (url) hudCardEls[id].portrait.style.backgroundImage = `url(${url})`;
  });
}

function updateHudCards() {
  Object.entries(gamePlayers).forEach(([id, p]) => {
    if (!hudCardEls[id]) return; // yeni katilan biri varsa bir sonraki gameStarting'de eklenecek
    const els = hudCardEls[id];
    const health = typeof p.health === 'number' ? p.health : 100;
    const stocks = typeof p.stocks === 'number' ? p.stocks : 3;
    els.lives.textContent = stocks;
    els.lives.classList.toggle('zero', stocks <= 0);
    els.bar.style.width = Math.max(0, health) + '%';
    const hue = Math.max(0, Math.min(120, health * 1.2));
    els.bar.style.background = `hsl(${hue}, 70%, 45%)`;
    els.root.classList.toggle('eliminated', !!p.eliminated);
    const wep = CLIENT_WEAPONS[p.weapon] || CLIENT_WEAPONS.pistol;
    const ammoText = (typeof p.ammo === 'number' && p.ammo !== Infinity && isFinite(p.ammo)) ? p.ammo : '∞';
    els.weapon.textContent = `${wep.name} · ${ammoText}`;
  });
}

function updateTimerDisplay() {
  const el = document.getElementById('hudTimerText');
  if (!el) return;
  if (!matchTimeLimitSec) { el.textContent = '∞'; return; }
  const elapsed = (performance.now() - matchStartTime) / 1000;
  const remaining = Math.max(0, Math.ceil(matchTimeLimitSec - elapsed));
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  el.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
}

// ---- Silahlar (hasar/knockback sunucuda; burada gorsel+zamanlama parametreleri) ----
const CLIENT_WEAPONS = {
  pistol:  { name: 'Pistol',  fireRateMs: 333,  bulletSpeed: 700,  lifespanMs: 1000, color: '#fff566', size: 3.5 },
  smg:     { name: 'SMG',     fireRateMs: 100,  bulletSpeed: 750,  lifespanMs: 900,  color: '#cfe8ff', size: 2.5, auto: true },
  shotgun: { name: 'Shotgun', fireRateMs: 800,  bulletSpeed: 550,  lifespanMs: 500,  color: '#ffb066', size: 3,   pelletCount: 5, spreadDeg: 26 },
  sniper:  { name: 'Sniper',  fireRateMs: 1400, bulletSpeed: 1500, lifespanMs: 900,  color: '#ffffff', size: 2.2, trail: true },
  rocket:  { name: 'Roket',   fireRateMs: 1200, bulletSpeed: 420,  lifespanMs: 2000, color: '#ff8a3d', size: 7,   explosive: true, explosionRadius: 110 },
  grenade: { name: 'Granat',  fireRateMs: 1100, bulletSpeed: 480,  lifespanMs: 1400, color: '#8fd15a', size: 6,   explosive: true, explosionRadius: 100, arcing: true },
};
let bullets = []; // {id, ownerId, x, y, vx, vy, spawnTime, weapon, explosive}
let lastFireTime = -9999;
let bulletIdCounter = 0;
let myWeapon = 'pistol';
let myAmmo = Infinity;
let activeCrates = {};
let explosionFx = []; // {x,y,startTime}

function isTypingInInput() {
  const t = document.activeElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

let shiftHeld = false;
let dodgeRequested = false;

window.addEventListener('keydown', (e) => {
  if (isTypingInInput()) return; // chat'e yaziyorsa oyun tuslarini yok say
  if (e.code === 'ShiftLeft' && !shiftHeld) {
    shiftHeld = true;
    dodgeRequested = true;
  }
  const k = e.key.toLowerCase();
  if (!(k in keys)) return;
  if (k === 'w' && !keys.w) jumpRequested = true;
  if (k === 's' && !keys.s) dropRequested = true;
  if (k === 'u' && !keys.u) fireRequested = true;
  keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  if (isTypingInInput()) return;
  if (e.code === 'ShiftLeft') shiftHeld = false;
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
});

// Sekme arka plana geçince/pencere odak kaybedince basili tuslar "takili" kalabiliyor - guvenlik icin sifirla
function releaseAllKeys() {
  keys.w = false; keys.a = false; keys.s = false; keys.d = false; keys.u = false;
  shiftHeld = false;
}
window.addEventListener('blur', releaseAllKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllKeys();
});

// ---- Chat ----
let chatMessages = [];

function appendChatMessage(msg) {
  chatMessages.push(msg);
  if (chatMessages.length > 50) chatMessages.shift();
  renderChatMessages('lobbyChatMessages');
  renderChatMessages('gameChatMessages');
  flashChatVisible();
}

function renderChatMessages(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = chatMessages.map(m => `<div class="chat-line"><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function flashChatVisible() {
  const el = document.getElementById('hudChat');
  if (!el) return;
  el.classList.add('chat-visible');
  clearTimeout(flashChatVisible._t);
  flashChatVisible._t = setTimeout(() => {
    if (document.activeElement !== document.getElementById('gameChatInput')) {
      el.classList.remove('chat-visible');
    }
  }, 4000);
}

function setupChatInput(inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) socket.emit('chatMessage', text);
      inputEl.value = '';
      inputEl.blur();
    } else if (e.key === 'Escape') {
      inputEl.value = '';
      inputEl.blur();
    }
  });
  inputEl.addEventListener('focus', () => {
    if (inputEl.id === 'gameChatInput') flashChatVisible();
  });
}
setupChatInput(document.getElementById('lobbyChatInput'));
setupChatInput(document.getElementById('gameChatInput'));

socket.on('chatMessage', (msg) => appendChatMessage(msg));

// Enter'a basinca (bir input'a yazmiyorsak) mevcut ekranin chat kutusunu ac
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || isTypingInInput()) return;
  const gameVisible = !document.getElementById('screen-game').classList.contains('hidden');
  const lobbyVisible = !document.getElementById('screen-lobby').classList.contains('hidden');
  if (gameVisible) {
    document.getElementById('gameChatInput').focus();
  } else if (lobbyVisible) {
    document.getElementById('lobbyChatInput').focus();
  }
});

socket.on('gameStarting', (data) => {
  gamePlayers = data.players || {};
  currentMap = data.map || null;
  mapBgImage = null;
  bullets = [];
  activeCrates = {};
  explosionFx = [];
  if (currentMap && currentMap.image) {
    const img = new Image();
    img.onload = () => { mapBgImage = img; };
    img.src = currentMap.image;
  }
  if (gamePlayers[socket.id]) {
    myPos.x = gamePlayers[socket.id].x;
    myPos.y = gamePlayers[socket.id].y;
    myWeapon = gamePlayers[socket.id].weapon || 'pistol';
    myAmmo = typeof gamePlayers[socket.id].ammo === 'number' ? gamePlayers[socket.id].ammo : Infinity;
  } else {
    myPos.x = WORLD_W / 2;
    myPos.y = WORLD_H / 2;
    myWeapon = 'pistol';
    myAmmo = Infinity;
  }
  myVel.x = 0; myVel.y = 0;
  onGround = false;
  dropThroughUntil = 0;
  stunUntil = 0;
  amEliminated = false;
  matchEndedInfo = null;
  matchStartTime = performance.now();
  matchTimeLimitSec = (data.settings && data.settings.timeLimit) ? data.settings.timeLimit * 60 : 0;
  currentMatchMode = (data.settings && data.settings.mode) || 'teams';
  initHudCards();
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
  if (gamePlayers[socket.id]) {
    myWeapon = gamePlayers[socket.id].weapon || 'pistol';
    myAmmo = typeof gamePlayers[socket.id].ammo === 'number' ? gamePlayers[socket.id].ammo : Infinity;
  }
});

socket.on('crateSpawned', (crate) => { activeCrates[crate.id] = crate; });
socket.on('crateRemoved', ({ crateId }) => { delete activeCrates[crateId]; });

// Baskasi ates etti
socket.on('playerShot', (data) => {
  if (data.weapon === 'shotgun') {
    spawnShotgunPellets(data.id, data.shooterId, data.x, data.y, data.dirX);
  } else {
    spawnBullet(data.id, data.shooterId, data.x, data.y, data.dirX, data.weapon);
  }
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
let matchStartTime = 0;
let matchTimeLimitSec = 0;
let currentMatchMode = 'teams';

socket.on('matchEnded', (data) => {
  matchEndedInfo = data;
  setTimeout(() => {
    matchEndedInfo = null;
    if (currentRoomId) enterLobby();
  }, 4000);
});


function spawnBullet(id, ownerId, x, y, dirX, weaponKey) {
  const wep = CLIENT_WEAPONS[weaponKey] || CLIENT_WEAPONS.pistol;
  bullets.push({
    id, ownerId, x, y,
    vx: dirX * wep.bulletSpeed,
    vy: 0,
    spawnTime: performance.now(),
    weapon: weaponKey || 'pistol',
    explosive: !!wep.explosive,
    arcing: !!wep.arcing,
  });
}

function spawnShotgunPellets(baseId, ownerId, x, y, dirX) {
  const wep = CLIENT_WEAPONS.shotgun;
  const n = wep.pelletCount;
  for (let i = 0; i < n; i++) {
    const spreadFrac = n === 1 ? 0 : (i / (n - 1)) - 0.5; // -0.5 .. 0.5
    const angleDeg = spreadFrac * wep.spreadDeg;
    const angleRad = angleDeg * Math.PI / 180;
    const vx = dirX * Math.cos(angleRad) * wep.bulletSpeed;
    const vy = Math.sin(angleRad) * wep.bulletSpeed;
    bullets.push({
      id: baseId + '_p' + i, ownerId, x, y, vx, vy,
      spawnTime: performance.now(),
      weapon: 'shotgun', explosive: false, arcing: false,
    });
  }
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

const CRATE_SIZE = 26;
function checkCratePickup() {
  Object.values(activeCrates).forEach(c => {
    const overlap = myPos.x < c.x + CRATE_SIZE / 2 && myPos.x + SQUARE > c.x - CRATE_SIZE / 2 &&
      myPos.y < c.y + CRATE_SIZE / 2 && myPos.y + SQUARE > c.y - CRATE_SIZE / 2;
    if (overlap) socket.emit('pickupCrate', { crateId: c.id });
  });
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
    // Havadayken S basiliysa (platforma hic degmeden geliyorsa) direkt gec
    const droppingThrough = (now < dropThroughUntil) || (keys.s && !onGround);

    // ---- Dodge / kisa sureli dokunulmazlik (Sol Shift) ----
    if (dodgeRequested) {
      dodgeRequested = false;
      if (now - lastDodgeTimeLocal > DODGE_COOLDOWN_MS) {
        lastDodgeTimeLocal = now;
        socket.emit('activateDodge');
      }
    }

    // ---- Ziplama ----
    if (jumpRequested) {
      jumpRequested = false;
      if (onGround) {
        myVel.y = JUMP_VELOCITY;
        onGround = false;
      }
    }

    // ---- Ates (U) ----
    const currentWep = CLIENT_WEAPONS[myWeapon] || CLIENT_WEAPONS.pistol;
    const wantsToFire = fireRequested || (currentWep.auto && keys.u);
    if (wantsToFire) {
      fireRequested = false;
      const hasAmmo = myAmmo === Infinity || myAmmo > 0;
      if (hasAmmo && now - lastFireTime > currentWep.fireRateMs) {
        lastFireTime = now;
        const vs = playerVisual[socket.id];
        const facing = vs ? vs.facing : 1;
        const spawnX = myPos.x + SQUARE / 2 + facing * (SQUARE / 2 + 4);
        const spawnY = myPos.y + SQUARE * 0.4;
        const bulletId = socket.id + '_' + (bulletIdCounter++);
        if (myWeapon === 'shotgun') {
          spawnShotgunPellets(bulletId, socket.id, spawnX, spawnY, facing);
        } else {
          spawnBullet(bulletId, socket.id, spawnX, spawnY, facing, myWeapon);
        }
        socket.emit('playerShoot', { id: bulletId, x: spawnX, y: spawnY, dirX: facing, weapon: myWeapon });
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
    checkCratePickup();

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
  updateHudCards();
  updateTimerDisplay();
  renderGame();
  requestAnimationFrame(gameLoop);
}

function triggerExplosion(b) {
  const wep = CLIENT_WEAPONS[b.weapon] || CLIENT_WEAPONS.rocket;
  const radius = wep.explosionRadius || 100;
  const targets = [];
  if (b.ownerId === socket.id) {
    for (const [id, p] of Object.entries(gamePlayers)) {
      if (id === socket.id) continue;
      if (p.eliminated || p.invulnerable) continue;
      const cx = p.x + SQUARE / 2;
      const cy = p.y + SQUARE / 2 - DRAW_H / 2 + SQUARE / 2;
      const dist = Math.hypot(cx - b.x, cy - b.y);
      if (dist <= radius) {
        targets.push({ id, dirX: (cx - b.x) >= 0 ? 1 : -1 });
      }
    }
    socket.emit('explosionHit', { targets, x: b.x, y: b.y, weapon: b.weapon, bulletId: b.id });
  }
  explosionFx.push({ x: b.x, y: b.y, startTime: performance.now(), radius });
}

socket.on('explosionFx', ({ x, y }) => {
  explosionFx.push({ x, y, startTime: performance.now(), radius: 100 });
});

function updateBullets(dt, now) {
  const solidPlatforms = getPlatforms().filter(pl => pl.h > 20);
  bullets = bullets.filter(b => {
    const wep = CLIENT_WEAPONS[b.weapon] || CLIENT_WEAPONS.pistol;
    if (now - b.spawnTime > wep.lifespanMs) {
      if (b.explosive) triggerExplosion(b);
      return false;
    }
    if (b.arcing) b.vy += GRAVITY * dt; // granat yercekimine tabi
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < -20 || b.x > WORLD_W + 20 || b.y > WORLD_H + 20) return false;
    if (b.y < -20 && !b.arcing) return false;

    // Kati platforma carpma
    for (const pl of solidPlatforms) {
      if (b.x > pl.x && b.x < pl.x + pl.w && b.y > pl.y && b.y < pl.y + pl.h) {
        if (b.explosive) triggerExplosion(b);
        return false;
      }
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
          if (b.explosive) {
            triggerExplosion(b);
          } else {
            socket.emit('playerHit', { targetId: id, dirX: b.vx >= 0 ? 1 : -1, weapon: b.weapon, bulletId: b.id });
          }
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
    drawAppearanceLayers(ctx, p, DRAW_W, DRAW_H);
    const wepSprite = WEAPON_SPRITES[p.weapon];
    const wepImg = weaponImages[p.weapon];
    if (wepSprite && wepImg && wepImg.complete && wepImg.naturalWidth > 0) {
      const ratio = wepSprite.width / wepImg.naturalWidth;
      const wH = wepImg.naturalHeight * ratio;
      ctx.drawImage(wepImg, wepSprite.offsetX, wepSprite.offsetY, wepSprite.width, wH);
    }
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, cx, bottomY - DRAW_H - 6);

  });

  // ---- Kutular ----
  Object.values(activeCrates).forEach(c => {
    const bob = Math.sin(performance.now() / 300 + c.x) * 3;
    ctx.fillStyle = '#3a2a18';
    ctx.strokeStyle = '#c9a05a';
    ctx.lineWidth = 2;
    ctx.fillRect(c.x - CRATE_SIZE / 2, c.y - CRATE_SIZE / 2 + bob, CRATE_SIZE, CRATE_SIZE);
    ctx.strokeRect(c.x - CRATE_SIZE / 2, c.y - CRATE_SIZE / 2 + bob, CRATE_SIZE, CRATE_SIZE);
    ctx.fillStyle = '#f0c040';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    const label = (CLIENT_WEAPONS[c.weapon] && CLIENT_WEAPONS[c.weapon].name.slice(0, 3).toUpperCase()) || '?';
    ctx.fillText(label, c.x, c.y + 3 + bob);
  });

  // ---- Mermiler ----
  bullets.forEach(b => {
    const wep = CLIENT_WEAPONS[b.weapon] || CLIENT_WEAPONS.pistol;
    ctx.fillStyle = wep.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const angle = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(angle);
    ctx.ellipse(0, 0, wep.size * 2, wep.size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  // ---- Patlama efektleri ----
  const nowFx = performance.now();
  explosionFx = explosionFx.filter(fx => nowFx - fx.startTime < 400);
  explosionFx.forEach(fx => {
    const t = (nowFx - fx.startTime) / 400;
    const r = fx.radius * (0.3 + t * 0.9);
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 150, 40, ${0.55 * (1 - t)})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 220, 120, ${0.8 * (1 - t)})`;
    ctx.lineWidth = 3;
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
    let text;
    if (matchEndedInfo.mode === 'ffa') {
      text = (w === 'draw' || !matchEndedInfo.winnerName) ? 'Berabere!' : `${matchEndedInfo.winnerName} Kazandı!`;
    } else {
      text = w === 'draw' ? 'Berabere!' : (w === 'red' ? 'Kırmızı Takım Kazandı!' : 'Mavi Takım Kazandı!');
    }
    ctx.fillText(text, WORLD_W / 2, WORLD_H / 2 + 10);
  }
}

// ---- Sayfa yuklendiginde ilk kez renk secici ve onizlemeyi ciz ----
renderColorRow();
drawAvatarPreview();
loadAllAppearanceLists(); // herkesin kiyafet/aksesuar gorsellerini onceden yukle (baskalarinda gorebilmek icin)
