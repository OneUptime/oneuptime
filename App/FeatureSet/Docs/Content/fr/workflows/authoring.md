# Créer un workflow

Pour créer un workflow, ouvrez **Workflows** et cliquez sur **Create Workflow**. Un assistant appelé **Create a workflow** vous guide : d'abord **Start from** — choisissez **Start from scratch** ou l'un des modèles — puis **Name**, et enfin une étape **Configure**, qui n'apparaît que lorsque le modèle choisi requiert ses propres paramètres.

Une fois créé, ouvrez **Builder** dans le menu de gauche. C'est le canevas où vous concevez le workflow.

## Le canevas

Un workflow partant de zéro s'ouvre avec un seul bloc en pointillés indiquant **Please click here to add trigger**. Ce bloc est le point de départ — cliquez dessus pour choisir un déclencheur. Un workflow créé à partir d'un modèle s'ouvre avec ses blocs déjà en place.

Chaque workflow a exactement un **déclencheur** en haut. Tout le reste est un **composant** qui fait quelque chose. Ajouter un second déclencheur remplace le premier, et supprimer le dernier fait réapparaître le bloc en pointillés.

Ajouter des blocs :

- **Le déclencheur** — cliquez sur le bloc en pointillés. Un panneau intitulé **Add Trigger** s'ouvre.
- **Tout le reste** — cliquez sur **Add Component** dans la barre d'outils au-dessus du canevas. Le même panneau s'ouvre, intitulé **Add Component**.

Les deux panneaux sont consultables par recherche — appuyez sur `/` pour aller directement à la zone de recherche — et regroupés par catégorie. Sélectionnez un bloc et cliquez sur **Add to Workflow**.

Les nouveaux blocs atterrissent toujours au même endroit sur le canevas, donc un nouveau bloc peut se déposer sur quelque chose que vous avez déjà placé. Déplacez-le pour le dégager ; le canevas s'aligne sur une grille au fur et à mesure. Les positions des blocs sont enregistrées, donc la personne suivante voit la même disposition que celle que vous avez laissée.

Les modifications sont enregistrées automatiquement. Une pastille dans la barre d'outils le suit : **Saving…** pendant que la modification est en cours, puis **Saved**, ou **Could not save** si ça n'a pas fonctionné. Il n'y a pas de bouton Enregistrer ni d'étape de publication séparée.

## Ce que contient un bloc

| Champ                        | Rôle                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (sous **ID**) | L'identifiant court affiché sur le bloc, comme `log-1`. C'est par là que les autres blocs font référence à celui-ci, donc le renommer casse chaque référence `{{local.components.…}}` qui pointe vers lui. Le titre du bloc est le nom du composant lui-même et ne peut pas être modifié. |
| **Settings**                  | Ce dont le bloc a besoin pour faire son travail — une URL, un canal Slack, un corps de message. Les champs optionnels sont marqués **(Optional)** ; tout le reste est obligatoire. Les réglages moins utilisés se trouvent derrière un menu **Advanced**. |
| **Input**                     | Le point sur le bord supérieur, par où arrivent les lignes provenant des blocs précédents. Les déclencheurs n'en ont pas — rien ne s'exécute avant eux.                                             |
| **Outputs**                   | Les points le long du bord inférieur, étiquetés juste au-dessus, par où les lignes partent vers les blocs suivants. Beaucoup de blocs ont des sorties **Success** et **Error** distinctes pour gérer les deux cas. |

## Relier les blocs

Glissez depuis un point en bas d'un bloc jusqu'au point en haut du suivant. La ligne que vous tracez décide ce qui s'exécute ensuite.

- Si vous reliez depuis **Success**, le bloc suivant ne s'exécute que si le précédent a réussi.
- Si vous reliez depuis **Error**, le bloc suivant ne s'exécute que si le précédent a échoué.
- Si vous ne reliez pas une sortie, ce chemin s'arrête simplement.

Vous pouvez relier une sortie à plusieurs blocs. Ils s'exécutent tous — mais l'un après l'autre, dans une seule file, pas en parallèle. Ne comptez pas sur l'ordre entre les branches, et ne comptez pas sur leur chevauchement dans le temps. Chaque bloc s'exécute au maximum une fois par exécution, donc une boucle vers un bloc précédent ne le fera pas s'exécuter deux fois.

## Configurer un bloc

Cliquez sur un bloc pour ouvrir ses réglages dans une boîte de dialogue. Chaque réglage a le bon type de champ — champs texte, listes déroulantes, éditeurs de code, interrupteurs, etc. Remplissez-le et cliquez sur **Save**.

C'est dans la même boîte de dialogue que vous trouvez :

- **Delete** — supprimer ce bloc.
- **Run just this step** — exécuter ce seul bloc, indépendamment du reste du workflow. Les valeurs qu'il aurait lues depuis d'autres étapes arrivent vides, et tout ce qu'il envoie, écrit ou supprime se produit réellement.
- **Documentation**, **Inputs**, **Outputs** et **Returns** — des fiches de référence sur ce que ce bloc attend et produit.

