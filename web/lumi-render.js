// @ts-check
/**
 * Procedural Lumi renderer (HTML5 canvas).
 *
 * Draws a complete, charming creature purely from a genome's `render` spec — no
 * image assets. This proves the core promise of the generative system: any client
 * can visualise any of the (4 billion+) creatures from data alone. The production
 * client would map the same spec onto a skeletal/sprite rig; here we use vector
 * shapes so the prototype runs anywhere with zero downloads.
 *
 * Includes light idle animation (bob + blink + aura pulse) so creatures feel alive.
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} genome   a full genome (uses genome.render + genome.palette)
 * @param {{x:number, y:number, r:number, t:number}} opts  centre x/y, base radius, time ms
 */
export function drawLumi(ctx, genome, { x, y, r, t }) {
  const spec = genome.render;
  const pal = spec.palette;
  const size = spec.body.size;
  const R = r * size;

  // Idle motion: gentle vertical bob + slight squash/stretch.
  const bob = Math.sin(t / 650) * R * 0.05;
  const squash = 1 + Math.sin(t / 650) * 0.03;
  const app = spec.appendages || {};
  // Floaters hover higher; floaters/finlings bob a touch more for "weightlessness".
  const cy = y + bob - R * (spec.body.hover || 0);

  ctx.save();
  ctx.translate(x, cy);

  // --- Aura / glow (rarity signal) ---
  if (spec.aura.glow > 0.02) {
    const pulse = 0.85 + Math.sin(t / 500) * 0.15;
    const auraR = R * (1.5 + spec.aura.glow * 0.8) * pulse;
    const g = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, auraR);
    g.addColorStop(0, hexA(spec.aura.color, 0.0));
    g.addColorStop(0.6, hexA(spec.aura.color, 0.18 * spec.aura.glow));
    g.addColorStop(1, hexA(spec.aura.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, auraR, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Appendages drawn BEHIND the body (form silhouette) ---
  if (app.wings) drawWings(ctx, R, pal.accent, t);
  if (app.ears) drawEars(ctx, R, pal.primary, pal.belly);
  if (app.leaf) drawLeaf(ctx, R, t);
  if (app.fins) drawFins(ctx, R, pal.accent, t);
  if (app.antenna) drawAntenna(ctx, R, pal.secondary, t);

  // --- Legs (drawn behind the body) ---
  if (spec.body.legs > 0) drawLegs(ctx, R, spec.body.legs, pal.secondary, t);

  // --- Twin tail extra ---
  if (spec.extras.twinTail) drawTail(ctx, R, pal.secondary, t);

  // --- Body ---
  ctx.save();
  ctx.scale((1 / squash) * (spec.body.elongate || 1), squash);
  const bodyFill = pal.aurora
    ? auroraGradient(ctx, R, pal.aurora, t)
    : pal.primary;
  blob(ctx, 0, 0, R, spec.body.shape, spec.body.wobble, t);
  ctx.fillStyle = bodyFill;
  ctx.fill();

  // Crystalline facet sheen
  if (spec.extras.crystalline) {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.25;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * R * 0.35 - R, -R);
      ctx.lineTo(i * R * 0.35, R);
      ctx.lineTo(i * R * 0.35 + R * 0.25, R);
      ctx.lineTo(i * R * 0.35 + R * 0.25 - R, -R);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? '#ffffff' : pal.accent;
      ctx.fill();
    }
    ctx.restore();
  }

  // Belly patch
  ctx.beginPath();
  ctx.ellipse(0, R * 0.28, R * 0.55, R * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.belly;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Pattern overlay
  drawPattern(ctx, R, spec.coat, pal.secondary);

  ctx.restore(); // squash

  // --- Arms (tiny, in front of the body — bipedal tots) ---
  if (app.arms) drawArms(ctx, R, pal.secondary, t);

  // --- Ember heart ---
  if (spec.extras.emberHeart) {
    const hp = 0.6 + Math.sin(t / 300) * 0.4;
    ctx.fillStyle = hexA('#ff5a3c', 0.4 + hp * 0.5);
    ctx.beginPath();
    ctx.arc(0, R * 0.1, R * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Eyes ---
  drawEyes(ctx, R, spec.eyes, t);

  // --- Halo (drawn on top, above the head) ---
  if (spec.extras.halo) {
    ctx.strokeStyle = hexA('#fff2a8', 0.9);
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    ctx.ellipse(0, -R * 1.05, R * 0.5, R * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/* ----------------------------- shape helpers ----------------------------- */

function blob(ctx, cx, cy, R, shape, wobble, t) {
  ctx.beginPath();
  const points = 18;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    // Rounded forms are nearly circular; blobs wobble more and breathe over time.
    const w = shape === 'blob' ? wobble * 1.8 : wobble;
    const rr = R * (1 + Math.sin(a * 3 + t / 800) * w + Math.sin(a * 5 - t / 1100) * w * 0.5);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr * 1.02;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawLegs(ctx, R, count, color, t) {
  ctx.fillStyle = color;
  const spread = R * 0.7;
  const n = Math.min(count, 4);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const front = i < 2 ? 0.55 : 0.95;
    const wiggle = Math.sin(t / 400 + i) * R * 0.04;
    ctx.beginPath();
    ctx.ellipse(side * spread * front, R * 0.7 + wiggle, R * 0.16, R * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTail(ctx, R, color, t) {
  ctx.strokeStyle = color;
  ctx.lineWidth = R * 0.12;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * R * 0.5, R * 0.3);
    ctx.quadraticCurveTo(
      side * R * (1.1 + Math.sin(t / 500) * 0.1), R * 0.1,
      side * R * 1.0, -R * (0.4 + Math.sin(t / 500) * 0.1),
    );
    ctx.stroke();
  }
}

/* --- Form-specific appendages (give each archetype a distinct silhouette) --- */

function drawFins(ctx, R, color, t) {
  const flap = Math.sin(t / 320) * 0.12;
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * R * 0.7, R * 0.05);
    ctx.quadraticCurveTo(side * R * (1.35 + flap), -R * 0.15, side * R * 1.2, R * 0.5);
    ctx.quadraticCurveTo(side * R * 1.0, R * 0.25, side * R * 0.7, R * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  // tail fin
  ctx.beginPath();
  ctx.moveTo(0, R * 0.85);
  ctx.quadraticCurveTo(-R * 0.4, R * 1.3, -R * 0.5, R * 1.15);
  ctx.quadraticCurveTo(0, R * 0.95, R * 0.5, R * 1.15);
  ctx.quadraticCurveTo(R * 0.4, R * 1.3, 0, R * 0.85);
  ctx.fill();
}

function drawWings(ctx, R, color, t) {
  const flap = Math.sin(t / 220) * 0.22;
  ctx.fillStyle = hexA(color, 0.6);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * R * 0.9, -R * 0.1, R * 0.45, R * 0.28, side * (0.5 + flap), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEars(ctx, R, color, inner) {
  for (const side of [-1, 1]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(side * R * 0.5, -R * 0.85, R * 0.22, R * 0.3, side * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.ellipse(side * R * 0.5, -R * 0.82, R * 0.1, R * 0.16, side * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLeaf(ctx, R, t) {
  const sway = Math.sin(t / 700) * 0.12;
  ctx.strokeStyle = '#7bbf6a';
  ctx.lineWidth = R * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.8);
  ctx.lineTo(sway * R, -R * 1.2);
  ctx.stroke();
  ctx.fillStyle = '#8fd17a';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sway * R + side * R * 0.16, -R * 1.22, R * 0.18, R * 0.1, side * -0.6 + sway, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawArms(ctx, R, color, t) {
  const swing = Math.sin(t / 450) * R * 0.06;
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * R * 0.85, R * 0.15 + side * swing, R * 0.12, R * 0.18, side * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAntenna(ctx, R, color, t) {
  const sway = Math.sin(t / 600) * 0.18;
  ctx.strokeStyle = color;
  ctx.lineWidth = R * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.85);
  ctx.quadraticCurveTo(sway * R, -R * 1.25, sway * R * 1.5, -R * 1.4);
  ctx.stroke();
  ctx.fillStyle = '#fff2a8';
  ctx.beginPath();
  ctx.arc(sway * R * 1.5, -R * 1.42, R * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawPattern(ctx, R, coat, color) {
  ctx.save();
  blob(ctx, 0, 0, R, 'rounded', 0.02, 0);
  ctx.clip();
  ctx.fillStyle = hexA(color, 0.55);
  if (coat.pattern === 'spots' || coat.pattern === 'speckle') {
    const n = coat.spots || 8;
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * R * 0.8;
      const rr = (coat.pattern === 'speckle' ? 0.06 : 0.12) * R * (0.6 + rnd());
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d - R * 0.1, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (coat.pattern === 'stripes') {
    const n = coat.stripes || 4;
    for (let i = 0; i < n; i++) {
      const yy = -R + (i + 0.5) * (2 * R / n);
      ctx.fillRect(-R, yy, R * 2, R * 0.12);
    }
  } else if (coat.pattern === 'gradient') {
    const g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, hexA(color, 0));
    g.addColorStop(1, hexA(color, 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(-R, -R, R * 2, R * 2);
  } else if (coat.pattern === 'patch') {
    ctx.beginPath();
    ctx.arc(R * 0.4, -R * 0.3, R * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEyes(ctx, R, eyes, t) {
  const blink = (Math.sin(t / 1700) > 0.97) ? 0.12 : 1; // occasional blink
  const ex = R * 0.26;
  const ey = -R * 0.12;
  const er = R * eyes.size;
  const positions = eyes.count >= 3
    ? [[-ex, ey], [ex, ey], [0, ey - R * 0.28]]
    : [[-ex, ey], [ex, ey]];
  for (const [px, py] of positions) {
    // white
    ctx.fillStyle = '#1b1430';
    ctx.beginPath();
    ctx.ellipse(px, py, er, er * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink > 0.5) {
      // highlight
      ctx.fillStyle = eyes.sparkle ? '#fff7c2' : '#ffffff';
      ctx.beginPath();
      ctx.arc(px - er * 0.3, py - er * 0.35, er * 0.32, 0, Math.PI * 2);
      ctx.fill();
      if (eyes.sparkle) {
        ctx.strokeStyle = '#fff7c2';
        ctx.lineWidth = R * 0.03;
        star(ctx, px + er * 0.2, py + er * 0.2, er * 0.5, 4);
        ctx.stroke();
      }
    }
  }
}

function star(ctx, cx, cy, rad, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? rad * 0.3 : rad;
    const fn = i === 0 ? 'moveTo' : 'lineTo';
    ctx[fn](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function auroraGradient(ctx, R, stops, t) {
  const shift = (Math.sin(t / 1200) + 1) / 2;
  const g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5 + shift * 0.2 - 0.1, stops[1]);
  g.addColorStop(1, stops[2]);
  return g;
}

/** Append alpha to a #rrggbb hex (or pass through if it already has alpha). */
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
