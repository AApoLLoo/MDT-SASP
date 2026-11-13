// @ts-check
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

/**
 * @param {string} message
 * @param {string} [type] success, error, info…
 * @param {{ onClick?: () => void, duration?: number }} [options]
 */
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
  const canClose = trackDraft(dialog, `${location.hash}|${title}`);
  // Laisse jouer la transition de fermeture (0,22 s en CSS) avant de retirer la modale
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 250));
  dialog.addEventListener('click', e => {
    const target = /** @type {Element} */ (e.target);
    if ((target.closest('[data-close]') || target === dialog) && canClose()) dialog.close();
  });
  dialog.addEventListener('cancel', e => { if (!canClose()) e.preventDefault(); }); // Échap
  dialog.showModal();
  return dialog;
}

// Brouillon local des formulaires en modale : la saisie survit à une fermeture, une déconnexion ou un rechargement.
// Seuls les champs nommés sont gardés (pas les listes construites en JS : lignes d'amende, photos, personnes choisies).
export const DRAFT_PREFIX = 'mdt-draft:';
const SKIP_TYPES = ['password', 'file', 'hidden', 'submit', 'button'];

function trackDraft(dialog, key) {
  const form = $('form', dialog);
  if (!form) return () => true;
  key = DRAFT_PREFIX + key;
  let dirty = false;
  let submitted = false;
  const fields = () => [...formControls(form)].filter(el => el.name && !SKIP_TYPES.includes(el.type));
  const save = debounce(() => {
    const values = {};
    for (const el of fields()) {
      if (el.type === 'radio') { if (el.checked) values[el.name] = el.value; }
      else values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), values })); } catch { /* stockage plein ou indisponible : pas de brouillon */ }
  }, 400);
  const onEdit = e => {
    if (!e.isTrusted) return; // restauration du brouillon
    dirty = true;
    submitted = false;
    save();
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  // Fermée juste après un envoi (sans retouche depuis) : enregistrée, le brouillon ne sert plus
  form.addEventListener('submit', () => { submitted = true; });
  dialog.addEventListener('close', () => {
    if (!submitted) return;
    try { localStorage.removeItem(key); } catch { /* rien à nettoyer */ }
  });

  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(key)); } catch { /* brouillon illisible : ignoré */ }
  if (draft?.values) {
    const bar = document.createElement('div');
    bar.className = 'alert alert-info draft-bar';
    mount(bar, html`<span class="grow">Saisie non enregistrée du ${new Date(draft.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.</span>
      <button type="button" class="btn btn-sm btn-primary" data-draft-restore>Restaurer</button>
      <button type="button" class="btn btn-sm btn-ghost" data-draft-drop>Ignorer</button>`);
    $('.modal-body', dialog).prepend(bar);
    bar.addEventListener('click', e => {
      const target = /** @type {Element} */ (e.target);
      if (target.closest('[data-draft-restore]')) {
        for (const el of fields()) {
          const v = draft.values[el.name];
          if (v === undefined) continue;
          if (el.type === 'checkbox') el.checked = v;
          else if (el.type === 'radio') el.checked = el.value === v;
          else el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        dirty = true;
      } else if (target.closest('[data-draft-drop]')) {
        try { localStorage.removeItem(key); } catch { /* rien à nettoyer */ }
      } else return;
      bar.remove();
    });
  }
  return () => !dirty || submitted || confirm('Fermer sans enregistrer ? La saisie reste disponible en brouillon à la prochaine ouverture.');
}

export function clearDrafts() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(DRAFT_PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch { /* stockage indisponible */ }
}

// Surligne la première occurrence de q dans text (sans tenir compte des accents ni de la casse)
export function highlight(text, q) {
  const s = String(text ?? '');
  const nq = normalize(q).trim();
  let norm = '';
  const at = []; // index du texte normalisé → index d'origine
  for (let i = 0; i < s.length; i++) {
    const n = normalize(s[i]);
    norm += n;
    for (let k = 0; k < n.length; k++) at.push(i);
  }
  const start = nq ? norm.indexOf(nq) : -1;
  if (start < 0) return html`${s}`;
  const a = at[start];
  const b = at[start + nq.length - 1] + 1;
  return html`${s.slice(0, a)}<mark>${s.slice(a, b)}</mark>${s.slice(b)}`;
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

// Getter d'origine : un champ nommé « elements » (« Hypothèses et pistes » des enquêtes) masque form.elements
export const formControls = form => Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get.call(form);

export function formValues(form) {
  const out = {};
  for (const el of formControls(form)) {
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
