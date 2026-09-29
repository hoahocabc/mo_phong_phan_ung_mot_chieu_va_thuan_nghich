// noprotect
// ============================================================
// MÔ PHỎNG PHẢN ỨNG THUẬN NGHỊCH 3D - HÓA HỌC ABC
// BẢN HOÀN THIỆN TỐI HẬU: FULL LOGIC KINETICS, UI, VÀ CÁC LỚP VẬT LÝ
// ============================================================

let BOX_SIZE = 320;
let HALF = BOX_SIZE / 2;

const MAX_PER_TYPE = 10000; 
const PERFORMANCE_THRESHOLD = 400; 
const POINT_RENDER_THRESHOLD = 2000; 

let molecules = [];
let flashes = [];

let isPlaying = false;
let speedLevel = 3.0;
let volumeLevel = 5;
let showLabels = true;
let isCountsVisible = true; 

let reactionMode = 'reversible';
let canvasHolder;
let labelCanvas, labelCtx;
let mouseOverUI = false;

let frameMV = null;
let frameP = null;
let frameCamPos = null;
let radiusScale = 1;

// ---------------- LÕI BỘ NHỚ SIÊU TỐC ----------------
const GRID_DIM = 50; 
const GRID_TOTAL = GRID_DIM * GRID_DIM * GRID_DIM; 
let gridHead = new Int32Array(GRID_TOTAL);
let gridNext = new Int32Array(40000); 
let toRemoveFlag = new Uint8Array(40000); 
let neighborsBuffer = new Int32Array(5000); 
let neighborsCount = 0;
let frameCellSize = 16;

const LOOP_50 = Array.from({length: 50}); 
const LOOP_5000 = Array.from({length: 5000}); 
const GRID_OFFSETS = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      GRID_OFFSETS.push({dx, dy, dz, dSq: dx*dx + dy*dy + dz*dz});
    }
  }
}
GRID_OFFSETS.sort((a, b) => a.dSq - b.dSq);

const GRID_OFFSETS_2D = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    GRID_OFFSETS_2D.push({dx, dy});
  }
}

let countAInput, countBInput, speedSlider, volumeSlider;
let playBtn, resetBtn, labelBtn, toggleCountsBtn, concChartBtn, rateChartBtn, modeReversibleBtn, modeOneWayBtn;
let speedValLabel, volValLabel;
let cntAEl, cntBEl, cntCEl, cntDEl;

let oscPool = [];
const OSC_POOL_SIZE = 6;
let oscIndex = 0;

const TYPE_COLORS = { A: [47, 107, 255], B: [34, 197, 94], C: [214, 31, 214], D: [255, 140, 26] };
const LABEL_COLORS = { A: '#ffffff', B: '#062b12', C: '#ffffff', D: '#2b1400' };
const BASE_RADIUS = { A: 14, B: 14, C: 14, D: 14 };

// ---------------- Charts & Đồng bộ Thời gian ----------------
const FIXED_DT = 1 / 60; 
const CHART_SAMPLE_INTERVAL = 0.05; 
const CHART_MAX_SAMPLES = 15000; 

let globalSimTime = 0; 
let chartSampleAccumulator = 0;

let showConcChart = false;
let concChartCanvas, concChartCtx;
let concHistory = []; 
let concSelectedTime = null; 
let concClickRequest = null; 

let showRateChart = false;
let rateChartCanvas, rateChartCtx;
let rateHistory = []; 
let rateSelectedTime = null; 
let rateClickRequest = null; 

let fwdCountThisFrame = 0; 
let revCountThisFrame = 0; 
let rateRolling = []; 
let isWaitingForFirstReaction = true; 

let concChartZoom = null;
let rateChartZoom = null;
let chartDragState = { canvas: null, startX: 0, currentX: 0 };

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

function setup() {
  canvasHolder = document.getElementById('canvas-holder');
  const cnv = createCanvas(canvasHolder.offsetWidth, canvasHolder.offsetHeight, WEBGL);
  cnv.parent('canvas-holder');
  smooth();
  setAttributes('antialias', true);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  
  frameRate(60);

  setupLabelCanvas();
  setupChartCanvases();
  setupUIHoverGuards();

  countAInput = select('#countA');
  countBInput = select('#countB');
  speedSlider = select('#speedSlider');
  volumeSlider = select('#volumeSlider');
  
  playBtn = select('#playBtn');
  resetBtn = select('#resetBtn');
  labelBtn = select('#labelBtn');
  toggleCountsBtn = select('#toggleCountsBtn');
  concChartBtn = select('#concChartBtn');
  rateChartBtn = select('#rateChartBtn');
  modeReversibleBtn = select('#modeReversibleBtn');
  modeOneWayBtn = select('#modeOneWayBtn');
  
  speedValLabel = select('#speedVal');
  volValLabel = select('#volVal');

  cntAEl = document.getElementById('cntA');
  cntBEl = document.getElementById('cntB');
  cntCEl = document.getElementById('cntC');
  cntDEl = document.getElementById('cntD');

  let debouncedSyncA = debounce((val) => syncCount('A', val), 400);
  let debouncedSyncB = debounce((val) => syncCount('B', val), 400);

  countAInput.input(() => {
    let val = constrainCount(countAInput.value(), countAInput);
    debouncedSyncA(val);
  });
  countBInput.input(() => {
    let val = constrainCount(countBInput.value(), countBInput);
    debouncedSyncB(val);
  });

  speedSlider.input(() => {
    speedLevel = Number(speedSlider.value());
    speedValLabel.html(speedLevel.toFixed(1));
  });
  volumeSlider.input(() => {
    volumeLevel = Number(volumeSlider.value());
    volValLabel.html(volumeLevel);
  });

  playBtn.mousePressed(togglePlay);
  resetBtn.mousePressed(resetAll);
  labelBtn.mousePressed(toggleLabels);
  if(toggleCountsBtn) toggleCountsBtn.mousePressed(toggleCountsPanel);
  concChartBtn.mousePressed(toggleConcChart);
  rateChartBtn.mousePressed(toggleRateChart);
  modeReversibleBtn.mousePressed(() => setReactionMode('reversible'));
  modeOneWayBtn.mousePressed(() => setReactionMode('oneway'));

  initSoundPool();
  updateCountsPanel();
  
  globalSimTime = 0;
  recordConcSampleInitial();   
}

