# SASP — site public et MDT

Un seul projet, un seul serveur : le **site public** à la racine (`/`) et le **MDT** sous `/mdt/`. Le site lit directement la base du MDT (comptes, grades, divisions, secteurs) : c'est le MDT qui fait foi.

## MDT

Mobile Data Terminal web du SASP. Il réunit dans un seul outil partagé le **bordereau d'arrestation** (`Bordereaux de XXXXX.docx`) et la **calculatrice de peine** (`Calculatrice de peine - SASP - SPIRIT.xlsx`), et ajoute les briques d'un MDT : casiers judiciaires, plaintes, véhicules volés, mandats/BOLO, Code pénal, références, effectifs et profils d'agents.

## Démarrage

Prérequis : **Node.js 22.13 ou plus récent** (la base SQLite est intégrée à Node, rien d'autre à installer).

```bash
npm install
npm start
```

Ouvrez ensuite <http://localhost:3000> pour le site, <http://localhost:3000/mdt/> pour le MDT.

Au premier lancement, un compte administrateur est créé et ses identifiants sont affichés dans la console : matricule `admin`, mot de passe généré aléatoirement. Connectez-vous au MDT, changez ce mot de passe (« Mon compte »), puis créez les comptes des agents dans **Administration**.

La configuration se fait par variables d'environnement, ou dans un fichier `.env` à la racine (modèle : `.env.example`), lu par `npm start`.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` / `HOST` | Port HTTP / adresse d'écoute (`127.0.0.1` derrière un reverse proxy) | `3000` / toutes |
| `DATA_DIR` | Dossier des données : base SQLite, photos du MDT, données du site (`site/`) | `./data` |
| `ADMIN_MATRICULE` / `ADMIN_PASSWORD` | Identifiants du premier administrateur du MDT (premier lancement uniquement) | `admin` / généré |
| `TRUST_PROXY` | `1` derrière un reverse proxy HTTPS : cookies `Secure` du MDT, IP réelle pour les limites du site | — |
| `SECURE_COOKIES` | `true` une fois le site servi en HTTPS (cookies `Secure` du site) | `false` |
| `BACKUP_KEEP` | Nombre de sauvegardes quotidiennes conservées dans `data/backups/` | `14` |
| `SITE_ADMIN_PASSWORD` | Mot de passe de secours de `/admin` (12 caractères minimum conseillés). Vide = accès par compte MDT uniquement | — |
| `DISCORD_WEBHOOK_URL` | Salon Discord qui reçoit les candidatures | — |
| `DISCORD_TICKETS_WEBHOOK_URL` | Salon Discord des nouvelles demandes civiles | `DISCORD_WEBHOOK_URL` |
| `SITE_URL` | Adresse publique du site, pour les liens des notifications Discord | — |

## Utilisation

- **Casiers** : liste des citoyens ayant au moins une arrestation finalisée. Le casier d'une personne affiche le cumul (arrestations, amendes, GAV) et chacun de ses rapports.
- **Photos** : un emplacement vide suit toujours la dernière photo, jusqu'à 20 (`numberedSlots` et groupes `extra` dans `public/mdt/js/components/photos.js`). C'est le cas des casiers, véhicules volés, mandats / BOLO, rapports d'incident, preuves des plaintes, dossiers de division et « Autres photos » du rapport d'arrestation (les autres emplacements du bordereau restent fixes).
  - Les listes de véhicules et de mandats indiquent le nombre de photos. Sur le casier, chaque photo s'enregistre aussitôt ; ailleurs, avec le formulaire.
- **Plaintes** : dépôt de plainte avec plaignant, mis en cause (identifié ou non, avec signalement), faits qualifiés selon le Code pénal, déclaration, préjudice, témoins, preuves et suivi d'enquête.
  - Statuts : ouverte, enquête en cours, classée sans suite, résolue.
  - « Créer le rapport d'arrestation » ouvre un rapport pré-rempli (mis en cause et infractions) et le lie à la plainte.
  - Exports : procès-verbal imprimable et texte Discord.
- **Véhicules volés** : déclaration d'un vol (plaque, date, lieu, propriétaire), vérification d'une plaque, BOLO. Un véhicule « retrouvé » clôt automatiquement ses BOLO actifs.
- **Rapport d'arrestation** : depuis un casier ou le tableau de bord. Le rapport suit les blocs du bordereau : en-tête, suspect, chefs d'accusation (calculatrice intégrée), Miranda, objets saisis, faits, photos. Les photos peuvent être collées (Ctrl+V), glissées, importées ou données par lien.
- **Finaliser** verse le rapport au casier du suspect, propose de clore ses mandats actifs et met chaque objet saisi sous scellé. Un rapport finalisé n'est plus modifiable, sauf par un superviseur.
- **Rapport d'incident** : usage de la force, course poursuite, intervention à haut risque, accident ou autre. Chaque type a ses propres champs (moyen employé et justification, véhicule poursuivi et issue, etc.), exigés à la finalisation. Même cycle brouillon → finalisé que le rapport d'arrestation, avec aperçu imprimable et export Discord.
- **Preuves** : registre des scellés (`PRV-AAAA-NNNN`), rattachés à un rapport d'arrestation ou d'incident. Changer le statut (en stock, sortie temporaire, transmise à la justice, restituée, détruite) ou l'emplacement d'un scellé demande un motif. Chaque mouvement est tracé : c'est la chaîne de possession affichée sur la fiche.
- **Aperçu** : bordereau imprimable (Imprimer → « Enregistrer en PDF »), ou texte prêt à coller dans Discord, découpé en messages de 2 000 caractères.
- **Calculatrice** : utilisable seule (contrôle routier) ; « Créer un rapport avec ces chefs » ouvre un rapport pré-rempli.

- **Annonces** : quatre catégories, générales, opérationnelles, Academy et division (une annonce de division vise une division précise).
  - Chaque annonce a un niveau d'importance, une image facultative et peut être épinglée.
  - Les superviseurs publient partout. Les agents ayant la qualification « Formateur » publient dans Academy.
  - La lecture est suivie annonce par annonce, pour chaque agent.
  - Une nouvelle annonce déclenche un ping dans les 30 secondes : notification cliquable avec un son (rouge si urgente), pastille pulsante dans le menu et compteur dans le titre de l'onglet. Un rappel des annonces non lues s'affiche à la connexion.
  - Les annonces non lues portent un marqueur « Nouveau », dans le fil et sur le tableau de bord.
- **Service** :
  - **Patrouilles** : tableau partagé des unités en service (indicatif, agents, véhicule, secteur Sud ou Nord, poste de rattachement Mission Row ou Paleto Bay, statut), rafraîchi automatiquement. Tout agent peut créer son unité, changer son statut ou la passer hors service. Un agent ne peut appartenir qu'à une seule unité à la fois.
  - **Convocations** et **sanctions** : posées par les superviseurs, visibles par l'agent concerné.
  - **Absences** : déclarées par les agents, validées ou refusées par un superviseur, visibles par tous.
  - **Matériel perdu** : déclaré par l'agent, avec la suite donnée par un superviseur.
  - Le profil de chaque agent affiche son dossier administratif, visible uniquement par lui-même et par les superviseurs.
- **Divisions** : chaque agent voit dans le menu une catégorie supplémentaire par division dont il est membre. Un superviseur voit en plus la Police Academy ; l'état-major et les administrateurs les voient toutes. Elle donne accès à l'**Effectif** de la division puis à ses outils.
  - **Effectif** : les membres actifs. Pour le S.W.A.T. et le BCI, triés par grade interne ; un superviseur change ce grade directement dans la liste ou sur le profil. Les grades SWAT (Recrue → Commandant SWAT au départ) et BCI (Detective, Formateur BCI, Superviseur BCI, C.O. BCI, Head of BCI) se règlent dans Administration → Paramètres.
  - **BCI · Dossiers d'enquête** : liste des dossiers (recherche par numéro, objet, personne ou plaque ; dossiers actifs, par statut ou « Mes dossiers »), puis une page par dossier.
    - **Numéro de dossier** BCI-AAAA-NNNN, donné à l'ouverture et définitif. Il relie le dossier à ses actes, aux opérations du S.W.A.T. et aux autres dossiers.
    - En-tête : objet, nature, priorité, enquêteur référent, équipe d'enquête (co-enquêteurs, analyste…). Statuts : ouverte, en cours, suspendue, transmise au parquet, résolue, classée sans suite.
    - Synthèse : résumé des faits, hypothèses et pistes, conclusion.
    - **Personnes liées** (suspect, personne d'intérêt, témoin, victime, informateur) : recherchées au fichier des citoyens ou saisies sans fiche. Une personne fichée affiche ses mandats actifs et ses arrestations, et son casier liste les enquêtes où elle apparaît (visible par le BCI et les superviseurs). Un bouton émet un mandat ou un BOLO.
    - **Journal d'enquête** : actes consignés un par un (audition, interrogatoire, perquisition, filature, réquisition, interpellation, saisie, expertise…) avec date, heure, lieu, personnes, procès-verbal et photos. Statuts : réalisé, prévu, annulé.
    - **Documents liés** par leur numéro : rapports d'arrestation (SASP-), plaintes (PLT-), rapports d'incident (INC-), scellés (PRV-) et autres dossiers BCI (affaires connexes). Chacun s'affiche avec son type, son statut et un lien ; un numéro inconnu est signalé « Introuvable ».
    - **Tableau d'enquête** : le croquis partagé en temps réel (voir les plans d'assaut), avec des pions suspect, témoin, victime, informateur, organisation, lieu, véhicule, téléphone, preuve, arme et argent, à relier par des flèches. Un pion renommé (nom, plaque, adresse) affiche son étiquette dessous.
    - Véhicules, photos et documents.
    - La page s'actualise toute seule toutes les 15 s.
  - **BCI · Informateurs** : registre confidentiel des sources. Nom de code (unique), fiabilité (A à E), milieu, identité réelle, contact, contreparties, officier traitant, renseignements fournis avec leur dossier et leur vérification. Statuts : actif, suspendu, grillé, radié.
  - **S.W.A.T. · Opérations** : fiche d'opération en cinq parties. Statuts : planifiée, briefing, en cours, terminée, annulée, demande du BCI.
    - En-tête : nom de code, type, lieu, date, niveau de menace, plan d'assaut lié, **dossier BCI**, autres références.
    - **Lien avec le BCI** : le numéro du dossier BCI (contrôlé par le serveur) rattache l'opération à l'enquête.
      - La fiche d'opération résume le dossier : numéro, objet, statut, enquêteur référent.
      - La page du dossier liste ses opérations : nom, type, lieu, date, chef d'opération, statut.
      - Chaque division ne voit de l'autre que ce résumé ; l'état-major et les administrateurs voient tout.
    - **Demande d'appui** : depuis la page d'un dossier, un enquêteur adresse une demande au S.W.A.T. (statut « Demande du BCI »). Il la modifie ou la retire tant que le S.W.A.T. ne l'a pas prise en charge en changeant son statut.
    - Renseignement : objectif, suspects, otages et civils.
    - Dispositif : composition (opérateur, équipe, rôle), fréquence radio, mots de code, véhicules.
    - Briefing (plan d'action, règles d'engagement) et journal d'opération horodaté.
    - Débriefing : interpellations, blessés, saisies, rapport d'incident, retour d'expérience.
  - **S.W.A.T. · Plans d'assaut** : stratégies réutilisables par lieu (banque, bijouterie…) : reconnaissance (accès, positions, zones à risque), déroulé par phases avec équipe et signal, règles d'engagement, plan de repli, croquis tactique et photos. Statuts : brouillon, validé, archivé.
    - **Croquis tactique** : tableau plein écran, ouvert d'un clic sur l'aperçu du plan.
    - Fond : capture collée (Ctrl+V), image importée ou lien, sur une grille.
    - Outils : crayon, flèche, zone, texte, gomme, 7 couleurs, 3 épaisseurs, annulation.
    - Pions d'unités numérotés automatiquement (David, Goliath, Appui, Tireur d'élite, Négociateur, Medic, Commandement, Véhicule, Suspect, Otage, Point d'entrée, Objectif), à déplacer et renommer d'un double-clic.
    - **Partagé en temps réel** : tous ceux qui peuvent modifier le plan dessinent ensemble, et chacun voit les modifications des autres en direct.
    - La barre affiche « En direct » et les agents connectés. Tout s'enregistre seul, au plus une fois par seconde, sans bouton « Enregistrer ».
    - Sur un même élément, la dernière modification l'emporte pour tout le monde. « Annuler » ne défait que ses propres actions.
    - Le croquis s'ouvre une fois le plan enregistré.
    - Le croquis est vectoriel : tout reste modifiable plus tard (`public/mdt/js/components/sketch.js`).
    - Fonctionnement : flux SSE (`GET /api/service/:type/:id/live/:champ`) et opérations envoyées en `POST` sur la même adresse.
    - Derrière Nginx, rien à régler : l'en-tête `X-Accel-Buffering: no` est envoyé, et un ping toutes les 25 s garde la connexion ouverte.
    - Un seul processus serveur : les croquis ouverts sont tenus en mémoire.
  - **Academy · Formations** : catalogue des formations.
    - Les formations sont les entrées de **Qualifications & formations** (Administration → Paramètres) : chacune figure au catalogue.
    - L'Academy y complète la fiche : catégorie, durée, programme rookie (oui/non), grade minimum, formations prérequises, contenu, modalités d'évaluation, formateur référent.
    - Une formation créée depuis le catalogue rejoint la liste ; son nom se change ensuite dans l'administration, qui le reporte sur les fiches, prérequis et formations attribuées.
    - Classement des bases aux formations les plus avancées, d'après la chaîne de prérequis ; les entrées sans fiche suivent (« Fiche à compléter »).
    - Tenu par l'Academy et les superviseurs ; lisible par tous les agents.
  - **Academy · Suivi des rookies** : une carte par agent au grade Rookie, actualisée automatiquement toutes les 10 s.
    - Progression dans le programme rookie, puis chaque formation avec son état : à faire, attribuée, validée, à revoir, échouée, ou acquise si l'agent porte déjà la qualification. S'y ajoutent date, type, formateur, note, observations et prérequis manquants (formations ou grade).
    - **Tuteurs** : chaque rookie est confié à un ou plusieurs agents de l'Academy (cinq au plus), et un tuteur suit autant de rookies que nécessaire.
      - Réglés sur la carte du rookie par l'Academy ou un superviseur.
      - Un rookie sans tuteur est signalé, et un compteur en haut de page les recense.
      - Le filtre « Mes rookies » ne garde que les siens.
      - Les tuteurs apparaissent sur le profil du rookie, et ses rookies sur le profil du tuteur et dans l'Effectif de l'Academy.
    - Une formation **validée** s'ajoute aux qualifications du profil de l'agent (tracé dans l'historique).
    - Un clic sur une formation l'attribue ou ouvre son évaluation. Les boutons « Formation » et « Note » attribuent une formation hors programme ou ajoutent une note de suivi (observation, point positif, point à améliorer, avertissement).
    - Chaque agent peut lire ses propres évaluations et notes.
  - Les membres de la division, l'état-major et les administrateurs (et les superviseurs pour l'Academy) voient tous les dossiers, les créent, les modifient et changent leur statut. Les autres agents ne voient que les dossiers où ils sont l'agent concerné (une recrue voit ses évaluations).
  - **Plusieurs divisions par agent** : un superviseur coche les divisions sur le profil (par exemple BCI + Academy).
    - Exception : un agent ne peut pas être à la fois au BCI et au S.W.A.T. Le profil le signale, le serveur le refuse (`INCOMPATIBLES` dans `public/mdt/js/service-kinds.js`).
    - Les divisions sont reconnues par leur nom : « Investigation », « BCI », « Enquête » ou « Detective » pour le BCI ; « SWAT » ou « S.W.A.T. » ; « Academy », « SASPA », « Formation » ou « Formateur » pour l'Academy (motifs `match` dans le même fichier).
- **Références** : codes radio (codes 10, codes d'intervention, indicatifs des patrouilles, alphabet phonétique) avec recherche, catégories d'armes, Defcon et droits Miranda.
- **Historique** (superviseurs) : qui a fait quoi et quand. Sont tracés les créations, finalisations, réouvertures et suppressions de rapports, les modifications de rapports finalisés (avec l'écart d'amende), les mandats, les véhicules, les fiches citoyens, les plaintes, les scellés, les comptes, le Code pénal, les annonces, les dossiers de service, le Defcon, les paramètres et les sauvegardes manuelles. Les brouillons et les modifications d'un agent sur son propre profil ne sont pas tracés.
- **Administration** (administrateurs) :
  - **Comptes** : création, grade, rôle, révocation, réinitialisation du mot de passe. Un agent dont le grade n'est plus dans la liste des grades est signalé « hors liste ».
  - **Paramètres** : grades (dans l'ordre hiérarchique, qui trie les effectifs), divisions, qualifications, secteurs de patrouille et postes de rattachement. Renommer une valeur met à jour les agents, annonces et unités qui la portent. Les valeurs initiales reprennent le manuel officiel.
  - **Sauvegardes** : liste des sauvegardes de la base et sauvegarde immédiate.
- **Effectifs** : annuaire des agents, trié par grade. Chaque agent a un profil : photo, grade, matricule, divisions, date d'entrée et ancienneté, contact (téléphone, Discord), qualifications, présentation et statistiques d'activité.

- **Un seul onglet** : le MDT ne s'utilise que dans un onglet à la fois. Un deuxième onglet affiche « MDT déjà ouvert » et propose « Utiliser le MDT ici », qui masque l'autre onglet sans le recharger. Les liens du site rouvrent l'onglet MDT existant. Ce contrôle demande le HTTPS (ou `localhost`).

Rôles :
- **Agent** : rédige ses rapports. Sur son propre profil, il modifie sa photo, son téléphone, son Discord, sa présentation et son mot de passe.
- **Superviseur** : modifie ou rouvre tous les rapports, supprime des fiches et des scellés, change le niveau Defcon, consulte l'historique. Il fixe aussi les divisions, la date d'entrée et les qualifications des agents. Côté divisions, il n'accède qu'à la Police Academy et aux siennes (`DIVISIONS_SUPERVISEUR` et `managesDivision` dans `public/mdt/js/service-kinds.js`).
- **État-major** : a tous les droits du superviseur, sur toutes les divisions. Il n'a pas accès à l'Administration (comptes, paramètres, sauvegardes) ni à la modification du Code pénal.
- **Administrateur** : a tous les droits de l'état-major. Il gère les comptes (création, matricule, nom, grade, rôle, révocation, réinitialisation du mot de passe), les paramètres du MDT, le Code pénal et les sauvegardes.

## Règles de calcul

Elles reprennent les formules de l'onglet « Calculatrice Peine » (testées dans `test/calc.test.js`) :

- **Pour chaque chef d'inculpation :**
  - amende = amende du code × quantité × 0,8 en cas d'atténuation, divisée par 2 en cas de tentative ou de complicité ;
  - peine = peine du code × 0,8 en cas de tentative, × 0,9 en cas de complicité, × 0,8 en cas d'atténuation ;
  - la quantité ne joue pas sur la peine.
- **Sur le total :**
  - retenue MAX : ×2, avec un approbateur obligatoire ;
  - prévenu mineur : ÷2 ;
  - vice de procédure : tout est ramené à 0 ;
  - majoration Defcon : ×1,5 au Defcon 3, jusqu'à ×3 aux Defcon 2 et 1 (amendes uniquement).
- **Conversion en GAV** : au-delà de 50 000 $, l'excédent peut être converti en garde à vue, à raison de 100 000 $ par heure. L'amende est alors ramenée à 50 000 $.
- **Caution** :
  - impossible s'il y a au moins un crime ;
  - sinon, amende × 1,3 (1 à 5 chefs), × 1,7 (6 à 10 chefs) ou × 2 (au-delà de 10).
- **Alerte « Appelez un Procureur / Juge »** : à partir de 5 délits mineurs, de 3 délits majeurs ou d'un seul crime.

Deux points de l'Excel étaient ambigus et ont été interprétés : la retenue Nominale vaut ×1 et MAX ×2 ; après conversion, l'amende est ramenée à 50 000 $.

Le Code pénal et les armes sont importés une seule fois depuis `server/seed/*.json` (extraits de l'Excel) au premier lancement. Ensuite, le Code pénal se modifie depuis la page **Code pénal** (administrateur).

## Site public

Pensé d'abord pour les civils.

- **Civils**, sans compte :
  - `/contact` pour envoyer un signalement, une question ou une demande de rendez-vous ;
  - à l'envoi, un code de suivi `SASP-XXXX-XXXX-XXXX` est affiché ;
  - `/suivi` permet de lire les réponses et de répondre avec ce code.
- **Agents** sur `/agent`, avec leur matricule et leur mot de passe du MDT (comptes actifs uniquement) :
  - demandes civiles : répondre, assigner, prioriser, notes internes, clôturer ;
  - messagerie interne entre agents, par matricule ;
  - notes de service, publiées par le commandement ;
  - bouton « Ouvrir le MDT ».
- **Commandement** = superviseurs, état-major et administrateurs du MDT. Ils accèdent à `/admin` (candidatures, actualités, droits PR) avec leur session agent. Un agent qui reçoit le droit PR publie les actualités. `SITE_ADMIN_PASSWORD` donne aussi accès à `/admin`, en secours.
- **Journal** : une actualité de catégorie « Journal » s'affiche comme une une de journal (en-tête, barre d'édition, encadrés).
  - Tous les textes de l'en-tête se saisissent dans l'éditeur, édition par édition : surtitre, nom du journal, slogan, numéro d'édition, devise et phrase de fin. Un texte vide n'est pas affiché. Une nouvelle édition reprend ceux de la précédente, sauf le numéro.
  - Dans l'éditeur, chaque bloc **Rubrique** ouvre un encadré (Arrestations, Saisies…). Dans un encadré, l'intertitre devient le titre, les photos se placent à côté du texte et la citation devient le bandeau de fin.
  - Choisir « Journal » sur une actualité vide pré-remplit cinq rubriques. Les blocs laissés vides disparaissent à l'enregistrement.- **Le service** (`/service`) : mission et valeurs, grades (classés en officiers, encadrement et commandement), divisions, domaines de formation, parcours de carrière. Les grades internes du S.W.A.T. et du BCI et le nom des formations ne sont pas publiés : la page donne seulement le nombre de formations et les domaines du catalogue (`FORMATION_DOMAINS`). Le texte public de chaque grade est dans `GRADE_TEXT`, et le premier grade de chaque palier dans `GRADE_TIERS` (`server/site/app.js`).
- **Repris du MDT** : nom, grade et rôle des agents, grades, divisions, nombre de formations, postes et secteurs affichés sur l'accueil et sur `/service`, secteurs de patrouille proposés dans le formulaire de recrutement (« SASP Sud », « SASP Nord »…). Modifier ces listes dans **Administration → Paramètres** du MDT met le site à jour. Le texte public de chaque division est dans `DIVISION_TEXT` (`server/site/app.js`) : une division ajoutée ou renommée s'affiche sans description tant qu'il n'est pas écrit.
- **Mode sombre** : suit le réglage du système ; le bouton « Mode sombre » (barre du haut, espace agent, administration) le force et le choix est mémorisé dans le navigateur.
- **Conservation** : les demandes clôturées et les candidatures traitées sont supprimées automatiquement 6 mois après.
- Les données du site (actualités, demandes, candidatures, photos) sont des fichiers JSON dans `data/site/`.

## Hébergement

Il faut un serveur qui garde le dossier `data/` d'un redémarrage à l'autre : un VPS, ou un service avec disque persistant (Railway, Fly.io…). Les offres gratuites sans disque effacent les données.

1. Copiez le projet, puis lancez `npm install --omit=dev` et `npm start` (de préférence avec un gestionnaire de processus comme `pm2` ou un service systemd).
2. Placez-le derrière un reverse proxy HTTPS (Caddy, Nginx) et définissez `TRUST_PROXY=1`, `SECURE_COOKIES=true` et `HOST=127.0.0.1`. Un seul domaine suffit : le proxy renvoie tout vers le port du serveur, qui sert le site et `/mdt/`. Le bouton « Copier » de l'export Discord a besoin du HTTPS hors `localhost`.
3. **Sauvegarde** : le serveur sauvegarde la base une fois par jour dans `data/backups/` (au démarrage, puis dès que la dernière sauvegarde a plus de 24 h) et garde les 14 plus récentes. `npm run backup` en fait une tout de suite. Les sauvegardes passent par `VACUUM INTO` : elles sont cohérentes même serveur allumé, ce que ne garantit pas une simple copie de `mdt.sqlite` (les dernières écritures sont dans `mdt.sqlite-wal`).
   - Pour se protéger d'une perte du serveur, copiez régulièrement `data/backups/`, `data/uploads/` et `data/site/` ailleurs (les données du site ne sont pas dans la base).
   - Restauration : arrêtez le serveur, remplacez `data/mdt.sqlite` par la sauvegarde choisie, supprimez `mdt.sqlite-wal` et `mdt.sqlite-shm`, puis relancez.
   - Au même moment, les images importées depuis plus de 7 jours que ni la base ni aucune sauvegarde conservée ne référencent sont supprimées de `data/uploads/`.

## Développement

```bash
npm run dev   # redémarre le serveur à chaque modification
npm test      # moteur de calcul, sauvegarde, images, liaison site ↔ MDT, API du site
```

Tout le projet est en JavaScript natif, en modules ES, sans étape de build. L'arborescence suit les URL :

| Dossier | Contenu | Servi à |
| --- | --- | --- |
| `server/index.js` | Point d'entrée unique : monte le MDT sous `/mdt/` et le site à la racine, et donne au site les comptes du MDT (`siteAuth` dans `server/auth.js`) et ses listes | — |
| `server/` | API du MDT, en Express avec `node:sqlite` | `/mdt/api/` |
| `server/site/` | Back-end du site public (`app.js`), en `node:http` | `/` |
| `public/` | Front du site public (CSS, scripts, images) | `/` |
| `public/mdt/` | Front du MDT. Ses chemins sont relatifs (`api/…`, `img/…`) pour fonctionner sous `/mdt/` | `/mdt/` |
| `views/` | Pages HTML du site, assemblées par `server/site/app.js` | — |
| `test/` | Tous les tests, lancés par `npm test` | — |

Le moteur de calcul `public/mdt/js/calc.js` est partagé : le serveur recalcule les montants à chaque enregistrement, et c'est ce calcul qui fait foi.
