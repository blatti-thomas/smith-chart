# Abaque de Smith interactif

Outil d'abaque de Smith et d'adaptation d'impédance pour le cours SysRF (HEIG-VD, chap. 8), conçu pour
remplacer Smith V3.10 de F. Dellsperger. Un seul fichier, sans installation ni connexion.

| Fichier | Rôle |
|---|---|
| `index.html` | L'outil complet : ouvrir ce fichier dans un navigateur |
| `tests.mjs` | Tests du moteur de calcul : `node tests.mjs` (Node ≥ 18, aucune dépendance) |
| `SPEC.md` | Spécification : fonctions reprises de Smith, ajoutées, exclues, et pourquoi |

## Utilisation

Ouvrir `index.html`. L'exemple de la slide 17 est chargé ; le menu « Exemple » propose les autres slides du
cours et un projet vide.

**Construire un réseau.** Le réseau se construit **de la charge vers la source** : le premier élément
touche la charge, l'impédance d'entrée est vue après le dernier.

1. Régler `Z0` et `f0` dans la barre du haut.
2. Cliquer sur la charge dans le schéma et la saisir (Z, Y, valeurs normalisées, Γ, S11, circuit R-L-C ou
   table Z(f)). Le point DP1 se glisse aussi sur l'abaque.
3. Ajouter les éléments avec les boutons « Série » et « Parallèle ». Le nouvel élément s'insère après
   l'élément sélectionné, côté source, et son champ de valeur prend le focus : taper la valeur, puis Entrée.

**Saisir une valeur.** Notation ingénieur libre : `6.8p`, `6,8 pF`, `15n`, `869M`, `2k2`, `4R7`, `1e-9`.
Les préfixes et les unités respectent la casse (`m` = milli, `M` = méga) ; une saisie ambiguë comme
`869mhz` est refusée.

**Régler une valeur.**

| Geste | Effet |
|---|---|
| Molette ou flèches ↑ ↓ sur un champ | ± 1 % (± 1° pour un angle) ; Maj : × 10 ; Alt : ÷ 10 |
| Curseur « Réglage » | Balaye autour de la valeur ; revient au centre quand on le relâche |
| Glisser un point TP sur l'abaque | Règle l'élément qui aboutit à ce point, le long de son lieu |
| Glisser DP1 | Déplace une charge fixe |

**Lire l'abaque.** Le panneau de lecture donne Z, Y, Γ, VSWR, return loss, mismatch loss, Q, les valeurs
normalisées et les composants équivalents, pour le curseur, un point survolé, un échantillon du sweep ou,
à défaut, l'entrée du réseau. Molette : zoom ; glisser le fond : déplacer ; double-clic ou `0` : ajuster.

**Panneaux de l'inspecteur** (repliables) : adaptation automatique, valeurs normalisées E12/E24/E96, sweep
en fréquence, cercles VSWR et Q, amplificateur (stabilité, gain, bruit), fichiers et exports.

**Clavier.** `Ctrl+Z` / `Ctrl+Y` annuler et rétablir ; `Ctrl+S` enregistrer le projet ; `Ctrl+O` ouvrir ;
`Suppr` supprimer l'élément sélectionné ; `Échap` désélectionner ; flèches ← → dans le schéma ;
`+` `−` `0` et flèches sur l'abaque.

**Partager.** Le projet est encodé dans l'adresse de la page : « Copier le lien » suffit. « Enregistrer »
produit un fichier JSON.

## Conventions RF

- ω = 2πf ; Z_L = jωL ; Z_C = 1/(jωC) ; Γ = (Z − Z0)/(Z + Z0), Z0 réel.
- VSWR = (1 + |Γ|)/(1 − |Γ|) ; return loss = −20·log|Γ| (positif) ; mismatch loss = −10·log(1 − |Γ|²).
- Q d'un point = |X|/R.
- Élément série : déplacement sur un cercle r. Élément parallèle : déplacement sur un cercle g.
- **Lignes.** La longueur électrique est définie à une fréquence de référence ; la ligne garde sa longueur
  physique quand la fréquence varie. Longueur physique = longueur électrique / √εr_eff. Pertes α en dB par
  mètre de longueur physique, en α·√(f/f_ref) par défaut (conducteur) ou constantes.
- Stub ouvert : Y = tanh(γl)/Zc. Stub court-circuité : Y = coth(γl)/Zc.
- **Transformateur idéal** de rapport n : Zin = n²·Z, n = spires côté source / spires côté charge.
- **Q fini** : résistance série constante en fréquence, donnée directement ou déduite d'un Q à une fréquence.
- **Charge pendant un sweep** : une impédance fixe reste fixe (comme dans Smith) ; un circuit R-L-C varie ;
  une table est interpolée linéairement sur Γ, sans extrapolation.
