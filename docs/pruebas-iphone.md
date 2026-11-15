# Tests manuels sur un vrai iPhone (fin de phase 1)

À faire sur l'URL publiée (HTTPS), avec Safari. Cocher au fur et à mesure.

## Installation
- [ ] Dans Safari, l'écran « Instala Bubilandia en tu iPhone » s'affiche (3 étapes, avertissement sur les données séparées).
- [ ] Partager → « Añadir a pantalla de inicio » : l'icône (haltère corail) et le nom « Bubilandia » sont corrects.
- [ ] Ouverte depuis l'icône : plein écran, pas de barre Safari, l'écran d'aide ne s'affiche pas.
- [ ] Rien n'est masqué par l'encoche / Dynamic Island ni par la barre du bas (accueil, séance, chrono).
- [ ] Taper dans un champ charge / reps ne zoome pas ; le clavier est décimal (charge) / numérique (reps).

## Hors ligne
- [ ] Ouvrir l'app une fois avec réseau, la fermer, passer en **mode avion**, la rouvrir : tout fonctionne.
- [ ] Faire une séance complète en mode avion, la terminer : elle apparaît dans l'historique.

## Séance et sauvegarde
- [ ] Démarrer une séance, saisir quelques séries (+/−, appui long, clavier « 42,5 »), RPE en un tap.
- [ ] **Fermeture forcée** (balayer l'app) en pleine séance, puis rouvrir : retour direct dans la séance, valeurs intactes.
- [ ] Idem après un **redémarrage** du téléphone.
- [ ] Deuxième séance du même type : charges pré-remplies et « La última vez / Hoy » cohérents.

## Chrono, son, écran
- [ ] Après le RPE, le chrono démarre ; −15 s / +15 s / Saltar fonctionnent, y compris en tapant vite.
- [ ] Bip court à 10 s, puis 3 bips + flash vert à 0, puis « ¡A por la siguiente serie! ».
- [ ] **Son avec le bouton silencieux activé** (iOS 17+) : les bips s'entendent-ils ? Noter la version d'iOS.
- [ ] **Écran allumé** : pendant un repos de 2:30 sans toucher, l'écran ne se verrouille pas (blocage auto réglé à 30 s pour le test).
- [ ] Verrouiller le téléphone pendant un repos, attendre la fin, déverrouiller : « Descanso terminado hace … », pas de bip tardif.
- [ ] Passer sur une autre app 1 min puis revenir : temps restant correct.

## Export / import
- [ ] Ajustes → Exportar copia : la feuille de partage iOS s'ouvre ; enregistrer dans Fichiers.
- [ ] Le bandeau « Haz una copia de seguridad » disparaît ensuite.
- [ ] Ajustes → Importar copia → choisir le fichier : aperçu « N sesiones, desde el … », confirmer, données identiques.
- [ ] Importer un fichier qui n'est pas une copie : message d'erreur, aucune donnée perdue.

## Mise à jour
- [ ] Publier une nouvelle version (`npm version patch && git push --follow-tags`), fermer complètement l'app, la rouvrir (avec réseau) deux fois : la version dans Ajustes a changé, les données sont intactes.
