# Exécutions et journaux

Chaque fois qu'un workflow s'exécute, OneUptime enregistre un compte rendu de ce qui s'est passé — quand il s'est exécuté, s'il a fonctionné et ce qu'a fait chaque bloc. Ce compte rendu s'appelle une **exécution**. Les exécutions vous permettent de confirmer qu'un workflow a bien fonctionné, de déboguer celui qui a échoué et de revenir sur l'activité passée.

## Où les trouver

| Page                           | Ce que vous voyez                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Workflows → Runs & Logs**    | Toutes les exécutions de tous les workflows du projet. Filtrez par workflow, statut et période. |
| **Workflow → Onglet Logs**     | Seulement les exécutions de ce workflow.                                                        |
| **Une exécution individuelle** | Une seule exécution, avec la sortie de chaque bloc.                                             |

## Statuts d'exécution

| Statut        | Signification                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled** | Le déclencheur s'est activé et l'exécution est sur le point de démarrer. Cela ne prend généralement qu'une fraction de seconde.                                                        |
| **Running**   | Le workflow est en cours. Les blocs longs maintiennent une exécution dans cet état.                                                                                                    |
| **Success**   | Tous les blocs qui se sont exécutés ont terminé sans erreur. (Prendre intentionnellement une branche **error** compte toujours comme un succès — le workflow lui-même n'a pas échoué.) |
| **Error**     | Un bloc a échoué et aucun chemin **error** n'était connecté pour le gérer. L'exécution s'est arrêtée là.                                                                               |
| **Timeout**   | L'exécution a duré plus longtemps que la durée autorisée. Voir [Configuration et sécurité](/docs/workflows/configuration).                                                             |

## Lire une exécution

Cliquez sur n'importe quelle exécution pour ouvrir ses détails. Vous y verrez :

- **En-tête** — le déclencheur, l'heure de début et de fin, la durée totale et le statut.
- **Liste des blocs** — chaque bloc qui s'est exécuté, dans l'ordre. Chacun affiche les valeurs qui lui ont été fournies, sa sortie et le chemin qu'il a emprunté.
- **Erreurs** — si un bloc a échoué, le message d'erreur et (lorsque disponibles) plus de détails.

Les valeurs affichées sont exactement ce que le bloc a vu — après que toutes les variables ont été substituées. C'est la vue de débogage la plus utile : si un message Slack affiche le texte littéral `{{Incident.title}}` au lieu du titre réel, vous savez que la variable n'a pas été résolue.

## Débogage courant

### « Mon workflow ne s'est pas exécuté. »

1. Vérifiez que le workflow est **activé** dans Settings. Les nouveaux workflows démarrent désactivés.
2. Pour un déclencheur d'événement OneUptime : confirmez que l'événement a réellement eu lieu. Ouvrez l'enregistrement et consultez son historique.
3. Pour un déclencheur webhook : confirmez que l'autre système envoie bien à la bonne URL. La plupart des outils consignent l'envoi d'un webhook — vérifiez de leur côté.
4. Pour un déclencheur planifié : confirmez que l'expression cron correspond à l'heure attendue.

Si le déclencheur s'est bien activé mais qu'aucune exécution n'apparaît, vérifiez votre quota d'exécutions sous **Project Settings → Billing**.

### « Un bloc ultérieur ne s'est jamais exécuté. »

Un bloc qui ne s'exécute pas est généralement un problème de câblage. Ouvrez le canevas et vérifiez :

- La sortie du bloc précédent est-elle bien reliée à l'entrée de ce bloc ?
- Le bloc précédent a-t-il emprunté une sortie différente de celle attendue (par exemple **error** au lieu de **success**, ou **No** au lieu de **Yes**) ? Le détail de l'exécution montre quel chemin a été pris.

### « Une variable est arrivée vide. »

Ouvrez l'exécution et examinez les valeurs du bloc défaillant.

- Si vous voyez le texte littéral `{{BlockName.field}}`, la référence n'a pas été résolue — probablement une faute de frappe dans le nom du bloc ou du champ.
- Si vous voyez une chaîne vide, le bloc précédent s'est bien exécuté mais n'a pas produit ce champ.

### « Cela fonctionne quand je l'exécute manuellement, mais pas depuis le déclencheur. »

Utilisez **Run Manually** avec une charge utile JSON qui ressemble à ce qu'envoie le véritable déclencheur. Comparez ensuite les valeurs de l'exécution manuelle à celles de l'exécution réelle, côte à côte. La différence se résume généralement à un seul nom de champ ou à un type.

## Relancer un workflow

Il n'existe pas de bouton « réessayer cette exécution ». Nous ne relançons pas automatiquement les anciennes exécutions car leurs effets secondaires (messages Slack, appels d'API, tickets) ne sont pas forcément sûrs à répéter. Pour refaire le travail, corrigez le workflow et laissez le prochain déclencheur réel le lancer.

Pour les workflows manuels, cliquez simplement sur **Run Manually** avec la même charge utile.

## Combien de temps les exécutions sont-elles conservées ?

Les exécutions sont conservées indéfiniment pour le projet. Si un workflow s'exécute très souvent et encombre votre historique (comme un workflow de débogage qui se déclenche chaque minute), désactivez-le ou supprimez-le pour cesser d'ajouter du bruit.

## Pour aller plus loin

- [Configuration et sécurité](/docs/workflows/configuration) — délais d'expiration, limites de récursion, secrets masqués.
- [Variables](/docs/workflows/variables) — la syntaxe des variables utilisée dans vos blocs.
- [Composants](/docs/workflows/components) — ce que produit chaque bloc.
