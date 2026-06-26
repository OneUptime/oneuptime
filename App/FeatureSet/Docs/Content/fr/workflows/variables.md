# Variables

Les workflows consistent à faire circuler des données — du déclencheur vers le premier bloc, d'un bloc à l'autre et de valeurs partagées vers tous les endroits où vous en avez besoin. Les variables sont la manière dont ces données se déplacent.

Il en existe deux types, et ils partagent la même syntaxe.

## Variables globales

Des valeurs à l'échelle du projet que vous enregistrez une fois et réutilisez partout. Pensez aux clés d'API, aux URL, aux noms de canaux — tout ce que vous ne voulez pas copier dans dix workflows différents.

Vous les trouverez sous **Workflows → Global Variables**. Chacune possède :

- **Name** — la façon dont vous y ferez référence. Utilisez `UPPER_SNAKE_CASE` pour qu'elle se distingue bien dans vos blocs.
- **Value** — la valeur réelle. Les valeurs multilignes fonctionnent aussi.
- **Is Secret** — lorsqu'activé, la valeur est masquée dans l'interface après enregistrement et masquée dans les journaux d'exécution.

Utilisez une variable globale dans n'importe quel workflow avec :

```
{{variable.NAME}}
```

Par exemple, si vous avez enregistré votre clé PagerDuty sous `PAGERDUTY_KEY`, n'importe quel bloc peut l'utiliser avec `{{variable.PAGERDUTY_KEY}}` — la véritable clé n'apparaît jamais dans le workflow ni dans ses journaux.

## Variables locales (données des blocs précédents)

Les variables locales sont la sortie des blocs qui se sont déjà exécutés au cours de cette exécution. Chaque déclencheur et chaque composant produit une sortie que vous pouvez lire.

Faites référence à la sortie d'un bloc précédent ainsi :

```
{{BlockName.fieldName}}
```

`BlockName` est le nom du déclencheur ou du composant sur le canevas (vous pouvez le renommer pour quelque chose de court et clair). `fieldName` est ce que ce bloc produit.

Exemples :

- Après l'exécution d'un bloc **API** nommé `LookupUser`, vous pouvez lire le code de statut avec `{{LookupUser.response-status}}` et le corps avec `{{LookupUser.response-body}}`.
- Après un déclencheur **Incident → On Create** nommé `Incident`, vous pouvez lire `{{Incident.title}}`, `{{Incident.description}}` et tout autre champ de l'incident.
- Après un bloc **Custom Code** nommé `Transform`, la valeur retournée se trouve dans `{{Transform.value}}`.

Les variables locales n'existent que pendant l'exécution en cours. Chaque nouvelle exécution part de zéro.

## Où fonctionnent les variables

Presque tous les champs de texte acceptent les variables :

- L'URL d'un bloc API.
- Le texte du message dans Slack, Teams, Discord, Telegram, Email.
- L'objet et le corps d'un e-mail.
- Les champs d'en-têtes et de corps (à l'intérieur des valeurs de chaîne).
- Les deux côtés d'un bloc Conditions.

Les champs JSON purs acceptent les variables à l'intérieur des valeurs de chaîne, mais vous ne pouvez pas utiliser une variable comme clé. Si vous devez construire une structure dynamiquement, utilisez un bloc **Custom Code** pour la construire, puis transmettez sa sortie au bloc suivant.

Le bloc **Custom Code** lit les variables différemment — les variables globales arrivent dans `args.variables`, et vous décidez quelles sorties précédentes passer en arguments.

## Exemples

### Construire une charge utile à partir d'un webhook

Un webhook arrive avec un corps comme `{ "service": "checkout", "status": "failed" }`. Pour en faire un incident OneUptime :

1. Déclencheur **Webhook** nommé `CIWebhook`.
2. Bloc **Conditions** : gauche `{{CIWebhook.Request Body.status}}`, opérateur `==`, droite `failed`.
3. Depuis la branche **Yes**, un bloc **Create Incident** avec :
   - Title : `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description : `See {{CIWebhook.Request Body.url}} for the logs.`

### Utiliser un secret dans un appel API

Un workflow qui appelle PagerDuty :

1. Enregistrez `PAGERDUTY_KEY` comme variable globale secrète.
2. Sur le bloc **API**, définissez l'en-tête `Authorization` à `Token token={{variable.PAGERDUTY_KEY}}`.

La clé reste hors du workflow et des journaux.

### Enchaîner deux appels API

Le premier appel vous fournit un identifiant dont le second a besoin :

1. Bloc **API** `LookupOrder` : `GET /orders?email={{Manual.JSON.email}}`.
2. Bloc **API** `CancelOrder` : `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Si `LookupOrder` échoue, sa sortie **error** se déclenche au lieu de **success**. Reliez-la à un bloc Email ou Slack pour que les échecs ne passent pas inaperçus.

## Pièges à éviter

- **Renommer un bloc casse les références.** Si vous renommez un bloc, mettez à jour tous les endroits où il est utilisé. Dans le journal d'exécution, une référence non résolue apparaît sous forme du texte littéral `{{BlockName.field}}`.
- **Les noms de variables sont sensibles à la casse.** `{{variable.MyKey}}` et `{{variable.mykey}}` sont différents.
- **Les champs manquants deviennent vides.** Faire référence à un champ qui n'existe pas vous donne une chaîne vide, et non une erreur. Pratique — mais cela peut masquer des bogues. Utilisez un bloc **Conditions** pour vérifier les champs importants avant de continuer.

## Pour aller plus loin

- [Composants](/docs/workflows/components) — la liste complète des sorties produites par chaque bloc.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — voir la valeur réelle de chaque variable après une exécution.
- [Configuration et sécurité](/docs/workflows/configuration) — ce qu'il est sûr de mettre dans une variable globale.
