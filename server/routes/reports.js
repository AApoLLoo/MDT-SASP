import { Router } from 'express';
import { db, parseJson, transaction, getDefcon } from '../db.js';
import { hasRole, canJudge, requireJudge } from '../auth.js';
import { cleanAvocatId, blanchirRapports, logAvocatChange } from '../justice.js';
import { fail, str, intParam, optionalId, insertRow, updateRow, nextNumero, localDate, cleanPhotos, listLimit, logAction, checkVersion } from '../util.js';
import { upsertCitizen, useIdentityPhoto } from './citizens.js';
import { sealSeizedObjects } from './evidence.js';
import { notifyMentions } from './mentions.js';
import { compute, formatDollars, MAX_CHARGES, MAJORATION_DEFCON } from '../../public/mdt/js/calc.js';

export const SUSPECT_FIELDS = ['nom', 'prenom', 'date_naissance', 'id_unique', 'empreinte', 'telephone'];
const JSON_DEFAULTS = { suspect: {}, agents_presents: [], objets_illegaux: [], photos: {}, calc_input: {}, calc_input_police: null };
const MAJORATIONS = [1, 1.5, 2, 3];

const codeStmt = db.prepare('SELECT * FROM penal_code WHERE id = ?');
const getCode = id => codeStmt.get(id);

function loadReport(id, user) {
  const rep = db.prepare(`
    SELECT a.*, u.matricule AS redacteur_matricule, u.nom AS redacteur_nom, u.prenom AS redacteur_prenom, u.grade AS redacteur_grade
    FROM arrest_reports a JOIN users u ON u.id = a.redacteur_id WHERE a.id = ?`).get(id);
  if (!rep) fail(404, 'Rapport introuvable');
  for (const [k, def] of Object.entries(JSON_DEFAULTS)) rep[k] = parseJson(rep[k], def);
  // Un avocat ne lit que les dossiers où son compte est inscrit
  if (user.role === 'avocat' && rep.avocat_id !== user.id) fail(403, "Vous n'êtes pas l'avocat inscrit sur ce dossier");
  // Une condamnation blanchie n'existe plus pour la police ; la justice la consulte encore
  if (rep.blanchi_at && !canJudge(user)) fail(404, 'Rapport introuvable');
  rep.calc_result = parseJson(rep.calc_result, null);
  rep.calc_result_police = parseJson(rep.calc_result_police, null);
  rep.evidence = db.prepare('SELECT id, numero, description, statut FROM evidence WHERE report_id = ? ORDER BY id').all(id);
  rep.avocat = rep.avocat_id ? db.prepare('SELECT id, matricule, nom, prenom FROM users WHERE id = ?').get(rep.avocat_id) ?? null : null;
  rep.juge = rep.juge_id ? db.prepare('SELECT matricule, nom, prenom, grade FROM users WHERE id = ?').get(rep.juge_id) ?? null : null;
  rep.can_edit = canEdit(user, rep);
  rep.can_judge = canJudge(user);
  return rep;
}

// Seul un brouillon se modifie, par son rédacteur ou un superviseur ; ensuite le dossier appartient à la justice
const canEdit = (user, rep) => rep.statut === 'brouillon' && (rep.redacteur_id === user.id || hasRole(user, 'superviseur'));

// Contrôles communs au dépôt et à la finalisation ; renvoie le calcul à jour
function checkReady(rep) {
  if (!rep.citizen_id) fail(400, 'Renseignez le suspect avant de déposer le rapport');
  const result = compute(rep.calc_input, getCode);
  if (!result.nbChefs) fail(400, "Ajoutez au moins un chef d'accusation");
  if (rep.calc_input.retenue === 'max' && !rep.calc_input.approbateur) fail(400, "La retenue MAX nécessite le nom de l'approbateur (état-major, juge ou procureur)");
  return result;
}

const suspectLabel = rep => [rep.suspect.prenom, rep.suspect.nom].filter(Boolean).join(' ');

