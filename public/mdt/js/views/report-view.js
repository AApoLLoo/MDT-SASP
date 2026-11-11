import { html, mount, $, attempt, toast, fullName, agentLabel, fmtDate, fmtDateTime } from '../dom.js';
import { api, loadUsers, userByMatricule, isAvocat, isJustice } from '../api.js';
import { rerender } from '../router.js';
import { icon } from '../icons.js';
import { formatDollars, formatDuree } from '../calc.js';
import { PHOTO_GROUPS } from '../components/photos.js';
import { statutBadge } from './reports.js';
import { openDiscordModal, joinLines, absoluteUrl } from '../components/discord.js';
import { copyForDocs } from '../components/gdocs.js';

const fmtCoef = n => `×${String(n).replace('.', ',')}`;

export function chargeLabel(l) {
  const opts = [l.quantite !== 1 && `×${l.quantite}`, l.tentative && 'tentative', l.complicite && 'complicité', l.attenuation && 'atténuation'].filter(Boolean);
  return l.infraction + (opts.length ? ` (${opts.join(', ')})` : '');
}

export const agentPresent = m => {
  const u = userByMatricule(m);
  return u ? `${u.grade ? u.grade + ' ' : ''}${fullName(u)} 『${m}』` : `『${m}』`;
};

const suspectName = s => [s.nom?.toUpperCase(), s.prenom].filter(Boolean).join(' ') || '—';

function cautionLabel(input, r) {
  if (!r.caution.possible) return r.caution.raison;
  return input.cautionDemandee ? `${formatDollars(r.caution.montant)} (coefficient ${fmtCoef(r.caution.coefficient)})` : 'Non demandée';
}

function optionsSummary(input, r) {
  const d = input.droits ?? {};
  const droits = [
    d.avocat && `avocat${d.avocatNom ? ` (${d.avocatNom})` : ''}`,
    d.nourriture && 'nourriture',
    d.soins && 'soins',
    d.appel && `appel${d.appelNom ? ` (${d.appelNom})` : ''}`,
    d.avocat && d.appel && d.procureurNom && `procureur : ${d.procureurNom}`,
  ].filter(Boolean);
  return [
    `Retenue : ${input.retenue === 'max' ? `MAX ×2 (approuvée par ${input.approbateur || '—'})` : 'Nominale'}`,
    input.viceProcedure && 'Vice de procédure : amende et peine annulées',
    input.mineur && 'Prévenu mineur : amende et peine divisées par 2',
    input.majoration > 1 && `Majoration Defcon des amendes : ${fmtCoef(input.majoration)}`,
    r.conversion.appliquee && `Conversion : ${formatDollars(r.conversion.excedent)} convertis en ${formatDuree(r.conversion.minutesEnPlus)} de GAV`,
    `Caution : ${cautionLabel(input, r)}`,
    `Droits exercés : ${droits.length ? droits.join(', ') : 'aucun'}`,
  ].filter(Boolean);
}



