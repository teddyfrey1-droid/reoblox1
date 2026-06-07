# 03 — Gameplay complet

## Fantaisie de joueur

*« Je suis un Gardien bienveillant : je cultive un jardin vivant, je fais naître des créatures
uniques que j'apprends à connaître, j'embellis mon coin de ciel, et je participe à rallumer
un monde entier avec d'autres. »*

## Boucle de gameplay principale (core loop)

```
        ┌──────────────────────────────────────────────────────────┐
        │                                                          │
        ▼                                                          │
   1. PLANTER ──► 2. CULTIVER ──► 3. RÉCOLTER ──► 4. ÉCLORE ──► 5. COLLECTIONNER
   (acheter &     (arroser,       (quand prêt    (un Lumi      (admirer, nommer,
    semer une      le temps réel   en temps réel) GÉNÉRÉ naît)  ranger, exposer)
    graine)        s'écoule)            │                            │
        ▲                               │                            ▼
        │                               │                     6. AGIR : décorer,
        └───────────────────────────────┴─────────────────────  combiner (reproduire),
                          (le butin/XP/monnaie relancent)        rendre visite, partager
```

**Durée d'une boucle :** une **micro-récompense** (récolte d'une graine rapide) en 5 min ;
une **session satisfaisante** en 8–15 min (récolter, replanter, dépenser, décorer, voir un voisin).

> Implémenté et testé : `core/garden.js` (plant → water → harvest), `core/genome.js` (l'éclosion
> génère un Lumi déterministe), `server/api.js` (endpoints de la boucle). Voir `test/garden.test.js`.

### Pourquoi cette boucle fonctionne (design)
- **Anticipation** : le temps de croissance crée l'attente et la raison de revenir (rendez-vous).
- **Récompense variable** : la rareté/forme du Lumi à l'éclosion est une surprise (dopamine).
- **Investissement** : on *soigne* (arroser) → meilleure qualité → sentiment d'agentivité, pas
  de pur hasard (cf. `careQuality` qui augmente stats et chance dans `core/garden.js`).
- **Expression** : décorer et exposer sa collection = motivation intrinsèque durable.

## Boucles secondaires

| Boucle | Déclencheur | Récompense | Rythme |
|---|---|---|---|
| **Rituel de Floraison** (reproduction) | 2 Lumi + Lumen | Lumi enfant (lignée, mutations héritées) | Sessions investies |
| **Quêtes quotidiennes** | Connexion | XP + Pétales | Quotidien |
| **Streak quotidien** | Connexion consécutive | Récompense croissante (j7 = premium) | Quotidien |
| **Visites de voisins** | Onglet Monde | Pétales + découverte sociale | Quotidien |
| **Événements / Saisons** | Calendrier live-ops | Cosmétiques & Lumi exclusifs | Hebdo / 8 sem |
| **Great Bloom** (méta partagé) | Toute éclosion mondiale | Paliers mondiaux, déblocages | Continu |
| **Bloomdex** (collection) | Posséder des espèces | Récompenses de complétion | Long terme |

> Reproduction implémentée/testée : `breedLumi` (`core/genome.js`, `test/genome.test.js`) —
> héritage d'élément/forme, échelle de rareté plafonnée (la rareté ne « s'emballe » pas →
> raréfaction préservée), mutations héritables (« lignées shiny »).

## Progression

- **Niveau de Gardien (Keeper Level)** : XP gagnée surtout par éclosions/quêtes. Courbe douce au
  début (dopamine de la 1ʳᵉ session) qui se raidit (cf. `xpForLevel` dans `core/content.js`).
- **Déblocages par niveau** (révélation progressive des features — bon onboarding) :
  L2 2ᵉ parcelle · L3 visites · **L4 reproduction** · L5 biome Tide Pools · L6 Constellations ·
  L8 échanges · L10 expéditions (`LEVEL_UNLOCKS` dans `core/content.js`, appliqué par `applyXp`).
- **Bloom local** du jardin : monte avec le soin → améliore la chance de raretés (incitation à tendre).
- **Bloomdex** : complétion par élément/forme/mutation → objectif *completionist* long terme.

## Récompenses

**Décision :** récompenser **3 monnaies de motivation** distinctes pour couvrir tous les profils :
1. **Progrès** (XP, niveaux, Bloomdex) — accomplissement.
2. **Expression** (cosmétiques, décor, biomes) — identité.
3. **Surprise** (rareté/mutation à l'éclosion) — variabilité.

Le calendrier de récompense suit un schéma **variable-ratio** (la grande surprise est l'éclosion)
encadré par des récompenses **fixes** garanties (quêtes, streak) pour éviter la frustration.
**Bad luck protection** : un compteur de pitié (côté serveur) garantit une rareté ≥ *rare* tous
les N éclosions sans rare (à câbler en prod ; les hooks de luck existent déjà via `bloomLevel`/`careQuality`).

## Difficulté & courbe d'apprentissage

**Décision :** **pas de game-over, pas d'échec punitif.** La « difficulté » est une *profondeur
optionnelle* : optimiser des lignées, viser des mutations, grimper en Constellation.

- **Courbe d'apprentissage** : onboarding de 3 minutes (planter→récolter→éclore→nommer), puis
  features révélées par niveau pour ne jamais submerger.
- **Plafond de maîtrise élevé** : la reproduction (héritage + mutations + contexte) offre un
  espace d'optimisation quasi infini pour les *core*, invisible pour les casual.

## Contrôles

**Plateforme primaire : mobile tactile** (puis manette/clavier sur PC/console).
- **Tap** : sélectionner, planter, récolter, ouvrir.
- **Appui long** : déplacer/pivoter le décor, options contextuelles.
- **Glisser** : déplacer la caméra dans le jardin ; réorganiser la collection.
- **Pincer** : zoom.
- **Un seul bouton d'action contextuel** en bas (planter/arroser/récolter selon l'état) — règle
  d'or mobile : minimiser la charge cognitive.
- **PC/manette** : curseur/stick + bouton d'action ; raccourcis pour la collection.

## Mécanique unique (le « hook » signature)

### Les Lumi génératifs déterministes + le Rituel de Floraison

Ce qu'aucun concurrent n'offre exactement :

1. **Unicité réelle, art-dirigée.** Chaque Lumi est dérivé d'une graine + contexte
   (`generateLumi`). > 4 milliards de combinaisons **cohérentes** (palettes harmoniques, formes
   lisibles, raretés équilibrées), pas du bruit aléatoire.
2. **Déterminisme partageable.** Un *seed code* (`LUMI-7F3K-9QZ2`) régénère exactement le même
   Lumi sur n'importe quel appareil → partage viral, serveur autoritaire, anti-triche, testable.
3. **Combinaison à résultats émergents.** `breedLumi` mélange les graines parentales + une
   entropie de rituel → enfant à lignée traçable, héritage de mutations, montée de rareté
   plafonnée. C'est le moteur de l'économie d'échange et des moments « waouh ».
4. **Le monde réagit à la créature.** Le contexte (biome/saison/soin/*Great Bloom*) influe sur ce
   qui éclot → le gameplay (où et comment on cultive) façonne réellement la collection.

> **Tout ceci est déjà implémenté et couvert par des tests** (`test/genome.test.js` : déterminisme,
> variété > 250 looks/500 graines, distribution des raretés, incitation au soin, scarcité préservée
> en reproduction).
