const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;

let bgImage = null;
let currentTool = 'select';
let platforms = []; // {id,x,y,w,h}
let spawns = { red: [], blue: [] }; // {id,x,y}
let nextId = 1;

let selected = null; // {type:'platform'|'spawn', team?, id}
let dragMode = null; // 'move' | 'resize' | 'draw'
let dragStart = null; // {x,y}
let dragOrig = null;

function uid() { return nextId++; }

// ---- Coordinate helpers ----
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

// ---- Toolbar ----
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    selected = null;
    renderSidebar();
    redraw();
  });
});
document.querySelector('.tool-btn[data-tool="select"]').classList.add('active');

document.getElementById('bgUpload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => { bgImage = img; redraw(); };
  img.src = URL.createObjectURL(file);
});

document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement.tagName !== 'INPUT') {
    deleteSelected();
  }
});

function deleteSelected() {
  if (!selected) return;
  if (selected.type === 'platform') {
    platforms = platforms.filter(p => p.id !== selected.id);
  } else if (selected.type === 'spawn') {
    spawns[selected.team] = spawns[selected.team].filter(s => s.id !== selected.id);
  }
  selected = null;
  renderSidebar();
  redraw();
}

// ---- Mouse interaction ----
function hitTestPlatform(pos) {
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    if (pos.x >= p.x && pos.x <= p.x + p.w && pos.y >= p.y && pos.y <= p.y + p.h) return p;
  }
  return null;
}
function hitTestResizeHandle(pos, p) {
  const hx = p.x + p.w, hy = p.y + p.h;
  return Math.abs(pos.x - hx) < 10 && Math.abs(pos.y - hy) < 10;
}
function hitTestSpawn(pos, team) {
  return spawns[team].find(s => Math.hypot(s.x - pos.x, s.y - pos.y) < 12);
}

canvas.addEventListener('mousedown', (e) => {
  const pos = getCanvasPos(e);

  if (currentTool === 'platform') {
    dragMode = 'draw';
    dragStart = pos;
    dragOrig = { x: pos.x, y: pos.y, w: 0, h: 0 };
    return;
  }
  if (currentTool === 'spawn-red' || currentTool === 'spawn-blue') {
    const team = currentTool === 'spawn-red' ? 'red' : 'blue';
    const s = { id: uid(), x: pos.x, y: pos.y };
    spawns[team].push(s);
    selected = { type: 'spawn', team, id: s.id };
    renderSidebar();
    redraw();
    return;
  }
  // select tool
  const p = hitTestPlatform(pos);
  if (p && hitTestResizeHandle(pos, p)) {
    selected = { type: 'platform', id: p.id };
    dragMode = 'resize';
    dragOrig = { ...p };
    dragStart = pos;
    renderSidebar();
    return;
  }
  const rSpawn = hitTestSpawn(pos, 'red');
  const bSpawn = hitTestSpawn(pos, 'blue');
  if (rSpawn || bSpawn) {
    const team = rSpawn ? 'red' : 'blue';
    const s = rSpawn || bSpawn;
    selected = { type: 'spawn', team, id: s.id };
    dragMode = 'move';
    dragOrig = { ...s };
    dragStart = pos;
    renderSidebar();
    redraw();
    return;
  }
  if (p) {
    selected = { type: 'platform', id: p.id };
    dragMode = 'move';
    dragOrig = { ...p };
    dragStart = pos;
    renderSidebar();
    redraw();
    return;
  }
  selected = null;
  renderSidebar();
  redraw();
});

canvas.addEventListener('mousemove', (e) => {
  if (!dragMode) return;
  const pos = getCanvasPos(e);
  const dx = pos.x - dragStart.x;
  const dy = pos.y - dragStart.y;

  if (dragMode === 'draw') {
    dragOrig.w = pos.x - dragStart.x;
    dragOrig.h = pos.y - dragStart.y;
    redraw(true);
    return;
  }
  if (selected && selected.type === 'platform') {
    const p = platforms.find(pl => pl.id === selected.id);
    if (!p) return;
    if (dragMode === 'move') {
      p.x = clamp(dragOrig.x + dx, 0, W - p.w);
      p.y = clamp(dragOrig.y + dy, 0, H - p.h);
    } else if (dragMode === 'resize') {
      p.w = clamp(dragOrig.w + dx, 20, W - p.x);
      p.h = clamp(dragOrig.h + dy, 10, H - p.y);
    }
    renderSidebar();
    redraw();
  } else if (selected && selected.type === 'spawn') {
    const s = spawns[selected.team].find(sp => sp.id === selected.id);
    if (!s) return;
    s.x = clamp(dragOrig.x + dx, 0, W);
    s.y = clamp(dragOrig.y + dy, 0, H);
    renderSidebar();
    redraw();
  }
});

