// ============================================================
// MÔ PHỎNG PHẢN ỨNG THUẬN NGHỊCH 3D - HÓA HỌC ABC
// A + B  <=>  C + D  (hoặc A + B  -->  C + D  ở chế độ một chiều)
// ============================================================

let BOX_SIZE = 320;
let HALF = BOX_SIZE / 2;

const MAX_PER_TYPE = 200; // hard cap per molecule type

let molecules = [];
let flashes = [];

let isPlaying = false;
let speedLevel = 3;
let volumeLevel = 5;
let showLabels = true;

// Reaction mode: 'reversible' (A+B <=> C+D, default) or 'oneway'
// (A+B -> C+D only; C+D colliding no longer converts back to A+B).
let reactionMode = 'reversible';

let canvasHolder;
let labelCanvas, labelCtx; // separate 2D overlay canvas for crisp, correctly placed labels

// Captured camera matrices/position for this frame (used to project 3D -> 2D for labels)
let frameMV = null;
let frameP = null;
let frameCamPos = null;

// Dynamic radius scaling: shrinks spheres as total molecule count grows,
// so the box never feels overcrowded even with hundreds of molecules.
let radiusScale = 1;

// Shared 3D spatial grid, rebuilt once per frame and reused by
// collision handling (physical proximity in world space).
let frameGrid = null;
let frameCellSize = 24;

// UI refs
let countAInput, countBInput, speedSlider, volumeSlider, playBtn, resetBtn, labelBtn;
let modeReversibleBtn, modeOneWayBtn;
let speedValLabel, volValLabel;
let cntAEl, cntBEl, cntCEl, cntDEl;

// Sound pool
let oscPool = [];
const OSC_POOL_SIZE = 6;
let oscIndex = 0;

// Colors chosen to be maximally distinguishable from each other (spread
// across very different hues: blue, green, magenta, orange) while still
// avoiding pure red/yellow as required.
const TYPE_COLORS = {
  A: [47, 107, 255],   // vivid blue
  B: [34, 197, 94],    // vivid green
  C: [214, 31, 214],   // vivid magenta/purple
  D: [255, 140, 26]    // vivid orange
};
// Label colors chosen for high contrast against each sphere color
const LABEL_COLORS = {
  A: '#ffffff', // white on blue
  B: '#062b12', // near-black on green
  C: '#ffffff', // white on magenta
  D: '#2b1400'  // near-black on orange
};
// Base (unscaled) radii — actual rendered radius = base * radiusScale
const BASE_RADIUS = { A: 13, B: 13, C: 15, D: 15 };

function setup() {
  canvasHolder = document.getElementById('canvas-holder');
  const cnv = createCanvas(canvasHolder.offsetWidth, canvasHolder.offsetHeight, WEBGL);
  cnv.parent('canvas-holder');
  smooth();
  setAttributes('antialias', true);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));

  setupLabelCanvas();

  // UI bindings
  countAInput = select('#countA');
  countBInput = select('#countB');
  speedSlider = select('#speedSlider');
  volumeSlider = select('#volumeSlider');
  playBtn = select('#playBtn');
  resetBtn = select('#resetBtn');
  labelBtn = select('#labelBtn');
  modeReversibleBtn = select('#modeReversibleBtn');
  modeOneWayBtn = select('#modeOneWayBtn');
  speedValLabel = select('#speedVal');
  volValLabel = select('#volVal');

  cntAEl = document.getElementById('cntA');
  cntBEl = document.getElementById('cntB');
  cntCEl = document.getElementById('cntC');
  cntDEl = document.getElementById('cntD');

  countAInput.input(() => syncCount('A', constrainCount(countAInput.value(), countAInput)));
  countBInput.input(() => syncCount('B', constrainCount(countBInput.value(), countBInput)));

  speedSlider.input(() => {
    speedLevel = Number(speedSlider.value());
    speedValLabel.html(speedLevel);
  });

  volumeSlider.input(() => {
    volumeLevel = Number(volumeSlider.value());
    volValLabel.html(volumeLevel);
  });

  playBtn.mousePressed(togglePlay);
  resetBtn.mousePressed(resetAll);
  labelBtn.mousePressed(toggleLabels);
  modeReversibleBtn.mousePressed(() => setReactionMode('reversible'));
  modeOneWayBtn.mousePressed(() => setReactionMode('oneway'));

  initSoundPool();
  updateCountsPanel();
}

