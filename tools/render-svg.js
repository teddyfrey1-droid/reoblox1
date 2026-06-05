// @ts-check
/**
 * Headless SVG renderer for Lumi — turns a genome's render spec into static vector
 * art with zero dependencies. Used to (a) prove the generative system visually
 * without a browser, and (b) auto-produce concept-art contact sheets for the team.
 *
 *   node tools/render-svg.js                 # writes docs/assets/lumi-gallery.svg
 *   node tools/render-svg.js LUMI-AAAA-BBB   # writes a single creature
 *
 * It deliberately mirrors web/lumi-render.js so the static art matches the live
 * canvas look (same shapes, same palette mapping).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLumi, decodeSeedCode, RARITIES, ELEMENTS } from '../core/genome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Deterministic blob path (mirrors the canvas wobble at t=0). */
function blobPath(cx, cy, R, wobble, shape) {
  const pts = [];
  const n = 22;
  const w = shape === 'blob' ? wobble * 1.8 : wobble;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = R * (1 + Math.sin(a * 3) * w + Math.sin(a * 5) * w * 0.5);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.02]);
  }
  return 'M' + pts.map(([x, y], i) => `${i ? 'L' : ''}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + 'Z';
}

/** Render a single Lumi as an <svg> group, centred in a `size`×`size` box. */
export function svgLumi(g, size = 180) {
  const s = g.render;
  const pal = s.palette;
  const R = size * 0.3 * s.body.size;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const id = g.seed.toString(36);
  let defs = '';
  let body = '';

  // Aura
  if (s.aura.glow > 0.02) {
    defs += `<radialGradient id="aura${id}"><stop offset="40%" stop-color="${s.aura.color}" stop-opacity="0"/><stop offset="75%" stop-color="${s.aura.color}" stop-opacity="${(0.22 * s.aura.glow).toFixed(2)}"/><stop offset="100%" stop-color="${s.aura.color}" stop-opacity="0"/></radialGradient>`;
    body += `<circle cx="${cx}" cy="${cy}" r="${(R * (1.6 + s.aura.glow)).toFixed(1)}" fill="url(#aura${id})"/>`;
  }
  // Legs
  if (s.body.legs > 0) {
    const n = Math.min(s.body.legs, 4);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const front = i < 2 ? 0.55 : 0.95;
      body += `<ellipse cx="${(cx + side * R * 0.7 * front).toFixed(1)}" cy="${(cy + R * 0.72).toFixed(1)}" rx="${(R * 0.16).toFixed(1)}" ry="${(R * 0.22).toFixed(1)}" fill="${pal.secondary}"/>`;
    }
  }
  // Twin tail
  if (s.extras.twinTail) {
    for (const side of [-1, 1]) {
      body += `<path d="M${cx + side * R * 0.5} ${cy + R * 0.3} Q${cx + side * R * 1.1} ${cy + R * 0.1} ${cx + side * R} ${cy - R * 0.4}" stroke="${pal.secondary}" stroke-width="${(R * 0.12).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    }
  }

  // Body fill (aurora gradient if present)
  let bodyFill = pal.primary;
  if (pal.aurora) {
    defs += `<linearGradient id="au${id}" x1="0" y1="0" x2="1" y2="1">${pal.aurora.map((c, i) => `<stop offset="${i * 50}%" stop-color="${c}"/>`).join('')}</linearGradient>`;
    bodyFill = `url(#au${id})`;
  }
  body += `<path d="${blobPath(cx, cy, R, s.body.wobble, s.body.shape)}" fill="${bodyFill}"/>`;

  // Belly
  body += `<ellipse cx="${cx}" cy="${(cy + R * 0.28).toFixed(1)}" rx="${(R * 0.55).toFixed(1)}" ry="${(R * 0.45).toFixed(1)}" fill="${pal.belly}" opacity="0.9"/>`;

  // Pattern (clipped to body)
  defs += `<clipPath id="clip${id}"><path d="${blobPath(cx, cy, R, 0.02, 'rounded')}"/></clipPath>`;
  let pattern = '';
  const co = s.coat;
  if (co.pattern === 'spots' || co.pattern === 'speckle') {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const count = co.spots || 8;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2; const d = rnd() * R * 0.8;
      const rr = (co.pattern === 'speckle' ? 0.06 : 0.12) * R * (0.6 + rnd());
      pattern += `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d - R * 0.1).toFixed(1)}" r="${rr.toFixed(1)}" fill="${pal.secondary}" opacity="0.55"/>`;
    }
  } else if (co.pattern === 'stripes') {
    const n = co.stripes || 4;
    for (let i = 0; i < n; i++) {
      const yy = cy - R + (i + 0.5) * (2 * R / n);
      pattern += `<rect x="${cx - R}" y="${yy.toFixed(1)}" width="${2 * R}" height="${(R * 0.12).toFixed(1)}" fill="${pal.secondary}" opacity="0.5"/>`;
    }
  } else if (co.pattern === 'patch') {
    pattern += `<circle cx="${(cx + R * 0.4).toFixed(1)}" cy="${(cy - R * 0.3).toFixed(1)}" r="${(R * 0.5).toFixed(1)}" fill="${pal.secondary}" opacity="0.5"/>`;
  }
  if (pattern) body += `<g clip-path="url(#clip${id})">${pattern}</g>`;

  // Eyes
  const ex = R * 0.26, ey = cy - R * 0.12, er = R * s.eyes.size;
  const eyePos = s.eyes.count >= 3 ? [[cx - ex, ey], [cx + ex, ey], [cx, ey - R * 0.28]] : [[cx - ex, ey], [cx + ex, ey]];
  for (const [px, py] of eyePos) {
    body += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${er.toFixed(1)}" ry="${er.toFixed(1)}" fill="#1b1430"/>`;
    body += `<circle cx="${(px - er * 0.3).toFixed(1)}" cy="${(py - er * 0.35).toFixed(1)}" r="${(er * 0.32).toFixed(1)}" fill="${s.eyes.sparkle ? '#fff7c2' : '#fff'}"/>`;
  }
  // Halo
  if (s.extras.halo) body += `<ellipse cx="${cx}" cy="${(cy - R * 1.05).toFixed(1)}" rx="${(R * 0.5).toFixed(1)}" ry="${(R * 0.16).toFixed(1)}" fill="none" stroke="#fff2a8" stroke-width="${(R * 0.06).toFixed(1)}"/>`;

  return { defs, body };
}

