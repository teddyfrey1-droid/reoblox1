# LUMORA — Product Requirements Document (MVP)

> Version 0.1. Définit le **périmètre du MVP** (Phase 1 de la roadmap), les exigences, les
> user stories et leurs **critères d'acceptation**. Ce qui est livré dans ce dépôt (vertical slice)
> est marqué ✅ ; ce qui reste à produire pour le MVP est marqué ⬜.

## 1. Objectif produit

Livrer un *build* mobile jouable prouvant que la boucle cœur (cultiver → éclore un Lumi unique →
collectionner/combiner → socialiser) est **fun, rétentive et techniquement saine**, sur le moteur
cible (Godot) avec un backend de production (Postgres).

**Critère de succès du MVP :** *playtests* qualitatifs positifs, *crash-free* > 99 %, boucle
complète sans blocage, signaux de rétention interne encourageants.

## 2. Périmètre

### Dans le périmètre (MVP)
- Onboarding 3 minutes ; boucle de jardin (planter/arroser/récolter/éclore).
- Génération + reproduction de Lumi ; collection ; mode photo simple.
- Économie 2-monnaies ; daily ; quêtes ; niveaux/déblocages.
- 2–3 biomes ; boutique cosmétique de base ; Bloom Pass v1 (factice) ; abonnement v1.
- Social v1 : voisins, visites, classement (Constellations en Alpha).
- Auth (Apple/Google/device) ; persistance Postgres ; télémétrie de base ; remote-config.

### Hors périmètre (post-MVP)
- Échanges entre joueurs (escrow), UGC avancé, temps réel/chat, console, part créateurs,
  événements communautaires mondiaux complexes, IA de live-ops.

## 3. Exigences fonctionnelles & user stories

> Légende statut : ✅ prototypé dans ce dépôt · ⬜ à produire pour le MVP.

### EF-1 — Compte & onboarding
- *En tant que* nouveau joueur, *je veux* commencer en < 1 min *afin de* jouer tout de suite.
- **Critères d'acceptation :**
  - ✅ Création de compte par *handle* validé (3–20 caractères mot). `POST /api/players`.
  - ✅ Don de départ : 300 🌸, 50 ✦, **2 Lumi de départ** (`server/store.js`).
  - ✅ **Auth par jetons signés** (HS256) + flux **invité par appareil** (`/api/auth/guest`) ; routes par compte protégées (401/403) — testé.
  - ⬜ Providers Apple/Google + cross-device explicite (mêmes jetons, table `auth_identities`).
  - ⬜ Tutoriel scénarisé (1ʳᵉ plantation → éclosion → nommage).

### EF-2 — Boucle de jardin
- *En tant que* Gardien, *je veux* planter et récolter *afin de* faire éclore des Lumi.
- **Critères d'acceptation :**
  - ✅ Acheter+planter une graine dans une parcelle vide ; refuser une parcelle occupée.
  - ✅ Croissance en temps réel ; arrosage (≤3) réduit le temps et améliore la qualité.
  - ✅ Récolte seulement quand prêt → génère un Lumi déterministe ; libère la parcelle.
  - ✅ Tests : `test/garden.test.js` (déterminisme, états, soin → puissance).
  - ⬜ Animation d'éclosion + carillon modulé par rareté (client Godot).

### EF-3 — Génération & collection de Lumi
- *En tant que* collectionneur, *je veux* des créatures uniques *afin de* les rassembler.
- **Critères d'acceptation :**
  - ✅ `generateLumi` déterministe ; > 250 looks distincts / 500 graines (testé).
  - ✅ Distribution de raretés conforme aux poids ; mythic rare mais atteignable (testé).
  - ✅ Collection triable (récence/puissance/rareté). `GET /api/players/:id/collection`.
  - ✅ *Seed codes* partageables (`encode/decodeSeedCode`, round-trip testé).
  - ✅ **Bloomdex** (complétion espèces/éléments/formes/raretés/mutations + paliers) — testé.
  - ✅ **Bad-luck protection** (pity) garantissant une rareté minimale — testé + simulé.
  - ⬜ Mode photo.

