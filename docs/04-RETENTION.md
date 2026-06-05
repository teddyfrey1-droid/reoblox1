# 04 — Système de rétention

> Objectif : transformer un jouet agréable en **habitude quotidienne** puis en **rituel durable**,
> sans recourir à la pression toxique. Cibles : **D1 ≥ 40 %, D7 ≥ 20 %, D30 ≥ 12 %** (voir 10).

## Cadre : les 3 horizons de rétention

| Horizon | Mécanique motrice | Émotion |
|---|---|---|
| **Session → session (jour)** | Croissance en temps réel, streak, quêtes, énergie sociale | « Mes graines sont prêtes » |
| **Semaine → semaine** | *Bloom Pass*, événements hebdo, Constellations | « L'événement se termine dimanche » |
| **Mois → année** | Saisons, Bloomdex, lignées, Great Bloom, prestige | « Je construis quelque chose » |

## Daily rewards (récompenses de connexion)

**Décision :** échelle **hebdomadaire croissante** avec **jour 7 = monnaie premium** + multiplicateur
de *streak*, **mais pardon d'un jour manqué** (anti-rage-churn).

- Implémenté/testé : `claimDaily` (`core/progression.js`, `test/progression.test.js`).
- **Jour de grâce** : un seul jour manqué conserve le streak (sans l'incrémenter) ; au-delà, reset.
  → punit assez pour motiver, pardonne assez pour ne pas faire fuir (loss-aversion *douce*).
- **Multiplicateur** : +10 % de Pétales par semaine de streak (plafonné +100 %), **jamais** sur la
  monnaie premium (on n'inflate pas le premium via le temps).
- **Idempotent** : réclamer deux fois le même jour ne fait rien (sûr hors-ligne/retry).

Échelle (cf. `DAILY_REWARDS` dans `core/content.js`) : j1 120🌸 … j3 +graine … j5 +graine …
**j7 800🌸 + 60✦**.

## Quêtes

**Décision :** **3 quêtes quotidiennes** générées **déterministe­ment par (joueur, jour)**.

- Implémenté/testé : `dailyQuests` (`core/progression.js`). Mêmes 3 quêtes toute la journée,
  fraîches le lendemain, différentes d'un joueur à l'autre, **sans aucun stockage** (dérivées
  d'une graine `playerId:dayIndex`).
- Objectifs courts et complétables en une session (planter, faire éclore, visiter, arroser,
  photographier, décorer). Récompense XP + Pétales.
- **Quêtes hebdomadaires** (à ajouter) : objectifs plus longs → palier du Bloom Pass.

## Événements

**Décision :** cadence **un mini-événement par semaine**, **un temps fort par saison**.

- **Mini-événements hebdo** : « Pluie d'étoiles » (taux de mutation Starlit ↑), « Marée
  haute » (biome Tide Pools boosté), « Nuit du Nocturne » (Lumi Lune exclusifs)…
  Implémentés via *remote-config* (multiplicateurs de `luck`/`mutationBoost` déjà câblés
  dans `generateLumi`).
- **Temps fort de saison** : un Lumi *mythic* exclusif, un biome événementiel, une histoire courte.
- **Événements communautaires Great Bloom** : objectif mondial (« faire éclore 10 M de Lumi
  d'eau cette semaine ») → palier débloqué pour **tous** (rétention de cohorte + presse/partage).

## Saisons

**Décision :** **saisons de 8 semaines** alignées sur le *Bloom Pass* (50 paliers).

- Chaque saison : thème, nouveau biome ou skin de biome, nouvelles mutations cosmétiques,
  histoire, et **chase Lumi** mythic saisonnier (cf. `BLOOM_PASS` dans `core/content.js`).
- **Soft reset** doux : les classements de saison se réinitialisent ; la collection, elle, est
  **permanente** (on ne punit jamais l'investissement).

## Progression long terme

- **Bloomdex** (collection encyclopédique) : objectif de complétion sur des mois.
- **Lignées** : perfectionner une lignée (stats, mutations) est un projet auto-entretenu.
- **Prestige de jardin** : niveaux de « Bloom » du jardin, titres, thèmes débloqués.
- **Great Bloom mondial** : une barre qui ne se remplit qu'avec des **années** de communauté
  → narratif de long terme (« on a réveillé le monde »).

## Collection & déblocages

- **Collection** : tri par récence/puissance/rareté (déjà dans l'API `/collection`).
- **Déblocages** : biomes, parcelles, slots, décor, cosmétiques, expéditions — étalés par niveau
  et par boutique pour entretenir un flux constant de « prochaine chose ».
- **Photo & exposition** : un mode photo (à venir) transforme la collection en contenu partageable.

## Systèmes communautaires (rétention sociale)

- **Constellations (guildes)** : objectif collectif hebdo, *chat*, entraide d'arrosage.
- **Visites & cadeaux** : économie sociale douce (visiter rapporte ; offrir une graine fidélise).
- **Classements** : par puissance de collection et par Constellation (déjà : `/leaderboard`).
- Détails dans [05-SOCIAL.md](05-SOCIAL.md).

## « Pourquoi revenir chaque jour » — la check-list de l'habitude

1. **Un rendez-vous** : mes graines/Lumi sont prêts à une heure précise.
2. **Une série à protéger** : mon *streak* (avec pardon, donc sans anxiété).
3. **Trois petites missions** : quêtes quotidiennes complétables en une session.
4. **Une raison sociale** : un voisin a un nouveau Lumi ; ma Constellation a besoin de moi.
5. **Une urgence douce** : l'événement de la semaine se termine bientôt.
6. **Une surprise possible** : la prochaine éclosion sera peut-être *mythic*.
7. **Un progrès visible** : le Great Bloom et mon jardin avancent.

> Principe directeur : **toujours au moins une récompense gratuite et généreuse par jour**, pour
> que la rétention ne dépende jamais de l'achat. La monétisation *accélère* le plaisir, elle ne
> le *débloque* pas (cf. 06).
