import { html, mount, $, attempt, openModal, formValues, toast, fmtDate, fmtDateTime, todayIso, debounce, PAGE, moreButton } from '../dom.js';
import { api, hasRole } from '../api.js';
import { icon } from '../icons.js';
import { openWarrantForm } from './warrants.js';
import { mountPhotos, numberedSlots, photoCount } from '../components/photos.js';

// Registre des véhicules volés : déclaration, recherche par plaque, véhicule retrouvé

const statutBadge = v => (v.statut === 'vole'
  ? html`<span class="badge badge-danger">Volé</span>`
  : html`<span class="badge badge-ok">Retrouvé</span>`);

function openVehicleForm(v = {}, onSaved) {
  const dialog = openModal(v.id ? `Véhicule ${v.plaque}` : 'Déclarer un véhicule volé', html`
    <form class="form-grid" data-form>
      <label>Plaque *<input class="input mono upper" name="plaque" required value="${v.plaque}" ${v.id ? '' : 'autofocus'}></label>
      <label>Modèle<input class="input" name="modele" value="${v.modele}" placeholder="Ex. : Sultan RS"></label>
      <label>Couleur<input class="input" name="couleur" value="${v.couleur}"></label>
      <label>Date du vol<input class="input" type="date" name="date_vol" value="${v.date_vol ?? todayIso()}"></label>
      <label class="span-2">Lieu du vol<input class="input" name="lieu_vol" value="${v.lieu_vol}" placeholder="Ex. : Parking de Legion Square"></label>
      <label>Propriétaire<input class="input" name="proprietaire" value="${v.proprietaire}" placeholder="Prénom Nom"></label>
      <label>Contact du propriétaire<input class="input" name="contact" value="${v.contact}" placeholder="(000) 000-0000"></label>
      <label class="span-2">Notes<textarea class="input" name="notes" rows="2" placeholder="Signes distinctifs, circonstances…">${v.notes}</textarea></label>
      <div class="span-2" data-photos></div>
      <div class="span-2 form-actions"><button class="btn btn-primary">${v.id ? 'Enregistrer' : 'Déclarer le vol'}</button></div>
    </form>`);
  const photos = { ...v.photos };
  mountPhotos($('[data-photos]', dialog), photos, () => {}, [{ titre: 'Photos', slots: numberedSlots(), extra: true }]);
  $('[data-form]', dialog).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api(v.id ? `/vehicles/${v.id}` : '/vehicles', { method: v.id ? 'PUT' : 'POST', body: { ...formValues(e.target), photos } });
      toast(v.id ? 'Véhicule mis à jour' : 'Vol déclaré');
      dialog.close();
      onSaved();
    }, e.submitter);
  });
}

function openFoundForm(v, onSaved) {
  const dialog = openModal(`Véhicule retrouvé · ${v.plaque}`, html`
    <form class="form-grid" data-form>
      <label class="span-2">Lieu où il a été retrouvé<input class="input" name="lieu_retrouve" placeholder="Ex. : Fourrière de Davis" autofocus></label>
      ${v.bolos_actifs ? html`<p class="span-2 alert alert-warn">Les BOLO actifs sur ce véhicule seront clos.</p>` : ''}
      <div class="span-2 form-actions"><button class="btn btn-primary">${icon('check')} Marquer comme retrouvé</button></div>
    </form>`);
  $('[data-form]', dialog).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      const { bolos_clos } = await api(`/vehicles/${v.id}/found`, { method: 'POST', body: formValues(e.target) });
      toast(`Véhicule ${v.plaque} retrouvé${bolos_clos ? ` · ${bolos_clos} BOLO clos` : ''}`);
      dialog.close();
      onSaved();
    }, e.submitter);
  });
}