La plupart des champs texte acceptent des variables — c'est ainsi que les données circulent d'un bloc à l'autre. Plutôt que de taper la syntaxe à la main, utilisez le sélecteur de valeur dans l'éditeur : il construit une référence correcte à partir du bloc et du champ que vous choisissez. Voyez [Variables de workflow](/docs/workflows/variables).

## Vérifications pendant que vous construisez

Le Builder vérifie l'ensemble du graphe à chaque modification, et rapporte ce qu'il trouve dans une pastille de la barre d'outils. Cliquez sur la pastille pour ouvrir **Problems with this workflow**, qui liste chaque problème et vous amène directement au bloc responsable. Les blocs qui posent problème portent aussi un badge rouge sur le canevas.

Il détecte les erreurs qui seraient autrement invisibles jusqu'à ce qu'une exécution tourne mal — pas de déclencheur, deux blocs partageant un identifiant, un point à l'intérieur d'un identifiant, un bloc auquel rien ne se connecte, un réglage obligatoire laissé vide, du JSON mal formé, des espaces à l'intérieur de `{{ }}`, et des références vers une étape ou une valeur de retour qui n'existe pas.

Une chose qu'il ne peut pas vérifier : si un nom de variable existe. Une variable renommée n'apparaît que dans le journal d'exécution.

## Votre premier workflow

La façon la plus rapide de vous familiariser avec le canevas :

1. Cliquez sur le bloc en pointillés, choisissez **Manual** dans le panneau **Add Trigger**, et cliquez sur **Add to Workflow**.
2. Cliquez sur **Add Component**, choisissez **Log** (sous **Utils**), et cliquez sur **Add to Workflow**. Déplacez le nouveau bloc pour le dégager du déclencheur, puis reliez le point **Execute** du déclencheur au point d'entrée du bloc Log.
3. Ouvrez le bloc Log et réglez son champ **Value** sur `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` est l'**Identifier** du déclencheur, affiché sur le bloc du déclencheur — vérifiez qu'il correspond.
4. Allez sur **Overview**, cliquez sur **Edit Workflow** dans la carte **Workflow Details**, et basculez **Enabled** sur oui. Un workflow désactivé ne peut pas du tout être exécuté, pas même à la main.
5. De retour sur le **Builder**, cliquez sur **Run Workflow**, mettez `{ "name": "Ada" }` dans le champ **JSON**, cliquez sur **Run Workflow Manually**, puis confirmez avec **Run**.
6. Un panneau **Workflow Run** s'ouvre tout seul et suit l'exécution. Le journal affiche `Value:` suivi de `Hello from Ada`.

Ce cycle — ajouter, connecter, configurer, exécuter, lire le journal — est la façon dont vous construirez chaque workflow.

## L'activer

Les nouveaux workflows démarrent désactivés, tout comme n'importe quel workflow que vous dupliquez ou importez.

L'interrupteur **Enabled** se trouve sur la page **Overview** du workflow, dans la carte **Workflow Details** — pas sur la page Settings. La même carte affiche l'état actuel sous forme de pastille verte **Enabled** ou rouge **Disabled**.

Un workflow désactivé ne peut pas s'exécuter du tout. Les exécutions manuelles sont rejetées avec « This workflow is not enabled », exactement comme les exécutions déclenchées, donc l'ordre est : activez-le, testez-le avec **Run Workflow**, lisez le journal d'exécution, et rebasculez **Enabled** sur désactivé si vous n'êtes pas prêt à ce que son déclencheur se déclenche. Pour tester un seul bloc sans exécuter tout le workflow, utilisez **Run just this step** dans les réglages de ce bloc.

Pour mettre un workflow en pause sans le supprimer, basculez **Enabled** sur désactivé. Aucune nouvelle exécution ne démarre. Une exécution en cours se termine, mais une exécution en attente sur un bloc **Sleep** est annulée à son réveil et enregistrée comme une erreur.

## Ranger

- Déplacez les blocs pour les faire bouger. La disposition est enregistrée.
- Pour supprimer une ligne, faites glisser l'une de ses extrémités hors du point et déposez-la sur le canevas vide.
- Pour supprimer un bloc, cliquez dessus et utilisez **Delete** au bas de sa boîte de dialogue de réglages. Sélectionner un bloc ou une ligne et appuyer sur Retour arrière la supprime aussi.
- Il n'y a pas de façon de dupliquer un seul bloc. **Duplicate Workflow** sur la page **Settings** du workflow copie l'ensemble, et la copie atterrit désactivée.
- Empilez les blocs de haut en bas pour qu'ils se lisent dans le sens de leur exécution — les entrées sont sur le bord supérieur, les sorties sur le bord inférieur, donc le flux va naturellement vers le bas.

## Où lire ensuite

- [Déclencheurs de workflow](/docs/workflows/triggers) — les quatre façons de démarrer un workflow.
- [Composants de workflow](/docs/workflows/components) — chaque bloc que vous pouvez ajouter.
- [Variables de workflow](/docs/workflows/variables) — déplacer des données entre les blocs.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
