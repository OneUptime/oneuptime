# Variables

Un workflow n'est utile que lorsque les données circulent à travers lui. Les variables sont la manière dont ces données se déplacent — du déclencheur vers le premier composant, de la sortie d'un composant vers l'entrée du composant suivant, et des secrets au niveau du projet partout où ils sont référencés.

OneUptime a deux types de variables et une syntaxe d'interpolation qui fonctionne pour les deux.

## Variables globales

Valeurs à l'échelle du projet définies une fois sous **Workflows → Global Variables**. Pensez aux clés d'API, URL de base, noms de canaux, tout ce que vous ne voulez pas coder en dur dans dix workflows.

Une variable globale a :

- **Name** — l'identifiant par lequel vous y faites référence. Utilisez `UPPER_SNAKE_CASE` pour la rendre évidente dans les templates.
- **Value** — la valeur sous forme de chaîne. Les valeurs multi-lignes sont supportées.
- **Is Secret** — quand activé, la valeur est en écriture seule dans l'interface après l'enregistrement et est masquée dans les journaux d'exécution.

Référencez une variable globale depuis n'importe où dans n'importe quel workflow avec :

```
{{variable.NAME}}
```

Par exemple, si vous avez défini `PAGERDUTY_KEY` comme variable secrète, chaque composant API qui appelle PagerDuty peut la lire comme `{{variable.PAGERDUTY_KEY}}` sans que personne ne voie la vraie clé dans le JSON du workflow.

## Variables locales

Les variables locales sont les valeurs de retour des nœuds qui se sont déjà exécutés dans cette exécution. Chaque déclencheur et chaque composant en publie une — voir [Déclencheurs](/docs/workflows/triggers) et [Composants](/docs/workflows/components) pour les listes par nœud.

Référencez une variable locale ainsi :

```
{{NodeId.fieldName}}
```

Le `NodeId` est le nom du déclencheur ou du composant sur le canevas (vous pouvez le renommer pour la lisibilité — gardez-le court et en `PascalCase` pour que les références restent propres). Le `fieldName` est tout ce que ce nœud publie.

Exemples :

- Après qu'un composant **API** nommé `LookupUser` a retourné avec succès, les nœuds en aval peuvent lire son code de statut comme `{{LookupUser.response-status}}` et le corps analysé comme `{{LookupUser.response-body}}`.
- Après un déclencheur **Incident → On Create** nommé `Incident`, vous pouvez lire `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` et toute autre colonne sur l'incident.
- Après un composant **Custom Code** nommé `Transform`, la valeur retournée est exposée comme `{{Transform.value}}`.

Les variables locales sont à portée d'une seule exécution. La prochaine exécution démarre avec une ardoise vierge.

## Où l'interpolation fonctionne

Presque chaque argument de type texte supporte l'interpolation :

- Champs URL sur le composant API
- Message texte sur Slack / Teams / Discord / Telegram / E-mail
- Sujet et corps sur E-mail
- Champs d'en-têtes et de corps (à utiliser dans les valeurs JSON)
- Opérandes gauche et droit sur Conditions

Les arguments purement JSON acceptent l'interpolation à l'intérieur des valeurs de chaîne ; vous ne pouvez pas interpoler une clé. Si vous devez construire une structure dynamique, utilisez **Custom Code** pour assembler la charge utile et puis transmettez sa valeur de retour au nœud suivant.

Le composant **Custom Code** lit les variables différemment — les variables globales sont exposées sur `args.variables`, et les valeurs de retour en amont sont passées sous forme d'arguments nommés que vous configurez sur le composant.

## Exemples

### Construire une charge utile depuis un déclencheur

Un webhook reçoit un résultat de build CI. Le corps est un JSON comme `{ "service": "checkout", "status": "failed" }`. Pour transformer cela en incident OneUptime :

1. Déclencheur **Webhook** nommé `CIWebhook`.
2. Composant **Conditions** : gauche `{{CIWebhook.Request Body.status}}`, opérateur `==`, droite `failed`.
3. Depuis le port `yes`, un composant **Create Incident** avec :
   - Titre : `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description : `See {{CIWebhook.Request Body.url}} for the build logs.`

### Utiliser un secret dans un appel API sortant

Un workflow qui appelle PagerDuty :

1. Définissez `PAGERDUTY_KEY` comme variable globale secrète.
2. Sur le composant **API**, réglez l'en-tête `Authorization` à `Token token={{variable.PAGERDUTY_KEY}}`.

La clé n'apparaît jamais dans le JSON du workflow ni dans les journaux d'exécution.

### Enchaîner deux appels API

Le premier appel retourne un ID dont le second appel a besoin :

1. Composant **API** `LookupOrder` : `GET /orders?email={{Manual.JSON.email}}`.
2. Composant **API** `CancelOrder` : `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Si `LookupOrder` retourne une réponse non-2xx, son port `error` se déclenche à la place de `success` — câblez cette branche vers un composant E-mail ou Slack pour que les échecs ne soient pas silencieux.

## Quelques pièges

- **Les fautes de frappe dans les noms de nœuds cassent les références silencieusement.** Si vous renommez un nœud après avoir câblé `{{OldName.field}}` en aval, mettez à jour chaque référence. Regardez le journal d'exécution — si vous voyez le littéral `{{OldName.field}}` dans l'argument capturé, la recherche n'a pas été résolue.
- **Les secrets sont sensibles à la casse.** `{{variable.MyKey}}` et `{{variable.mykey}}` sont des variables différentes.
- **Les champs manquants sont vides.** Référencer `{{Foo.nonexistent}}` produit une chaîne vide, pas une erreur. Utile, mais cela peut masquer des bugs — utilisez un nœud **Conditions** pour affirmer la présence si le champ est requis pour l'étape suivante.

## Où lire ensuite

- [Composants](/docs/workflows/components) — le catalogue complet des noms de valeurs de retour.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — inspectez la valeur littérale de chaque argument interpolé après une exécution.
- [Configuration et sécurité](/docs/workflows/configuration) — ce qui est sûr à mettre dans une variable globale.
