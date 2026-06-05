# 07 — Économie du jeu

> Une économie *live-service* de 10 ans se gère comme une banque centrale miniature : il faut
> **mesurer, équilibrer les sources (faucets) et les puits (sinks)**, et combattre l'inflation
> qui détruit la valeur perçue (et donc la monétisation). Tout ici est instrumenté en code.

## Ressources

| Ressource | Type | Rôle |
|---|---|---|
| **Pétales 🌸** | Monnaie douce | Cœur de la boucle (graines, décor, biomes) |
| **Lumen ✦** | Monnaie premium | Cosmétiques, Rituel, confort, Bloom Pass |
| **Graines** | Consommable | Intrant de la boucle de jardin → Lumi |
| **Lumi** | Actif (collection) | Statut, reproduction, échange |
| **XP / Bloom** | Progression | Niveaux, déblocages, méta partagé |
| **Décor / cosmétiques** | Actif durable | Expression de soi (puits sans rejeu) |

## Carte des sources (faucets) et puits (sinks)

```
   SOURCES (création de monnaie)            PUITS (destruction de monnaie)
   ─────────────────────────────            ──────────────────────────────
   • Daily reward (🌸, j7 ✦)                • Achat de graines (🌸/✦)
   • Quêtes (🌸 + XP)                        • Achat de décor (🌸/✦)   ← puits sain (cosmétique)
   • Streak (×🌸)                            • Déblocage de biomes (🌸/✦)
   • Visites sociales (🌸)                   • Parcelles / slots (🌸)
   • Bloom Pass (🌸/✦/cosmétiques)           • Rituel de Floraison (✦ 25)   ← puits premium
   • Événements (🌸/✦)                       • Time-skips (✦)
   • Achat IAP (✦)                           • Taxe d'échange entre joueurs (🌸)  ← anti-inflation
```

> Tout mouvement passe par `credit`/`debit`/`pay`/`grant` (`core/economy.js`) qui **journalisent**
> chaque opération (source/sink + raison). `faucetSinkReport` calcule le **ratio faucet/sink** —
> l'indicateur d'inflation que la *live-ops* surveille quotidiennement (testé dans `economy.test.js`).

## Contrôle de l'inflation

**Décision :** maintenir, sur la monnaie douce, un **ratio faucet/sink global ≈ 1,0–1,15** et
réagir vite s'il dérape.

**Leviers en cas d'inflation (faucet/sink > ~1,2) :**
1. **Ajouter des puits attractifs** (nouveau décor, expansions, cosmétiques) — *préféré* :
   on retire de la monnaie en **donnant du plaisir** (expression), pas en frustrant.
2. **Augmenter les coûts** des intrants à forte demande (prudemment, télémétré).
3. **Réduire des faucets** marginaux (jamais le daily/quêtes garantis → confiance).

**Leviers en cas de déflation (les joueurs manquent de monnaie) :**
- Augmenter les récompenses d'événements, baisser temporairement des prix, *drops* spéciaux.

> **Caps stricts** par monnaie (`CURRENCIES.hardCap`) pour borner les comptes et limiter l'impact
> d'un éventuel exploit. Les crédits sont *clampés* (testé : `credit clamps to the currency hard cap`).

## Progression économique (early → late game)

| Phase | Joueur | Économie |
|---|---|---|
| **Découverte** (j0–3) | Apprend la boucle | Faucets généreux, prix bas → momentum, dopamine |
| **Établissement** (sem 1–4) | Optimise, débloque | Introduction des puits durables (biomes, décor) |
| **Maîtrise** (mois 2+) | Lignées, complétion | Puits profonds (cosmétiques premium, rituels, échanges) |

La **courbe de prix** (`core/content.js`) suit cette progression : graines/biomes/décor de coût
croissant pour absorber le pouvoir d'achat grandissant des vétérans.

## Échanges entre joueurs

**Décision :** **échange direct sécurisé (escrow)** déverrouillé à **L8**, encadré pour rester sain.

- **Modèle escrow** : les deux parties confirment ; transfert atomique (table `trades`).
- **Anti-inflation/anti-fraude :**
  - **Taxe d'échange** en Pétales (puits) sur chaque transaction.
  - **Plafonds** de valeur/volume par jour ; **délai** anti-bot ; *trust score*.
  - **Lumi *locked*** non échangeables (protection contre le vol/erreur).
  - **Pas de marché de monnaie réelle** : RMT interdit, détection et bannissement (cf. 11 anti-triche).
- **Liquidité** : la rareté générative crée une offre/demande naturelle (lignées, mutations, éléments)
  → un marché vivant **sans** spéculation toxique, parce qu'aucun Lumi ne donne d'avantage de puissance.

## Équilibrage des Lumi (anti pay-to-win by design)

- Les 4 stats (charm/vigor/harmony/spark) sont **basses et plafonnées** par la rareté
  (`rollStats`, `statMul` ≤ 2,2). Elles débloquent des *talents mignons* (ex. aura de croissance),
  jamais une domination. → un Lumi *mythic* est un **trophée esthétique**, pas une arme.
- La **chance** de rareté est influencée par le **soin** et le **Great Bloom** (jouables
  gratuitement) ; les graines premium ne font qu'**accélérer**, sans garantir.

## Tableau de bord économie (live-ops)

À brancher sur le grand-livre (`economy_ledger`) et les events analytics :
- Ratio **faucet/sink** par monnaie (alerte si hors bande).
- **Sinks par raison** (où part la monnaie) — repère les puits sous/sur-utilisés.
- **Distribution des soldes** (médiane, P95) — détecte thésaurisation et exploits.
- **Prix effectif** des objets (demande) ; **taux de conversion** par offre.
- **Santé de la rareté** : distribution réelle vs cible (auditée via la même logique que les tests).

> En résumé : l'économie de LUMORA est **instrumentée dès le prototype** (grand-livre + rapport
> faucet/sink en code testé), ce qui permet une gestion *live-ops* fondée sur la donnée dès le J1.
