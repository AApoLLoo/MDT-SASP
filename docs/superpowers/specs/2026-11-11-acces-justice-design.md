# Accès justice au MDT : magistrats, avocats et jugement des rapports

Date : 2026-11-11 · Statut : à valider

## Pourquoi

Les rapports d'arrestation du MDT sont lus et tranchés par la justice : après l'arrestation, une
comparution immédiate a lieu dès qu'un procureur ou un juge est disponible. Le magistrat doit avoir
le dossier complet sous les yeux et la calculatrice pour appliquer des atténuations, retirer ou
requalifier des charges. Si le suspect a demandé un avocat, celui-ci doit pouvoir lire le dossier
de son client.

Aujourd'hui le MDT ne connaît que des comptes police (`agent`, `superviseur`, `etat_major`,
`admin`) et l'agent finalise lui-même son rapport. La justice ne reçoit que des copies figées
(PDF, Google Docs, texte Discord), sans calculatrice, et n'a aucune place dans le circuit.

## Objectifs

1. **Comptes justice** : deux nouveaux types de compte, *magistrat* (procureur ou juge) et
   *avocat*, qui se connectent sur l'écran de connexion existant du MDT.
2. **Circuit de jugement** : un rapport d'arrestation n'est plus finalisé par la police. L'agent le
   dépose « en attente de jugement » ; seul un magistrat ou un admin le finalise, après avoir
   ajusté le calcul. C'est la finalisation qui verse le rapport au casier, comme aujourd'hui.
3. **Avocat rattaché** : un rapport d'arrestation ou une plainte peut désigner le compte d'un
   avocat ; cet avocat voit alors ce dossier, et seulement ceux où il est inscrit.
4. **Blanchiment de casier** par un magistrat.
5. **Code pénal** modifiable par les magistrats (en plus des admins).

## Non-objectifs

- Pas d'espace ou de site séparé pour la justice : même MDT, même écran de connexion, le type de
  compte détermine ce qui est visible.
- Pas de liens de partage anonymes ni d'accès sans compte.
- Pas de distinction de droits entre procureur et juge (voir « Choix faits »).
- Pas de procédure d'appel, de calendrier d'audiences ni de notifications Discord à la justice.

## Anti-objectifs (échec même si « ça marche »)

- Un avocat qui voit un dossier où il n'est pas inscrit, ou n'importe quelle page police
  (casiers, effectifs, service…). L'isolement de l'avocat est contrôlé **côté serveur**, pas
  seulement en masquant le menu.
- Un rapport qui arrive au casier sans être passé par un magistrat ou un admin.
- Un blanchiment qui détruit l'information : le rapport blanchi reste en base et traçable.
- Des comptes justice qui apparaissent comme des agents (effectifs, listes « agents présents »,
  tuteurs, service, statistiques de divisions).

## Décisions de l'utilisateur

- **Statuts du rapport d'arrestation** : `brouillon` → `en_attente` (déposé par l'agent, en attente
  de jugement) → `finalise` (jugé).
- **Seuls les magistrats et les admins finalisent.** Aucun rôle police, superviseur compris, ne peut
  finaliser à la place d'un magistrat. Si aucun magistrat n'est disponible, le dossier reste en
  attente.
- **Magistrat** : voit les menus *Dossiers* (casiers, véhicules volés, mandats & BOLO), *Rapports*
  (arrestations, incidents, plaintes, preuves) et *Outils* (calculatrice, code pénal, références).
  Il peut : juger/finaliser les rapports d'arrestation, émettre des mandats, clore une plainte,
  blanchir un casier, modifier le code pénal.
- **Avocat** : a un compte ; accède aux rapports d'arrestation et aux plaintes où son compte est
  inscrit, et à rien d'autre.
- **Blanchiment** : les condamnations ne sont pas supprimées ; elles sont marquées « blanchi le …
  par … , motif … », disparaissent du casier affiché aux policiers, restent consultables par la
  justice et dans l'historique.

## Comportement attendu

### Comptes

- Le champ « type de compte » (ou un nouveau rôle, au choix du développeur) distingue *police*,
  *magistrat* et *avocat*. Les rôles police restent hiérarchiques (`hasRole`) ; magistrat et avocat
  sont **hors** de cette hiérarchie : `hasRole(magistrat, 'agent')` doit être faux, sinon ils
  héritent des droits police.
- Un admin crée et gère les comptes justice depuis l'administration des effectifs : matricule
  (identifiant de connexion), nom, prénom, mot de passe, et pour le magistrat sa fonction affichée
  (Procureur / Juge). La réinitialisation de mot de passe et la désactivation fonctionnent comme
  pour les agents.
- Les comptes justice sont exclus de toute liste d'agents : effectifs, sélecteurs d'agents
  (agents présents, tuteurs…), service, divisions, statistiques.

### Rapport d'arrestation

- **Agent (rédacteur)** : le bouton « Finaliser » devient « Déposer pour jugement ». Les
  vérifications actuelles de la finalisation (suspect renseigné, etc.) s'appliquent au dépôt.
  Une fois déposé, l'agent ne peut plus modifier le rapport.
- **Rapport en attente** : visible par la police (lecture) avec un badge « En attente de
  jugement » ; il n'est **pas** encore au casier (même règle qu'un brouillon aujourd'hui).
- **Magistrat / admin** : ouvre un rapport en attente, modifie le calcul (charges, quantités,
  tentative/complicité/atténuation, options de la calculatrice) et finalise. La finalisation fait
  ce qu'elle fait aujourd'hui (verse au casier, clôt les mandats liés, journalise).