function setReactionMode(mode) {
  reactionMode = mode;
  if (mode === 'reversible') {
    modeReversibleBtn.addClass('active');
    modeOneWayBtn.removeClass('active');
  } else {
    modeOneWayBtn.addClass('active');
    modeReversibleBtn.removeClass('active');
  }
}

// ---------------- Label overlay (2D canvas) ----------------
function setupLabelCanvas() {
  labelCanvas = document.createElement('canvas');
  labelCanvas.id = 'labelCanvas';
  canvasHolder.appendChild(labelCanvas);
  labelCtx = labelCanvas.getContext('2d');
  resizeLabelCanvas();
}

function resizeLabelCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvasHolder.offsetWidth;
  const h = canvasHolder.offsetHeight;
  labelCanvas.style.width = w + 'px';
  labelCanvas.style.height = h + 'px';
  labelCanvas.width = Math.floor(w * dpr);
  labelCanvas.height = Math.floor(h * dpr);
  labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Multiply a column-major 4x4 matrix (array of 16) by a vec4
function transformVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8]  * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9]  * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
  ];
}

// Project a 3D world point to 2D pixel coordinates on the canvas,
// using the camera/projection matrices captured at the start of this frame.
function projectToScreen(pos) {
  if (!frameMV || !frameP) return null;
  let world = [pos.x, pos.y, pos.z, 1];
  let eyeSpace = transformVec4(frameMV, world);
  let clip = transformVec4(frameP, eyeSpace);

  if (clip[3] === 0) return null;
  let ndcX = clip[0] / clip[3];
  let ndcY = clip[1] / clip[3];
  let ndcZ = clip[2] / clip[3];

  if (ndcZ < -1 || ndcZ > 1) return null; // outside near/far clip range

  let sx = (ndcX * 0.5 + 0.5) * width;
  let sy = (1 - (ndcY * 0.5 + 0.5)) * height;
  return { x: sx, y: sy };
}

function getCameraPosition() {
  let cam = _renderer._curCamera;
  if (cam && typeof cam.eyeX === 'number') {
    return createVector(cam.eyeX, cam.eyeY, cam.eyeZ);
  }
  return createVector(0, 0, 800); // fallback, should not normally happen
}

// Accurate on-screen radius: projects the actual silhouette edge of the
// sphere as seen from the camera, rather than using a rough formula.
function accurateScreenRadius(pos, radius, camPos) {
  let viewDir = p5.Vector.sub(pos, camPos);
  let dist3D = viewDir.mag();
  if (dist3D < 0.0001) return 0;
  viewDir.normalize();

  let up = createVector(0, 1, 0);
  let right = viewDir.cross(up);
  if (right.magSq() < 0.0001) right = createVector(1, 0, 0);
  right.normalize();

  let edgePoint = p5.Vector.add(pos, p5.Vector.mult(right, radius));
  let c1 = projectToScreen(pos);
  let c2 = projectToScreen(edgePoint);
  if (!c1 || !c2) return 0;
  return dist(c1.x, c1.y, c2.x, c2.y);
}

// ---------------- 3D spatial grid (world-space, for collisions) ----------------
function buildSpatialGrid(cellSize) {
  let grid = new Map();
  for (let idx = 0; idx < molecules.length; idx++) {
    let p = molecules[idx].pos;
    let ix = Math.floor(p.x / cellSize);
    let iy = Math.floor(p.y / cellSize);
    let iz = Math.floor(p.z / cellSize);
    let key = ix + ',' + iy + ',' + iz;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(idx);
  }
  return grid;
}

