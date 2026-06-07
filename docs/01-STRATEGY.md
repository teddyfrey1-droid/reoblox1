# 01 — Analyse stratégique

## Public cible

**Décision :** cœur de cible **18–34 ans, à forte représentation féminine et non-binaire**,
joueurs « cozy/casual investis », étendu aux familles et aux ados (13+) et aux *completionists*.

LUMORA est conçu pour couvrir tout le spectre d'investissement, des deux côtés du sablier :

- **Casual** : sessions courtes, jolies, sans pression — planter, récolter, décorer, admirer.
- **Core/Hardcore** : optimisation de lignées (reproduction), chasse aux mutations rares,
  classements de Constellation, complétion du *Bloomdex*.

## Personas détaillés

### 1. « Maya, la jardinière du soir » — *cozy casual* (cœur de cible)
- 26 ans, joue 15–25 min le soir sur mobile pour décompresser.
- **Motivations :** détente, esthétique, accomplissement doux, expression de soi.
- **Ce qu'elle adore :** décorer son île, voir éclore une créature mignonne, le *streak* quotidien.
- **Ce qui la ferait partir :** pression *FOMO* agressive, *paywalls*, complexité subite.
- **Monétise via :** *Bloom Pass*, packs de décoration saisonniers, abonnement « Jardin Doré ».

### 2. « Léo, le collectionneur » — *core completionist*
- 21 ans, joue 45–90 min/jour, multi-sessions. Veut **tout** débloquer.
- **Motivations :** complétion, rareté, maîtrise du système de reproduction.
- **Ce qu'il adore :** chasser les mutations (Aurora, Mythic), perfectionner une lignée, grimper.
- **Ce qui le ferait partir :** plafond de contenu, RNG injuste sans pitié (*bad luck protection*).
- **Monétise via :** graines premium (chance douce), slots de jardin, événements, cosmétiques rares.

### 3. « Sam & sa fille (9 ans) » — *famille*
- Jouent ensemble le week-end, partagent un foyer/compte familial.
- **Motivations :** moment partagé, sûreté, progression sans frustration.
- **Ce qui les retient :** coop locale/visites, contenu non violent, contrôles parentaux clairs.
- **Monétise via :** achat ponctuel de packs, *Bloom Pass* familial.

### 4. « Nora, la créatrice » — *UGC / influence*
- 24 ans, streame et poste des *reels*. Cherche du contenu « partageable ».
- **Motivations :** statut, originalité, communauté.
- **Ce qu'elle adore :** îles à thème, défis « breed the rarest », *seed codes* viraux.
- **Valeur stratégique :** moteur d'acquisition organique (cf. 09-Marketing).

## Taille de marché

> Chiffres d'ordre de grandeur pour cadrer l'ambition. Source : agrégats publics du marché du
> jeu vidéo (Newzoo / Sensor Tower / data.ai, ~2023-2025). **À réactualiser** avant tout comité
> d'investissement — voir 01-Risques (ne pas traiter ces nombres comme audités).

- **TAM** — Jeu vidéo mondial ≈ **180–190 Md$/an**, dont mobile ≈ 50 %. Le *live-service* domine
  les revenus récurrents.
- **SAM** — Segment cozy + social + collection sur mobile/PC : estimation interne **8–12 Md$/an**
  (Animal Crossing, Roblox cozy-experiences, Stardew, Disney Dreamlight Valley, Palia, Sky…).
- **SOM** (3 ans, scénario réaliste) — capter **0,3–0,8 %** du SAM, soit **~30–90 M$/an** de
  bookings à maturité. Hypothèses détaillées dans [12-BUSINESS-PLAN.md](12-BUSINESS-PLAN.md).

## Positionnement

> **Carte de positionnement** (deux axes) :
> *Pression compétitive* (bas ↔ haut) × *Profondeur de système* (faible ↔ forte).

```
   Profondeur système ▲
                       │      ● Palworld
        ● Stardew      │   ● Pokémon
                       │ ★ LUMORA (profond mais doux)
        ● Animal       │
          Crossing     │      ● Genshin
        ● Dreamlight   │
   ────────────────────┼────────────────────► Pression compétitive
        ● Sky          │   ● Fortnite
                       │
```

**Énoncé de positionnement :** *« Pour les joueurs qui veulent la profondeur d'un jeu de
collection sans la toxicité de la compétition, LUMORA est le monde social où chaque créature
est unique et où progresser est apaisant. »*

## Avantages concurrentiels (les « douves »)

1. **Système génératif propriétaire + déterministe** — difficile à copier proprement
   (qualité artistique du génératif + équilibrage des raretés + reproductibilité serveur).
   Implémenté et testé : `core/genome.js`.
2. **Coût de contenu structurellement bas** — le génératif libère du budget pour le live-ops.
3. **Méta partagé (Great Bloom)** — un objectif communautaire qui crée de la rétention de
   *cohorte* (on revient parce que « le monde » progresse), pas seulement individuelle.
4. **Économie d'échange entre joueurs** — la rareté générative crée un marché secondaire
   naturel (liquidité → engagement → rétention), encadré pour rester sain.
5. **Marque transmédia dès le design** — créatures « peluche-ready », univers positif.

## Risques potentiels & mitigations

| Risque | Gravité | Probabilité | Mitigation |
|---|---|---|---|
| **Marque/nom déjà pris** (Lumora/Lumi) | Élevée | Moyenne | Recherche d'antériorité + dépôt **avant** soft launch ; nom de repli prêt (*Bloomhaven*) |
| **Le génératif paraît « répétitif »** | Élevée | Moyenne | Investir dans la lisibilité des formes/animations, mutations spectaculaires, accessoires UGC |
| **F2P : faible taux de payeurs** | Moyenne | Élevée (normal F2P) | Abonnement + *Bloom Pass* à forte valeur perçue ; viser ARPDAU sain plutôt que *whales* |
| **Économie d'échange → inflation / fraude** | Moyenne | Moyenne | Puits robustes, taxes d'échange, *bad luck protection*, anti-bot (cf. 07 & 11) |
| **Dépendance plateformes (Apple/Google 30 %)** | Moyenne | Certaine | Web shop direct (Stripe) pour le premium ; diversifier PC (Steam) |
| **Coût d'acquisition (CAC) qui dérape** | Élevée | Moyenne | Prioriser l'organique/créateurs ; boucle de parrainage ; ne scaler le payant qu'à LTV/CAC≥3 |
| **Modération UGC / sécurité mineurs** | Élevée | Moyenne | Filtres, modération, *age-gating*, conformité (RGPD-K, COPPA) dès le MVP |
| **Burn-out de contenu live** | Moyenne | Moyenne | Outils live-ops + remote-config + génératif = cadence de saison soutenable |

**Décision de gouvernance du risque :** le **risque n°1 traité avant toute dépense marketing**
est la **clearance de marque** ; le **risque produit n°1** est la *perception de répétitivité*,
adressé par la direction artistique (02) et le système de mutations/UGC (03/05).
