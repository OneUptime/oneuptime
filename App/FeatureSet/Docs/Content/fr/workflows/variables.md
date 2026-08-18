# Variables

Les workflows consistent à faire circuler des données — du déclencheur vers le premier bloc, d'un bloc à l'autre, et des valeurs partagées vers tous les endroits où vous en avez besoin. Les variables sont la manière dont ces données se déplacent.

Il existe deux portées de variables, plus les sorties de composants produites au cours d'une exécution.

## Variables globales

Des valeurs à l'échelle du projet que vous enregistrez une fois et réutilisez partout. Pensez aux clés d'API, aux URL, aux noms de canaux — tout ce que vous ne voulez pas copier dans dix workflows différents.

Vous les trouverez sous **Flux de travail → Variables globales**. Chacune possède :

- **Name** — la façon dont vous y ferez référence. Au moins deux caractères, sans espaces, et uniquement des lettres, des chiffres, des tirets et des underscores. `UPPER_SNAKE_CASE` est une bonne habitude car cela ressort bien dans vos blocs.
- **Description** — optionnelle, texte libre pour vous rappeler à quoi elle sert.
- **Secret** — lorsqu'activé, la valeur est retirée des journaux d'exécution et des traces d'étapes.
- **Content** — la valeur réelle. C'est un champ de texte long, donc les valeurs multilignes fonctionnent.

Utilisez une variable globale dans n'importe quel workflow avec :

```
{{global.variables.NAME}}
```

Par exemple, si vous avez enregistré votre clé PagerDuty sous `PAGERDUTY_KEY`, n'importe quel bloc peut l'utiliser sous la forme `{{global.variables.PAGERDUTY_KEY}}` — l'éditeur stocke la référence, et la journalisation des workflows retire la valeur secrète résolue.

Les variables se créent et se suppriment, elles ne se modifient pas. Il n'y a pas de bouton de modification dans le tableau, donc pour changer une valeur dans l'interface, vous supprimez la variable et la recréez — ou vous la mettez à jour via l'API, ce qui est couvert à la fin de cette page. Les variables globales et de workflow sont une fonctionnalité du plan Growth.

## Variables locales de workflow

Des variables limitées à un seul workflow, gérées sous **Workflow Variables** dans le menu latéral de ce workflow. Faites-y référence avec :

```
{{local.variables.NAME}}
```

## Sorties de composants (données des blocs précédents)

Chaque déclencheur et chaque composant peut produire une sortie au cours d'une exécution. Utilisez le sélecteur de valeurs de composant dans l'éditeur pour créer la référence plutôt que de la taper — il insère exactement les identifiants attendus par le runner.

Faites référence à la sortie d'un bloc précédent ainsi :

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` est l'**Identifier** du bloc — le court identifiant affiché sur le bloc, pas le nom qui y est affiché. Les nouveaux blocs en reçoivent un comme `api-get-1`, et vous pouvez le renommer dans la section **ID** du bloc. Le renommer casse chaque référence qui pointait déjà vers lui, tout comme renommer une variable. `FIELD_ID` est l'identifiant de la valeur de retour sélectionnée.

Exemples :

- Après l'exécution d'un composant **API** dont l'ID est `lookup-user`, son code de statut est `{{local.components.lookup-user.returnValues.response-status}}` et son corps est `{{local.components.lookup-user.returnValues.response-body}}`.
- Après un composant **Run Custom JavaScript** dont l'ID est `transform`, sa valeur de retour est `{{local.components.transform.returnValues.returnValue}}`.
- Les déclencheurs pour un type d'enregistrement — **On Create Incident** et ses semblables — retournent exactement une valeur, `model`, dans laquelle vous naviguez. Pour un déclencheur dont l'ID est `incident-on-create-1`, le titre de l'incident est `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Les variables locales n'existent que pendant l'exécution en cours. Chaque nouvelle exécution repart de zéro.

## Où les variables fonctionnent

Presque tous les champs de texte acceptent les variables :

- L'URL d'un bloc API.
- Le texte du message dans Slack, Teams, Discord, Telegram, Email.
- L'objet et le corps d'un e-mail.
- Les champs d'en-têtes et de corps (à l'intérieur des valeurs de chaîne).
- Les deux côtés d'un bloc **If / Else** (listé sous la catégorie Conditions).

Dans les champs JSON, vous pouvez utiliser une variable à l'intérieur d'une valeur de chaîne, mais pas comme clé. Une référence qui occupe une valeur entière à elle seule est substituée telle quelle, ce qui vous permet d'insérer ainsi un objet entier dans un champ JSON. Si vous devez construire une structure dynamiquement, utilisez un bloc **Run Custom JavaScript** pour la construire, puis transmettez sa sortie au bloc suivant.

Le bloc **Run Custom JavaScript** ne reçoit pas les variables automatiquement — rien n'est injecté dans le bac à sable. Placez `{{global.variables.NAME}}` (ou n'importe quelle référence de composant) dans le champ JSON **Arguments** du bloc ; ces valeurs sont substituées avant l'exécution du script et arrivent sous forme d'`args`.

## Boucler sur des tableaux

