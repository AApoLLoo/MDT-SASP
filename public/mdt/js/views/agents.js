import { html, mount, $, $$, attempt, formValues, toast, openModal, fullName, agentLabel, fmtDate, fmtDateTime, normalize, nowTime } from '../dom.js';
import { api, state, loadUsers, hasRole } from '../api.js';
import { navigate, setLeaveGuard } from '../router.js';
import { icon } from '../icons.js';
import { formatDollars } from '../calc.js';
import { avatar } from '../components/avatar.js';
import { mountPhotos } from '../components/photos.js';
import { dossierCard } from './service.js';
import { divisionConflict, SPECIAL_DIVISIONS } from '../service-kinds.js';

// Divisions à grades internes (S.W.A.T., BCI) : liste réglable `grades`, portée par la colonne `gradeField` de l'agent
const GRADED = Object.values(SPECIAL_DIVISIONS).filter(d => d.gradeField);

export const ROLES = { agent: 'Agent', superviseur: 'Superviseur', etat_major: 'État-major', admin: 'Administrateur' };
const ROLE_BADGES = { superviseur: 'badge-info', etat_major: 'badge-warn', admin: 'badge-gold' };
export const roleBadge = role => html`<span class="badge ${ROLE_BADGES[role] ?? ''}">${ROLES[role]}</span>`;

// Grade absent de la liste réglée par l'administration (retiré depuis, ou saisi avant la liste)
export const offGrade = g => Boolean(g) && !state.settings.grades.includes(g);

// Options du grade (SASP ou grade interne d'une division) ; un grade hors liste reste proposé à l'agent qui le porte encore
export const gradeOptions = (current = '', list = state.settings.grades) => html`<option value="">—</option>
  ${current && !list.includes(current) ? html`<option value="${current}" selected>${current} (hors liste)</option>` : ''}
  ${list.map(g => html`<option value="${g}" ${g === current ? 'selected' : ''}>${g}</option>`)}`;

// Grade le plus élevé d'abord (ordre de la liste des grades), puis nom
const gradeRank = g => state.settings.grades.indexOf(g);
const byRank = (a, b) => gradeRank(b.grade) - gradeRank(a.grade) || fullName(a).localeCompare(fullName(b), 'fr');

