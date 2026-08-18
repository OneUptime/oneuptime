# Exécutions et journaux

Chaque fois qu'un workflow s'exécute, OneUptime enregistre un compte rendu de ce qui s'est passé — quand il s'est exécuté, s'il a fonctionné et ce qu'a fait chaque bloc. Ce compte rendu s'appelle une **exécution**. Les exécutions vous permettent de confirmer qu'un workflow a bien fonctionné, de déboguer celui qui a échoué et de revenir sur l'activité passée.

## Où les trouver

| Page                       | Ce que vous voyez                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Flux de travail → Exécutions & journaux** | Toutes les exécutions de tous les workflows du projet. Filtrez par nom de workflow, statut et période.           |
| **Workflow → Exécutions & journaux**  | Uniquement les exécutions de ce workflow. Ici, un filtre **Run ID** remplace le filtre de workflow.  |
| **Une exécution unique**            | Ouverte avec le bouton **View Logs** sur une ligne d'exécution — les lignes elles-mêmes ne sont pas cliquables.           |

## Statuts d'exécution

| Statut                             | Signification                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Planifié**                      | Le déclencheur s'est activé et l'exécution est mise en file d'attente pour un runner. Généralement une fraction de seconde. Une exécution encore planifiée après 5 minutes est en échec — personne ne l'a prise en charge. |
| **En cours d'exécution**                        | Le workflow est en cours. Les blocs longs maintiennent une exécution dans cet état.                                                                                |
| **En attente**                        | L'exécution est en pause sur un bloc **Sleep** et reprendra d'elle-même. Elle n'occupe aucun worker pendant l'attente.                                                                                      |
| **Executed**                       | L'exécution est arrivée à son terme sans échouer. (C'est l'état de succès — la pastille affiche **Executed**, pas « Success ».)                                                                        |
| **Erreur**                          | L'exécution s'est arrêtée parce qu'un bloc a levé une erreur. Utilisé aussi quand une exécution en file d'attente n'est jamais prise en charge, quand la reprise d'une exécution en veille est perdue, quand une expression de planification ne peut pas être résolue, ou quand le workflow est désactivé en cours d'exécution. |
| **Timeout**                        | L'exécution a duré plus longtemps que la durée autorisée. Voir [Configuration et sécurité des workflows](/docs/workflows/configuration).                                                              |
| **Execution Exceeded Current Plan** | Le projet a épuisé ses exécutions de workflow pour les 30 derniers jours, ou l'abonnement n'est pas payé. L'exécution est enregistrée mais non exécutée. OneUptime Cloud uniquement. |

Un bloc qui bascule vers sa sortie **Error** — un bloc API sur une réponse 4xx, par exemple — ne fait pas échouer l'exécution. La branche d'erreur s'exécute et l'exécution se termine tout de même en **Executed**. L'étape elle-même est quand même dessinée en rouge pour que vous puissiez la repérer.

## Lire une exécution

Cliquez sur **View Logs** sur une exécution pour l'ouvrir. La vue **Workflow Run** comporte deux onglets.

**Steps** — une ligne par bloc exécuté, dans l'ordre. Chaque ligne affiche le titre du bloc, son identifiant de composant, sa durée et la sortie qu'il a empruntée (`→ success`, `→ error`, `→ yes`). Développez une ligne pour obtenir deux blocs de détail :

- **Received** — les paramètres fournis au bloc, après résolution de toutes les variables.
- **Returned** — ce qu'il a produit.

Les étapes en échec sont en rouge et s'affichent développées par défaut, avec le message d'erreur imprimé au-dessus de **Received**.

**Full Log** — le journal brut, ligne par ligne, imprimé par le runner, y compris tout ce que les blocs ont eux-mêmes consigné. Utilisez-le quand la vue Steps n'explique pas l'échec.

Deux détails à connaître. L'identifiant de composant imprimé sous le titre de chaque étape est exactement la chaîne à coller dans une référence `{{local.components.<id>.returnValues.…}}`, ce qui en fait le moyen le plus rapide d'obtenir une référence correcte. Et une exécution ne conserve que ses 100 dernières étapes — une exécution longue ou reprise à plusieurs reprises affiche une note ambrée à l'endroit où les précédentes ont été supprimées.

Les valeurs affichées sont celles vues par le bloc après le remplissage des variables, à deux exceptions près : les secrets et les champs que le bloc marque comme sensibles sont masqués, et les valeurs très longues sont raccourcies avec « … (truncated) ».