### EF-4 — Reproduction (Rituel de Floraison)
- *En tant que* joueur investi, *je veux* combiner deux Lumi *afin d'*en créer de nouveaux.
- **Critères d'acceptation :**
  - ✅ `breedLumi` déterministe ; héritage + mutations héritables ; lignée tracée (testé).
  - ✅ Coût 25 ✦ ; refus si fonds insuffisants (`/breed`, code `NEED_LUMEN`).
  - ✅ Rareté plafonnée (pas d'emballement — scarcité préservée, testé).
  - ⬜ Verrouillage à L4 + tutoriel dédié (client).

### EF-5 — Économie & monétisation
- **Critères d'acceptation :**
  - ✅ Crédit/débit/achat validés et journalisés ; *atomicité* du paiement ; caps (testé).
  - ✅ Rapport faucet/sink calculable (anti-inflation, testé).
  - ⬜ IAP store + web shop (Stripe) ; validation serveur des reçus ; déduplication.
  - ✅ **Bloom Pass jouable** (XP, paliers, voies gratuite/premium, achat premium en Lumen) — testé.
  - ⬜ Abonnement « Jardin Doré ».

### EF-6 — Rétention quotidienne
- **Critères d'acceptation :**
  - ✅ Daily reward (échelle hebdo, j7 premium, multiplicateur, **jour de grâce**, idempotent — testé).
  - ✅ 3 quêtes quotidiennes déterministes par (joueur, jour) (testé).
  - ⬜ Notifications *opt-in* (récolte prête, ami actif, événement).

### EF-7 — Progression
- **Critères d'acceptation :**
  - ✅ XP → niveaux ; déblocages de features par niveau (testé : 2ᵉ parcelle, reproduction…).
  - ⬜ Application des *gates* de feature côté client.

### EF-8 — Social v1
- **Critères d'acceptation :**
  - ✅ Lister des voisins ; rendre visite (+récompense) ; classement mondial.
  - ✅ Monde **pré-peuplé** pour éviter le vide au lancement (`server/scripts/demo.js`).
  - ✅ **Constellations** (créer/rejoindre, ≤30, score de bloom collectif) — testé.
  - ✅ **Échanges sécurisés** joueur-à-joueur (escrow atomique, taxe, verrouillage) — testé.
  - ⬜ Amis/cadeaux ; chat temps réel.

### EF-9 — Monde partagé (Great Bloom)
- **Critères d'acceptation :**
  - ✅ Compteur mondial qui monte à chaque éclosion ; exposé via `GET /api/world` ; affiché (proto web).
  - ⬜ Paliers mondiaux avec déblocages communautaires.

## 4. Exigences non fonctionnelles

| Domaine | Exigence |
|---|---|
| **Perf** | 60 fps sur mobile milieu de gamme ; *cold start* < 4 s ; API p95 < 150 ms |
| **Fiabilité** | *crash-free* > 99 % ; opérations sensibles idempotentes ; dégradation gracieuse |
| **Scalabilité** | Stateless API + Redis (chaud) + Postgres (durable) ; autoscale (cf. 11) |
| **Sécurité** | Serveur autoritaire ; validation des intrants ; reçus IAP vérifiés/dédupliqués |
| **Confidentialité** | RGPD/RGPD-K/COPPA ; *age-gating* ; export/suppression de compte |
| **Accessibilité** | Daltonisme (forme+texte), réduction d'animations, mode calme, taille de texte |
| **Localisation** | i18n dès le MVP ; 8–10 langues au soft launch |
| **Observabilité** | Logs structurés, métriques, traçage ; events analytics |
| **Qualité** | Suite `test/` en *gate* CI ; validation du schéma SQL en CI |

## 5. Dépendances & risques

- **Moteur Godot** (client) ; **Postgres/Redis** (backend) ; SDK stores (IAP) ; pipeline analytics.
- Risques produit/marché : voir [01-STRATEGY.md](01-STRATEGY.md). Risque n°1 hors-produit :
  **clearance de la marque** avant marketing.

## 6. Critères de sortie du MVP (Definition of Done)

1. Boucle complète jouable sur device (Godot) sans blocage.
2. Backend Postgres déployé (**store relationnel prototypé et testé** : `server/pgStore.js`) ; auth réelle ; télémétrie active.
3. Suite de tests **verte** en CI (cœur + intégration API + durabilité PostgreSQL) ; schéma SQL validé en CI.
4. *Crash-free* > 99 % en *playtest* ; perf cibles atteintes.
5. *Playtests* qualitatifs : la boucle est jugée « fun » et claire par > 70 % des testeurs.

## 7. Traçabilité exigence → code (extrait)

| Exigence | Implémentation | Test |
|---|---|---|
| EF-2 boucle jardin | `core/garden.js`, `server/api.js` | `test/garden.test.js` |
| EF-3 génération | `core/genome.js` | `test/genome.test.js` |
| EF-4 reproduction | `core/genome.js#breedLumi`, `/breed` | `test/genome.test.js` |
| EF-3 pity / Bloomdex | `core/luck.js`, `core/bloomdex.js` | `test/luck.test.js`, `test/bloomdex.test.js` |
| EF-5 économie / Bloom Pass | `core/economy.js`, `core/pass.js` | `test/economy.test.js`, `test/pass.test.js` |
| EF-6/EF-7 rétention/progression | `core/progression.js`, `core/content.js` | `test/progression.test.js` |
| EF-8 social / échanges | `server/store.js`, `core/trade.js`, `server/api.js` | `test/trade.test.js`, `test/api.test.js` |
| Persistance durable (PostgreSQL) | `server/pgStore.js`, `server/db.js`, `db/schema.sql` | `test/pgstore.test.js` (durabilité) |
| EF-1 authentification (jetons + invité) | `server/auth.js`, `server/api.js` (middleware self) | `test/auth.test.js` |
