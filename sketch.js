// noprotect
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

// True while the pointer is hovering the sidebar or any display panel
// (counts / charts). While true, canvas orbit/zoom must be disabled so
// interacting with the UI never rotates or zooms the 3D scene underneath.
let mouseOverUI = false;

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
let concChartBtn, rateChartBtn;
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
// ĐÃ ĐỒNG NHẤT BÁN KÍNH: A, B, C, D đều bằng 14
const BASE_RADIUS = { A: 14, B: 14, C: 14, D: 14 };

// ---------------- Charts ----------------
const CHART_SAMPLE_INTERVAL = 0.1; // seconds between recorded concentration samples
const CHART_MAX_SAMPLES = 6000; // ~10 minutes of history at the interval above

// HỆ THỐNG THỜI GIAN ĐỘC LẬP (Independent Timers)
// 1. Dành cho đồ thị Nồng độ (Chạy ngay từ đầu)
let concTime = 0; 
let concSampleAccumulator = 0;
let showConcChart = false;
let concChartCanvas, concChartCtx;
let concHistory = []; // { t, ab, cd }
let concSelectedIndex = -1; 

// 2. Dành cho đồ thị Tốc độ (Chỉ đếm từ lúc có va chạm đầu tiên)
let rateTime = 0; 
let rateSampleAccumulator = 0;
let showRateChart = false;
let rateChartCanvas, rateChartCtx;
let rateHistory = []; // { t, fwd, rev } 
let fwdCount = 0; 
let revCount = 0; 
let fwdRateEMA = 0; 
let revRateEMA = 0; 
let isWaitingForFirstReaction = true; 
const RATE_EMA_ALPHA = 0.15; 
let rateSelectedIndex = -1; 

// State cho việc Drag to Zoom đồ thị
let concChartZoom = null;
let rateChartZoom = null;
let chartDragState = { canvas: null, startX: 0, currentX: 0 };

function setup() {
  canvasHolder = document.getElementById('canvas-holder');
  const cnv = createCanvas(canvasHolder.offsetWidth, canvasHolder.offsetHeight, WEBGL);
  cnv.parent('canvas-holder');
  smooth();
  setAttributes('antialias', true);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));

  setupLabelCanvas();
  setupChartCanvases();
  setupUIHoverGuards();

  // UI bindings
  countAInput = select('#countA');
  countBInput = select('#countB');
  speedSlider = select('#speedSlider');
  volumeSlider = select('#volumeSlider');
  playBtn = select('#playBtn');
  resetBtn = select('#resetBtn');
  labelBtn = select('#labelBtn');
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
  concChartBtn.mousePressed(toggleConcChart);
  rateChartBtn.mousePressed(toggleRateChart);
  modeReversibleBtn.mousePressed(() => setReactionMode('reversible'));
  modeOneWayBtn.mousePressed(() => setReactionMode('oneway'));

  initSoundPool();
  updateCountsPanel();
  
  // Mồi điểm xuất phát t=0 cho nồng độ (nơi C và D bằng 0)
  concTime = 0;
  recordConcSample();   
}

// Blocks canvas orbit/zoom while the pointer hovers the sidebar or any display panel
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

// ---------------- Chart overlays (2D canvases, HTML-positioned panels) ----------------
function setupChartCanvases() {
  concChartCanvas = document.getElementById('concChartCanvas');
  concChartCtx = concChartCanvas.getContext('2d');

  rateChartCanvas = document.getElementById('rateChartCanvas');
  rateChartCtx = rateChartCanvas.getContext('2d');

  resizeChartCanvases();

  // Bắt sự kiện Quét chọn để Zoom và Klick cho biểu đồ Nồng Độ
  setupZoomableChart(concChartCanvas, concHistory, 
    (idx) => { concSelectedIndex = idx; drawConcChart(); },
    () => drawConcChart(),
    (zoom) => { concChartZoom = zoom; },
    () => concChartZoom
  );

  // Bắt sự kiện Quét chọn để Zoom và Klick cho biểu đồ Tốc độ
  setupZoomableChart(rateChartCanvas, rateHistory, 
    (idx) => { rateSelectedIndex = idx; drawRateChart(); },
    () => drawRateChart(),
    (zoom) => { rateChartZoom = zoom; },
    () => rateChartZoom
  );
}

