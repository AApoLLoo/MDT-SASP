import { html, mount, $, attempt, openModal, formValues, toast, fullName, fmtDateTime, PAGE, moreButton } from '../dom.js';
import { api, hasRole } from '../api.js';
import { rerender } from '../router.js';
import { icon } from '../icons.js';
import { citizenPicker, vehiclePicker } from '../components/picker.js';
import { mountPhotos, numberedSlots, photoCount } from '../components/photos.js';

export const WARRANT_TYPES = { mandat: "Mandat d'arrêt", bolo_personne: 'BOLO personne', bolo_vehicule: 'BOLO véhicule' };

export const warrantTypeBadge = type => html`<span class="badge ${type === 'mandat' ? 'badge-danger' : 'badge-warn'}">${WARRANT_TYPES[type]}</span>`;

export function warrantTarget(w) {
  if (w.citizen_id) return html`<a href="#/casiers/${w.citizen_id}">${fullName({ nom: w.citizen_nom, prenom: w.citizen_prenom })}</a>`;
  if (w.vehicle_id) return html`<span class="mono">${w.vehicle_plaque}</span> <span class="muted">${w.vehicle_modele}</span>`;
  return html`<span class="muted">${w.description || 'Non identifié'}</span>`;
}

// Formulaire de création / modification ; `w` peut contenir citizen_id + nom pour pré-remplir
export function openWarrantForm(w = {}, onSaved = rerender) {
  const target = {
    citizen: w.citizen_id ? { id: w.citizen_id, label: fullName({ nom: w.citizen_nom, prenom: w.citizen_prenom }) } : null,
    vehicle: w.vehicle_id ? { id: w.vehicle_id, label: w.vehicle_plaque } : null,
  };
  const dialog = openModal(w.id ? 'Modifier le mandat / BOLO' : 'Émettre un mandat / BOLO', html`
    <form class="form-grid" data-form>
      <label class="span-2">Type
        <select class="input" name="type">${Object.entries(WARRANT_TYPES).map(([k, v]) => html`<option value="${k}" ${k === (w.type || 'mandat') ? 'selected' : ''}>${v}</option>`)}</select>
      </label>
      <div class="span-2 field" data-citizen-field><span>Citoyen visé</span><div data-chosen="citizen"></div><div data-picker="citizen"></div></div>
      <div class="span-2 field" data-vehicle-field><span>Véhicule visé</span><div data-chosen="vehicle"></div><div data-picker="vehicle"></div></div>
      <label class="span-2">Motif *<input class="input" name="motif" required value="${w.motif}" placeholder="Ex. : Braquage de la Fleeca de Great Ocean"></label>
      <label class="span-2">Description / signalement<textarea class="input" name="description" rows="3">${w.description}</textarea></label>
      <div class="span-2" data-photos></div>
      <div class="span-2 form-actions"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
  const form = $('[data-form]', dialog);
  const photos = { ...w.photos };
  mountPhotos($('[data-photos]', dialog), photos, () => {}, [{ titre: 'Photos', slots: numberedSlots(), extra: true }]);

  const renderChosen = kind => {
    const t = target[kind];
    mount($(`[data-chosen="${kind}"]`, dialog), t
      ? html`<span class="chosen">${t.label} <button type="button" class="btn-icon" data-unset="${kind}">✕</button></span>`
      : html`<span class="muted small">Aucun — utilisez la recherche ci-dessous</span>`);
  };
  const syncType = () => {
    const type = form.type.value;
    $('[data-citizen-field]', dialog).hidden = type === 'bolo_vehicule';
    $('[data-vehicle-field]', dialog).hidden = type !== 'bolo_vehicule';
  };
  citizenPicker($('[data-picker="citizen"]', dialog), c => { target.citizen = { id: c.id, label: fullName(c) }; renderChosen('citizen'); });
  vehiclePicker($('[data-picker="vehicle"]', dialog), v => { target.vehicle = { id: v.id, label: v.plaque }; renderChosen('vehicle'); });
  renderChosen('citizen');
  renderChosen('vehicle');
  syncType();
  form.type.addEventListener('change', syncType);
  dialog.addEventListener('click', e => {
    const k = e.target.closest('[data-unset]')?.dataset.unset;
    if (k) { target[k] = null; renderChosen(k); }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = formValues(form);
    const body = {
      ...v,
      photos,
      citizen_id: v.type === 'bolo_vehicule' ? null : target.citizen?.id ?? null,
      vehicle_id: v.type === 'bolo_vehicule' ? target.vehicle?.id ?? null : null,
    };
    attempt(async () => {
      await api(w.id ? `/warrants/${w.id}` : '/warrants', { method: w.id ? 'PUT' : 'POST', body });
      toast(w.id ? 'Mandat mis à jour' : 'Mandat émis');
      dialog.close();
      onSaved();
    }, e.submitter);
  });
}

export async function closeWarrant(id, onDone = rerender) {
  if (!confirm('Clore ce mandat / BOLO ?')) return;
  await attempt(async () => {
    await api(`/warrants/${id}/close`, { method: 'POST' });
    toast('Mandat clos');
    onDone();
  });
}

export async function render(main, params, query) {
  const statut = query.get('statut') ?? 'actif';
  mount(main, html`
    <div class="page-head">
      <h1>Mandats & BOLO</h1>
      <div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Émettre</button></div>
    </div>
    <div class="toolbar">
      <div class="segmented">
        ${[['actif', 'Actifs'], ['clos', 'Clos'], ['tous', 'Tous']].map(([k, l]) => html`<a href="#/mandats?statut=${k}" class="${k === statut ? 'is-active' : ''}">${l}</a>`)}
      </div>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  let limit = PAGE;
  const load = async () => {
    list = await api(`/warrants?statut=${statut === 'tous' ? '' : statut}&limit=${limit}`);
    mount($('[data-results]', main), list.length ? html`<table class="table">
        <thead><tr><th>Type</th><th>Cible</th><th>Motif</th><th>Émis par</th><th>Date</th><th>Statut</th><th></th></tr></thead>
        <tbody>${list.map(w => html`<tr>
          <td>${warrantTypeBadge(w.type)}</td>
          <td>${warrantTarget(w)}</td>
          <td>${w.motif}${w.description ? html`<small class="muted block">${w.description}</small>` : ''}${photoCount(w.photos)}</td>
          <td class="mono">『${w.auteur_matricule ?? '—'}』</td>
          <td class="nowrap">${fmtDateTime(w.created_at)}</td>
          <td>${w.statut === 'actif' ? html`<span class="badge badge-danger">Actif</span>` : html`<span class="badge">Clos</span><small class="muted block">${fmtDateTime(w.closed_at)}</small>`}</td>
          <td class="row-actions">
            ${w.statut === 'actif' && html`<button class="btn btn-sm" data-close-w="${w.id}">${icon('check')} Clore</button>`}
            <button class="btn btn-sm btn-ghost" data-edit="${w.id}" title="Modifier">${icon('edit')}</button>
            ${hasRole('superviseur') && html`<button class="btn btn-sm btn-ghost" data-delete="${w.id}" title="Supprimer">${icon('trash')}</button>`}
          </td></tr>`)}</tbody>
      </table>${moreButton(list.length, limit)}` : html`<p class="empty-state">Aucun mandat ${statut === 'actif' ? 'actif' : ''}.</p>`);
  };

  const reload = () => attempt(load);
  $('[data-new]', main).addEventListener('click', () => openWarrantForm({}, reload));
  main.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-more]')) { limit += PAGE; reload(); }
    if (t.dataset.closeW) closeWarrant(t.dataset.closeW, reload);
    if (t.dataset.edit) openWarrantForm(list.find(w => w.id === Number(t.dataset.edit)), reload);
    if (t.dataset.delete && confirm('Supprimer définitivement ce mandat ?')) {
      attempt(async () => { await api(`/warrants/${t.dataset.delete}`, { method: 'DELETE' }); toast('Mandat supprimé'); await load(); });
    }
  });
  await load();
}