export function discordText(rep) {
  const r = rep.calc_result;
  const s = rep.suspect;
  const redacteur = { matricule: rep.redacteur_matricule, nom: rep.redacteur_nom, prenom: rep.redacteur_prenom, grade: rep.redacteur_grade };
  const photos = PHOTO_GROUPS.flatMap(g => g.slots.filter(([k]) => rep.photos[k]).map(([k, label]) => `${g.titre} – ${label} : ${absoluteUrl(rep.photos[k])}`));
  return joinLines([
    `## 🚔 Rapport d'arrestation — ${rep.numero}${rep.statut === 'brouillon' ? ' (brouillon)' : ''}`,
    `**Fait le :** ${fmtDate(rep.date_rapport)} · **Date des faits :** ${fmtDate(rep.date_faits)}`,
    `**Rédacteur :** ${agentLabel(redacteur)}`,
    `**Agents présents :** ${rep.agents_presents.map(agentPresent).join(', ') || '—'}`,
    '',
    '### 👤 Suspect',
    `> **NOM Prénom :** ${suspectName(s)}`,
    `> **Date de naissance :** ${fmtDate(s.date_naissance)}`,
    `> **Empreinte :** ${s.empreinte || '—'}`,
    `> **N° sécu (ID unique) :** ${s.id_unique || '—'}`,
    `> **Téléphone :** ${s.telephone || '—'}`,
    `> **Droits Miranda :** ${rep.miranda_heure ? `lus à ${rep.miranda_heure} par 『${rep.miranda_par || '—'}』` : 'non lus'}`,
    '',
    `### ⚖️ Chef(s) d'accusation (${r.nbChefs})`,
    ...r.lignes.map(l => `- ${chargeLabel(l)} — *${l.categorie}* — ${formatDollars(l.amende)} · ${formatDuree(l.peine)}`),
    '',
    `**Amende : ${formatDollars(r.amende)}** · **GAV : ${formatDuree(r.gavMinutes)}**`,
    ...optionsSummary(rep.calc_input, r).map(o => `• ${o}`),
    r.sanctions.length ? `**Sanctions / conséquences :** ${[...new Set(r.sanctions)].join(' · ')}` : '',
    r.alerteProc ? '⚠️ **Seuil atteint : un Procureur / Juge doit être appelé.**' : '',
    '',
    '### 🔫 Objet(s) illégal(aux) saisi(s)',
    ...(rep.objets_illegaux.length ? rep.objets_illegaux.map(o => `- ${o.description}${o.quantite ? ` ×${o.quantite}` : ''}`) : ['—']),
    rep.evidence.length ? `**Scellé(s) :** ${rep.evidence.map(e => e.numero).join(', ')}` : '',
    '',
    '### 📝 Faits',
    rep.faits || '—',
    ...(photos.length ? ['', '### 📷 Photos', ...photos] : []),
  ]);
}

// Écart entre le calcul déposé par la police et le calcul jugé (null si identiques)
function policeDiff(rep) {
  const p = rep.calc_result_police;
  const j = rep.calc_result;
  if (!p || !j) return null;
  const chefs = r => r.lignes.map(chargeLabel).join(' · ');
  return p.amende !== j.amende || p.gavMinutes !== j.gavMinutes || chefs(p) !== chefs(j) ? p : null;
}

