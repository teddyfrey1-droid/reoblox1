# 05 — Système social

> Le social est le **principal moteur d'acquisition (viralité) et de rétention long terme** de
> LUMORA. Principe : rendre le partage et l'entraide **intrinsèquement gratifiants**, jamais forcés.

## Coopération

**Décision :** privilégier la **coop asynchrone et bienveillante** (adaptée au mobile cozy)
plutôt que la coop synchrone exigeante.

- **Visites de voisins** : explorer le jardin d'autrui, l'arroser (l'aide accélère sa croissance),
  laisser un *like* ou un mot. Visiter **rapporte** (déjà : endpoint `/visit` → +Pétales).
- **Cadeaux** : offrir une graine/un décor (limité par jour, anti-abus) → fidélisation réciproque.
- **Co-jardinage** : parcelles communautaires dans le hub de Constellation (objectif partagé).

## Guilde / Clan — les **Constellations**

**Décision :** une seule structure sociale forte et nommée — la **Constellation** (≤ 30 membres).

- **But collectif hebdomadaire** : objectif de *bloom* commun (ex. « 5 000 Lumi cultivés
  ensemble ») → récompenses partagées (cosmétiques de Constellation, boosts).
- **Rôles** : Fondateur / Aîné / Membre (table `constellation_members`).
- **Hub** : *chat*, classement interne, parcelles communautaires, totem de Constellation.
- **Perks** : bonus de croissance passifs, salon décorable collectivement (statut + appartenance).
- **Score de bloom** : contribution cumulée (table `constellations.bloom_score`) → classement mondial.

**Pourquoi 30 membres :** assez grand pour la vie sociale, assez petit pour que **chaque membre
compte** (l'engagement chute dans les guildes anonymes de centaines de joueurs).

## Compétition (douce)

**Décision :** compétition **non-anxiogène**, basée sur la **collection et l'expression**, pas le PvP.

- **Classements** : puissance de collection, Constellations, événements (déjà : `/leaderboard`).
- **Défis d'éclosion** : « plus beau Lumi de la semaine » voté par la communauté (UGC + statut).
- **Ligues de saison** : divisions cosy (Graine → Bourgeon → Fleur → Aurore) avec montée/descente
  douce ; les récompenses sont **cosmétiques** (jamais de puissance) → pas de *pay-to-win* compétitif.

## Événements communautaires

- **Objectifs mondiaux (Great Bloom)** : toute la base joue vers un palier commun → déblocage pour
  tous + temps fort presse/partage (cf. 04 & 09).
- **Festivals de saison** : décor mondial, mini-jeux coopératifs, Lumi exclusif.
- **Événements de création** : concours d'îles à thème → mise en avant en jeu (UGC, cf. ci-dessous).

## Création de contenu par les joueurs (UGC)

**Décision :** UGC **encadré et progressif** — commencer par l'aménagement, étendre prudemment.

1. **Phase 1 (lancement)** : aménagement libre de l'île (décor, thèmes), **mode photo** puissant,
   et **partage de *seed codes*** (« voici le Lumi que j'ai trouvé : `LUMI-7F3K-9QZ2` »).
2. **Phase 2** : îles **visitables et notables**, galeries de collection publiques, défis communautaires.
3. **Phase 3 (long terme)** : éditeur de motifs/cosmétiques avec **modération** et éventuelle
   **part de revenus** créateurs (modèle Roblox/UEFN) — fort levier d'engagement et d'acquisition.

**Garde-fous UGC** : modération automatique + signalement, filtres de contenu, *age-gating*,
conformité mineurs (COPPA/RGPD-K). La sécurité prime sur la liberté créative (cf. 11).

## Partage sur les réseaux sociaux

**Décision :** intégrer le partage **au cœur des moments d'émotion**, avec des visuels « beaux par défaut ».

- **Carte de Lumi partageable** : à chaque éclosion rare/mutée, un visuel soigné (créature + nom
  + *seed code* + rareté) prêt à poster — le rendu existe déjà (`tools/render-svg.js` / canvas).
- **Mode photo** : poser sa scène, ses Lumi, filtres saisonniers → contenu *reel/TikTok-ready*.
- **Liens de *seed*** : un *deep link* ouvre le jeu sur l'aperçu du Lumi (et incite à l'installer).
- **Boucle de parrainage** (cf. 09/10) : inviter un ami → tous deux reçoivent un Lumi/cosmétique
  exclusif. Mesurée par le **K-factor** (cible ≥ 0,35).

## Sécurité & bien-être (non négociable)

- **Communication par défaut sûre** : *emotes*/phrases prédéfinies pour les mineurs ; chat libre
  réservé aux comptes vérifiés/adultes, modéré.
- **Pas de mécanique de harcèlement** : on ne peut qu'**aider** le jardin d'autrui (pas le saboter).
- **Contrôles** : blocage, signalement, sourdine ; contrôles parentaux ; transparence des dépenses.

> **Récapitulatif des endpoints sociaux déjà prototypés :** `/neighbours`, `/visit`,
> `/leaderboard`. Les Constellations/échanges/amis sont **modélisés en base** (`db/schema.sql` :
> `constellations`, `constellation_members`, `friendships`, `trades`) et planifiés en bêta (cf. 08).
