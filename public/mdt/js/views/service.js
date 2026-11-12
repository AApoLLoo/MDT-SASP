import { html, mount, $, $$, attempt, openModal, formValues, toast, fullName, agentLabel, fmtDate, fmtDateTime, nowTime, PAGE, moreButton } from '../dom.js';
import { api, state, loadUsers, userByMatricule, hasRole } from '../api.js';
import { icon } from '../icons.js';
import { mountPhotos, numberedSlots } from '../components/photos.js';
import { sketchSvg, openSketchEditor } from '../components/sketch.js';
import { KINDS, DIVISION_KINDS, UNIT_STATUTS, initialStatut, managesDivision } from '../service-kinds.js';

const TABS = [['patrouilles', 'Patrouilles'], ...Object.entries(KINDS).map(([k, v]) => [k, v.titre])];
const TONE = { ok: 'badge-ok', info: 'badge-info', danger: 'badge-danger', warn: 'badge-warn', '': '' };
const REFRESH_MS = 20000;

export const statutBadge = ([label, tone]) => html`<span class="badge ${TONE[tone]}">${label}</span>`;
const agentOf = rec => ({ matricule: rec.agent_matricule, nom: rec.agent_nom, prenom: rec.agent_prenom, grade: rec.agent_grade });
const ALL_KINDS = { ...KINDS, ...DIVISION_KINDS };
// Superviseurs ; pour un dossier de division, aussi les membres de la division (même règle que le serveur)
export const canManage = kind => (kind.division ? managesDivision(kind.division, state.user) : hasRole('superviseur'));

export async function render(main, [tab = 'patrouilles']) {
  await loadUsers();
  mount(main, html`
    <div class="page-head"><h1>Service</h1></div>
    <div class="toolbar"><div class="segmented">${TABS.map(([k, l]) => html`<a href="#/service/${k}" class="${k === tab ? 'is-active' : ''}">${l}</a>`)}</div></div>
    <div data-tab></div>`);
  const root = $('[data-tab]', main);
  if (tab === 'patrouilles') return renderUnits(root);
  if (!KINDS[tab]) return mount(root, html`<p class="empty-state">Onglet inconnu.</p>`);
  return renderRecords(root, tab);
}

// ---------- Unités en patrouille ----------

const agentChip = m => {
  const u = userByMatricule(m);
  return html`<span class="chip chip-static" title="${u ? agentLabel(u) : 'Agent hors MDT'}">『${m}』${u ? ` ${u.grade ? u.grade + ' ' : ''}${u.nom}` : ''}</span>`;
};

