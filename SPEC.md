# SPEC — Abaque de Smith interactif (remplaçant de Smith V3.10)

Phase 0 — spécification fonctionnelle et architecture. Rien n'est codé à ce stade.
Document établi le 2026-11-13 à partir de la documentation publique de F. Dellsperger et du
chapitre 8 du cours SysRF (Hochet & Favrat, 2017). Aucun binaire n'a été téléchargé, décompilé
ni exécuté.

## 1. Sources

| Réf. | Source | Contenu utilisé |
|---|---|---|
| [S1] | `http://www.fritz.dellsperger.net/smith.html` | Liste des fonctionnalités de Smith V4.1, limites de la démo |
| [S2] | *Help Smith V4.1* (PDF, 82 p., janv. 2018), même site | Éléments, paramètres, sweeps, cercles, netlist, formats de fichier, historique des versions |
| [S3] | *Readme V4.1* (PDF) | Notes de version 4.0 / 4.1 |
| [S4] | *What's New in V4.0* (PDF) | Tuning Cockpit |
| [S5] | *Examples V4.1* (PDF, 39 p.) | 18 exemples avec captures (valeurs numériques exploitables comme références) |
| [C]  | Cours SysRF chap. 8, slides 1–17 | Notions, vecteurs de test, capture de Smith V3.10 (slide 17) |

Remarques :
- Le site ne publie plus de documentation propre à V3.10. L'historique [S2 p. 80] montre que V4.x
  n'ajoute à V3.10 que le *Tuning Cockpit* et des corrections ; V3.10 avait lui-même ajouté les sweeps,
  la ligne série avec pertes et l'export ASCII. **La cible de parité est donc V4.1** (sur-ensemble de V3.10).
- Le site n'est joignable qu'en HTTP (certificat HTTPS invalide) ; consulté tel quel.
- Aucune instruction adressée à un agent n'a été trouvée dans ces contenus. Ils ne servent que de données.

## 2. Écarts relevés dans les vecteurs de test (à lire avant de valider)

