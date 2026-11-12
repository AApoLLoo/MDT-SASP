import { html, mount, $, debounce, fullName, fmtDate, toast } from '../dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

// Champ de recherche avec liste de résultats ; onSelect(item) au clic ou sur Entrée.
// onCreate(q) facultatif : sans résultat, propose « createLabel(q) » (au clic seulement, pour ne rien créer par erreur).
// empty() facultatif : éléments proposés quand le champ est vide (ex. consultés récemment).
// renderItem(item, q) reçoit aussi la recherche, pour surligner ce qui a correspondu.
export function picker(root, { placeholder, search, renderItem, onSelect, onCreate, createLabel, empty }) {
  mount(root, html`<div class="picker"><input type="search" class="input" placeholder="${placeholder}" autocomplete="off"><ul class="dropdown" hidden></ul></div>`);
  const input = $('input', root);
  const list = $('ul', root);
  let items = [];
  let lastQuery = '';

  const choose = item => {
    input.value = '';
    lastQuery = '';
    items = [];
    list.hidden = true;
    onSelect(item);
  };
  const runNow = async () => {
    const q = input.value.trim();
    lastQuery = q;
    items = q ? await search(q).catch(() => []) : empty?.() ?? [];
    if (!q && !items.length) { list.hidden = true; return; }
    mount(list, items.length ? items.map((it, i) => html`<li data-i="${i}">${renderItem(it, q)}</li>`)
      : onCreate ? html`<li data-create>${createLabel(q)}</li>` : html`<li class="muted">Aucun résultat</li>`);
    list.hidden = false;
  };
  const run = debounce(runNow);

  input.addEventListener('input', run);
  if (empty) input.addEventListener('focus', () => { if (!input.value.trim()) runNow(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Entrée tapée avant la fin de la recherche différée : on cherche tout de suite
      if (input.value.trim() !== lastQuery) await runNow();
      if (items.length && input.value.trim()) choose(items[0]);
    } else if (e.key === 'Escape') list.hidden = true;
  });
  list.addEventListener('mousedown', e => {
    if (e.target.closest('li[data-create]')) {
      e.preventDefault();
      const q = input.value.trim();
      input.value = '';
      lastQuery = '';
      list.hidden = true;
      onCreate(q);
      return;
    }
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(items[li.dataset.i]);
  });
  return input;
}

// Personne ou véhicule recherché choisi dans un formulaire : alerte bien visible, cliquable vers la fiche
const warnCitizen = c => {
  if (c.mandats_actifs) toast(`⚠ ${fullName(c)} fait l'objet de ${c.mandats_actifs} mandat(s) / BOLO actif(s)`, 'error', { onClick: () => navigate(`/casiers/${c.id}`), duration: 12000 });
};
export const warnVehicle = v => {
  if (v.statut === 'vole' || v.bolos_actifs) toast(`⚠ Véhicule ${v.plaque} : ${[v.statut === 'vole' && 'déclaré volé', v.bolos_actifs && 'BOLO actif'].filter(Boolean).join(' · ')}`, 'error', { duration: 12000 });
};

export const citizenPicker = (root, onSelect, placeholder = 'Rechercher un citoyen (nom, ID unique, téléphone)…', { onCreate } = {}) => picker(root, {
  onCreate,
  createLabel: q => html`<span class="badge badge-info">Nouvelle fiche</span> Créer la fiche « <strong>${q}</strong> »`,
  placeholder,
  search: q => api(`/citizens?q=${encodeURIComponent(q)}`),
  renderItem: c => html`<strong>${fullName(c)}</strong>
    <span class="muted">${c.id_unique ? `ID ${c.id_unique}` : ''}${c.date_naissance ? ` · né(e) le ${fmtDate(c.date_naissance)}` : ''}</span>
    ${c.mandats_actifs ? html`<span class="badge badge-danger">Mandat actif</span>` : ''}`,
  onSelect: c => { warnCitizen(c); onSelect(c); },
});

export const vehiclePicker = (root, onSelect) => picker(root, {
  placeholder: 'Rechercher une plaque ou un modèle…',
  search: q => api(`/vehicles?q=${encodeURIComponent(q)}`),
  renderItem: v => html`<strong class="mono">${v.plaque}</strong> <span class="muted">${v.modele} ${v.couleur}</span>`,
  onSelect: v => { warnVehicle(v); onSelect(v); },
});