// Logic tổng quát bắt sự kiện kéo thả (Drag) cho bất kỳ biểu đồ nào
function setupZoomableChart(canvasEl, history, onSelect, onRedraw, setZoom, getZoom) {
  canvasEl.addEventListener('pointerdown', (evt) => {
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
        // Quét chuột thành công -> Tính khoảng thời gian để Zoom
        let t1 = getChartTimeForX(chartDragState.startX, canvasEl, history, getZoom());
        let t2 = getChartTimeForX(chartDragState.currentX, canvasEl, history, getZoom());
        setZoom({ min: Math.min(t1, t2), max: Math.max(t1, t2) });
      } else {
        // Click bình thường -> Chọn điểm
        let tClicked = getChartTimeForX(chartDragState.startX, canvasEl, history, getZoom());
        let bestIdx = 0;
        let bestDiff = Infinity;
        
        history.forEach((h, i) => {
          let diff = Math.abs(h.t - tClicked);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        });
        
        onSelect(bestIdx);
      }
      onRedraw();
    }
  });

  // Click đúp để Reset Zoom
  canvasEl.addEventListener('dblclick', () => {
    setZoom(null);
    onRedraw();
  });
}

function getChartTimeForX(x, canvasEl, history, zoom) {
  const w = canvasEl.clientWidth || 240;
  const padLeft = 30;
  const plotW = Math.max(1, w - padLeft - 8);

  let minT = history[0].t;
  let maxT = history[history.length - 1].t;
  if (zoom) {
    minT = zoom.min;
    maxT = zoom.max;
  }
  if (maxT - minT < 1) maxT = minT + 1;

  let clampedX = constrain(x, padLeft, padLeft + plotW);
  return minT + ((clampedX - padLeft) / plotW) * (maxT - minT);
}

function resizeChartCanvases() {
  resizeOneChartCanvas(concChartCanvas, concChartCtx);
  resizeOneChartCanvas(rateChartCanvas, rateChartCtx);
}