**2.1 Vecteur 8 — confirmé.** Topologie de la slide 16 (C série 6,8 pF → C // 3,9 pF → L série 15 nH →
C // 22 pF → charge 92 nH + 2 Ω), à 869 MHz :

| Méthode | Zin |
|---|---|
| Réduction série/parallèle (charge → entrée) | 0,001787 − j157,191387 Ω |
| Cascade ABCD (entrée → charge) | 0,001787 − j157,191387 Ω (écart 8,5·10⁻¹⁴) |

Identique à la valeur de référence fournie (0,0018 − j157,19 Ω). Pas d'écart.

**2.2 Slide 16 ≠ slide 17 — incohérence du cours.** La capture de Smith V3.10 (slide 17) ne part pas de
92 nH + 2 Ω (soit 2 + j502,3 Ω) mais d'une charge **DP1 = (2,000 + j10,000) Ω**, ce qui correspond à
1,83 nH à 869 MHz. Le reste du réseau est identique. Les valeurs affichées par V3.10 sont reproduites
exactement par mon calcul indépendant (deux méthodes) :

| Point | Smith V3.10 (slide 17) | Recalcul | Q affiché / recalculé |
|---|---|---|---|
| DP1 | 2,000 + j10,000 | 2,0000 + j10,0000 | 5,000 / 5,000 |
| TP2 (C // 22 pF) | 20,365 − j25,382 | 20,3653 − j25,3821 | 1,246 / 1,246 |
| TP3 (L série 15 nH) | 20,365 + j56,519 | 20,3653 + j56,5192 | 2,775 / 2,775 |
| TP4 (C // 3,9 pF) | 88,740 − j88,611 | 88,7399 − j88,6107 | 0,999 / 0,999 |
| TP5 (C série 6,8 pF) | 88,740 − j115,544 | 88,7399 − j115,5442 | 1,302 / 1,302 |

Panneau « Cursor » de la même capture, Z = (33,22 − j42,08) Ω : Γ = 0,486 ∠ −84,920°, RL = 6,27 dB,
VSWR = 2,89, Q = 1,27, Y = (11,56 + j14,64) mS — tous retrouvés.

Conséquence : le « résultat du cours » visible slide 17 (88,74 − j115,54 Ω) ne répond pas à l'énoncé de la
slide 16 tel qu'il est écrit. Proposition : **garder le vecteur 8 tel quel** (énoncé slide 16) et **ajouter la
chaîne de la slide 17 comme vecteur 9** (c'est la seule référence produite par V3.10 lui-même).

**2.3 Vecteur 7.** f₀ = 868,197 MHz, Q = (1/Rs)·√(L/C) = 1,0001, x_L(f₀) = 0,6001. Conforme.

**2.4 Références Dellsperger utilisables.** L'exemple 1 de [S5] (10 + j7 Ω, 150 MHz, C série 39,2 pF,
L // 26,6 nH → 10 − j20,067 puis 50,269 − j0,078 Ω) est reproduit à la 3ᵉ décimale. Les exemples 4, 9 et
10 ne le sont qu'à 1–2 % près, parce que le schéma n'affiche que des valeurs arrondies (1,9 pF, 0,208 λ) :
ils serviront de contrôle de plausibilité (tolérance 3 %), pas de vecteurs à 10⁻³.

## 3. Fonctionnalités constatées dans Smith et décision

Décision : **R** = repris, **A** = repris et amélioré, **X** = exclu (motif en § 5).

### 3.1 Abaque et lecture

| Fonction constatée | Source | Déc. | Dans l'outil |
|---|---|---|---|
| Abaque Z, Y, ou Z+Y superposés (plans activables) | [S2 p. 39], [C 11, 17] | A | + grille à densité adaptative selon le zoom, étiquettes normalisées **ou** en Ω / mS (comme V3.10) |
| Z0 de normalisation libre | [S1], [S2 p. 9] | R | Global, 50 Ω par défaut |
| Fenêtre Cursor : RL, VSWR, Q, Γ, Y, Z, Z0, fréquence | [S2 p. 4], [C 17] | A | + mismatch loss, puissance réfléchie, Γ en re/im et module/phase, valeurs normalisées, composant équivalent série et parallèle à f |
| Zoom avant / arrière / 1:1, centré sur l'abaque | [S2 p. 27] | A | Zoom molette centré sur le pointeur, déplacement, zoom arrière au-delà de \|Γ\| = 1 (région r < 0) |
| Points DPn (saisis), TPm (transformés), SPp (sweep) | [S2 p. 2] | R | Même nomenclature dans le tableau des points |
| Tableau Datapoints : Start, Point, Z, Q, Frequency | [S2 p. 4], [C 17] | A | + Y, Γ, VSWR, RL, colonnes au choix, copie CSV |
| Réglage couleurs et épaisseurs | [S2 p. 39] | A | Thèmes clair / sombre soignés plutôt qu'un réglage trait par trait |

### 3.2 Charge (datapoints)

| Fonction constatée | Source | Déc. | Dans l'outil |
|---|---|---|---|
| Saisie à la souris sur l'abaque, puis fréquence | [S2 p. 7] | R | Clic sur l'abaque en mode « placer la charge » |
| Saisie clavier : Z, Y ou Γ, cartésien ou polaire | [S2 p. 7] | A | + S11 (dB/phase), + valeur normalisée, + charge décrite par un circuit R-L-C série ou parallèle (cas de la slide 16) |
| Plusieurs datapoints, un seul « Start » | [S2 p. 9] | A | Charge = valeur fixe, modèle R-L-C, ou **table Z(f)** multi-fréquences |
| Import S11 / S22 depuis Touchstone .s1p / .s2p | [S1], [S2 p. 7, 72] | A | Formats MA / DB / RI, unités Hz…GHz, `R` quelconque ; .s2p avec port 2 fermé sur une charge au choix |
| Import CITI | [S2 p. 74] | X | § 5 |
| Import EZNEC `LastZ.txt` | [S2 p. 76] | A | Via un import CSV générique « f, R, X » (couvre EZNEC) |
| Édition d'un datapoint (double-clic) | [S2 p. 27] | R | Dans l'inspecteur, ou en glissant le point |

### 3.3 Éléments du réseau

| Élément constaté | Source | Déc. | Dans l'outil |
|---|---|---|---|
| C, L, R en série | [S2 p. 14–16] | A | + Q fini optionnel (ESR, ou Q à une fréquence donnée) |
| C, L, R en parallèle | [S2 p. 14–16] | A | idem |
| Ligne série : Zc, εr_eff, longueur en λ, électrique (mm), physique (mm) | [S2 p. 17] | A | + degrés, + facteur de vélocité, préréglage λ/4 |
| Ligne série avec pertes, α en dB/m, α(f) = α·√(f/f_DP) | [S2 p. 17] | A | Trajectoire dessinée même avec pertes (Smith ne la dessine pas [S2 p. 10]) ; loi en √f ou α constant |
| Stub parallèle ouvert / court-circuité (idéal) | [S2 p. 19–22] | A | + pertes optionnelles |
| Transformateur idéal, rapport n (impédance n²) | [S2 p. 23] | R | Sens du rapport affiché dans l'UI (voir § 6.4) |
| R-L-C parallèle inséré en série ; R-L-C série inséré en parallèle | [S2 p. 25–26] | A | + les deux autres combinaisons |
| Trajectoire (locus) dessinée, valeur choisie en cliquant dessus | [S2 p. 9] | A | Extrémité de l'arc **glissable** sur son lieu ; valeur éditable au clavier |
| Édition après insertion (double-clic → dialogue → Draw) | [S2 p. 11] | A | Édition en place, mise à jour immédiate, pas de dialogue modal |
| Tuning Cockpit : curseurs ±20 %, « Reset Min/Max » | [S2 p. 12], [S4] | A | Curseur sur chaque élément, plage réglable, molette = réglage fin, flèches du clavier |
| Schéma construit depuis le datapoint, rotation possible | [S2 p. 3], [C 17] | A | Schéma SVG ; orientation : voir question Q4 |
| Limite « ne pas saisir 0 » | [S2 p. 11] | A | 0 et ∞ traités explicitement (§ 6.5) |

### 3.4 Outils

| Fonction constatée | Source | Déc. | Dans l'outil |
|---|---|---|---|
| Cercles VSWR constants | [S2 p. 35] | R | Plusieurs, étiquetés |
| Lieux à Q constant, Q = \|Im Z\| / Re Z | [S2 p. 31], [C 9] | R | Plusieurs, étiquetés |
| Cercles de stabilité (plan d'entrée / de sortie) | [S2 p. 36, 58] | R* | Lot « amplificateur », voir Q2 |
| Cercles de gain constant (disponible, opérant, unilatéral) | [S2 p. 33, 62] | R* | idem |
| Cercles de facteur de bruit constant | [S2 p. 37, 71] | R* | idem |
| Fenêtre Circles (visibilité, surbrillance, détails) | [S2 p. 4] | R | Liste dans l'inspecteur |
| Sweep en fréquence (début, fin, nombre de points) | [S2 p. 28] | A | Linéaire ou log, sens « f croissant » fléché [C 15], recalcul en direct pendant le tuning |
| Sweep sur les datapoints | [S2 p. 29] | A | Automatique quand la charge est une table Z(f) |
| Undo / Redo (éléments et datapoints seulement) | [S2 p. 28] | A | Sur tout l'état du projet, y compris cercles et réglages |
| Sauvegarde / chargement de projet (.xmlsc, version licenciée) | [S1] | A | JSON, + URL partageable ; sans limite de licence |
| Netlist « Touchstone » .ckt (CAP, IND, RES, TLINP, TRF, SRLC, PRLC, DEF2P) | [S2 p. 43] | A | Export LTspice `.cir` (demandé) **et** `.ckt` au format Dellsperger |
| Export ASCII des datapoints et des cercles | [S2 p. 44] | R | CSV (séparateur `;` ou `,`) |
| Impression abaque / schéma / tableaux | [S2 p. 41] | A | Export SVG et PNG, feuille de style d'impression |
| Copie dans le presse-papiers | [S2 p. 42] | R | Abaque et schéma (repli sur téléchargement si le navigateur refuse) |
| Raccourcis Ctrl+N/O/S/Z/Y, Ctrl+1/2/3 | [S2 p. 42] | A | Repris quand le navigateur les laisse passer, + navigation clavier complète |

### 3.5 Mode S-Plot

| Fonction constatée | Source | Déc. | Dans l'outil |
|---|---|---|---|
| Tracé de S11 / S22 sur abaque depuis un fichier | [S2 p. 45] | R | Trace importée sur l'abaque principal |
| Graphe de return loss, axe f linéaire ou log, curseur | [S2 p. 46] | A | Graphes \|S11\| (dB), VSWR, phase, liés à l'abaque |
| Table et graphe MAG / MSG, K, μ | [S2 p. 46] | R* | Lot « amplificateur » |
| Tracé polaire de S12 / S21 | [S2 p. 46] | X | § 5 |
| Conversion S → H / Z / Y / A et export Touchstone | [S2 p. 49] | X | § 5 |
| Conversion CITI → Touchstone | [S2 p. 51] | X | § 5 |

## 4. Fonctionnalités ajoutées

| Ajout | Détail |
|---|---|
| Matching automatique | Réseau en L (jusqu'à 4 solutions), π et T à Q imposé, simple stub (ouvert / court, 2 positions), double stub (écartement imposé, zone interdite signalée), transformateur λ/4 (charge réelle, ou ligne d'approche + λ/4 pour une charge complexe), ligne série + réactance. Cible : Z0 ou une impédance quelconque (adaptation conjuguée). |
| Classement des solutions | Par Q de nœud maximal et par bande passante réelle (bande où RL ≥ seuil, calculée par sweep numérique du réseau synthétisé), avec caractère passe-bas / passe-haut et passage ou blocage du DC |
| Séries normalisées | Arrondi E12 / E24 / E96 par élément ou global, avec Γ, RL et VSWR résultants affichés avant / après |
| Graphes liés | \|S11\| dB, VSWR, phase de Γ en fonction de f ; survol d'un graphe = curseur sur l'abaque, et inversement |
| Mode « cours » | Cercle r = cste ou g = cste suivi par chaque élément, étiquette Δx / Δb comme sur les slides 7, 8, 13, 14 ; symétrie z ↔ y par rapport au centre (slides 10, 12) ; exemples des slides préchargés |
| Composants réels | Q fini sur L et C ; pertes sur les stubs |
| Région active | r < 0 dessiné hors du disque, signalé « actif / instable » |
| Saisie ingénieur | « 6.8p », « 15n », « 869M », « 2k2 », « 0.25λ », « 90° », virgule ou point décimal ; molette et flèches pour le réglage fin |
| Projet | Undo / redo complet, JSON, état encodé dans le hash de l'URL |
| Exports | SVG / PNG de l'abaque, schéma en SVG, netlist LTspice `.cir`, netlist `.ckt`, CSV |
| Convention affichée | Bandeau permanent « construction : charge → source » |

## 5. Exclusions et motifs

| Exclu | Motif |
|---|---|
| Import / conversion CITI | Format d'instrument ancien, absent du cours ; Touchstone et CSV couvrent les usages |
| Conversion S → H / Z / Y / A et réexport, tracé polaire S12 / S21 | Fonctions d'un visualiseur de paramètres S, hors du périmètre « abaque + matching » |
| Lecture des projets `.xmlsc` / `.smc` | Format non documenté publiquement |
| Fenêtres ancrables, positions mémorisées | Remplacé par une mise en page fixe et adaptative (contrainte « épuré ») |
| Licence, mode démo (5 éléments / 5 points) | Sans objet |
| Touchstone 2.0 (`[Version] 2.0`), fichiers à plus de 2 ports | Rares pour cet usage ; message d'erreur explicite à l'import |
| Optimiseur numérique, analyse de tolérances (Monte-Carlo), modèles microstrip (W/h → Zc, εr_eff) | Non demandés ; candidats pour une version ultérieure |
| Impédance caractéristique complexe des lignes à pertes | Zc reste réel (approximation faibles pertes, comme Smith) ; listé dans les limitations |

## 6. Conventions RF

### 6.1 Définitions
- ω = 2πf ; Z_L = jωL ; Z_C = 1/(jωC) ; z = Z/Z0 ; y = Y·Z0 = 1/z ; Γ = (Z − Z0)/(Z + Z0), Z0 réel > 0.
- VSWR = (1 + |Γ|)/(1 − |Γ|) ; RL = −20·log₁₀|Γ| (dB, positif) ; mismatch loss = −10·log₁₀(1 − |Γ|²).
- Q de nœud = |X|/R = |B|/G (définition du cours et de Smith).
- Cercle r : centre (r/(r+1), 0), rayon 1/(r+1). Arc x : centre (1, 1/x), rayon 1/|x|. Abaque Y : image par Γ → −Γ.
- Lieu Q constant : arcs de cercle de centre (0, ±1/Q), rayon √(1 + 1/Q²), passant par Γ = ±1.

### 6.2 Sens de construction
Le réseau se construit **de la charge vers la source**. L'élément n° 1 est celui qui touche la charge ; Zin est
vue depuis la source après le dernier élément. Série : z → z + Δz (déplacement sur un cercle r). Parallèle :
y → y + Δy (déplacement sur un cercle g).

### 6.3 Lignes
- Zin = Zc·(Z + Zc·tanh γl)/(Zc + Z·tanh γl), γ = α + jβ, β = 2π·f·√εr_eff / c.
- La longueur électrique (degrés ou fraction de λ) est définie **à la fréquence de conception f₀** ; la longueur
  physique l = (θ/360°)·c/(f₀·√εr_eff) est fixe pendant un sweep. « Longueur électrique en mm » au sens de
  Smith = l·√εr_eff. Facteur de vélocité v_r = 1/√εr_eff.
- Pertes : α en dB/m de longueur physique, α[Np/m] = α[dB/m]/8,686 ; par défaut α(f) = α·√(f/f₀).
- Stub ouvert : Y = tanh(γl)/Zc (sans pertes : j·tan βl / Zc). Stub court-circuité : Y = coth(γl)/Zc.

### 6.4 Autres éléments
- Transformateur idéal de rapport n : Zin = n²·Z (n = spires côté source / spires côté charge). La doc de
  Smith dit seulement « impedance ratio is n² » ; ce sens est mon choix, affiché dans l'UI.
- Q fini : L avec ESR série = ω_ref·L/Q ; C avec ESR série = 1/(ω_ref·C·Q). L'ESR est constante en fréquence.
- Charge pendant un sweep : fixe (comportement de Smith), modèle R-L-C, ou table Z(f) interpolée
  linéairement sur Γ, sans extrapolation.

### 6.5 Cas limites
Le moteur propage un couple homogène (V, I) au lieu de Z : court-circuit = (0, 1), circuit ouvert = (1, 0),
aucune division avant l'affichage.

| Cas | Traitement |
|---|---|
| z = 0, z = ∞ | Représentés exactement ; Γ = −1 / +1 ; 1/z affiché « ∞ » sans NaN |
| \|Γ\| = 1 | VSWR = ∞, mismatch loss = ∞, Q = ∞ |
| \|Γ\| > 1 (r < 0) | Point hors du disque, étiquette « actif / instable » ; VSWR non défini (« — »), RL négatif affiché |
| f = 0 | L série = court-circuit, C série = circuit ouvert, L // = court-circuit, C // = sans effet ; ligne de longueur électrique nulle |
| Valeur d'élément nulle ou infinie | Acceptée (élément transparent ou bloquant), jamais d'exception |
| Z + Z0 = 0 | Γ infini : point non tracé, signalé |
| Stub λ/4, tan βl → ∞ | Passage par la forme homogène : court-circuit / circuit ouvert exacts |

## 7. Plan de test (`tests.mjs`)

Tolérance relative 10⁻³ sauf mention. `tests.mjs` **extrait le bloc `<script id="smith-core">` d'`index.html`**
et l'évalue avec `node:vm` : le code testé est exactement le code livré, sans copie à synchroniser.

| Groupe | Contrôles |
|---|---|
| Vecteurs du cours 1–8 | Tels que fournis |
| Vecteur 9 (nouveau) | Chaîne de la slide 17 : 5 points, 5 valeurs de Q, lecture curseur (Γ, RL, VSWR, Q, Y) |
| Vecteur 10 (nouveau) | Exemple 1 de Dellsperger (10 + j7 Ω, 150 MHz) |
| Plausibilité (3 %) | Exemples 4, 9, 10 de Dellsperger |
| Voie indépendante | Chaque réseau évalué par le moteur (V, I) **et** par réduction série/parallèle en forme fermée |
| Lignes | λ/2 = identité ; λ/4 = Zc²/Z ; \|Γ\| conservé si Zc = Z0 ; ligne à pertes longue → Zc ; forme tanh vs matrice ABCD |
| Stubs | Court λ/4 = circuit ouvert ; ouvert λ/4 = court-circuit ; ouvert λ/8 = −jZc |
| Géométrie | Points des cercles r, x, g, b, Q, VSWR vérifiés par retour z(Γ) |
| S ↔ Z | Aller-retour ; Γin d'un .s2p chargé : formule S11 + S12·S21·ΓL/(1 − S22·ΓL) vs conversion ABCD |
| Matching | Chaque solution réinjectée dans le moteur direct : \|Γ\| < 10⁻⁶ ; π / T : Q de nœud = Q demandé ; nombre de solutions du L selon la région de la charge ; zone interdite du double stub |
| Séries E | Tables E12 / E24 de référence, E96 par formule ; arrondi au plus proche en échelle log |
| Entrées / sorties | Notation ingénieur ; Touchstone MA / DB / RI ; aller-retour JSON et hash d'URL ; netlists `.cir` / `.ckt` relues par un mini-analyseur et Zin recalculée |
| Cas limites | Tableau du § 6.5, aucun NaN |
| Amplificateur (si Q2 = oui) | Exemple 13 de Dellsperger : BFG33G à 2 GHz, K = 1,17, Gmax = 12,94 dB, Γ₂ et Z₂ pour Zs = 50 + j30 Ω (signes des parties imaginaires à relire sur la page du PDF, perdus à l'extraction du texte) |

Ce que les tests ne couvrent pas : le rendu et l'interaction (validés par captures d'écran en phases 2 à 5) et
l'exécution réelle de la netlist dans LTspice (non disponible ici).

## 8. Architecture d'`index.html`

```
index.html
├─ <style>                 jetons de thème (clair / sombre), grille de mise en page, impression
├─ <body>                  barre d'outils · schéma · abaque SVG · inspecteur · graphes
├─ <script id="smith-core">   AUCUN accès au DOM — extrait tel quel par tests.mjs
│   § complex      nombres complexes, couple homogène (V, I)
│   § rf-math      Γ ↔ z ↔ y, VSWR, RL, Q, lignes, stubs, cercles (r, x, g, b, Q, VSWR,
│                  stabilité, gain, bruit), séries E, notation ingénieur
│   § network      modèle du projet, évaluation charge → source, trajectoires, sweep,
│                  synthèse (L, π, T, stubs, λ/4), classement
│   § io (pur)     Touchstone, CSV, JSON, hash d'URL, netlists .cir / .ckt
│   → expose un seul objet global `SmithCore`
└─ <script id="smith-app">
    § chart-render géométrie de la grille adaptative et des tracés → chaînes SVG (fonctions pures),
                   repère Γ ↔ écran, zoom / déplacement
    § ui           état, undo / redo, schéma, inspecteur, tableau des points, graphes, clavier, molette
    § io (DOM)     ouverture / téléchargement de fichiers, presse-papiers, export PNG
```

Mise en page :

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Projet · Z0 · f₀ · Z|Y|Z+Y · Sweep · Matching · Cours · Thème · Export     │
├──────────────────────────────────────────────────────┬───────────────────┤
│ Schéma (charge → source)   [+ série ▾] [+ parallèle ▾]│ Inspecteur        │
├──────────────────────────────────────────────────────┤  · élément choisi │
│                                                      │  · curseur        │
│                  Abaque (SVG)                        │  · points DP / TP │
│                                                      │  · cercles        │
├──────────────────────────────────────────────────────┤  · solutions      │
│ |S11| dB · VSWR · phase   (repliable)                │                   │
└──────────────────────────────────────────────────────┴───────────────────┘
```

Choix techniques :
- **État** : un objet `project` sérialisable (Z0, f₀, charge, liste ordonnée d'éléments, sweep, cercles, vue).
  Toute modification produit un nouvel état ; undo / redo par pile d'instantanés, les réglages continus
  (molette, curseur, glisser) étant regroupés en une seule entrée.
- **Rendu** : SVG uniquement. La grille est recalculée au changement de zoom (quelques centaines d'arcs) ;
  pendant un tuning, seules les trajectoires et la trace de sweep sont redessinées.
- **Trajectoires** : chaque élément est échantillonné de 0 à sa valeur (valable aussi pour les lignes à pertes et
  les composants à Q fini, qui ne suivent pas exactement un cercle). En mode cours, le cercle r ou g exact
  est superposé.
- **Hors ligne** : aucune ressource externe, polices système.
- **Langue** : interface en français, code et commits en anglais (voir Q3).

## 9. Phases

| Phase | Contenu | Critère de sortie |
|---|---|---|
| 1 | `smith-core` (complex, rf-math, network direct) + `tests.mjs` | Vecteurs 1–10, lignes, stubs, cas limites au vert |
| 2 | Rendu de l'abaque : grilles Z / Y, cercles, trajectoires, zoom | Captures : slides 6, 7, 8, 13, 14 reproduites |
| 3 | Éditeur de réseau, inspecteur, tuning, sweep, graphes, undo / redo | Slide 17 refaite à la souris et au clavier |
| 4 | Matching, séries E, Touchstone, exports, hash d'URL, mode cours | Tests de synthèse et d'E/S au vert |
| 4b | Lot amplificateur (si Q2 = oui) : K, μ, MAG / MSG, cercles de stabilité, gain, bruit | Exemple 13 de Dellsperger retrouvé |
| 5 | Revue : tests, slide 16 de bout en bout dans l'UI, README, limitations | Livrables complets |

Un commit par phase (conventional commits, en anglais).

## 10. Questions à trancher

| # | Question | Recommandation |
|---|---|---|
| Q1 | Slide 16 / 17 : garder le vecteur 8 et ajouter la chaîne de la slide 17 comme vecteur 9 ? | Oui |
| Q2 | Inclure le lot amplificateur (cercles de stabilité, gain, bruit, K / μ / MAG / MSG) ? Présent dans V3.10, absent de ta liste, hors du chapitre 8. | Oui, en phase 4b séparée, après le matching |
| Q3 | Langue de l'interface | Français |
| Q4 | Orientation du schéma : source à gauche et charge à droite (slide 16), ou charge à gauche (Smith V3.10) ? | Slide 16 par défaut, bascule vers le style V3.10 |
| Q5 | Cible de parité V4.1 plutôt que V3.10 | Oui (sur-ensemble) |
