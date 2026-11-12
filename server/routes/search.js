import { Router } from 'express';
import { db } from '../db.js';
import { canJudge } from '../auth.js';
import { str } from '../util.js';
import { managesDivision } from '../../public/mdt/js/service-kinds.js';

// Recherche globale : un seul champ pour les citoyens (nom, alias, groupe, n° sécu, téléphone), les plaques,
// les mandats/BOLO actifs et les documents par numéro (SASP-, INC-, PLT-, PRV-, PV-)
const N = 5;
// Nom d'une personne enregistrée en JSON dans une colonne du document (suspect, plaignant)
const name = column => `TRIM(COALESCE(json_extract(${column}, '$.prenom'), '') || ' ' || COALESCE(json_extract(${column}, '$.nom'), ''))`;

const r = Router();

r.get('/', (req, res) => {
  const term = str(req.query.q);
  if (term.length < 2) return res.json([]);
  const q = `%${term}%`;
  const judge = canJudge(req.user) ? 1 : 0;
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  res.json([
    ...all(`SELECT 'citizen' AS type, id, TRIM(prenom || ' ' || nom) AS titre, id_unique, alias, affiliation,
        (SELECT COUNT(*) FROM warrants w WHERE w.citizen_id = citizens.id AND w.statut = 'actif') AS alerte
      FROM citizens WHERE nom || ' ' || prenom LIKE ? OR prenom || ' ' || nom LIKE ? OR IFNULL(id_unique, '') LIKE ?
        OR telephone LIKE ? OR alias LIKE ? OR affiliation LIKE ?
      ORDER BY nom, prenom LIMIT ?`, q, q, q, q, q, q, N)
      .map(({ id_unique, alias, affiliation, ...c }) => ({
        ...c, detail: [id_unique && `ID ${id_unique}`, alias && `« ${alias} »`, affiliation].filter(Boolean).join(' · '),
      })),
    ...all(`SELECT 'vehicle' AS type, id, plaque AS titre, TRIM(modele || ' ' || couleur) AS detail, statut = 'vole' AS alerte
      FROM vehicles WHERE plaque LIKE ? OR modele LIKE ? ORDER BY statut = 'retrouve', plaque LIMIT ?`, q, q, N),
    ...all(`SELECT 'warrant' AS type, w.id, w.motif AS titre, w.type AS detail, w.citizen_id, 1 AS alerte
      FROM warrants w LEFT JOIN citizens c ON c.id = w.citizen_id LEFT JOIN vehicles v ON v.id = w.vehicle_id
      WHERE w.statut = 'actif' AND (w.motif LIKE ? OR v.plaque LIKE ?) ORDER BY w.id DESC LIMIT ?`, q, q, N),
    ...all(`SELECT 'report' AS type, id, numero AS titre, ${name('suspect')} AS detail FROM arrest_reports
      WHERE numero LIKE ? AND (? OR blanchi_at IS NULL) ORDER BY id DESC LIMIT ?`, q, judge, N),
    ...all(`SELECT 'incident' AS type, id, numero AS titre, lieu AS detail FROM incident_reports WHERE numero LIKE ? ORDER BY id DESC LIMIT ?`, q, N),
    ...all(`SELECT 'complaint' AS type, id, numero AS titre, ${name('plaignant')} AS detail FROM complaints WHERE numero LIKE ? ORDER BY id DESC LIMIT ?`, q, N),
    ...all(`SELECT 'evidence' AS type, id, numero AS titre, description AS detail FROM evidence WHERE numero LIKE ? ORDER BY id DESC LIMIT ?`, q, N),
    ...all(`SELECT 'ticket' AS type, t.id, t.numero AS titre, TRIM(c.prenom || ' ' || c.nom) AS detail, t.citizen_id, t.statut = 'impayee' AS alerte
      FROM tickets t JOIN citizens c ON c.id = t.citizen_id WHERE t.numero LIKE ? OR t.plaque LIKE ? ORDER BY t.id DESC LIMIT ?`, q, q, N),
  ]);
});

// Documents à lier à une enquête : par numéro ou par nom (suspect, plaignant, contrevenant), lieu, description ;
// les enquêtes du BCI seulement pour qui les encadre (BCI, état-major)
r.get('/documents', (req, res) => {
  const term = str(req.query.q);
  if (term.length < 2) return res.json([]);
  const q = `%${term}%`;
  const judge = canJudge(req.user) ? 1 : 0;
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const docs = [
    ...all(`SELECT numero, 'Rapport d''arrestation' AS type, ${name('suspect')} AS label FROM arrest_reports
      WHERE (numero LIKE ? OR ${name('suspect')} LIKE ?) AND (? OR blanchi_at IS NULL) ORDER BY id DESC LIMIT ?`, q, q, judge, N),
    ...all(`SELECT numero, 'Plainte' AS type, ${name('plaignant')} AS label FROM complaints
      WHERE numero LIKE ? OR ${name('plaignant')} LIKE ? OR ${name('mis_en_cause')} LIKE ? ORDER BY id DESC LIMIT ?`, q, q, q, N),
    ...all(`SELECT numero, 'Rapport d''incident' AS type, lieu AS label FROM incident_reports WHERE numero LIKE ? OR lieu LIKE ? ORDER BY id DESC LIMIT ?`, q, q, N),
    ...all(`SELECT numero, 'Scellé' AS type, description AS label FROM evidence WHERE numero LIKE ? OR description LIKE ? ORDER BY id DESC LIMIT ?`, q, q, N),
    ...all(`SELECT t.numero, 'Amende' AS type, TRIM(c.prenom || ' ' || c.nom) AS label FROM tickets t JOIN citizens c ON c.id = t.citizen_id
      WHERE t.numero LIKE ? OR c.nom || ' ' || c.prenom LIKE ? OR c.prenom || ' ' || c.nom LIKE ? ORDER BY t.id DESC LIMIT ?`, q, q, q, N),
  ];
  if (managesDivision('bci', req.user)) {
    docs.push(...all(`SELECT json_extract(data, '$.numero') AS numero, 'Enquête BCI' AS type,
        TRIM(json_extract(data, '$.objet') || IFNULL(' « ' || NULLIF(json_extract(data, '$.nom_code'), '') || ' »', '')) AS label
      FROM service_records WHERE kind = 'enquetes'
        AND (json_extract(data, '$.numero') LIKE ? OR json_extract(data, '$.objet') LIKE ? OR json_extract(data, '$.nom_code') LIKE ?)
      ORDER BY id DESC LIMIT ?`, q, q, q, N));
  }
  res.json(docs);
});

export default r;