export async function render(main, [id]) {
  // L'annuaire des agents est réservé à la police et aux magistrats : un avocat voit les agents par matricule
  const [rep] = await Promise.all([api(`/reports/${id}`), isAvocat() ? null : loadUsers()]);
  const police = policeDiff(rep);
  const juge = rep.juge && `${rep.juge.grade ? rep.juge.grade + ' ' : ''}${fullName(rep.juge)}`;
  const r = rep.calc_result;
  const s = rep.suspect;
  const input = rep.calc_input;
  const groups = PHOTO_GROUPS.map(g => ({ ...g, slots: g.slots.filter(([k]) => rep.photos[k]) })).filter(g => g.slots.length);

  mount(main, html`
    <div class="report-toolbar no-print">
      <a href="#/${isAvocat() ? '' : 'rapports'}" class="back">${icon('back')} ${isAvocat() ? 'Mes dossiers' : 'Rapports'}</a>
      <div class="actions">
        ${statutBadge(rep.statut)}
        ${rep.can_edit && !isJustice() && html`<a class="btn" href="#/rapports/${rep.id}/modifier">${icon('edit')} Modifier</a>`}
        ${rep.statut === 'en_attente' && rep.can_judge && html`<a class="btn btn-primary" href="#/rapports/${rep.id}/juger">${icon('check')} Juger</a>`}
        ${rep.statut === 'finalise' && rep.can_judge && html`<button class="btn" data-reopen>Rouvrir le jugement</button>`}
        <button class="btn" data-discord>${icon('copy')} Copier pour Discord</button>
        <button class="btn" data-gdocs>${icon('copy')} Google Docs</button>
        <button class="btn btn-primary" data-print>${icon('printer')} Imprimer / PDF</button>
      </div>
    </div>
    ${rep.statut === 'brouillon' ? html`<div class="alert alert-warn no-print">Brouillon : ce rapport n'est pas encore déposé pour jugement ni versé au casier.
      ${rep.renvoi_motif ? html`<small>Renvoyé par la justice : ${rep.renvoi_motif}</small>` : ''}</div>` : ''}
    ${rep.statut === 'en_attente' ? html`<div class="alert alert-info no-print">En attente de jugement depuis le ${fmtDateTime(rep.depose_at)} : le rapport n'est pas encore versé au casier.</div>` : ''}
    ${rep.blanchi_at ? html`<div class="alert alert-warn no-print"><strong>Condamnation blanchie le ${fmtDateTime(rep.blanchi_at)}</strong><small>${rep.blanchi_motif}</small></div>` : ''}

    <article class="paper">
      <img class="paper-banner" src="img/sasp-banner.png" alt="San Andreas State Police">
      <h1 class="paper-title">Rapport d'arrestation</h1>
      <p class="paper-sub">N° ${rep.numero}${{ brouillon: ' · BROUILLON', en_attente: ' · EN ATTENTE DE JUGEMENT' }[rep.statut] ?? ''}</p>

      <table class="paper-table">
        <colgroup><col class="c1"><col class="c2"><col></colgroup>
        <tr>
          <td colspan="2" class="seal-cell"><img src="img/sasp-seal.png" alt=""></td>
          <td><strong>Fait le :</strong> ${fmtDate(rep.date_rapport)}<br><strong>Date des faits :</strong> ${fmtDate(rep.date_faits)}</td>
        </tr>
        <tr>
          <th>Grade :</th><td>${rep.redacteur_grade || '—'}</td>
          <td rowspan="4" class="suspect-cell">
            <h3>Information du suspect</h3>
            <p><strong>NOM Prénom :</strong> ${suspectName(s)}</p>
            <p><strong>Date de naissance :</strong> ${fmtDate(s.date_naissance)}</p>
            <p><strong>Empreinte :</strong> ${s.empreinte || '—'}</p>
            <p><strong>N° sécu (ID unique) :</strong> ${s.id_unique || '—'}</p>
            <p><strong>Numéro de téléphone :</strong> ${s.telephone || '—'}</p>
            ${rep.avocat ? html`<p><strong>Avocat inscrit :</strong> ${fullName(rep.avocat)}</p>` : ''}
            <p><strong>Droit Miranda :</strong> ${rep.miranda_heure ? `lu à ${rep.miranda_heure} par 『${rep.miranda_par || '—'}』` : 'non lu'}</p>
            <p><strong>Objet(s) illégal(aux) :</strong></p>
            <ul class="dash-list">${rep.objets_illegaux.length ? rep.objets_illegaux.map(o => html`<li>${o.description}${o.quantite ? ` ×${o.quantite}` : ''}</li>`) : html`<li>Aucun</li>`}</ul>
            ${rep.evidence.length ? html`<p><strong>Scellé(s) :</strong> ${rep.evidence.map(e => html`<a href="#/preuves?q=${e.numero}" class="mono nowrap">${e.numero}</a> `)}</p>` : ''}
          </td>
        </tr>
        <tr><th>Agent rédacteur (matricule) :</th><td>${fullName({ nom: rep.redacteur_nom, prenom: rep.redacteur_prenom })} 『${rep.redacteur_matricule}』</td></tr>
        <tr><th>Agents présents (matricule) :</th><td>${rep.agents_presents.length ? rep.agents_presents.map(m => html`<span class="nowrap">${agentPresent(m)}</span><br>`) : '—'}</td></tr>
        <tr><th>Chef(s) d'accusation :</th><td><ul class="dash-list">${r.lignes.length ? r.lignes.map(l => html`<li>${chargeLabel(l)}</li>`) : html`<li>Aucun</li>`}</ul></td></tr>
      </table>

      <h2 class="paper-h2">Faits</h2>
      <div class="paper-text">${rep.faits || '—'}</div>

      <h2 class="paper-h2">Photo(s) appuyant le(s) fait(s)</h2>
      ${groups.length ? groups.map(g => html`
        <div class="paper-photo-group">
          <h3>${g.titre} :</h3>
          <div class="paper-photos">${g.slots.map(([k, label]) => html`<figure><img src="${rep.photos[k]}" alt="${label}"><figcaption>${label}</figcaption></figure>`)}</div>
        </div>`) : html`<p class="muted">Aucune photo jointe.</p>`}

      <h2 class="paper-h2">Calculatrice</h2>
      <table class="paper-calc">
        <thead><tr><th>Catégorie</th><th>Chef d'inculpation</th><th>Qté</th><th>Tent.</th><th>Compl.</th><th>Atté.</th><th class="num">Amende</th><th class="num">Peine</th><th>Sanction(s)</th></tr></thead>
        <tbody>${r.lignes.map(l => html`<tr>
          <td>${l.categorie}</td><td>${l.infraction}</td><td class="num">${l.quantite}</td>
          <td>${l.tentative ? 'Oui' : 'Non'}</td><td>${l.complicite ? 'Oui' : 'Non'}</td><td>${l.attenuation ? 'Oui' : 'Non'}</td>
          <td class="num">${formatDollars(l.amende)}</td><td class="num">${formatDuree(l.peine)}</td><td>${l.supplements}</td></tr>`)}</tbody>
      </table>
      <div class="paper-totals">
        <div><span>Amende</span><strong>${formatDollars(r.amende)}</strong></div>
        <div><span>Garde à vue</span><strong>${formatDuree(r.gavMinutes)}</strong><small>${r.gavMinutes} min</small></div>
        <div><span>Caution</span><strong>${!r.caution.possible ? 'Impossible' : input.cautionDemandee ? formatDollars(r.caution.montant) : 'Non demandée'}</strong></div>
      </div>
      <ul class="paper-options">${optionsSummary(input, r).map(o => html`<li>${o}</li>`)}</ul>
      ${r.sanctions.length ? html`<p><strong>Sanctions / conséquences :</strong> ${[...new Set(r.sanctions)].join(' · ')}</p>` : ''}
      ${r.alerteProc ? html`<p class="paper-alert">⚠ Seuil atteint : un Procureur / Juge doit être appelé.</p>` : ''}
      ${police ? html`<p><strong>Calcul proposé par la police :</strong> ${police.lignes.map(chargeLabel).join(' · ') || 'aucun chef'}
        — amende ${formatDollars(police.amende)}, garde à vue ${formatDuree(police.gavMinutes)}</p>` : ''}

      <footer class="paper-foot">
        <span>SAN ANDREAS STATE POLICE · LOS SANTOS</span>
        <span>${rep.numero} · ${rep.statut === 'finalise' ? `jugé le ${fmtDateTime(rep.finalized_at)}${juge ? ` par ${juge}` : ''}` : rep.statut === 'en_attente' ? 'en attente de jugement' : 'brouillon'}</span>
      </footer>
    </article>`);

  $('[data-print]', main).addEventListener('click', () => window.print());
  $('[data-discord]', main).addEventListener('click', () => openDiscordModal(discordText(rep)));
  $('[data-gdocs]', main).addEventListener('click', () => copyForDocs($('.paper', main)));
  $('[data-reopen]', main)?.addEventListener('click', e => {
    if (!confirm("Rouvrir le jugement ? Le rapport sera retiré du casier et repassera en attente de jugement.")) return;
    attempt(async () => {
      await api(`/reports/${rep.id}/reopen`, { method: 'POST' });
      toast('Jugement rouvert');
      rerender();
    }, e.target);
  });
}
