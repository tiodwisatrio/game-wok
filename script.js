const TARGET = 32;
const VIDEOS = {
  32: 'assets/video.mp4',
};
const VIDEO_GROW_MS = 4000;
// Angka tanpa gambar atau video tetap tampil sebagai angka
const IMAGES = {
  1: 'assets/image_1.jpg',
  2: 'assets/image_2.jpg',
  4: 'assets/image_4.png',
  8: 'assets/image_8.png',
  16: 'assets/image_16.jpeg',
};

const successSound = new Audio('assets/sound_success.mp3');
// Suara khusus saat angka ini terbentuk pertama kali dalam satu permainan
const FIRST_SOUNDS = {
  8: new Audio('assets/sound_wow.mp3'),
  16: new Audio('assets/sound_jokowi.mp3'),
};

const board = document.getElementById('board');

// Isi tiap kotak: angka, atau null jika kosong
let cells;
let reached;
let drag = null;

function start() {
  cells = Array(9).fill(1);
  reached = new Set();
  render();
}

function isWon() {
  return cells.includes(TARGET);
}

function render(mergedIndex) {
  board.innerHTML = '';
  cells.forEach((value, index) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = index;

    if (value !== null) {
      const tile = document.createElement('div');
      // Animasi transform membuat video fullscreen mengikuti ukuran kotak
      tile.className = index === mergedIndex && !VIDEOS[value] ? 'tile merged' : 'tile';
      tile.dataset.value = value;
      if (VIDEOS[value]) {
        const video = document.createElement('video');
        video.src = VIDEOS[value];
        video.playsInline = true;
        video.setAttribute('aria-label', value);
        video.addEventListener('ended', closeVideo);
        // Tanpa Fullscreen API agar browser tidak memunculkan notifikasi
        requestAnimationFrame(() => growVideo(video));
        // Kalau browser menolak video bersuara, putar tanpa suara
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
        tile.append(video);
      } else if (IMAGES[value]) {
        const img = document.createElement('img');
        img.src = IMAGES[value];
        img.alt = value;
        img.draggable = false;
        tile.append(img);
      } else {
        tile.textContent = value;
      }
      cell.append(tile);
    }
    board.append(cell);
  });
}

// Boleh pindah ke kotak kosong, atau ke kotak berangka sama untuk digabung
function canDrop(from, to) {
  return from !== to && (cells[to] === null || cells[to] === cells[from]);
}

// Tidak ada angka kembar berarti tidak ada yang bisa digabung lagi
function isStuck() {
  const filled = cells.filter((value) => value !== null);
  return new Set(filled).size === filled.length;
}

function stopSounds() {
  [successSound, ...Object.values(FIRST_SOUNDS)].forEach((s) => s.pause());
}

// Video membesar dari posisinya di kotak sampai menutupi layar
function growVideo(video) {
  const { left, top, width, height } = video.getBoundingClientRect();
  video.classList.add('fullscreen');
  video.animate(
    [
      { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, borderRadius: '10px' },
      { left: '0', top: '0', width: '100vw', height: '100vh', borderRadius: '0' },
    ],
    { duration: VIDEO_GROW_MS, easing: 'ease-in' },
  );
}

// Video selesai atau ditutup: permainan langsung mulai lagi
function closeVideo() {
  const video = board.querySelector('video.fullscreen');
  if (!video) return;

  video.pause();
  start();
}

function cellAt(x, y) {
  return document.elementsFromPoint(x, y).find((el) => el.matches('.cell'));
}

function clearTarget() {
  board.querySelector('.target')?.classList.remove('target');
}

function endDrag() {
  clearTarget();
  drag.tile.classList.remove('dragging');
  drag.tile.style.transform = '';
  drag = null;
}

// Dipakai bersama oleh mouse/sentuh (di bawah) dan tangan (hand.js)
function grab(x, y) {
  const tile = cellAt(x, y)?.querySelector('.tile');
  if (!tile || drag || isWon()) return;

  tile.classList.add('dragging');
  drag = {
    tile,
    from: Number(tile.parentElement.dataset.index),
    startX: x,
    startY: y,
  };
}

function moveDrag(x, y) {
  if (!drag) return;

  const dx = x - drag.startX;
  const dy = y - drag.startY;
  drag.tile.style.transform = `translate(${dx}px, ${dy}px)`;

  clearTarget();
  const cell = cellAt(x, y);
  if (cell && canDrop(drag.from, Number(cell.dataset.index))) {
    cell.classList.add('target');
  }
}

function cancelDrag() {
  if (drag) endDrag();
}

function drop(x, y) {
  if (!drag) return;

  const { from } = drag;
  const cell = cellAt(x, y);
  endDrag();
  if (!cell) return;

  const to = Number(cell.dataset.index);
  if (!canDrop(from, to)) return;

  const merging = cells[to] !== null;
  cells[to] = merging ? cells[to] * 2 : cells[from];
  cells[from] = null;

  // Video di kotak terakhir punya suara sendiri
  if (merging && !isWon()) {
    let sound = successSound;
    if (FIRST_SOUNDS[cells[to]] && !reached.has(cells[to])) {
      reached.add(cells[to]);
      sound = FIRST_SOUNDS[cells[to]];
      stopSounds();
    }
    sound.currentTime = 0;
    // Browser bisa menolak memutar suara; permainan tetap jalan tanpa suara
    sound.play().catch(() => {});
  }

  if (isWon()) {
    stopSounds();
  } else if (isStuck()) {
    cells = cells.map((value) => value ?? 1);
  }
  render(merging ? to : undefined);
}

board.addEventListener('pointerdown', (e) => grab(e.clientX, e.clientY));
window.addEventListener('pointermove', (e) => moveDrag(e.clientX, e.clientY));
window.addEventListener('pointerup', (e) => drop(e.clientX, e.clientY));
window.addEventListener('pointercancel', cancelDrag);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeVideo();
});

start();