function cleanCalcInput(input = {}) {
  const maxMajoration = MAJORATION_DEFCON[getDefcon()] ?? 1;
  const majoration = Number(input.majoration);
  const droits = input.droits ?? {};
  return {
    charges: (Array.isArray(input.charges) ? input.charges : []).slice(0, MAX_CHARGES)
      .filter(c => getCode(Number(c?.code_id)))
      .map(c => ({
        code_id: Number(c.code_id),
        quantite: Math.min(Math.max(Number(c.quantite) || 0, 0), 1e8),
        tentative: !!c.tentative, complicite: !!c.complicite, attenuation: !!c.attenuation,
      })),
    retenue: input.retenue === 'max' ? 'max' : 'nominal',
    approbateur: str(input.approbateur),
    viceProcedure: !!input.viceProcedure,
    mineur: !!input.mineur,
    majoration: MAJORATIONS.includes(majoration) ? Math.min(majoration, maxMajoration) : 1,
    conversionGav: !!input.conversionGav,
    cautionDemandee: !!input.cautionDemandee,
    droits: {
      avocat: !!droits.avocat, avocatNom: str(droits.avocatNom),
      nourriture: !!droits.nourriture, soins: !!droits.soins,
      appel: !!droits.appel, appelNom: str(droits.appelNom),
      procureurNom: str(droits.procureurNom),
    },
  };
}

// Crée un brouillon de rapport, éventuellement pré-rempli (suspect, chefs, faits)
export function createReport(user, { citizenId = null, calcInput = {}, faits = '' } = {}) {
  let suspect = {};
  if (citizenId) {
    const c = db.prepare('SELECT * FROM citizens WHERE id = ?').get(citizenId);
    if (!c) fail(404, 'Citoyen introuvable');
    suspect = { id: c.id, ...Object.fromEntries(SUSPECT_FIELDS.map(k => [k, c[k] ?? ''])) };
  }
  const input = cleanCalcInput(calcInput);
  const numero = nextNumero('arrest_reports', 'SASP');
  const id = insertRow('arrest_reports', {
    numero,
    citizen_id: citizenId,
    suspect: JSON.stringify(suspect),
    date_rapport: localDate(),
    date_faits: localDate(),
    redacteur_id: user.id,
    miranda_par: user.matricule,
    faits: str(faits),
    calc_input: JSON.stringify(input),
    calc_result: JSON.stringify(compute(input, getCode)),
  });
  logAction(user, "Rapport d'arrestation créé", 'report', id, numero, suspect.nom ? [suspect.prenom, suspect.nom].filter(Boolean).join(' ') : '');
  return id;
}

const r = Router();

r.get('/', (req, res) => {
  const statut = ['brouillon', 'en_attente', 'finalise'].includes(req.query.statut) ? req.query.statut : null;
  const mine = req.query.mine === '1' ? req.user.id : null;
  const q = `%${str(req.query.q)}%`;
  res.json(db.prepare(`
    SELECT a.id, a.numero, a.statut, a.date_faits, a.citizen_id, a.redacteur_id, a.updated_at, a.depose_at,
      json_extract(a.suspect, '$.nom') AS suspect_nom, json_extract(a.suspect, '$.prenom') AS suspect_prenom,
      json_extract(a.calc_result, '$.amende') AS amende, json_extract(a.calc_result, '$.gavMinutes') AS gav_minutes,
      json_extract(a.calc_result, '$.nbChefs') AS nb_chefs,
      u.matricule AS redacteur_matricule, u.nom AS redacteur_nom, u.prenom AS redacteur_prenom
    FROM arrest_reports a JOIN users u ON u.id = a.redacteur_id
    WHERE (? IS NULL OR a.statut = ?) AND (? IS NULL OR a.redacteur_id = ?)
      AND (a.numero LIKE ? OR IFNULL(json_extract(a.suspect, '$.nom') || ' ' || json_extract(a.suspect, '$.prenom'), '') LIKE ?)
      AND (? OR a.blanchi_at IS NULL)
    ORDER BY ${statut === 'en_attente' ? 'a.depose_at ASC' : 'a.updated_at DESC'} LIMIT ?`)
    .all(statut, statut, mine, mine, q, q, canJudge(req.user) ? 1 : 0, listLimit(req)));
});

r.get('/:id', (req, res) => res.json(loadReport(intParam(req.params.id), req.user)));

r.post('/', (req, res) => {
  const id = createReport(req.user, { citizenId: optionalId(req.body?.citizen_id), calcInput: req.body?.calc_input });
  res.status(201).json({ id });
});

