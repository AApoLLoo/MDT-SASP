import { Router } from 'express';
import { db, transaction } from './db.js';
import { isJustice } from './auth.js';
import { fail, str, logAction } from './util.js';

// Routes /api ouvertes aux comptes justice ; tout le reste leur est refusé (refus par défaut).
// Les contrôles fins (avocat rattaché, rapport blanchi) sont faits dans les routes elles-mêmes.
const ALLOWED = {
  magistrat: [
    ['GET', /^\/(citizens|vehicles|warrants|reports|incidents|complaints|evidence)(\/\d+)?$/],
    ['GET', /^\/(penal-code|weapons|settings|users|users\/avocats)$/],
    ['POST', /^\/(warrants|uploads|penal-code)$/],
    ['POST', /^\/complaints\/\d+\/close$/],
    ['POST', /^\/reports\/\d+\/(finalize|send-back|reopen|blanchir|unblanchir)$/],
    ['POST', /^\/citizens\/\d+\/blanchir$/],
    ['PUT', /^\/penal-code\/\d+$/],
    ['PUT', /^\/reports\/\d+\/jugement$/],
  ],
  avocat: [
    ['GET', /^\/(reports|complaints)\/\d+$/],
    ['GET', /^\/(justice\/mes-dossiers|settings|penal-code)$/],
  ],
};

export function justiceGate(req, res, next) {
  if (!isJustice(req.user)) return next();
  const allowed = ALLOWED[req.user.role].some(([method, pattern]) => method === req.method && pattern.test(req.path));
  return allowed ? next() : res.status(403).json({ error: 'Accès réservé à la police' });
}

const avocatStmt = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'avocat' AND actif = 1`);

// Compte avocat rattaché à un dossier : vide → aucun, sinon un avocat actif
export function cleanAvocatId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || !avocatStmt.get(id)) fail(400, 'Avocat inconnu');
  return id;
}

// L'inscription d'un avocat ouvre l'accès au dossier : chaque changement est journalisé (listes d'identifiants)
export function logAvocatChange(user, entity, entityId, numero, before, after) {
  const same = before.length === after.length && before.every(id => after.includes(id));
  if (same) return;
  const label = ids => ids.map(id => {
    const u = db.prepare('SELECT matricule, nom, prenom FROM users WHERE id = ?').get(id);
    return u ? `${[u.prenom, u.nom].filter(Boolean).join(' ')} (${u.matricule})` : `#${id}`;
  }).join(', ') || '—';
  logAction(user, 'Avocat du dossier modifié', entity, entityId, numero, `Avocat : ${label(before)} → ${label(after)}`);
}

// Plusieurs avocats (plaintes) : JSON d'identifiants uniques, quatre au plus
export function cleanAvocatIds(values) {
  const ids = (Array.isArray(values) ? values : []).map(cleanAvocatId).filter(id => id !== null);
  return JSON.stringify([...new Set(ids)].slice(0, 4));
}

// Blanchiment : les condamnations restent en base, marquées (date, auteur, motif), et sortent du casier vu par la police.
// reports : [{ id, numero }] ; seuls les rapports finalisés non blanchis sont touchés. Renvoie le nombre blanchi.
export function blanchirRapports(user, reports, motif) {
  const m = str(motif);
  if (!m) fail(400, 'Indiquez le motif du blanchiment');
  const stmt = db.prepare(`UPDATE arrest_reports SET blanchi_at = datetime('now'), blanchi_par = ?, blanchi_motif = ?
    WHERE id = ? AND statut = 'finalise' AND blanchi_at IS NULL`);
  let count = 0;
  transaction(() => {
    for (const rep of reports) {
      if (!stmt.run(user.id, m, rep.id).changes) continue;
      count++;
      logAction(user, 'Condamnation blanchie', 'report', rep.id, rep.numero, m);
    }
  });
  return count;
}

const r = Router();

// Dossiers d'un avocat : rapports d'arrestation et plaintes où son compte est inscrit
r.get('/mes-dossiers', (req, res) => {
  if (req.user.role !== 'avocat') fail(403, 'Réservé aux avocats');
  res.json({
    reports: db.prepare(`
      SELECT id, numero, statut, date_faits, json_extract(suspect, '$.nom') AS suspect_nom, json_extract(suspect, '$.prenom') AS suspect_prenom
      FROM arrest_reports WHERE avocat_id = ? AND blanchi_at IS NULL ORDER BY updated_at DESC`).all(req.user.id),
    complaints: db.prepare(`
      SELECT id, numero, statut, date_depot FROM complaints c
      WHERE EXISTS (SELECT 1 FROM json_each(c.avocat_ids) j WHERE j.value = ?) ORDER BY date_depot DESC, id DESC`).all(req.user.id),
  });
});

export default r;