function openUnitForm(unit = null, onSaved) {
  const agents = unit ? [...unit.agents] : [state.user.matricule];
  const dialog = openModal(unit ? `Unité ${unit.indicatif}` : 'Nouvelle unité en service', html`
    <form class="form-grid" data-form>
      <label>Indicatif *<input class="input mono upper" name="indicatif" required value="${unit?.indicatif}" placeholder="Ex. : ADAM-12" ${unit ? '' : 'autofocus'}></label>
      <label>Statut<select class="input" name="statut">${Object.entries(UNIT_STATUTS).map(([k, [l]]) => html`<option value="${k}" ${k === (unit?.statut ?? 'disponible') ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label>Secteur<select class="input" name="secteur"><option value="">—</option>${state.settings.secteurs.map(s => html`<option ${s === unit?.secteur ? 'selected' : ''}>${s}</option>`)}</select></label>
      <label>Poste de rattachement<select class="input" name="poste"><option value="">—</option>${state.settings.postes.map(p => html`<option ${p === unit?.poste ? 'selected' : ''}>${p}</option>`)}</select></label>
      <label>Véhicule<input class="input" name="vehicule" value="${unit?.vehicule}" placeholder="Ex. : Interceptor 2 · plaque SASP-04"></label>
      <div class="span-2 field"><span>Agents de l'unité</span>
        <div class="chips-input"><span data-agents></span>
          <input class="input" list="unit-users" data-agent-input placeholder="Matricule puis Entrée…">
          <button type="button" class="btn btn-sm" data-agent-add>${icon('plus')} Ajouter</button></div>
        <datalist id="unit-users">${state.users.filter(u => u.actif).map(u => html`<option value="${u.matricule}">${agentLabel(u)}</option>`)}</datalist>
        <small class="muted">Un agent ajouté ici quitte automatiquement son unité précédente.</small>
      </div>
      <label class="span-2">Notes<input class="input" name="notes" value="${unit?.notes}" placeholder="Mission en cours, consignes…"></label>
      <div class="span-2 form-actions"><button class="btn btn-primary">${unit ? 'Enregistrer' : 'Prendre le service'}</button></div>
    </form>`);
  const renderAgents = () => mount($('[data-agents]', dialog), agents.map(m => html`<span class="chip chip-static">『${m}』<button type="button" class="btn-icon" data-agent-rm="${m}">✕</button></span>`));
  const add = () => {
    const input = $('[data-agent-input]', dialog);
    const m = input.value.trim();
    if (m && !agents.includes(m)) agents.push(m);
    input.value = '';
    renderAgents();
  };
  $('[data-agent-input]', dialog).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  dialog.addEventListener('click', e => {
    if (e.target.closest('[data-agent-add]')) add();
    const rm = e.target.closest('[data-agent-rm]')?.dataset.agentRm;
    if (rm) { agents.splice(agents.indexOf(rm), 1); renderAgents(); }
  });
  $('[data-form]', dialog).addEventListener('submit', e => {
    e.preventDefault();
    const body = { ...formValues(e.target), agents };
    body.indicatif = body.indicatif.toUpperCase();
    attempt(async () => {
      await api(unit ? `/service/units/${unit.id}` : '/service/units', { method: unit ? 'PUT' : 'POST', body });
      toast(unit ? 'Unité mise à jour' : `Unité ${body.indicatif} en service`);
      dialog.close();
      onSaved();
    }, e.submitter);
  });
  renderAgents();
}

async function renderUnits(root) {
  mount(root, html`
    <div class="card-head">
      <p class="muted" data-summary></p>
      <button class="btn btn-primary" data-new>${icon('plus')} Nouvelle unité</button>
    </div>
    <div class="units" data-units></div>`);

  let units = [];
  const draw = () => {
    const me = state.user.matricule.toLowerCase();
    const counts = Object.entries(UNIT_STATUTS).map(([k, [l]]) => `${units.filter(u => u.statut === k).length} ${l.toLowerCase()}`);
    $('[data-summary]', root).textContent = units.length
      ? `${units.length} unité(s) · ${units.reduce((s, u) => s + u.agents.length, 0)} agent(s) · ${counts.join(' · ')} · actualisé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : 'Aucune unité en service.';
    mount($('[data-units]', root), units.length ? units.map(u => html`
      <article class="unit-card unit-${u.statut} ${u.agents.some(m => m.toLowerCase() === me) ? 'is-mine' : ''}">
        <div class="unit-head">
          <strong class="mono">${u.indicatif}</strong>
          <select class="input input-sm" data-statut="${u.id}" aria-label="Statut de l'unité">
            ${Object.entries(UNIT_STATUTS).map(([k, [l]]) => html`<option value="${k}" ${k === u.statut ? 'selected' : ''}>${l}</option>`)}
          </select>
        </div>
        <div class="tags">${u.agents.length ? u.agents.map(agentChip) : html`<span class="muted small">Aucun agent</span>`}</div>
        <dl class="dl small">
          <dt>Secteur</dt><dd>${u.secteur || '—'}</dd>
          <dt>Poste</dt><dd>${u.poste || '—'}</dd>
          <dt>Véhicule</dt><dd>${u.vehicule || '—'}</dd>
          ${u.notes ? html`<dt>Notes</dt><dd>${u.notes}</dd>` : ''}
        </dl>
        <div class="unit-foot">
          <small class="muted">Màj ${fmtDateTime(u.updated_at)}${u.updated_matricule ? ` par 『${u.updated_matricule}』` : ''}</small>
          <span>
            <button class="btn btn-sm btn-ghost" data-edit="${u.id}" title="Modifier">${icon('edit')}</button>
            <button class="btn btn-sm btn-ghost" data-end="${u.id}" title="Fin de service">${icon('logout')}</button>
          </span>
        </div>
      </article>`) : html`<p class="empty-state">Aucune unité en patrouille. Créez la vôtre en début de service.</p>`);
  };
  const load = async () => {
    units = await api('/service/units');
    draw();
  };

  // Rafraîchissement automatique tant que la page est affichée
  const timer = setInterval(() => {
    if (!root.isConnected) return clearInterval(timer);
    if (!document.querySelector('dialog[open]')) load().catch(() => {});
  }, REFRESH_MS);

  const reload = () => attempt(load);
  $('[data-new]', root).addEventListener('click', () => openUnitForm(null, reload));
  root.addEventListener('change', e => {
    const id = e.target.dataset.statut;
    if (id) attempt(async () => {
      await api(`/service/units/${id}`, { method: 'PUT', body: { statut: e.target.value } });
      await load();
    });
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    const unit = t && units.find(u => u.id === Number(t.dataset.edit || t.dataset.end));
    if (!unit) return;
    if (t.dataset.edit) openUnitForm(unit, reload);
    if (t.dataset.end && confirm(`Fin de service pour l'unité ${unit.indicatif} ?`)) {
      attempt(async () => {
        await api(`/service/units/${unit.id}`, { method: 'DELETE' });
        toast(`Unité ${unit.indicatif} hors service`);
        await load();
      });
    }
  });
  await load();
}

// ---------- Dossiers génériques ----------

// Options d'une liste : fixes, réglées par l'administration (`settings`) ou dossiers liés (`ref`).
// Une valeur absente des options (dossier lié renommé, valeur retirée de la liste) reste affichée.
const choices = (f, value, refs) => f.options ?? [...new Set([value, ...(f.settings ? state.settings[f.settings] : refs[f.ref] ?? [])].filter(Boolean))];

// Ligne d'un champ `rows` : les cellules n'ont pas de `name`, elles sont relues à l'enregistrement.
// Les colonnes `hidden` (ex. fiche citoyen d'une personne) suivent la ligne dans des champs cachés.
const rowHtml = (f, row, editable, refs = {}) => html`<tr>${f.columns.filter(c => !c.hidden).map(c => html`<td>${c.options || c.ref || c.settings
  ? html`<select class="input input-sm" data-col="${c.key}" aria-label="${c.label}" ${editable ? '' : 'disabled'}><option value=""></option>${choices(c, row[c.key], refs).map(o => html`<option ${o === row[c.key] ? 'selected' : ''}>${o}</option>`)}</select>`
  : html`<input class="input input-sm" type="${c.type || 'text'}" data-col="${c.key}" aria-label="${c.label}" value="${row[c.key] ?? ''}" placeholder="${c.placeholder ?? ''}" list="${c.list ? 'record-users' : ''}" ${editable ? '' : 'disabled'}>`}</td>`)}
  ${editable ? html`<td>${f.columns.filter(c => c.hidden).map(c => html`<input type="hidden" data-col="${c.key}" value="${row[c.key] ?? ''}">`)}<button type="button" class="btn-icon" data-row-rm title="Retirer la ligne">✕</button></td>` : ''}</tr>`;

// Dossier numéroté lié, complet ou en résumé (voir `link`) : numéro, titre, statut et agent ; sa page pour qui peut la lire
export const linkedLabel = d => {
  const kind = ALL_KINDS[d.kind];
  // Dossier confidentiel (`masque`) pour qui ne peut pas le lire : son nom de code seul, sans lien
  if (d.masque) return html`<strong>${d.data[kind.masque]}</strong> <span class="badge">Confidentiel</span>`;
  return html`${d.resume ? html`<strong class="mono">${d.data.numero}</strong>` : html`<a class="mono" href="#/divisions/${kind.division}/${d.kind}/${d.id}">${d.data.numero}</a>`}
    · ${d.data[kind.fields[0].key]} ${statutBadge(kind.statuts[d.statut])} · ${kind.agent} 『${d.agent_matricule}』`;
};

// refs : options des listes `ref`, chargées par openRecordForm
export const fieldInput = (f, value, editable, refs = {}) => {
  if (f.section) return html`<h3 class="span-2 form-section">${f.section}</h3>`;
  if (f.type === 'rows') return html`<div class="span-2 field"><span>${f.label}</span>
    <table class="table table-rows" data-rows="${f.key}">
      <thead><tr>${f.columns.filter(c => !c.hidden).map(c => html`<th>${c.label}</th>`)}${editable ? html`<th></th>` : ''}</tr></thead>
      <tbody>${(value || []).map(row => rowHtml(f, row, editable, refs))}</tbody>
    </table>
    ${editable ? html`<button type="button" class="btn btn-sm" data-row-add="${f.key}">${icon('plus')} Ajouter une ligne</button>` : ''}</div>`;
  if (f.type === 'photos') return html`<div class="span-2" data-photos="${f.key}"></div>`;
  if (f.type === 'sketch') return html`<div class="span-2 sketch-preview" data-sketch="${f.key}"></div>`;
  const common = `${editable ? '' : 'disabled'} ${f.required ? 'required' : ''}`;
  if (f.type === 'textarea') return html`<label class="span-2">${f.label}${f.required ? ' *' : ''}<textarea class="input" name="${f.key}" rows="3" ${common}>${value}</textarea></label>`;
  if (f.type === 'select') return html`<label>${f.label}${f.required ? ' *' : ''}<select class="input" name="${f.key}" ${common}><option value=""></option>${choices(f, value, refs).map(o => html`<option ${o === value ? 'selected' : ''}>${o}</option>`)}</select></label>`;
  // `extend` : saisie libre, la liste réglée n'est qu'une suggestion
  if (f.extend) return html`<label>${f.label}${f.required ? ' *' : ''}<input class="input" name="${f.key}" value="${value}" list="dl-${f.key}" placeholder="${f.placeholder ?? ''}" maxlength="60" ${common}>
    <datalist id="dl-${f.key}">${state.settings[f.settings].map(o => html`<option value="${o}">`)}</datalist></label>`;
  // `link` : numéro d'un dossier, résumé dessous une fois le dossier enregistré
  if (f.link) return html`<label>${f.label}${f.required ? ' *' : ''}<input class="input mono" name="${f.key}" value="${value}" placeholder="${f.placeholder ?? ''}" ${common}>
    <small class="muted" data-link="${f.key}"></small></label>`;
  return html`<label>${f.label}${f.required ? ' *' : ''}<input class="input" type="${f.type || 'text'}" name="${f.key}" value="${value}" placeholder="${f.placeholder ?? ''}" ${common}></label>`;
};

// defaults : valeurs d'un nouveau dossier (champs et agent_id), ex. formation attribuée depuis le suivi des rookies.
// onSaved(dossier enregistré) ; rien après une suppression.
export async function openRecordForm(kindName, rec, onSaved, defaults = {}) {
  const kind = ALL_KINDS[kindName];
  const sup = canManage(kind);
  const own = !rec || rec.agent_id === state.user.id;
  // Demande d'une autre division (`request`) : modifiable par son auteur tant qu'elle attend
  const request = !sup && kind.request;
  const editable = !rec || sup || (kind.create === 'self' && own && rec.statut === initialStatut(kind)) || (request && own && rec.statut === request.statut);
  const data = rec?.data ?? defaults;
  // Listes `ref` : les dossiers de l'autre type, nommés par leur premier champ (ex. titre du plan d'assaut)
  const refs = {};
  for (const ref of new Set(kind.fields.flatMap(f => [f.ref, ...(f.columns ?? []).map(c => c.ref)]).filter(Boolean))) {
    const key = ALL_KINDS[ref].fields[0].key;
    refs[ref] = (await api(`/service/${ref}?limit=2000`)).map(r => r.data[key]).filter(Boolean);
  }
  const dialog = openModal(rec ? `${kind.titre} · ${rec.data.numero ?? fullName(agentOf(rec))}` : request ? request.titre : kind.nouveau, html`
    <form class="form-grid" data-form>
      ${kind.fields.some(f => f.columns?.some(c => c.list)) ? html`<datalist id="record-users">${state.users.filter(u => u.actif).map(u => html`<option value="${u.matricule}">${agentLabel(u)}</option>`)}</datalist>` : ''}
      ${sup && editable
        ? html`<label class="span-2">${kind.agent ?? 'Agent concerné'} *<select class="input" name="agent_id" required><option value="">— Choisir un agent —</option>${[...state.users].filter(u => u.actif || u.id === rec?.agent_id).sort((a, b) => a.matricule.localeCompare(b.matricule)).map(u => html`<option value="${u.id}" ${u.id === (rec?.agent_id ?? defaults.agent_id ?? (kind.create === 'self' ? state.user.id : null)) ? 'selected' : ''}>${agentLabel(u)}</option>`)}</select></label>`
        : html`<p class="span-2">${(request ? 'Demandeur' : kind.agent) ?? 'Agent'} : <strong>${rec ? agentLabel(agentOf(rec)) : agentLabel(state.user)}</strong></p>`}
      ${kind.fields.filter(f => !f.sup || sup || data[f.key]).map(f => fieldInput(f, data[f.key] ?? '', editable && (!f.sup || sup) && !(f.fixed && rec), refs))}
      ${sup && editable ? html`<label>Statut<select class="input" name="statut">${Object.entries(kind.statuts).map(([k, [l]]) => html`<option value="${k}" ${k === (rec?.statut ?? initialStatut(kind)) ? 'selected' : ''}>${l}</option>`)}</select></label>`
        : rec ? html`<p>Statut : ${statutBadge(kind.statuts[rec.statut])}</p>` : ''}
      ${rec ? html`<p class="span-2 muted small">Créé le ${fmtDateTime(rec.created_at)} par 『${rec.auteur_matricule ?? '—'}』 · modifié le ${fmtDateTime(rec.updated_at)}</p>` : ''}
      <div class="span-2 form-actions">
        ${rec && editable ? html`<button type="button" class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>` : ''}
        ${editable ? html`<button class="btn btn-primary">Enregistrer</button>` : html`<button type="button" class="btn" data-close>Fermer</button>`}
      </div>
    </form>`, { wide: true });

  // Champs `photos` : modifiables avec le composant photo, sinon simples vignettes
  const photos = {};
  for (const f of kind.fields.filter(x => x.type === 'photos')) {
    photos[f.key] = { ...data[f.key] };
    const slots = numberedSlots(f.key, 'Image');
    const el = $(`[data-photos="${f.key}"]`, dialog);
    if (editable) mountPhotos(el, photos[f.key], () => {}, [{ titre: f.label, slots, extra: true }]);
    else mount(el, html`<h4>${f.label}</h4><div class="photo-grid">${slots.filter(([k]) => photos[f.key][k]).map(([k, l]) => html`
      <a href="${photos[f.key][k]}" target="_blank" rel="noopener"><img class="photo-thumb" src="${photos[f.key][k]}" alt="${l}" loading="lazy"></a>`)}</div>`);
  }

  // Champs `sketch` : aperçu ; un clic ouvre le croquis partagé en temps réel, qui s'enregistre seul
  // (il a besoin d'un dossier déjà enregistré, et ne passe pas par « Enregistrer »)
  for (const f of kind.fields.filter(x => x.type === 'sketch')) {
    let sketch = data[f.key] ?? { fond: '', objets: [] };
    const el = $(`[data-sketch="${f.key}"]`, dialog);
    const show = () => mount(el, html`${sketchSvg(sketch, f.units)}
      ${!editable ? '' : rec ? html`<button type="button" class="btn btn-primary sketch-open">${icon('edit')} Ouvrir le croquis partagé</button>`
        : html`<p class="muted small">Enregistrez d'abord le plan : le croquis s'ouvrira ensuite, partagé en direct.</p>`}`);
    if (editable && rec) el.addEventListener('click', () => openSketchEditor({
      url: `/service/${kindName}/${rec.id}/live/${f.key}`, units: f.units,
      onClose: latest => { sketch = latest; show(); },
    }));
    show();
  }

  const link = kind.fields.find(f => f.link && data[f.key]);
  if (rec && link) api(`/service/${kindName}/${rec.id}`).then(({ liens }) => {
    if (liens.dossier) mount($(`[data-link="${link.key}"]`, dialog), linkedLabel(liens.dossier));
  }).catch(() => {});

  // Lignes des champs `rows` ; une nouvelle ligne de journal prend l'heure courante
  dialog.addEventListener('click', e => {
    const add = e.target.closest('[data-row-add]');
    if (add) {
      const f = kind.fields.find(x => x.key === add.dataset.rowAdd);
      const row = Object.fromEntries(f.columns.filter(c => c.type === 'time').map(c => [c.key, nowTime()]));
      $(`[data-rows="${f.key}"] tbody`, dialog).insertAdjacentHTML('beforeend', String(rowHtml(f, row, true, refs)));
    }
    e.target.closest('[data-row-rm]')?.closest('tr').remove();
  });

  $('[data-form]', dialog).addEventListener('submit', e => {
    e.preventDefault();
    const body = { ...formValues(e.target), ...photos };
    for (const t of $$('[data-rows]', dialog)) {
      body[t.dataset.rows] = $$('tbody tr', t).map(tr => Object.fromEntries($$('[data-col]', tr).map(i => [i.dataset.col, i.value.trim()])));
    }
    attempt(async () => {
      const saved = await api(rec ? `/service/${kindName}/${rec.id}` : `/service/${kindName}`, { method: rec ? 'PUT' : 'POST', body });
      toast(saved.data.numero && !rec ? `Dossier ${saved.data.numero} ouvert` : 'Enregistré');
      dialog.close();
      onSaved(saved);
    }, e.submitter);
  });
  $('[data-delete]', dialog)?.addEventListener('click', e => {
    if (!confirm('Supprimer définitivement cet élément ?')) return;
    attempt(async () => {
      await api(`/service/${kindName}/${rec.id}`, { method: 'DELETE' });
      toast('Supprimé');
      dialog.close();
      onSaved();
    }, e.target);
  });
}

// Résumé d'une ligne : les premiers champs visibles hors date principale
const summary = (kind, rec) => kind.fields.filter(f => f.key && !f.sup && f.key !== kind.dateKey && !['textarea', 'rows', 'photos', 'sketch'].includes(f.type)).slice(0, 3)
  .map(f => rec.data[f.key] && [f.prefix, f.type === 'date' ? fmtDate(rec.data[f.key]) : rec.data[f.key]].filter(Boolean).join(' '))
  .filter(Boolean).join(' · ');

export async function renderRecords(root, kindName) {
  const kind = ALL_KINDS[kindName];
  const sup = canManage(kind);
  const canCreate = kind.create === 'self' || sup;
  const seesAll = kind.view === 'all' || sup;
  mount(root, html`
    <div class="card-head">
      <p class="muted">${kind.aide}</p>
      ${canCreate ? html`<button class="btn btn-primary" data-new>${icon('plus')} ${kind.nouveau}</button>` : ''}
    </div>
    <div class="toolbar">
      <select class="input" data-statut><option value="">Tous les statuts</option>${Object.entries(kind.statuts).map(([k, [l]]) => html`<option value="${k}" >${l}</option>`)}</select>
      ${seesAll ? html`<select class="input" data-agent><option value="">Tous les agents</option>${state.users.map(u => html`<option value="${u.id}">${agentLabel(u)}</option>`)}</select>` : html`<span class="muted small">Seuls vos propres éléments sont affichés.</span>`}
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  let limit = PAGE;
  const load = async () => {
    const qs = new URLSearchParams({ statut: $('[data-statut]', root).value, agent_id: $('[data-agent]', root)?.value ?? '', limit });
    list = await api(`/service/${kindName}?${qs}`);
    mount($('[data-results]', root), list.length ? html`<table class="table table-click">
      <thead><tr><th>${kind.agent ?? 'Agent'}</th><th>${kind.fields.find(f => f.key === kind.dateKey)?.label ?? 'Date'}</th><th>Détails</th><th>Statut</th><th>Par</th></tr></thead>
      <tbody>${list.map(rec => html`<tr data-id="${rec.id}">
        <td><a href="#/agents/${rec.agent_id}">${agentLabel(agentOf(rec))}</a></td>
        <td class="nowrap">${fmtDate(rec.date)}</td>
        <td>${summary(kind, rec) || '—'}</td>
        <td>${statutBadge(kind.statuts[rec.statut])}</td>
        <td class="mono">『${rec.auteur_matricule ?? '—'}』</td></tr>`)}</tbody></table>${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucun élément.</p>`);
  };
  const reload = () => attempt(load);
  for (const el of $$('[data-statut], [data-agent]', root)) el.addEventListener('change', () => { limit = PAGE; reload(); });
  $('[data-new]', root)?.addEventListener('click', e => attempt(() => openRecordForm(kindName, null, reload), e.currentTarget));
  root.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    if (e.target.closest('[data-more]')) { limit += PAGE; reload(); return; }
    const id = Number(e.target.closest('tr[data-id]')?.dataset.id);
    if (id) attempt(() => openRecordForm(kindName, list.find(rec => rec.id === id), reload));
  });
  await load();
}

// Dossier administratif affiché sur le profil (agent lui-même ou superviseur)
export async function dossierCard(agentId) {
  const dossier = await api(`/service/dossier/${agentId}`);
  return html`
    <section class="card">
      <div class="card-head"><h3>Dossier administratif</h3><small class="muted">Visible par l'agent et les superviseurs</small></div>
      <div class="dossier">${Object.entries(KINDS).map(([k, kind]) => html`
        <div class="dossier-col">
          <h4><a href="#/service/${k}">${kind.titre}</a> <span class="muted">(${dossier[k].length})</span></h4>
          ${dossier[k].length ? html`<ul class="list">${dossier[k].slice(0, 4).map(rec => html`
            <li><span class="grow">${summary(kind, rec) || kind.titre}<small class="muted">${fmtDate(rec.date)}</small></span>${statutBadge(kind.statuts[rec.statut])}</li>`)}</ul>`
            : html`<p class="muted small">Aucun élément.</p>`}
        </div>`)}</div>
    </section>`;
}