function resizeOneChartCanvas(canvasEl, ctx) {
  if (!canvasEl) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvasEl.clientWidth || 240;
  const h = canvasEl.clientHeight || 130;
  canvasEl.width = Math.floor(w * dpr);
  canvasEl.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function toggleConcChart() {
  showConcChart = !showConcChart;
  let panel = document.getElementById('concChartPanel');
  if (showConcChart) {
    concChartBtn.html('📈 NỒNG ĐỘ: BẬT');
    concChartBtn.addClass('on');
    panel.classList.remove('hidden');
    resizeOneChartCanvas(concChartCanvas, concChartCtx);
    drawConcChart();
  } else {
    concChartBtn.html('📈 NỒNG ĐỘ: TẮT');
    concChartBtn.removeClass('on');
    panel.classList.add('hidden');
  }
}

function toggleRateChart() {
  showRateChart = !showRateChart;
  let panel = document.getElementById('rateChartPanel');
  if (showRateChart) {
    rateChartBtn.html('⚡ TỐC ĐỘ: BẬT');
    rateChartBtn.addClass('on');
    panel.classList.remove('hidden');
    resizeOneChartCanvas(rateChartCanvas, rateChartCtx);
    drawRateChart();
  } else {
    rateChartBtn.html('⚡ TỐC ĐỘ: TẮT');
    rateChartBtn.removeClass('on');
    panel.classList.add('hidden');
  }
}

// Sử dụng concTime riêng biệt
function recordConcSample() {
  let ab = 0, cd = 0;
  molecules.forEach(m => {
    if (m.type === 'A' || m.type === 'B') ab++;
    else cd++;
  });
  
  // Tránh ghi đè trùng timestamp nếu pause
  if (concHistory.length > 0 && concHistory[concHistory.length - 1].t === concTime) {
    concHistory[concHistory.length - 1] = { t: concTime, ab, cd };
  } else {
    concHistory.push({ t: concTime, ab, cd });
    if (concHistory.length > CHART_MAX_SAMPLES) {
      concHistory.splice(0, concHistory.length - CHART_MAX_SAMPLES);
      if (concSelectedIndex >= 0) concSelectedIndex = Math.max(0, concSelectedIndex - 1);
    }
  }
}

// Sử dụng rateTime riêng biệt
function recordRateSample() {
  let instFwd = fwdCount / CHART_SAMPLE_INTERVAL;
  let instRev = revCount / CHART_SAMPLE_INTERVAL;

  fwdRateEMA = RATE_EMA_ALPHA * instFwd + (1 - RATE_EMA_ALPHA) * fwdRateEMA;
  revRateEMA = RATE_EMA_ALPHA * instRev + (1 - RATE_EMA_ALPHA) * revRateEMA;

  let f = Math.round(fwdRateEMA * 10) / 10;
  let r = Math.round(revRateEMA * 10) / 10;
  
  if (rateHistory.length > 0 && rateHistory[rateHistory.length - 1].t === rateTime) {
    rateHistory[rateHistory.length - 1] = { t: rateTime, fwd: f, rev: r };
  } else {
    rateHistory.push({ t: rateTime, fwd: f, rev: r });
    if (rateHistory.length > CHART_MAX_SAMPLES) {
      rateHistory.splice(0, rateHistory.length - CHART_MAX_SAMPLES);
      if (rateSelectedIndex >= 0) rateSelectedIndex = Math.max(0, rateSelectedIndex - 1);
    }
  }

  fwdCount = 0;
  revCount = 0;
}

// Rendering đồ thị tích hợp zoom và selection box
function renderLineChart(ctx, canvasEl, history, yLabel, seriesAKey, seriesBKey, seriesALabel, seriesBLabel, selectedIndex, zoom, activeCanvas) {
  const w = canvasEl.clientWidth || 240;
  const h = canvasEl.clientHeight || 130;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, w, h);

  const padLeft = 30;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 20;
  const plotW = Math.max(1, w - padLeft - padRight);
  const plotH = Math.max(1, h - padTop - padBottom);

  let isRateChart = (yLabel === 'v (p.ứ/s)');

  // Hiển thị thông báo khi chờ phản ứng đầu tiên cho Đồ thị Tốc độ
  if (isRateChart && history.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Đang chờ phản ứng đầu tiên...', padLeft + plotW / 2, padTop + plotH / 2);
    return;
  }
  
  if (!isRateChart && history.length < 2) {
    // Đồ thị nồng độ thì hiển thị bình thường dù có 1 điểm (có thể do đang pause ban đầu)
    // Nhưng để vẽ được line thì cần ít nhất 2 điểm. Nếu chỉ 1 điểm thì vẽ chấm
    if (history.length === 0) return;
  }

  let maxT = history[history.length - 1].t;
  let minT = history[0].t;
  
  if (zoom) {
    minT = zoom.min;
    maxT = zoom.max;
  }
  if (maxT - minT < 1) maxT = minT + 1;

  let maxN = 1;

  if (isRateChart) {
    // Với đồ thị Tốc độ: Lấy Percentile thứ 95 để trục Y không bị kéo giãn quá mức bởi cú bùng nổ phản ứng ban đầu
    let vals = [];
    history.forEach(s => {
      if (s.t >= minT && s.t <= maxT) {
        vals.push(s[seriesAKey], s[seriesBKey]);
      }
    });
    if (vals.length > 0) {
      vals.sort((a, b) => a - b);
      let p95 = vals[Math.floor(vals.length * 0.95)];
      maxN = Math.ceil(p95 * 1.5) || 1; 
    }
    if (maxN < 10) maxN = 10;
  } else {
    // Đồ thị Nồng độ: Lấy max tuyệt đối bình thường
    history.forEach(s => {
      if (s.t >= minT && s.t <= maxT) {
        maxN = Math.max(maxN, s[seriesAKey], s[seriesBKey]);
      }
    });
    maxN = Math.ceil(maxN * 1.15) || 1;
  }

  function xFor(t) { return padLeft + ((t - minT) / (maxT - minT)) * plotW; }
  function yFor(n) { return padTop + plotH - (n / maxN) * plotH; }

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  // Y axis ticks + label
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(maxN), padLeft - 4, padTop + 2);
  ctx.fillText('0', padLeft - 4, padTop + plotH);
  ctx.save();
  ctx.translate(8, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // X axis ticks + label
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(minT.toFixed(0), padLeft, padTop + plotH + 4);
  ctx.textAlign = 'right';
  ctx.fillText(maxT.toFixed(0), padLeft + plotW, padTop + plotH + 4);
  ctx.textAlign = 'center';
  ctx.fillText('t (s)', padLeft + plotW / 2, padTop + plotH + 4);

  // Clipping để Chart line không tràn ra ngoài ranh giới khi Zoom hoặc khi bị cắt mốc (Percentile)
  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotW, plotH);
  ctx.clip();

  // Series A (white)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let firstA = true;
  history.forEach(s => {
    let x = xFor(s.t);
    let y = yFor(s[seriesAKey]);
    if (firstA) { ctx.moveTo(x, y); firstA = false; }
    else ctx.lineTo(x, y);
  });
  if (history.length === 1) {
    ctx.arc(xFor(history[0].t), yFor(history[0][seriesAKey]), 2, 0, Math.PI*2);
  }
  ctx.stroke();

  // Series B (orange)
  ctx.strokeStyle = '#ff8c1a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let firstB = true;
  history.forEach(s => {
    let x = xFor(s.t);
    let y = yFor(s[seriesBKey]);
    if (firstB) { ctx.moveTo(x, y); firstB = false; }
    else ctx.lineTo(x, y);
  });
  if (history.length === 1) {
    ctx.arc(xFor(history[0].t), yFor(history[0][seriesBKey]), 2, 0, Math.PI*2);
  }
  ctx.stroke();

  // Selected sample: dashed vertical marker + scientific readout
  let markerTextData = null;
  if (selectedIndex >= 0 && selectedIndex < history.length) {
    let s = history[selectedIndex];
    if (s.t >= minT && s.t <= maxT) {
      let x = xFor(s.t);

      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
      ctx.restore();

      let yA = yFor(s[seriesAKey]);
      let yB = yFor(s[seriesBKey]);
      
      // Chống vẽ điểm lọt ra ngoài bounding box
      if (yA >= padTop) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, yA, 3, 0, Math.PI * 2); ctx.fill(); }
      if (yB >= padTop) { ctx.fillStyle = '#ff8c1a'; ctx.beginPath(); ctx.arc(x, yB, 3, 0, Math.PI * 2); ctx.fill(); }
      
      markerTextData = { x, s };
    }
  }

  // Khối kéo thả chọn vùng (Drag Selection Box) và hiển thị thời gian
  if (chartDragState.canvas === activeCanvas) {
    ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
    let rx = Math.min(chartDragState.startX, chartDragState.currentX);
    let endX = Math.max(chartDragState.startX, chartDragState.currentX);
    rx = constrain(rx, padLeft, padLeft + plotW);
    endX = constrain(endX, padLeft, padLeft + plotW);
    let dragW = endX - rx;
    
    ctx.fillRect(rx, padTop, dragW, plotH);

    if (dragW > 2) {
      let t1 = minT + ((rx - padLeft) / plotW) * (maxT - minT);
      let t2 = minT + ((endX - padLeft) / plotW) * (maxT - minT);
      
      let dragText = `${t1.toFixed(1)}s ➝ ${t2.toFixed(1)}s`;
      ctx.font = 'bold 10px Arial, sans-serif';
      let txtW = ctx.measureText(dragText).width;
      let cx = rx + dragW / 2;
      
      if (cx - txtW / 2 < padLeft + 2) cx = padLeft + 2 + txtW / 2;
      if (cx + txtW / 2 > padLeft + plotW - 2) cx = padLeft + plotW - 2 - txtW / 2;

      ctx.fillStyle = 'rgba(20, 20, 25, 0.85)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(cx - txtW / 2 - 6, padTop + 4, txtW + 12, 16, 4);
      } else {
        ctx.rect(cx - txtW / 2 - 6, padTop + 4, txtW + 12, 16);
      }
      ctx.fill();

      ctx.fillStyle = '#60a5fa'; 
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dragText, cx, padTop + 12);
    }
  }

  ctx.restore(); 

  // Info box
  if (markerTextData) {
    let { x, s } = markerTextData;
    let lineA = seriesALabel + ': ' + s[seriesAKey];
    let lineB = seriesBLabel + ': ' + s[seriesBKey];
    let lineT = 't = ' + s.t.toFixed(2) + ' s';

    ctx.font = 'bold 10px Arial, sans-serif';
    let textW = Math.max(
      ctx.measureText(lineT).width,
      ctx.measureText(lineA).width,
      ctx.measureText(lineB).width
    );
    let boxW = textW + 14;
    let boxH = 44;
    let boxX = x + 8;
    if (boxX + boxW > w - 2) boxX = x - boxW - 8;
    boxX = constrain(boxX, 2, w - boxW - 2);
    let boxY = padTop + 2;

    ctx.fillStyle = 'rgba(10, 10, 14, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 5);
    else ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.fillText(lineT, boxX + 7, boxY + 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(lineA, boxX + 7, boxY + 17);
    ctx.fillStyle = '#ff8c1a';
    ctx.fillText(lineB, boxX + 7, boxY + 30);
  }
}

