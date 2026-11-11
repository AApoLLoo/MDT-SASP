// Données de référence statiques reprises des onglets « Defcon » et « Droit Miranda » de l'Excel

export const DEFCON = [
  { niveau: 5, signification: 'Aucun danger', duree: 'Indéterminée', prolongement: '—', autorisation: 'Gouvernement + FDO', droits: "Contrôle d'identité (sans palpation)", equipement: 'Gilet sans poche & arme légère', amendes: '—' },
  { niveau: 4, signification: 'Potentielle menace à la sécurité publique', duree: '1 à 96 h', prolongement: '1 à 48 h', autorisation: 'Procureur général ou Gouvernement + FDO', droits: "Palpation de sécurité + contrôle d'identité", equipement: 'Gilet avec poche + arme lourde dans le coffre', amendes: '—' },
  { niveau: 3, signification: 'Menace à la sécurité publique en cours', duree: '1 à 72 h', prolongement: '1 à 48 h', autorisation: 'Procureur général ou Gouvernement + FDO', droits: "Fouille & contrôle d'identité", equipement: 'Gilet avec poche & arme lourde autorisée en contrôle', amendes: "Jusqu'à ×1,5 sur les amendes" },
  { niveau: 2, signification: "La sécurité publique ne peut pas être défendue afin de rétablir l'ordre", duree: '1 à 48 h', prolongement: '1 à 24 h', autorisation: 'Gouverneur + FDO', droits: "Fouille (citoyen et coffre de véhicule) & contrôle d'identité", equipement: 'Gilet avec poche & arme lourde autorisée en déplacement', amendes: "Jusqu'à ×3 sur les amendes" },
  { niveau: 1, signification: "L'État de San Andreas est en guerre", duree: '1 à 96 h', prolongement: '1 à 96 h', autorisation: 'Gouverneur + FDO', droits: "Fouille & contrôle d'identité sur les citoyens ne respectant pas les directives", equipement: 'Gilet lourd & arme lourde autorisée pour tout déplacement', amendes: "Jusqu'à ×3 sur les amendes" },
];

export const defconInfo = n => DEFCON.find(d => d.niveau === Number(n)) || DEFCON[0];

export const MIRANDA_INTRO = [
  "Lors de votre serment, il est obligatoire de déclarer l'individu en état d'arrestation et de lui préciser ses droits fondamentaux, tels que le droit au silence et le droit d'être assisté par un avocat. Vous devez également lui demander s'il a bien compris ses droits.",
  'Lors de l\'arrestation d\'un suspect, palpez-le avant de le mettre dans le véhicule. Précisez la différence entre palpation et fouille.',
  'Vous disposez de 15 minutes pour son transport au poste et la lecture des droits Miranda.',
];

export const MIRANDA_NOTE = "Si un individu déclare plus de 2 fois qu'il n'a pas compris ses droits, et qu'il ne présente aucune déficience mentale, psychique, psychiatrique ou intellectuelle, ses droits fondamentaux sont considérés comme compris et acceptés, conformément à la Constitution américaine.";

// Script lu au suspect : renvoie une liste de paragraphes
export function mirandaScript({ nom = '…', date = '…', heure = '…', charges = [] } = {}) {
  const n = charges.length;
  return [
    `Monsieur/Madame ${nom}, nous sommes le ${date}, il est actuellement ${heure}.`,
    n
      ? `Vous êtes en état d'arrestation pour ${n} chef${n > 1 ? 's' : ''} d'accusation : ${charges.join(' ; ')}.`
      : "Vous êtes en état d'arrestation.",
    'Vous avez le droit de garder le silence. Si vous renoncez à ce droit, tout ce que vous direz pourra être et sera utilisé contre vous devant une cour de justice.',
    'Vous avez le droit de voir un médecin, de boire et de manger.',
    'Vous avez droit à un avocat et à un appel téléphonique. Ce droit est uniquement disponible lorsque ceux-ci sont en ville.',
    "Durant chaque interrogatoire, vous pourrez décider à tout moment d'exercer vos droits restants, de ne répondre à aucune question ou de ne faire aucune déposition.",
    'Toutefois, les charges retenues peuvent évoluer au cours de la procédure.',
    'Avez-vous bien compris vos droits ? (il/elle doit obligatoirement répondre)',
    'Souhaitez-vous faire valoir un de ces droits ? (il/elle doit obligatoirement répondre)',
  ];
}

// Valeurs initiales des listes réglables (Administration → Paramètres) : ne servent qu'à la création de la base
export const DIVISIONS = ['Patrouille', 'Sécurité routière', 'Unité motocycliste', 'Air Support', 'Investigation', 'SWAT', 'GND', 'Formation', 'Commandement'];
export const QUALIFICATIONS = ['Permis moto', 'Pilote hélicoptère', "Conduite d'intervention", 'Tireur d\'élite', 'Négociateur', 'Formateur', 'Secourisme', 'Brigade canine', 'Enquêteur'];

// Grades du manuel officiel (chapitre II), du plus bas au plus élevé
export const GRADES = ['Rookie', 'Officier I', 'Officier II', 'Officier III', 'Senior Lead Officer', 'Sergent', 'Sergent-Chef', 'Lieutenant', 'Lieutenant-Chef', 'Capitaine', 'Commandant', 'Chief'];

