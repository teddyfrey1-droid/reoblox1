# 12 — Business plan

> **Avertissement :** ce sont des **estimations de cadrage** (ordres de grandeur) destinées à la
> décision interne, fondées sur des repères publics du F2P mobile. Elles **ne constituent pas une
> garantie** et doivent être réactualisées avec de la donnée réelle de soft launch avant tout
> engagement financier. Toutes les hypothèses clés sont explicitées pour être contestables.

## Hypothèses de base (F2P cozy éthique)

| Hypothèse | Valeur retenue | Commentaire |
|---|---|---|
| ARPDAU | **0,08 $** (réaliste) | Bande 0,06–0,12 $ ; tiré par abonnement + Bloom Pass |
| Taux de payeurs | **3 %** | Cosmétique + abonnement |
| D30 | **12 %** | Hypothèse de rétention cible validée en soft launch |
| Part organique | **55 %** | Avantage viral cozy/génératif |
| Commission stores | **~25 %** moyen | Mix store (30/15 %) + web shop (Stripe ~5 %) |
| CAC moyen (payant) | **1,5–3 $** | Selon marché ; *scale* seulement à LTV/CAC ≥ 3 |

## Budget de développement (jusqu'au lancement mondial, ~14 mois)

Équipe cible ~**18–25 personnes** (studio efficace, le génératif réduisant la masse d'assets).

| Poste | Effectif type | Coût annuel estimé |
|---|---|---|
| Direction (GD, PM, tech lead, art director) | 4 | 0,7–0,9 M$ |
| Ingénierie (client Godot, backend, live-ops, data) | 7–9 | 1,4–2,0 M$ |
| Art & animation (2.5D, UI, VFX, char design) | 4–5 | 0,7–1,0 M$ |
| Game/économie/level design | 2–3 | 0,4–0,6 M$ |
| Audio (musique adaptative, SFX — partiel/externe) | 1 | 0,15–0,25 M$ |
| QA, *community*, marketing produit | 2–3 | 0,3–0,5 M$ |
| Infra/outils/licences/SaaS | — | 0,2–0,4 M$ |
| **Sous-total dev (annuel)** | ~22 | **~4,0–5,5 M$/an** |

- **Coût total jusqu'au lancement (~14 mois)** : **~5–7 M$** (dev) hors marketing.
- **Marketing de lancement** : **~2–5 M$** initiaux, *scalés uniquement* selon LTV/CAC.
- **Réserve/contingence** : +15–20 %.
- **Budget global recommandé pour atteindre le lancement mondial sécurisé : ~9–14 M$.**

> Le génératif et le live-ops *remote-config* sont des **réducteurs de coût structurels** : moins
> d'assets uniques à produire, cadence de saison soutenable avec une petite équipe de contenu.

## Revenus potentiels — modèle simplifié

Revenu mensuel ≈ **DAU × ARPDAU × 30 × (1 − commission)**.

| Scénario | DAU à maturité (an 1–2) | ARPDAU | Revenu brut/mois | Net/mois (~75 %) | Net/an |
|---|---|---|---|---|---|
| **Pessimiste** | 150 k | 0,05 $ | ~0,23 M$ | ~0,17 M$ | **~2 M$** |
| **Réaliste** | 600 k | 0,08 $ | ~1,44 M$ | ~1,08 M$ | **~13 M$** |
| **Optimiste** | 2,5 M | 0,11 $ | ~8,25 M$ | ~6,19 M$ | **~74 M$** |

> Repère SOM (cf. 01) : le scénario réaliste (~13 M$/an net) correspond à capter une fraction
> modeste (~0,3–0,5 %) du SAM cozy/collection — atteignable avec une rétention validée et une
> acquisition disciplinée.

## Scénarios détaillés

### 🔴 Pessimiste — « niche fidèle »
- La rétention plafonne (D30 ~8 %), l'UA payant ne *scale* pas (LTV/CAC < 2), croissance surtout organique.
- **Réponse :** rester *lean*, couper l'UA, vivre de la communauté noyau + abonnement, pivoter le
  contenu vers ce qui rétient. **Seuil de rentabilité** possible à petite échelle grâce aux coûts
  de contenu bas. Risque maîtrisé : pas de *burn* marketing massif (discipline LTV/CAC).
- **Issue :** projet à l'équilibre/petitement rentable ; option de *re-scope* ou de licence de marque.

### 🟢 Réaliste — « hit cozy durable »
- D30 ~12 %, K-factor ~0,35, LTV/CAC ≥ 3 sur marchés clés. *Scale* progressif.
- 6 saisons/an, abonnement à ~2 % des actifs, Bloom Pass performant.
- **Issue :** **~10–20 M$ net/an**, rentable dès la 2ᵉ année, base d'une franchise (an 2–3 : UGC, console, merch).

### 🟣 Optimiste — « franchise mondiale »
- *Featuring* majeur + vague créateurs + boucle virale forte → DAU en millions.
- Plateforme UGC (part créateurs), cross-platform, collabs de marque, merch, transmédia.
- **Issue :** **50–100 M$+ net/an** ; LUMORA devient une marque culturelle cozy (objectif 10 ans).

## Chemin vers la rentabilité

```
Coûts cumulés (dev+UA) ───────────────╮
                                       ╰──►  Point mort visé : 12–24 mois post-lancement
Revenus cumulés ──────────────────────╯       (scénario réaliste), porté par l'abonnement
                                              récurrent et 6 battements de saison/an.
```

- **Leviers de marge :** web shop direct (commission ↓), coûts de contenu bas (génératif),
  rétention (LTV ↑), organique/parrainage (CAC ↓).
- **Sensibilités majeures :** D30 et LTV/CAC sont les deux variables qui font basculer entre
  scénarios → ce sont précisément les **critères Go/No-Go** de la roadmap (08) et les KPI suivis (10).

## Risques financiers & couvertures

| Risque | Couverture |
|---|---|
| UA qui ne *scale* pas | Discipline LTV/CAC ≥ 3 ; priorité organique ; ne pas *burn* avant D30 validé |
| Dépendance plateforme (commission, *featuring*) | Web shop direct ; Steam/PC ; diversification des sources de revenu (aucune > 35 %) |
| Saisonnalité/lassitude de contenu | Cadence soutenable (génératif + remote-config) ; UGC en relais (an 2) |
| Marque/légal (nom, loot box) | Clearance avant marketing ; probabilités affichées ; pas de *pay-to-win* |
| Cycle de trésorerie | Founder's Pack + abonnement (revenu précoce et récurrent) ; budget par jalons |

> **Décision financière directrice :** financer **jalon par jalon** (08), n'ouvrir le robinet UA
> qu'une fois la rétention et la LTV prouvées. La prudence sur l'acquisition est ce qui transforme
> un bon jeu cozy en **entreprise rentable de 10 ans** plutôt qu'en *spike* sans lendemain.