export function anciennete(iso) {
  if (!iso) return '—';
  const start = new Date(`${iso}T00:00:00`);
  const now = new Date();
  if (start > now) return 'à venir';
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months--;
  if (months < 1) {
    const days = Math.floor((now - start) / 86400000);
    return `${days} jour${days > 1 ? 's' : ''}`;
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} an${y > 1 ? 's' : ''}`, m && `${m} mois`].filter(Boolean).join(' et ');
}

// Création d'un compte (administrateur) ; le profil se complète ensuite dans l'éditeur
export function openCreateForm() {
  const dialog = openModal('Nouvel agent', html`
    <form class="form-grid" data-form>
      <label>Matricule *<input class="input mono" name="matricule" required autofocus></label>
      <label>Grade<select class="input" name="grade">${gradeOptions()}</select></label>
      <label>Prénom<input class="input" name="prenom"></label>
      <label>Nom<input class="input" name="nom"></label>
      <label>Rôle<select class="input" name="role">${Object.entries(ROLES).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <label>Mot de passe * (8 caractères min.)<input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <p class="span-2 muted small">Le profil (photo, division, qualifications…) se complète à l'étape suivante.</p>
      <div class="span-2 form-actions"><button class="btn btn-primary">Créer et compléter le profil</button></div>
    </form>`);
  $('[data-form]', dialog).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      const { id } = await api('/users', { method: 'POST', body: formValues(e.target) });
      await loadUsers(true);
      toast('Agent créé');
      dialog.close();
      navigate(`/agents/${id}/modifier`);
    }, e.submitter);
  });
}

// ---------- Effectifs ----------

export async function renderList(main) {
  const users = await loadUsers(true);
  const admin = hasRole('admin');
  const divisions = [...new Set(users.flatMap(u => u.divisions))].sort();
  mount(main, html`
    <div class="page-head">
      <div><h1>Effectifs</h1><p class="muted">${users.filter(u => u.actif).length} agent(s) en service</p></div>
      ${admin ? html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Nouvel agent</button></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="Nom, matricule, grade…" autofocus></div>
      <select class="input" data-division><option value="">Toutes les divisions</option>${divisions.map(d => html`<option>${d}</option>`)}</select>
      ${admin ? html`<label class="check"><input type="checkbox" data-inactifs> Comptes révoqués</label>` : ''}
    </div>
    <div class="roster" data-results></div>`);

  const draw = () => {
    const words = normalize($('[data-q]', main).value).split(/\s+/).filter(Boolean);
    const division = $('[data-division]', main).value;
    const inactifs = $('[data-inactifs]', main)?.checked;
    const list = users
      .filter(u => (u.actif || inactifs) && (!division || u.divisions.includes(division)))
      .filter(u => words.every(w => normalize(`${u.prenom} ${u.nom} ${u.matricule} ${u.grade}`).includes(w)))
      .sort(byRank);
    mount($('[data-results]', main), list.length ? list.map(u => html`
      <a class="agent-card ${u.actif ? '' : 'is-muted'}" href="#/agents/${u.id}">
        ${avatar(u, 'lg')}
        <span class="agent-card-body">
          <span class="agent-grade">${u.grade || 'Grade non défini'}</span>
          <strong>${fullName(u)}</strong>
          <span class="mono muted">『${u.matricule}』</span>
          <span class="tags">
            ${u.divisions.map(d => html`<span class="badge">${d}</span>`)}
            ${u.role !== 'agent' ? roleBadge(u.role) : ''}
            ${u.actif ? '' : html`<span class="badge badge-danger">Révoqué</span>`}
          </span>
        </span>
      </a>`) : html`<p class="empty-state">Aucun agent ne correspond.</p>`);
  };
  for (const el of $$('[data-q], [data-division], [data-inactifs]', main)) el.addEventListener('input', draw);
  $('[data-new]', main)?.addEventListener('click', openCreateForm);
  draw();
}

// ---------- Profil ----------

export async function renderProfile(main, [id]) {
  const [u, users] = await Promise.all([api(`/users/${id}`), loadUsers()]);
  // Tuteurs de l'Academy (rookie) et rookies confiés (tuteur), réglés dans Academy → Suivi des rookies
  const tuteurs = u.tuteurs.map(t => users.find(x => x.id === t)).filter(Boolean);
  const suivis = users.filter(r => r.actif && r.tuteurs.includes(u.id));
  const canEdit = u.id === state.user.id || hasRole('superviseur');
  const dossier = canEdit ? await dossierCard(u.id) : '';
  const stat = (value, label) => html`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
  mount(main, html`
    <div class="page-head">
      <a href="#/agents" class="back">${icon('back')} Effectifs</a>
      ${canEdit ? html`<div class="actions"><a class="btn btn-primary" href="#/agents/${u.id}/modifier">${icon('edit')} Modifier le profil</a></div>` : ''}
    </div>

    <section class="card profile-hero">
      ${avatar(u, 'xl')}
      <div class="grow">
        <p class="agent-grade">${u.grade || 'Grade non défini'}</p>
        <h1>${fullName(u)}</h1>
        <p class="mono gold">『${u.matricule}』</p>
        <div class="tags">
          ${roleBadge(u.role)}
          ${u.divisions.map(d => html`<span class="badge">${d}</span>`)}
          ${GRADED.map(d => u[d.gradeField] ? html`<span class="badge badge-gold">${d.nom} · ${u[d.gradeField]}</span>` : '')}
          ${u.actif ? html`<span class="badge badge-ok">En service</span>` : html`<span class="badge badge-danger">Révoqué</span>`}
        </div>
      </div>
    </section>

    <div class="stats stats-5">
      ${stat(u.stats.arrestations, 'Arrestations rédigées')}
      ${stat(u.stats.participations, 'Participations')}
      ${stat(u.stats.plaintes, 'Plaintes enregistrées')}
      ${stat(u.stats.mandats, 'Mandats & BOLO émis')}
      ${stat(u.stats.vehicules, 'Vols déclarés')}
    </div>

    <div class="detail-grid">
      <section class="card">
        <h3>Service</h3>
        <dl class="dl">
          <dt>Division${u.divisions.length > 1 ? 's' : ''}</dt><dd>${u.divisions.join(', ') || '—'}</dd>
          ${GRADED.map(d => u[d.gradeField] ? html`<dt>Grade ${d.nom}</dt><dd>${u[d.gradeField]}</dd>` : '')}
          ${tuteurs.length ? html`<dt>Tuteur${tuteurs.length > 1 ? 's' : ''}</dt><dd>${tuteurs.map(t => html`<a href="#/agents/${t.id}">${agentLabel(t)}</a><br>`)}</dd>` : ''}
          ${suivis.length ? html`<dt>Rookies suivis</dt><dd>${suivis.map(r => html`<a href="#/agents/${r.id}">${agentLabel(r)}</a><br>`)}</dd>` : ''}
          <dt>Date d'entrée</dt><dd>${fmtDate(u.date_entree)}</dd>
          <dt>Ancienneté</dt><dd>${anciennete(u.date_entree)}</dd>
          <dt>Compte MDT</dt><dd>créé le ${fmtDateTime(u.created_at)}</dd>
        </dl>
      </section>
      <section class="card">
        <h3>Contact</h3>
        <dl class="dl">
          <dt>Téléphone</dt><dd>${u.telephone || '—'}</dd>
          <dt>Discord</dt><dd>${u.discord || '—'}</dd>
        </dl>
      </section>
      <section class="card">
        <h3>Qualifications & formations</h3>
        ${u.qualifications.length ? html`<div class="tags">${u.qualifications.map(q => html`<span class="chip chip-static">${q}</span>`)}</div>`
          : html`<p class="empty-state">Aucune qualification enregistrée.</p>`}
      </section>
      <section class="card">
        <h3>Présentation</h3>
        ${u.bio ? html`<p class="pre-wrap">${u.bio}</p>` : html`<p class="empty-state">Pas de présentation.</p>`}
      </section>
    </div>

    ${dossier}

    <section class="card">
      <h3>Dernières arrestations</h3>
      ${u.reports.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Date des faits</th><th>Suspect</th><th class="num">Chefs</th><th class="num">Amende</th></tr></thead>
        <tbody>${u.reports.map(r => html`<tr data-href="#/rapports/${r.id}">
          <td class="mono strong">${r.numero}</td><td>${fmtDate(r.date_faits)}</td>
          <td>${fullName({ nom: r.suspect_nom, prenom: r.suspect_prenom })}</td>
          <td class="num">${r.nb_chefs ?? 0}</td><td class="num">${formatDollars(r.amende ?? 0)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty-state">Aucune arrestation finalisée.</p>`}
    </section>`);

  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}

// ---------- Éditeur de profil ----------

const section = (title, body, note = '') => html`
  <section class="card report-section">
    <div class="card-head"><h2 class="section-title">${title}</h2>${note ? html`<small class="muted">${note}</small>` : ''}</div>
    ${body}
  </section>`;

export async function renderEdit(main, [id]) {
  const u = await api(`/users/${id}`);
  const self = u.id === state.user.id;
  const admin = hasRole('admin');
  const sup = hasRole('superviseur');
  if (!self && !sup) {
    mount(main, html`<div class="alert alert-danger">Vous ne pouvez modifier que votre propre profil. <a href="#/agents/${u.id}">Retour au profil</a></div>`);
    return;
  }
  const canSelf = self || admin;
  const model = { photos: { photo_url: u.photo_url }, qualifications: [...u.qualifications] };
  let dirty = false;
  const dis = ok => (ok ? '' : 'disabled');
  const lockNote = role => `Modifiable par ${role === 'admin' ? 'un administrateur' : 'un superviseur'}`;

  mount(main, html`
    <div class="page-head">
      <div>
        <a href="#/agents/${u.id}" class="back">${icon('back')} Profil</a>
        <h1>${self ? 'Mon profil' : html`Profil de ${fullName(u)}`} <span class="mono gold">『${u.matricule}』</span></h1>
      </div>
    </div>

    <div class="report-form">
    <form data-form autocomplete="off" novalidate>
      <datalist id="qualifs-list" data-qualifs-list></datalist>

      ${section('Identité', html`
        <div class="identity">
          <div class="identity-photo" data-photo>${canSelf ? '' : avatar(u, 'xl')}</div>
          <div class="grow form-grid">
            <label>Matricule<input class="input mono" name="matricule" value="${u.matricule}" required ${dis(admin)}></label>
            <label>Grade<select class="input" name="grade" ${dis(admin)}>${gradeOptions(u.grade)}</select></label>
            <label>Prénom<input class="input" name="prenom" value="${u.prenom}" ${dis(admin)}></label>
            <label>Nom<input class="input" name="nom" value="${u.nom}" ${dis(admin)}></label>
          </div>
        </div>`, admin ? '' : lockNote('admin'))}

      ${section('Contact', html`
        <div class="form-grid">
          <label>Téléphone (en jeu)<input class="input" name="telephone" value="${u.telephone}" placeholder="(000) 000-0000" ${dis(canSelf)}></label>
          <label>Discord<input class="input" name="discord" value="${u.discord}" placeholder="pseudo" ${dis(canSelf)}></label>
        </div>`)}

      ${section('Service', html`
        <div class="form-grid">
          <div class="span-2 field"><span>Divisions / unités (plusieurs possibles, sauf BCI avec S.W.A.T.)</span>
            <div class="check-group">${[...new Set([...state.settings.divisions, ...u.divisions])].map(d => html`<label class="check"><input type="checkbox" data-division value="${d}" ${u.divisions.includes(d) ? 'checked' : ''} ${dis(sup)}> ${d}</label>`)}</div>
            <p class="alert alert-warn" data-division-conflict hidden></p></div>
          ${GRADED.map(d => html`<label>Grade ${d.nom} (membres du ${d.nom})<select class="input" name="${d.gradeField}" ${dis(sup)}>${gradeOptions(u[d.gradeField], state.settings[d.grades])}</select></label>`)}
          <label>Date d'entrée au SASP<input class="input" type="date" name="date_entree" value="${u.date_entree}" ${dis(sup)}></label>
        </div>`, sup ? '' : lockNote('superviseur'))}

      ${section('Qualifications & formations', html`
        <div class="tags" data-qualifs></div>
        ${sup ? html`<div class="chips-input mt-sm">
          <input class="input" list="qualifs-list" data-qualif-input placeholder="Ajouter une qualification…">
          <button type="button" class="btn btn-sm" data-qualif-add>${icon('plus')} Ajouter</button>
        </div>` : ''}`, sup ? '' : lockNote('superviseur'))}

      ${section('Présentation', html`
        <textarea class="input" name="bio" rows="5" placeholder="Parcours, spécialités, disponibilités…" ${dis(canSelf)}>${u.bio}</textarea>`)}

      ${admin ? section('Compte', html`
        <div class="form-grid">
          <label>Rôle dans le MDT<select class="input" name="role" ${dis(!self)}>${Object.entries(ROLES).map(([k, l]) => html`<option value="${k}" ${k === u.role ? 'selected' : ''}>${l}</option>`)}</select></label>
          ${self ? '' : html`<label>Réinitialiser le mot de passe<input class="input" type="password" name="password" minlength="8" autocomplete="new-password" placeholder="Laisser vide pour conserver"></label>`}
          ${self ? '' : html`<label class="check span-2"><input type="checkbox" name="actif" ${u.actif ? 'checked' : ''}> Compte actif (décocher pour révoquer l'accès au MDT)</label>`}
        </div>
        <p class="muted small">Agent : rédige ses rapports. Superviseur : modifie et rouvre tous les rapports, gère divisions et qualifications, change le Defcon ; accède à la Police Academy et à ses propres divisions. État-major : droits du superviseur sur toutes les divisions. Administrateur : comptes, paramètres du MDT (grades, divisions, qualifications…), Code pénal et sauvegardes.</p>`) : ''}
    </form>

    ${self ? section('Sécurité', html`
      <form class="form-grid" data-password>
        <label>Mot de passe actuel<input class="input" type="password" name="current" required autocomplete="current-password"></label>
        <label>Nouveau mot de passe (8 caractères min.)<input class="input" type="password" name="next" required minlength="8" autocomplete="new-password"></label>
        <div class="span-2 form-actions"><button class="btn">Changer le mot de passe</button></div>
      </form>`) : ''}
    </div>

    <div class="action-bar">
      <span class="save-status" data-status>Enregistré</span>
      <div class="actions">
        <a class="btn" href="#/agents/${u.id}">Voir le profil</a>
        <button type="button" class="btn btn-primary" data-save>Enregistrer <kbd>Ctrl+S</kbd></button>
      </div>
    </div>`);

  const form = $('[data-form]', main);
  const status = $('[data-status]', main);
  const markDirty = () => {
    dirty = true;
    status.textContent = 'Modifications non enregistrées';
    status.classList.add('is-dirty');
  };
  setLeaveGuard(silent => !dirty || (!silent && confirm('Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?')));

  if (canSelf) mountPhotos($('[data-photo]', main), model.photos, markDirty, [{ titre: '', slots: [['photo_url', 'Photo de profil']] }]);

  const renderQualifs = () => {
    mount($('[data-qualifs]', main), model.qualifications.length
      ? model.qualifications.map(q => html`<span class="chip chip-static">${q}${sup ? html`<button type="button" class="btn-icon" data-qualif-rm="${q}">✕</button>` : ''}</span>`)
      : html`<span class="muted small">Aucune qualification.</span>`);
    // Les qualifications déjà attribuées ne sont plus proposées ; retirée, une qualification revient dans la liste
    mount($('[data-qualifs-list]', main), state.settings.qualifications
      .filter(q => !model.qualifications.includes(q))
      .map(q => html`<option value="${q}">`));
  };
  const addQualif = () => {
    const input = $('[data-qualif-input]', main);
    const q = input.value.trim();
    if (q && !model.qualifications.includes(q)) {
      model.qualifications.push(q);
      renderQualifs();
      markDirty();
    }
    input.value = '';
  };

  async function save() {
    const body = formValues(form);
    if (!body.password) delete body.password;
    if (canSelf) body.photo_url = model.photos.photo_url ?? '';
    if (sup) body.qualifications = model.qualifications;
    if (sup) body.divisions = $$('[data-division]:checked', main).map(i => i.value);
    const saved = await api(`/users/${u.id}`, { method: 'PUT', body });
    if (self) {
      Object.assign(state.user, { matricule: saved.matricule, nom: saved.nom, prenom: saved.prenom, grade: saved.grade, photo_url: saved.photo_url });
      window.dispatchEvent(new Event('profile-change'));
    }
    await loadUsers(true);
    if (form.elements.namedItem('password')) form.elements.namedItem('password').value = '';
    dirty = false;
    status.textContent = `Enregistré à ${nowTime()}`;
    status.classList.remove('is-dirty');
    toast('Profil enregistré');
  }

  form.addEventListener('input', e => { if (!e.target.matches('[data-qualif-input], [data-url]')) markDirty(); });
  form.addEventListener('change', e => {
    if (e.target.matches('select, [type=checkbox]')) markDirty();
    // Cumul interdit (BCI et S.W.A.T.) signalé avant l'enregistrement, que le serveur refuserait
    if (e.target.matches('[data-division]')) {
      const conflict = divisionConflict($$('[data-division]:checked', main).map(i => i.value));
      const alert = $('[data-division-conflict]', main);
      alert.hidden = !conflict;
      alert.textContent = conflict ?? '';
    }
  });
  $('[data-qualif-input]', main)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addQualif(); }
  });
  main.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      attempt(save);
    }
  });
  main.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-save]')) attempt(save, t);
    else if (t.matches('[data-qualif-add]')) addQualif();
    else if (t.dataset.qualifRm) {
      model.qualifications = model.qualifications.filter(q => q !== t.dataset.qualifRm);
      renderQualifs();
      markDirty();
    }
  });
  $('[data-password]', main)?.addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api('/auth/password', { method: 'POST', body: formValues(e.target) });
      e.target.reset();
      toast('Mot de passe modifié');
    }, e.submitter);
  });

  renderQualifs();
}

