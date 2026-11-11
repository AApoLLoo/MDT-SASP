import { html, mount, $, $$, attempt, toast, fullName, agentLabel, fmtDateTime } from '../dom.js';
import { api, loadPenalCode, loadAvocats } from '../api.js';
import { navigate, setLeaveGuard } from '../router.js';
import { icon } from '../icons.js';
import { formatDollars, formatDuree } from '../calc.js';
import { mountCalculator } from '../components/charges-calculator.js';
import { warrantTypeBadge } from './warrants.js';
import { chargeLabel } from './report-view.js';

// Jugement d'un rapport en attente : le magistrat ajuste les charges et l'avocat, puis finalise ou renvoie à l'agent
export async function render(main, [id]) {
  const [rep, avocats] = await Promise.all([api(`/reports/${id}`), loadAvocats(), loadPenalCode()]);
  if (rep.statut !== 'en_attente' || !rep.can_judge) {
    location.replace(`#/rapports/${id}`);
    return;
  }
  const citizen = rep.citizen_id ? await api(`/citizens/${rep.citizen_id}`) : null;
  const mandats = citizen?.warrants.filter(w => w.statut === 'actif' && w.type !== 'bolo_vehicule') ?? [];
  const police = rep.calc_result_police;
  const redacteur = { matricule: rep.redacteur_matricule, nom: rep.redacteur_nom, prenom: rep.redacteur_prenom, grade: rep.redacteur_grade };
  let dirty = false;
  let ready = false; // la calculatrice signale un changement à son montage

  mount(main, html`
    <div class="page-head">
      <div>
        <a href="#/rapports/${id}" class="back">${icon('back')} Rapport complet</a>
        <h1>Jugement <span class="mono gold">${rep.numero}</span></h1>
        <p class="muted">${fullName(rep.suspect)} · déposé le ${fmtDateTime(rep.depose_at)} par ${agentLabel(redacteur)}</p>
      </div>
    </div>

    ${police ? html`<section class="card">
      <div class="card-head"><h3>Calcul proposé par la police</h3></div>
      <ul class="charges-list">${police.lignes.map(l => html`<li>${chargeLabel(l)} · ${formatDollars(l.amende)} · ${formatDuree(l.peine)}</li>`)}</ul>
      <p class="muted">Amende ${formatDollars(police.amende)} · garde à vue ${formatDuree(police.gavMinutes)}</p>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h3>Chef(s) d'accusation retenus · Calculatrice</h3></div>
      <div data-calc></div>
    </section>

    <section class="card">
      <div class="form-grid">
        <label>Avocat inscrit (accès au dossier)<select class="input" data-avocat>
          <option value="">Aucun</option>
          ${avocats.map(a => html`<option value="${a.id}" ${a.id === rep.avocat_id ? 'selected' : ''}>${fullName(a)} (${a.matricule})</option>`)}
        </select></label>
      </div>
      ${mandats.length ? html`<fieldset class="opt-group"><legend>Clore les mandats exécutés par cette arrestation</legend>
        ${mandats.map(w => html`<label class="check"><input type="checkbox" value="${w.id}" checked data-warrant> ${warrantTypeBadge(w.type)} ${w.motif}</label>`)}</fieldset>` : ''}
    </section>

    <div class="action-bar">
      <span class="save-status" data-status>Enregistré</span>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-send-back>Renvoyer à l'agent</button>
        <button type="button" class="btn" data-save>Enregistrer</button>
        <button type="button" class="btn btn-primary" data-finalize>${icon('check')} Finaliser le jugement</button>
      </div>
    </div>`);

  const status = $('[data-status]', main);
  const markDirty = () => {
    if (!ready) return;
    dirty = true;
    status.textContent = 'Modifications non enregistrées';
    status.classList.add('is-dirty');
  };
  const calc = mountCalculator($('[data-calc]', main), { value: rep.calc_input, onChange: markDirty });
  $('[data-avocat]', main).addEventListener('change', markDirty);
  ready = true;
  setLeaveGuard(silent => !dirty || (!silent && confirm('Le jugement n\'est pas enregistré. Quitter sans enregistrer ?')));

  async function save() {
    await api(`/reports/${id}/jugement`, { method: 'PUT', body: { calc_input: calc.value, avocat_id: $('[data-avocat]', main).value || null } });
    dirty = false;
    status.textContent = 'Enregistré';
    status.classList.remove('is-dirty');
  }

  main.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-save]')) {
      attempt(async () => { await save(); toast('Jugement enregistré'); }, t);
    } else if (t.matches('[data-finalize]')) {
      const r = calc.result();
      if (!r.nbChefs) return toast("Retenez au moins un chef d'accusation, ou renvoyez le rapport à l'agent", 'error');
      if (!confirm(`Finaliser le jugement ? ${r.nbChefs} chef(s), amende ${formatDollars(r.amende)}, garde à vue ${formatDuree(r.gavMinutes)}. Le rapport sera versé au casier.`)) return;
      attempt(async () => {
        await save();
        const close_warrants = $$('input[data-warrant]:checked', main).map(i => Number(i.value));
        await api(`/reports/${id}/finalize`, { method: 'POST', body: { close_warrants } });
        toast('Jugement rendu, rapport versé au casier');
        navigate(`/rapports/${id}`);
      }, t);
    } else if (t.matches('[data-send-back]')) {
      const motif = prompt("Motif du renvoi à l'agent (ce qu'il doit corriger) :");
      if (!motif?.trim()) return;
      attempt(async () => {
        await api(`/reports/${id}/send-back`, { method: 'POST', body: { motif } });
        dirty = false;
        toast("Rapport renvoyé à l'agent");
        navigate(`/rapports/${id}`);
      }, t);
    }
  });
}
