# 📚 LUMORA — Dossier de production

Ce dossier réunit l'ensemble des documents nécessaires pour qu'une équipe puisse
**lancer la production immédiatement**. Chaque document prend des décisions (et non de
simples suggestions), compare les options et justifie le choix retenu — comme le ferait
un comité de direction de studio.

## Sommaire

| # | Document | Rôle |
|---|----------|------|
| 00 | [Vision globale](00-VISION.md) | Nom, concept, pitch, résumé exécutif, pourquoi un succès mondial |
| 01 | [Analyse stratégique](01-STRATEGY.md) | Cibles, personas, marché (TAM/SAM/SOM), positionnement, risques |
| 02 | [Direction artistique](02-ART-DIRECTION.md) | Univers, style, identité visuelle, direction sonore |
| 03 | [Gameplay complet](03-GAMEPLAY.md) | Boucles, progression, récompenses, difficulté, contrôles, mécanique unique |
| 04 | [Système de rétention](04-RETENTION.md) | Daily, quêtes, événements, saisons, collection, « pourquoi revenir » |
| 05 | [Système social](05-SOCIAL.md) | Coop, Constellations (guildes), compétition, UGC, partage |
| 06 | [Monétisation](06-MONETIZATION.md) | F2P, Bloom Pass, boutique, abonnement, prévisions, éthique |
| 07 | [Économie du jeu](07-ECONOMY.md) | Ressources, sources/puits, inflation, équilibrage, échanges |
| 08 | [Roadmap produit](08-ROADMAP.md) | MVP → Alpha → Bêta → Lancement → 3 ans de contenu |
| 09 | [Marketing](09-MARKETING.md) | Acquisition, créateurs, influence, presse, parrainage |
| 10 | [Croissance & KPI](10-GROWTH-KPI.md) | KPI, A/B testing, boucles virales, LTV/CAC |
| 11 | [Architecture technique](11-TECH-ARCHITECTURE.md) | Stack, backend, scalabilité, sécurité, anti-triche, IA |
| 12 | [Business plan](12-BUSINESS-PLAN.md) | Budget, revenus, scénarios pessimiste / réaliste / optimiste |
| — | [Game Design Document](GDD.md) | GDD maître (référence transverse) |
| — | [Product Requirements Document](PRD.md) | PRD du MVP (exigences, critères d'acceptation) |

## Convention de décision

Chaque section importante suit ce schéma :

> **Décision :** ce que nous faisons.
> **Options considérées :** A / B / C.
> **Pourquoi :** la justification (données, coût, risque, alignement vision).

## Lien code ⇄ docs

Le prototype dans `core/`, `server/`, `web/` **implémente déjà** les mécaniques décrites
ici (génération de Lumi, économie 2-monnaies, *streaks*, quêtes, boucle de jardin,
reproduction, classement). Les valeurs d'équilibrage citées dans les docs sont les
**mêmes constantes** que celles de `core/content.js` — une seule source de vérité.
