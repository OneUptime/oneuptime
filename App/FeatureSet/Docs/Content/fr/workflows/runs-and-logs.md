# Exécutions et journaux

Chaque fois qu'un workflow s'exécute, OneUptime conserve la trace de ce qui s'est passé — quand il s'est exécuté, s'il a abouti, et ce qu'a fait chaque bloc. Cette trace s'appelle une **exécution**. C'est par les exécutions que vous confirmez qu'un workflow a bien fonctionné, que vous déboguez celui qui a échoué et que vous revenez sur l'activité passée.

## Où les trouver

| Page                        | Ce que vous y voyez                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Flux de travail → Exécutions & journaux** | Toutes les exécutions de tous les workflows du projet. Filtrez par nom de workflow, par statut et par période. |
| **Workflow → Exécutions & journaux**  | Uniquement les exécutions de ce workflow-là. Ici, un filtre **Run ID** remplace le filtre par workflow. |
| **Une exécution isolée**            | S'ouvre avec le bouton **Voir les journaux** sur la ligne d'une exécution — les lignes elles-mêmes ne sont pas cliquables. |

## Statuts d'exécution

| Statut                             | Ce qu'il signifie                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Planifié**                       | Le déclencheur s'est activé et l'exécution attend qu'un runner la prenne. En général une fraction de seconde. Une exécution encore planifiée au bout de 5 minutes est un échec — personne ne l'a prise en charge. |
| **En cours d'exécution**           | Le workflow est en cours. Les blocs longs maintiennent une exécution dans cet état.                                                                       |
| **En attente**                     | L'exécution patiente sur un bloc **Sleep** et reprendra d'elle-même. Elle n'occupe aucun worker pendant ce temps.                                          |
| **Executed**                       | L'exécution est allée jusqu'au bout sans échouer. (C'est l'état de succès — la pastille affiche **Executed**, pas « Success ».)                            |
| **Erreur**                         | L'exécution s'est arrêtée parce qu'un bloc a levé une erreur. Ce statut sert aussi quand une exécution en file d'attente n'est jamais prise en charge, quand la reprise d'une exécution endormie se perd, quand une expression de planification ne peut pas être résolue, ou quand le workflow est désactivé en cours de route. |
| **Timeout**                        | L'exécution a duré plus longtemps que la durée autorisée. Voir [Configuration et sécurité des workflows](/docs/workflows/configuration).                   |
| **Execution Exceeded Current Plan** | Le projet a épuisé son quota d'exécutions de workflow sur les 30 derniers jours, ou l'abonnement est impayé. L'exécution est enregistrée mais pas exécutée. OneUptime Cloud uniquement. |

Un bloc qui repart par sa sortie **Erreur** — un bloc API sur une réponse 4xx, par exemple — ne fait pas échouer l'exécution. La branche d'erreur s'exécute et l'exécution se termine quand même en **Executed**. L'étape, elle, reste dessinée en rouge pour que vous la repériez.

## Lire une exécution

Cliquez sur **Voir les journaux** sur une exécution pour l'ouvrir. La vue **Workflow Run** comporte deux onglets.

**Étapes** — une ligne par bloc exécuté, dans l'ordre. Chaque ligne indique le titre du bloc, son identifiant de composant, le temps qu'il a pris et la sortie par laquelle il est reparti (`→ success`, `→ error`, `→ yes`). Dépliez une ligne pour obtenir deux blocs de détail :

- **Received** — les paramètres transmis au bloc, une fois toutes les variables résolues.
- **Returned** — ce qu'il a produit.

Les étapes en échec sont en rouge et s'affichent déjà dépliées, le message d'erreur imprimé au-dessus de **Received**.

**Full Log** — le journal brut, ligne à ligne, tel que le runner l'a imprimé, y compris ce que les blocs ont consigné eux-mêmes. Servez-vous-en quand la vue **Étapes** n'explique pas l'échec.

Deux détails utiles. L'identifiant de composant imprimé sous le titre de chaque étape est exactement la chaîne à coller dans une référence `{{local.components.<id>.returnValues.…}}` : c'est donc le moyen le plus rapide d'écrire une référence juste. Et une exécution ne garde que ses 100 dernières étapes — une exécution longue, ou reprise plusieurs fois, affiche une note ambrée à l'endroit où les plus anciennes ont été écartées.

Les valeurs affichées sont celles que le bloc a vues une fois les variables remplies, à deux exceptions près : les secrets et les champs que le bloc marque comme sensibles sont masqués, et les valeurs très longues sont coupées avec « … (truncated) ».

