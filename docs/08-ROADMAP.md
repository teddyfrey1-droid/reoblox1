# 08 — Roadmap produit

> Stratégie : **prouver la rétention avant de dépenser en acquisition.** On ne *scale* le marketing
> qu'une fois les signaux (D1/D7/D30) validés en *soft launch*. Le génératif permet une cadence de
> contenu soutenable sur 10 ans.

## Phase 0 — Prototype / Vertical Slice ✅ *(ce dépôt)*

**Objectif :** prouver que le cœur est fun et techniquement solide.
- [x] Système génératif de Lumi (déterministe, équilibré, **testé**).
- [x] Boucle de jardin (planter→cultiver→récolter→éclore).
- [x] Économie 2-monnaies instrumentée + progression (niveaux, streak, quêtes).
- [x] API + prototype web jouable + rendu procédural.
- [x] Schéma BDD de production validé.

**Critère de sortie :** boucle jouable de bout en bout + tests verts (atteint).

## Phase 1 — MVP (mois 1–4)

**Objectif :** un *build* mobile jouable en interne, fidèle au *core loop*, sur le moteur cible.
- Client **Godot** (mobile-first) : jardin, éclosion animée, collection, boutique, daily/quêtes.
- Backend de prod : auth (Apple/Google/device), persistance **Postgres** (`db/schema.sql`), API.
- Onboarding « 3 minutes » + 2 biomes + reproduction + 1 saison factice.
- Télémétrie de base (events) + remote-config.

**Critère de sortie :** rétention interne/*playtests* qualitatifs positifs ; *crash-free* > 99 %.

## Phase 2 — Alpha fermée (mois 4–6)

**Objectif :** valider la rétention précoce et l'économie sur de vrais joueurs (1–5 k).
- Constellations (guildes) v1, visites/cadeaux, classements.
- Bloom Pass v1, abonnement v1, boutique cosmétique en rotation.
- Tableau de bord live-ops (faucet/sink, funnels) ; anti-triche v1.
- A/B testing de l'onboarding et des prix.

**Critère de sortie :** **D1 ≥ 35 %, D7 ≥ 16 %** sur cohortes alpha ; économie stable.

## Phase 3 — Bêta ouverte / Soft launch (mois 6–10)

**Objectif :** valider l'acquisition et la monétisation en marchés tests.
- Soft launch géographique (ex. Canada, Nordics, Philippines) pour tester CPI/LTV par marché.
- Échanges entre joueurs (escrow), mode photo, partage social natif, boucle de parrainage.
- Événements live hebdo + 1ʳᵉ vraie saison ; *bad luck protection* ; web shop (Stripe).
- Optimisation perf (appareils bas de gamme), localisation (8–10 langues).

**Critère de sortie :** **D30 ≥ 10–12 %, LTV/CAC ≥ 2** sur marchés tests ; ARPDAU sain.

## Phase 4 — Lancement mondial (mois 10–14)

**Objectif :** *scale* maîtrisé.
- Marketing global progressif (cf. 09), *featuring* Apple/Google visé, vague créateurs.
- Capacité serveur dimensionnée (autoscale), *war room* live-ops 24/7 les premières semaines.
- Sortie **Steam (PC)** en suivant (cross-progression).

**Critère de sortie :** stabilité à l'échelle, LTV/CAC ≥ 3, *featuring* obtenu.

## Contenu des 3 premières années (post-lancement)

### Année 1 — « Établir le rituel » (6 saisons de 8 sem)
- 6 saisons thématiques, +2 biomes, nouvelles familles de mutations, festivals de Great Bloom.
- Expéditions (envoyer des Lumi explorer le monde d'en bas → récompenses/narratif).
- Constellations v2 (parcelles communautaires, guerres de bloom amicales).
- **Cross-progression** PC↔mobile ; localisation étendue.

### Année 2 — « Approfondir & s'exprimer »
- **Éditeur UGC** de motifs/cosmétiques (modéré) + **galerie communautaire**.
- Habitats/dioramas thématiques pour exposer les Lumi ; *housing* étendu.
- Mode coop d'événement plus riche ; système d'**amitié**/cadeaux v2.
- Premiers **partenariats de marque** cozy (collabs cosmétiques) ; merch pilote (peluches *seed* d'un Lumi canon).

### Année 3 — « Devenir une plateforme/franchise »
- **Part de revenus créateurs** (cosmétiques UGC) à la Roblox/UEFN (si la modération est mûre).
- **Console** (Switch/équivalent) avec le cross-play cozy.
- Déclinaisons de marque : mini *party game* dans l'univers, jeu de cartes/collection physique,
  contenu animé court (YouTube/TikTok) pour nourrir la marque.
- Outils communautaires (tournois cozy, festivals créés par les Constellations).

## Jalons de gouvernance

| Jalon | *Go/No-Go* fondé sur |
|---|---|
| MVP → Alpha | Fun qualitatif + stabilité technique |
| Alpha → Soft launch | D1/D7 cibles atteintes |
| Soft launch → Mondial | **D30 + LTV/CAC** validés par marché |
| Mondial → *Scale* payant | LTV/CAC ≥ 3 soutenu |

> Règle d'or : **chaque phase a un critère de sortie chiffré.** On n'avance pas sur l'enthousiasme,
> on avance sur la donnée de rétention.