export async function render(main, params, query) {
  const statut = query.get('statut') ?? 'vole';
  mount(main, html`
    <div class="page-head">
      <div><h1>Véhicules volés</h1><p class="muted" data-count></p></div>
      <div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Déclarer un vol</button></div>
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="Vérifier une plaque, un modèle ou un propriétaire…" autofocus></div>
      <div class="segmented">
        ${[['vole', 'Volés'], ['retrouve', 'Retrouvés'], ['tous', 'Tous']].map(([k, l]) => html`<a href="#/vehicules?statut=${k}" class="${k === statut ? 'is-active' : ''}">${l}</a>`)}
      </div>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  let limit = PAGE;
  const load = async () => {
    const q = $('[data-q]', main).value.trim();
    list = await api(`/vehicles?${new URLSearchParams({ q, statut: statut === 'tous' ? '' : statut, limit })}`);
    const voles = list.filter(v => v.statut === 'vole').length;
    $('[data-count]', main).textContent = statut === 'retrouve' ? `${list.length} véhicule(s) retrouvé(s)` : `${voles} véhicule(s) déclaré(s) volé(s)`;
    mount($('[data-results]', main), list.length ? html`<table class="table">
      <thead><tr><th>Plaque</th><th>Véhicule</th><th>Propriétaire</th><th>Vol</th><th>Statut</th><th></th></tr></thead>
      <tbody>${list.map(v => html`<tr class="${v.statut === 'retrouve' ? 'is-muted' : ''}">
        <td class="mono strong plate">${v.plaque}</td>
        <td>${v.modele || '—'}${v.couleur ? html`<small class="muted block">${v.couleur}</small>` : ''}${photoCount(v.photos)}</td>
        <td>${v.proprietaire || '—'}${v.contact ? html`<small class="muted block">${v.contact}</small>` : ''}</td>
        <td><span class="nowrap">${fmtDate(v.date_vol)}</span>${v.lieu_vol ? html`<small class="muted block">${v.lieu_vol}</small>` : ''}
          <small class="muted block">Déclaré par 『${v.declare_matricule ?? '—'}』</small></td>
        <td>${statutBadge(v)} ${v.bolos_actifs ? html`<span class="badge badge-warn">BOLO</span>` : ''}
          ${v.statut === 'retrouve' ? html`<small class="muted block">Le ${fmtDateTime(v.retrouve_le)}${v.lieu_retrouve ? ` · ${v.lieu_retrouve}` : ''} par 『${v.retrouve_matricule ?? '—'}』</small>` : ''}</td>
        <td class="row-actions">
          ${v.statut === 'vole' && html`<button class="btn btn-sm" data-found="${v.id}">${icon('check')} Retrouvé</button>`}
          ${v.statut === 'vole' && !v.bolos_actifs && html`<button class="btn btn-sm btn-ghost" data-bolo="${v.id}" title="Émettre un BOLO">${icon('warrant')}</button>`}
          <button class="btn btn-sm btn-ghost" data-edit="${v.id}" title="Modifier">${icon('edit')}</button>
          ${hasRole('superviseur') && html`<button class="btn btn-sm btn-ghost" data-delete="${v.id}" title="Supprimer">${icon('trash')}</button>`}
        </td></tr>`)}</tbody></table>${moreButton(list.length, limit)}`
      : html`<p class="empty-state">${q
        ? html`Aucun véhicule ${statut === 'vole' ? 'volé ' : ''}ne correspond à « ${q} ».`
        : statut === 'retrouve' ? 'Aucun véhicule retrouvé.' : 'Aucun véhicule déclaré volé.'}</p>`);
  };

  const reload = () => attempt(load);
  $('[data-q]', main).addEventListener('input', debounce(() => { limit = PAGE; reload(); }));
  $('[data-new]', main).addEventListener('click', () => openVehicleForm({ plaque: $('[data-q]', main).value.trim().toUpperCase() }, reload));
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; reload(); }
    const t = e.target.closest('button');
    const v = t && list.find(x => x.id === Number(t.dataset.found || t.dataset.bolo || t.dataset.edit || t.dataset.delete));
    if (!v) return;
    if (t.dataset.found) openFoundForm(v, reload);
    if (t.dataset.bolo) openWarrantForm({ type: 'bolo_vehicule', vehicle_id: v.id, vehicle_plaque: v.plaque, motif: `Véhicule volé ${v.plaque}` }, reload);
    if (t.dataset.edit) openVehicleForm(v, reload);
    if (t.dataset.delete && confirm(`Supprimer définitivement le véhicule ${v.plaque} ?`)) {
      attempt(async () => { await api(`/vehicles/${v.id}`, { method: 'DELETE' }); toast('Véhicule supprimé'); await load(); });
    }
  });
  await load();
}