r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (!rep.can_edit) fail(403, 'Ce rapport ne peut plus être modifié');
  const b = req.body ?? {};
  checkVersion(rep.updated_at, b.updated_at);
  const fields = {};
  for (const k of ['date_rapport', 'date_faits', 'miranda_heure', 'miranda_par', 'faits']) if (b[k] !== undefined) fields[k] = str(b[k]);
  if (b.agents_presents !== undefined) {
    fields.agents_presents = JSON.stringify([...new Set((Array.isArray(b.agents_presents) ? b.agents_presents : []).map(str).filter(Boolean))].slice(0, 20));
  }
  if (b.objets_illegaux !== undefined) {
    const objets = (Array.isArray(b.objets_illegaux) ? b.objets_illegaux : [])
      .map(o => ({ description: str(o?.description), quantite: str(o?.quantite) })).filter(o => o.description).slice(0, 50);
    fields.objets_illegaux = JSON.stringify(objets);
  }
  if (b.photos !== undefined) fields.photos = JSON.stringify(cleanPhotos(b.photos));
  if (b.avocat_id !== undefined) fields.avocat_id = cleanAvocatId(b.avocat_id);
  if (b.calc_input !== undefined) {
    const calcInput = cleanCalcInput(b.calc_input);
    fields.calc_input = JSON.stringify(calcInput);
    fields.calc_result = JSON.stringify(compute(calcInput, getCode));
  }
  transaction(() => {
    if (b.suspect !== undefined) {
      const { citizen_id, snapshot } = upsertCitizen(b.suspect ?? {}, SUSPECT_FIELDS, req.user, `Depuis le rapport ${rep.numero}`);
      fields.citizen_id = citizen_id;
      fields.suspect = JSON.stringify(snapshot);
    }
    updateRow('arrest_reports', id, fields);
    if ('avocat_id' in fields) logAvocatChange(req.user, 'report', id, rep.numero, [rep.avocat_id].filter(Boolean), [fields.avocat_id].filter(Boolean));
    const photos = 'photos' in fields ? JSON.parse(fields.photos) : rep.photos;
    useIdentityPhoto(req.user, 'citizen_id' in fields ? fields.citizen_id : rep.citizen_id, photos.carte_identite, `Depuis le rapport ${rep.numero}`);
  });
  if ('faits' in fields) notifyMentions(req.user, 'report', id, rep.numero, fields.faits);
  res.json(loadReport(id, req.user));
});

// Dépôt pour jugement : le rapport n'est plus modifiable par la police, le calcul proposé est conservé
r.post('/:id/submit', (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (!rep.can_edit) fail(403, 'Droits insuffisants');
  const result = JSON.stringify(checkReady(rep));
  db.prepare(`UPDATE arrest_reports SET statut = 'en_attente', calc_result = ?, calc_input_police = calc_input, calc_result_police = ?,
    depose_at = datetime('now'), renvoi_motif = '', updated_at = datetime('now') WHERE id = ?`).run(result, result, id);
  const { nbChefs, amende } = JSON.parse(result);
  logAction(req.user, 'Rapport déposé pour jugement', 'report', id, rep.numero,
    [suspectLabel(rep), `${nbChefs} chef(s)`, `amende ${formatDollars(amende)}`].filter(Boolean).join(' · '));
  res.json(loadReport(id, req.user));
});

// Le magistrat ajuste le calcul et l'avocat d'un rapport en attente ; faits, photos et suspect restent ceux de la police
r.put('/:id/jugement', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (rep.statut !== 'en_attente') fail(400, "Ce rapport n'est pas en attente de jugement");
  const b = req.body ?? {};
  const fields = {};
  if (b.avocat_id !== undefined) fields.avocat_id = cleanAvocatId(b.avocat_id);
  if (b.calc_input !== undefined) {
    const calcInput = cleanCalcInput(b.calc_input);
    fields.calc_input = JSON.stringify(calcInput);
    fields.calc_result = JSON.stringify(compute(calcInput, getCode));
  }
  transaction(() => {
    updateRow('arrest_reports', id, fields);
    if ('avocat_id' in fields) logAvocatChange(req.user, 'report', id, rep.numero, [rep.avocat_id].filter(Boolean), [fields.avocat_id].filter(Boolean));
    // Journalisé seulement si les charges changent (la page de jugement enregistre aussi avant de finaliser)
    if (fields.calc_input && fields.calc_input !== JSON.stringify(rep.calc_input)) {
      const before = rep.calc_result?.amende ?? 0;
      const after = JSON.parse(fields.calc_result).amende;
      logAction(req.user, 'Jugement modifié', 'report', id, rep.numero, after !== before ? `Amende : ${formatDollars(before)} → ${formatDollars(after)}` : "Chefs d'accusation modifiés");
    }
  });
  res.json(loadReport(id, req.user));
});

