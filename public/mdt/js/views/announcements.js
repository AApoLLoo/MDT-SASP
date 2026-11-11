import { html, mount, $, attempt, openModal, formValues, toast, agentLabel, fmtDateTime, PAGE, moreButton } from '../dom.js';
import { api, state, loadUsers } from '../api.js';
import { icon } from '../icons.js';
import { avatar } from '../components/avatar.js';
import { mountPhotos } from '../components/photos.js';

export const ANNONCE_CATEGORIES = {
  generale: ['Annonce', 'badge-gold'],
  operationnelle: ['Opérationnelle', 'badge-danger'],
  academy: ['Academy', 'badge-info'],
  division: ['Division', 'badge-ok'],
};
const IMPORTANCES = { normale: 'Normale', importante: 'Importante', urgente: 'Urgente' };
const TABS = [['toutes', 'Toutes'], ['generale', 'Annonces'], ['operationnelle', 'Opérationnelles'], ['academy', 'Academy'], ['division', 'Division']];

export const categorieBadge = c => html`<span class="badge ${ANNONCE_CATEGORIES[c][1]}">${ANNONCE_CATEGORIES[c][0]}</span>`;
const auteurOf = a => ({ matricule: a.auteur_matricule, nom: a.auteur_nom, prenom: a.auteur_prenom, grade: a.auteur_grade, photo_url: a.auteur_photo });

