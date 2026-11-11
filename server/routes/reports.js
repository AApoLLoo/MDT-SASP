import { Router } from 'express';
import { db, parseJson, transaction, getDefcon } from '../db.js';
import { hasRole } from '../auth.js';
import { fail, str, intParam, optionalId, insertRow, updateRow, nextNumero, localDate, cleanPhotos, listLimit, logAction } from '../util.js';
import { upsertCitizen } from './citizens.js';
import { sealSeizedObjects } from './evidence.js';
import { compute, formatDollars, MAX_CHARGES, MAJORATION_DEFCON } from '../../public/mdt/js/calc.js';

// Libellés des champs dans l'historique (modification d'un rapport finalisé)
const FIELD_LABELS = {
  date_rapport: 'date du rapport', date_faits: 'date des faits', miranda_heure: 'Miranda', miranda_par: 'Miranda', faits: 'faits',
  agents_presents: 'agents présents', objets_illegaux: 'objets saisis', photos: 'photos', calc_input: "chefs d'accusation", suspect: 'suspect',
};

const SUSPECT_FIELDS = ['nom', 'prenom', 'date_naissance', 'id_unique', 'empreinte', 'telephone'];
const JSON_DEFAULTS = { suspect: {}, agents_presents: [], objets_illegaux: [], photos: {}, calc_input: {} };
const MAJORATIONS = [1, 1.5, 2, 3];

const codeStmt = db.prepare('SELECT * FROM penal_code WHERE id = ?');
const getCode = id => codeStmt.get(id);

function loadReport(id, user) {
  const rep = db.prepare(`
    SELECT a.*, u.matricule AS redacteur_matricule, u.nom AS redacteur_nom, u.prenom AS redacteur_prenom, u.grade AS redacteur_grade
    FROM arrest_reports a JOIN users u ON u.id = a.redacteur_id WHERE a.id = ?`).get(id);
  if (!rep) fail(404, 'Rapport introuvable');
  for (const [k, def] of Object.entries(JSON_DEFAULTS)) rep[k] = parseJson(rep[k], def);
  rep.calc_result = parseJson(rep.calc_result, null);
  rep.evidence = db.prepare('SELECT id, numero, description, statut FROM evidence WHERE report_id = ? ORDER BY id').all(id);
  rep.can_edit = canEdit(user, rep);
  return rep;
}

const canEdit = (user, rep) => hasRole(user, 'superviseur') || (rep.statut === 'brouillon' && rep.redacteur_id === user.id);

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
  const statut = ['brouillon', 'finalise'].includes(req.query.statut) ? req.query.statut : null;
  const mine = req.query.mine === '1' ? req.user.id : null;
  const q = `%${str(req.query.q)}%`;
  res.json(db.prepare(`
    SELECT a.id, a.numero, a.statut, a.date_faits, a.citizen_id, a.redacteur_id, a.updated_at,
      json_extract(a.suspect, '$.nom') AS suspect_nom, json_extract(a.suspect, '$.prenom') AS suspect_prenom,
      json_extract(a.calc_result, '$.amende') AS amende, json_extract(a.calc_result, '$.gavMinutes') AS gav_minutes,
      json_extract(a.calc_result, '$.nbChefs') AS nb_chefs,
      u.matricule AS redacteur_matricule, u.nom AS redacteur_nom, u.prenom AS redacteur_prenom
    FROM arrest_reports a JOIN users u ON u.id = a.redacteur_id
    WHERE (? IS NULL OR a.statut = ?) AND (? IS NULL OR a.redacteur_id = ?)
      AND (a.numero LIKE ? OR IFNULL(json_extract(a.suspect, '$.nom') || ' ' || json_extract(a.suspect, '$.prenom'), '') LIKE ?)
    ORDER BY a.updated_at DESC LIMIT ?`).all(statut, statut, mine, mine, q, q, listLimit(req)));
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
  if (b.calc_input !== undefined) {
    const calcInput = cleanCalcInput(b.calc_input);
    fields.calc_input = JSON.stringify(calcInput);
    fields.calc_result = JSON.stringify(compute(calcInput, getCode));
  }
  transaction(() => {
    if (b.suspect !== undefined) {
      const { citizen_id, snapshot } = upsertCitizen(b.suspect ?? {}, SUSPECT_FIELDS);
      fields.citizen_id = citizen_id;
      fields.suspect = JSON.stringify(snapshot);
    }
    updateRow('arrest_reports', id, fields);
    // Les brouillons s'enregistrent souvent : seule la modification d'un rapport finalisé est tracée
    if (rep.statut === 'finalise') {
      const changed = Object.keys(FIELD_LABELS).filter(k => k in fields && fields[k] !== (typeof rep[k] === 'string' ? rep[k] : JSON.stringify(rep[k])));
      const before = rep.calc_result?.amende ?? 0;
      const after = fields.calc_result ? JSON.parse(fields.calc_result).amende : before;
      const details = [
        changed.length && `Modifié : ${[...new Set(changed.map(k => FIELD_LABELS[k]))].join(', ')}`,
        after !== before && `Amende : ${formatDollars(before)} → ${formatDollars(after)}`,
      ].filter(Boolean).join(' · ');
      if (details) logAction(req.user, "Rapport d'arrestation finalisé modifié", 'report', id, rep.numero, details);
    }
  });
  res.json(loadReport(id, req.user));
});