// Jugement rendu : versé au casier, mandats clos, objets saisis mis sous scellés
r.post('/:id/finalize', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (rep.statut !== 'en_attente') fail(400, 'Seul un rapport en attente de jugement peut être finalisé');
  const result = checkReady(rep);
  const closeIds = (Array.isArray(req.body?.close_warrants) ? req.body.close_warrants : []).map(Number).filter(Number.isInteger);
  transaction(() => {
    db.prepare(`UPDATE arrest_reports SET statut = 'finalise', calc_result = ?, juge_id = ?, finalized_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(result), req.user.id, id);
    const close = db.prepare(`UPDATE warrants SET statut = 'clos', closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now')
      WHERE id = ? AND citizen_id = ? AND statut = 'actif'`);
    const closed = closeIds.reduce((n, wid) => n + close.run(req.user.id, wid, rep.citizen_id).changes, 0);
    sealSeizedObjects(req.user, rep);
    logAction(req.user, "Rapport d'arrestation finalisé", 'report', id, rep.numero, [
      suspectLabel(rep), `${result.nbChefs} chef(s)`, `amende ${formatDollars(result.amende)}`,
      closed && `${closed} mandat(s) clos`,
    ].filter(Boolean).join(' · '));
  });
  res.json(loadReport(id, req.user));
});

// Dossier incomplet : retour à l'agent avec un motif
r.post('/:id/send-back', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const motif = str(req.body?.motif);
  if (!motif) fail(400, 'Indiquez le motif du renvoi');
  const rep = loadReport(id, req.user);
  if (rep.statut !== 'en_attente') fail(400, "Ce rapport n'est pas en attente de jugement");
  db.prepare(`UPDATE arrest_reports SET statut = 'brouillon', renvoi_motif = ?, depose_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(motif, id);
  logAction(req.user, "Rapport renvoyé à l'agent", 'report', id, rep.numero, motif);
  res.json(loadReport(id, req.user));
});

// Réouverture d'un rapport jugé : retiré du casier, de nouveau en attente de jugement
r.post('/:id/reopen', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const rep = db.prepare('SELECT numero, blanchi_at FROM arrest_reports WHERE id = ?').get(id);
  // Un rapport blanchi rouvert resterait blanchi, et renvoyé à l'agent il lui deviendrait introuvable
  if (rep?.blanchi_at) fail(400, "Annulez d'abord le blanchiment de ce rapport");
  const { changes } = db.prepare(`UPDATE arrest_reports SET statut = 'en_attente', finalized_at = NULL, juge_id = NULL, updated_at = datetime('now')
    WHERE id = ? AND statut = 'finalise'`).run(id);
  if (!changes) fail(404, 'Rapport introuvable ou non finalisé');
  logAction(req.user, "Rapport d'arrestation rouvert", 'report', id, rep.numero, 'Retiré du casier, de nouveau en attente de jugement');
  res.json({ ok: true });
});

r.post('/:id/blanchir', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (rep.statut !== 'finalise' || rep.blanchi_at) fail(400, 'Seule une condamnation finalisée et non blanchie peut être blanchie');
  blanchirRapports(req.user, [rep], req.body?.motif);
  res.json(loadReport(id, req.user));
});

r.post('/:id/unblanchir', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const motif = str(req.body?.motif);
  if (!motif) fail(400, "Indiquez le motif de l'annulation");
  const rep = loadReport(id, req.user);
  if (!rep.blanchi_at) fail(400, "Ce rapport n'est pas blanchi");
  db.prepare(`UPDATE arrest_reports SET blanchi_at = NULL, blanchi_par = NULL, blanchi_motif = '' WHERE id = ?`).run(id);
  logAction(req.user, 'Blanchiment annulé', 'report', id, rep.numero, motif);
  res.json(loadReport(id, req.user));
});

// Un brouillon se supprime par son rédacteur ou un superviseur ; un rapport déposé ou jugé, par un administrateur seulement
const STATUT_LABELS = { brouillon: 'Brouillon', en_attente: 'En attente de jugement', finalise: 'Rapport finalisé' };
r.delete('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (!(rep.statut === 'brouillon' ? rep.can_edit : hasRole(req.user, 'admin'))) fail(403, 'Droits insuffisants');
  db.prepare('DELETE FROM arrest_reports WHERE id = ?').run(id);
  logAction(req.user, "Rapport d'arrestation supprimé", 'report', id, rep.numero, [STATUT_LABELS[rep.statut], suspectLabel(rep)].filter(Boolean).join(' · '));
  res.json({ ok: true });
});

export default r;
