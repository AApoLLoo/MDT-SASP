import { Router } from 'express';
import { db, parseJson, getList } from '../db.js';
import { requireRole, hasRole, hashPassword, checkPassword, ALL_ROLES, JUSTICE_ROLES, JUSTICE_FONCTIONS, isJustice } from '../auth.js';
import { fail, pick, str, bool, intParam, insertRow, updateRow, cleanPhotos, logAction, getOr404 } from '../util.js';
import { isMember, divisionConflict, ROOKIE, SPECIAL_DIVISIONS } from '../../public/mdt/js/service-kinds.js';

const FIELD_LABELS = {
  photo_url: 'photo', telephone: 'téléphone', discord: 'Discord', bio: 'présentation', divisions: 'divisions', date_entree: "date d'entrée",
  qualifications: 'qualifications', grade_swat: 'grade SWAT', grade_bci: 'grade BCI', tuteurs: 'tuteurs', matricule: 'matricule', nom: 'nom', prenom: 'prénom', grade: 'grade', role: 'rôle', actif: 'statut du compte',
};

// Qui peut modifier quoi sur un profil d'agent
const SELF_FIELDS = ['photo_url', 'telephone', 'discord', 'bio'];
const SUPERVISOR_FIELDS = ['divisions', 'grade_swat', 'grade_bci', 'date_entree', 'qualifications', 'tuteurs'];
// Les agents de l'Academy confient les rookies à leurs tuteurs
const ACADEMY_FIELDS = ['tuteurs'];
const ADMIN_FIELDS = ['matricule', 'nom', 'prenom', 'grade', 'role', 'actif'];

const PUBLIC_COLUMNS = 'id, matricule, nom, prenom, grade, role, actif, photo_url, telephone, discord, divisions, grade_swat, grade_bci, date_entree, qualifications, tuteurs, bio, created_at';
const JUSTICE_SQL = JUSTICE_ROLES.map(r => `'${r}'`).join(', ');
const parseUser = u => ({ ...u, divisions: parseJson(u.divisions, []), qualifications: parseJson(u.qualifications, []), tuteurs: parseJson(u.tuteurs, []) });

// Tuteurs d'un rookie (identifiants) : agents actifs de l'Academy, cinq au plus
function cleanTuteurs(value) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(Number).filter(Number.isInteger))].slice(0, 5);
  for (const id of ids) {
    const u = db.prepare('SELECT matricule, actif, divisions FROM users WHERE id = ?').get(id);
    if (!u?.actif || !isMember('academy', parseUser(u))) fail(400, `Tuteur refusé : ${u?.matricule ?? id} n'est pas un agent actif de l'Academy`);
  }
  return JSON.stringify(ids);
}

// current : profil avant modification (un grade retiré de la liste reste accepté pour l'agent qui le porte déjà)
function clean(body, allowed, current = {}) {
  const f = pick(body, allowed);
  for (const k of ['matricule', 'nom', 'prenom', 'grade', 'grade_swat', 'grade_bci', 'telephone', 'discord', 'bio']) if (k in f) f[k] = str(f[k]);
  if ('matricule' in f && !f.matricule) fail(400, 'Le matricule est obligatoire');
  if ('role' in f && !ALL_ROLES.includes(f.role)) fail(400, 'Rôle invalide');
  // Compte justice : la fonction (Procureur, Juge, Avocat) remplace le grade SASP
  const role = f.role ?? current.role ?? 'agent';
  if (isJustice({ role })) {
    if (('grade' in f || 'role' in f) && !JUSTICE_FONCTIONS[role].includes(f.grade ?? current.grade)) {
      fail(400, `Fonction invalide pour ce compte : ${JUSTICE_FONCTIONS[role].join(' ou ')}`);
    }
  } else if (f.grade && f.grade !== current.grade && !getList('grades').includes(f.grade)) {
    fail(400, `Grade inconnu : ${f.grade}. Les grades se règlent dans Administration → Paramètres`);
  }
  // Grades internes des divisions (S.W.A.T., BCI) : pris dans leur liste réglable
  for (const { nom, grades, gradeField: k } of Object.values(SPECIAL_DIVISIONS).filter(d => d.gradeField)) {
    if (f[k] && f[k] !== current[k] && !getList(grades).includes(f[k])) {
      fail(400, `Grade ${nom} inconnu : ${f[k]}. Les grades ${nom} se règlent dans Administration → Paramètres`);
    }
  }
  if ('actif' in f) f.actif = bool(f.actif);
  if ('photo_url' in f) f.photo_url = cleanPhotos({ photo: f.photo_url }).photo ?? '';
  if ('date_entree' in f) {
    f.date_entree = str(f.date_entree);
    if (f.date_entree && !/^\d{4}-\d{2}-\d{2}$/.test(f.date_entree)) fail(400, "Date d'entrée invalide");
  }
  if ('qualifications' in f) {
    const list = (Array.isArray(f.qualifications) ? f.qualifications : []).map(q => str(q).slice(0, 60)).filter(Boolean);
    f.qualifications = JSON.stringify([...new Set(list)].slice(0, 30));
  }
  // Divisions : prises dans la liste réglée (une division retirée depuis reste acceptée pour l'agent qui la porte),
  // sans cumul interdit (BCI et S.W.A.T.)
  if ('divisions' in f) {
    const before = parseJson(current.divisions, []);
    const list = [...new Set((Array.isArray(f.divisions) ? f.divisions : []).map(d => str(d).slice(0, 60)).filter(Boolean))].slice(0, 10);
    const unknown = list.find(d => !before.includes(d) && !getList('divisions').includes(d));
    if (unknown) fail(400, `Division inconnue : ${unknown}. Les divisions se règlent dans Administration → Paramètres`);
    const conflict = divisionConflict(list);
    if (conflict) fail(400, conflict);
    f.divisions = JSON.stringify(list);
  }
  if ('tuteurs' in f) f.tuteurs = cleanTuteurs(f.tuteurs);
  return f;
}