function drawConcChart() {
  if (!showConcChart || !concChartCtx) return;
  renderLineChart(concChartCtx, concChartCanvas, concHistory, 'n', 'ab', 'cd', 'A + B', 'C + D', concSelectedIndex, concChartZoom, concChartCanvas);
}

function drawRateChart() {
  if (!showRateChart || !rateChartCtx) return;
  renderLineChart(rateChartCtx, rateChartCanvas, rateHistory, 'v (p.ứ/s)', 'fwd', 'rev', 'Chiều thuận', 'Chiều nghịch', rateSelectedIndex, rateChartZoom, rateChartCanvas);
}

function transformVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8]  * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9]  * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
  ];
}

function projectToScreen(pos) {
  if (!frameMV || !frameP) return null;
  let world = [pos.x, pos.y, pos.z, 1];
  let eyeSpace = transformVec4(frameMV, world);
  let clip = transformVec4(frameP, eyeSpace);

  if (clip[3] === 0) return null;
  let ndcX = clip[0] / clip[3];
  let ndcY = clip[1] / clip[3];
  let ndcZ = clip[2] / clip[3];

  if (ndcZ < -1 || ndcZ > 1) return null; 

  let sx = (ndcX * 0.5 + 0.5) * width;
  let sy = (1 - (ndcY * 0.5 + 0.5)) * height;
  return { x: sx, y: sy };
}

