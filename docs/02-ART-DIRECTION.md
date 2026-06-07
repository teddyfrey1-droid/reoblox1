# 02 — Direction artistique

## Univers

Un archipel d'**îles flottantes** (« jardins célestes ») suspendues au-dessus d'un monde
recouvert par la **Brume Pâle** — une grisaille qui a aspiré couleur et vie. Les joueurs
sont des **Gardiens (Keepers)** qui rallument la lumière, île par île, en cultivant la vie
et en libérant les **Lumi**, de petits esprits de lumière. Plus la communauté fait éclore
de Lumi, plus la **Great Bloom** repousse la Brume et révèle le monde d'en bas.

**Ton :** chaleureux, optimiste, contemplatif, légèrement onirique. Jamais sombre ni anxiogène.
Conflit doux (restaurer, pas détruire). Émerveillement plutôt que tension.

## Ambiance

- **Mots-clés :** aube, duvet, rosée, vitrail, lanternes, mousse, brume qui se dissipe.
- **Émotion cible :** le soupir de soulagement du soir ; la fierté tranquille du jardinier ;
  l'étincelle de surprise à chaque éclosion.
- **Cycle jour/nuit** et **saisons** réels (synchronisés ou compressés) pour la variété et le rituel.

## Style graphique

**Décision :** **2.5D stylisé, formes douces et lisibles, palette pastel lumineuse**, rendu
« papier découpé / gouache » avec un léger grain. Personnages et Lumi en **vecteur/forme**
(cohérent avec le rendu procédural), décors en couches parallaxes.

**Options considérées :**
- **A. 3D réaliste / PBR** — coûteux, lourd sur mobile, à contre-emploi du ton cozy. ❌
- **B. Pixel art** — charmant mais sature le marché indé et limite la lisibilité des Lumi génératifs. ❌
- **C. 2.5D vecteur/forme pastel (retenu)** — léger, scalable, **parfaitement aligné avec le
  rendu procédural des Lumi** (mêmes primitives : blobs, dégradés, motifs), iconique et
  « peluche-ready ». ✅

**Pourquoi C :** le rendu génératif des Lumi (`web/lumi-render.js`, `tools/render-svg.js`)
est déjà fondé sur des formes vectorielles, palettes HSL harmoniques et motifs. Un style
global cohérent maximise la lisibilité, minimise le coût mémoire/asset, et garantit que les
créatures générées s'intègrent visuellement sans retouche manuelle.

## Charte des Lumi (lisibilité générative)

Le générateur produit des créatures **art-dirigées par construction** :
- **Palette harmonique** : teinte de base biaisée par l'élément + analogues + accent
  complémentaire + ventre clair (cf. `buildPalette` dans `core/genome.js`).
- **Silhouettes lisibles** : 6 archetypes (Sprout, Critter, Floater, Finling, Tot, Wyrm).
- **Signal de rareté** : *glow*/aura croissante (common → mythic) — lisible d'un coup d'œil.
- **Mutations spectaculaires** : Aurora (robe arc-en-ciel animée), Crystalline, Halo, Starlit…
  — ce sont les « trophées » visuels qui déclenchent le partage.

## Identité visuelle (marque)

| Élément | Spécification |
|---|---|
| **Logotype** | Mot-symbole « LUMORA » arrondi + glyphe fleur/étincelle « ✿ » comme app-icon |
| **Couleurs marque** | Pétale `#e85b8a`, Lumen `#6a5bd0`, Bloom `#5bc7a8`, encre `#3a2f44` |
| **Dégradé signature** | Ciel d'aube : `#fde7d2 → #f7c9d9 → #cbd9f5` (déjà dans `web/style.css`) |
| **Typo** | Sans-serif **arrondie** (UI Rounded / Nunito / Baloo) — douceur, lisibilité mobile |
| **Iconographie** | Pleine, arrondie, contours doux ; jamais d'angles durs |
| **Mascotte** | Un Lumi « héros » canonique (forme Tot, élément Bloom) pour le marketing/merch |

> Les *design tokens* de référence sont déjà codifiés dans [`web/style.css`](../web/style.css)
> (`:root`) pour garantir la cohérence prototype ⇄ marque.

## Direction sonore

**Décision :** **musique générative/adaptative** en couches, instrumentation acoustique douce.

- **Palette instrumentale :** harpe, célesta, marimba, nappes de cordes, piano feutré, chœurs
  « ah » discrets, textures de nature (vent, eau, carillons).
- **Adaptatif :** la densité musicale suit l'activité (calme en décoration, plus riche en récolte/
  événement) et le moment de la journée. À chaque éclosion : un **motif signature** (4 notes
  « LUMORA ») se résout en accord — récompense audio constante et reconnaissable (branding).
- **Génératif assumé :** des stems qui se recombinent réduisent le coût et évitent la lassitude
  — cohérent avec la philosophie du jeu.

## Effets audio (SFX)

- **Feedback juteux mais doux** : *plop* de plantation, *frisson* de croissance, **carillon
  d'éclosion** modulé par la **rareté** (plus la rareté est haute, plus l'accord est riche/long)
  — un *jackpot audio* qui renforce la boucle de récompense variable.
- **UI** : clics « bulle », validations en tierces majeures (positif), erreurs jamais stridentes.
- **Voix des Lumi** : *gibberish* mignon (type Animal Crossing) modulé par le **tempérament**
  (cheerful, shy, sleepy…) — attachement + différenciation sans coût de doublage.

## Accessibilité visuelle/sonore (dès le design)

- Daltonisme : la rareté est signalée **aussi** par forme/aura/badge texte, pas que par couleur.
- Réglages : taille de texte, réduction des animations, sous-titres des événements, mode
  « calme » (musique/SFX atténués). Conforme aux bonnes pratiques d'accessibilité mobile.
