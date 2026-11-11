// Définition des dossiers de gestion du service, partagée entre le navigateur et le serveur.
// view  : 'all' (tous les agents voient tout) | 'own' (chacun voit les siens, superviseurs : tout)
// create: 'self' (l'agent déclare pour lui-même, un superviseur pour n'importe qui) | 'sup'
// Le premier statut est le statut initial ; seuls les superviseurs changent le statut.
// Les champs `sup: true` ne sont renseignés que par un superviseur.

export const UNIT_STATUTS = {
  disponible: ['Disponible', 'ok'],
  patrouille: ['En patrouille', 'info'],
  intervention: ['En intervention', 'danger'],
  pause: ['En pause', 'warn'],
};

// Valeurs initiales, ensuite réglées dans Administration → Paramètres
export const SECTEURS = ['Sud', 'Nord'];
export const POSTES = ['Mission Row', 'Paleto Bay'];

export const KINDS = {
  convocations: {
    titre: 'Convocations', nouveau: 'Nouvelle convocation',
    aide: 'Convocations des agents par la hiérarchie. Chaque agent voit les siennes.',
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { prevue: ['Prévue', 'info'], honoree: ['Honorée', 'ok'], non_honoree: ['Non honorée', 'danger'], annulee: ['Annulée', ''] },
    fields: [
      { key: 'motif', label: 'Motif', required: true, placeholder: 'Entretien, conseil de discipline, formation…' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'heure', label: 'Heure', type: 'time' },
      { key: 'lieu', label: 'Lieu', placeholder: 'Bureau du commandement' },
      { key: 'compte_rendu', label: 'Compte rendu', type: 'textarea', sup: true },
    ],
  },
  absences: {
    titre: 'Absences', nouveau: 'Déclarer une absence',
    aide: 'Absences déclarées par les agents, validées par un superviseur. Visibles par tous pour le planning.',
    view: 'all', create: 'self', dateKey: 'date_debut',
    statuts: { en_attente: ['En attente', 'warn'], validee: ['Validée', 'ok'], refusee: ['Refusée', 'danger'] },
    fields: [
      { key: 'date_debut', label: 'Du', type: 'date', required: true },
      { key: 'date_fin', label: 'Au', type: 'date', required: true, prefix: 'au' },
      { key: 'motif', label: 'Motif', required: true, placeholder: 'Congés, raisons personnelles…' },
      { key: 'commentaire', label: 'Commentaire du superviseur', type: 'textarea', sup: true },
    ],
    validate: d => (d.date_fin && d.date_debut && d.date_fin < d.date_debut ? 'La date de fin précède la date de début' : null),
  },
  materiel: {
    titre: 'Matériel perdu', nouveau: 'Déclarer une perte',
    aide: "Perte de matériel de service déclarée par l'agent. Un superviseur décide de la suite donnée.",
    view: 'own', create: 'self', dateKey: 'date',
    statuts: { declare: ['Déclaré', 'warn'], retrouve: ['Retrouvé', 'ok'], remplace: ['Remplacé', 'info'] },
    fields: [
      { key: 'type', label: 'Matériel', type: 'select', required: true, options: ['Arme de service', 'Taser', 'Radio', 'Gilet pare-balles', 'Menottes', 'Badge / carte professionnelle', 'Clés de véhicule', 'Autre'] },
      { key: 'description', label: 'Description', placeholder: 'Modèle, marquage…' },
      { key: 'numero_serie', label: 'N° de série' },
      { key: 'date', label: 'Date de la perte', type: 'date', required: true },
      { key: 'circonstances', label: 'Circonstances', type: 'textarea', required: true },
      { key: 'decision', label: 'Suite donnée (superviseur)', type: 'textarea', sup: true },
    ],
  },
  sanctions: {
    titre: 'Sanctions', nouveau: 'Nouvelle sanction',
    aide: "Sanctions disciplinaires. Chaque agent ne voit que les siennes.",
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { active: ['Active', 'danger'], levee: ['Levée', ''] },
    fields: [
      { key: 'type', label: 'Sanction', type: 'select', required: true, options: ['Avertissement', 'Mise à pied', 'Rétrogradation', 'Licenciement'] },
      { key: 'motif', label: 'Motif', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'duree', label: 'Durée', placeholder: 'Ex. : 48 h (mise à pied)' },
      { key: 'details', label: 'Détails', type: 'textarea' },
    ],
  },
};

