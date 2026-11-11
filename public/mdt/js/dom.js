// Petits utilitaires DOM. `html` échappe toutes les valeurs interpolées,
// sauf les fragments déjà produits par `html` (ou `raw`) et les tableaux de fragments.

class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

const val = v => (v instanceof Html ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));

export function html(strings, ...values) {
  return new Html(strings.reduce((out, s, i) => out + s + (i < values.length ? val(values[i]) : ''), ''));
}

export const raw = s => new Html(s);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = val(content);
  return el;
}

export function toast(message, type = 'success', { onClick, duration } = {}) {
  const ms = duration ?? (type === 'error' ? 6000 : 3500);
  const el = document.createElement('div');
  el.className = `toast toast-${type}${onClick ? ' is-clickable' : ''}`;
  el.style.setProperty('--d', `${ms}ms`);
  el.textContent = message;
  // Sortie animée (0,28 s en CSS) avant retrait
  const dismiss = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 300); };
  if (onClick) el.addEventListener('click', () => { dismiss(); onClick(); });
  $('#toasts').append(el);
  setTimeout(dismiss, ms);
}

// Exécute une action asynchrone en affichant l'erreur éventuelle
export async function attempt(fn, button) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export function openModal(title, body, { wide = false } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `modal${wide ? ' modal-wide' : ''}`;
  dialog.innerHTML = String(html`<div class="modal-head"><h2>${title}</h2><button type="button" class="btn-icon" data-close aria-label="Fermer">✕</button></div><div class="modal-body">${body}</div>`);
  document.body.append(dialog);
  // Laisse jouer la transition de fermeture (0,22 s en CSS) avant de retirer la modale
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 250));
  dialog.addEventListener('click', e => {
    if (e.target.closest('[data-close]') || e.target === dialog) dialog.close();
  });
  dialog.showModal();
  return dialog;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Compteurs des tuiles statistiques : de 0 à la valeur (entiers seulement, ex. pas les montants « $ »)
export function countUp(root) {
  if (reducedMotion()) return;
  for (const el of root.querySelectorAll('.stat strong')) {
    const target = Number(el.textContent);
    if (!/^\d+$/.test(el.textContent.trim()) || target < 2) continue;
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / 600);
      el.textContent = Math.round(target * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value.trim();
  }
  return out;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Listes longues : le serveur renvoie `limit` lignes, « Afficher plus » en demande PAGE de plus
export const PAGE = 100;
export const moreButton = (count, limit) => (count >= limit
  ? html`<div class="more-row"><button type="button" class="btn" data-more>Afficher plus</button></div>` : '');

const pad = n => String(n).padStart(2, '0');
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nowTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

// Les dates SQLite (datetime('now')) sont en UTC
export function fmtDateTime(sqlUtc) {
  if (!sqlUtc) return '—';
  return new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export const normalize = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const fullName = p => [p?.prenom, p?.nom].filter(Boolean).join(' ') || '—';
export const agentLabel = u => (u ? `${u.grade ? u.grade + ' ' : ''}${fullName(u)} 『${u.matricule}』` : '—');

export const CATEGORIE_CLASS = { 'Contravention': 'contravention', 'Délit mineur': 'mineur', 'Délit majeur': 'majeur', 'Crime': 'crime' };
export const categorieBadge = c => html`<span class="badge cat-${CATEGORIE_CLASS[c] || 'contravention'}">${c}</span>`;
