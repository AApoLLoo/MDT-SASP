import { html, mount, $, normalize } from '../dom.js';
import { state, loadWeapons } from '../api.js';
import { icon } from '../icons.js';
import { formatDollars } from '../calc.js';
import { DEFCON, MIRANDA_INTRO, MIRANDA_NOTE, mirandaScript, CODES_10, CODES, INDICATIFS, ALPHABET } from '../reference-data.js';

const TABS = [['codes', 'Codes radio'], ['armes', 'Catégories d\'armes'], ['defcon', 'Defcon'], ['miranda', 'Droits Miranda']];

const CODE_GROUPS = [['Codes 10', CODES_10], ["Codes d'intervention", CODES], ['Indicatifs des patrouilles', INDICATIFS]];

function drawCodes(root) {
  const q = normalize($('[data-cq]', root).value);
  const groups = CODE_GROUPS
    .map(([titre, rows]) => [titre, rows.filter(([code, sens]) => !q || normalize(`${code} ${sens}`).includes(q))])
    .filter(([, rows]) => rows.length);
  mount($('[data-codes]', root), groups.length ? groups.map(([titre, rows]) => html`
    <div class="card table-wrap">
      <h3>${titre}</h3>
      <table class="table"><tbody>${rows.map(([code, sens]) => html`<tr><td class="mono strong nowrap">${code}</td><td>${sens}</td></tr>`)}</tbody></table>
    </div>`) : html`<p class="empty-state">Aucun code trouvé.</p>`);
}

const codesTab = () => html`
  <div class="toolbar"><div class="search-box grow">${icon('search')}<input type="search" class="input" data-cq placeholder="Rechercher un code ou une signification (ex. : 10-58, poursuite)…" autofocus></div></div>
  <div class="detail-grid">
    <div data-codes></div>
    <section class="card"><h3>Alphabet phonétique</h3>
      <table class="table"><tbody>${ALPHABET.map(a => html`<tr><td class="mono strong">${a[0]}</td><td>${a}</td></tr>`)}</tbody></table>
    </section>
  </div>`;

const DEFCON_ROWS = [
  ['signification', 'Signification'], ['duree', 'Durée'], ['prolongement', 'Prolongement'], ['autorisation', 'Autorisation'],
  ['droits', 'Droits FDO'], ['equipement', 'Équipement police'], ['amendes', 'Amendes'],
];

function weaponsTab() {
  return html`
    <p class="muted small">Amendes de détention et d'utilisation par arme. « Destination » : objet du quotidien utilisé comme arme.</p>
    <div class="toolbar"><div class="search-box grow">${icon('search')}<input type="search" class="input" data-wq placeholder="Rechercher une arme…"></div></div>
    <div data-weapons></div>`;
}

function drawWeapons(root) {
  const q = normalize($('[data-wq]', root).value);
  const list = state.weapons.filter(w => !q || normalize(`${w.nom} ${w.type} ${w.categorie}`).includes(q));
  const groups = [...new Set(list.map(w => w.groupe))];
  mount($('[data-weapons]', root), groups.length ? groups.map(g => html`
    <div class="card table-wrap">
      <h3>${g}</h3>
      <table class="table">
        <thead><tr><th>Catégorie</th><th>Type</th><th>Nom</th><th class="num">Amende si détention</th><th class="num">Amende si utilisation</th></tr></thead>
        <tbody>${list.filter(w => w.groupe === g).map(w => html`<tr>
          <td><span class="badge badge-weapon">${w.categorie}</span></td><td class="small muted">${w.type}</td><td class="strong">${w.nom}</td>
          <td class="num">${w.amende_detention ? formatDollars(w.amende_detention) : '—'}</td><td class="num">${formatDollars(w.amende_utilisation)}</td></tr>`)}</tbody>
      </table>
    </div>`) : html`<p class="empty-state">Aucune arme trouvée.</p>`);
}

const defconTab = () => html`
  <div class="card table-wrap">
    <table class="table defcon-table">
      <thead><tr><th></th>${DEFCON.map(d => html`<th class="defcon-col defcon-${d.niveau} ${d.niveau === state.defcon ? 'is-current' : ''}">Defcon ${d.niveau}${d.niveau === state.defcon ? html`<small>niveau actuel</small>` : ''}</th>`)}</tr></thead>
      <tbody>${DEFCON_ROWS.map(([k, label]) => html`<tr><th>${label}</th>${DEFCON.map(d => html`<td class="${d.niveau === state.defcon ? 'is-current' : ''}">${d[k]}</td>`)}</tr>`)}</tbody>
    </table>
  </div>`;

const mirandaTab = () => html`
  <div class="detail-grid">
    <section class="card">
      <h3>Procédure</h3>
      ${MIRANDA_INTRO.map(p => html`<p>${p}</p>`)}
      <p class="alert alert-warn"><small>${MIRANDA_NOTE}</small></p>
    </section>
    <section class="card">
      <h3>Script à lire au suspect</h3>
      <div class="miranda-script">${mirandaScript({ nom: '[NOM Prénom]', date: '[date]', heure: '[heure]', charges: ['[chefs d\'accusation]'] }).map(p => html`<p>${p}</p>`)}</div>
      <p class="muted small">Dans un rapport d'arrestation, ce script est complété automatiquement avec le nom du suspect et les chefs retenus.</p>
    </section>
  </div>`;

export async function render(main, params, query) {
  const tab = TABS.some(([k]) => k === query.get('onglet')) ? query.get('onglet') : 'codes';
  if (tab === 'armes') await loadWeapons();
  mount(main, html`
    <div class="page-head"><h1>Références</h1></div>
    <div class="toolbar"><div class="segmented">${TABS.map(([k, l]) => html`<a href="#/references?onglet=${k}" class="${k === tab ? 'is-active' : ''}">${l}</a>`)}</div></div>
    ${{ codes: codesTab, armes: weaponsTab, defcon: defconTab, miranda: mirandaTab }[tab]()}`);
  if (tab === 'codes') {
    $('[data-cq]', main).addEventListener('input', () => drawCodes(main));
    drawCodes(main);
  }
  if (tab === 'armes') {
    $('[data-wq]', main).addEventListener('input', () => drawWeapons(main));
    drawWeapons(main);
  }
}
