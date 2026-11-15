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
L'app est alors servie sur `https://<utilisateur>.github.io/<dépôt>/`.

### Publier une mise à jour

```bash
npm version patch
git push --follow-tags
```

`npm version patch` augmente la version (affichée dans *Ajustes*) et crée le commit + le tag ;
le push déclenche le déploiement (≈ 1-2 min, visible dans l'onglet *Actions*).

Sur l'iPhone, la nouvelle version s'installe d'elle-même mais n'est **jamais** appliquée en pleine
séance. Jusqu'au bandeau « Nueva versión disponible » (phase 2), elle est prise en compte quand l'app
est complètement fermée (balayer vers le haut dans le sélecteur d'apps) puis rouverte.

## Documents

- [docs/instalar-iphone.md](docs/instalar-iphone.md) : message en espagnol pour installer l'app.
- [docs/pruebas-iphone.md](docs/pruebas-iphone.md) : tests manuels à faire sur un vrai iPhone.