function loadProfile(id) {
  const u = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id);
  if (!u) fail(404, 'Agent introuvable');
  Object.assign(u, parseUser(u));
  const count =(sql, ...params) => db.prepare(sql).get(...params).n;
  u.stats = {
    arrestations: count(`SELECT COUNT(*) AS n FROM arrest_reports WHERE redacteur_id = ? AND statut = 'finalise'`, id),
    participations: count(`SELECT COUNT(*) AS n FROM arrest_reports a, json_each(a.agents_presents) j
      WHERE a.statut = 'finalise' AND LOWER(j.value) = LOWER(?)`, u.matricule),
    plaintes: count('SELECT COUNT(*) AS n FROM complaints WHERE created_by = ?', id),
    mandats: count('SELECT COUNT(*) AS n FROM warrants WHERE created_by = ?', id),
    vehicules: count('SELECT COUNT(*) AS n FROM vehicles WHERE declare_par = ?', id),
  };
  u.reports = db.prepare(`
    SELECT id, numero, date_faits, json_extract(suspect, '$.nom') AS suspect_nom, json_extract(suspect, '$.prenom') AS suspect_prenom,
      json_extract(calc_result, '$.nbChefs') AS nb_chefs, json_extract(calc_result, '$.amende') AS amende
    FROM arrest_reports WHERE redacteur_id = ? AND statut = 'finalise'
    ORDER BY finalized_at DESC LIMIT 10`).all(id);
  return u;
}

const r = Router();

// Annuaire visible par tous les agents ; jamais de hash de mot de passe. Les comptes justice n'en font pas partie :
// l'administration les liste à part (?justice=1)
r.get('/', (req, res) => {
  const justice = req.query.justice === '1';
  if (justice && !hasRole(req.user, 'admin')) fail(403, 'Droits insuffisants');
  res.json(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE (role IN (${JUSTICE_SQL})) = ? ORDER BY actif DESC, matricule`)
    .all(justice ? 1 : 0).map(parseUser));
});

// Avocats actifs, pour les rattacher à un rapport ou une plainte
r.get('/avocats', (req, res) => {
  res.json(db.prepare(`SELECT id, matricule, nom, prenom FROM users WHERE role = 'avocat' AND actif = 1 ORDER BY nom, prenom`).all());
});

r.get('/:id', (req, res) => res.json(loadProfile(intParam(req.params.id))));

r.post('/', requireRole('admin'), (req, res) => {
  const f = clean(req.body, [...ADMIN_FIELDS, ...SUPERVISOR_FIELDS, ...SELF_FIELDS]);
  if (!f.matricule) fail(400, 'Le matricule est obligatoire');
  checkPassword(req.body?.password);
  const id = insertRow('users', { ...f, password_hash: hashPassword(str(req.body.password)) });
  logAction(req.user, 'Compte créé', 'user', id, f.matricule, [f.grade, f.role].filter(Boolean).join(' · '));
  res.status(201).json({ id });
});

r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const self = id === req.user.id;
  const admin = hasRole(req.user, 'admin');
  const allowed = [
    ...(self || admin ? SELF_FIELDS : []),
    ...(hasRole(req.user, 'superviseur') ? SUPERVISOR_FIELDS : isMember('academy', req.user) ? ACADEMY_FIELDS : []),
    ...(admin ? ADMIN_FIELDS : []),
  ];
  if (!allowed.length) fail(403, 'Vous ne pouvez modifier que votre propre profil');
  const before = getOr404('SELECT * FROM users WHERE id = ?', id, 'Agent introuvable');
  const f = clean(req.body ?? {}, allowed, before);
  // Un rookie promu quitte le tutorat : ses tuteurs lui sont retirés (effectif de l'Academy, profils)
  if ('grade' in f && !ROOKIE.test(f.grade)) f.tuteurs = '[]';
  if (self && ((f.role && f.role !== req.user.role) || f.actif === 0)) {
    fail(400, 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte');
  }
  // Réinitialisation du mot de passe d'un autre agent : administrateur uniquement
  if (str(req.body?.password)) {
    if (!admin) fail(403, 'Seul un administrateur peut réinitialiser un mot de passe');
    checkPassword(req.body.password);
    f.password_hash = hashPassword(str(req.body.password));
  }
  if (Object.keys(f).length) updateRow('users', id, f, { touch: false });
  // Les agents mettent souvent à jour leur propre profil : seule l'intervention d'un autre compte est tracée
  const changed = Object.keys(FIELD_LABELS).filter(k => k in f && f[k] !== before[k]);
  if (!self && (changed.length || f.password_hash)) {
    logAction(req.user, f.actif === 0 ? 'Compte révoqué' : f.actif === 1 && !before.actif ? 'Compte réactivé' : "Profil d'agent modifié", 'user', id, before.matricule, [
      changed.length && `Modifié : ${changed.map(k => FIELD_LABELS[k]).join(', ')}`,
      'role' in f && f.role !== before.role && `Rôle : ${before.role} → ${f.role}`,
      'grade' in f && f.grade !== before.grade && `Grade : ${before.grade || '—'} → ${f.grade || '—'}`,
      f.password_hash && 'Mot de passe réinitialisé',
    ].filter(Boolean).join(' · '));
  }
  if (f.password_hash || f.actif === 0) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(id, req.sessionToken);
  res.json(loadProfile(id));
});

export default r;