Lancer une exécution depuis le **Constructeur** ouvre cette même vue, déjà en train de suivre l'exécution : vous la regardez se dérouler au lieu d'aller la chercher après coup.

## Débogage courant

### « Mon workflow ne s'est pas exécuté. »

1. Vérifiez que le workflow est **Activé** sur sa page **Vue d'ensemble**. Les nouveaux workflows démarrent désactivés, et un workflow désactivé refuse toutes les exécutions — y compris les manuelles.
2. Pour un déclencheur d'événement OneUptime : confirmez que l'événement a bien eu lieu. Ouvrez l'enregistrement et consultez son historique.
3. Pour un déclencheur webhook : confirmez que l'autre système envoie bien vers la bonne URL. La plupart des outils consignent leurs envois de webhook — regardez de ce côté.
4. Pour un déclencheur planifié : confirmez que l'expression cron correspond à l'horaire que vous attendez.

Si l'exécution *apparaît* bien, avec le statut **Execution Exceeded Current Plan**, c'est que le projet a épuisé son quota d'exécutions de workflow sur les 30 derniers jours, ou que l'abonnement est impayé. Le journal de l'exécution indique le décompte et la limite de votre plan. Cela ne concerne que OneUptime Cloud.

### « Un bloc plus loin ne s'est jamais exécuté. »

Un bloc qui ne s'exécute pas, c'est presque toujours un problème de câblage. Ouvrez le **Constructeur** et vérifiez :

- La sortie du bloc précédent est-elle reliée à l'entrée de celui-ci ?
- Le bloc précédent est-il reparti par une autre sortie que celle que vous imaginiez — **Erreur** au lieu de **Succès**, ou **Non** au lieu de **Oui** ? L'onglet **Étapes** montre laquelle il a empruntée.

### « Une variable est arrivée vide. »

Ouvrez l'exécution et regardez le bloc **Received** de l'étape qui échoue.

- Si vous y voyez le texte `{{local.components.…}}` tel quel, la référence n'a pas été résolue. C'est en général une faute de frappe dans l'identifiant du composant ou dans celui de la valeur de retour — rappelez-vous qu'il s'agit de l'**Identifier** du bloc, pas du nom affiché dessus. Vérifiez aussi l'orthographe de `local.components` lui-même : `{{local.componets.api-get-1.returnValues.response-body}}` part comme du texte brut, et l'exécution se termine tout de même en **Executed**.
- Si vous y voyez une chaîne vide, le bloc précédent s'est bien exécuté mais n'a pas produit ce champ.

L'onglet **Full Log** contient une ligne d'avertissement nommant chaque référence non résolue : c'est souvent le plus rapide pour la retrouver.

### « Ça marche quand je le lance à la main, mais pas depuis le déclencheur. »

Ouvrez le **Constructeur**, cliquez sur **Exécuter le flux de travail** et remplissez les champs du déclencheur avec des valeurs semblables à ce qu'envoie le vrai déclencheur. Comparez ensuite les valeurs **Received** de cette exécution avec celles de l'exécution réelle, côte à côte. L'écart tient généralement à un seul nom de champ ou à un seul type.

## Relancer un workflow

Il n'existe pas de bouton « rejouer cette exécution ». Nous ne rejouons pas automatiquement d'anciennes exécutions parce que leurs effets de bord — messages Slack, appels d'API, tickets — ne sont pas forcément sûrs à répéter. Pour refaire le travail, corrigez le workflow et laissez le prochain vrai déclenchement s'en charger, ou ouvrez le **Constructeur** et cliquez sur **Exécuter le flux de travail** avec les mêmes valeurs.

## Combien de temps les exécutions sont-elles conservées ?

Sur OneUptime Cloud, les exécutions sont conservées **30 jours** puis supprimées — c'est pourquoi les deux listes d'exécutions se présentent comme couvrant les 30 derniers jours. Les installations auto-hébergées gardent les exécutions jusqu'à ce que vous les supprimiez ; si un workflow s'exécute très souvent et encombre votre historique, désactivez-le ou supprimez-le pour arrêter d'ajouter au bruit.

Les exécutions enregistrées avant l'arrivée du traçage par étape n'ont pas de contenu **Étapes** et n'affichent que leur **Full Log**.

## Où lire ensuite

- [Configuration et sécurité des workflows](/docs/workflows/configuration) — délais, limites de récursion, secrets masqués.
- [Variables de workflow](/docs/workflows/variables) — la syntaxe des variables utilisée dans vos blocs.
- [Composants de workflow](/docs/workflows/components) — ce que produit chaque bloc.