function getNeighborIndices(grid, cellSize, pos) {
  let ix = Math.floor(pos.x / cellSize);
  let iy = Math.floor(pos.y / cellSize);
  let iz = Math.floor(pos.z / cellSize);
  let result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        let key = (ix + dx) + ',' + (iy + dy) + ',' + (iz + dz);
        let bucket = grid.get(key);
        if (bucket) {
          for (let k = 0; k < bucket.length; k++) result.push(bucket[k]);
        }
      }
    }
  }
  return result;
}

function currentCellSize() {
  let avgRadius = ((BASE_RADIUS.A + BASE_RADIUS.C) / 2) * radiusScale;
  return Math.max(24, avgRadius * 6);
}

// ---------------- 2D screen-space grid (for label occlusion) ----------------
const SCREEN_CELL_SIZE = 80;

function buildScreenGrid(info) {
  let grid = new Map();
  for (let idx = 0; idx < info.length; idx++) {
    let item = info[idx];
    if (!item) continue;
    let ix = Math.floor(item.s.x / SCREEN_CELL_SIZE);
    let iy = Math.floor(item.s.y / SCREEN_CELL_SIZE);
    let key = ix + ',' + iy;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(idx);
  }
  return grid;
}

function getScreenNeighborIndices(grid, screenPos) {
  let ix = Math.floor(screenPos.x / SCREEN_CELL_SIZE);
  let iy = Math.floor(screenPos.y / SCREEN_CELL_SIZE);
  let result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      let key = (ix + dx) + ',' + (iy + dy);
      let bucket = grid.get(key);
      if (bucket) {
        for (let k = 0; k < bucket.length; k++) result.push(bucket[k]);
      }
    }
  }
  return result;
}

function drawLabels() {
  labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  labelCtx.font = 'bold 14px Arial, sans-serif';
  labelCtx.textAlign = 'center';
  labelCtx.textBaseline = 'middle';

  let camPos = frameCamPos;

  let info = new Array(molecules.length).fill(null);
  for (let idx = 0; idx < molecules.length; idx++) {
    let m = molecules[idx];
    let s = projectToScreen(m.pos);
    if (!s) continue;
    let camDist = p5.Vector.dist(m.pos, camPos);
    let screenR = accurateScreenRadius(m.pos, m.radius, camPos);
    info[idx] = { m, s, camDist, screenR };
  }

  let screenGrid = buildScreenGrid(info);

  for (let i = 0; i < molecules.length; i++) {
    let cur = info[i];
    if (!cur) continue;
    let occluded = false;

    let neighbors = getScreenNeighborIndices(screenGrid, cur.s);
    for (let k = 0; k < neighbors.length; k++) {
      let j = neighbors[k];
      if (j === i) continue;
      let other = info[j];
      if (!other) continue;
      if (other.camDist >= cur.camDist - 0.5) continue;
      if (other.screenR <= 0) continue;

      let d = dist(cur.s.x, cur.s.y, other.s.x, other.s.y);
      if (d < other.screenR * 0.85) {
        occluded = true;
        break;
      }
    }

    if (!occluded) {
      labelCtx.fillStyle = cur.m.labelColorHex;
      labelCtx.fillText(cur.m.type, cur.s.x, cur.s.y);
    }
  }
}

function initSoundPool() {
  for (let i = 0; i < OSC_POOL_SIZE; i++) {
    let osc = new p5.Oscillator('sine');
    osc.amp(0);
    osc.start();
    let env = new p5.Envelope();
    env.setADSR(0.001, 0.08, 0.0, 0.05);
    env.setRange(1, 0);
    oscPool.push({ osc, env });
  }
}

function constrainCount(v, inputEl) {
  v = Number(v);
  if (isNaN(v) || v < 0) v = 0;
  if (v > MAX_PER_TYPE) v = MAX_PER_TYPE;
  v = Math.floor(v);
  if (inputEl && Number(inputEl.value()) !== v) {
    inputEl.value(v);
  }
  return v;
}

