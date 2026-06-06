// @ts-check
/**
 * LUMORA playable prototype — client.
 *
 * Two things worth noting for reviewers:
 *  1. The Generator tab imports the SAME genome module the server runs
 *     (`/core/genome.js`). The instant in-browser preview is byte-for-byte
 *     identical to what the authoritative server would produce — this is the core
 *     advantage of the deterministic generative design.
 *  2. Everything stateful (currency, garden, collection, breeding) goes through the
 *     HTTP API so the server stays authoritative (anti-cheat, cross-device).
 */

import { generateLumi, breedLumi, decodeSeedCode } from '/core/genome.js';
import { drawLumi } from '/web/lumi-render.js';

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const $$ = (sel) => /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(sel));

const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic' };
const ELEMENT_EMOJI = { sun: '☀️', moon: '🌙', water: '💧', earth: '🌿', spark: '⚡', bloom: '🌸' };

const state = {
  pid: localStorage.getItem('lumora_pid') || null,
  token: localStorage.getItem('lumora_token') || null,
  deviceId: localStorage.getItem('lumora_device') || null,
  player: null,
  catalog: null,
  collection: [],
  breedPick: { a: null, b: null },
};

/* ------------------------------ API helpers ------------------------------ */
async function api(path, method = 'GET', body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || res.statusText), { code: data?.error?.code, status: res.status });
  return data;
}

function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* ------------------------------- bootstrap ------------------------------- */
async function boot() {
  // Try to resume the existing session; if the token is missing/expired, re-auth
  // as a guest using the stored device id (so the same account is recovered).
  let resumed = false;
  if (state.pid && state.token) {
    try { state.player = (await api(`/api/players/${state.pid}`)).player; resumed = true; }
    catch (e) { if (e.status === 401) { state.token = null; } }
  }
  if (!resumed) {
    const r = await api('/api/auth/guest', 'POST', state.deviceId ? { deviceId: state.deviceId } : {});
    state.pid = r.player.id;
    state.token = r.token;
    state.deviceId = r.deviceId;
    localStorage.setItem('lumora_pid', state.pid);
    localStorage.setItem('lumora_token', state.token);
    localStorage.setItem('lumora_device', state.deviceId);
    state.player = r.player;
    if (r.created) toast('Welcome to LUMORA! Two starter Lumi await in your Collection.');
  }
  state.catalog = (await api('/api/catalog'));
  syncHeader();
  setupTabs();
  setupGenerator();
  setupDailyButton();
  await Promise.all([loadGarden(), loadCollection(), loadWorld()]);
  startClock();
  setupRealtime();
}

/* ----------------------------- realtime (WS) ----------------------------- */
// Optional live updates: the shared Great Bloom bar moves in real time and a toast
// pops when a neighbour visits you. Entirely non-fatal — if WS is unavailable the
// REST-driven prototype works exactly as before.
function setupRealtime() {
  if (!('WebSocket' in window) || !state.token) return;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'world') {
        const pct = Math.round(m.bloomLevel);
        const fill = $('#bloom-fill'); if (fill) fill.style.width = pct + '%';
        const label = $('#bloom-label'); if (label) label.textContent = `Great Bloom ${pct}% · ${fmt(m.totalLumiHatched)} Lumi hatched worldwide`;
      } else if (m.type === 'visit') {
        toast(`🌸 ${m.from} visited your garden!`);
      }
    });
    ws.addEventListener('error', () => { /* realtime is optional; ignore */ });
    state.ws = ws;
  } catch { /* realtime is optional */ }
}

function syncHeader() {
  const p = state.player;
  $('#w-petals').textContent = fmt(p.wallet.petals);
  $('#w-lumen').textContent = fmt(p.wallet.lumen);
  $('#w-level').textContent = p.level?.level ?? 1;
  $('#w-streak').textContent = p.streak ?? 0;
}

async function refreshPlayer() {
  state.player = (await api(`/api/players/${state.pid}`)).player;
  syncHeader();
}

