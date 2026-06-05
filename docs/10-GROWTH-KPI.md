# 10 — Croissance, KPI & expérimentation

> Ce que l'on mesure, on l'améliore. LUMORA est piloté par la **donnée de cohorte**. Tous les
> systèmes émettent des events (`analytics_events` en base + pipeline temps réel → entrepôt).

## North Star Metric

**Décision :** la *North Star* est le **nombre de Gardiens activement engagés qui font éclore /
combinent des Lumi chaque semaine** (WAH — *Weekly Active Hatchers*). Elle capte à la fois la
valeur (le cœur de boucle), la rétention et la propension au partage/à la dépense.

## KPI par pilier

### Acquisition
| KPI | Cible |
|---|---|
| CPI (par marché) | < bande LTV/3 |
| Part organique | > 50 % |
| **K-factor** (viralité) | **≥ 0,35** |
| Install → D1 (open) | > 75 % |

### Rétention (le pilier décisif)
| KPI | Cible |
|---|---|
| **D1** | **≥ 40 %** |
| **D7** | **≥ 20 %** |
| **D30** | **≥ 12 %** |
| Sessions / DAU / jour | **≥ 2** |
| Durée de session médiane | 8–15 min |
| DAU/MAU (*stickiness*) | ≥ 25 % |

### Engagement / boucle
| KPI | Cible |
|---|---|
| Éclosions / joueur / jour | ≥ 3 |
| Taux d'usage reproduction (L4+) | ≥ 40 % |
| Taux de complétion quêtes | ≥ 60 % |
| Adhésion Constellation (J30) | ≥ 35 % |

### Monétisation
| KPI | Cible |
|---|---|
| **ARPDAU** | 0,06–0,12 $ |
| Taux de payeurs | 2,5–4 % |
| % abonnés (des actifs) | 1,5–3 % |
| **LTV (J180)** | > 3 × CAC |
| Ratio **faucet/sink** (Pétales) | 1,0–1,15 |

## LTV / CAC — le garde-fou du scaling

**Décision :** **on ne *scale* l'UA payant qu'à LTV(J180)/CAC ≥ 3** sur un marché donné.
- LTV modélisée par cohorte (rétention × ARPDAU, projection survie + abonnement).
- CAC par canal/marché. Tableau de bord par cohorte d'installation.
- Boucle : tester petit → mesurer ROAS J7/J30 → projeter LTV → *scale* ou couper.

## Boucles de croissance (growth loops)

1. **Boucle virale (contenu)** : éclosion rare → partage image/seed → install → nouvelle éclosion.
2. **Boucle de parrainage** : invitation → récompense double → l'invité invite à son tour.
3. **Boucle sociale** : visites/Constellations → engagement → rétention → plus de contenu partagé.
4. **Boucle de contenu live** : saison → battement marketing → réactivation des dormants → revenus
   → financement de la saison suivante.
5. **Boucle méta (Great Bloom)** : progrès communautaire → presse/temps fort → vague d'installs.

## A/B testing & expérimentation

**Décision :** plateforme d'expérimentation dès l'alpha (assignation par *bucket* stockée dans
`players.flags`), un seul changement testé à la fois, significativité statistique avant *rollout*.

**Backlog d'expériences prioritaires :**
- Onboarding : longueur, premier Lumi garanti *rare* ou non, moment du 1ᵉʳ déblocage.
- Daily/streak : valeurs, taille du *grace period*, animation de récompense.
- Économie : prix des graines premium, coût du Rituel, profondeur des puits cosmétiques.
- Monétisation : prix/contenu du Bloom Pass, avantages de l'abonnement, offres de *first purchase*.
- Viralité : formulation/récompense du parrainage, design de la carte de partage.

> **Avantage déterministe :** la génération étant reproductible et testable, on peut **simuler**
> hors-ligne l'impact d'un changement d'équilibrage (distribution des raretés, faucet/sink) **avant**
> de l'exposer — réduisant le risque des expériences live (mêmes fonctions que `test/`).

## Funnels surveillés

- **Onboarding** : install → 1ʳᵉ plantation → 1ʳᵉ éclosion → J1 retour (chaque marche optimisée).
- **Social** : 1ʳᵉ visite → adhésion Constellation → 1ᵉʳ échange.
- **Monétisation** : 1ʳᵉ ouverture boutique → 1ᵉʳ achat → abonnement → renouvellement.

## Lutte contre le churn

- **Signaux de churn** : streak rompu, baisse de sessions, quêtes ignorées.
- **Réactivation** : notifications *opt-in* respectueuses (récolte prête, ami actif, événement),
  cadeaux de retour, *win-back* d'événement. **Jamais de spam** (l'inverse nuit à la marque cozy).
- **Dormants** : campagnes de réveil alignées sur les saisons (battement naturel).