function toggleCountsPanel() {
  isCountsVisible = !isCountsVisible;
  let panel = document.getElementById('countsPanel');
  if (isCountsVisible) {
    toggleCountsBtn.html('📊 SL: BẬT').addClass('on');
    if (panel) panel.style.display = ''; 
  } else {
    toggleCountsBtn.html('📊 SL: TẮT').removeClass('on');
    if (panel) panel.style.display = 'none'; 
  }
}

function setupUIHoverGuards() {
  const uiElements = [
    document.getElementById('sidebar'),
    document.getElementById('countsPanel'),
    document.getElementById('concChartPanel'),
    document.getElementById('rateChartPanel')
  ];
  uiElements.forEach(el => {
    if (el) {
      el.addEventListener('pointerenter', () => { mouseOverUI = true; });
      el.addEventListener('pointerleave', () => { mouseOverUI = false; });
    }
  });
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

function getGlobalBounds() {
  let gMin = 0, gMax = 1;
  if (concHistory.length > 0) {
      gMin = concHistory[0].t;
      gMax = concHistory[concHistory.length - 1].t;
  }
  if (gMax - gMin < 1) gMax = gMin + 1;
  return { min: gMin, max: gMax };
}

function drawConcChart() { 
  if (showConcChart && concChartCtx) {
    let b = getGlobalBounds();
    renderLineChart(concChartCtx, concChartCanvas, concHistory, 'n', 'ab', 'cd', 'A + B', 'C + D', concSelectedTime, concChartZoom, concChartCanvas, b.min, b.max, 'BIỂU ĐỒ NỒNG ĐỘ THEO THỜI GIAN');
  }
}

function drawRateChart() { 
  if (showRateChart && rateChartCtx) {
    let b = getGlobalBounds();
    renderLineChart(rateChartCtx, rateChartCanvas, rateHistory, 'v (p.ứ/s)', 'fwd', 'rev', 'Chiều thuận', 'Chiều nghịch', rateSelectedTime, rateChartZoom, rateChartCanvas, b.min, b.max, 'BIỂU ĐỒ TỐC ĐỘ PHẢN ỨNG');
  }
}

function setupChartCanvases() {
  concChartCanvas = document.getElementById('concChartCanvas');
  concChartCtx = concChartCanvas.getContext('2d');
  rateChartCanvas = document.getElementById('rateChartCanvas');
  rateChartCtx = rateChartCanvas.getContext('2d');

  resizeChartCanvases();

  setupZoomableChart(concChartCanvas, () => concHistory, 
    (x, y) => { 
      if (x === null) concSelectedTime = null; 
      else concClickRequest = {x, y}; 
    },
    () => { drawConcChart(); },
    (zoom) => { concChartZoom = zoom; },
    () => concChartZoom,
    getGlobalBounds
  );

  setupZoomableChart(rateChartCanvas, () => rateHistory, 
    (x, y) => { 
      if (x === null) rateSelectedTime = null; 
      else rateClickRequest = {x, y}; 
    },
    () => { drawRateChart(); },
    (zoom) => { rateChartZoom = zoom; },
    () => rateChartZoom,
    getGlobalBounds
  );
}

function setupZoomableChart(canvasEl, getHistory, onClick, onRedraw, setZoom, getZoom, getBounds) {
  canvasEl.addEventListener('pointerdown', (evt) => {
    let history = getHistory();
    if (history.length === 0 || evt.button !== 0) return;
    let rect = canvasEl.getBoundingClientRect();
    chartDragState.canvas = canvasEl;
    chartDragState.startX = evt.clientX - rect.left;
    chartDragState.currentX = chartDragState.startX;
    canvasEl.setPointerCapture(evt.pointerId);
  });

  canvasEl.addEventListener('pointermove', (evt) => {
    if (chartDragState.canvas === canvasEl) {
      let rect = canvasEl.getBoundingClientRect();
      chartDragState.currentX = evt.clientX - rect.left;
      onRedraw();
    }
  });

  canvasEl.addEventListener('pointerup', (evt) => {
    if (chartDragState.canvas === canvasEl) {
      chartDragState.canvas = null;
      canvasEl.releasePointerCapture(evt.pointerId);
      let dx = chartDragState.currentX - chartDragState.startX;
      if (Math.abs(dx) > 5) {
        let t1 = getChartTimeForX(chartDragState.startX, canvasEl, getZoom(), getBounds);
        let t2 = getChartTimeForX(chartDragState.currentX, canvasEl, getZoom(), getBounds);
        setZoom({ min: Math.min(t1, t2), max: Math.max(t1, t2) });
      } else {
        let rect = canvasEl.getBoundingClientRect();
        onClick(evt.clientX - rect.left, evt.clientY - rect.top);
      }
      onRedraw();
    }
  });

  canvasEl.addEventListener('dblclick', () => { 
    setZoom(null); 
    onClick(null, null); 
    onRedraw(); 
  });
}

function getChartTimeForX(x, canvasEl, zoom, getBounds) {
  const w = canvasEl.clientWidth || 240, padLeft = 35, padRight = 10, plotW = Math.max(1, w - padLeft - padRight);
  let bounds = getBounds();
  let minT = bounds.min, maxT = bounds.max;
  if (zoom) { minT = zoom.min; maxT = zoom.max; }
  if (maxT - minT < 1) maxT = minT + 1;
  let clampedX = constrain(x, padLeft, padLeft + plotW);
  return minT + ((clampedX - padLeft) / plotW) * (maxT - minT);
}

function resizeChartCanvases() {
  resizeOneChartCanvas(concChartCanvas, concChartCtx);
  resizeOneChartCanvas(rateChartCanvas, rateChartCtx);
  if(showConcChart) drawConcChart();
  if(showRateChart) drawRateChart();
}

function resizeOneChartCanvas(canvasEl, ctx) {
  if (!canvasEl) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvasEl.clientWidth || 340; 
  const h = canvasEl.clientHeight || 180;
  canvasEl.width = Math.floor(w * dpr); 
  canvasEl.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function toggleConcChart() {
  showConcChart = !showConcChart;
  let panel = document.getElementById('concChartPanel');
  if (showConcChart) {
    concChartBtn.html('📈 Nồng độ: BẬT').addClass('on');
    panel.classList.remove('hidden');
    setTimeout(() => {
        resizeOneChartCanvas(concChartCanvas, concChartCtx);
        drawConcChart();
    }, 10);
  } else {
    concChartBtn.html('📈 Nồng độ: TẮT').removeClass('on');
    panel.classList.add('hidden');
  }
}

function toggleRateChart() {
  showRateChart = !showRateChart;
  let panel = document.getElementById('rateChartPanel');
  if (showRateChart) {
    rateChartBtn.html('⚡ Tốc độ: BẬT').addClass('on');
    panel.classList.remove('hidden');
    setTimeout(() => {
        resizeOneChartCanvas(rateChartCanvas, rateChartCtx);
        drawRateChart();
    }, 10);
  } else {
    rateChartBtn.html('⚡ Tốc độ: TẮT').removeClass('on');
    panel.classList.add('hidden');
  }
}

function checkPerformanceMode() {
  let total = molecules.length;
  if (total > PERFORMANCE_THRESHOLD) {
    if (showLabels) {
      showLabels = false;
      labelBtn.html('🏷 Nhãn: TẮT (TỐI GIẢN)').removeClass('on');
      labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    }
  }
}

function recordConcSampleInitial() {
  let ab = 0, cd = 0;
  molecules.forEach(m => {
    if (m.type === 'A' || m.type === 'B') ab++; else cd++;
  });
  concHistory.length = 0; 
  concHistory.push({ t: 0, ab, cd }); 
}

function renderLineChart(ctx, canvasEl, history, yLabel, seriesAKey, seriesBKey, seriesALabel, seriesBLabel, selectedTime, zoom, activeCanvas, gMin, gMax, chartTitle) {
  const w = canvasEl.clientWidth || 340, h = canvasEl.clientHeight || 180;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; ctx.fillRect(0, 0, w, h);

  const padLeft = 35, padRight = 10, padTop = 28, padBottom = 20;
  const plotW = Math.max(1, w - padLeft - padRight), plotH = Math.max(1, h - padTop - padBottom);
  let isRateChart = (yLabel === 'v (p.ứ/s)');

  // Tiêu đề đồ thị
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(chartTitle, padLeft + plotW / 2, 6);

  if (isRateChart && isWaitingForFirstReaction) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Đang chờ phản ứng đầu tiên...', padLeft + plotW / 2, padTop + plotH / 2);
    return;
  }
  if (!isRateChart && history.length < 2) { if (history.length === 0) return; }

  let minT = gMin;
  let maxT = gMax;
  if (zoom) { minT = zoom.min; maxT = zoom.max; }
  if (maxT - minT < 1) maxT = minT + 1;

  function xFor(t) { return padLeft + ((t - minT) / (maxT - minT)) * plotW; }

  let maxN = 1;
  if (isRateChart) {
    if (history.length > 0) {
      let vals = [];
      history.forEach(s => { if (s.t >= minT && s.t <= maxT) vals.push(s[seriesAKey], s[seriesBKey]); });
      if (vals.length > 0) {
        vals.sort((a, b) => a - b);
        maxN = Math.ceil(vals[Math.floor(vals.length * 0.95)] * 1.5) || 1; 
      }
    }
    if (maxN < 10) maxN = 10;
  } else {
    if (history.length > 0) {
      history.forEach(s => { if (s.t >= minT && s.t <= maxT) maxN = Math.max(maxN, s[seriesAKey], s[seriesBKey]); });
    }
    maxN = Math.ceil(maxN * 1.15) || 1;
  }

  function yFor(n) { return padTop + plotH - (n / maxN) * plotH; }

  let clickReq = isRateChart ? rateClickRequest : concClickRequest;
  if (clickReq) {
      let hit = false;
      let bestDist = 20; 
      let bestTime = null;

      for(let i = 0; i < history.length; i++) {
          let s = history[i];
          if (s.t >= minT && s.t <= maxT) {
              let px = xFor(s.t);
              let pyA = yFor(s[seriesAKey]);
              let pyB = yFor(s[seriesBKey]);
              
              let dA = Math.hypot(px - clickReq.x, pyA - clickReq.y);
              let dB = Math.hypot(px - clickReq.x, pyB - clickReq.y);
              let minDist = Math.min(dA, dB);

              if (minDist < bestDist) {
                  bestDist = minDist;
                  bestTime = s.t;
                  hit = true;
              }
          }
      }

      if (hit) {
          selectedTime = bestTime;
          if (isRateChart) rateSelectedTime = bestTime;
          else concSelectedTime = bestTime;
      } else {
          selectedTime = null; 
          if (isRateChart) rateSelectedTime = null;
          else concSelectedTime = null;
      }

      if (isRateChart) rateClickRequest = null;
      else concClickRequest = null;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, padTop + plotH); ctx.lineTo(padLeft + plotW, padTop + plotH); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '10px Arial, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(String(maxN), padLeft - 4, padTop + 2); ctx.fillText('0', padLeft - 4, padTop + plotH);
  ctx.save(); ctx.translate(8, padTop + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(yLabel, 0, 0); ctx.restore();

  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(minT.toFixed(1), padLeft, padTop + plotH + 4);
  ctx.textAlign = 'right'; ctx.fillText(maxT.toFixed(1), padLeft + plotW, padTop + plotH + 4);
  ctx.textAlign = 'center'; ctx.fillText('t (s)', padLeft + plotW / 2, padTop + plotH + 4);

  if (history.length < 2) return;

  ctx.save(); ctx.beginPath(); ctx.rect(padLeft, padTop, plotW, plotH); ctx.clip();

  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.beginPath();
  let firstA = true;
  history.forEach(s => {
    let x = xFor(s.t), y = yFor(s[seriesAKey]);
    if (firstA) { ctx.moveTo(x, y); firstA = false; } else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = '#ff8c1a'; ctx.lineWidth = 1.6; ctx.beginPath();
  let firstB = true;
  history.forEach(s => {
    let x = xFor(s.t), y = yFor(s[seriesBKey]);
    if (firstB) { ctx.moveTo(x, y); firstB = false; } else ctx.lineTo(x, y);
  });
  ctx.stroke();

  let markerTextData = null;
  if (selectedTime !== null && history.length > 0) {
    let bestPoint = null;
    let bestDiff = Infinity;
    for(let i = 0; i < history.length; i++) {
      let diff = Math.abs(history[i].t - selectedTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPoint = history[i];
      }
    }
    
    if (bestPoint && bestPoint.t >= minT && bestPoint.t <= maxT) {
      let x = xFor(bestPoint.t);
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH); ctx.stroke(); ctx.restore();

      let yA = yFor(bestPoint[seriesAKey]), yB = yFor(bestPoint[seriesBKey]);
      if (yA >= padTop) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, yA, 4, 0, Math.PI * 2); ctx.fill(); }
      if (yB >= padTop) { ctx.fillStyle = '#ff8c1a'; ctx.beginPath(); ctx.arc(x, yB, 4, 0, Math.PI * 2); ctx.fill(); }
      markerTextData = { x, s: bestPoint };
    }
  }

  if (chartDragState.canvas === activeCanvas) {
    ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
    let rx = Math.min(chartDragState.startX, chartDragState.currentX), endX = Math.max(chartDragState.startX, chartDragState.currentX);
    rx = constrain(rx, padLeft, padLeft + plotW); endX = constrain(endX, padLeft, padLeft + plotW);
    let dragW = endX - rx;
    ctx.fillRect(rx, padTop, dragW, plotH);

    if (dragW > 2) {
      let t1 = minT + ((rx - padLeft) / plotW) * (maxT - minT), t2 = minT + ((endX - padLeft) / plotW) * (maxT - minT);
      let dragText = `${t1.toFixed(1)}s ➝ ${t2.toFixed(1)}s`;
      ctx.font = 'bold 10px Arial, sans-serif'; let txtW = ctx.measureText(dragText).width, cx = rx + dragW / 2;
      if (cx - txtW / 2 < padLeft + 2) cx = padLeft + 2 + txtW / 2;
      if (cx + txtW / 2 > padLeft + plotW - 2) cx = padLeft + plotW - 2 - txtW / 2;

      ctx.fillStyle = 'rgba(20, 20, 25, 0.85)'; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - txtW / 2 - 6, padTop + 4, txtW + 12, 16, 4);
      else ctx.rect(cx - txtW / 2 - 6, padTop + 4, txtW + 12, 16);
      ctx.fill(); ctx.fillStyle = '#60a5fa'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(dragText, cx, padTop + 12);
    }
  }
  ctx.restore(); 

  if (markerTextData) {
    let { x, s } = markerTextData;
    let lineA = seriesALabel + ': ' + s[seriesAKey], lineB = seriesBLabel + ': ' + s[seriesBKey], lineT = 't = ' + s.t.toFixed(2) + ' s';
    ctx.font = 'bold 10px Arial, sans-serif';
    let textW = Math.max(ctx.measureText(lineT).width, ctx.measureText(lineA).width, ctx.measureText(lineB).width);
    let boxW = textW + 14, boxH = 44, boxX = x + 8;
    
    if (boxX + boxW > w - 2) boxX = x - boxW - 8; 
    boxX = constrain(boxX, 2, w - boxW - 2); 
    let boxY = padTop + 2;

    ctx.fillStyle = 'rgba(10, 10, 14, 0.9)'; ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; ctx.lineWidth = 1; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 5); else ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill(); ctx.stroke();

    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 10px Arial, sans-serif';
    ctx.fillText(lineT, boxX + 7, boxY + 4); ctx.fillStyle = '#ffffff'; ctx.fillText(lineA, boxX + 7, boxY + 17);
    ctx.fillStyle = '#ff8c1a'; ctx.fillText(lineB, boxX + 7, boxY + 30);
  }
}