function syncCount(type, target) {
  let current = molecules.filter(m => m.type === type);
  let diff = target - current.length;
  if (diff > 0) {
    for (let i = 0; i < diff; i++) {
      let radius = BASE_RADIUS[type] * radiusScale;
      let pos = findNonOverlappingPosition(radius);
      molecules.push(new Molecule(type, pos));
    }
  } else if (diff < 0) {
    for (let i = 0; i < -diff; i++) {
      let idx = molecules.findIndex(m => m.type === type);
      if (idx !== -1) molecules.splice(idx, 1);
    }
  }
  updateRadiusScale();
  updateCountsPanel();
}

function findNonOverlappingPosition(radius) {
  const maxAttempts = 40;
  let margin = HALF - radius;
  let candidate = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    candidate = createVector(random(-margin, margin), random(-margin, margin), random(-margin, margin));
    let collides = false;
    for (let i = 0; i < molecules.length; i++) {
      let other = molecules[i];
      let minD = radius + other.radius;
      if (p5.Vector.dist(candidate, other.pos) < minD) {
        collides = true;
        break;
      }
    }
    if (!collides) return candidate;
  }
  return candidate;
}

function randomPointInBox() {
  let m = HALF - 20;
  return createVector(random(-m, m), random(-m, m), random(-m, m));
}

function updateRadiusScale() {
  let total = molecules.length;
  let scale = map(total, 40, 800, 1.0, 0.3, true);
  radiusScale = constrain(scale, 0.3, 1.0);

  for (let m of molecules) {
    m.radius = BASE_RADIUS[m.type] * radiusScale;
  }
}

function togglePlay() {
  isPlaying = !isPlaying;
  if (isPlaying) {
    playBtn.html('⏸ STOP');
    playBtn.addClass('stop');
    if (getAudioContext().state !== 'running') {
      userStartAudio();
    }
  } else {
    playBtn.html('▶ PLAY');
    playBtn.removeClass('stop');
  }
}

function toggleLabels() {
  showLabels = !showLabels;
  if (showLabels) {
    labelBtn.html('🏷 NHÃN: BẬT');
    labelBtn.addClass('on');
  } else {
    labelBtn.html('🏷 NHÃN: TẮT');
    labelBtn.removeClass('on');
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  }
}

function resetAll() {
  isPlaying = false;
  playBtn.html('▶ PLAY');
  playBtn.removeClass('stop');
  molecules = [];
  flashes = [];
  countAInput.value(0);
  countBInput.value(0);
  speedSlider.value(3);
  volumeSlider.value(5);
  speedLevel = 3;
  volumeLevel = 5;
  speedValLabel.html(3);
  volValLabel.html(5);
  radiusScale = 1;
  setReactionMode('reversible');
  labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  updateCountsPanel();
}

function updateCountsPanel() {
  let counts = { A: 0, B: 0, C: 0, D: 0 };
  for (let m of molecules) counts[m.type]++;
  if (cntAEl) cntAEl.textContent = counts.A;
  if (cntBEl) cntBEl.textContent = counts.B;
  if (cntCEl) cntCEl.textContent = counts.C;
  if (cntDEl) cntDEl.textContent = counts.D;
}

// ---------------- Molecule class ----------------
class Molecule {
  constructor(type, pos) {
    this.type = type;
    this.pos = pos.copy();
    this.vel = p5.Vector.random3D();
    this.radius = BASE_RADIUS[type] * radiusScale;
    this.color = TYPE_COLORS[type];
    this.labelColorHex = LABEL_COLORS[type];
  }

  update(speedFactor) {
    if (speedFactor <= 0) return;
    let move = p5.Vector.mult(this.vel, speedFactor);
    this.pos.add(move);
    let m = HALF - this.radius;
    if (this.pos.x > m) { this.pos.x = m; this.vel.x *= -1; }
    if (this.pos.x < -m) { this.pos.x = -m; this.vel.x *= -1; }
    if (this.pos.y > m) { this.pos.y = m; this.vel.y *= -1; }
    if (this.pos.y < -m) { this.pos.y = -m; this.vel.y *= -1; }
    if (this.pos.z > m) { this.pos.z = m; this.vel.z *= -1; }
    if (this.pos.z < -m) { this.pos.z = -m; this.vel.z *= -1; }
  }

