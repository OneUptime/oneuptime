# Créer un workflow

Pour créer un workflow, ouvrez **Flux de travail** et cliquez sur **Créer un flux de travail**. Un assistant intitulé **Create a workflow** vous accompagne : d'abord **Start from** — choisissez **Start from scratch** ou l'un des modèles — puis **Nom**, et enfin une étape **Configurer**, qui n'apparaît que si le modèle choisi demande ses propres réglages.

Une fois le workflow créé, ouvrez **Constructeur** dans le menu de gauche. C'est le canevas sur lequel vous le concevez.

## Le canevas

Un workflow parti de zéro s'ouvre sur un unique bloc en pointillés portant la mention **Choose what starts this workflow**. Ce bloc est le point de départ — cliquez dessus pour choisir un déclencheur. Un workflow créé à partir d'un modèle s'ouvre avec ses blocs déjà en place.

Chaque workflow possède exactement un **déclencheur**, tout en haut. Tout le reste est un **composant** qui fait quelque chose. Ajouter un second déclencheur remplace le premier, et supprimer le dernier fait réapparaître le bloc en pointillés.

Pour ajouter des blocs :

- **Le déclencheur** — cliquez sur le bloc en pointillés. Un panneau intitulé **Add Trigger** s'ouvre.
- **Tout le reste** — cliquez sur **Ajouter un composant** dans la barre d'outils au-dessus du canevas. Le même panneau s'ouvre, intitulé **Ajouter un composant**.

Les deux panneaux s'ouvrent sur les blocs qu'utilisent la plupart des workflows, sous **Popular**, puis sur les autres blocs intégrés. Sous **OneUptime resources**, cliquez sur une ressource comme **Incident** pour voir ce que vous pouvez en faire ; **Browse all resources** les liste toutes. Ou cherchez : tapez quelques mots, comme `create incident`, et la correspondance la plus proche arrive en premier. Appuyez sur `/` pour sauter dans le champ de recherche, sur les flèches pour parcourir les résultats et sur **Entrée** pour ajouter le bloc mis en évidence. Un clic sur un bloc l'ajoute.

Un nouveau bloc se pose sous le bloc le plus bas du canevas, et un nouveau déclencheur prend la place de l'ancien, en haut. Le nouveau bloc est sélectionné et, s'il atterrit hors de la vue, le canevas défile juste assez pour l'afficher. Ses paramètres ne s'ouvrent pas d'eux-mêmes : cliquez sur le bloc quand vous êtes prêt à le configurer. Tant que ses paramètres obligatoires sont vides, il affiche **Click to set up**. Faites glisser les blocs où vous voulez ; le canevas s'aligne sur une grille au fur et à mesure. La position des blocs est enregistrée, si bien que la personne suivante retrouve l'agencement que vous avez laissé.

Les modifications sont enregistrées automatiquement. Une pastille dans la barre d'outils le signale : **Saving…** pendant l'enregistrement, puis **Enregistré**, ou **Impossible d'enregistrer** si cela n'a pas fonctionné. Il n'y a ni bouton d'enregistrement ni étape de publication séparée.

## Ce que porte un bloc

| Champ                            | Son rôle                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (sous **ID**)     | L'identifiant court affiché sur le bloc, comme `log-1`. C'est ainsi que les autres blocs désignent celui-ci : le renommer casse donc toutes les références `{{local.components.…}}` qui pointent vers lui. Le titre du bloc est le nom du composant lui-même et n'est pas modifiable. |
| **Paramètres**                   | Ce dont le bloc a besoin pour faire son travail — une URL, un canal Slack, un corps de message. Les champs facultatifs portent la mention **(Optional)** ; tous les autres sont obligatoires. Les réglages les moins utilisés se cachent derrière un volet **Avancé**. |
| **Input**                        | Le point sur le bord supérieur, là où arrivent les lignes venues des blocs précédents. Les déclencheurs n'en ont pas — rien ne s'exécute avant eux.                                                          |
| **Outputs**                      | Les points répartis sur le bord inférieur, étiquetés juste au-dessus, d'où partent les lignes vers les blocs suivants. Beaucoup de blocs ont des sorties **Succès** et **Erreur** distinctes, pour que vous puissiez traiter les deux cas. |