function getCameraPosition() {
  let cam = _renderer._curCamera;
  if (cam && typeof cam.eyeX === 'number') {
    return createVector(cam.eyeX, cam.eyeY, cam.eyeZ);
  }
  return createVector(0, 0, 800); 
}

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

// ---------------- 3D spatial grid ----------------
function buildSpatialGrid(cellSize) {
  let grid = new Map();
  molecules.forEach((m, idx) => {
    let p = m.pos;
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
  });
  return grid;
}

function getNeighborIndices(grid, cellSize, pos) {
  let ix = Math.floor(pos.x / cellSize);
  let iy = Math.floor(pos.y / cellSize);
  let iz = Math.floor(pos.z / cellSize);
  let result = [];
  [-1, 0, 1].forEach(dx => {
    [-1, 0, 1].forEach(dy => {
      [-1, 0, 1].forEach(dz => {
        let key = (ix + dx) + ',' + (iy + dy) + ',' + (iz + dz);
        let bucket = grid.get(key);
        if (bucket) {
          bucket.forEach(k => result.push(k));
        }
      });
    });
  });
  return result;
}

function currentCellSize() {
  let avgRadius = ((BASE_RADIUS.A + BASE_RADIUS.C) / 2) * radiusScale;
  return Math.max(24, avgRadius * 6);
}

// ---------------- 2D screen-space grid ----------------
const SCREEN_CELL_SIZE = 80;

function buildScreenGrid(info) {
  let grid = new Map();
  info.forEach((item, idx) => {
    if (!item) return;
    let ix = Math.floor(item.s.x / SCREEN_CELL_SIZE);
    let iy = Math.floor(item.s.y / SCREEN_CELL_SIZE);
    let key = ix + ',' + iy;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(idx);
  });
  return grid;
}

function getScreenNeighborIndices(grid, screenPos) {
  let ix = Math.floor(screenPos.x / SCREEN_CELL_SIZE);
  let iy = Math.floor(screenPos.y / SCREEN_CELL_SIZE);
  let result = [];
  [-1, 0, 1].forEach(dx => {
    [-1, 0, 1].forEach(dy => {
      let key = (ix + dx) + ',' + (iy + dy);
      let bucket = grid.get(key);
      if (bucket) {
        bucket.forEach(k => result.push(k));
      }
    });
  });
  return result;
}

