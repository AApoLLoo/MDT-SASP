import { html, mount, $, $$, attempt, toast, fullName, fmtDateTime } from '../dom.js';
import { api, state, loadUsers, hasRole } from '../api.js';
import { rerender } from '../router.js';
import { icon } from '../icons.js';
import { openCreateForm, roleBadge, offGrade } from './agents.js';

const TABS = [['comptes', 'Comptes'], ['parametres', 'Paramètres'], ['sauvegardes', 'Sauvegardes']];

// Listes réglables : [clé, titre, aide]
const LISTS = [
  ['grades', 'Grades', 'Du plus bas au plus élevé : cet ordre trie les effectifs. Renommer un grade met à jour les agents qui le portent.'],
  ['grades_swat', 'Grades SWAT', "Du plus bas au plus élevé : cet ordre trie l'effectif du S.W.A.T. Renommer un grade met à jour les agents qui le portent."],
  ['grades_bci', 'Grades BCI', "Du plus bas au plus élevé : cet ordre trie l'effectif du BCI. Renommer un grade met à jour les agents qui le portent."],
  ['divisions', 'Divisions','Proposées dans les profils et pour les annonces de division. Renommer une division met à jour les agents et les annonces.'],
  ['qualifications', 'Qualifications & formations', "Chaque entrée est une formation du catalogue de l'Academy, qui y ajoute prérequis et programme. « Formateur » donne le droit de publier dans Academy. Renommer une qualification met à jour les agents et les formations de l'Academy."],
  ['secteurs', 'Secteurs de patrouille', 'Choisis par les unités en service.'],
  ['postes', 'Postes de rattachement', 'Choisis par les unités en service.'],
];

const listRow = v => html`<div class="list-row">
  <input class="input" value="${v}" data-was="${v}" maxlength="60" aria-label="Valeur">
  <button type="button" class="btn btn-sm btn-ghost" data-move="-1" title="Monter">↑</button>
  <button type="button" class="btn btn-sm btn-ghost" data-move="1" title="Descendre">↓</button>
  <button type="button" class="btn-icon" data-rm title="Retirer">✕</button>
</div>`;

function accountsTab(users) {
  const off = users.filter(u => u.actif && offGrade(u.grade));
  return html`
    ${off.length ? html`<p class="alert alert-warn">${off.length} agent(s) actif(s) ont un grade absent de la liste des grades : ${off.map(u => u.matricule).join(', ')}. Mettez leur grade à jour, ou ajoutez ce grade dans <a href="#/admin?onglet=parametres">Paramètres</a>.</p>` : ''}
    <div class="card table-wrap">
      <table class="table table-click">
        <thead><tr><th>Matricule</th><th>Agent</th><th>Grade</th><th>Division</th><th>Rôle</th><th>Statut</th><th>Créé le</th><th></th></tr></thead>
        <tbody>${users.map(u => html`<tr class="${u.actif ? '' : 'is-muted'}" data-href="#/agents/${u.id}">
          <td class="mono strong">${u.matricule}</td><td>${fullName(u)}</td>
          <td>${u.grade || '—'}${offGrade(u.grade) ? html` <span class="badge badge-warn">hors liste</span>` : ''}</td><td>${u.divisions.join(', ') || '—'}</td>
          <td>${roleBadge(u.role)}</td>
          <td>${u.actif ? html`<span class="badge badge-ok">Actif</span>` : html`<span class="badge">Révoqué</span>`}</td>
          <td class="muted nowrap">${fmtDateTime(u.created_at)}</td>
          <td><a class="btn btn-sm btn-ghost" href="#/agents/${u.id}/modifier" title="Modifier le profil">${icon('edit')}</a></td></tr>`)}</tbody>
      </table>
    </div>`;
}

