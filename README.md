# 🌱 LUMORA

> Un monde cozy et social où l'on fait **refleurir un monde éteint** en élevant des
> créatures-compagnons **génératives** — les *Lumi* — qui naissent des jardins qu'on
> cultive, dans un monde partagé qui évolue avec toute la communauté.

**Pitch en une phrase :** *« Cultivez un jardin céleste, faites éclore des créatures
uniques que personne d'autre ne possède, et restaurez ensemble la lumière du monde. »*

Ce dépôt contient **à la fois** le dossier de production complet (game design, stratégie,
art, monétisation, business plan…) **et** une *vertical slice* réellement exécutable :
un cœur de jeu déterministe testé, une API HTTP sans dépendance, et un prototype web
jouable qui dessine chaque créature à partir de son génome.

---

## 🚀 Démarrer en 30 secondes

```bash
npm start          # API + prototype sur http://localhost:8787 (mémoire + auth activée)
npm test           # 101 tests : + auth + paiements + temps réel + chat + rate-limit
npm run sim        # simulation d'équilibrage → docs/BALANCE-REPORT.md
npm run gallery    # régénère la galerie de Lumi (SVG)
npm run seed:demo  # affiche un échantillon de créatures générées

# Production : clé de signature stable + Postgres durable
JWT_SIGNING_KEY=$(openssl rand -hex 32) \
DATABASE_URL=postgres://user:pass@localhost:5432/lumora npm start
```

**Auth :** le serveur exige un **jeton de session signé (HS256)** sur les routes par
compte ; un client n'agit que sur **son propre** compte. Le prototype web s'authentifie
automatiquement via le flux **invité** (`POST /api/auth/guest`). Posez `JWT_SIGNING_KEY`
en prod (sinon clé éphémère, jetons réinitialisés au redémarrage).

**Dépendances :** le *runtime* par défaut (mémoire) ne requiert **aucune dépendance**
(Node ≥ 20, modules natifs ; jetons via `node:crypto`). Le mode Postgres utilise `pg`
(dépendance *optionnelle*). Les tests/outils utilisent des *devDependencies* (PGlite…).
Ouvrez `http://localhost:8787` et essayez l'onglet **✨ Generator**.

![Prototype jouable LUMORA](docs/assets/prototype.png)

*Capture réelle du prototype (rendu via Chromium headless, sans erreur console) :
Generator, Collection, Bloom Ritual et le monde partagé Great Bloom.*

## 🗂️ Structure du dépôt

| Dossier | Contenu |
|---|---|
| [`docs/`](docs/) | **Le dossier de production** — 15 documents + GDD + PRD + OpenAPI + rapport d'équilibrage |
| [`core/`](core/) | Le **cœur de jeu** pur et déterministe (genome, économie, progression, jardin, pity, bloomdex, pass, trade) |
| [`server/`](server/) | API HTTP (`http` natif) + **WebSocket temps réel** (`realtime.js`) + **auth par jetons** (`auth.js`) + **2 stores** : `MemoryStore` et `PgStore` (PostgreSQL réel) derrière la même interface |
| [`web/`](web/) | Prototype jouable (canvas) + **moteur de rendu procédural** des Lumi |
| [`db/`](db/schema.sql) | Schéma PostgreSQL de production (validé + utilisé par `PgStore`) |
| [`tools/`](tools/) | Export SVG, **simulation d'équilibrage**, captures headless |
| [`test/`](test/) | Suite de tests `node --test` (**101 tests** : + auth + paiements + temps réel + chat + rate-limit) |

## 🧬 La pièce maîtresse : le système génératif des Lumi

Chaque Lumi est dérivé **de façon déterministe** d'une graine 32 bits + le contexte du
jardin (biome, saison, soin, *bloom* mondial). Conséquences directes :

- **Variété quasi-infinie** → profondeur de collection → rétention long terme.
- **Déterminisme** → serveur autoritaire, *seed codes* partageables, anti-triche, **testable**.
- **Reproduction/combinaison** (`breedLumi`) → économie d'échange entre joueurs + viralité.
- **Render spec** (données pures) → n'importe quel client dessine la créature, **zéro asset**.
- **Stockage ~16 octets / créature** (graine + contexte) au lieu de centaines.