function transformVec4(m, v) {
  return [
    m[0]*v[0] + m[4]*v[1] + m[8]*v[2] + m[12]*v[3], m[1]*v[0] + m[5]*v[1] + m[9]*v[2] + m[13]*v[3],
    m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]*v[3], m[3]*v[0] + m[7]*v[1] + m[11]*v[2] + m[15]*v[3]
  ];
}

function projectToScreen(pos) {
  if (!frameMV || !frameP) return null;
  let clip = transformVec4(frameP, transformVec4(frameMV, [pos.x, pos.y, pos.z, 1]));
  if (clip[3] === 0) return null;
  let ndcX = clip[0]/clip[3], ndcY = clip[1]/clip[3], ndcZ = clip[2]/clip[3];
  if (ndcZ < -1 || ndcZ > 1) return null; 
  return { x: (ndcX * 0.5 + 0.5) * width, y: (1 - (ndcY * 0.5 + 0.5)) * height };
}

function getCameraPosition() {
  let cam = _renderer._curCamera;
  return (cam && typeof cam.eyeX === 'number') ? createVector(cam.eyeX, cam.eyeY, cam.eyeZ) : createVector(0, 0, 800); 
}

function accurateScreenRadius(pos, radius, camPos) {
  let viewDir = p5.Vector.sub(pos, camPos);
  if (viewDir.magSq() < 0.0001) return 0; viewDir.normalize();
  let right = viewDir.cross(createVector(0, 1, 0));
  if (right.magSq() < 0.0001) right = createVector(1, 0, 0); right.normalize();
  let c1 = projectToScreen(pos), c2 = projectToScreen(p5.Vector.add(pos, p5.Vector.mult(right, radius)));
  return (!c1 || !c2) ? 0 : dist(c1.x, c1.y, c2.x, c2.y);
}

