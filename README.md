# Bubilandia fuerza

Web app (PWA) de suivi d'entraînement pour iPhone : programme en 4 séances, saisie série par série
avec RPE, chrono de repos et surcharge progressive automatique. Tout reste sur le téléphone
(IndexedDB), l'app fonctionne hors ligne une fois installée.

Stack : Vite + React + TypeScript, Dexie (IndexedDB), vite-plugin-pwa (Workbox), Vitest.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173 (aussi accessible depuis le réseau local)
npm test           # tests unitaires (engine, base de données, export/import)
npm run build      # typecheck + build de production dans dist/
npm run preview    # sert dist/ : c'est là qu'on teste le service worker / le hors ligne
```

- Le service worker est désactivé en `dev` ; utiliser `npm run build && npm run preview` pour le tester.
- Ajouter `?instalar` à l'URL force l'écran d'aide à l'installation (il ne s'affiche sinon que sur iOS, hors app installée).
- Icônes : `npm run icons` régénère `public/*.png`.

## Structure

```
src/
  engine/     logique pure : progression, RPE, e1RM, arrondis, rotation, chrono, records (aucun import React/Dexie)
  db/         schéma Dexie, séances, historique, export/import
  seed/       programme initial chargé au premier lancement
  features/   écrans : home, workout, rest-timer, history, settings, install
  shared/     composants UI, formatage, son, wake lock, partage
tests/        Vitest
```

## Publication (GitHub Pages)

Le workflow `.github/workflows/deploy.yml` teste, construit et publie à chaque push sur `main`.

**Une seule fois**, sur GitHub : *Settings → Pages → Build and deployment → Source : « GitHub Actions »*.
L'app est servie sur **https://toinezouz.github.io/bubilandia/**.

### Publier une mise à jour

```bash
npm version patch
git push --follow-tags
```

`npm version patch` augmente la version (affichée dans *Ajustes*) et crée le commit + le tag ;
le push déclenche le déploiement (≈ 1-2 min, visible dans l'onglet *Actions*).

Sur l'iPhone, la nouvelle version se télécharge d'elle-même mais n'est **jamais** appliquée en pleine
séance : l'accueil affiche le bandeau « Nueva versión disponible – Actualizar ». Elle est aussi prise
en compte quand l'app est complètement fermée puis rouverte.

## Documents

- [docs/instalar-iphone.md](docs/instalar-iphone.md) : message en espagnol pour installer l'app.
- [docs/pruebas-iphone.md](docs/pruebas-iphone.md) : tests manuels à faire sur un vrai iPhone.

## Repeticiones fijas (depuis la 0.6)

Chaque exercice demande un **nombre fixe de répétitions**, choisi dans la fourchette d'origine
du programme, avec un **RPE cible de 9** (1 rep en réserve) : 8 pour les gros mouvements lourds
(hip thrust, soulevé de terre roumain), 10 pour les autres polyarticulaires, 12 pour
l'isolation, 15 pour l'abduction et les élévations latérales, 40 s pour la planche.
La table est dans `src/seed/templates.ts` (`FIXED_REPS`).

Pourquoi :
- l'hypertrophie est comparable de ~6 à ~30 reps par série quand les séries finissent près de
  l'échec ([Schoenfeld 2017](https://pubmed.ncbi.nlm.nih.gov/28834797/),
  [Schoenfeld 2021](https://mdpi.com/2075-4663/9/2/32)) ; des charges très légères
  (~20 % 1RM) font moins bien ([Lasevicius 2018](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2018.00402/pdf)) ;
- finir plus près de l'échec augmente l'hypertrophie, pas la force
  ([Robinson 2024](https://rke.abertay.ac.uk/en/publications/exploring-the-dose-response-relationship-between-estimated-resist/)),
  mais l'échec n'est pas nécessaire : 1-2 reps en réserve donnent des résultats proches
  ([ACSM 2026](https://www.newswise.com/articles/acsm-unveils-landmark-2026-resistance-training-guidelines-first-update-in-17-years)) ;
- le RPE noté est plus juste sur des séries courtes et proches de l'échec
  ([Zourdos 2021](https://pubmed.ncbi.nlm.nih.gov/30747900/),
  [Remmert 2023](https://pmc.ncbi.nlm.nih.gov/articles/7785525)) → pas de séries de 18-20 reps.

Progression (seule la charge bouge), comme le ferait un coach :
- reps faites avec au moins une rep de réserve de plus que prévu, **et la dernière série a
  tenu** → charge supérieure (calculée sur l'e1RM, +12 % max) ;
- reps faites comme prévu ou une rep de moins → même charge ;
- **un mauvais jour ne fait pas baisser la charge** : 2 ou 3 reps manquées une fois → on
  répète ; la charge ne baisse (−12 % max) que si ça se confirme à la séance suivante, ou si
  l'écart dépasse 4 reps (~10 % de charge, au-delà des variations normales d'un jour à l'autre) ;
- après une baisse, revenir à la charge manquée demande une vraie marge (les reps au RPE visé).

Pendant la séance : après la 1re série, « Hoy vas fuerte / Día duro » (2 reps d'écart) ;
après une série suivante qui s'effondre (2 reps de moins même à l'échec), proposition de
baisser pour la série d'après. Jamais de changement sans son accord. Si le pas de charge suivant est trop gros pour la charge actuelle (ex. 1 kg sur
9 kg), l'app demande temporairement quelques reps de plus (5 au maximum) jusqu'à ce que la
charge suivante soit faisable. Dans *Ajustes → Programa*, chaque exercice a un seul champ
« Repeticiones por serie ».
