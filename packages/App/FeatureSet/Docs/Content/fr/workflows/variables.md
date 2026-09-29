# Variables

Un workflow, c'est avant tout de la donnée qui circule — du déclencheur vers le premier bloc, d'un bloc au suivant, et de valeurs partagées vers tout endroit qui en a besoin. Les variables sont ce qui fait circuler cette donnée.

Il existe deux portées de variables, auxquelles s'ajoutent les sorties de composants produites pendant une exécution.

## Variables globales

Des valeurs à l'échelle du projet, enregistrées une fois et réutilisables partout. Pensez aux clés d'API, aux URL, aux noms de canaux — tout ce que vous ne voulez pas recopier dans dix workflows différents.

Vous les trouvez sous **Flux de travail → Variables globales**. Chacune comporte :

- **Nom** — la façon dont vous y ferez référence. Au moins deux caractères, pas d'espaces, et uniquement des lettres, des chiffres, des tirets et des tirets bas. `UPPER_SNAKE_CASE` est une bonne habitude, parce que la variable ressort au milieu de vos blocs.
- **Description** — facultative, du texte libre pour vous rappeler à quoi elle sert.
- **Secret** — quand c'est activé, la valeur est effacée des journaux d'exécution et des traces d'étapes.
- **Contenu** — la valeur elle-même. C'est un champ de texte long, les valeurs sur plusieurs lignes fonctionnent donc.

Utilisez une variable globale dans n'importe quel workflow avec :

```
{{global.variables.NAME}}
```

Par exemple, si vous avez enregistré votre clé PagerDuty sous `PAGERDUTY_KEY`, n'importe quel bloc peut l'utiliser via `{{global.variables.PAGERDUTY_KEY}}` — l'éditeur ne conserve que la référence, et la journalisation du workflow efface la valeur secrète une fois résolue.

Les variables se créent et se suppriment, elles ne se modifient pas. Il n'y a pas de bouton d'édition dans le tableau : pour changer une valeur depuis l'interface, vous supprimez la variable et vous la recréez — ou vous la mettez à jour via l'API, ce que couvre la fin de cette page. Les variables globales et de workflow font partie du plan Growth.

## Variables locales de workflow

Des variables limitées à un seul workflow, gérées sous **Variables de flux de travail** dans le menu de gauche de ce workflow. Vous y faites référence avec :

```
{{local.variables.NAME}}
```

## Sorties de composants (les données des blocs précédents)

Chaque déclencheur et chaque composant peut produire une sortie pendant une exécution. Utilisez le sélecteur de valeurs de composant dans l'éditeur pour créer la référence plutôt que de la taper : il insère exactement les identifiants que le runner attend.

Voici comment référencer la sortie d'un bloc antérieur :

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` est l'**Identifier** du bloc — l'identifiant court affiché dessus, pas le nom qui s'y lit. Les nouveaux blocs en reçoivent un du genre `api-get-1`, et vous pouvez le renommer dans la section **ID** du bloc. Le renommer casse toutes les références qui pointent déjà vers lui, exactement comme le renommage d'une variable. `FIELD_ID` est l'identifiant de la valeur de retour sélectionnée.

Quelques exemples :

- Après l'exécution d'un composant **API** dont l'ID est `lookup-user`, son code de statut est `{{local.components.lookup-user.returnValues.response-status}}` et son corps de réponse `{{local.components.lookup-user.returnValues.response-body}}`.
- Après un composant **Run Custom JavaScript** dont l'ID est `transform`, la valeur qu'il renvoie est `{{local.components.transform.returnValues.returnValue}}`.
- Les déclencheurs liés à un type d'enregistrement — **On Create Incident** et ses semblables — renvoient une seule valeur, `model`, dans laquelle vous descendez. Pour un déclencheur dont l'ID est `incident-on-create-1`, le titre de l'incident est `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Les variables locales n'existent que le temps de l'exécution en cours. Chaque nouvelle exécution repart de zéro.

## Où les variables fonctionnent

Presque tous les champs de texte acceptent des variables :

- L'URL d'un bloc API.
- Le texte du message sur Slack, Teams, Discord, Telegram, Email.
- L'objet et le corps d'un e-mail.
- Les en-têtes et les champs du corps de requête (à l'intérieur des valeurs de type chaîne).
- Les deux côtés d'un bloc **If / Else** (rangé dans la catégorie Conditions).

Dans un champ JSON, vous pouvez utiliser une variable à l'intérieur d'une valeur de type chaîne, mais pas comme clé. Une référence qui occupe une valeur entière à elle seule est substituée telle quelle : vous pouvez donc déposer un objet complet dans un champ JSON de cette façon. Si vous devez construire une structure dynamiquement, faites-la fabriquer par un bloc **Run Custom JavaScript**, puis passez sa sortie au bloc suivant.

Le bloc **Run Custom JavaScript** ne reçoit pas les variables automatiquement — rien n'est injecté dans le bac à sable. Mettez `{{global.variables.NAME}}` (ou n'importe quelle référence de composant) dans le champ JSON **Arguments** du bloc : ces valeurs sont substituées avant l'exécution du script et arrivent dans `args`.

## Boucler sur des tableaux