Démarrer une exécution depuis le **Builder** ouvre cette même vue en suivant déjà l'exécution, afin que vous puissiez l'observer en direct plutôt que de devoir la chercher après coup.

## Débogage courant

### « Mon workflow ne s'est pas exécuté. »

1. Assurez-vous que le workflow est **Enabled** sur sa page **Overview**. Les nouveaux workflows démarrent désactivés, et un workflow désactivé rejette toute exécution — y compris les manuelles.
2. Pour un déclencheur d'événement OneUptime : confirmez que l'événement a réellement eu lieu. Ouvrez l'enregistrement et consultez son historique.
3. Pour un déclencheur webhook : confirmez que l'autre système envoie bien à la bonne URL. La plupart des outils consignent l'envoi d'un webhook — vérifiez de leur côté.
4. Pour un déclencheur planifié : confirmez que l'expression cron correspond à l'heure attendue.

Si l'exécution *apparaît* bien avec le statut **Execution Exceeded Current Plan**, le projet a épuisé ses exécutions de workflow pour les 30 derniers jours, ou l'abonnement n'est pas payé. Le journal de l'exécution indique le nombre et la limite de votre forfait. Cela ne s'applique qu'à OneUptime Cloud.

### « Un bloc ultérieur ne s'est jamais exécuté. »

Un bloc qui ne s'exécute pas est généralement un problème de câblage. Ouvrez le **Builder** et vérifiez :

- La sortie du bloc précédent est-elle bien reliée à l'entrée de ce bloc ?
- Le bloc précédent a-t-il emprunté une sortie différente de celle attendue — **Error** au lieu de **Success**, ou **No** au lieu de **Yes** ? L'onglet Steps indique laquelle il a empruntée.

### « Une variable est arrivée vide. »

Ouvrez l'exécution et regardez le bloc **Received** de l'étape en échec.

- Si vous voyez le texte littéral `{{local.components.…}}`, la référence n'a pas été résolue. C'est généralement une faute de frappe dans l'identifiant du composant ou dans l'identifiant de la valeur de retour — n'oubliez pas qu'il s'agit de l'**Identifier** du bloc, pas du nom affiché dessus. Vérifiez aussi l'orthographe de `local.components` lui-même : `{{local.componets.api-get-1.returnValues.response-body}}` est envoyé comme texte littéral et l'exécution est quand même signalée **Executed**.
- Si vous voyez une chaîne vide, le bloc précédent s'est bien exécuté mais n'a pas produit ce champ.

L'onglet **Full Log** porte une ligne d'avertissement nommant toute référence qui n'a pas été résolue, ce qui est généralement le moyen le plus rapide de la trouver.

### « Cela fonctionne quand je l'exécute manuellement, mais pas depuis le déclencheur. »

Ouvrez le **Builder**, cliquez sur **Run Workflow**, et remplissez les champs du déclencheur avec des valeurs qui ressemblent à ce que le véritable déclencheur envoie. Comparez ensuite les valeurs **Received** de cette exécution à celles de l'exécution réelle, côte à côte. La différence se résume généralement à un seul nom de champ ou à un type.

## Relancer un workflow

Il n'existe pas de bouton « réessayer cette exécution ». Nous ne relançons pas automatiquement les anciennes exécutions car leurs effets secondaires — messages Slack, appels d'API, tickets — pourraient ne pas être sûrs à répéter. Pour refaire le travail, corrigez le workflow et laissez le prochain déclencheur réel le lancer, ou ouvrez le **Builder** et cliquez sur **Run Workflow** avec les mêmes valeurs.

## Combien de temps les exécutions sont-elles conservées ?

Sur OneUptime Cloud, les exécutions sont conservées pendant **30 jours** puis supprimées — c'est pourquoi les deux listes d'exécutions se décrivent comme couvrant les 30 derniers jours. Les installations auto-hébergées conservent les exécutions jusqu'à ce que vous les supprimiez ; si un workflow s'exécute très souvent et encombre votre historique, désactivez-le ou supprimez-le pour cesser d'ajouter du bruit.

Les exécutions enregistrées avant l'ajout du traçage des étapes n'ont aucun contenu **Steps** et n'affichent que leur **Full Log**.

## Pour aller plus loin

- [Configuration et sécurité des workflows](/docs/workflows/configuration) — délais d'expiration, limites de récursion, secrets masqués.
- [Variables de workflow](/docs/workflows/variables) — la syntaxe des variables utilisée dans vos blocs.
- [Composants de workflow](/docs/workflows/components) — ce que produit chaque bloc.