export const initialStatut = kind => Object.keys(kind.statuts)[0];

// Divisions spécialisées : chacune a sa catégorie dans le menu (effectif + dossiers), visible par ceux qui
// l'encadrent (managesDivision). `grades` : liste réglable des grades internes, portés par la colonne `gradeField` de l'agent.
// ponytail: une division est reconnue par son nom (`match`, testé sur les divisions du profil de l'agent) ;
// si une division est renommée sans rapport avec ce motif, adapter `match`.
export const SPECIAL_DIVISIONS = {
  bci: { nom: 'BCI', match: /investigation|enqu[eê]t|\bbci\b|d[ée]tective/i, grades: 'grades_bci', gradeField: 'grade_bci' },
  swat: { nom: 'S.W.A.T.', match: /s\.?w\.?a\.?t/i, grades: 'grades_swat', gradeField: 'grade_swat' },
  // pages : pages propres à la division (views/divisions.js), placées dans le menu avant ses dossiers ;
  // tutorat : l'effectif montre les rookies confiés à chaque membre (colonne `tuteurs` des agents)
  academy: { nom: 'Academy', match: /academy|saspa|formateur|^formation$/i, tutorat: true, pages: [['rookies', 'cap', 'Suivi des rookies'], ['catalogue', 'book', 'Formations']] },
};

// key : clé de SPECIAL_DIVISIONS ; user : { divisions: [] } (un agent peut cumuler plusieurs divisions)
export function isMember(key, user) {
  const division = SPECIAL_DIVISIONS[key];
  return !!division && (user?.divisions ?? []).some(v => division.match.test(v));
}

// Grade suivi par l'Academy (suivi des rookies, tutorat), reconnu par son nom
export const ROOKIE = /rookie/i;

// Divisions qu'un superviseur encadre même sans en être membre : la Police Academy (suivi des rookies)
export const DIVISIONS_SUPERVISEUR = ['academy'];

// Encadrement d'une division (tous ses dossiers, création, statuts) : ses membres ; l'état-major et les
// administrateurs pour toutes ; un superviseur pour les siennes et celles de DIVISIONS_SUPERVISEUR
export function managesDivision(key, user) {
  return isMember(key, user) || ['etat_major', 'admin'].includes(user?.role)
    || (user?.role === 'superviseur' && DIVISIONS_SUPERVISEUR.includes(key));
}

// Divisions qu'un agent ne peut pas cumuler
export const INCOMPATIBLES = [['bci', 'swat']];

// Message d'erreur si la liste de divisions réunit deux divisions incompatibles, sinon null
export function divisionConflict(divisions) {
  const pair = INCOMPATIBLES.find(keys => keys.every(k => isMember(k, { divisions })));
  return pair ? `Un agent ne peut pas être à la fois au ${SPECIAL_DIVISIONS[pair[0]].nom} et au ${SPECIAL_DIVISIONS[pair[1]].nom}` : null;
}