- **π et T à Q imposé** : Q est le Q de nœud le plus élevé à l'intérieur du réseau (résistance virtuelle
  Rhaut/(Q² + 1) pour le π, Rbas·(Q² + 1) pour le T).
- **Bande passante d'une solution** : plage autour de f0 où le return loss par rapport à la cible reste
  au-dessus du seuil, mesurée sur le réseau réel avec le modèle de charge du projet.
- **Amplificateur** : la source vue par le transistor est l'entrée du réseau. On part donc de 50 Ω comme
  « charge » et on construit vers le transistor (méthode 2 de l'exemple 14 de Dellsperger).

## Vérification

`node tests.mjs` extrait les blocs `smith-core` et `smith-chart` d'`index.html` et les exécute tels quels :
le code testé est le code livré. 106 tests couvrent :

- les 8 vecteurs du cours, la chaîne de la slide 17 (valeurs affichées par Smith V3.10) et les exemples 1,
  4, 9, 10, 11 et 13 de Dellsperger ;
- chaque formule par une voie indépendante : réduction série/parallèle, équation tanh fermée, matrices
  ABCD, solveur nodal pour la netlist LTspice, formules de gain et de bruit évaluées sur les cercles ;
- chaque réseau synthétisé, réinjecté dans le moteur direct ;
- les cas limites (court-circuit, circuit ouvert, f = 0, |Γ| = 1, r < 0, valeurs nulles ou infinies) ;
- la géométrie SVG (drapeaux d'arc, densité de grille, étiquettes).

L'interface a été validée à la main dans un navigateur Chromium : slides 16 et 17 refaites de bout en
bout, exemple 13 de Dellsperger reproduit, imports, exports et lien vérifiés.

**Incohérence du cours à connaître.** La slide 17 ne résout pas l'énoncé de la slide 16 : Smith V3.10 y
part d'une charge (2 + j10) Ω, soit 1,83 nH, et non de 92 nH + 2 Ω. Les deux cas sont dans les exemples :
slide 16 → Zin = 0,0018 − j157,19 Ω ; slide 17 → Zin = 88,74 − j115,54 Ω.

## Limitations connues

Calcul
- L'impédance caractéristique d'une ligne à pertes reste réelle (approximation faibles pertes).
- La résistance série d'un composant à Q fini ne varie pas avec la fréquence.
- La synthèse d'adaptation suppose des éléments sans pertes et des lignes dans l'air (εr = 1) ; elle
  adapte à f0 uniquement. Double stub : les deux stubs sont du même type. π et T : deux solutions.
- L'arrondi aux séries E prend la valeur la plus proche ; les lignes ne sont pas arrondies.
- Amplificateur : une seule fréquence à la fois ; pas de facteur de mérite unilatéral.

Fichiers
- Touchstone 1.x à 1 ou 2 ports seulement ; pas de version 2.0, ni de paramètres H ou G, ni de Z ou Y à
  2 ports. Les tables CSV n'acceptent pas la virgule décimale.
- La netlist LTspice est vérifiée par un solveur indépendant, **pas par LTspice lui-même**. Une charge fixe
  ou tabulée y est remplacée par son équivalent série à f0 ; les pertes d'une ligne y sont constantes.
- Netlist au format Smith : le sens du transformateur n'est pas documenté par Dellsperger, et les
  résistances série des composants n'y figurent pas.
- Les projets `.xmlsc` de Smith et les fichiers CITI ne sont pas lus.
- Un lien est limité à environ 6000 caractères : une charge tabulée volumineuse passe par le fichier JSON.
- Le mode d'affichage (Z / Y, graduations, thème) et l'historique d'annulation ne sont pas enregistrés.

Interface
- Pas de grille hors du disque (|Γ| > 1) : les points actifs y sont seulement placés et signalés.
- Une étiquette de grille peut être masquée par une trajectoire.
- Le sweep trace l'entrée du réseau uniquement ; l'axe du VSWR est limité à 10.
- En mode cours, une résistance n'affiche pas de cercle (elle suit un arc x ou b).
- Seule l'image de l'abaque se copie dans le presse-papiers ; le schéma s'exporte en SVG.
- Glisser un point demande une souris ou un écran tactile ; au clavier, on règle la valeur dans son champ.
- Non vérifié : Firefox et Safari, les écrans tactiles, l'impression papier, et l'ouverture directe en
  `file://` (les essais ont été faits à travers un serveur local ; aucune ressource externe n'est chargée).
