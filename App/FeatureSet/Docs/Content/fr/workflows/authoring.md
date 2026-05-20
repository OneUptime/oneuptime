# Créer un workflow

Créez un workflow sous **Workflows → Create Workflow**, donnez-lui un nom et une description optionnelle, puis ouvrez l'onglet **Builder** pour commencer à déposer des nœuds sur le canevas.

## Le canevas

Le Builder est un graphe zoomable et déplaçable. Vous ajoutez des nœuds depuis une palette de composants, vous les connectez avec des arêtes et vous configurez les arguments de chaque nœud dans un panneau latéral. Un indicateur d'enregistrement dans l'en-tête vous dit si votre dernière modification a été persistée.

Un workflow commence toujours par exactement un nœud de **déclencheur**. Les déclencheurs n'ont pas de port d'entrée — c'est là que l'exécution commence. Tout en aval est un **composant**.

## Anatomie d'un nœud

Chaque nœud possède :

| Champ | Rôle |
| --- | --- |
| **Titre** | L'étiquette affichée sur le canevas. Prend par défaut le nom du composant ; remplacez-le pour rendre les workflows complexes plus lisibles. |
| **Arguments** | La configuration dont le composant a besoin pour faire son travail — une URL, un canal Slack, un extrait JavaScript, etc. Les arguments requis sont marqués d'un astérisque. |
| **Ports d'entrée** | Prises à gauche du nœud où arrivent les arêtes entrantes. Les composants ont un port d'entrée appelé `in` ; les déclencheurs n'en ont aucun. |
| **Ports de sortie** | Prises à droite d'où partent les arêtes sortantes. Les composants définissent des ports comme `success`, `error`, `yes`, `no`. |
| **Valeurs de retour** | Données produites par le nœud — les charges utiles de ses ports de sortie. Les nœuds en aval y font référence par `{{NodeId.fieldName}}`. |

## Connecter des nœuds

Glissez depuis un port de sortie vers le port d'entrée d'un nœud en aval pour créer une arête. Une arête depuis `success` n'exécute cette branche que si le nœud en amont a réussi ; une arête depuis `error` ne s'exécute que s'il a échoué. Si vous ne connectez pas un port, cette branche se termine simplement.

Vous pouvez créer un éventail : un port de sortie peut alimenter plusieurs nœuds en aval, et ils s'exécutent tous en parallèle à partir de ce point.

## Configurer les arguments

Cliquez sur un nœud pour ouvrir son panneau latéral. Chaque argument a un éditeur typé :

- **Text / URL / Email / Number / Password** — une entrée sur une seule ligne.
- **JSON** — un éditeur JSON avec coloration syntaxique et un indicateur de validation.
- **JavaScript** — un éditeur de code pour les extraits utilisés par le composant **Custom Code**.
- **Markdown / HTML** — corps de texte enrichi pour les composants d'e-mail et de message.
- **CronTab** — une expression de planification (utilisée par le déclencheur Schedule).
- **Boolean** — un interrupteur.
- **Select / Query** — listes déroulantes pour les champs qui prennent un ensemble fixe de valeurs ou une requête de type modèle.

Tout champ texte accepte l'interpolation de variables — voir [Variables](/docs/workflows/variables) pour les règles.

## Un premier workflow minimal

Le moyen le plus rapide de tester le canevas :

1. Déposez un déclencheur **Manual**.
2. Déposez un composant **Log** (sous **Utils**). Connectez le port de sortie du déclencheur au port d'entrée du composant Log.
3. Dans l'argument du composant Log, tapez `Hello from {{Manual.JSON.name}}`.
4. Enregistrez et activez le workflow.
5. Cliquez sur **Run Manually**, collez `{ "name": "Ada" }` comme entrée et validez.
6. Ouvrez l'onglet **Logs**. La dernière exécution montre la sortie capturée du nœud Log : `Hello from Ada`.

Cet aller-retour — glisser, câbler, configurer, exécuter, inspecter — est le rythme de création de chaque workflow.

## Enregistrer, activer et tester en production

Les workflows sont stockés sous forme de graphe JSON dans la colonne `Workflow.graph`. Le Builder enregistre au fil de votre édition ; l'indicateur d'enregistrement dans l'en-tête indique quand la dernière modification a atteint le serveur. Il n'y a pas d'étape « publier » distincte.

Mais : un workflow ne déclenche son déclencheur que si **isEnabled** est activé. Les nouveaux workflows sont livrés désactivés. Traitez ce drapeau comme votre interrupteur « prêt pour la prod » — construisez, cliquez sur **Run Manually** pour faire un essai à blanc avec une charge utile d'exemple, regardez les **Logs**, et seulement ensuite activez Enable.

Si vous devez mettre un workflow en pause sans le supprimer (par exemple, pendant un incident non lié), basculez **isEnabled** sur off dans **Settings**. Les exécutions en cours continuent ; aucune nouvelle ne démarre.

## Réordonner et réorganiser

- Glissez un nœud pour le repositionner. La position est stockée dans le graphe pour que la prochaine personne qui ouvre le canevas voie la même disposition.
- Clic droit sur une arête pour la supprimer ; clic droit sur un nœud pour les options de suppression et de duplication.
- Pour les workflows larges, disposez-les de gauche à droite afin que la direction d'exécution corresponde à votre direction de lecture.

## Où lire ensuite

- [Déclencheurs](/docs/workflows/triggers) — les quatre familles de déclencheurs et ce que chacune expose comme valeurs de retour.
- [Composants](/docs/workflows/components) — le catalogue complet et leurs arguments.
- [Variables](/docs/workflows/variables) — comment référencer les données entre nœuds et depuis les variables globales.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — comment déboguer un workflow qui se comporte mal.
