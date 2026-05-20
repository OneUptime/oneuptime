# Exécutions et journaux

Chaque fois que le déclencheur d'un workflow se déclenche, OneUptime crée une **exécution** — un enregistrement d'une exécution avec le timing, le statut et la sortie par nœud. Les exécutions sont la manière dont vous confirmez qu'un workflow a fonctionné, comment vous déboguez celui qui n'a pas fonctionné, et comment vous écrivez un postmortem quand une automatisation se comporte mal.

## Où les trouver

| Page | Portée |
| --- | --- |
| **Workflows → Runs & Logs** | À l'échelle du projet. Chaque exécution de chaque workflow. Filtrer par workflow, statut et plage temporelle. |
| **Onglet Logs d'un workflow** | Seulement les exécutions de ce workflow. |
| **Page de détail d'une exécution** | Une exécution, étendue avec la sortie par nœud et tous les messages d'erreur. |

## Statuts d'exécution

| Statut | Signification |
| --- | --- |
| **Scheduled** | Le déclencheur s'est déclenché et l'exécution est en file d'attente, mais le worker ne l'a pas encore prise. Habituellement une fraction de seconde. |
| **Running** | Le worker parcourt actuellement le graphe. Les composants longs (appels HTTP lents, délais intentionnels) maintiennent une exécution dans cet état. |
| **Success** | Chaque nœud qui s'est exécuté s'est terminé sans erreur. (Un workflow qui a délibérément pris une branche `error` est toujours `Success` dans l'ensemble — le workflow lui-même n'a pas échoué.) |
| **Error** | Un nœud a échoué et il n'y avait pas de port `error` câblé pour le gérer. L'exécution s'est arrêtée à ce nœud. |
| **Timeout** | L'exécution a dépassé le timeout par exécution. Voir [Configuration et sécurité](/docs/workflows/configuration). |

## Lire une exécution

Cliquez sur une exécution depuis la liste pour ouvrir sa page de détail. Vous voyez :

- **En-tête** — le déclencheur qui s'est déclenché, l'horodatage de début et de fin, la durée totale, le statut.
- **Liste des nœuds** — chaque nœud qui s'est exécuté dans l'ordre, chacun avec ses arguments capturés, sa valeur de retour et son port de sortie choisi.
- **Erreurs** — si un nœud a échoué, le message d'erreur et (quand disponible) la trace de la pile.

Les arguments capturés montrent les valeurs *post-interpolation* — c'est-à-dire les chaînes exactes que le nœud a vues après que les variables ont été résolues. C'est la vue de débogage la plus utile : si un message Slack contient le texte littéral `{{Incident.title}}`, vous savez que la référence de la variable ne s'est pas résolue.

## Motifs de débogage courants

### « Mon workflow ne s'est pas déclenché. »

1. Confirmez que le workflow est **activé** dans **Settings**. Les nouveaux workflows sont livrés désactivés.
2. Pour un déclencheur d'événement de modèle : confirmez que l'événement s'est réellement produit. Ouvrez l'entité (l'incident, l'alerte, le monitor) et regardez son historique.
3. Pour un déclencheur webhook : confirmez que le système externe atteint la bonne URL. De nombreux outils journalisent la livraison de webhooks sortants — vérifiez là-bas.
4. Pour un déclencheur planifié : confirmez que l'expression cron correspond à l'heure que vous attendez. Utilisez un analyseur cron en cas de doute.

Si le déclencheur s'est déclenché mais qu'aucune exécution n'apparaît, vérifiez le quota d'exécution du projet sous **Project Settings → Billing**.

### « Il s'exécute mais un nœud en aval ne s'exécute jamais. »

Un nœud qui ne s'exécute pas est habituellement un problème de câblage. Ouvrez le canevas et vérifiez :

- Le port de sortie du nœud en amont est-il réellement connecté au port d'entrée de ce nœud ?
- Le nœud en amont a-t-il pris un port différent (par exemple, `error` au lieu de `success`, ou `no` au lieu de `yes`) ? Regardez le détail de l'exécution pour voir quel port il a choisi.

### « Une variable arrive vide. »

Ouvrez le détail de l'exécution et regardez les arguments capturés du nœud défaillant. Si vous voyez le texte littéral `{{NodeId.field}}`, la référence ne s'est pas résolue — probablement une faute de frappe dans `NodeId` ou `field`. Si vous voyez une chaîne vide, le nœud en amont s'est exécuté mais n'a pas produit ce champ.

### « Il fonctionne manuellement mais pas depuis le déclencheur. »

Utilisez **Run Manually** avec une charge utile JSON qui reflète ce que le vrai déclencheur publie. Puis comparez les arguments capturés dans l'exécution manuelle vs. l'exécution de production côte à côte — la différence est habituellement dans un seul nom de champ ou type.

## Re-exécuter un workflow

Il n'y a pas de bouton « réessayer cette exécution » — par conception, OneUptime ne ré-exécute jamais une ancienne exécution, car les effets de bord sortants (messages Slack, appels API) pourraient ne pas être idempotents. Si vous voulez refaire le travail, corrigez le workflow et laissez le prochain vrai déclencheur le lancer.

Pour les workflows manuels, cliquez simplement sur **Run Manually** avec la même charge utile.

## Rétention des journaux

Les exécutions sont conservées indéfiniment sur le projet. Si vous devez nettoyer des workflows à fort volume et bruyants (par exemple, un workflow de débogage qui se déclenche chaque minute), désactivez-les ou supprimez-les — il n'y a pas de réglage de rétention par workflow.

## Où lire ensuite

- [Configuration et sécurité](/docs/workflows/configuration) — timeouts, limites de récursion, masquage des secrets.
- [Variables](/docs/workflows/variables) — la syntaxe utilisée par les arguments interpolés.
- [Composants](/docs/workflows/components) — les champs de valeur de retour que chaque composant publie.
