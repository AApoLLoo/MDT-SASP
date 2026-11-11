// Types de rapport d'incident, partagés entre le navigateur et le serveur (chapitres X à XII du manuel).
// Chaque type ajoute ses propres champs, rangés dans `details`. Les champs `required` sont
// exigés à la finalisation, pas à l'enregistrement d'un brouillon.

export const INCIDENT_TYPES = {
  usage_force: {
    titre: 'Usage de la force',
    fields: [
      { key: 'moyen', label: 'Moyen employé', type: 'select', required: true, options: ['Contrainte physique', 'Matraque', 'Taser', 'Bean Bag', 'Arme létale', 'Autre'] },
      { key: 'tirs', label: 'Nombre de tirs', placeholder: 'Arme létale ou Bean Bag' },
      { key: 'justification', label: 'Justification (danger immédiat)', type: 'textarea', required: true },
      { key: 'blesses', label: 'Blessés et soins apportés', type: 'textarea' },
    ],
  },
  poursuite: {
    titre: 'Course poursuite',
    fields: [
      { key: 'vehicule', label: 'Véhicule poursuivi', required: true, placeholder: 'Modèle, couleur, plaque' },
      { key: 'zone', label: 'Zone', type: 'select', options: ['Zone urbaine', 'Autoroute', 'Zone rurale', 'Mixte'] },
      { key: 'depart', label: 'Point de départ' },
      { key: 'fin', label: 'Point de fin' },
      { key: 'duree', label: 'Durée', placeholder: 'Ex. : 12 min' },
      { key: 'issue', label: 'Issue', type: 'select', required: true, options: ['Interpellation', 'Suspect en fuite', 'Accident', 'Poursuite abandonnée'] },
      { key: 'dommages', label: 'Dommages et blessés', type: 'textarea' },
    ],
  },
  haut_risque: {
    titre: 'Intervention à haut risque',
    fields: [
      { key: 'nature', label: 'Nature', type: 'select', required: true, options: ['Braquage', "Prise d'otages", 'Fusillade', 'Opération contre un gang', 'Autre'] },
      { key: 'unites', label: 'Unités engagées', placeholder: 'SWAT, GND, EMS…' },
      { key: 'victimes', label: 'Otages et victimes', type: 'textarea' },
      { key: 'bilan', label: 'Bilan (interpellations, blessés, saisies)', type: 'textarea', required: true },
    ],
  },
  accident: {
    titre: 'Accident de la route',
    fields: [
      { key: 'vehicules', label: 'Véhicules impliqués', type: 'textarea', required: true },
      { key: 'blesses', label: 'Blessés', type: 'textarea' },
      { key: 'assistance', label: 'Services appelés', placeholder: 'EMS, dépanneuse…' },
    ],
  },
  autre: { titre: 'Autre incident', fields: [] },
};

export const incidentTitre = type => INCIDENT_TYPES[type]?.titre ?? type;
