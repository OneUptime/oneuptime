# Créer un workflow

Pour créer un workflow, ouvrez **Flux de travail** et cliquez sur **Créer un flux de travail**. Un assistant intitulé **Create a workflow** vous accompagne : d'abord **Start from** — choisissez **Start from scratch** ou l'un des modèles — puis **Nom**, et enfin une étape **Configurer**, qui n'apparaît que si le modèle choisi demande ses propres réglages.

Une fois le workflow créé, ouvrez **Constructeur** dans le menu de gauche. C'est le canevas sur lequel vous le concevez.

## Le canevas

Un workflow parti de zéro s'ouvre sur un unique bloc en pointillés portant la mention **Please click here to add trigger**. Ce bloc est le point de départ — cliquez dessus pour choisir un déclencheur. Un workflow créé à partir d'un modèle s'ouvre avec ses blocs déjà en place.

Chaque workflow possède exactement un **déclencheur**, tout en haut. Tout le reste est un **composant** qui fait quelque chose. Ajouter un second déclencheur remplace le premier, et supprimer le dernier fait réapparaître le bloc en pointillés.

Pour ajouter des blocs :

- **Le déclencheur** — cliquez sur le bloc en pointillés. Un panneau intitulé **Add Trigger** s'ouvre.
- **Tout le reste** — cliquez sur **Ajouter un composant** dans la barre d'outils au-dessus du canevas. Le même panneau s'ouvre, intitulé **Ajouter un composant**.

Les deux panneaux se parcourent par recherche — appuyez sur `/` pour sauter dans le champ de recherche — et sont regroupés par catégorie. Sélectionnez un bloc, puis cliquez sur **Add to Workflow**.

Les nouveaux blocs se posent toujours au même endroit du canevas : l'un d'eux peut donc atterrir par-dessus un bloc que vous aviez déjà placé. Faites-le glisser à l'écart ; le canevas s'aligne sur une grille au fur et à mesure. La position des blocs est enregistrée, si bien que la personne suivante retrouve l'agencement que vous avez laissé.

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

Cliquez sur un bloc pour ouvrir ses paramètres dans une boîte de dialogue. Chaque réglage dispose du champ qui lui convient — texte, liste déroulante, éditeur de code, interrupteur, et ainsi de suite. Remplissez-les, puis cliquez sur **Enregistrer**.

C'est dans cette même boîte de dialogue que vous trouvez :

- **Supprimer** — retirer ce bloc.
- **Run just this step** — exécuter ce seul bloc, sans le reste du workflow. Les valeurs qu'il aurait lues auprès des autres étapes arrivent vides, et tout ce qu'il envoie, écrit ou supprime se produit pour de vrai.
- **Documentation**, **Inputs**, **Outputs** et **Returns** — les fiches de référence de ce que ce bloc attend et de ce qu'il produit.

La plupart des champs de texte acceptent des variables — c'est ainsi que les données passent d'un bloc au suivant. Plutôt que de taper la syntaxe à la main, utilisez le sélecteur de valeurs de l'éditeur : il construit une référence correcte à partir du bloc et du champ que vous choisissez. Voir [Variables de workflow](/docs/workflows/variables).

## Les vérifications au fil de la construction

Le Constructeur vérifie l'ensemble du graphe à chacune de vos modifications et rend compte de ce qu'il trouve dans une pastille de la barre d'outils. Cliquez sur la pastille pour ouvrir **Problems with this workflow**, qui liste chaque problème et vous emmène sur le bloc responsable. Les blocs en cause portent aussi un badge rouge sur le canevas.

Il attrape les erreurs qui, autrement, restent invisibles jusqu'à ce qu'une exécution tourne mal : pas de déclencheur, deux blocs qui partagent un identifiant, un point à l'intérieur d'un identifiant, un bloc que rien ne relie, un réglage obligatoire laissé vide, du JSON mal formé, des espaces à l'intérieur de `{{ }}`, ou des références vers une étape ou une valeur de retour qui n'existe pas.

Une chose lui échappe : savoir si un nom de variable existe. Une variable renommée ne se révèle que dans le journal d'exécution.

## Votre premier workflow

Le plus rapide pour prendre le canevas en main :

1. Cliquez sur le bloc en pointillés, choisissez **Manual** dans le panneau **Add Trigger**, puis cliquez sur **Add to Workflow**.
2. Cliquez sur **Ajouter un composant**, choisissez **Log** (dans **Utils**), puis cliquez sur **Add to Workflow**. Faites glisser le nouveau bloc à l'écart du déclencheur, puis reliez le point **Execute** du déclencheur au point d'entrée du bloc Log.
3. Ouvrez le bloc Log et donnez à sa **Valeur** le contenu `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` est l'**Identifier** du déclencheur, affiché sur son bloc — vérifiez qu'il correspond.
4. Allez sur **Vue d'ensemble**, cliquez sur **Modifier le flux de travail** dans la carte **Détails du flux de travail** et basculez **Activé** sur oui. Un workflow désactivé ne peut pas s'exécuter du tout, pas même à la main.
5. De retour sur le **Constructeur**, cliquez sur **Exécuter le flux de travail**, saisissez `{ "name": "Ada" }` dans le champ **JSON**, cliquez sur **Run Workflow Manually**, puis confirmez avec **Run**.
6. Un panneau **Workflow Run** s'ouvre de lui-même et suit l'exécution. Le journal affiche `Value:` suivi de `Hello from Ada`.

Ce cycle — ajouter, relier, configurer, exécuter, lire le journal — c'est ainsi que vous construirez chacun de vos workflows.

## L'activer

Les nouveaux workflows démarrent désactivés, tout comme ceux que vous dupliquez ou importez.

L'interrupteur **Activé** se trouve sur la page **Vue d'ensemble** du workflow, dans la carte **Détails du flux de travail** — et non sur la page des paramètres. Cette même carte affiche l'état courant sous forme de pastille verte **Activé** ou rouge **Désactivé**.

Un workflow désactivé ne peut pas s'exécuter du tout. Les exécutions manuelles sont refusées avec « This workflow is not enabled », exactement comme les exécutions déclenchées. L'ordre est donc : activez-le, testez-le avec **Exécuter le flux de travail**, lisez le journal d'exécution, puis remettez **Activé** sur non si vous n'êtes pas prêt à laisser son déclencheur se déclencher. Pour tester un seul bloc sans lancer l'ensemble, utilisez **Run just this step** dans les paramètres de ce bloc.

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
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
