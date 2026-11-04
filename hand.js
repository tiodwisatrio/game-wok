const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Jarak jempol-telunjuk dibanding ukuran telapak; dua batas agar cubitan tidak berkedip
const PINCH_ON = 0.3;
const PINCH_OFF = 0.45;
const HAND_LOST_MS = 300;

// Filter One Euro: makin kecil MIN_CUTOFF makin stabil saat diam,
// makin besar BETA makin responsif saat bergerak cepat
const MIN_CUTOFF = 1;
const BETA = 0.01;
const DERIVATIVE_CUTOFF = 1;

// Nomor titik pada model tangan MediaPipe
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_BASE = 9;

const cameraEl = document.getElementById('camera');
const cursorEl = document.getElementById('hand-cursor');
const overlayEl = document.getElementById('hand-overlay');
const overlay = overlayEl.getContext('2d');

let landmarker;
let connections = [];
let filters = null;
let holding = false;
let lastSeen = 0;
let lastFrameTime = -1;

function smoothingAlpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function oneEuroFilter() {
  let value = null;
  let speed = 0;
  let lastTime = 0;

  return (next, time) => {
    if (value === null) {
      value = next;
      lastTime = time;
      return value;
    }
    const dt = Math.max((time - lastTime) / 1000, 0.001);
    lastTime = time;

    speed += ((next - value) / dt - speed) * smoothingAlpha(DERIVATIVE_CUTOFF, dt);
    const cutoff = MIN_CUTOFF + BETA * Math.abs(speed);
    value += (next - value) * smoothingAlpha(cutoff, dt);
    return value;
  };
}

// Titik kamera (0-1) ke posisi layar, mengikuti object-fit: cover dan efek cermin
function toScreen({ x, y }) {
  const scale = Math.max(innerWidth / cameraEl.videoWidth, innerHeight / cameraEl.videoHeight);
  const width = cameraEl.videoWidth * scale;
  const height = cameraEl.videoHeight * scale;
  return {
    x: innerWidth - ((innerWidth - width) / 2 + x * width),
    y: (innerHeight - height) / 2 + y * height,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clearSkeleton() {
  overlay.clearRect(0, 0, overlayEl.width, overlayEl.height);
}

function drawSkeleton(points) {
  const dpr = devicePixelRatio;
  if (overlayEl.width !== innerWidth * dpr || overlayEl.height !== innerHeight * dpr) {
    overlayEl.width = innerWidth * dpr;
    overlayEl.height = innerHeight * dpr;
  }
  overlay.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearSkeleton();

  overlay.lineWidth = 4;
  overlay.lineCap = 'round';
  overlay.strokeStyle = holding ? '#2ee6a6' : '#fff';
  overlay.beginPath();
  connections.forEach(({ start, end }) => {
    overlay.moveTo(points[start].x, points[start].y);
    overlay.lineTo(points[end].x, points[end].y);
  });
  overlay.stroke();

  overlay.fillStyle = '#ff3d71';
  points.forEach(({ x, y }) => {
    overlay.beginPath();
    overlay.arc(x, y, 5, 0, Math.PI * 2);
    overlay.fill();
  });
}

function onHand(landmarks, now) {
  if (isWon()) {
    holding = false;
    filters = null;
    cursorEl.hidden = true;
    clearSkeleton();
    return;
  }

  filters ??= landmarks.map(() => ({ x: oneEuroFilter(), y: oneEuroFilter() }));
  const raw = landmarks.map(toScreen);
  const points = raw.map(({ x, y }, i) => ({ x: filters[i].x(x, now), y: filters[i].y(y, now) }));

  // Cubitan memakai titik mentah agar tidak terlambat terdeteksi
  const pinch = distance(raw[THUMB_TIP], raw[INDEX_TIP]) / distance(raw[WRIST], raw[MIDDLE_BASE]);
  const cursor = {
    x: (points[THUMB_TIP].x + points[INDEX_TIP].x) / 2,
    y: (points[THUMB_TIP].y + points[INDEX_TIP].y) / 2,
  };

  if (!holding && pinch < PINCH_ON) {
    holding = true;
    grab(cursor.x, cursor.y);
  } else if (holding && pinch > PINCH_OFF) {
    holding = false;
    drop(cursor.x, cursor.y);
  } else if (holding) {
    moveDrag(cursor.x, cursor.y);
  }

  drawSkeleton(points);
  cursorEl.hidden = false;
  cursorEl.classList.toggle('pinching', holding);
  cursorEl.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
}

// Tangan hilang dari kamera: kotak yang dipegang kembali ke tempatnya
function onNoHand(now) {
  if (now - lastSeen < HAND_LOST_MS) return;

  if (holding) cancelDrag();
  holding = false;
  filters = null;
  cursorEl.hidden = true;
  clearSkeleton();
}

function trackHand() {
  requestAnimationFrame(trackHand);

  // Deteksi hanya saat kamera punya frame baru
  if (!cameraEl.videoWidth || cameraEl.currentTime === lastFrameTime) return;
  lastFrameTime = cameraEl.currentTime;

  const now = performance.now();
  const { landmarks } = landmarker.detectForVideo(cameraEl, now);
  if (landmarks.length) {
    lastSeen = now;
    onHand(landmarks[0], now);
  } else {
    onNoHand(now);
  }
}

async function startHandTracking() {
  cameraEl.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
  });
  await cameraEl.play();

  const { FilesetResolver, HandLandmarker } = await import(`${VISION_URL}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
  connections = HandLandmarker.HAND_CONNECTIONS;
  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
  });
  trackHand();
}

// Tanpa kamera atau internet, permainan tetap bisa dimainkan dengan mouse
startHandTracking().catch((error) => console.warn('Kontrol tangan tidak aktif:', error));