- **Traçabilité du jugement** : le calcul proposé par l'agent est conservé à côté du calcul jugé,
  et la vue du rapport montre les deux quand ils diffèrent. On enregistre aussi qui a jugé
  (compte magistrat) et quand ; le bordereau imprimé/copié affiche « Jugé par … le … ».
- **Ce que le magistrat modifie** : uniquement le calcul (charges et options de la calculatrice) et
  l'avocat rattaché. Les faits, photos, suspect et agents restent ceux de la police ; s'ils sont
  faux, il renvoie le rapport.
- **Renvoi** : un magistrat ou un admin peut renvoyer un rapport en attente en brouillon à
  l'agent (dossier incomplet), avec un motif.
- **Réouverture d'un rapport finalisé** : réservée aux magistrats et admins (aujourd'hui :
  superviseur). Les superviseurs ne modifient plus un rapport jugé.
- **Avocat du suspect** : dans les droits exercés, le nom libre de l'avocat est remplacé (ou
  complété) par le choix d'un compte avocat. C'est ce rattachement qui donne l'accès. L'agent le
  renseigne à la rédaction ; le magistrat peut l'ajouter ou le changer tant que le rapport est en
  attente.
- **Accueil du magistrat** : la liste des rapports en attente de jugement, du plus ancien au plus
  récent, remplace le tableau de bord police.

### Plaintes

- Une plainte peut désigner un ou plusieurs comptes avocats (plaignant et/ou mis en cause).
- Le magistrat peut clore (classer ou résoudre) une plainte. Le reste de l'édition d'une plainte
  reste réservé à la police.

### Mandats

- Le magistrat peut émettre un mandat (même formulaire que la police). Le mandat garde son
  auteur ; l'affichage indique la fonction du magistrat.

### Blanchiment de casier

- Depuis la fiche d'un citoyen, un magistrat peut blanchir une condamnation (un rapport
  finalisé) ou tout le casier, avec un motif obligatoire.
- Un rapport blanchi garde ses données, reçoit date, auteur et motif du blanchiment, et :
  - n'apparaît plus dans le casier ni dans le compteur d'arrestations vus par la police ;
  - reste visible par les magistrats (marqué « Blanchi ») et dans l'historique d'audit.
- Un admin ou un magistrat peut annuler un blanchiment (motif journalisé).

### Accès de l'avocat

- Menu réduit : « Mes dossiers », la liste des rapports d'arrestation et plaintes où il est
  inscrit. Rien d'autre.
- Lecture seule : vue du rapport / de la plainte, photos et scellés liés, impression, copie Google
  Docs. Pas de calculatrice modifiable, pas de casier du client.
- Toute API qui renvoie un dossier vérifie le rattachement ; les autres API répondent 403 pour un
  compte avocat. Les photos (`/uploads`) restent accessibles à tout compte connecté : le nom des
  fichiers est aléatoire (voir « Points ouverts »).

### Journal

- Chaque dépôt, jugement, renvoi, réouverture, blanchiment et annulation est journalisé dans
  l'historique existant, avec l'auteur.

## Contraintes techniques

- `users.role` et `arrest_reports.statut` ont des contraintes `CHECK` en SQLite : ajouter une
  valeur demande une migration qui reconstruit la table (pas d'`ALTER ... CHECK`). Le schéma vit
  dans `server/db.js`, sans outil de migration : suivre la manière dont les évolutions précédentes
  y sont faites.
- Faire une sauvegarde (`npm run backup`) avant la migration en production.
- Beaucoup d'endroits testent `statut === 'finalise'` / `'brouillon'` (casier, compteur
  d'arrestations, tableau de bord, liste des rapports, BCI, édition, vue) : chacun doit gérer
  `en_attente` et le blanchiment.
- Les permissions vivent dans les routes Express (`requireRole`, `hasRole`) : la logique d'accès
  justice/avocat doit y être, le front ne fait que masquer.
- Pas de nouvelle dépendance.
- Ajouter des tests `node --test` dans `test/` pour : avocat refusé hors de ses dossiers, agent
  qui ne peut plus finaliser, magistrat qui finalise, blanchi absent du casier police.

## Laissé au développeur

- Rôle unique étendu vs colonne « type de compte » séparée.
- Stockage du calcul de l'agent (colonne dédiée ou historique) et des rattachements avocat
  (colonne JSON ou table de liaison).
- Mise en page exacte des écrans (badge, bloc « décision du magistrat », bouton de blanchiment).

## Choix faits par Claude (à vérifier)

- Le circuit de jugement ne concerne que les rapports d'arrestation : les rapports d'incident
  continuent d'être finalisés par la police.
- Procureur et juge ont exactement les mêmes droits ; seule la fonction affichée diffère.
- Les admins gardent tous les droits des magistrats.
- Le magistrat lit tout le reste des menus Dossiers/Rapports/Outils sans pouvoir le modifier
  (hors mandats, clôture de plainte, blanchiment, code pénal).
- L'avocat est en lecture seule et ne voit pas le casier de son client.
- Les rapports déjà finalisés restent finalisés ; les brouillons existants suivent le nouveau
  circuit.
- Renvoi en brouillon possible par le magistrat ; réouverture d'un rapport jugé retirée aux
  superviseurs.
- Annulation d'un blanchiment possible par un magistrat ou un admin.

## Points ouverts

- Les fichiers de `/uploads` sont servis à tout compte connecté ; un avocat qui obtiendrait l'URL
  d'une photo d'un autre dossier pourrait l'ouvrir. Risque faible (noms aléatoires) ; à durcir
  seulement si nécessaire.
