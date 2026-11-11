import { html, mount, $, $$, attempt, openModal, formValues, toast, normalize, categorieBadge } from '../dom.js';
import { api, state, loadPenalCode, hasRole } from '../api.js';
import { icon } from '../icons.js';
import { formatDollars, formatDuree } from '../calc.js';

const CATEGORIES = ['Contravention', 'Délit mineur', 'Délit majeur', 'Crime'];

function openCodeForm(c = {}, onSaved) {
  const classifications = [...new Set(state.penalCode.flatMap(x => x.classification.split(', ')).filter(Boolean))].sort();
  const dialog = openModal(c.id ? 'Modifier une infraction' : 'Nouvelle infraction', html`
    <form class="form-grid" data-form>
      <label class="span-2">Infraction *<input class="input" name="infraction" required value="${c.infraction}"></label>
      <label>Catégorie<select class="input" name="categorie">${CATEGORIES.map(k => html`<option ${k === c.categorie ? 'selected' : ''}>${k}</option>`)}</select></label>
      <label>Classification<input class="input" name="classification" list="classif-list" value="${c.classification}"></label>
      <datalist id="classif-list">${classifications.map(k => html`<option value="${k}">`)}</datalist>
      <label>Amende ($)<input class="input" type="number" min="0" step="1" name="amende" value="${c.amende ?? 0}"></label>
      <label>Peine (minutes de GAV)<input class="input" type="number" min="0" step="1" name="peine_minutes" value="${c.peine_minutes ?? 0}"></label>
      <label class="span-2">Suppléments / sanctions<input class="input" name="supplements" value="${c.supplements}" placeholder="Ex. : Saisie armes + retrait PPA"></label>
      <label class="check span-2"><input type="checkbox" name="actif" ${c.actif === 0 ? '' : 'checked'}> Infraction active (proposée dans la calculatrice)</label>
      <div class="span-2 form-actions"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
  $('[data-form]', dialog).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api(c.id ? `/penal-code/${c.id}` : '/penal-code', { method: c.id ? 'PUT' : 'POST', body: formValues(e.target) });
      toast('Code pénal mis à jour');
      dialog.close();
      await loadPenalCode(true);
      onSaved();
    }, e.submitter);
  });
}

export async function render(main) {
  await loadPenalCode(true);
  const admin = hasRole('admin');
  const classifications = [...new Set(state.penalCode.flatMap(c => c.classification.split(', ')).filter(Boolean))].sort();
  mount(main, html`
    <div class="page-head">
      <div><h1>Code pénal</h1><p class="muted">FDO Spirit State · ${state.penalCode.filter(c => c.actif).length} infractions</p></div>
      ${admin && html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Nouvelle infraction</button></div>`}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="Rechercher une infraction…" autofocus></div>
      <select class="input" data-cat><option value="">Toutes catégories</option>${CATEGORIES.map(c => html`<option>${c}</option>`)}</select>
      <select class="input" data-classif><option value="">Toutes classifications</option>${classifications.map(c => html`<option>${c}</option>`)}</select>
    </div>
    <div class="card table-wrap" data-results></div>`);

  const draw = () => {
    const words = normalize($('[data-q]', main).value).split(/\s+/).filter(Boolean);
    const cat = $('[data-cat]', main).value;
    const classif = $('[data-classif]', main).value;
    const list = state.penalCode.filter(c => (admin || c.actif)
      && (!cat || c.categorie === cat)
      && (!classif || c.classification.split(', ').includes(classif))
      && words.every(w => normalize(`${c.infraction} ${c.supplements}`).includes(w)));
    mount($('[data-results]', main), list.length ? html`<table class="table">
      <thead><tr><th>Catégorie</th><th>Infraction</th><th>Classification</th><th class="num">Amende</th><th class="num">Peine</th><th>Suppléments</th>${admin ? html`<th></th>` : ''}</tr></thead>
      <tbody>${list.map(c => html`<tr class="${c.actif ? '' : 'is-muted'}">
        <td>${categorieBadge(c.categorie)}</td><td class="strong">${c.infraction}${c.actif ? '' : html` <span class="badge">Inactive</span>`}</td>
        <td class="small muted">${c.classification}</td>
        <td class="num">${formatDollars(c.amende)}</td><td class="num">${formatDuree(c.peine_minutes)}</td>
        <td class="small">${c.supplements}</td>
        ${admin ? html`<td><button class="btn btn-sm btn-ghost" data-edit="${c.id}" title="Modifier">${icon('edit')}</button></td>` : ''}</tr>`)}</tbody></table>`
      : html`<p class="empty-state">Aucune infraction ne correspond.</p>`);
  };

  for (const el of $$('[data-q], [data-cat], [data-classif]', main)) el.addEventListener('input', draw);
  $('[data-new]', main)?.addEventListener('click', () => openCodeForm({}, draw));
  main.addEventListener('click', e => {
    const id = Number(e.target.closest('[data-edit]')?.dataset.edit);
    if (id) openCodeForm(state.penalCode.find(c => c.id === id), draw);
  });
  draw();
}