const EQUIPES = ['David', 'Goliath', 'Appui', "Tireurs d'élite", 'Négociation', 'Commandement'];
// Pions du croquis tactique : [clé, code affiché, libellé, couleur]
const UNITES_SWAT = [
  ['david', 'D', 'David', '#3b82f6'], ['goliath', 'G', 'Goliath', '#8b5cf6'], ['appui', 'A', 'Appui', '#14b8a6'],
  ['sniper', 'TE', "Tireur d'élite", '#16a34a'], ['nego', 'N', 'Négociateur', '#ca8a04'], ['medic', 'M', 'Medic', '#db2777'],
  ['pc', 'PC', 'Commandement', '#475569'], ['vehicule', 'V', 'Véhicule', '#0284c7'], ['suspect', 'S', 'Suspect', '#dc2626'],
  ['otage', 'O', 'Otage / civil', '#ea580c'], ['entree', 'E', "Point d'entrée", '#65a30d'], ['objectif', 'X', 'Objectif', '#be123c'],
];
const ROLES_SWAT = ["Chef d'opération", 'Chef de colonne', 'Pointeur', 'Bouclier', 'Breacher', "Tireur d'élite", 'Négociateur', 'Medic', 'Opérateur', 'Pilote / chauffeur'];
// Pions du tableau d'enquête du BCI (étiquette à renommer d'un double-clic : nom, plaque, adresse…)
const PIONS_ENQUETE = [
  ['suspect', 'S', 'Suspect', '#dc2626'], ['interet', 'P', "Personne d'intérêt", '#8b5cf6'], ['temoin', 'T', 'Témoin', '#ca8a04'],
  ['victime', 'V', 'Victime', '#ea580c'], ['indic', 'I', 'Informateur', '#14b8a6'], ['organisation', 'O', 'Organisation / gang', '#be123c'],
  ['lieu', 'L', 'Lieu', '#16a34a'], ['vehicule', 'Vh', 'Véhicule', '#0284c7'], ['telephone', 'Tél', 'Téléphone', '#475569'],
  ['preuve', 'Pr', 'Preuve', '#65a30d'], ['arme', 'A', 'Arme', '#57534e'], ['argent', '$', 'Argent', '#d97706'],
];