À l'intérieur d'un champ de texte, vous pouvez parcourir un tableau avec `{{#each path}}…{{/each}}`. Dans le bloc, `{{property}}` lit l'élément courant, `{{@index}}` donne la position à partir de 0, et `{{this}}` est l'élément lui-même pour les tableaux de valeurs simples. Les noms situés dans un bloc `{{#each}}` sont détourés, les espaces parasites y sont donc sans conséquence — contrairement à partout ailleurs.

## Exemples

### Construire une charge utile à partir d'un webhook

Un webhook arrive avec un corps du type `{ "service": "checkout", "status": "failed" }`. Pour en faire un incident OneUptime :

1. Un déclencheur **Webhook** dont l'id est `ci-webhook`.
2. Un bloc **If / Else** : sélectionnez la sortie Request Body du webhook et utilisez sa propriété `status`, l'opérateur `==`, et à droite `failed`.
3. Depuis la branche **Oui**, un bloc **Create One Incident** avec :
   - Titre : `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description : `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Utiliser un secret dans un appel d'API

Un workflow qui appelle PagerDuty :

1. Enregistrez `PAGERDUTY_KEY` comme variable globale secrète.
2. Sur le bloc **API**, donnez à l'en-tête `Authorization` la valeur `Token token={{global.variables.PAGERDUTY_KEY}}`.

La clé reste en dehors du workflow et des journaux.

### Enchaîner deux appels d'API

Le premier appel vous donne un ID dont le second a besoin :

1. Composant **API** `lookup-order` : utilisez le sélecteur pour insérer le champ e-mail du JSON du déclencheur manuel dans `GET /orders?email=...`.
2. Composant **API** `cancel-order` : `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Si `lookup-order` échoue, c'est sa sortie **Erreur** qui part, et non **Succès**. Reliez-la à un bloc Email ou Slack pour que les échecs ne passent pas inaperçus.

## Mettre à jour une variable depuis un workflow

Un cas classique est la rotation d'un identifiant selon une planification : vous récupérez un jeton frais auprès d'un tiers, puis vous le réécrivez dans la variable pour que l'exécution suivante le reprenne. Faites-le avec un bloc **API** qui appelle l'API OneUptime.

`PUT /api/workflow-variable/<variable-id>` avec un en-tête `ApiKey` et — c'est le point sur lequel tout le monde trébuche — les champs à modifier **enveloppés dans un objet `data`** :

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Un corps plat, sans l'enveloppe `data`, est rejeté avec un 400. N'envoyez que les champs que vous voulez réellement changer ; `name` et `description` peuvent rester en dehors de la charge utile.

La clé d'API a besoin de **Edit Workflow Variables**. Aucune permission de lecture n'est nécessaire — la mise à jour ne relit pas la ligne.

Deux points de vigilance :

- **Ne renommez pas une variable que vous référencez.** `name` fait partie de `{{local.variables.NAME}}`. Le changer laisse toutes les références existantes non résolues, et une référence non résolue est transmise telle quelle sous forme de texte — voir le piège ci-dessous.
- **Une variable peut être écrite ainsi, mais jamais relue.** `content` est en écriture seule via l'API, pour toutes les variables, secrètes ou non. C'est ce qui fait d'une variable un endroit sûr où garer un jeton en rotation. La marquer comme secrète tient en plus la valeur à l'écart des journaux d'exécution et des traces d'étapes.

## Pièges à éviter

- **Utilisez les sélecteurs.** Ils insèrent exactement les identifiants de composant, de valeur de retour et de variable que le runner attend, et gardent les références indépendantes des libellés affichés.
- **Les noms de variables sont sensibles à la casse.** `{{global.variables.MyKey}}` et `{{global.variables.mykey}}` sont deux choses différentes.
- **Une référence qui ne se résout pas est laissée telle quelle, pas vidée.** Renvoyer vers quelque chose qui n'existe pas n'est pas une erreur, et ne vous donne pas non plus une chaîne vide : les accolades passent en l'état, si bien que `{{local.components.api-get-1.returnValues.body}}` avec un identifiant d'étape mal tapé atterrit mot pour mot dans votre message Slack, votre URL ou votre corps de requête, et l'exécution se termine tout de même en **Executed**. Le journal d'exécution porte une ligne d'avertissement nommant chaque référence passée à travers les mailles.
- **Le constructeur ne peut pas vérifier les noms de variables.** Il signale les références de composant qu'il n'arrive pas à faire correspondre — identifiant d'étape inconnu, valeur de retour inconnue, racine mal formée — avant que vous n'enregistriez. Il ne peut pas savoir si une variable existe : une variable renommée n'est donc rattrapée que par le journal d'exécution.
- **Les espaces à l'intérieur des accolades ne sont pas supprimés.** `{{ local.variables.NAME }}` n'est pas la même recherche que `{{local.variables.NAME}}`, et ne se résout jamais. La seule exception se trouve à l'intérieur d'un bloc `{{#each}}`, où les noms sont détourés.

## Où lire ensuite

- [Composants de workflow](/docs/workflows/components) — la liste complète des sorties produites par chaque bloc.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — voir la valeur réelle de chaque variable après une exécution.
- [Configuration et sécurité des workflows](/docs/workflows/configuration) — ce qu'il est prudent de mettre dans une variable globale.