// ---------------- THUẬT TOÁN DÒ TÌM HÀNG XÓM BẰNG LƯỚI KHÔNG GIAN ----------------
function buildSpatialGrid(cellSize) {
  gridHead.fill(-1);
  let offset = Math.floor(GRID_DIM / 2); 
  
  molecules.forEach((m, i) => {
    let ix = Math.floor(m.pos.x / cellSize) + offset;
    let iy = Math.floor(m.pos.y / cellSize) + offset;
    let iz = Math.floor(m.pos.z / cellSize) + offset;
    
    ix = constrain(ix, 0, GRID_DIM - 1);
    iy = constrain(iy, 0, GRID_DIM - 1);
    iz = constrain(iz, 0, GRID_DIM - 1);
    
    let bucketIdx = ix + iy * GRID_DIM + iz * GRID_DIM * GRID_DIM;
    gridNext[i] = gridHead[bucketIdx];
    gridHead[bucketIdx] = i;
  });
}

function getNeighborIndices(cellSize, pos) {
  neighborsCount = 0;
  let offset = Math.floor(GRID_DIM / 2);
  let ix = Math.floor(pos.x / cellSize) + offset;
  let iy = Math.floor(pos.y / cellSize) + offset;
  let iz = Math.floor(pos.z / cellSize) + offset;

  GRID_OFFSETS.forEach(off => {
    let cx = ix + off.dx, cy = iy + off.dy, cz = iz + off.dz;
    if (cx >= 0 && cx < GRID_DIM && cy >= 0 && cy < GRID_DIM && cz >= 0 && cz < GRID_DIM) {
      let bucketIdx = cx + cy * GRID_DIM + cz * GRID_DIM * GRID_DIM;
      let curr = gridHead[bucketIdx];
      
      LOOP_5000.some(() => {
        if (curr === -1 || neighborsCount >= 5000) return true; 
        neighborsBuffer[neighborsCount++] = curr;
        curr = gridNext[curr];
        return false;
      });
    }
  });
}

