import { html, mount, $, attempt, toast, formValues, fullName, fmtDate, fmtDateTime } from '../dom.js';
import { api, state, isAvocat } from '../api.js';
import { mountPhotos } from '../components/photos.js';
import { formatDollars } from '../calc.js';
import { statutBadge } from './reports.js';

const suspect = r => (r.suspect_nom ? fullName({ nom: r.suspect_nom, prenom: r.suspect_prenom }) : html`<span class="muted">Non renseigné</span>`);

// Accueil des comptes justice : rapports à juger (magistrat) ou dossiers où l'avocat est inscrit
export async function render(main) {
  if (isAvocat()) return renderAvocat(main);
  const list = await api('/reports?statut=en_attente&limit=200');
  mount(main, html`
    <div class="page-head">
      <div><h1>En attente de jugement</h1>
        <p class="muted">${list.length ? `${list.length} rapport(s) déposé(s) par la police, du plus ancien au plus récent` : 'Aucun rapport à juger'}</p></div>
    </div>
    ${list.length ? html`<div class="card table-wrap"><table class="table table-click">
      <thead><tr><th>N°</th><th>Suspect</th><th>Date des faits</th><th>Rédacteur</th><th class="num">Chefs</th><th class="num">Amende proposée</th><th>Déposé le</th></tr></thead>
      <tbody>${list.map(r => html`<tr data-href="#/rapports/${r.id}">
        <td class="mono strong">${r.numero}</td><td>${suspect(r)}</td><td>${fmtDate(r.date_faits)}</td>
        <td class="mono">『${r.redacteur_matricule}』</td><td class="num">${r.nb_chefs ?? 0}</td>
        <td class="num">${formatDollars(r.amende ?? 0)}</td><td class="muted nowrap">${fmtDateTime(r.depose_at)}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="empty-state">Les rapports déposés par la police apparaîtront ici.</p>`}`);
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}

// Profil d'un compte justice : photo, contact, présentation, mot de passe (la fonction se change par un administrateur)
export async function renderProfile(main) {
  const u = await api(`/users/${state.user.id}`);
  const photos = { photo_url: u.photo_url };
  mount(main, html`
    <div class="page-head"><div><h1>Mon profil</h1><p class="muted">${u.grade || ''} ${fullName(u)} · identifiant ${u.matricule}</p></div></div>
    <section class="card">
      <form class="form-grid" data-profile>
        <div class="span-2" data-photo></div>
        <label>Téléphone (en jeu)<input class="input" name="telephone" value="${u.telephone}" placeholder="(000) 000-0000"></label>
        <label>Discord<input class="input" name="discord" value="${u.discord}" placeholder="pseudo"></label>
        <label class="span-2">Présentation<textarea class="input" name="bio" rows="4">${u.bio}</textarea></label>
        <div class="span-2 form-actions"><button class="btn btn-primary">Enregistrer</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Mot de passe</h3></div>
      <form class="form-grid" data-password>
        <label>Mot de passe actuel<input class="input" type="password" name="current" required autocomplete="current-password"></label>
        <label>Nouveau mot de passe (8 caractères min.)<input class="input" type="password" name="next" required minlength="8" autocomplete="new-password"></label>
        <div class="span-2 form-actions"><button class="btn">Changer le mot de passe</button></div>
      </form>
    </section>`);
  mountPhotos($('[data-photo]', main), photos, () => {}, [{ titre: '', slots: [['photo_url', 'Photo de profil']] }]);
  $('[data-profile]', main).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      const saved = await api(`/users/${u.id}`, { method: 'PUT', body: { ...formValues(e.target), photo_url: photos.photo_url ?? '' } });
      state.user.photo_url = saved.photo_url;
      window.dispatchEvent(new Event('profile-change'));
      toast('Profil enregistré');
    }, e.submitter);
  });
  $('[data-password]', main).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api('/auth/password', { method: 'POST', body: formValues(e.target) });
      e.target.reset();
      toast('Mot de passe changé');
    }, e.submitter);
  });
}

async function renderAvocat(main) {
  const { reports, complaints } = await api('/justice/mes-dossiers');
  mount(main, html`
    <div class="page-head"><div><h1>Mes dossiers</h1><p class="muted">Dossiers où votre compte est inscrit comme avocat</p></div></div>
    <section class="card">
      <div class="card-head"><h3>Rapports d'arrestation</h3></div>
      ${reports.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Client</th><th>Date des faits</th><th>Statut</th></tr></thead>
        <tbody>${reports.map(r => html`<tr data-href="#/rapports/${r.id}">
          <td class="mono strong">${r.numero}</td><td>${suspect(r)}</td><td>${fmtDate(r.date_faits)}</td><td>${statutBadge(r.statut)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty-state">Aucun rapport d'arrestation.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h3>Plaintes</h3></div>
      ${complaints.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Déposée le</th></tr></thead>
        <tbody>${complaints.map(c => html`<tr data-href="#/plaintes/${c.id}"><td class="mono strong">${c.numero}</td><td>${fmtDate(c.date_depot)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty-state">Aucune plainte.</p>`}
    </section>`);
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}