r.post('/:id/finalize', (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (!rep.can_edit) fail(403, 'Droits insuffisants');
  if (rep.statut === 'finalise') fail(400, 'Ce rapport est déjà finalisé');
  if (!rep.citizen_id) fail(400, 'Renseignez le suspect avant de finaliser');
  const result = compute(rep.calc_input, getCode);
  if (!result.nbChefs) fail(400, "Ajoutez au moins un chef d'accusation");
  if (rep.calc_input.retenue === 'max' && !rep.calc_input.approbateur) fail(400, "La retenue MAX nécessite le nom de l'approbateur (état-major, juge ou procureur)");
  const closeIds = (Array.isArray(req.body?.close_warrants) ? req.body.close_warrants : []).map(Number).filter(Number.isInteger);
  transaction(() => {
    db.prepare(`UPDATE arrest_reports SET statut = 'finalise', calc_result = ?, finalized_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(result), id);
    const close = db.prepare(`UPDATE warrants SET statut = 'clos', closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now')
      WHERE id = ? AND citizen_id = ? AND statut = 'actif'`);
    const closed = closeIds.reduce((n, wid) => n + close.run(req.user.id, wid, rep.citizen_id).changes, 0);
    sealSeizedObjects(req.user, rep);
    logAction(req.user, "Rapport d'arrestation finalisé", 'report', id, rep.numero, [
      `${[rep.suspect.prenom, rep.suspect.nom].filter(Boolean).join(' ')}`,
      `${result.nbChefs} chef(s)`, `amende ${formatDollars(result.amende)}`,
      closed && `${closed} mandat(s) clos`,
    ].filter(Boolean).join(' · '));
  });
  res.json(loadReport(id, req.user));
});

r.post('/:id/reopen', (req, res) => {
  if (!hasRole(req.user, 'superviseur')) fail(403, 'Droits insuffisants');
  const id = intParam(req.params.id);
  const rep = db.prepare('SELECT numero FROM arrest_reports WHERE id = ?').get(id);
  const { changes } = db.prepare(`UPDATE arrest_reports SET statut = 'brouillon', finalized_at = NULL, updated_at = datetime('now') WHERE id = ? AND statut = 'finalise'`)
    .run(id);
  if (!changes) fail(404, 'Rapport introuvable ou non finalisé');
  logAction(req.user, "Rapport d'arrestation rouvert", 'report', id, rep.numero, 'Retiré du casier jusqu’à sa nouvelle finalisation');
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const rep = loadReport(id, req.user);
  if (!hasRole(req.user, 'superviseur') && !(rep.statut === 'brouillon' && rep.redacteur_id === req.user.id)) fail(403, 'Droits insuffisants');
  db.prepare('DELETE FROM arrest_reports WHERE id = ?').run(id);
  logAction(req.user, "Rapport d'arrestation supprimé", 'report', id, rep.numero,
    [rep.statut === 'finalise' ? 'Rapport finalisé' : 'Brouillon', [rep.suspect.prenom, rep.suspect.nom].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
  res.json({ ok: true });
});

export default r;