function drawLabels() {
  labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  
  labelCtx.font = 'bold 14px Arial, sans-serif'; 
  labelCtx.textAlign = 'center';
  labelCtx.textBaseline = 'middle';

  let camPos = frameCamPos;
  let info = new Array(molecules.length).fill(null);
  
  molecules.forEach((m, idx) => {
    let s = projectToScreen(m.pos);
    if (!s) return;
    let camDist = p5.Vector.dist(m.pos, camPos);
    let screenR = accurateScreenRadius(m.pos, m.radius, camPos);
    info[idx] = { m, s, camDist, screenR };
  });

  let screenGrid = buildScreenGrid(info);

  info.forEach((cur, i) => {
    if (!cur) return;
    let occluded = false;

    let neighbors = getScreenNeighborIndices(screenGrid, cur.s);
    neighbors.some(j => {
      if (j === i) return false;
      let other = info[j];
      if (!other) return false;
      if (other.camDist >= cur.camDist - 0.5) return false;
      if (other.screenR <= 0) return false;

      let d = dist(cur.s.x, cur.s.y, other.s.x, other.s.y);
      if (d < other.screenR * 0.85) {
        occluded = true;
        return true; 
      }
      return false;
    });

    if (!occluded) {
      let scale = Math.max(0.4, cur.screenR / 13);
      
      labelCtx.save();
      labelCtx.translate(cur.s.x, cur.s.y);
      labelCtx.scale(scale, scale); 
      
      labelCtx.fillStyle = cur.m.labelColorHex;
      labelCtx.fillText(cur.m.type, 0, 0);
      
      labelCtx.restore();
    }
  });
}

function initSoundPool() {
  Array.from({ length: OSC_POOL_SIZE }).forEach(() => {
    let osc = new p5.Oscillator('sine');
    osc.amp(0);
    osc.start();
    let env = new p5.Envelope();
    env.setADSR(0.001, 0.08, 0.0, 0.05);
    env.setRange(1, 0);
    oscPool.push({ osc, env });
  });
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
    Array.from({ length: diff }).forEach(() => {
      let radius = BASE_RADIUS[type] * radiusScale;
      let margin = HALF - radius;
      let pos = createVector(random(-margin, margin), random(-margin, margin), random(-margin, margin));
      molecules.push(new Molecule(type, pos));
    });
  } else if (diff < 0) {
    Array.from({ length: -diff }).forEach(() => {
      let idx = molecules.findIndex(m => m.type === type);
      if (idx !== -1) molecules.splice(idx, 1);
    });
  }
  updateRadiusScale();
  updateCountsPanel();
  
  if (!isPlaying) {
    recordConcSample();
  }
}

function updateRadiusScale() {
  let total = molecules.length;
  let scale = map(total, 40, 800, 1.0, 0.3, true);
  radiusScale = constrain(scale, 0.3, 1.0);

  molecules.forEach(m => {
    m.radius = BASE_RADIUS[m.type] * radiusScale;
  });
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

  concTime = 0;
  concSampleAccumulator = 0;
  concHistory = [];
  concSelectedIndex = -1;

  rateTime = 0;
  rateSampleAccumulator = 0;
  rateHistory = [];
  fwdCount = 0;
  revCount = 0;
  fwdRateEMA = 0;
  revRateEMA = 0;
  isWaitingForFirstReaction = true;
  rateSelectedIndex = -1;

  concChartZoom = null;
  rateChartZoom = null;
  chartDragState.canvas = null;

  updateCountsPanel();
  recordConcSample();

  if (showConcChart) drawConcChart();
  if (showRateChart) drawRateChart();
}

