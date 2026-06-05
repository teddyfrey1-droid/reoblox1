# LUMORA — Game Design Document (maître)

> Version 0.1 — document vivant. Sert de référence transverse. Les sections stratégiques
> détaillées vivent dans les fichiers numérotés (00–12) ; ce GDD se concentre sur les
> **spécifications de systèmes** exploitables par la production, et **pointe vers le code**
> qui les implémente déjà.

## 1. Résumé

- **Genre :** cozy social · creature-collector · life-sim · live-service.
- **Plateformes :** mobile-first (iOS/Android) → PC (Steam) → console.
- **Modèle :** F2P éthique (cosmétique/confort/abonnement, **non pay-to-win**).
- **Boucle :** planter → cultiver → récolter → **faire éclore un Lumi génératif** → collectionner /
  combiner / décorer / socialiser → recommencer.
- **Hook :** créatures **génératives déterministes** uniques + monde partagé (**Great Bloom**).

Pitch, vision et justification de marché : [00-VISION.md](00-VISION.md), [01-STRATEGY.md](01-STRATEGY.md).

## 2. Piliers de design

1. **Douceur** — pas d'échec punitif ; progression apaisante ; esthétique chaleureuse.
2. **Unicité** — chaque créature est réellement unique et art-dirigée (génératif).
3. **Ensemble** — le monde se restaure collectivement ; le social aide, ne nuit jamais.
4. **Confiance** — on vend de l'expression et du temps, jamais de la puissance.
5. **Profondeur optionnelle** — accessible aux casual, inépuisable pour les *completionists*.

## 3. Boucles de jeu

Boucle principale et secondaires détaillées : [03-GAMEPLAY.md](03-GAMEPLAY.md).
Rétention (daily, quêtes, saisons, events) : [04-RETENTION.md](04-RETENTION.md).

États d'une **parcelle** (machine à états, implémentée dans `core/garden.js`) :

```
[empty] --plant(seed)--> [growing] --temps + (water*)--> [ready] --harvest--> (Lumi) --> [empty]
                              │
                          water (≤3) : -8% du temps restant, +careQuality
```

## 4. Spécification du système de Lumi (cœur)

> Implémentation autoritaire : [`core/genome.js`](../core/genome.js). Tests : [`test/genome.test.js`](../test/genome.test.js).

### 4.1 Génome (sortie de `generateLumi(seed, ctx)`)

| Champ | Type | Description |
|---|---|---|
| `seed` / `seedCode` | uint32 / `LUMI-XXXX-XXX` | Identité déterministe partageable |
| `name` | string | Nom prononçable généré |
| `species` | string | `<Élément> <Forme>` (ex. « Water Critter ») |
| `rarity` | enum | common · uncommon · rare · epic · legendary · mythic |
| `element` | enum | sun · moon · water · earth · spark · bloom |
| `form` | enum | sprout · critter · floater · finling · tot · wyrm |
| `pattern` | enum | solid · spots · stripes · gradient · speckle · patch |
| `temperament` | enum | cheerful · shy · curious · sleepy · brave · mischievous · serene · dramatic |
| `mutations` | string[] | aurora, crystalline, starlit, twin_tail, halo, ember_heart, albino, melanistic |
| `palette` | objet | primary/secondary/accent/belly (+ aurora) — HSL harmonique |
| `stats` | objet | charm/vigor/harmony/spark (low-stakes, plafonnées par rareté) |
| `glow` / `power` | number | signal de rareté visuel / score agrégé comparable |
| `render` | objet | *render spec* renderer-agnostic (dessiné par `web/lumi-render.js`) |
| `lineage` / `bornFrom` | — | parents (reproduction) / contexte de naissance |

### 4.2 Contexte de naissance (`GardenContext`)
`biome`, `season`, `bloomLevel` (0–100, le Great Bloom), `careQuality` (0–1), `plantSpecies`.
→ influence l'élément, la palette et la **chance de rareté** (incitation à bien cultiver).

### 4.3 Raretés (poids relatifs, `RARITIES`)
common 1000 · uncommon 420 · rare 150 · epic 42 · legendary 9 · **mythic 1,2** (multiplicateurs de
stats 1,0 → 2,2 ; *glow* 0 → 1). La chance grimpe avec `bloomLevel` et `careQuality` (`rollRarity`).

### 4.4 Reproduction (`breedLumi(a, b, ctx)`)
Graine enfant = mix déterministe des graines parentales + entropie de rituel. Héritage
d'élément/forme (avec « throwback »), **échelle de rareté plafonnée** (montée possible, emballement
impossible → scarcité préservée), mutations héritables (lignées « shiny »), lignée tracée.
Coût : **25 Lumen** (puits premium). Débloqué L4.

## 5. Économie & monnaies

