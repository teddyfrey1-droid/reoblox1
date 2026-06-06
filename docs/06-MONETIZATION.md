# 06 — Monétisation

> Thèse centrale : **vendre du temps, de la chance douce et de l'expression — jamais de la
> puissance.** La confiance des joueurs est l'actif le plus précieux d'un *live-service* de 10 ans ;
> on protège la LTV en protégeant l'expérience.

## Modèle : Free-to-Play

**Décision :** **F2P** (avec un éventuel *« Founder's Pack »* premium au lancement).

**Options considérées :**
- **A. Premium payant** — barrière à l'entrée, tue la viralité et le social (masse critique). ❌
- **B. F2P agressif (gacha *pay-to-win*)** — ARPU élevé court terme mais détruit la confiance,
  la rétention et la marque long terme ; incompatible avec le ton cozy. ❌
- **C. F2P éthique « cosmétique + commodité + abonnement » (retenu)** — maximise l'audience
  (acquisition/viralité) et la rétention, monétise par l'attachement et l'expression. ✅

## Architecture des monnaies

| Monnaie | Type | Gagnée | Achetée | Rôle |
|---|---|---|---|---|
| **Pétales 🌸** | Douce | Oui (jeu) | Non | Boucle économique principale (graines, décor, biomes) |
| **Lumen ✦** | Premium | Lentement (events, j7) | Oui | Cosmétiques, Rituel, *time-skips*, Bloom Pass |

> Implémenté/testé : `core/economy.js` (caps, anti-dépassement, grand-livre source/puits).
> Le **Lumen ne donne aucune puissance** : il achète du cosmétique, du confort et du contenu —
> jamais un avantage de progression verrouillé.

## Piliers de revenu

### 1. Bloom Pass (battle pass saisonnier) — **revenu pilier**
- Saison de 8 semaines, **50 paliers**, voie **gratuite généreuse** + voie **premium**.
- Premium ≈ **9,99 €/saison** ; valeur perçue très supérieure au prix (cosmétiques exclusifs,
  *chase* Lumi mythic saisonnier, skins de biome).
- La voie gratuite reste forte → les non-payeurs restent engagés (et donc partagent/parrainent).
- Modèle/contenu : `BLOOM_PASS` dans `core/content.js` ; suivi en base `pass_progress`.

### 2. Abonnement « Jardin Doré » — **revenu récurrent stable**
- ≈ **4,99 €/mois**. Avantages **de confort et d'expression**, non *pay-to-win* :
  +1 parcelle, file de croissance plus longue, *stipend* quotidien de Lumen, bonus cosmétique
  mensuel, double quêtes, cadre photo exclusif.
- L'abonnement est le **meilleur revenu** (récurrent, prévisible, fidélisant). KPI clé : % abonnés.

### 3. Boutique cosmétique (rotation) — **expression**
- Décor, thèmes de biome, accessoires de Lumi, traînées/auras, cadres photo, tenues de Gardien.
- **Rotation quotidienne/hebdo** + offres saisonnières. Achats directs en Lumen.
- Modèle : `DECOR` dans `core/content.js` ; vente via `/shop/buy`.

### 4. Graines premium & *time-skips* — **commodité + chance douce**
- Graines premium (`moonvine`, `starbloom`) : **meilleures probabilités de rareté** (`rarityLuck`),
  pas de garantie de puissance → c'est de la *chance accélérée*, transparente, jamais obligatoire.
- *Time-skip* d'une parcelle (finir la croissance) en Lumen — confort classique mobile.
- **Éthique :** affichage clair des probabilités (cf. réglementations « loot box » UE/UK/JP),
  **bad luck protection** (pitié) pour éviter le sentiment d'arnaque.

### 5. Rituel de Floraison (reproduction) — **puits premium**
- Coûte **25 Lumen** par rituel (déjà : `/breed`). Sink premium élégant : on paie pour *créer*,
  pas pour *gagner*. Optionnel (jouable sans payer grâce au stipend/events).

### 6. Founder's Pack & offres ponctuelles — **conversion précoce**
- Au soft launch : pack fondateur (cosmétique exclusif + Lumen + abonnement d'essai) à prix doux.
- Offres de progression (jamais de la puissance) : packs de décor à thème, *starter bundles*.

## Sources de revenu — répartition cible (à maturité)

| Source | % des revenus (cible) | Nature |
|---|---|---|
| Bloom Pass | ~35 % | Saisonnier |
| Abonnement Jardin Doré | ~30 % | Récurrent |
| Boutique cosmétique | ~20 % | Impulsif |
| Graines premium / time-skips | ~10 % | Commodité |
| Founder/offres ponctuelles | ~5 % | Événementiel |

> Diversifié exprès : aucun pilier > 35 % → robustesse face aux changements de plateforme/règles.

## Web shop direct (marge)

**Décision :** proposer un **achat web direct** (Stripe) pour Lumen/abonnement, en plus des stores.
- Économise la commission de 15–30 % des plateformes sur une partie des transactions.
- Conforme aux évolutions récentes (liens externes autorisés). Le store reste l'option par défaut
  pour la confiance/friction minimale ; le web shop est *incité* (léger bonus de Lumen).

## Prévisions financières (résumé)

Hypothèses détaillées et scénarios dans [12-BUSINESS-PLAN.md](12-BUSINESS-PLAN.md). Repères :
- **ARPDAU cible** : 0,06–0,12 $ (sain pour un cozy F2P éthique).
- **Taux de payeurs** : 2,5–4 % (abonnement = levier de hausse).
- **% abonnés** parmi les actifs : 1,5–3 %.

## Équilibre plaisir ⇄ revenus (règles d'or)

1. **Jamais de mur.** Tout contenu de gameplay est atteignable gratuitement avec du temps.
2. **Pas de puissance à vendre.** Les stats des Lumi sont *low-stakes* et plafonnées (`core/genome.js`).
3. **Générosité gratuite quotidienne** garantie (daily, quêtes, events) → confiance.
4. **Transparence** des probabilités + *bad luck protection*.
5. **Pas de *dark patterns*** (faux compte à rebours trompeur, prix obscurs, *pay-to-skip-ads*
   harcelant). On préfère une LTV durable à un *spike* trimestriel.
6. **Protection des mineurs & des dépenses** : limites, confirmations, transparence parentale.

> Cette discipline **est** la stratégie de revenu long terme : un cozy game se monétise sur des
> années par la fidélité, pas sur un trimestre par l'extraction.

## Implémentation dans la *slice* (testée)

- **Bloom Pass** : `core/pass.js` (+ routes `/pass`, `/pass/claim`, `/pass/upgrade`).
- **Achats IAP** : `server/iap.js` — vérification de reçu **pluggable** (provider `test`
  signé HMAC ; Apple/Google/Stripe en stubs honnêtes → `501` tant que non câblés) +
  `POST /api/players/:id/iap/redeem` **idempotent** : un `transactionId` ne crédite
  **qu'une fois** (déduplication via la table `iap_receipts`, persistée et testée sur
  PgStore). Les achats ne sont **jamais** acceptés sur la seule parole du client.
- **Abonnement « Jardin Doré »** : `core/subscription.js` — activation, **cumul** au
  renouvellement (aucune journée perdue), **stipend** de Lumen quotidien (`/subscription`,
  `/subscription/stipend`). Avantages de confort/expression uniquement (non *pay-to-win*).
- **Catalogue produits** public : `GET /api/store/products` (`IAP_PRODUCTS`).

> Les vérificateurs Apple/Google/Stripe réels (App Store Server API, Play Developer API,
> signatures Stripe) se branchent sur la même interface — le pipeline redeem→grant→
> idempotence est déjà éprouvé.