## Relier les blocs

Faites glisser un trait d'un point du bas d'un bloc vers le point du haut du bloc suivant. La ligne que vous tracez décide de ce qui s'exécute ensuite.

- Si vous partez de **Succès**, le bloc suivant ne s'exécute que si le précédent a fonctionné.
- Si vous partez d'**Erreur**, le bloc suivant ne s'exécute que si le précédent a échoué.
- Si vous ne reliez pas une sortie, ce chemin s'arrête simplement là.

Vous pouvez relier une même sortie à plusieurs blocs. Tous s'exécutent — mais les uns après les autres, dans une seule file, jamais en parallèle. Ne comptez pas sur l'ordre entre les branches, ni sur le fait qu'elles se chevauchent dans le temps. Chaque bloc s'exécute au plus une fois par exécution : une boucle qui revient sur un bloc antérieur ne le relance donc pas.

## Configurer un bloc

Cliquez sur un bloc pour ouvrir ses paramètres dans une boîte de dialogue (ou atteignez-le avec **Tab** et appuyez sur **Entrée**). Chaque réglage dispose du champ qui lui convient — texte, liste déroulante, éditeur de code, interrupteur, et ainsi de suite. Remplissez-les, puis cliquez sur **Enregistrer**.

C'est dans cette même boîte de dialogue que vous trouvez :

- **Supprimer** — retirer ce bloc.
- **Run just this step** — exécuter ce seul bloc, sans le reste du workflow. Les valeurs qu'il aurait lues auprès des autres étapes arrivent vides, et tout ce qu'il envoie, écrit ou supprime se produit pour de vrai.
- **Documentation**, **Inputs**, **Outputs** et **Returns** — les fiches de référence de ce que ce bloc attend et de ce qu'il produit.

La plupart des champs de texte acceptent des variables — c'est ainsi que les données passent d'un bloc au suivant. Plutôt que de taper la syntaxe à la main, utilisez le sélecteur de valeurs de l'éditeur : il construit une référence correcte à partir du bloc et du champ que vous choisissez. Voir [Variables de workflow](/docs/workflows/variables).

## Les vérifications au fil de la construction

Le Constructeur vérifie l'ensemble du graphe à chacune de vos modifications et rend compte de ce qu'il trouve dans une pastille de la barre d'outils. Cliquez sur la pastille pour ouvrir **Problems with this workflow**, qui liste chaque problème et vous emmène sur le bloc responsable. Sur le canevas, un bloc dont les paramètres obligatoires sont encore vides affiche **Click to set up**, et un bloc qui a un autre problème porte un badge dans son coin : rouge pour une erreur, ambre pour un avertissement. Survolez le badge pour lire ce qui ne va pas.

Il attrape les erreurs qui, autrement, restent invisibles jusqu'à ce qu'une exécution tourne mal : pas de déclencheur, deux blocs qui partagent un identifiant, un point à l'intérieur d'un identifiant, un bloc que rien ne relie, un réglage obligatoire laissé vide, du JSON mal formé, des espaces à l'intérieur de `{{ }}`, ou des références vers une étape ou une valeur de retour qui n'existe pas.

Une chose lui échappe : savoir si un nom de variable existe. Une variable renommée ne se révèle que dans le journal d'exécution.

## Votre premier workflow

Le plus rapide pour prendre le canevas en main :

1. Cliquez sur le bloc en pointillés, puis sur **Manual** dans le panneau **Add Trigger**.
2. Cliquez sur **Ajouter un composant**, puis sur **Log** sous **Popular**. Le nouveau bloc se pose sous le déclencheur. Reliez le point **Execute** du déclencheur au point d'entrée du bloc Log.
3. Cliquez sur le bloc Log, qui affiche **Click to set up**, et donnez à sa **Valeur** le contenu `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` est l'**Identifier** du déclencheur, affiché sur son bloc — vérifiez qu'il correspond.
4. Basculez **Activé** sur oui, en haut du Constructeur. Un workflow désactivé ne peut pas s'exécuter du tout, pas même à la main ; si vous sautez cette étape, **Exécuter le flux de travail** propose d'abord de l'activer.
5. De retour sur le **Constructeur**, cliquez sur **Exécuter le flux de travail**, saisissez `{ "name": "Ada" }` dans le champ **JSON**, cliquez sur **Run Workflow Manually**, puis confirmez avec **Run**.
6. Un panneau **Workflow Run** s'ouvre de lui-même et suit l'exécution. Le journal affiche `Value:` suivi de `Hello from Ada`.