À l'intérieur d'un champ de texte, vous pouvez itérer sur un tableau avec `{{#each path}}…{{/each}}`. À l'intérieur du bloc, `{{property}}` lit depuis l'élément courant, `{{@index}}` est la position en base 0, et `{{this}}` est l'élément lui-même pour les tableaux de valeurs simples. Les noms à l'intérieur d'un bloc `{{#each}}` sont épurés des espaces superflus, donc les espaces parasites y sont sans conséquence — contrairement à partout ailleurs.

## Exemples

### Construire une charge utile à partir d'un webhook

Un webhook arrive avec un corps comme `{ "service": "checkout", "status": "failed" }`. Pour en faire un incident OneUptime :

1. Déclencheur **Webhook** avec l'id `ci-webhook`.
2. Bloc **If / Else** : sélectionnez la sortie Request Body du webhook et utilisez sa propriété `status`, opérateur `==`, droite `failed`.
3. Depuis la branche **Yes**, un bloc **Create One Incident** avec :
   - Title : `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description : `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Utiliser un secret dans un appel API

Un workflow qui appelle PagerDuty :

1. Enregistrez `PAGERDUTY_KEY` comme variable globale secrète.
2. Sur le bloc **API**, définissez l'en-tête `Authorization` à `Token token={{global.variables.PAGERDUTY_KEY}}`.

La clé reste hors du workflow et des journaux.

### Enchaîner deux appels API

Le premier appel vous fournit un ID dont le second a besoin :

1. Composant **API** `lookup-order` : utilisez le sélecteur pour insérer le champ JSON email du déclencheur manuel dans `GET /orders?email=...`.
2. Composant **API** `cancel-order` : `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Si `lookup-order` échoue, sa sortie **Error** se déclenche au lieu de **Success**. Reliez-la à un bloc Email ou Slack pour que les échecs ne passent pas inaperçus.

## Mettre à jour une variable depuis un workflow

Un schéma courant consiste à faire pivoter un identifiant selon une planification : récupérer un nouveau jeton auprès d'un tiers, puis le stocker dans la variable pour que la prochaine exécution le récupère. Faites cela avec un bloc **API** appelant l'API OneUptime.

`PUT /api/workflow-variable/<variable-id>` avec un en-tête `ApiKey`, et — c'est le point qui piège les gens — les champs que vous voulez modifier **enveloppés dans un objet `data`** :

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Un corps plat sans l'enveloppe `data` est rejeté avec un 400. N'envoyez que les champs que vous voulez réellement modifier ; `name` et `description` peuvent rester hors de la charge utile.

La clé API a besoin de la permission **Edit Workflow Variables**. Aucune permission de lecture n'est requise — la mise à jour ne relit pas l'enregistrement.

Deux points à surveiller :

- **Ne renommez pas une variable que vous référencez.** `name` fait partie de `{{local.variables.NAME}}`. La renommer laisse chaque référence existante non résolue, et une référence non résolue est transmise telle quelle sous forme de texte littéral — voir le piège ci-dessous.
- **Une variable peut être écrite de cette façon mais jamais relue.** `content` est en écriture seule via l'API pour chaque variable, secrète ou non. C'est ce qui fait d'une variable un endroit sûr pour stocker un jeton en rotation. La marquer comme secrète retire en plus la valeur des journaux d'exécution et des traces d'étapes.

## Pièges à éviter

- **Utilisez les sélecteurs.** Ils insèrent exactement les identifiants de composant, de valeur de retour et de variable attendus par le runner, et gardent les références indépendantes des libellés affichés.
- **Les noms de variables sont sensibles à la casse.** `{{global.variables.MyKey}}` et `{{global.variables.mykey}}` sont différents.
- **Une référence qui ne se résout pas est laissée telle quelle, pas vidée.** Faire référence à quelque chose qui n'existe pas n'est pas une erreur, et cela ne vous donne pas non plus une chaîne vide : les accolades sont transmises telles quelles, donc `{{local.components.api-get-1.returnValues.body}}` avec un identifiant d'étape mal orthographié se retrouve tel quel dans votre message Slack, votre URL ou le corps de votre requête, et l'exécution est quand même signalée **Executed**. Le journal d'exécution porte une ligne d'avertissement nommant toute référence qui est passée à travers.
- **Le builder ne peut pas vérifier les noms de variables.** Il signale les références de composant qu'il ne peut pas faire correspondre — un identifiant d'étape inconnu, une valeur de retour inconnue, une racine malformée — avant l'enregistrement. Il ne peut pas savoir si une variable existe, donc une variable renommée n'est repérée que par le journal d'exécution.
- **Les espaces à l'intérieur des accolades ne sont pas retirés.** `{{ local.variables.NAME }}` est une recherche différente de `{{local.variables.NAME}}` et ne se résout jamais. La seule exception se trouve à l'intérieur d'un bloc `{{#each}}`, où les noms sont épurés des espaces.

## Pour aller plus loin

- [Composants de workflow](/docs/workflows/components) — la liste complète des sorties produites par chaque bloc.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — voir la valeur réelle de chaque variable après une exécution.
- [Configuration et sécurité des workflows](/docs/workflows/configuration) — ce qu'il est sûr de mettre dans une variable globale.