  display() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);
    noStroke();
    ambientMaterial(this.color[0], this.color[1], this.color[2]);
    let detail = this.radius > 6 ? 20 : 10;
    sphere(this.radius, detail, detail);
    pop();
  }
}

// ---------------- Flash effect (single clean glow: fast pop -> fade -> gone) ----------------
class Flash {
  constructor(pos, colorArr) {
    this.pos = pos.copy();
    this.color = colorArr;
    this.age = 0;
    this.maxAge = 10; // very fast flash (~0.16s at 60fps)
  }
  update() {
    this.age++;
    return this.age < this.maxAge;
  }
  display() {
    let t = this.age / this.maxAge; // 0 -> 1

    let r = lerp(8, 55, easeOutCubic(t)) * Math.max(radiusScale, 0.4);

    let alpha = 255 * (1 - easeInQuad(t));
    if (alpha <= 1) return;

    push();
    translate(this.pos.x, this.pos.y, this.pos.z);
    noStroke();

    drawingContext.disable(drawingContext.DEPTH_TEST);
    blendMode(ADD);

    emissiveMaterial(this.color[0], this.color[1], this.color[2]);
    ambientMaterial(0, 0, 0);
    fill(this.color[0], this.color[1], this.color[2], alpha);
    sphere(r, 14, 14);

    blendMode(BLEND);
    drawingContext.enable(drawingContext.DEPTH_TEST);
    pop();
  }
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInQuad(t) { return t * t; }

function playCollisionSound(freq) {
  if (volumeLevel <= 0) return;
  let slot = oscPool[oscIndex];
  oscIndex = (oscIndex + 1) % OSC_POOL_SIZE;
  slot.osc.freq(freq);
  let amp = map(volumeLevel, 0, 10, 0, 0.5);
  slot.env.setRange(amp, 0);
  slot.env.play(slot.osc);
}

// ---------------- Reactions & collisions ----------------
// Whether a specific ordered pair of types should react, given the
// currently selected reaction mode:
//  - 'reversible': A+B -> C+D  AND  C+D -> A+B  (both directions allowed)
//  - 'oneway':     A+B -> C+D only; C+D colliding just bounces (no reaction)
function shouldReact(t1, t2) {
  let isAB = (t1 === 'A' && t2 === 'B') || (t1 === 'B' && t2 === 'A');
  let isCD = (t1 === 'C' && t2 === 'D') || (t1 === 'D' && t2 === 'C');
  if (isAB) return true;
  if (isCD) return reactionMode === 'reversible';
  return false;
}

function clampInsideBox(pos, radius) {
  let m = HALF - radius;
  pos.x = constrain(pos.x, -m, m);
  pos.y = constrain(pos.y, -m, m);
  pos.z = constrain(pos.z, -m, m);
  return pos;
}

function handleCollisions() {
  let toRemove = new Set();
  let newMolecules = [];
  let countChanged = false;

  for (let i = 0; i < molecules.length; i++) {
    if (toRemove.has(i)) continue;
    let m1 = molecules[i];
    let neighbors = getNeighborIndices(frameGrid, frameCellSize, m1.pos);

    for (let k = 0; k < neighbors.length; k++) {
      let j = neighbors[k];
      if (j <= i) continue; // ensures each pair is processed exactly once
      if (toRemove.has(j)) continue;

      let m2 = molecules[j];
      let d = p5.Vector.dist(m1.pos, m2.pos);
      let minD = m1.radius + m2.radius;
      if (d < minD) {
        let mid = p5.Vector.lerp(m1.pos, m2.pos, 0.5);

        let normal = p5.Vector.sub(m2.pos, m1.pos);
        if (normal.magSq() < 0.0001) normal = p5.Vector.random3D();
        normal.normalize();

        if (shouldReact(m1.type, m2.type)) {
          toRemove.add(i);
          toRemove.add(j);

          let newType1, newType2, flashColor, freq;
          if (m1.type === 'A' || m1.type === 'B') {
            newType1 = 'C'; newType2 = 'D';
            flashColor = [255, 45, 45]; // red glow for A+B collision
            freq = 220;
          } else {
            newType1 = 'A'; newType2 = 'B';
            flashColor = [255, 225, 30]; // yellow glow for C+D collision
            freq = 330;
          }

          let r1 = BASE_RADIUS[newType1] * radiusScale;
          let r2 = BASE_RADIUS[newType2] * radiusScale;
          let gap = (r1 + r2) * 0.9 + 6 * radiusScale;

          let pos1 = clampInsideBox(p5.Vector.add(mid, p5.Vector.mult(normal, -gap / 2)), r1);
          let pos2 = clampInsideBox(p5.Vector.add(mid, p5.Vector.mult(normal, gap / 2)), r2);

          let n1 = new Molecule(newType1, pos1);
          let n2 = new Molecule(newType2, pos2);
          n1.vel = p5.Vector.mult(normal, -1).add(p5.Vector.random3D().mult(0.3)).normalize();
          n2.vel = p5.Vector.mult(normal, 1).add(p5.Vector.random3D().mult(0.3)).normalize();

          newMolecules.push(n1, n2);
          flashes.push(new Flash(mid, flashColor));
          playCollisionSound(freq);
          countChanged = true;
          break; // m1 is consumed, stop checking further neighbors for it
        } else {
          // Not eligible to react (either different types that don't pair,
          // or C+D blocked under one-way mode) — just an elastic-like bounce.
          let overlap = minD - d;
          let push1 = p5.Vector.mult(normal, -overlap / 2);
          let push2 = p5.Vector.mult(normal, overlap / 2);
          m1.pos.add(push1);
          m2.pos.add(push2);

          let v1n = p5.Vector.mult(normal, m1.vel.dot(normal));
          let v2n = p5.Vector.mult(normal, m2.vel.dot(normal));
          m1.vel.sub(v1n).add(v2n);
          m2.vel.sub(v2n).add(v1n);
        }
      }
    }
  }

  if (toRemove.size > 0) {
    molecules = molecules.filter((m, idx) => !toRemove.has(idx));
  }
  if (newMolecules.length > 0) {
    molecules = molecules.concat(newMolecules);
  }
  if (countChanged) updateCountsPanel();
}

// ---------------- Draw loop ----------------
function draw() {
  background(0, 0, 2);

  orbitControl(1, 1, 0.15);

  frameMV = _renderer.uMVMatrix.copy().mat4;
  frameP = _renderer.uPMatrix.copy().mat4;
  frameCamPos = getCameraPosition();

  frameCellSize = currentCellSize();
  frameGrid = buildSpatialGrid(frameCellSize);

  ambientLight(140, 140, 140);
  pointLight(180, 180, 180, 150, -220, 260);

  // Bounding transparent box (wireframe, all edges visible)
  push();
  noFill();
  stroke(120, 190, 255, 160);
  strokeWeight(1.2);
  box(BOX_SIZE);
  pop();

  let speedFactor = map(speedLevel, 0, 10, 0, 4.2);

  if (isPlaying) {
    for (let m of molecules) m.update(speedFactor);
    handleCollisions();
    frameGrid = buildSpatialGrid(frameCellSize);
  }

  for (let m of molecules) m.display();

  for (let i = flashes.length - 1; i >= 0; i--) {
    let alive = flashes[i].update();
    flashes[i].display();
    if (!alive) flashes.splice(i, 1);
  }

  if (showLabels) {
    drawLabels();
  } else {
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  }
}

function windowResized() {
  resizeCanvas(canvasHolder.offsetWidth, canvasHolder.offsetHeight);
  resizeLabelCanvas();
}