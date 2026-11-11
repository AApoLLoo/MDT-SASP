// Fond animé posé sur la photo de Los Santos (.backdrop) et sous les panneaux de verre :
// bokeh qui dérive, poussières, parfois un gyrophare dans la ville, parallaxe au pointeur.
// Plafonné à 30 i/s : le flou du verre se recalcule à chaque image. En mode fluide (body.lite), la boucle s'arrête ;
// startAmbient renvoie la fonction qui la relance.
import { debounce } from './dom.js';

const FPS = 30;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

// Halo pré-rendu une fois par couleur, ensuite simplement redimensionné
function sprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${rgb}, 1)`);
  g.addColorStop(0.4, `rgba(${rgb}, 0.35)`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}
const SPRITES = { blue: sprite('47, 107, 255'), sky: sprite('120, 160, 240'), gold: sprite('230, 180, 70'), red: sprite('255, 59, 71') };
const BOKEH_COLORS = ['blue', 'blue', 'sky', 'sky', 'gold', 'red'];

export function startAmbient(canvas, photo) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const par = { x: 0, y: 0, tx: 0, ty: 0 }; // parallaxe du pointeur, de -0.5 à 0.5
  let w, h, bokeh, dust;
  let flash = null, nextFlash = 4000, last = 0;

  function seed() {
    bokeh = Array.from({ length: Math.round((w * h) / 60000) }, () => ({
      x: rand(0, w), y: rand(0, h), r: rand(18, 80), c: pick(BOKEH_COLORS), a: rand(0.05, 0.15),
      vx: rand(-0.12, 0.12), vy: rand(-0.25, -0.05), d: rand(8, 36), f: rand(0.0005, 0.0015), p: rand(0, 6.28),
    }));
    dust = Array.from({ length: Math.round((w * h) / 22000) }, () => ({
      x: rand(0, w), y: rand(0, h), s: rand(0.6, 1.6), vx: rand(-0.1, 0.1), vy: rand(-0.4, -0.1), f: rand(0.001, 0.004), p: rand(0, 6.28),
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    par.x += (par.tx - par.x) * 0.05;
    par.y += (par.ty - par.y) * 0.05;
    // La photo glisse à l'opposé du pointeur : effet de profondeur sous le verre
    photo.style.translate = `${(-par.x * 18).toFixed(1)}px ${(-par.y * 12).toFixed(1)}px`;

    ctx.globalCompositeOperation = 'lighter';
    for (const b of bokeh) {
      if (!still) {
        b.x += b.vx;
        b.y += b.vy;
        if (b.y < -b.r) { b.y = h + b.r; b.x = rand(0, w); }
        if (b.x < -b.r) b.x = w + b.r; else if (b.x > w + b.r) b.x = -b.r;
      }
      ctx.globalAlpha = b.a * (0.75 + 0.25 * Math.sin(t * b.f + b.p));
      ctx.drawImage(SPRITES[b.c], b.x - b.r + par.x * b.d, b.y - b.r + par.y * b.d, b.r * 2, b.r * 2);
    }
    // Gyrophare quelque part dans la ville (moitié basse de la photo), plus fréquent en DEFCON 1–2
    if (!still && t > nextFlash) {
      flash = { x: rand(0.1, 0.9) * w, y: rand(0.5, 0.9) * h, t };
      nextFlash = t + (document.body.dataset.alert ? rand(2500, 5000) : rand(7000, 14000));
    }
    if (flash && t - flash.t < 2600) {
      const phase = Math.floor((t - flash.t) / 140) % 6;
      const fx = flash.x - par.x * 18, fy = flash.y - par.y * 12; // accroché à la photo
      ctx.globalAlpha = 0.8;
      if (phase < 2) ctx.drawImage(SPRITES.red, fx - 40, fy - 28, 56, 56);
      else if (phase === 3 || phase === 4) ctx.drawImage(SPRITES.blue, fx - 16, fy - 28, 56, 56);
    }
    // Poussières
    ctx.fillStyle = 'rgb(200, 215, 255)';
    for (const d of dust) {
      if (!still) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.y < 0) { d.y = h; d.x = rand(0, w); }
      }
      ctx.globalAlpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * d.f + d.p));
      ctx.fillRect(d.x + par.x * 4, d.y + par.y * 4, d.s, d.s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function resize() {
    w = canvas.width = innerWidth;
    h = canvas.height = innerHeight;
    seed();
    if (still) draw(0);
  }

  addEventListener('resize', debounce(resize, 200));
  addEventListener('pointermove', e => { par.tx = e.clientX / w - 0.5; par.ty = e.clientY / h - 0.5; }, { passive: true });
  resize();
  let running = false;
  const loop = t => {
    if (document.body.classList.contains('lite')) { running = false; return; }
    requestAnimationFrame(loop);
    if (t - last < 1000 / FPS) return;
    last = t;
    draw(t);
  };
  const resume = () => {
    if (still || running) return;
    running = true;
    requestAnimationFrame(loop);
  };
  resume();
  return resume;
}