/* -------------------------------- tabs ----------------------------------- */
function setupTabs() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'collection') loadCollection();
    if (tab.dataset.tab === 'breed') renderBreedPicker();
    if (tab.dataset.tab === 'social') loadWorld();
    if (tab.dataset.tab === 'garden') loadGarden();
  }));
}

/* ----------------------------- daily reward ------------------------------ */
function setupDailyButton() {
  $('#daily-btn').addEventListener('click', async () => {
    try {
      const r = await api(`/api/players/${state.pid}/daily`, 'POST');
      if (r.claimed) toast(`Daily reward: 🌸 ${r.reward.petals}${r.reward.lumen ? ` + ✦ ${r.reward.lumen}` : ''} — streak ${r.streak}!`);
      else toast('Already claimed today — come back tomorrow!');
      await refreshPlayer();
    } catch (e) { toast(e.message); }
  });
}

/* ------------------------------ GENERATOR -------------------------------- */
let genGenome = null;
function setupGenerator() {
  const reroll = () => {
    const seed = (Math.random() * 4294967296) >>> 0;
    $('#gen-seedinput').value = String(seed);
    regen(seed);
  };
  const ctxFromUI = () => ({
    biome: $('#gen-biome').value || undefined,
    bloomLevel: Number($('#gen-bloom').value),
    careQuality: Number($('#gen-care').value) / 100,
    season: state.player?.garden?.season || 'spring',
  });
  const regen = (seedInput) => {
    let seed = seedInput;
    if (seed == null) {
      const raw = $('#gen-seedinput').value.trim();
      if (/^LUMI-/i.test(raw)) { try { seed = decodeSeedCode(raw); } catch { toast('Bad seed code'); return; } }
      else if (raw !== '' && !Number.isNaN(Number(raw))) seed = Number(raw) >>> 0;
      else seed = (Math.random() * 4294967296) >>> 0;
    }
    genGenome = generateLumi(seed, ctxFromUI());
    paintGenInfo(genGenome);
  };
  $('#gen-reroll').addEventListener('click', reroll);
  $('#gen-copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(genGenome.seedCode);
    toast(`Copied ${genGenome.seedCode}`);
  });
  ['gen-biome', 'gen-bloom', 'gen-care'].forEach((id) => $(`#${id}`).addEventListener('input', () => regen(genGenome?.seed)));
  $('#gen-seedinput').addEventListener('change', () => regen());
  reroll();
  animateGen();
}

function paintGenInfo(g) {
  $('#gen-name').textContent = g.name;
  $('#gen-seedcode').textContent = g.seedCode;
  $('#gen-desc').textContent = describe(g);
  $('#gen-badges').innerHTML = badgeHtml(g);
  $('#gen-stats').innerHTML = `
    <tr><td>🌟 Charm</td><td>${g.stats.charm}</td></tr>
    <tr><td>💪 Vigor</td><td>${g.stats.vigor}</td></tr>
    <tr><td>🍃 Harmony</td><td>${g.stats.harmony}</td></tr>
    <tr><td>✨ Spark</td><td>${g.stats.spark}</td></tr>
    <tr><td>Power</td><td>${g.power}</td></tr>`;
}