canvas.addEventListener('mouseup', () => {
  if (dragMode === 'draw') {
    let { x, y, w, h } = dragOrig;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (w > 8 && h > 8) {
      const p = { id: uid(), x: clamp(x,0,W), y: clamp(y,0,H), w: Math.min(w, W), h: Math.min(h, H) };
      platforms.push(p);
      selected = { type: 'platform', id: p.id };
      renderSidebar();
    }
  }
  dragMode = null;
  dragStart = null;
  dragOrig = null;
  redraw();
});
canvas.addEventListener('mouseleave', () => {
  if (dragMode === 'draw') { dragMode = null; redraw(); }
});

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// ---- Rendering ----
function redraw(drawingPreview) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#223522';
  ctx.fillRect(0, 0, W, H);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, W, H);

  platforms.forEach(p => {
    const isSel = selected && selected.type === 'platform' && selected.id === p.id;
    ctx.fillStyle = isSel ? 'rgba(240,192,64,0.35)' : 'rgba(80,200,120,0.3)';
    ctx.strokeStyle = isSel ? '#f0c040' : '#4fae6a';
    ctx.lineWidth = 2;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    if (isSel) {
      ctx.fillStyle = '#f0c040';
      ctx.fillRect(p.x + p.w - 6, p.y + p.h - 6, 12, 12);
    }
  });

  if (drawingPreview && dragMode === 'draw') {
    let { x, y, w, h } = dragOrig;
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  drawSpawns('red', '#e05c3f');
  drawSpawns('blue', '#4a90d9');
}

function drawSpawns(team, color) {
  spawns[team].forEach(s => {
    const isSel = selected && selected.type === 'spawn' && selected.team === team && selected.id === s.id;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = isSel ? '#f0c040' : '#fff';
    ctx.lineWidth = isSel ? 3 : 1.5;
    ctx.stroke();
  });
}

// ---- Sidebar ----
function renderSidebar() {
  document.getElementById('platformCount').textContent = platforms.length;
  document.getElementById('redCount').textContent = spawns.red.length;
  document.getElementById('blueCount').textContent = spawns.blue.length;

  const pList = document.getElementById('platformList');
  pList.innerHTML = '';
  platforms.forEach(p => {
    const row = document.createElement('div');
    row.className = 'entity-row' + (selected && selected.type === 'platform' && selected.id === p.id ? ' selected' : '');
    row.innerHTML = `
      x:<input type="number" value="${Math.round(p.x)}" data-f="x">
      y:<input type="number" value="${Math.round(p.y)}" data-f="y">
      w:<input type="number" value="${Math.round(p.w)}" data-f="w">
      h:<input type="number" value="${Math.round(p.h)}" data-f="h">
      <button class="del-btn">✕</button>
    `;
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        p[inp.dataset.f] = parseFloat(inp.value) || 0;
        redraw();
      });
    });
    row.querySelector('.del-btn').addEventListener('click', () => {
      platforms = platforms.filter(pl => pl.id !== p.id);
      if (selected && selected.id === p.id) selected = null;
      renderSidebar(); redraw();
    });
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      selected = { type: 'platform', id: p.id };
      renderSidebar(); redraw();
    });
    pList.appendChild(row);
  });

  renderSpawnList('red');
  renderSpawnList('blue');
}

function renderSpawnList(team) {
  const list = document.getElementById(team + 'SpawnList');
  list.innerHTML = '';
  spawns[team].forEach(s => {
    const row = document.createElement('div');
    row.className = 'entity-row' + (selected && selected.type === 'spawn' && selected.team === team && selected.id === s.id ? ' selected' : '');
    row.innerHTML = `
      x:<input type="number" value="${Math.round(s.x)}" data-f="x">
      y:<input type="number" value="${Math.round(s.y)}" data-f="y">
      <button class="del-btn">✕</button>
    `;
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        s[inp.dataset.f] = parseFloat(inp.value) || 0;
        redraw();
      });
    });
    row.querySelector('.del-btn').addEventListener('click', () => {
      spawns[team] = spawns[team].filter(sp => sp.id !== s.id);
      if (selected && selected.id === s.id) selected = null;
      renderSidebar(); redraw();
    });
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      selected = { type: 'spawn', team, id: s.id };
      renderSidebar(); redraw();
    });
    list.appendChild(row);
  });
}

// ---- Export / Import ----
document.getElementById('btnExport').addEventListener('click', () => {
  const data = {
    name: document.getElementById('mapName').value.trim() || 'Harita',
    width: W,
    height: H,
    platforms: platforms.map(({ x, y, w, h }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })),
    spawns: {
      red: spawns.red.map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })),
      blue: spawns.blue.map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })),
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (data.name || 'harita').replace(/[^a-z0-9_\-ığüşöçİĞÜŞÖÇ]/gi, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('İndirildi: ' + a.download + ' — arka plan resmini de aynı isimle (.png) ayrıca kaydet.');
});

document.getElementById('jsonUpload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      document.getElementById('mapName').value = data.name || 'Harita';
      platforms = (data.platforms || []).map(p => ({ id: uid(), ...p }));
      spawns.red = (data.spawns?.red || []).map(s => ({ id: uid(), ...s }));
      spawns.blue = (data.spawns?.blue || []).map(s => ({ id: uid(), ...s }));
      selected = null;
      renderSidebar();
      redraw();
      showToast('Harita verisi yüklendi, arka planı da yüklemeyi unutma.');
    } catch (err) {
      showToast('JSON okunamadı: ' + err.message);
    }
  };
  reader.readAsText(file);
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

redraw();
renderSidebar();
