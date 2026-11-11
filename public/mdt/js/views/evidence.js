import { html, mount, $, attempt, openModal, formValues, toast, fmtDateTime, debounce, PAGE, moreButton } from '../dom.js';
import { api, hasRole } from '../api.js';
import { icon } from '../icons.js';
import { mountPhotos } from '../components/photos.js';

// Scellés : objets saisis conservés comme preuves. Chaque mouvement (statut, emplacement)
// est tracé avec son motif : c'est la chaîne de possession affichée sur la fiche.

export const EVIDENCE_STATUTS = {
  stockee: ['En stock', 'badge-ok'], sortie: ['Sortie temporaire', 'badge-warn'], transmise: ['Transmise à la justice', 'badge-info'],
  restituee: ['Restituée', ''], detruite: ['Détruite', ''],
};
export const evidenceBadge = s => html`<span class="badge ${EVIDENCE_STATUTS[s][1]}">${EVIDENCE_STATUTS[s][0]}</span>`;

const CATEGORIES = ['Arme', 'Munitions', 'Stupéfiants', 'Argent', 'Objet', 'Document', 'Numérique', 'Autre'];
const PHOTO = [{ titre: '', slots: [['photo', 'Photo du scellé']] }];

const originLink = e => (e.report_id ? html`<a href="#/rapports/${e.report_id}" class="mono">${e.report_numero}</a>`
  : e.incident_id ? html`<a href="#/incidents/${e.incident_id}" class="mono">${e.incident_numero}</a>` : html`<span class="muted">—</span>`);

// Création (e sans id, éventuellement { origine }) ou fiche d'un scellé existant
export async function openEvidenceForm(e = {}, onSaved) {
  if (e.id) e = await api(`/evidence/${e.id}`);
  const photos = e.photo_url ? { photo: e.photo_url } : {};
  const dialog = openModal(e.id ? `Scellé ${e.numero}` : 'Mettre une preuve sous scellé', html`
    <form class="form-grid" data-form>
      <label class="span-2">Description *<input class="input" name="description" required value="${e.description}" placeholder="Ex. : Pistolet Glock 17, sachet de cannabis…" ${e.id ? '' : 'autofocus'}></label>
      <label>Catégorie<input class="input" name="categorie" list="evidence-categories" value="${e.categorie ?? 'Objet'}"></label>
      <datalist id="evidence-categories">${CATEGORIES.map(c => html`<option value="${c}">`)}</datalist>
      <label>Quantité<input class="input" name="quantite" value="${e.quantite}"></label>
      <label>Rapport d'origine<input class="input mono upper" name="origine" value="${e.report_numero ?? e.incident_numero ?? e.origine}" placeholder="SASP-… ou INC-…"></label>
      <label>Emplacement<input class="input" name="emplacement" value="${e.emplacement ?? 'Salle des scellés'}" placeholder="Salle des scellés, casier n°…"></label>
      ${e.id ? html`
        <label>Statut<select class="input" name="statut">${Object.entries(EVIDENCE_STATUTS).map(([k, [l]]) => html`<option value="${k}" ${k === e.statut ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label>Motif du mouvement<input class="input" name="motif" placeholder="Obligatoire si le statut ou l'emplacement change"></label>` : ''}
      <label class="span-2">Notes<textarea class="input" name="notes" rows="2">${e.notes}</textarea></label>
      <div class="span-2" data-photo></div>
      <div class="span-2 form-actions">
        ${e.id && hasRole('superviseur') ? html`<button type="button" class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>` : ''}
        <button class="btn btn-primary">${e.id ? 'Enregistrer' : 'Créer le scellé'}</button>
      </div>
    </form>
    ${e.id ? html`<h3 class="mt">Chaîne de possession</h3>
      <ul class="list">${e.history.map(h => html`<li><span class="grow"><strong>${h.action}</strong>${h.details ? html`<small class="muted">${h.details}</small>` : ''}</span>
        <small class="muted nowrap">${fmtDateTime(h.created_at)} · 『${h.matricule ?? '—'}』</small></li>`)}</ul>` : ''}`, { wide: true });

  mountPhotos($('[data-photo]', dialog), photos, () => {}, PHOTO);
  $('[data-form]', dialog).addEventListener('submit', ev => {
    ev.preventDefault();
    attempt(async () => {
      const saved = await api(e.id ? `/evidence/${e.id}` : '/evidence', { method: e.id ? 'PUT' : 'POST', body: { ...formValues(ev.target), photo_url: photos.photo ?? '' } });
      toast(e.id ? 'Scellé mis à jour' : `Scellé ${saved.numero} créé`);
      dialog.close();
      onSaved();
    }, ev.submitter);
  });
  $('[data-delete]', dialog)?.addEventListener('click', ev => {
    if (!confirm(`Supprimer définitivement le scellé ${e.numero} ?`)) return;
    attempt(async () => {
      await api(`/evidence/${e.id}`, { method: 'DELETE' });
      toast('Scellé supprimé');
      dialog.close();
      onSaved();
    }, ev.target);
  });
}

export async function render(main, params, query) {
  const statut = query.get('statut') ?? (query.get('q') ? 'tous' : 'en_stock');
  mount(main, html`
    <div class="page-head">
      <div><h1>Preuves et scellés</h1><p class="muted">Les objets saisis d'un rapport d'arrestation sont mis sous scellé à sa finalisation.</p></div>
      <div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Nouveau scellé</button></div>
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q value="${query.get('q') ?? ''}" placeholder="N° de scellé, description, emplacement ou n° de rapport…" autofocus></div>
      <div class="segmented">
        ${[['en_stock', 'En stock'], ['transmise', 'Transmises'], ['restituee', 'Restituées'], ['detruite', 'Détruites'], ['tous', 'Toutes']].map(([k, l]) => html`<a href="#/preuves?statut=${k}" class="${k === statut ? 'is-active' : ''}">${l}</a>`)}
      </div>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  let limit = PAGE;
  const load = async () => {
    list = await api(`/evidence?${new URLSearchParams({ q: $('[data-q]', main).value, statut: statut === 'tous' ? '' : statut, limit })}`);
    mount($('[data-results]', main), list.length ? html`<table class="table table-click">
      <thead><tr><th>N° de scellé</th><th>Objet</th><th>Origine</th><th>Emplacement</th><th>Statut</th><th>Saisi le</th></tr></thead>
      <tbody>${list.map(e => html`<tr data-id="${e.id}">
        <td class="mono strong">${e.numero}</td>
        <td>${e.description}${e.quantite ? ` ×${e.quantite}` : ''}<small class="muted block">${e.categorie}</small></td>
        <td>${originLink(e)}</td>
        <td>${e.emplacement || '—'}</td>
        <td>${evidenceBadge(e.statut)}</td>
        <td class="nowrap">${fmtDateTime(e.created_at)}<small class="muted block">『${e.auteur_matricule ?? '—'}』</small></td></tr>`)}</tbody></table>
      ${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucun scellé.</p>`);
  };

  const reload = () => attempt(load);
  $('[data-q]', main).addEventListener('input', debounce(() => { limit = PAGE; reload(); }));
  $('[data-new]', main).addEventListener('click', () => openEvidenceForm({}, reload));
  main.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    if (e.target.closest('[data-more]')) { limit += PAGE; reload(); return; }
    const id = Number(e.target.closest('tr[data-id]')?.dataset.id);
    if (id) attempt(() => openEvidenceForm({ id }, reload));
  });
  await load();
}
