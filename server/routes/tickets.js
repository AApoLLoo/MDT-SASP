import { Router } from 'express';
import { db, parseJson } from '../db.js';
import { requireRole } from '../auth.js';
import { fail, str, intParam, insertRow, updateRow, nextNumero, localDate, listLimit, logAction, getOr404 } from '../util.js';
import { formatDollars } from '../../public/mdt/js/calc.js';

// Amendes simples (PV) : contraventions du Code pénal, sans arrestation ni jugement
const MAX_LIGNES = 10;
const contravention = db.prepare(`SELECT id, infraction, amende FROM penal_code WHERE id = ? AND categorie = 'Contravention' AND actif = 1`);

// Lignes du PV, montants repris du Code pénal (jamais du client) ; quantité de 1 à 99
export function cleanCharges(charges) {
  const lignes = (Array.isArray(charges) ? charges : []).slice(0, MAX_LIGNES).map(ch => {
    const code = contravention.get(Number(ch?.code_id));
    if (!code) fail(400, 'Infraction inconnue ou hors contraventions');
    const quantite = Math.min(Math.max(Math.trunc(Number(ch.quantite)) || 1, 1), 99);
    return { code_id: code.id, infraction: code.infraction, amende: code.amende, quantite, total: code.amende * quantite };
  });
  if (!lignes.length) fail(400, 'Ajoutez au moins une infraction');
  return lignes;
}

const SELECT = `
  SELECT t.*, c.nom AS citizen_nom, c.prenom AS citizen_prenom, u.matricule AS agent_matricule
  FROM tickets t JOIN citizens c ON c.id = t.citizen_id JOIN users u ON u.id = t.agent_id`;
const parse = t => ({ ...t, charges: parseJson(t.charges, []) });
const label = t => [t.citizen_prenom, t.citizen_nom].filter(Boolean).join(' ');

const r = Router();

r.get('/', (req, res) => {
  const q = `%${str(req.query.q)}%`;
  const citizen = Number(req.query.citizen_id) || null;
  const statut = ['impayee', 'payee'].includes(req.query.statut) ? req.query.statut : null;
  res.json(db.prepare(`${SELECT}
    WHERE (? IS NULL OR t.citizen_id = ?) AND (? IS NULL OR t.statut = ?)
      AND (t.numero LIKE ? OR t.plaque LIKE ? OR c.nom || ' ' || c.prenom LIKE ? OR c.prenom || ' ' || c.nom LIKE ?)
    ORDER BY t.id DESC LIMIT ?`).all(citizen, citizen, statut, statut, q, q, q, q, listLimit(req)).map(parse));
});

r.post('/', (req, res) => {
  const b = req.body ?? {};
  const citizen = getOr404('SELECT id, nom, prenom FROM citizens WHERE id = ?', intParam(b.citizen_id), 'Citoyen introuvable');
  const charges = cleanCharges(b.charges);
  const montant = charges.reduce((s, l) => s + l.total, 0);
  const numero = nextNumero('tickets', 'PV');
  const id = insertRow('tickets', {
    numero,
    citizen_id: citizen.id,
    plaque: str(b.plaque).toUpperCase().slice(0, 20),
    lieu: str(b.lieu).slice(0, 200),
    date_faits: str(b.date_faits) || localDate(),
    heure: str(b.heure).slice(0, 5),
    charges: JSON.stringify(charges),
    montant,
    statut: b.statut === 'payee' ? 'payee' : 'impayee',
    notes: str(b.notes).slice(0, 2000),
    agent_id: req.user.id,
  });
  logAction(req.user, 'Amende dressée', 'ticket', id, numero,
    `${[citizen.prenom, citizen.nom].filter(Boolean).join(' ')} · ${formatDollars(montant)} · ${charges.map(l => l.infraction).join(', ')}`);
  res.status(201).json(parse(db.prepare(`${SELECT} WHERE t.id = ?`).get(id)));
});

// Réglée ou non : tout agent (paiement constaté en jeu)
r.put('/:id/statut', (req, res) => {
  const id = intParam(req.params.id);
  const statut = req.body?.statut;
  if (!['impayee', 'payee'].includes(statut)) fail(400, 'Statut invalide');
  const t = getOr404(`${SELECT} WHERE t.id = ?`, id, 'Amende introuvable');
  if (t.statut !== statut) {
    updateRow('tickets', id, { statut });
    logAction(req.user, statut === 'payee' ? 'Amende réglée' : 'Amende remise en impayée', 'ticket', id, t.numero, label(t));
  }
  res.json(parse(db.prepare(`${SELECT} WHERE t.id = ?`).get(id)));
});

// Un PV erroné s'annule (suppression journalisée) par un superviseur, puis se dresse à nouveau
r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const t = getOr404(`${SELECT} WHERE t.id = ?`, intParam(req.params.id), 'Amende introuvable');
  db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
  logAction(req.user, 'Amende supprimée', 'ticket', t.id, t.numero, `${label(t)} · ${formatDollars(t.montant)}`);
  res.json({ ok: true });
});

export default r;