// Grades internes du S.W.A.T., du plus bas au plus élevé (valeurs initiales, réglables ensuite)
export const GRADES_SWAT = ['Recrue', 'Opérateur', 'Opérateur confirmé', "Chef d'équipe", 'Chef de colonne', 'Commandant adjoint', 'Commandant SWAT'];

// Grades internes du BCI, du plus bas au plus élevé (valeurs initiales, réglables ensuite)
export const GRADES_BCI = ['Detective', 'Formateur BCI', 'Superviseur BCI', 'C.O. BCI', 'Head of BCI'];

// Répertoire des codes de patrouille (Excel « Répertoire des codes de patrouille - Spirit SASP »)
export const CODES_10 = [
  ['10-1', 'Mauvaise réception radio / Radio défectueuse 📵'], ['10-2', 'Signal clair 📡'], ['10-3', 'Fin de transmission 📴'],
  ['10-4', 'Affirmatif ✔️'], ['10-5', 'Négatif ❌'], ['10-6', 'Occupé / sauf urgence 🚫'],
  ['10-7', 'Hors service temporaire / Indisponible ❌'], ['10-8', 'Prise de service ✔️'], ['10-9', 'Répéter le dernier message radio 🔄'],
  ['10-10', 'Fin de service ❌'], ['10-13', 'Conditions météo et routières 🌡️'], ['10-14', 'Escorte / Convoi 🚔'],
  ['10-15', "Transport d'un prisonnier ⛓️"], ['10-17', 'Entretien véhicule ⛽'], ['10-19', 'En route vers… (préciser la localisation)'],
  ['10-20', 'Votre localisation 🗺️'], ['10-22', 'Annuler ou ignorer le dernier message ⛔'], ['10-23', 'Standby / attente de dispatch 🛑'],
  ['10-27', 'Sujet recherché'], ['10-28', "Vérification de l'immatriculation"], ['10-30', 'Bagarre ou rixe 👊'],
  ['10-31', "Tirs d'armes à feu 🔫"], ['10-35', "Demande de renfort sur position de l'officier (préciser rue, etc.)"], ['10-38', 'Contrôle routier 🚧'],
  ['10-40', 'Braquage de supérette 🏪'], ['10-41', 'Début de patrouille 🚓✔️'], ['10-42', 'Fin de patrouille 🚓❌'],
  ['10-49', "Accident grave, présence d'un danger à haut risque 🚗⚠️"], ['10-50', 'Accident de la route 🚗💥'], ['10-51', 'Demande dépanneuse 🚚'],
  ['10-52', 'Demande ambulance 🚑'], ['10-56', "Refus d'obtempérer 🚗"], ['10-57', 'Délit de fuite'],
  ['10-58', 'Course poursuite'], ['10-59', 'Vol de véhicule 🚗'], ['10-60', 'Vente de drogue 💊'],
  ['10-90', 'Cambriolage en cours 🏠'], ['10-91', 'Braquage de banque 💵'], ['10-92', 'Braquage de bijouterie 💍'],
  ['10-93', "Prise d'otage"], ['10-97', 'Arrivé sur intervention 📍 (équivalent du code 6)'], ['10-99', 'Officier en danger 🆘'],
];

export const CODES = [
  ['Code 1', 'Discret : intervenir sans gyrophare ni sirène'], ['Code 2', 'Urgent : répondre avec gyrophare mais sans sirène'],
  ['Code 3', 'Prioritaire : répondre avec gyrophare et sirène 🚨'], ['Code 4', 'Aucune autre assistance nécessaire, situation stable'],
  ['Code 5', 'En surveillance, éviter la zone 🔎'], ['Code 6', 'Arrivé sur intervention 📍'],
  ['Code 6 Adam', "Arrivé, peut avoir besoin d'unités proches"], ['Code 6 Charles', 'Arrivé, suspect dangereux ⚠️'],
  ['Code 20', 'Notifiez les médias 🎥'], ['Code 99', 'Officier en danger, besoin de toutes les unités disponibles ! 🆘'],
  ['Code 100', 'Unité en position pour intercepter'], ['Code Albert', 'Requête pour déploiement fusil / carabine sur scène 🔫'],
];

export const INDICATIFS = [
  ['Lincoln', '1 effectif'], ['Adam', '2 effectifs'], ['Tango', '3 effectifs'], ['X-Ray', '4 effectifs'],
  ['David', "1re colonne d'assaut du SWAT"], ['Goliath', "2e colonne d'assaut du SWAT"], ['K-9', 'Patrouille avec un officier canin 🐶'],
  ['H / ASU', 'Patrouille héliportée (« H » pour Henry ou « ASU » pour Air Support Unit) 🚁'], ['M', 'Motorcycle Unit (« M » pour Mary)'],
  ['B', 'Unité bateau (« B » pour Bravo) 🚤'], ['N', 'Narcotics (« N » pour Nora)'], ['S', 'Patrouille Detective Division (« Sierra »)'],
  ['V', 'Patrouille cycliste (« V » pour Victor) 🚲'], ['W', 'Patrouille SWAT banalisée (« W » pour William)'], ['VIR', 'Patrouille en VIR pour la HSP'],
];

export const ALPHABET = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike',
  'November', 'Oscar', 'Papa', 'Québec', 'Roméo', 'Sierra / Spectre', 'Tango', 'Uniforme', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zoulou'];
