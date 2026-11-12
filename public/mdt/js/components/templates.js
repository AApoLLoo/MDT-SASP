import { html } from '../dom.js';

// Modèles de récit : trame chronologique à compléter (les [crochets] sont à remplacer)
const MODELES = {
  arrestation: {
    'Contrôle routier': `Le [date] vers [heure], en patrouille à [lieu], nous procédons au contrôle du véhicule [modèle / couleur], immatriculé [plaque], pour [motif du contrôle].
Le conducteur, [nom], [attitude]. [Constatations : documents, odeur, objets visibles…].
Nous procédons à son interpellation pour [infractions]. Lecture des droits Miranda à [heure].
Fouille : [résultat]. Transport au poste de [poste] sans incident.`,
    'Délit de fuite / poursuite': `Le [date] vers [heure], à [lieu], le véhicule [modèle], immatriculé [plaque], refuse d'obtempérer à notre signal d'arrêt.
Poursuite engagée sur [itinéraire], unités en soutien : [unités]. [Manœuvres dangereuses, collisions…].
Le véhicule est immobilisé à [lieu] par [méthode]. Le suspect, [nom], est interpellé à [heure]. Lecture des droits Miranda.
Fouille : [résultat]. Transport au poste de [poste].`,
    'Fusillade / usage d\'arme': `Le [date] vers [heure], appel pour [motif] à [lieu].
À notre arrivée, [situation constatée : tirs, nombre de suspects, victimes]. [Actions des agents, couverture, sommations].
Le suspect, [nom], est neutralisé / se rend à [heure]. Arme(s) saisie(s) : [armes]. Lecture des droits Miranda.
Blessés : [blessés / prise en charge EMS]. Scène sécurisée, preuves placées sous scellé : [scellés].`,
    'Vol / cambriolage': `Le [date] vers [heure], appel pour [vol / cambriolage] à [lieu], signalé par [plaignant].
À notre arrivée, [constatations]. Le suspect, [nom], est [surpris sur les lieux / identifié par…].
Objets retrouvés : [objets]. Interpellation à [heure], lecture des droits Miranda.
Fouille : [résultat]. Transport au poste de [poste].`,
  },
  incident: {
    'Usage de la force': `Le [date] vers [heure], à [lieu], lors de [contexte de l'intervention].
Le sujet, [nom / description], [comportement : résistance, menace…]. Sommations : [sommations].
Force employée : [niveau, moyens], par [agents]. Raison : [justification].
Conséquences : [blessures, prise en charge EMS]. Hiérarchie informée : [supérieur] à [heure].`,
    'Accident': `Le [date] vers [heure], à [lieu], accident impliquant [véhicules / personnes].
Circonstances : [déroulé]. Conditions : [météo, visibilité, chaussée].
Blessés : [blessés, prise en charge EMS]. Dégâts : [dégâts].
Mesures prises : [balisage, dépannage, constat].`,
  },
};

// Liste « Insérer un modèle… » placée juste avant le champ de récit
export const templateSelect = kind => html`<select class="input input-sm template-select no-print" data-template="${kind}" aria-label="Insérer un modèle de récit">
  <option value="">Insérer un modèle de récit…</option>
  ${Object.keys(MODELES[kind]).map(nom => html`<option>${nom}</option>`)}
</select>`;

document.addEventListener('change', e => {
  const select = e.target.closest?.('select[data-template]');
  if (!select?.value) return;
  const textarea = select.parentElement.querySelector('textarea');
  const texte = MODELES[select.dataset.template][select.value];
  select.value = '';
  if (!textarea) return;
  const current = textarea.value.trim();
  if (current && !confirm('Le récit contient déjà du texte. Ajouter le modèle à la suite ?')) return;
  textarea.value = current ? `${current}\n\n${texte}` : texte;
  textarea.dispatchEvent(new Event('input', { bubbles: true })); // marque la page comme modifiée
  textarea.focus();
});