/** Build a labelled gallery grid of seeds. */
function gallery(seeds, cols = 6, cell = 190) {
  const rows = Math.ceil(seeds.length / cols);
  const W = cols * cell;
  const H = rows * (cell + 34);
  let defs = '';
  let cells = '';
  seeds.forEach((seed, i) => {
    const g = generateLumi(seed, { bloomLevel: 60, careQuality: 0.7 });
    const { defs: d, body } = svgLumi(g, cell);
    defs += d;
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (cell + 34);
    const rarityColor = { common: '#9aa6b2', uncommon: '#54b06a', rare: '#3d8bd6', epic: '#9b5de5', legendary: '#f0a23b', mythic: '#ff6ec7' }[g.rarity];
    cells += `<g transform="translate(${x},${y})">
      <rect x="6" y="6" width="${cell - 12}" height="${cell - 12}" rx="18" fill="#fffdfb" stroke="#eaddf0"/>
      ${body}
      <text x="${cell / 2}" y="${cell + 6}" text-anchor="middle" font-family="ui-rounded,Segoe UI,sans-serif" font-weight="700" font-size="14" fill="#3a2f44">${g.name}</text>
      <text x="${cell / 2}" y="${cell + 22}" text-anchor="middle" font-family="ui-rounded,Segoe UI,sans-serif" font-size="11" fill="${rarityColor}">${g.rarity.toUpperCase()} · ${g.species}</text>
    </g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 10}" viewBox="0 0 ${W} ${H + 10}">
    <defs>${defs}</defs>
    <rect width="${W}" height="${H + 10}" fill="#f7eef6"/>
    ${cells}
  </svg>`;
}

// ----- main -----
const arg = process.argv[2];
mkdirSync(join(ROOT, 'docs/assets'), { recursive: true });
if (arg) {
  const seed = /^LUMI-/i.test(arg) ? decodeSeedCode(arg) : Number(arg) >>> 0;
  const g = generateLumi(seed, { bloomLevel: 60, careQuality: 0.7 });
  const { defs, body } = svgLumi(g, 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="400" viewBox="0 0 360 400"><defs>${defs}</defs><rect width="360" height="400" fill="#f7eef6"/>${body}<text x="180" y="392" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="18" fill="#3a2f44">${g.name} — ${g.rarity} ${g.species}</text></svg>`;
  const out = join(ROOT, 'docs/assets', `lumi-${g.seedCode}.svg`);
  writeFileSync(out, svg);
  console.log('Wrote', out);
} else {
  // Curated spread: hand-pick seeds that showcase variety across rarities & elements.
  // (Found deterministically by scanning seeds for at least one of each rarity.)
  const want = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const found = {};
  const seeds = [];
  for (let i = 1; seeds.length < 24 && i < 2_000_000; i++) {
    const g = generateLumi(i, { bloomLevel: 70, careQuality: 0.8 });
    // ensure we grab the rare tiers first, then fill with variety
    if (want.includes(g.rarity) && (found[g.rarity] || 0) < 4) {
      found[g.rarity] = (found[g.rarity] || 0) + 1;
      seeds.push(i);
    }
  }
  const svg = gallery(seeds);
  const out = join(ROOT, 'docs/assets', 'lumi-gallery.svg');
  writeFileSync(out, svg);
  const counts = {};
  seeds.forEach((s) => { const r = generateLumi(s, { bloomLevel: 70, careQuality: 0.8 }).rarity; counts[r] = (counts[r] || 0) + 1; });
  console.log('Wrote', out, '\nRarity spread:', counts);
}