Ce cycle — ajouter, relier, configurer, exécuter, lire le journal — c'est ainsi que vous construirez chacun de vos workflows.

## L'activer

Les nouveaux workflows démarrent désactivés, tout comme ceux que vous dupliquez ou importez. Tant qu'un workflow est désactivé, le Constructeur l'indique au-dessus du canevas, avec un bouton **Activer le flux de travail**.

L'interrupteur **Activé** se trouve en haut du **Constructeur**, à côté de **Ajouter un composant** et **Exécuter le flux de travail**. Il est aussi sur la page **Vue d'ensemble** du workflow : cliquez sur **Modifier le flux de travail** dans la carte **Détails du flux de travail**, qui affiche l'état courant sous forme de pastille verte **Activé** ou rouge **Désactivé**. Seules les personnes qui peuvent modifier le workflow peuvent l'activer ou le désactiver ; les autres voient l'interrupteur grisé.

Un workflow désactivé ne peut pas s'exécuter du tout : son déclencheur est ignoré, tout comme **Exécuter le flux de travail** et **Run just this step**. Si vous l'exécutez, ou l'un de ses blocs, alors qu'il est désactivé, le Constructeur demande plutôt **Activer ce flux de travail ?**. **Activer et exécuter** (ou **Activer et exécuter l'étape**) active le workflow puis exécute ce que vous avez demandé, avec les valeurs que vous avez saisies. L'ordre est donc : construisez-le, testez-le avec **Exécuter le flux de travail**, lisez le journal d'exécution, puis remettez **Activé** sur non si vous n'êtes pas prêt à laisser son déclencheur se déclencher. Pour tester un seul bloc sans lancer l'ensemble, utilisez **Run just this step** dans les paramètres de ce bloc.

Tout ce qui lance un workflow désactivé est refusé avec le même conseil. Un appel à son URL de webhook reçoit un HTTP 400 et « This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again. » Un bloc **Execute Workflow** qui l'appelle prend son chemin **Error**, et l'erreur nomme le workflow appelé.

Pour mettre un workflow en pause sans le supprimer, désactivez **Activé**. Aucune nouvelle exécution ne démarre. Une exécution déjà en cours va jusqu'au bout, mais celle qui patiente sur un bloc **Sleep** est annulée à son réveil et enregistrée comme une erreur.

## Ranger le canevas

- Faites glisser les blocs pour les déplacer. La disposition est enregistrée.
- Pour supprimer une ligne, faites glisser l'une de ses extrémités hors du point et lâchez-la sur une zone vide du canevas.
- Pour supprimer un bloc, cliquez dessus et utilisez **Supprimer** en bas de sa boîte de dialogue de paramètres. Sélectionner un bloc ou une ligne puis appuyer sur Retour arrière fonctionne aussi.
- Impossible de dupliquer un bloc isolé. **Duplicate Workflow**, sur la page **Paramètres** du workflow, en copie l'intégralité, et la copie arrive désactivée.
- Empilez les blocs de haut en bas pour qu'ils se lisent dans le sens où ils s'exécutent — les entrées sont sur le bord supérieur, les sorties sur le bord inférieur, le flux descend donc naturellement.

## Où lire ensuite

- [Déclencheurs de workflow](/docs/workflows/triggers) — les quatre façons de démarrer un workflow.
- [Composants de workflow](/docs/workflows/components) — tous les blocs que vous pouvez ajouter.
- [Variables de workflow](/docs/workflows/variables) — faire circuler les données entre les blocs.
- [Exécutions de workflow](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