Spécification complète : [07-ECONOMY.md](07-ECONOMY.md). Implémentation : [`core/economy.js`](../core/economy.js).
- **Pétales 🌸** (douce) / **Lumen ✦** (premium), caps stricts, grand-livre source/puits.
- Monétisation : [06-MONETIZATION.md](06-MONETIZATION.md).

## 6. Progression

Implémentation : [`core/progression.js`](../core/progression.js), table d'XP et déblocages dans
[`core/content.js`](../core/content.js).
- **Keeper Level** (courbe `xpForLevel`), déblocages par niveau (`LEVEL_UNLOCKS`).
- **Daily streak** avec jour de grâce (`claimDaily`).
- **Quêtes** quotidiennes déterministes (`dailyQuests`).

## 7. Contenu (catalogue MVP)

Source de vérité : [`core/content.js`](../core/content.js).
- **Biomes (6)** : meadow, tide_pools, glade, dunes, nocturne, emberfall (biais d'élément).
- **Graines (6)** : dewbud → starbloom (coût/durée/`rarityLuck` croissants ; certaines premium/saisonnières).
- **Décor (5)** : puits cosmétiques.
- **Bloom Pass** : 50 paliers, voies gratuite/premium.

## 8. Systèmes social, monde & événements

Détail : [05-SOCIAL.md](05-SOCIAL.md). Le **Great Bloom** (méta partagé) monte avec chaque éclosion
mondiale (`server/store.js`). Constellations, amis, échanges, trades : modélisés dans
[`db/schema.sql`](../db/schema.sql), planifiés en bêta.

## 9. Direction artistique & audio

[02-ART-DIRECTION.md](02-ART-DIRECTION.md). *Design tokens* de référence : [`web/style.css`](../web/style.css).
Carillon d'éclosion modulé par la rareté ; *gibberish* vocal par tempérament.

## 10. Surface API (MVP, implémentée)

> Référence : [`server/api.js`](../server/api.js). Toutes les mutations passent par le serveur (autoritaire).

| Méthode & route | Rôle |
|---|---|
| `GET /api/world` · `GET /api/catalog` | État du monde · catalogue |
| `GET /api/preview/lumi?seed&biome&bloom&care` | Aperçu génératif (sans compte) |
| `POST /api/players` · `GET /api/players/:id` | Créer / lire un Gardien |
| `POST /api/players/:id/daily` · `GET …/quests` | Récompense quotidienne · quêtes |
| `POST …/shop/buy {kind,id}` | Achat (plant/decor/biome) |
| `GET …/garden` · `POST …/garden/plant｜water｜harvest` | Boucle de jardin |
| `GET …/collection?sort` · `GET …/lumi/:uid` | Collection · détail Lumi |
| `POST …/breed {parentA,parentB}` | Rituel de Floraison |
| `GET …/neighbours` · `POST …/visit` · `GET /api/leaderboard` | Social |

## 11. UX / onboarding

- **First-time user experience (3 min)** : planter une `dewbud` → récolte accélérée scénarisée →
  éclosion (animation + carillon) → nommer → « tu as un compagnon ! ». 2 Lumi de départ offerts.
- Révélation **progressive** des features par niveau (anti-surcharge).
- Contrôles tactiles (un bouton d'action contextuel) : [03-GAMEPLAY.md](03-GAMEPLAY.md).

## 12. Accessibilité & sécurité

- Rareté signalée par forme/aura/texte (daltonisme) ; réduction d'animations ; mode calme.
- Sécurité mineurs, modération UGC, transparence des dépenses : [11-TECH-ARCHITECTURE.md](11-TECH-ARCHITECTURE.md).

## 13. Métriques de succès

KPI & cibles : [10-GROWTH-KPI.md](10-GROWTH-KPI.md). *North Star* : Gardiens hebdomadaires qui font
éclore/combinent des Lumi (WAH).

## 14. Risques de design & réponses

| Risque de design | Réponse |
|---|---|
| Génératif perçu comme « répétitif » | Mutations spectaculaires, accessoires, UGC, animations/tempéraments distincts |
| RNG frustrant | Chance pilotée par le soin + *bad luck protection* (pitié) |
| Vide de contenu social au lancement | Voisins/monde **pré-peuplés** (déjà : `server/scripts/demo.js`) |
| Complexité de la reproduction | Verrouillée à L4, tutoriel dédié, résultats lisibles (lignée affichée) |

## 15. Glossaire

**Lumi** : créature-compagnon générative. **Gardien/Keeper** : le joueur. **Great Bloom** : jauge
mondiale partagée. **Constellation** : guilde. **Bloom Pass** : battle pass saisonnier. **Pétales/
Lumen** : monnaies douce/premium. **Seed code** : identifiant partageable d'un Lumi. **Bloomdex** :
encyclopédie de collection.
