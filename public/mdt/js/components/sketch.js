import { html, mount, $, $$, attempt, toast } from '../dom.js';
import { api, uploadImage } from '../api.js';

// Croquis tactique : un fond (carte, plan du bâtiment) et des objets vectoriels, dessinés en SVG.
// Modèle { fond: url, objets: [{ id, t, c, w, p, s, u }] } ; p : coordonnées [x, y, x, y…] dans le repère W × H.
//   trait : tracé libre · fleche, zone : deux points · texte, unite : un point (s : texte ou étiquette, u : type d'unité)
// units : [[clé, code, libellé, couleur]] (définis avec le champ, ex. plans d'assaut du S.W.A.T.)
export const W = 1600;
export const H = 1000;
const COLORS = ['#e5484d', '#f5a524', '#ffd60a', '#3dd68c', '#3b9eff', '#ffffff', '#111111'];
const WIDTHS = [['Fin', 3], ['Moyen', 6], ['Épais', 12]];
const TOOLS = [['main', '✋ Déplacer'], ['trait', '✏ Crayon'], ['fleche', '➜ Flèche'], ['zone', '▭ Zone'], ['texte', 'T Texte'], ['gomme', '⌫ Gomme']];

const points = p => p.map((n, k) => (k % 2 ? `,${n} ` : n)).join('');
const newId = () => Math.random().toString(36).slice(2, 12).padEnd(6, '0');
const copy = o => structuredClone(o);

function objetSvg(o, i, units) {
  const p = o.p;
  if (o.t === 'trait') return html`<polyline data-i="${i}" points="${points(p)}" fill="none" stroke="${o.c}" stroke-width="${o.w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (o.t === 'fleche') {
    const [x1, y1, x2, y2] = p;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const l = 14 + o.w * 2.5;
    const head = [[x2, y2], [x2 - l * Math.cos(a - 0.45), y2 - l * Math.sin(a - 0.45)], [x2 - l * Math.cos(a + 0.45), y2 - l * Math.sin(a + 0.45)]];
    return html`<g data-i="${i}" stroke="${o.c}" fill="${o.c}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${o.w}" stroke-linecap="round"/><polygon points="${head.map(q => q.map(Math.round).join(',')).join(' ')}"/></g>`;
  }
  if (o.t === 'zone') {
    const [x1, y1, x2, y2] = p;
    return html`<rect data-i="${i}" x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${o.c}" fill-opacity="0.18" stroke="${o.c}" stroke-width="${o.w}" stroke-dasharray="14 8"/>`;
  }
  if (o.t === 'texte') return html`<text data-i="${i}" class="sk-text" x="${p[0]}" y="${p[1]}" fill="${o.c}" font-size="${16 + o.w * 2}">${o.s}</text>`;
  // Étiquette longue (nom, plaque, matricule…) : le code dans le pion, l'étiquette dessous
  const [, code, label, color] = units.find(u => u[0] === o.u) ?? [o.u, '?', o.u, '#888888'];
  const long = o.s.length > 4;
  return html`<g data-i="${i}" class="sk-unit" transform="translate(${p[0]} ${p[1]})"><title>${label}</title>
    <circle r="24" fill="${color}"/><text dy="0.35em" font-size="${long || o.s.length < 4 ? 16 : 11}">${long ? code : o.s}</text>
    ${long ? html`<text class="sk-label" y="46">${o.s}</text>` : ''}</g>`;
}

const objetsSvg = (model, units) => html`${model.objets.map((o, i) => objetSvg(o, i, units))}`;

export const sketchSvg = (model, units) => html`<svg class="sketch-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><pattern id="sk-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="rgba(140,170,235,0.12)" stroke-width="2"/></pattern></defs>
  <rect width="${W}" height="${H}" fill="#0b1730"/><rect width="${W}" height="${H}" fill="url(#sk-grid)"/>
  ${model.fond ? html`<image href="${model.fond}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <g data-objets>${objetsSvg(model, units)}</g></svg>`;