![Galerie de Lumi générés](docs/assets/lumi-gallery.svg)

*24 créatures générées (4 par rareté), produites par `node tools/render-svg.js`.*

## 📐 Architecture (vue d'ensemble)

```
  Navigateur / Client            Serveur (autoritaire)         Durabilité
  ┌───────────────────┐          ┌────────────────────┐        ┌──────────────┐
  │ web/ (prototype)  │  HTTP    │ server/api.js      │        │ Postgres     │
  │  import /core ◄───┼──────────┤  └─ orchestration  │◄──────►│ (db/schema)  │
  │  lumi-render.js   │  JSON    │ core/ (règles)     │        │ Redis (chaud)│
  └───────────────────┘          └────────────────────┘        └──────────────┘
        MÊME module core/genome.js des deux côtés (une seule source de vérité)
```

Détails : [`docs/11-TECH-ARCHITECTURE.md`](docs/11-TECH-ARCHITECTURE.md).

## ✅ État de la vertical slice

- [x] Génération + reproduction déterministes des Lumi (`core/genome.js`) — **testé**
- [x] **Protection anti-malchance** (pity) garantissant une rareté minimale (`core/luck.js`) — **testé**
- [x] Économie 2-monnaies avec grand-livre source/puits anti-inflation — **testé**
- [x] Progression : niveaux, *streaks* quotidiens (avec jour de grâce), quêtes — **testé**
- [x] Boucle de jardin : planter → arroser → récolter → éclore — **testé**
- [x] **Bloomdex** (complétion de collection + paliers) (`core/bloomdex.js`) — **testé**
- [x] **Bloom Pass** saisonnier (voies gratuite/premium) (`core/pass.js`) — **testé**
- [x] **Constellations** (guildes) + **échanges sécurisés** atomiques (`core/trade.js`) — **testé**
- [x] API HTTP complète + onboarding + social + intégration **en process** — **testé**
- [x] Prototype web jouable + **rendu procédural par forme** — **vérifié (capture Chromium)**
- [x] Schéma PostgreSQL — **validé** (appliqué sur un vrai moteur)
- [x] **Persistance PostgreSQL réelle** (`server/pgStore.js`) — **durabilité prouvée** : l'état survit à une instance de store fraîche (`test/pgstore.test.js` sur PGlite)
- [x] **Authentification** par jetons signés HS256 + flux invité par appareil (`server/auth.js`) — **testé** (401 sans jeton, 403 compte d'autrui)
- [x] **Durcissement** : codes 4xx corrects, validation d'entrée, anti-exploit, parité d'erreurs des stores — **testé**
- [x] **Rate limiting** : fenêtre fixe (global IP + bucket sensible), `429`+`Retry-After` (`server/ratelimit.js`) — **testé**
- [x] **Monétisation** : abonnement « Jardin Doré » + octroi IAP **idempotent** (jamais de double-crédit) (`core/subscription.js`) — **testé**
- [x] **Vérification de paiement réelle** : **signature de webhook Stripe** (HMAC + anti-rejeu) + Apple/Google par **transport injectable** (`server/iap.js`) — **testé** (`test/iap-providers.test.js`)
- [x] **Temps réel** (WebSocket) : présence, ticks live du Great Bloom, notifications de visite + **chat de Constellation** ; auth par jeton sur `/ws` (`server/realtime.js`) — **testé** (client `ws`)
- [x] **Simulation d'équilibrage** pilotée par données → [`BALANCE-REPORT.md`](docs/BALANCE-REPORT.md)
- [x] **OpenAPI** ([`docs/openapi.yaml`](docs/openapi.yaml))
- [ ] Branchement réseau Apple/Google (transport prod), fan-out Redis multi-instances, client moteur (Godot) — *roadmap*

## 📜 Licence

Voir [`LICENSE`](LICENSE) — prototype propriétaire, évaluation interne.