function openForm(canPost, current, defaults, onSaved) {
  const allowed = Object.keys(ANNONCE_CATEGORIES).filter(c => canPost[c] || c === current?.categorie);
  const a = current ?? { categorie: allowed.includes(defaults.categorie) ? defaults.categorie : allowed[0], importance: 'normale', division: defaults.division ?? '' };
  const photos = { image_url: a.image_url ?? '' };
  const dialog = openModal(current ? "Modifier l'annonce" : 'Nouvelle annonce', html`
    <form class="form-grid" data-form>
      <label>Catégorie<select class="input" name="categorie">${allowed.map(c => html`<option value="${c}" ${c === a.categorie ? 'selected' : ''}>${ANNONCE_CATEGORIES[c][0]}</option>`)}</select></label>
      <label data-division>Division concernée *<input class="input" name="division" list="annonce-divisions" value="${a.division}"></label>
      <datalist id="annonce-divisions">${state.settings.divisions.map(d => html`<option value="${d}">`)}</datalist>
      <label class="span-2">Titre *<input class="input" name="titre" required value="${a.titre}"></label>
      <label class="span-2">Message<textarea class="input" name="contenu" rows="8" placeholder="Consignes, informations, dates…">${a.contenu}</textarea></label>
      <label>Importance<select class="input" name="importance">${Object.entries(IMPORTANCES).map(([k, l]) => html`<option value="${k}" ${k === a.importance ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="check"><input type="checkbox" name="epingle" ${a.epingle ? 'checked' : ''}> Épingler en haut du fil</label>
      <div class="span-2 field"><span>Image (facultative)</span><div data-image></div></div>
      <div class="span-2 form-actions"><button class="btn btn-primary">${current ? 'Enregistrer' : 'Publier'}</button></div>
    </form>`, { wide: true });
  const form = $('[data-form]', dialog);
  const syncDivision = () => {
    const isDivision = form.categorie.value === 'division';
    $('[data-division]', dialog).hidden = !isDivision;
    form.division.required = isDivision;
  };
  form.categorie.addEventListener('change', syncDivision);
  syncDivision();
  mountPhotos($('[data-image]', dialog), photos, () => {}, [{ titre: '', slots: [['image_url', 'Image']] }]);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const body = { ...formValues(form), image_url: photos.image_url ?? '' };
    attempt(async () => {
      await api(current ? `/announcements/${current.id}` : '/announcements', { method: current ? 'PUT' : 'POST', body });
      toast(current ? 'Annonce mise à jour' : 'Annonce publiée');
      dialog.close();
      onSaved();
    }, e.submitter);
  });
}

export async function render(main, params, query) {
  const tab = TABS.some(([k]) => k === query.get('onglet')) ? query.get('onglet') : 'toutes';
  const [users, { can_post: canPost }] = await Promise.all([loadUsers(), api('/announcements/unread')]);
  const mesDivisions = users.find(u => u.id === state.user.id)?.divisions ?? [];
  const peutPublier = Object.values(canPost).some(Boolean);

  mount(main, html`
    <div class="page-head">
      <div><h1>Annonces</h1><p class="muted">Informations du commandement, consignes opérationnelles, Academy et divisions.</p></div>
      ${peutPublier ? html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Nouvelle annonce</button></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="segmented">${TABS.map(([k, l]) => html`<a href="#/annonces?onglet=${k}" class="${k === tab ? 'is-active' : ''}">${l}</a>`)}</div>
      ${tab === 'division' && mesDivisions.length ? html`<label class="check"><input type="checkbox" data-mine> ${mesDivisions.length > 1 ? 'Mes divisions' : 'Ma division'} (${mesDivisions.join(', ')})</label>` : ''}
    </div>
    <div class="feed" data-feed></div>`);

  let list = [];
  let limit = PAGE;
  const load = async () => {
    const mine = $('[data-mine]', main)?.checked;
    const qs = new URLSearchParams({ categorie: tab === 'toutes' ? '' : tab, limit });
    if (mine) for (const d of mesDivisions) qs.append('division', d);
    list = await api(`/announcements?${qs}`);
    mount($('[data-feed]', main), list.length ? html`${list.map(a => html`
      <article class="annonce annonce-${a.importance} ${a.epingle ? 'is-pinned' : ''} ${a.lu ? '' : 'is-unread'}">
        <header class="annonce-head">
          <div class="tags">
            ${a.epingle ? html`<span class="badge badge-gold">📌 Épinglée</span>` : ''}
            ${categorieBadge(a.categorie)}
            ${a.division ? html`<span class="badge">${a.division}</span>` : ''}
            ${a.importance !== 'normale' ? html`<span class="badge ${a.importance === 'urgente' ? 'badge-danger' : 'badge-warn'}">${IMPORTANCES[a.importance]}</span>` : ''}
          </div>
          ${a.can_edit ? html`<span class="row-actions">
            <button class="btn btn-sm btn-ghost" data-pin="${a.id}" title="${a.epingle ? 'Désépingler' : 'Épingler'}">📌</button>
            <button class="btn btn-sm btn-ghost" data-edit="${a.id}" title="Modifier">${icon('edit')}</button>
            <button class="btn btn-sm btn-ghost" data-delete="${a.id}" title="Supprimer">${icon('trash')}</button>
          </span>` : ''}
        </header>
        <h2>${a.lu ? '' : html`<span class="ping" title="Non lue">Nouveau</span>`}${a.titre}</h2>
        ${a.contenu ? html`<p class="pre-wrap">${a.contenu}</p>` : ''}
        ${a.image_url ? html`<a href="${a.image_url}" target="_blank" rel="noopener"><img class="annonce-image" src="${a.image_url}" alt=""></a>` : ''}
        <footer class="annonce-foot">
          ${avatar(auteurOf(a), 'sm')}<span>${agentLabel(auteurOf(a))}</span>
          <small class="muted">· ${fmtDateTime(a.created_at)}${a.updated_at !== a.created_at ? ` (modifiée le ${fmtDateTime(a.updated_at)})` : ''}</small>
        </footer>
      </article>`)}${moreButton(list.length, limit)}` : html`<p class="empty-state card">Aucune annonce pour le moment.</p>`);
    // Les annonces affichées sont lues : le marqueur « Nouveau » reste visible jusqu'au prochain affichage
    const ids = list.filter(a => !a.lu).map(a => a.id);
    if (ids.length) {
      await api('/announcements/seen', { method: 'POST', body: { ids } }).catch(() => {});
      window.dispatchEvent(new Event('annonces-seen'));
    }
  };

  const reload = () => attempt(load);
  $('[data-new]', main)?.addEventListener('click', () => openForm(canPost, null, { categorie: tab, division: mesDivisions[0] ?? '' }, reload));
  $('[data-mine]', main)?.addEventListener('change', () => { limit = PAGE; reload(); });
  main.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (t?.matches('[data-more]')) { limit += PAGE; reload(); }
    const a = t && list.find(x => x.id === Number(t.dataset.edit || t.dataset.delete || t.dataset.pin));
    if (!a) return;
    if (t.dataset.edit) openForm(canPost, a, {}, reload);
    if (t.dataset.pin) attempt(async () => { await api(`/announcements/${a.id}`, { method: 'PUT', body: { epingle: !a.epingle } }); await load(); });
    if (t.dataset.delete && confirm(`Supprimer l'annonce « ${a.titre} » ?`)) {
      attempt(async () => { await api(`/announcements/${a.id}`, { method: 'DELETE' }); toast('Annonce supprimée'); await load(); });
    }
  });

  await load();
}