const settingsTab = () => html`
  <p class="muted small">Également réglables : les infractions dans le <a href="#/code-penal">Code pénal</a>, le niveau Defcon depuis le <a href="#/">tableau de bord</a>. Chaque modification est tracée dans l'<a href="#/historique">historique</a>.</p>
  <div class="detail-grid">${LISTS.map(([key, titre, aide]) => html`
    <section class="card" data-list="${key}">
      <div class="card-head"><h3>${titre}</h3><button type="button" class="btn btn-sm btn-primary" data-save>Enregistrer</button></div>
      <p class="muted small">${aide}</p>
      <div class="list-editor" data-rows>${state.settings[key].map(listRow)}</div>
      <button type="button" class="btn btn-sm mt-sm" data-add>${icon('plus')} Ajouter</button>
    </section>`)}
  </div>`;

const backupsTab = list => html`
  <section class="card">
    <div class="card-head"><h3>Sauvegardes de la base</h3><button type="button" class="btn btn-sm btn-primary" data-backup>Sauvegarder maintenant</button></div>
    <p class="muted small">Le serveur sauvegarde la base chaque jour dans <span class="mono">data/backups/</span> et garde les plus récentes. La restauration se fait serveur arrêté (voir le README).</p>
    ${list.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Fichier</th><th>Date</th><th class="num">Taille</th></tr></thead>
      <tbody>${list.map(b => html`<tr><td class="mono">${b.name}</td><td>${fmtDateTime(b.date)}</td><td class="num">${(b.size / 1024 / 1024).toFixed(1)} Mo</td></tr>`)}</tbody>
    </table></div>` : html`<p class="empty-state">Aucune sauvegarde.</p>`}
  </section>`;

async function saveList(card) {
  const key = card.dataset.list;
  const inputs = $$('[data-rows] input', card);
  const items = inputs.map(i => i.value.trim()).filter(Boolean);
  const renames = Object.fromEntries(inputs
    .filter(i => i.dataset.was && i.value.trim() && i.value.trim() !== i.dataset.was)
    .map(i => [i.dataset.was, i.value.trim()]));
  state.settings[key] = (await api(`/admin/settings/${key}`, { method: 'PUT', body: { items, renames } })).items;
  await loadUsers(true);
  toast('Paramètres enregistrés');
  rerender();
}

export async function render(main, params, query) {
  if (!hasRole('admin')) {
    mount(main, html`<div class="alert alert-danger">Accès réservé aux administrateurs.</div>`);
    return;
  }
  const tab = TABS.some(([k]) => k === query.get('onglet')) ? query.get('onglet') : 'comptes';
  const users = await loadUsers(true);
  const content = tab === 'comptes' ? accountsTab(users)
    : tab === 'parametres' ? settingsTab()
      : backupsTab(await api('/admin/backups'));
  mount(main, html`
    <div class="page-head">
      <div><h1>Administration</h1><p class="muted">${users.filter(u => u.actif).length} compte(s) actif(s) sur ${users.length}</p></div>
      ${tab === 'comptes' ? html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Nouvel agent</button></div>` : ''}
    </div>
    <div class="toolbar"><div class="segmented">${TABS.map(([k, l]) => html`<a href="#/admin?onglet=${k}" class="${k === tab ? 'is-active' : ''}">${l}</a>`)}</div></div>
    ${content}`);

  $('[data-new]', main)?.addEventListener('click', openCreateForm);
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
    const btn = e.target.closest('button');
    const card = btn?.closest('[data-list]');
    if (!btn) return;
    if (btn.matches('[data-backup]')) {
      attempt(async () => {
        await api('/admin/backups', { method: 'POST' });
        toast('Sauvegarde effectuée');
        rerender();
      }, btn);
    } else if (btn.matches('[data-save]')) attempt(() => saveList(card), btn);
    else if (btn.matches('[data-add]')) {
      $('[data-rows]', card).insertAdjacentHTML('beforeend', String(listRow('')));
      $('[data-rows] .list-row:last-child input', card).focus();
    } else if (btn.matches('[data-rm]')) btn.closest('.list-row').remove();
    else if (btn.dataset.move) {
      const row = btn.closest('.list-row');
      if (btn.dataset.move === '-1') row.previousElementSibling?.before(row);
      else row.nextElementSibling?.after(row);
    }
  });
}