// Dossiers des divisions, rangés avec les dossiers de service. `create: 'sup'` vaut ici « superviseurs et membres
// de la division » : ils voient tout, créent, modifient et changent le statut. Les autres agents voient seulement
// les dossiers où ils sont l'agent concerné (`agent`).
// Types de champ en plus de ceux du service : `{ section }` (titre), `rows` (tableau de lignes à colonnes),
// `photos` (images ajoutées une à une), `sketch` (croquis à dessiner, pions `units`, voir components/sketch.js),
// `ref` (liste déroulante des dossiers d'un autre type, par leur premier champ ; aussi pour une colonne de `rows`)
// et `settings` (liste déroulante d'une liste réglée dans Administration → Paramètres).
// Options d'un champ : `extend` (saisie libre ; une valeur nouvelle est ajoutée à sa liste `settings`),
// `fixed` (non modifiable une fois le dossier créé), `unique` (un seul dossier du type par valeur).
// `menu: false` : pas d'entrée dans le menu (dossier affiché par une page de la division).
// `grant: { statut, field }` : au passage au statut, la valeur du champ s'ajoute aux qualifications de l'agent.
// `numero: 'BCI'` : le serveur donne à chaque dossier un numéro annuel BCI-AAAA-NNNN (data.numero) ; le dossier a sa page.
// `link` : le champ (toujours nommé `dossier`) porte le numéro d'un dossier du type indiqué, contrôlé par le serveur ;
// chaque dossier voit ceux qui le citent (GET /service/<type>/<id>, `liens`), en résumé s'il n'a pas le droit de les lire.
// Colonnes de `rows` : `doc` (numéro de document du MDT, résolu dans `liens`), `citizen` (id de fiche citoyen),
// `hidden` (gardée sans être affichée). `max` : longueur d'un texte (4 000 caractères par défaut).
// `request: { division, statut, titre }` : les membres de cette autre division peuvent créer une demande (statut imposé),
// liée à un de leurs dossiers, et la modifier tant qu'elle n'est pas prise en charge.
export const DIVISION_KINDS = {
  enquetes: {
    division: 'bci', numero: 'BCI',
    titre: "Dossiers d'enquête", nouveau: 'Ouvrir un dossier', agent: 'Enquêteur référent', icon: 'search',
    aide: "Enquêtes du BCI : personnes, documents liés, actes d'enquête et tableau d'enquête. Réservées aux enquêteurs et aux superviseurs.",
    view: 'own', create: 'sup', dateKey: 'date_ouverture',
    statuts: { ouverte: ['Ouverte', 'info'], en_cours: ['En cours', 'warn'], suspendue: ['Suspendue', ''], transmise: ['Transmise au parquet', 'ok'], resolue: ['Résolue', 'ok'], classee: ['Classée sans suite', ''] },
    fields: [
      { key: 'objet', label: 'Objet', required: true, placeholder: 'Ex. : Trafic de stupéfiants à Sandy Shores' },
      { key: 'type', label: 'Nature', type: 'select', required: true, options: ['Stupéfiants', 'Vol / braquage', 'Homicide', 'Agression', 'Enlèvement / séquestration', 'Crime organisé / gang', "Trafic d'armes", 'Fraude / corruption', 'Autre'] },
      { key: 'priorite', label: 'Priorité', type: 'select', options: ['Basse', 'Normale', 'Haute', 'Critique'] },
      { key: 'date_ouverture', label: "Date d'ouverture", type: 'date', required: true },
      { key: 'equipe', label: 'Équipe d’enquête', type: 'rows', columns: [
        { key: 'agent', label: 'Enquêteur', placeholder: 'Matricule', list: 'users' },
        { key: 'role', label: 'Rôle', type: 'select', options: ['Co-enquêteur', 'Analyste', 'Appui technique', 'Superviseur du dossier'] },
      ] },
      { section: 'Synthèse' },
      { key: 'resume', label: 'Résumé des faits', type: 'textarea', max: 20000 },
      { key: 'elements', label: 'Hypothèses et pistes', type: 'textarea', max: 20000 },
      { key: 'conclusion', label: 'Conclusion', type: 'textarea', max: 20000 },
      { section: 'Personnes et véhicules' },
      { key: 'personnes', label: 'Personnes liées', type: 'rows', columns: [
        { key: 'role', label: 'Qualité', type: 'select', options: ['Suspect', "Personne d'intérêt", 'Témoin', 'Victime', 'Informateur'] },
        { key: 'nom', label: 'Identité' },
        { key: 'notes', label: 'Notes' },
        { key: 'citoyen', label: 'Fiche citoyen', citizen: true, hidden: true },
      ] },
      { key: 'vehicules', label: 'Véhicules', type: 'rows', columns: [
        { key: 'plaque', label: 'Plaque' },
        { key: 'modele', label: 'Modèle et couleur' },
        { key: 'notes', label: 'Notes', placeholder: 'Propriétaire, lien avec l’affaire…' },
      ] },
      { section: 'Documents liés' },
      { key: 'pieces', label: 'Documents du MDT', type: 'rows', columns: [
        { key: 'numero', label: 'N° du document', placeholder: 'SASP-, PLT-, INC-, PRV- ou BCI-…', doc: true },
        { key: 'note', label: 'Note' },
      ] },
      { section: "Tableau d'enquête" },
      { key: 'tableau', label: "Tableau d'enquête", type: 'sketch', units: PIONS_ENQUETE },
      { key: 'photos', label: 'Photos et documents', type: 'photos' },
    ],
  },
  // Journal des enquêtes : chaque acte est un dossier à part, rattaché à l'enquête par son numéro
  actes: {
    division: 'bci', menu: false,
    titre: "Actes d'enquête", nouveau: 'Consigner un acte', agent: 'Enquêteur', icon: 'edit',
    aide: "Journal des enquêtes : auditions, perquisitions, filatures, réquisitions… Chaque acte est rattaché à un dossier.",
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { realise: ['Réalisé', 'ok'], prevu: ['Prévu', 'info'], annule: ['Annulé', ''] },
    fields: [
      { key: 'dossier', label: 'Dossier', link: 'enquetes', required: true, fixed: true, placeholder: 'BCI-AAAA-NNNN' },
      { key: 'type', label: 'Acte', type: 'select', required: true, options: ['Audition de témoin', 'Audition de victime', 'Interrogatoire de suspect', 'Perquisition', 'Filature / surveillance', 'Réquisition (téléphonie, banque…)', 'Interpellation', 'Saisie', 'Expertise / analyse', 'Recoupement', 'Note'] },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'heure', label: 'Heure', type: 'time' },
      { key: 'lieu', label: 'Lieu' },
      { key: 'personnes', label: 'Personnes concernées', placeholder: 'Personne entendue, présents, avocat…' },
      { key: 'compte_rendu', label: 'Compte rendu / procès-verbal', type: 'textarea', required: true, max: 20000 },
      { key: 'pieces', label: 'Photos', type: 'photos' },
    ],
  },
  informateurs: {
    division: 'bci',
    titre: 'Informateurs', nouveau: 'Enregistrer un informateur', agent: 'Officier traitant', icon: 'user',
    aide: "Registre confidentiel des sources du BCI : identité, fiabilité et renseignements fournis. Réservé au BCI et aux superviseurs.",
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { actif: ['Actif', 'ok'], suspendu: ['Suspendu', 'warn'], grille: ['Grillé', 'danger'], radie: ['Radié', ''] },
    fields: [
      { key: 'code', label: 'Nom de code', required: true, unique: true, placeholder: 'Ex. : CORBEAU' },
      { key: 'fiabilite', label: 'Fiabilité', type: 'select', required: true, options: ['A · Confirmée', 'B · Bonne', 'C · Moyenne', 'D · Douteuse', 'E · Non évaluée'] },
      { key: 'milieu', label: 'Milieu / réseau', placeholder: 'Ex. : trafic d’armes à Davis' },
      { key: 'date', label: "Date d'enregistrement", type: 'date', required: true },
      { key: 'identite', label: 'Identité réelle', type: 'textarea' },
      { key: 'contact', label: 'Moyen de contact' },
      { key: 'contreparties', label: 'Contreparties accordées', type: 'textarea' },
      { section: 'Renseignements' },
      { key: 'renseignements', label: 'Renseignements fournis', type: 'rows', columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'info', label: 'Renseignement' },
        { key: 'dossier', label: 'Dossier', placeholder: 'BCI-…' },
        { key: 'fiabilite', label: 'Vérification', type: 'select', options: ['Vérifié', 'Non vérifié', 'Faux'] },
      ] },
    ],
  },
  operations: {
    division: 'swat',
    titre: 'Opérations', nouveau: 'Planifier une opération', agent: "Chef d'opération", icon: 'target',
    aide: "Fiche d'opération : renseignement, dispositif, briefing, journal et débriefing. Réservée au S.W.A.T. et aux superviseurs ; le BCI y adresse ses demandes d'appui.",
    view: 'own', create: 'sup', dateKey: 'date',
    request: { division: 'bci', statut: 'demandee', titre: "Demande d'appui du S.W.A.T." },
    statuts: { planifiee: ['Planifiée', 'info'], briefing: ['Briefing', 'warn'], en_cours: ['En cours', 'danger'], terminee: ['Terminée', 'ok'], annulee: ['Annulée', ''], demandee: ['Demande du BCI', 'warn'] },
    fields: [
      { key: 'nom', label: 'Nom de code', required: true, placeholder: 'Ex. : Opération Tempête' },
      { key: 'type', label: 'Type', type: 'select', required: true, options: ['Mandat à haut risque', "Prise d'otages", 'Braquage', 'Forcené retranché', 'Opération contre un gang', 'Protection / escorte', 'Entraînement'] },
      { key: 'lieu', label: 'Lieu', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'heure', label: 'Heure', type: 'time' },
      { key: 'menace', label: 'Niveau de menace', type: 'select', options: ['Faible', 'Modéré', 'Élevé', 'Extrême'] },
      { key: 'plan', label: "Plan d'assaut", type: 'select', ref: 'plans' },
      { key: 'dossier', label: 'Dossier BCI', link: 'enquetes', placeholder: 'BCI-AAAA-NNNN' },
      { key: 'references', label: 'Autres références', placeholder: 'Mandat, plainte, rapport…' },
      { section: 'Renseignement' },
      { key: 'objectif', label: 'Objectif', type: 'textarea', required: true },
      { key: 'suspects', label: 'Suspects : nombre, armement, comportement', type: 'textarea' },
      { key: 'civils', label: 'Otages et civils', type: 'textarea' },
      { section: 'Dispositif' },
      { key: 'composition', label: 'Composition', type: 'rows', columns: [
        { key: 'agent', label: 'Opérateur', placeholder: 'Matricule', list: 'users' },
        { key: 'equipe', label: 'Équipe', type: 'select', options: EQUIPES },
        { key: 'role', label: 'Rôle', type: 'select', options: ROLES_SWAT },
      ] },
      { key: 'radio', label: 'Fréquence radio', placeholder: 'Ex. : Radio 3' },
      { key: 'codes', label: 'Mots de code', placeholder: 'Ex. : « Tonnerre » = assaut' },
      { key: 'vehicules', label: 'Véhicules et équipement', placeholder: 'Ex. : 2 blindés, bélier, boucliers' },
      { section: 'Briefing' },
      { key: 'deroule', label: "Plan d'action", type: 'textarea' },
      { key: 'engagement', label: "Règles d'engagement", type: 'textarea' },
      { section: "Journal d'opération" },
      { key: 'journal', label: 'Événements', type: 'rows', columns: [
        { key: 'heure', label: 'Heure', type: 'time' },
        { key: 'evenement', label: 'Événement' },
      ] },
      { section: 'Débriefing' },
      { key: 'interpellations', label: 'Interpellations' },
      { key: 'blesses', label: 'Blessés' },
      { key: 'saisies', label: 'Saisies' },
      { key: 'incident', label: "Rapport d'incident", placeholder: 'INC-AAAA-NNNN' },
      { key: 'retex', label: "Retour d'expérience", type: 'textarea' },
    ],
  },
  plans: {
    division: 'swat',
    titre: "Plans d'assaut", nouveau: 'Nouveau plan', agent: 'Rédacteur', icon: 'map',
    aide: "Stratégies d'assaut préparées pour les lieux sensibles, réutilisables d'une opération à l'autre.",
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { brouillon: ['Brouillon', 'warn'], valide: ['Validé', 'ok'], archive: ['Archivé', ''] },
    fields: [
      { key: 'titre', label: 'Titre', required: true, placeholder: 'Ex. : Pacific Standard Bank, assaut principal' },
      { key: 'cible', label: 'Type de cible', type: 'select', required: true, options: ['Banque', 'Bijouterie', 'Supérette', 'Habitation', 'Entrepôt / hangar', 'Véhicule', 'Zone extérieure', 'Autre'] },
      { key: 'lieu', label: 'Adresse / lieu', required: true },
      { key: 'date', label: 'Date de rédaction', type: 'date', required: true },
      { section: 'Reconnaissance' },
      { key: 'description', label: 'Description des lieux', type: 'textarea' },
      { key: 'acces', label: "Points d'entrée et accès", type: 'textarea' },
      { key: 'positions', label: "Périmètre et positions des tireurs d'élite", type: 'textarea' },
      { key: 'risques', label: 'Zones à risque', type: 'textarea' },
      { section: 'Stratégie' },
      { key: 'phases', label: 'Déroulé par phases', type: 'rows', columns: [
        { key: 'phase', label: 'Phase', type: 'select', options: ['Approche', 'Bouclage', 'Négociation', 'Mise en place', 'Assaut', 'Sécurisation', 'Extraction'] },
        { key: 'equipe', label: 'Équipe', type: 'select', options: EQUIPES },
        { key: 'action', label: 'Action' },
        { key: 'signal', label: 'Signal / top', placeholder: 'Ex. : « Tonnerre »' },
      ] },
      { key: 'engagement', label: "Règles d'engagement", type: 'textarea' },
      { key: 'repli', label: 'Plan de repli et contingences', type: 'textarea' },
      { section: 'Croquis tactique' },
      { key: 'croquis', label: 'Croquis', type: 'sketch', units: UNITES_SWAT },
      { key: 'schemas', label: 'Photos et repérages', type: 'photos' },
    ],
  },
  // Catalogue des formations : visible par tous les agents, tenu par l'Academy (page « Formations »)
  catalogue: {
    division: 'academy', menu: false,
    titre: 'Formations', nouveau: 'Nouvelle formation', agent: 'Formateur référent', icon: 'book',
    aide: 'Catalogue des formations du SASP et de leurs prérequis.',
    view: 'all', create: 'sup',
    statuts: { active: ['Active', 'ok'], archivee: ['Archivée', ''] },
    fields: [
      // Une formation est une entrée de « Qualifications & formations » (Administration → Paramètres)
      { key: 'nom', label: 'Formation', required: true, settings: 'qualifications', extend: true, fixed: true, unique: true, placeholder: 'Choisir dans la liste ou saisir une nouvelle formation' },
      { key: 'categorie', label: 'Catégorie', type: 'select', options: ['Fondamentaux', 'Armement', 'Conduite', 'Intervention', 'Communication', 'Spécialisation'] },
      { key: 'rookie', label: 'Programme rookie', type: 'select', options: ['Oui', 'Non'] },
      { key: 'duree', label: 'Durée', placeholder: 'Ex. : 1 h 30' },
      { key: 'grade_min', label: 'Grade minimum', type: 'select', settings: 'grades' },
      { key: 'prerequis', label: 'Formations prérequises', type: 'rows', columns: [{ key: 'formation', label: 'Formation', settings: 'qualifications' }] },
      { key: 'description', label: 'Contenu et objectifs', type: 'textarea' },
      { key: 'evaluation', label: "Modalités d'évaluation", type: 'textarea' },
    ],
  },
  // Formation attribuée à un agent, puis évaluée (page « Suivi des rookies »)
  formations: {
    division: 'academy', menu: false,
    titre: 'Évaluations', nouveau: 'Attribuer une formation', agent: 'Rookie', icon: 'cap', grant: { statut: 'validee', field: 'module' },
    aide: 'Formations attribuées aux agents et leurs évaluations. Chaque agent voit les siennes.',
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { planifiee: ['Attribuée', 'info'], validee: ['Validée', 'ok'], a_revoir: ['À revoir', 'warn'], echouee: ['Échouée', 'danger'] },
    fields: [
      { key: 'module', label: 'Formation', type: 'select', required: true, settings: 'qualifications' },
      { key: 'type', label: 'Type', type: 'select', required: true, options: ['Formation initiale', 'Formation continue', 'Évaluation pratique', 'Examen théorique', 'Fin de probation'] },
      { key: 'note', label: 'Note', placeholder: 'Ex. : 16/20' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'observations', label: 'Observations du formateur', type: 'textarea' },
    ],
  },
  // Notes libres sur un rookie (comportement, progrès…), hors formation
  notes_recrue: {
    division: 'academy', menu: false,
    titre: 'Notes de suivi', nouveau: 'Ajouter une note', agent: 'Rookie', icon: 'edit',
    aide: 'Notes des formateurs sur la progression des rookies.',
    view: 'own', create: 'sup', dateKey: 'date',
    statuts: { note: ['Note', ''] },
    fields: [
      { key: 'type', label: 'Type', type: 'select', required: true, options: ['Observation', 'Point positif', 'Point à améliorer', 'Avertissement'] },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'texte', label: 'Note', type: 'textarea', required: true },
    ],
  },
};
