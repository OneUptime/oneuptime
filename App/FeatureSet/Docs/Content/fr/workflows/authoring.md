# Création d'un workflow

Pour créer un workflow, ouvrez **Workflows → Create Workflow**, donnez-lui un nom et cliquez sur l'onglet **Builder**. Vous verrez un canevas vide où vous construirez votre automatisation.

## Le canevas

Le Builder est un canevas en glisser-déposer. Vous y ajoutez des blocs depuis la palette située sur le côté, vous les reliez entre eux par des lignes et vous cliquez sur chaque bloc pour configurer son comportement. Les modifications sont enregistrées automatiquement — un indicateur en haut vous signale lorsque tout est sauvegardé.

Chaque workflow commence par un **déclencheur** au début. Tout le reste est un **composant** qui effectue une action.

## Ce que contient un bloc

| Champ        | Rôle                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**    | Le nom affiché sur le canevas. Renommez-le pour faciliter la lecture des workflows complexes.                                                                                    |
| **Settings** | Ce dont le bloc a besoin pour faire son travail — une URL, un canal Slack, un corps de message, etc. Les champs obligatoires sont marqués d'un astérisque.                       |
| **Input**    | Le point sur la gauche par lequel arrivent les lignes provenant des blocs précédents.                                                                                            |
| **Outputs**  | Les points sur la droite par lesquels partent les lignes vers les blocs suivants. De nombreux blocs ont des sorties distinctes **success** et **error** pour gérer les deux cas. |

## Relier les blocs

Glissez depuis un point de sortie d'un bloc vers le point d'entrée du bloc suivant. La ligne que vous tracez détermine ce qui s'exécutera ensuite.

- Si vous reliez depuis **success**, le bloc suivant ne s'exécute que si le précédent a réussi.
- Si vous reliez depuis **error**, le bloc suivant ne s'exécute que si le précédent a échoué.
- Si vous ne reliez pas une sortie, ce chemin s'arrête simplement.

Vous pouvez relier une sortie à plusieurs blocs. Ils s'exécutent alors tous en même temps à partir de ce point.

## Configurer un bloc

Cliquez sur un bloc pour ouvrir ses paramètres sur le côté. Chaque paramètre dispose du type d'entrée approprié — champs de texte, listes déroulantes, éditeurs de code, interrupteurs, etc.

La plupart des champs de texte acceptent des variables — c'est ainsi que les données circulent d'un bloc à un autre. Voir [Variables](/docs/workflows/variables) pour la syntaxe.

## Votre premier workflow

La manière la plus rapide de prendre en main le canevas :

1. Glissez un déclencheur **Manual** sur le canevas.
2. Glissez un composant **Log** (sous **Utils**) à côté. Reliez le déclencheur au composant Log.
3. Dans le champ message du bloc Log, saisissez `Hello from {{Manual.JSON.name}}`.
4. Enregistrez et activez le workflow.
5. Cliquez sur **Run Manually**, collez `{ "name": "Ada" }` comme entrée et validez.
6. Ouvrez l'onglet **Logs**. La dernière exécution affiche `Hello from Ada`.

Ce cycle — glisser, relier, configurer, exécuter, vérifier le journal — est la façon dont vous construirez chaque workflow.

## Enregistrer et activer

Le canevas s'enregistre au fil de votre travail. Il n'y a pas d'étape « publier » distincte.

Mais un workflow ne s'exécute réellement que si **Enabled** est activé dans Settings. Les nouveaux workflows démarrent désactivés. Utilisez cet interrupteur comme filet de sécurité — construisez, testez avec **Run Manually**, vérifiez les journaux, puis activez-le.

Pour mettre un workflow en pause sans le supprimer, désactivez **Enabled**. Les exécutions déjà en cours se terminent ; aucune nouvelle ne démarre.

## Mettre de l'ordre

- Glissez les blocs pour les déplacer. La disposition est enregistrée, ainsi la personne suivante voit la même organisation.
- Cliquez avec le bouton droit sur une ligne pour la supprimer. Cliquez avec le bouton droit sur un bloc pour le supprimer ou le dupliquer.
- Pour les workflows larges, disposez-les de gauche à droite afin qu'ils se lisent dans le sens de leur exécution.

## Pour aller plus loin

- [Déclencheurs](/docs/workflows/triggers) — les quatre manières de démarrer un workflow.
- [Composants](/docs/workflows/components) — tous les blocs que vous pouvez ajouter.
- [Variables](/docs/workflows/variables) — faire circuler les données entre les blocs.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