function currentCellSize() {
  let avgRadius = 14 * radiusScale;
  let minCell = BOX_SIZE / 45; 
  return Math.max(minCell, avgRadius * 4.5);
}

const SCREEN_CELL_SIZE = 80;
function drawLabels() {
  labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  labelCtx.font = 'bold 14px Arial, sans-serif'; 
  labelCtx.textAlign = 'center'; labelCtx.textBaseline = 'middle';
  let camPos = frameCamPos; let info = new Array(molecules.length).fill(null);
  
  molecules.forEach((m, i) => {
    let s = projectToScreen(m.pos);
    if (s) info[i] = { m, s, camDist: p5.Vector.dist(m.pos, camPos), screenR: accurateScreenRadius(m.pos, m.radius, camPos) };
  });

  let screenGrid = new Map();
  info.forEach((item, idx) => {
    if (!item) return;
    let key = Math.floor(item.s.x / SCREEN_CELL_SIZE) + ',' + Math.floor(item.s.y / SCREEN_CELL_SIZE);
    let bucket = screenGrid.get(key);
    if (!bucket) { bucket = []; screenGrid.set(key, bucket); }
    bucket.push(idx);
  });

  info.forEach((cur, i) => {
    if (!cur) return;
    let occluded = false;
    let ix = Math.floor(cur.s.x / SCREEN_CELL_SIZE), iy = Math.floor(cur.s.y / SCREEN_CELL_SIZE);
    
    GRID_OFFSETS_2D.some(off => {
      let bucket = screenGrid.get((ix + off.dx) + ',' + (iy + off.dy));
      if (bucket) {
        return bucket.some(j => {
          if (j === i) return false;
          let other = info[j];
          if (!other || other.camDist >= cur.camDist - 0.5 || other.screenR <= 0) return false;
          if (dist(cur.s.x, cur.s.y, other.s.x, other.s.y) < other.screenR * 0.85) { occluded = true; return true; }
          return false;
        });
      }
      return false;
    });

    if (!occluded) {
      let scale = Math.max(0.4, cur.screenR / 13);
      labelCtx.save(); labelCtx.translate(cur.s.x, cur.s.y); labelCtx.scale(scale, scale); 
      labelCtx.fillStyle = cur.m.labelColorHex; labelCtx.fillText(cur.m.type, 0, 0); labelCtx.restore();
    }
  });
}

function initSoundPool() {
  Array.from({ length: OSC_POOL_SIZE }).forEach(() => {
    let osc = new p5.Oscillator('sine'); osc.amp(0); osc.start();
    let env = new p5.Envelope(); env.setADSR(0.001, 0.08, 0.0, 0.05); env.setRange(1, 0);
    oscPool.push({ osc, env });
  });
}

function constrainCount(v, inputEl) {
  v = Number(v);
  if (isNaN(v) || v < 0) v = 0;
  if (v > MAX_PER_TYPE) v = MAX_PER_TYPE;
  v = Math.floor(v);
  if (inputEl && Number(inputEl.value()) !== v) inputEl.value(v);
  return v;
}