function animateGen() {
  const cv = /** @type {HTMLCanvasElement} */ ($('#gen-canvas'));
  const ctx = cv.getContext('2d');
  const loop = (t) => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (genGenome) drawLumi(ctx, genGenome, { x: cv.width / 2, y: cv.height / 2 + 10, r: 110, t });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* -------------------------------- GARDEN --------------------------------- */
async function loadGarden() {
  const { garden } = await api(`/api/players/${state.pid}/garden`);
  state.garden = garden;
  $('#garden-biome').textContent = '· ' + (state.catalog.biomes.find((b) => b.id === garden.biome)?.label || garden.biome);
  renderPlots();
  renderSeedShop();
}

function renderPlots() {
  const wrap = $('#plots');
  wrap.innerHTML = '';
  for (const plot of state.garden.plots) {
    const el = document.createElement('div');
    el.className = 'plot' + (plot.state === 'empty' ? ' empty' : '');
    if (plot.state === 'empty') {
      el.innerHTML = `<div>Empty plot</div><div class="muted tiny">Buy & plant a seed →</div>`;
    } else if (plot.state === 'growing') {
      const plant = state.catalog.plants.find((p) => p.id === plot.plantId);
      el.innerHTML = `<div>🌱 ${plant?.label || plot.plantId}</div>
        <div class="timer" data-ready="${Date.now() + plot.secondsLeft * 1000}">${mmss(plot.secondsLeft)}</div>
        <button class="btn small" data-water="${plot.index}">💧 Water (${plot.watered}/3)</button>`;
    } else {
      el.innerHTML = `<div>✨ Ready!</div>
        <button class="btn primary small" data-harvest="${plot.index}">Harvest 🌸</button>`;
    }
    wrap.appendChild(el);
  }
  wrap.querySelectorAll('[data-water]').forEach((b) => b.addEventListener('click', () => waterPlot(+b.getAttribute('data-water'))));
  wrap.querySelectorAll('[data-harvest]').forEach((b) => b.addEventListener('click', () => harvestPlot(+b.getAttribute('data-harvest'))));
}

function renderSeedShop() {
  const shop = $('#seedshop');
  shop.innerHTML = '';
  for (const plant of state.catalog.plants) {
    const price = plant.cost.petals != null ? `🌸 ${plant.cost.petals}` : `✦ ${plant.cost.lumen}`;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<span>${plant.label} <span class="muted tiny">· ${plant.growMinutes}m${plant.rarityLuck ? ` · +luck` : ''}</span></span>
      <span class="row"><span class="price">${price}</span><button class="btn small" data-plant="${plant.id}">Plant</button></span>`;
    shop.appendChild(el);
  }
  shop.querySelectorAll('[data-plant]').forEach((b) => b.addEventListener('click', () => plantSeed(b.getAttribute('data-plant'))));
}

async function plantSeed(plantId) {
  const empty = state.garden.plots.find((p) => p.state === 'empty');
  if (!empty) return toast('No empty plot — harvest one first!');
  try {
    await api(`/api/players/${state.pid}/garden/plant`, 'POST', { plotIndex: empty.index, plantId });
    toast('Planted! It will grow in real time.');
    await Promise.all([loadGarden(), refreshPlayer()]);
  } catch (e) { toast(e.message); }
}

async function waterPlot(index) {
  try { await api(`/api/players/${state.pid}/garden/water`, 'POST', { plotIndex: index }); await loadGarden(); }
  catch (e) { toast(e.message); }
}

async function harvestPlot(index) {
  try {
    const r = await api(`/api/players/${state.pid}/garden/harvest`, 'POST', { plotIndex: index });
    showHatch(r.lumi);
    if (r.unlocked?.length) toast('🎉 Unlocked: ' + r.unlocked.map((u) => u.note).join(', '));
    await Promise.all([loadGarden(), refreshPlayer(), loadWorld()]);
  } catch (e) { toast(e.message); }
}

/* ------------------------------ COLLECTION ------------------------------- */
async function loadCollection() {
  const sort = /** @type {HTMLSelectElement} */ ($('#coll-sort')).value;
  const r = await api(`/api/players/${state.pid}/collection?sort=${sort}`);
  state.collection = r.collection;
  $('#coll-count').textContent = `· ${r.total}`;
  const grid = $('#collection');
  grid.innerHTML = '';
  for (const lumi of r.collection) grid.appendChild(makeCard(lumi));
}
$('#coll-sort')?.addEventListener('change', loadCollection);

function makeCard(lumi, size = 130) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<canvas width="${size}" height="${size}"></canvas>
    <div class="nm">${lumi.name}</div>
    <div class="sp">${ELEMENT_EMOJI[lumi.element] || ''} ${lumi.species}</div>
    <span class="badge r-${lumi.rarity}">${RARITY_LABEL[lumi.rarity]}</span>`;
  const cv = card.querySelector('canvas');
  paintStatic(cv, lumi);
  return card;
}

// Draw a Lumi once (collection cards don't need per-frame animation; we pass t=0).
function paintStatic(cv, lumi) {
  const ctx = cv.getContext('2d');
  let t = 0;
  // a tiny idle loop only while visible keeps cards lively but cheap
  const loop = () => {
    if (!cv.isConnected) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawLumi(ctx, lumi, { x: cv.width / 2, y: cv.height / 2 + 6, r: cv.width * 0.32, t });
    t += 16;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* -------------------------------- BREED ---------------------------------- */
function renderBreedPicker() {
  loadCollection().then(() => {
    const picker = $('#breed-picker');
    picker.innerHTML = '';
    for (const lumi of state.collection) {
      const card = makeCard(lumi, 96);
      card.addEventListener('click', () => pickParent(lumi, card));
      picker.appendChild(card);
    }
    updateBreedStage();
  });
}

function pickParent(lumi, card) {
  const pick = state.breedPick;
  if (pick.a?.uid === lumi.uid) pick.a = null;
  else if (pick.b?.uid === lumi.uid) pick.b = null;
  else if (!pick.a) pick.a = lumi;
  else if (!pick.b) pick.b = lumi;
  else pick.a = lumi; // replace A
  $$('#breed-picker .card').forEach((c) => c.classList.remove('selected'));
  if (pick.a) markSelected('#breed-picker', pick.a.uid);
  if (pick.b) markSelected('#breed-picker', pick.b.uid);
  updateBreedStage();
}

function markSelected(scope, uid) {
  const list = state.collection;
  const idx = list.findIndex((l) => l.uid === uid);
  const cards = $$(`${scope} .card`);
  if (cards[idx]) cards[idx].classList.add('selected');
}

function updateBreedStage() {
  const { a, b } = state.breedPick;
  paintParent('#parent-a', a, 'Pick parent A');
  paintParent('#parent-b', b, 'Pick parent B');
  $('#breed-btn').disabled = !(a && b);
}

function paintParent(sel, lumi, placeholder) {
  const el = $(sel);
  const cv = el.querySelector('canvas');
  const label = el.querySelector('span');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (lumi) { drawLumi(ctx, lumi, { x: 100, y: 106, r: 70, t: performance.now() }); label.textContent = `${lumi.name} (${RARITY_LABEL[lumi.rarity]})`; }
  else label.textContent = placeholder;
}

$('#breed-btn')?.addEventListener('click', async () => {
  const { a, b } = state.breedPick;
  if (!a || !b) return;
  try {
    const r = await api(`/api/players/${state.pid}/breed`, 'POST', { parentA: a.uid, parentB: b.uid });
    // Reveal child in the "=" slot, then celebrate.
    const cv = $('#child').querySelector('canvas');
    const ctx = cv.getContext('2d');
    let t0 = performance.now();
    const reveal = (now) => { ctx.clearRect(0, 0, cv.width, cv.height); drawLumi(ctx, r.child, { x: 100, y: 106, r: 70, t: now }); if (now - t0 < 1500) requestAnimationFrame(reveal); };
    requestAnimationFrame(reveal);
    $('#child').querySelector('span').textContent = `${r.child.name} (${RARITY_LABEL[r.child.rarity]})`;
    showHatch(r.child, 'A new Lumi blooms from the ritual!');
    state.breedPick = { a: null, b: null };
    await refreshPlayer();
    renderBreedPicker();
  } catch (e) {
    if (e.code === 'NEED_LUMEN') toast('Not enough ✦ Lumen for the ritual (try the daily reward!).');
    else toast(e.message);
  }
});

/* -------------------------------- WORLD ---------------------------------- */
async function loadWorld() {
  const [{ world }, { neighbours }, { leaderboard }] = await Promise.all([
    api('/api/world'),
    api(`/api/players/${state.pid}/neighbours`),
    api('/api/leaderboard'),
  ]);
  $('#world-season').textContent = world.season;
  const pct = Math.round(world.bloomLevel);
  $('#bloom-fill').style.width = pct + '%';
  $('#bloom-label').textContent = `Great Bloom ${pct}% · ${fmt(world.totalLumiHatched)} Lumi hatched worldwide`;

  const nb = $('#neighbours');
  nb.innerHTML = '';
  for (const n of neighbours) {
    const el = document.createElement('div');
    el.className = 'nb';
    el.innerHTML = `<span class="who">${n.handle}</span>
      <span class="muted tiny">${n.biome} · ${n.collectionSize} Lumi</span>
      <span class="meta"><button class="btn small ghost" data-visit="${n.id}">Visit</button></span>`;
    nb.appendChild(el);
  }
  nb.querySelectorAll('[data-visit]').forEach((b) => b.addEventListener('click', () => visit(b.getAttribute('data-visit'))));

  const lb = $('#leaderboard');
  lb.innerHTML = '';
  for (const row of leaderboard) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${row.handle}</b> — top power ${row.topPower} · ${row.collectionSize} Lumi`;
    lb.appendChild(li);
  }
}

async function visit(targetId) {
  try { const r = await api(`/api/players/${state.pid}/visit`, 'POST', { targetId }); toast(`Visited ${r.visited} (+🌸 ${r.reward.petals})`); await refreshPlayer(); }
  catch (e) { toast(e.message); }
}

/* ------------------------------ hatch modal ------------------------------ */
function showHatch(lumi, title) {
  const dlg = /** @type {HTMLDialogElement} */ ($('#hatch-dialog'));
  $('#hatch-name').textContent = title ? lumi.name : `${lumi.name} hatched!`;
  $('#hatch-badges').innerHTML = badgeHtml(lumi);
  const cv = /** @type {HTMLCanvasElement} */ ($('#hatch-canvas'));
  const ctx = cv.getContext('2d');
  let open = true;
  const loop = (t) => { if (!open) return; ctx.clearRect(0, 0, cv.width, cv.height); drawLumi(ctx, lumi, { x: 150, y: 158, r: 92, t }); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  dlg.showModal();
  $('#hatch-close').onclick = () => { open = false; dlg.close(); };
}

/* ------------------------------- helpers --------------------------------- */
function badgeHtml(g) {
  const parts = [`<span class="badge r-${g.rarity}">${RARITY_LABEL[g.rarity]}</span>`,
    `<span class="badge" style="background:#7a6;">${ELEMENT_EMOJI[g.element]} ${cap(g.element)}</span>`,
    `<span class="badge" style="background:#88a;">${cap(g.temperament)}</span>`];
  for (const m of g.mutations) parts.push(`<span class="badge" style="background:linear-gradient(90deg,#ff6ec7,#8a5cf6)">✦ ${cap(m.replace(/_/g, ' '))}</span>`);
  return parts.join('');
}
function describe(g) {
  const mut = g.mutations.length ? ` It carries the ${g.mutations.map((m) => m.replace(/_/g, ' ')).join(' & ')} trait${g.mutations.length > 1 ? 's' : ''}.` : '';
  return `A ${g.temperament} ${g.species.toLowerCase()} born of ${ELEMENT_EMOJI[g.element]} ${g.element}.${mut}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (n) => Number(n).toLocaleString('en-US');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* Live countdown for growing plots; harvest buttons appear when a timer hits 0. */
function startClock() {
  setInterval(() => {
    let needsReload = false;
    $$('#plots .timer').forEach((el) => {
      const ready = Number(el.getAttribute('data-ready'));
      const left = Math.max(0, Math.round((ready - Date.now()) / 1000));
      el.textContent = mmss(left);
      if (left <= 0) needsReload = true;
    });
    if (needsReload) loadGarden();
  }, 1000);
}

boot().catch((e) => { console.error(e); toast('Failed to start: ' + e.message); });