function updateCountsPanel() {
  let counts = { A: 0, B: 0, C: 0, D: 0 };
  molecules.forEach(m => { counts[m.type]++; });
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

// ---------------- Flash effect ----------------
class Flash {
  constructor(pos, colorArr) {
    this.pos = pos.copy();
    this.color = colorArr;
    this.age = 0;
    this.maxAge = 10;
  }
  update() {
    this.age++;
    return this.age < this.maxAge;
  }
  display() {
    let t = this.age / this.maxAge; 
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
function isABPair(t1, t2) {
  return (t1 === 'A' && t2 === 'B') || (t1 === 'B' && t2 === 'A');
}
function isCDPair(t1, t2) {
  return (t1 === 'C' && t2 === 'D') || (t1 === 'D' && t2 === 'C');
}

function shouldReact(t1, t2) {
  if (isABPair(t1, t2)) return true;
  if (isCDPair(t1, t2)) return reactionMode === 'reversible';
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

  molecules.forEach((m1, i) => {
    if (toRemove.has(i)) return;
    let neighbors = getNeighborIndices(frameGrid, frameCellSize, m1.pos);

    neighbors.some(j => {
      if (j <= i) return false; 
      if (toRemove.has(j)) return false;

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
            flashColor = [255, 45, 45]; 
            freq = 220;
            fwdCount++; // Tăng đếm phản ứng chiều thuận
          } else {
            newType1 = 'A'; newType2 = 'B';
            flashColor = [255, 225, 30]; 
            freq = 330;
            revCount++; // Tăng đếm phản ứng chiều nghịch
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
          return true; 
        } else {
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
      return false;
    });
  });

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

  if (!mouseOverUI) {
    orbitControl(1, 1, 0.15);
  }

  frameMV = _renderer.uMVMatrix.copy().mat4;
  frameP = _renderer.uPMatrix.copy().mat4;
  frameCamPos = getCameraPosition();

  frameCellSize = currentCellSize();
  frameGrid = buildSpatialGrid(frameCellSize);

  ambientLight(140, 140, 140);
  pointLight(180, 180, 180, 150, -220, 260);

  push();
  noFill();
  stroke(120, 190, 255, 160);
  strokeWeight(1.2);
  box(BOX_SIZE);
  pop();

  let speedFactor = map(speedLevel, 0, 10, 0, 4.2);

  if (isPlaying) {
    molecules.forEach(m => m.update(speedFactor));
    handleCollisions();
    frameGrid = buildSpatialGrid(frameCellSize);

    let dt = deltaTime / 1000;
    
    // 1. CẬP NHẬT ĐỒ THỊ NỒNG ĐỘ (Chạy ngay lập tức)
    concTime += dt;
    concSampleAccumulator += dt;
    if (concSampleAccumulator >= CHART_SAMPLE_INTERVAL) {
      concSampleAccumulator -= CHART_SAMPLE_INTERVAL;
      recordConcSample();
    }
    
    // 2. CẬP NHẬT ĐỒ THỊ TỐC ĐỘ (Chờ phản ứng đầu tiên)
    if (isWaitingForFirstReaction) {
      if (fwdCount > 0 || revCount > 0) {
        isWaitingForFirstReaction = false;
        
        // Neo điểm t=0 cho Đồ thị Tốc độ
        rateTime = 0; 
        rateSampleAccumulator = 0;
        
        fwdRateEMA = fwdCount / CHART_SAMPLE_INTERVAL;
        revRateEMA = revCount / CHART_SAMPLE_INTERVAL; // Sẽ bằng 0 nếu A+B va chạm trước
        
        let f = Math.round(fwdRateEMA * 10) / 10;
        let r = Math.round(revRateEMA * 10) / 10;
        rateHistory.push({ t: 0, fwd: f, rev: r }); // Ghi nhận điểm (0, f, 0)
        
        fwdCount = 0;
        revCount = 0;
      }
    } else {
      rateTime += dt;
      rateSampleAccumulator += dt;
      if (rateSampleAccumulator >= CHART_SAMPLE_INTERVAL) {
        rateSampleAccumulator -= CHART_SAMPLE_INTERVAL;
        recordRateSample();
      }
    }
  }

  molecules.forEach(m => m.display());

  flashes = flashes.filter(f => {
    let alive = f.update();
    if (alive) f.display();
    return alive;
  });

  if (showLabels) {
    drawLabels();
  } else {
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  }

  if (showConcChart) drawConcChart();
  if (showRateChart) drawRateChart();
}

function windowResized() {
  resizeCanvas(canvasHolder.offsetWidth, canvasHolder.offsetHeight);
  resizeLabelCanvas();
  resizeChartCanvases();
}