// ---------------- THUẬT TOÁN SINH HẠT O(1) KHÔNG ĐÈ LẤP ----------------
function syncCount(type, target) {
  let count = 0;
  molecules.forEach(m => { if (m.type === type) count++; });
  let diff = target - count;
  
  if (diff > 0) {
    let futureTotal = molecules.length + diff;
    
    if (futureTotal <= PERFORMANCE_THRESHOLD) {
      radiusScale = map(futureTotal, 0, PERFORMANCE_THRESHOLD, 1.0, 0.4, true);
    } else {
      let scaleRatio = Math.cbrt(PERFORMANCE_THRESHOLD / futureTotal);
      radiusScale = 0.4 * scaleRatio;
    }
    radiusScale = constrain(radiusScale, 0.08, 1.0); 
    molecules.forEach(m => { m.radius = BASE_RADIUS[m.type] * radiusScale; });

    let r = BASE_RADIUS[type] * radiusScale;
    let mBound = HALF - r;

    frameCellSize = currentCellSize();
    buildSpatialGrid(frameCellSize);

    Array.from({length: diff}).forEach(() => {
      let pos;
      
      LOOP_50.some(() => {
        pos = createVector(random(-mBound, mBound), random(-mBound, mBound), random(-mBound, mBound));
        let overlapping = false;

        getNeighborIndices(frameCellSize, pos);

        neighborsBuffer.subarray(0, neighborsCount).some(j => {
          let other = molecules[j];
          let minDist = r + other.radius + 0.1; 
          let dx = pos.x - other.pos.x;
          let dy = pos.y - other.pos.y;
          let dz = pos.z - other.pos.z;
          
          if (dx*dx + dy*dy + dz*dz < minDist * minDist) {
            overlapping = true;
            return true; 
          }
          return false;
        });

        if (!overlapping) return true; 
        return false; 
      });

      molecules.push(new Molecule(type, pos));

      let newIdx = molecules.length - 1;
      let offset = Math.floor(GRID_DIM / 2);
      let ix = constrain(Math.floor(pos.x / frameCellSize) + offset, 0, GRID_DIM - 1);
      let iy = constrain(Math.floor(pos.y / frameCellSize) + offset, 0, GRID_DIM - 1);
      let iz = constrain(Math.floor(pos.z / frameCellSize) + offset, 0, GRID_DIM - 1);

      let bucketIdx = ix + iy * GRID_DIM + iz * GRID_DIM * GRID_DIM;
      gridNext[newIdx] = gridHead[bucketIdx];
      gridHead[bucketIdx] = newIdx;
    });

  } else if (diff < 0) {
    let toRemove = -diff;
    let removed = 0;
    molecules = molecules.filter(m => {
      if (m.type === type && removed < toRemove) { removed++; return false; }
      return true;
    });
    updateRadiusScale();
  }
  
  checkPerformanceMode(); 
  updateCountsPanel();
  if (!isPlaying) recordConcSampleInitial();
}

function updateRadiusScale() {
  let total = molecules.length;
  if (total <= PERFORMANCE_THRESHOLD) {
    radiusScale = map(total, 0, PERFORMANCE_THRESHOLD, 1.0, 0.4, true);
  } else {
    let scaleRatio = Math.cbrt(PERFORMANCE_THRESHOLD / total);
    radiusScale = 0.4 * scaleRatio;
  }
  radiusScale = constrain(radiusScale, 0.08, 1.0); 
  molecules.forEach(m => { m.radius = BASE_RADIUS[m.type] * radiusScale; });
}

function togglePlay() {
  isPlaying = !isPlaying;
  if (isPlaying) {
    playBtn.html('⏸ STOP').removeClass('primary').addClass('danger');
    if (getAudioContext().state !== 'running') userStartAudio();
  } else {
    playBtn.html('▶ PLAY').removeClass('danger').addClass('primary');
  }
}

function toggleLabels() {
  if (molecules.length > PERFORMANCE_THRESHOLD) {
    alert("Không thể bật nhãn khi có hơn " + PERFORMANCE_THRESHOLD + " phân tử để đảm bảo hiệu suất trình duyệt.");
    return;
  }
  showLabels = !showLabels;
  if (showLabels) labelBtn.html('🏷 Nhãn: BẬT').addClass('on');
  else { labelBtn.html('🏷 Nhãn: TẮT').removeClass('on'); labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height); }
}

function resetAll() {
  isPlaying = false;
  playBtn.html('▶ PLAY').removeClass('danger').addClass('primary');
  molecules = []; flashes = [];
  countAInput.value(0); countBInput.value(0);
  speedSlider.value(3.0); volumeSlider.value(5);
  speedLevel = 3.0; volumeLevel = 5;
  speedValLabel.html("3.0"); volValLabel.html(5);
  radiusScale = 1; setReactionMode('reversible');
  labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);

  globalSimTime = 0; chartSampleAccumulator = 0; 
  
  concHistory.length = 0; concSelectedTime = null; concClickRequest = null;
  rateHistory.length = 0; rateRolling.length = 0;
  
  fwdCountThisFrame = 0; revCountThisFrame = 0;
  isWaitingForFirstReaction = true;
  
  rateSelectedTime = null; rateClickRequest = null;
  concChartZoom = null; rateChartZoom = null; chartDragState.canvas = null;

  updateCountsPanel(); recordConcSampleInitial();
}

function updateCountsPanel() {
  let counts = { A: 0, B: 0, C: 0, D: 0 };
  molecules.forEach(m => { counts[m.type]++; });
  if (cntAEl) cntAEl.textContent = counts.A; if (cntBEl) cntBEl.textContent = counts.B;
  if (cntCEl) cntCEl.textContent = counts.C; if (cntDEl) cntDEl.textContent = counts.D;
}

// ---------------- LỚP PHÂN TỬ VÀ HIỆU ỨNG ----------------
class Molecule {
  constructor(type, pos) {
    this.type = type; this.pos = pos.copy(); this.vel = p5.Vector.random3D();
    this.radius = BASE_RADIUS[type] * radiusScale;
    this.color = TYPE_COLORS[type]; this.labelColorHex = LABEL_COLORS[type];
  }
  update(speedFactor) {
    if (speedFactor <= 0) return;
    this.pos.x += this.vel.x * speedFactor;
    this.pos.y += this.vel.y * speedFactor;
    this.pos.z += this.vel.z * speedFactor;
    
    let m = HALF - this.radius;
    if (this.pos.x > m) { this.pos.x = m; this.vel.x *= -1; }
    if (this.pos.x < -m) { this.pos.x = -m; this.vel.x *= -1; }
    if (this.pos.y > m) { this.pos.y = m; this.vel.y *= -1; }
    if (this.pos.y < -m) { this.pos.y = -m; this.vel.y *= -1; }
    if (this.pos.z > m) { this.pos.z = m; this.vel.z *= -1; }
    if (this.pos.z < -m) { this.pos.z = -m; this.vel.z *= -1; }
  }
  display() {
    push(); translate(this.pos.x, this.pos.y, this.pos.z);
    noStroke(); ambientMaterial(this.color[0], this.color[1], this.color[2]);
    let total = molecules.length;
    let detail = total > 1000 ? 6 : (total > 400 ? 8 : (this.radius > 6 ? 20 : 10));
    sphere(this.radius, detail, detail);
    pop();
  }
}