// Éditeur plein écran, partagé en temps réel avec tous ceux qui ont ouvert le même croquis.
// url : canal du croquis sur le serveur (GET : flux SSE, POST : opérations). onClose(croquis) à la fermeture.
//
// Synchronisation : chaque modification locale est appliquée tout de suite, puis envoyée (POST, une requête à la fois,
// donc dans l'ordre). Le serveur renvoie toutes les opérations à tous, expéditeur compris, sur un seul flux ordonné.
// Tant qu'une de nos opérations sur un objet n'est pas revenue (`pending`), les opérations reçues sur cet objet sont
// ignorées : le serveur les a placées avant la nôtre, qui les remplace. Tout le monde converge vers l'état du serveur.
export function openSketchEditor({ url, units, onClose }) {
  const client = newId();
  const model = { fond: '', objets: [] };
  const pending = new Map(); // id d'objet ou 'fond' → n de notre dernière opération pas encore revenue
  const queue = [];
  const history = []; // pour « Annuler » : opérations inverses de nos propres actions
  let n = 0;
  let sending = false;
  let tool = 'trait';
  let color = COLORS[0];
  let width = WIDTHS[1][1];
  let unit = null;
  let drag = null;
  let source = null;

  const dialog = document.createElement('dialog');
  dialog.className = 'sketch-dialog';
  dialog.innerHTML = String(html`
    <div class="sketch-bar">
      <div class="sketch-group">${TOOLS.map(([k, l]) => html`<button type="button" class="btn btn-sm" data-tool="${k}">${l}</button>`)}</div>
      <div class="sketch-group">${COLORS.map(c => html`<button type="button" class="sk-color" data-color="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`)}</div>
      <div class="sketch-group">${WIDTHS.map(([l, w]) => html`<button type="button" class="btn btn-sm" data-width="${w}">${l}</button>`)}</div>
      <div class="sketch-group">
        <button type="button" class="btn btn-sm" data-undo>↶ Annuler</button>
        <button type="button" class="btn btn-sm" data-clear>Tout effacer</button>
      </div>
      <div class="sketch-group">
        <label class="btn btn-sm">Fond : importer<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-fond-file></label>
        <button type="button" class="btn btn-sm" data-fond-link>Lien</button>
        <button type="button" class="btn btn-sm btn-ghost" data-fond-rm>Retirer le fond</button>
      </div>
      <div class="sketch-group sketch-end">
        <span class="sketch-live" data-live>Connexion…</span>
        <button type="button" class="btn btn-sm btn-primary" data-close>Fermer</button>
      </div>
    </div>
    <div class="sketch-units">${units.map(([k, code, label, c]) => html`<button type="button" class="sk-unit-btn" data-unit="${k}"><i style="background:${c}">${code}</i>${label}</button>`)}</div>
    <div class="sketch-board" data-board tabindex="-1" autofocus></div>
    <p class="sketch-help">Croquis partagé : chaque modification est enregistrée et visible en direct par les autres agents. Collez une capture (Ctrl+V) pour le fond. Choisissez une unité puis cliquez sur le plan pour la placer. Avec ✋ Déplacer : glissez un élément pour le bouger, double-cliquez sur une unité ou un texte pour le renommer.</p>`);
  document.body.append(dialog);
  const board = $('[data-board]', dialog);
  const live = $('[data-live]', dialog);

  const drawAll = () => mount(board, sketchSvg(model, units));
  const draw = () => mount($('[data-objets]', board), objetsSvg(model, units));
  const syncBar = () => {
    for (const b of $$('[data-tool]', dialog)) b.classList.toggle('is-active', tool === b.dataset.tool);
    for (const b of $$('[data-color]', dialog)) b.classList.toggle('is-active', color === b.dataset.color);
    for (const b of $$('[data-width]', dialog)) b.classList.toggle('is-active', width === Number(b.dataset.width));
    for (const b of $$('[data-unit]', dialog)) b.classList.toggle('is-active', tool === 'unite' && unit === b.dataset.unit);
  };

  // ---------- Opérations : set (ajout ou remplacement d'un objet), del, clear, fond ----------

  const keyOf = op => (op.k === 'set' ? op.o.id : op.k === 'del' ? op.id : op.k === 'fond' ? 'fond' : null);
  function apply(op) {
    if (op.k === 'set') {
      const i = model.objets.findIndex(o => o.id === op.o.id);
      if (i >= 0) model.objets[i] = op.o;
      else model.objets.push(op.o);
    } else if (op.k === 'del') model.objets = model.objets.filter(o => o.id !== op.id);
    // Un objet que nous modifions encore a été touché après l'effacement : il reste
    else if (op.k === 'clear') model.objets = model.objets.filter(o => pending.has(o.id));
    else model.fond = op.url;
  }
  async function send() {
    if (sending || !queue.length) return;
    sending = true;
    try {
      await api(url, { method: 'POST', body: { client, ops: queue.splice(0, 100) } });
    } catch (err) {
      toast(err.message, 'error');
      if (dialog.isConnected) connect(); // repart de l'état du serveur
    } finally {
      sending = false;
    }
    send();
  }
  // Modification locale ; pendant un glisser, seule la dernière position de l'objet attend dans la file
  function local(op) {
    op.n = ++n;
    if (op.k === 'clear') model.objets = [];
    else apply(op);
    const key = keyOf(op);
    if (key) pending.set(key, op.n);
    const last = queue.at(-1);
    if (op.k === 'set' && last?.k === 'set' && last.o.id === op.o.id) queue[queue.length - 1] = op;
    else queue.push(op);
    send();
  }
  const act = (ops, inverse) => {
    history.push(inverse);
    if (history.length > 50) history.shift();
    for (const op of ops) local(op);
  };

  function receive({ client: from, ops }) {
    let fond = false;
    for (const op of ops) {
      const key = keyOf(op);
      if (key && pending.has(key)) {
        if (from === client && pending.get(key) === op.n) pending.delete(key);
        continue;
      }
      apply(op);
      fond ||= op.k === 'fond';
    }
    if (fond) drawAll();
    else draw();
  }

  function connect() {
    source?.close();
    source = new EventSource(`api${url}`);
    source.addEventListener('state', e => {
      Object.assign(model, JSON.parse(e.data));
      pending.clear();
      queue.length = 0;
      drag = null;
      drawAll();
    });
    source.addEventListener('ops', e => receive(JSON.parse(e.data)));
    source.addEventListener('presence', e => {
      live.classList.remove('is-offline');
      live.textContent = `● En direct · ${JSON.parse(e.data).map(m => `『${m}』`).join(' ')}`;
    });
    // EventSource se reconnecte seul après une coupure (l'état complet est renvoyé), pas après un refus (session expirée)
    source.onerror = () => {
      live.classList.add('is-offline');
      live.textContent = source.readyState === EventSource.CLOSED ? 'Connexion refusée : rouvrez le croquis' : 'Connexion perdue, reconnexion…';
    };
  }

  // ---------- Dessin ----------

  // Point du pointeur dans le repère du croquis
  const at = e => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform($('svg', board).getScreenCTM().inverse());
    return [Math.round(pt.x), Math.round(pt.y)];
  };
  const setFond = url => act([{ k: 'fond', url }], [{ k: 'fond', url: model.fond }]);
  const uploadFond = file => attempt(async () => {
    setFond(await uploadImage(file));
    drawAll();
  });

  board.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const [x, y] = at(e);
    const hit = model.objets[e.target.closest('[data-i]')?.dataset.i];
    if (tool === 'gomme') {
      if (hit) { act([{ k: 'del', id: hit.id }], [{ k: 'set', o: copy(hit) }]); draw(); }
      return;
    }
    if (tool === 'unite') {
      const [, code] = units.find(u => u[0] === unit);
      const o = { id: newId(), t: 'unite', u: unit, p: [x, y], s: `${code}${model.objets.filter(u => u.u === unit).length + 1}` };
      act([{ k: 'set', o }], [{ k: 'del', id: o.id }]);
      return draw();
    }
    if (tool === 'texte') {
      const s = prompt('Texte à placer')?.trim();
      if (s) {
        const o = { id: newId(), t: 'texte', c: color, w: width, p: [x, y], s: s.slice(0, 120) };
        act([{ k: 'set', o }], [{ k: 'del', id: o.id }]);
        draw();
      }
      return;
    }
    if (tool === 'main') {
      if (!hit) return;
      drag = { o: hit, last: [x, y], before: copy(hit) };
    } else {
      // Deux points dès le départ : un simple clic au crayon laisse un point
      const o = { id: newId(), t: tool, c: color, w: width, p: [x, y, x, y] };
      act([{ k: 'set', o }], [{ k: 'del', id: o.id }]);
      drag = { o, trace: true };
      draw();
    }
    board.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove', e => {
    if (!drag) return;
    const [x, y] = at(e);
    const p = drag.o.p;
    if (!drag.trace) {
      // Annulable seulement s'il a vraiment bougé : un simple clic n'écrase pas la modification d'un autre
      if (drag.before) history.push([{ k: 'set', o: drag.before }]);
      drag.before = null;
      const [dx, dy] = [x - drag.last[0], y - drag.last[1]];
      drag.o.p = p.map((v, k) => v + (k % 2 ? dy : dx));
      drag.last = [x, y];
    } else if (drag.o.t !== 'trait') {
      p[2] = x;
      p[3] = y;
    } else if (Math.hypot(x - p.at(-2), y - p.at(-1)) >= 4 && p.length < 2000) {
      p.push(x, y);
    } else return;
    local({ k: 'set', o: drag.o });
    draw();
  });
  const end = () => {
    // Un clic sans glisser ne laisse ni flèche ni zone vide
    const o = drag?.trace && drag.o.t !== 'trait' && drag.o;
    if (o && o.p[0] === o.p[2] && o.p[1] === o.p[3]) {
      history.pop();
      local({ k: 'del', id: o.id });
      draw();
    }
    drag = null;
  };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);
  board.addEventListener('dblclick', e => {
    const o = tool === 'main' && model.objets[e.target.closest('[data-i]')?.dataset.i];
    if (!o || !['texte', 'unite'].includes(o.t)) return;
    const s = prompt(o.t === 'unite' ? "Étiquette de l'unité (ex. D1, matricule)" : 'Texte', o.s)?.trim();
    if (s) { act([{ k: 'set', o: { ...o, s: s.slice(0, 120) } }], [{ k: 'set', o: copy(o) }]); draw(); }
  });

  dialog.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) tool = b.dataset.tool;
    if (b.dataset.color) color = b.dataset.color;
    if (b.dataset.width) width = Number(b.dataset.width);
    if (b.dataset.unit) { tool = 'unite'; unit = b.dataset.unit; }
    if (b.matches('[data-undo]') && history.length) {
      for (const op of history.pop()) local(op);
      drawAll();
    }
    if (b.matches('[data-clear]') && model.objets.length && confirm('Effacer tous les dessins et unités, pour tout le monde ? Le fond est conservé.')) {
      act([{ k: 'clear' }], model.objets.map(o => ({ k: 'set', o: copy(o) })));
      draw();
    }
    if (b.matches('[data-fond-link]')) {
      const link = prompt("Lien de l'image (https://…)")?.trim();
      if (link && /^https?:\/\/\S+$/.test(link)) { setFond(link); drawAll(); }
      else if (link) alert('Lien invalide : il doit commencer par https://');
    }
    if (b.matches('[data-fond-rm]') && model.fond) { setFond(''); drawAll(); }
    if (b.matches('[data-close]')) dialog.close();
    syncBar();
  });
  $('[data-fond-file]', dialog).addEventListener('change', e => {
    if (e.target.files[0]) uploadFond(e.target.files[0]);
    e.target.value = '';
  });
  dialog.addEventListener('paste', e => {
    const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); uploadFond(file); }
  });
  // Rien à enregistrer à la fermeture (Fermer ou Échap) : tout part au fil de l'eau
  dialog.addEventListener('close', () => {
    source.close();
    onClose?.(model);
    dialog.remove();
  });

  drawAll();
  syncBar();
  connect();
  dialog.showModal();
}