function drawMoleculesBatch() {
  const types = ['A', 'B', 'C', 'D'];
  types.forEach(t => {
    let c = TYPE_COLORS[t];
    stroke(c[0], c[1], c[2]);
    strokeWeight(Math.max(3.0, BASE_RADIUS[t] * radiusScale * 2.5));
    beginShape(POINTS);
    molecules.forEach(m => {
      if (m.type === t) vertex(m.pos.x, m.pos.y, m.pos.z);
    });
    endShape();
  });
}

class Flash {
  constructor(pos, colorArr) { this.pos = pos.copy(); this.color = colorArr; this.age = 0; this.maxAge = 10; }
  update() { this.age++; return this.age < this.maxAge; }
  display() {
    let t = this.age / this.maxAge; 
    let r = lerp(8, 55, easeOutCubic(t)) * Math.max(radiusScale, 0.4);
    let alpha = 255 * (1 - easeInQuad(t));
    if (alpha <= 1) return;

    push(); translate(this.pos.x, this.pos.y, this.pos.z); noStroke();
    drawingContext.disable(drawingContext.DEPTH_TEST); blendMode(ADD);
    emissiveMaterial(this.color[0], this.color[1], this.color[2]); ambientMaterial(0, 0, 0);
    fill(this.color[0], this.color[1], this.color[2], alpha);
    
    let detail = radiusScale < 0.2 ? 4 : 14; 
    sphere(r, detail, detail);
    blendMode(BLEND); drawingContext.enable(drawingContext.DEPTH_TEST); pop();
  }
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInQuad(t) { return t * t; }

function playCollisionSound(freq) {
  if (volumeLevel <= 0) return;
  let slot = oscPool[oscIndex]; oscIndex = (oscIndex + 1) % OSC_POOL_SIZE;
  slot.osc.freq(freq); slot.env.setRange(map(volumeLevel, 0, 10, 0, 0.5), 0); slot.env.play(slot.osc);
}

function isABPair(t1, t2) { return (t1 === 'A' && t2 === 'B') || (t1 === 'B' && t2 === 'A'); }
function isCDPair(t1, t2) { return (t1 === 'C' && t2 === 'D') || (t1 === 'D' && t2 === 'C'); }
function shouldReact(t1, t2) { return isABPair(t1, t2) || (isCDPair(t1, t2) && reactionMode === 'reversible'); }

function handleCollisions() {
  toRemoveFlag.fill(0); 
  let newMolecules = [];
  let countChanged = false;
  let soundsPlayedThisFrame = 0;
  let flashesCreatedThisFrame = 0;

  molecules.forEach((m1, i) => {
    if (toRemoveFlag[i] === 1) return;

    getNeighborIndices(frameCellSize, m1.pos);

    neighborsBuffer.subarray(0, neighborsCount).some(j => {
      if (j <= i) return false; 
      if (toRemoveFlag[j] === 1) return false;

      let m2 = molecules[j];
      let minD = m1.radius + m2.radius;
      
      let dx = m1.pos.x - m2.pos.x;
      let dy = m1.pos.y - m2.pos.y;
      let dz = m1.pos.z - m2.pos.z;
      let dSq = dx*dx + dy*dy + dz*dz;
      
      if (dSq < minD * minD) {
        let d = Math.sqrt(dSq); 
        let mid = p5.Vector.lerp(m1.pos, m2.pos, 0.5);
        let normal = p5.Vector.sub(m2.pos, m1.pos);
        if (dSq < 0.0001) normal = p5.Vector.random3D(); else normal.normalize();

        if (shouldReact(m1.type, m2.type)) {
          toRemoveFlag[i] = 1;
          toRemoveFlag[j] = 1;
          
          let newType1, newType2, flashColor, freq;
          if (m1.type === 'A' || m1.type === 'B') {
            newType1 = 'C'; newType2 = 'D'; flashColor = [255, 45, 45]; freq = 220; fwdCountThisFrame++; 
          } else {
            newType1 = 'A'; newType2 = 'B'; flashColor = [255, 225, 30]; freq = 330; revCountThisFrame++; 
          }

          let r1 = BASE_RADIUS[newType1] * radiusScale, r2 = BASE_RADIUS[newType2] * radiusScale;
          let gap = (r1 + r2) * 0.9 + 6 * radiusScale;

          let n1 = new Molecule(newType1, clampInsideBox(p5.Vector.add(mid, p5.Vector.mult(normal, -gap / 2)), r1));
          let n2 = new Molecule(newType2, clampInsideBox(p5.Vector.add(mid, p5.Vector.mult(normal, gap / 2)), r2));
          n1.vel = p5.Vector.mult(normal, -1).add(p5.Vector.random3D().mult(0.3)).normalize();
          n2.vel = p5.Vector.mult(normal, 1).add(p5.Vector.random3D().mult(0.3)).normalize();

          newMolecules.push(n1, n2);
          
          if (flashesCreatedThisFrame < 15) { flashes.push(new Flash(mid, flashColor)); flashesCreatedThisFrame++; }
          if (soundsPlayedThisFrame < 2) { playCollisionSound(freq); soundsPlayedThisFrame++; }
          
          countChanged = true; return true; 
        } else {
          let overlap = minD - d;
          m1.pos.add(p5.Vector.mult(normal, -overlap / 2)); m2.pos.add(p5.Vector.mult(normal, overlap / 2));
          let v1n = p5.Vector.mult(normal, m1.vel.dot(normal)), v2n = p5.Vector.mult(normal, m2.vel.dot(normal));
          m1.vel.sub(v1n).add(v2n); m2.vel.sub(v2n).add(v1n);
        }
      }
      return false;
    });
  });

  if (countChanged) {
    let newArr = [];
    molecules.forEach((m, i) => {
      if (toRemoveFlag[i] === 0) newArr.push(m);
    });
    molecules = newArr.concat(newMolecules);
    updateCountsPanel();
  }
}

function clampInsideBox(pos, radius) {
  let m = HALF - radius;
  pos.x = constrain(pos.x, -m, m); pos.y = constrain(pos.y, -m, m); pos.z = constrain(pos.z, -m, m); return pos;
}

// ---------------- THUẬT TOÁN V=K[A][B] MACRO-KINETICS ----------------
function draw() {
  background(0, 0, 2);

  if (!mouseOverUI) orbitControl(1, 1, 0.15);

  frameMV = _renderer.uMVMatrix.copy().mat4;
  frameP = _renderer.uPMatrix.copy().mat4;
  frameCamPos = getCameraPosition();

  if (molecules.length <= POINT_RENDER_THRESHOLD) {
    ambientLight(140, 140, 140);
    pointLight(180, 180, 180, 150, -220, 260);
  }

  push(); noFill(); stroke(120, 190, 255, 160); strokeWeight(1.2); box(BOX_SIZE); pop();

  let speedFactor = map(speedLevel, 0, 20, 0, 8.4);

  if (isPlaying) {
    fwdCountThisFrame = 0;
    revCountThisFrame = 0;

    let minDiameter = 14 * radiusScale * 2;
    let steps = 1;
    if (speedFactor > minDiameter * 0.8) {
      steps = Math.ceil(speedFactor / (minDiameter * 0.8));
      if (steps > 4) steps = 4; 
    }
    
    let stepSpeed = speedFactor / steps;
    let stepArray = [1];
    if (steps === 2) stepArray = [1, 2];
    if (steps === 3) stepArray = [1, 2, 3];
    if (steps === 4) stepArray = [1, 2, 3, 4];

    stepArray.forEach(() => {
      molecules.forEach(m => m.update(stepSpeed));
      frameCellSize = currentCellSize();
      buildSpatialGrid(frameCellSize); 
      handleCollisions();
    });

    let N_A = 0, N_B = 0, N_C = 0, N_D = 0;
    molecules.forEach(m => {
        if(m.type==='A') N_A++;
        else if(m.type==='B') N_B++;
        else if(m.type==='C') N_C++;
        else if(m.type==='D') N_D++;
    });

    let pairs_AB = N_A * N_B;
    let pairs_CD = N_C * N_D;

    rateRolling.push({
        fwd: fwdCountThisFrame,
        rev: revCountThisFrame,
        pairsAB: pairs_AB,
        pairsCD: pairs_CD,
        dt: FIXED_DT
    });

    if (rateRolling.length > 120) rateRolling.shift(); 

    let sumCollisions = 0;
    let sumPairsDt = 0;
    for (let i = 0; i < rateRolling.length; i++) {
        let r = rateRolling[i];
        sumCollisions += r.fwd;
        sumPairsDt += r.pairsAB * r.dt;
        if (reactionMode === 'reversible') {
            sumCollisions += r.rev;
            sumPairsDt += r.pairsCD * r.dt;
        }
    }

    let k_global = sumPairsDt > 0 ? (sumCollisions / sumPairsDt) : 0;
    
    let currentRateF = k_global * pairs_AB;
    let currentRateR = (reactionMode === 'reversible') ? (k_global * pairs_CD) : 0;

    if (isWaitingForFirstReaction) {
        if (fwdCountThisFrame > 0 || revCountThisFrame > 0) {
            isWaitingForFirstReaction = false;
            globalSimTime = 0;
            chartSampleAccumulator = 0;
            
            concHistory.length = 0;
            rateHistory.length = 0;
            
            concHistory.push({ t: 0, ab: N_A + N_B, cd: N_C + N_D });
            rateHistory.push({ t: 0, fwd: Math.round(currentRateF*10)/10, rev: Math.round(currentRateR*10)/10 });
        }
    } else {
        globalSimTime += FIXED_DT;
        chartSampleAccumulator += FIXED_DT;
        
        if (chartSampleAccumulator >= CHART_SAMPLE_INTERVAL) {
            chartSampleAccumulator -= CHART_SAMPLE_INTERVAL;
            
            let roundedTime = Math.round(globalSimTime * 100) / 100;
            
            concHistory.push({ t: roundedTime, ab: N_A + N_B, cd: N_C + N_D });
            if (concHistory.length > CHART_MAX_SAMPLES) concHistory.shift();

            rateHistory.push({ t: roundedTime, fwd: Math.round(currentRateF*10)/10, rev: Math.round(currentRateR*10)/10 });
            if (rateHistory.length > CHART_MAX_SAMPLES) rateHistory.shift();
        }
    }
  }

  if (concChartCanvas && concChartCanvas.width === 0) resizeChartCanvases();

  if (showConcChart) drawConcChart();
  if (showRateChart) drawRateChart();

  if (molecules.length > POINT_RENDER_THRESHOLD) {
    drawMoleculesBatch();
  } else {
    molecules.forEach(m => m.display());
  }

  flashes = flashes.filter(f => {
    let alive = f.update();
    if (alive) f.display();
    return alive;
  });

  if (showLabels && molecules.length <= PERFORMANCE_THRESHOLD) {
    drawLabels();
  } else {
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  }
}

function windowResized() {
  resizeCanvas(canvasHolder.offsetWidth, canvasHolder.offsetHeight);
  resizeLabelCanvas();
  resizeChartCanvases();
}