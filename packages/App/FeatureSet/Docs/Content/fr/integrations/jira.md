# Intégration Jira

Ouvrez un ticket [Jira](https://www.atlassian.com/software/jira) chaque fois qu'un incident OneUptime est déclaré, gardez-le en phase à mesure que l'incident évolue, et laissez Jira renvoyer ses changements d'état dans OneUptime — le tout avec un [Workflow](/docs/workflows/index). Il n'y a aucun bloc spécifique à Jira à installer : OneUptime appelle l'API REST de Jira avec le [composant API](/docs/workflows/components#api), et Jira rappelle un [déclencheur Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Cette page construit les deux directions. Tout ce qui précède la section entrante est écrit pour **Jira Cloud** ; une section vers la fin liste ce qui change sur **Jira Data Center**.

> Atlassian renomme les choses dans Jira Cloud : un **project** est désormais un **space** dans une grande partie de l'interface, et une **issue** est un **work item**. Les tenants utilisent l'un ou l'autre vocabulaire, si bien que vous trouverez les deux ci-dessous là où la formulation compte.

## Prérequis

- Un site Jira Cloud (`https://your-domain.atlassian.net`) et un projet dans lequel créer des tickets. Notez sa **clé de projet** — le `OPS` de `OPS-1234`.
- Un compte Jira pouvant créer des tickets dans ce projet, et un **jeton d'API** pour ce compte depuis [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Utilisez un compte de service plutôt que celui d'une personne — les tickets créés de cette façon sont attribués au propriétaire du jeton.
- Le droit de créer des règles d'automatisation dans ce projet, pour la moitié entrante.
- Un projet OneUptime où vous pouvez créer des workflows et des variables globales.

## Étape 1 — Stocker les identifiants Jira comme secret

L'API REST de Jira Cloud attend une **Basic auth** construite à partir de l'adresse e-mail de votre compte Atlassian et d'un jeton d'API, encodés ensemble en base64.

1. Encodez `email:api_token` une seule fois :

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Utilisez `printf`, pas `echo`. `echo` ajoute un retour à la ligne, ce retour à la ligne est encodé avec le reste, et Jira répond `401` pour une raison invisible dans la chaîne que vous avez collée.

2. Dans OneUptime, allez dans **Flux de travail → Variables globales → Créer**. Nommez-la `JIRA_AUTH`, collez la chaîne base64 comme **Contenu**, et activez **Secret**.
3. Ajoutez une seconde variable, non secrète, `JIRA_URL` contenant `https://your-domain.atlassian.net` sans barre oblique finale.

N'importe quel bloc peut désormais utiliser `Basic {{global.variables.JIRA_AUTH}}` comme en-tête `Authorization`, et le jeton n'apparaît jamais dans le workflow ni dans ses journaux d'exécution. Voir [Variables](/docs/workflows/variables).

Deux choses à savoir sur les jetons d'API Atlassian, qui finiront par se rappeler à une intégration que plus personne ne surveille :

- **Ils expirent.** Les jetons sont créés avec une durée de vie d'un jour à un an, un an par défaut, et il n'existe aucun rafraîchissement — un jeton expiré doit être remplacé à la main sur la même page puis ré-encodé dans `JIRA_AUTH`. Notez la date d'expiration quelque part dans un agenda. Quand un workflow qui fonctionnait depuis des mois se met à répondre `401`, c'est la raison.
- **Un jeton à portées limitées demande une URL de base différente.** La page des jetons propose **Create API token with scopes** en plus du classique **Create API token**. Les jetons à portées sont le choix le plus sûr, mais ils ne s'adressent pas à votre site : ils vont vers `https://api.atlassian.com/ex/jira/<cloudId>`, si bien que `JIRA_URL` devient cette valeur, et tous les chemins ci-dessous s'y accrochent sans changer. Votre `cloudId` se trouve dans le JSON servi à `https://your-domain.atlassian.net/_edge/tenant_info`. Un jeton à portées envoyé à `your-domain.atlassian.net` échoue tout simplement.

Si votre organisation utilise la gestion centralisée des utilisateurs d'Atlassian, il existe une troisième option qui contourne le problème de l'expiration : un [identifiant OAuth 2.0 pour compte de service](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Il vous donne un identifiant client et un secret plutôt qu'un jeton, et un workflow les échange contre un jeton d'accès de courte durée au début de chaque exécution — exactement la même structure à deux blocs que celle de la page [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365), avec un bloc **API Post (JSON)** qui récupère le jeton et tout ce qui suit envoyant `Bearer <token>`. Rien n'aura à être remplacé à la main un an plus tard. La page d'Atlassian donne la requête de jeton exacte ; l'URL de base de l'API est `https://api.atlassian.com`.

## Étape 2 — Ouvrir un ticket Jira pour chaque incident

1. Ouvrez **Flux de travail → Créer un flux de travail**, nommez-le `Incidents → Jira`, et ouvrez le **Constructeur**.
2. Cliquez sur le bloc en pointillés et ajoutez le déclencheur **On Create Incident**. Dans son champ **Select Fields**, demandez les colonnes que vous voulez envoyer :

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Laissez son **Identifier** sur `incident-on-create-1` — c'est le nom sous lequel les blocs suivants y feront référence.

3. Cliquez sur **Ajouter un composant**, ajoutez un bloc **API Post (JSON)**, et tirez un trait depuis le point **Succès** du déclencheur vers le point d'entrée du nouveau bloc. Ouvrez-le, réglez son **Identifier** sur `create-issue`, et remplissez :

   - **URL** : `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers** :

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body** :

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Remplacez `OPS` par votre clé de projet et `Bug` par un type de ticket qui existe dans ce projet. Les deux peuvent aussi être donnés par identifiant — `{"id": "10000"}` — ce qu'utilisent les propres exemples d'Atlassian et ce que vous devriez préférer si deux types de tickets de votre site portent le même nom. Les appels `createmeta` décrits plus bas vous donnent ces identifiants.

La description paraît lourde parce que l'API v3 de Jira Cloud attend le texte enrichi au format **Atlassian Document Format** — un arbre de document, pas une chaîne. La forme ci-dessus est le document valide minimal : un paragraphe contenant un nœud de texte. Il en va de même pour `environment` et pour tout champ personnalisé de texte multiligne ; les champs personnalisés de texte sur une seule ligne acceptent encore une chaîne simple.

Activez maintenant le workflow depuis **Vue d'ensemble → Modifier le flux de travail → Activé**, déclarez un incident de test, et ouvrez **Exécutions & journaux**. Le bloc `create-issue` devrait afficher un `201` et un corps contenant l'`id`, la `key` et le `self` du nouveau ticket. Les modifications faites sur le canevas s'enregistrent d'elles-mêmes — il n'y a pas de bouton Enregistrer, et un workflow désactivé ne peut pas s'exécuter du tout, pas même à la main.

La clé du nouveau ticket est disponible pour tout bloc situé après celui-ci :

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Renseigner d'autres champs

Quelques ajouts courants à l'intérieur de `fields` :

- **Priority** — `"priority": { "id": "20000" }`, avec un identifiant de priorité de votre site. Pour associer les gravités OneUptime aux priorités Jira, placez un bloc **If / Else** entre le déclencheur et le bloc API et créez un embranchement sur `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Assignee** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifie les personnes par leur identifiant de compte Atlassian ; `username` et `userKey` ont été retirés de l'API Cloud il y a des années.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, un tableau plat de chaînes. Les labels ne peuvent pas contenir d'espaces.
- **Components** — `"components": [{ "id": "10000" }]`.
- **Champs personnalisés** — `"customfield_10034": "..."`, avec l'identifiant propre au champ. La forme de la valeur suit le type du champ : une liste à choix unique attend `{"value": "red"}`, une liste à choix multiple un tableau d'identifiants, un champ de texte multiligne un document Atlassian Document Format.

Pour découvrir ce qu'un projet exige réellement, demandez-le à Jira plutôt que de le deviner. Listez les types de tickets d'un projet, puis les champs de l'un d'eux :

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

Le second appel liste tous les champs acceptés par ce type de ticket, lesquels sont obligatoires, et les identifiants `customfield_NNNNN` exacts. Pour lire les identifiants sur un ticket que vous avez déjà, récupérez-le avec `?expand=names`.

## Étape 3 — Emporter l'id de l'incident dans Jira

Les deux moitiés d'une synchronisation bidirectionnelle ont besoin qu'un système conserve l'identifiant de l'autre, et Jira est le meilleur endroit pour le garder : la colonne `customFields` de OneUptime est un unique blob JSON, si bien qu'y écrire une valeur depuis un workflow remplace tous les champs personnalisés de cet incident.

**Avec un administrateur Jira.** Ajoutez un champ personnalisé de texte court — appelez-le *OneUptime Incident ID* — à l'écran de création du projet, trouvez son identifiant avec `createmeta`, et renseignez-le en même temps que le reste :

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Sans administrateur.** Mettez-le dans un label à la place. Les labels n'acceptent pas d'espaces, et un id OneUptime est un simple UUID, donc `oneuptime-<id>` est un label valide :

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

Le workflow entrant devra alors extraire ce label de la liste, ce qui représente deux ou trois lignes dans un bloc **Run Custom JavaScript**. Le champ personnalisé est plus propre si vous pouvez en obtenir un.

Tant que vous y êtes, il vaut la peine d'ajouter sur le ticket Jira un lien vers l'incident. Un bloc **API Post (JSON)** après `create-issue`, pointé vers `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, avec :

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

donne à tout le monde dans Jira un chemin de retour en un clic. Ajoutez `projectId` au **Select Fields** du déclencheur pour cela. Le `globalId` est ce qui rend l'appel sûr à répéter : Jira met à jour le lien qui porte déjà cet identifiant au lieu d'en ajouter un second. Comme une mise à jour vide aussi tout ce que vous omettez, envoyez toujours l'`object` entier, pas un correctif partiel.

## Étape 4 — Commenter et faire transiter le ticket à mesure que l'incident évolue

Construisez ceci comme un **second** workflow, pour qu'un échec ici n'empêche jamais l'ouverture des tickets.

1. **Créer un flux de travail**, nommez-le `Incident updates → Jira`, et ajoutez le déclencheur **On Update Incident**.
2. Dans **Listen on**, mettez `{"currentIncidentStateId": true}`. Le déclencheur ne se déclenche alors que pour les changements d'état, et non à chaque modification. Dans **Select Fields**, demandez `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Ajoutez un bloc **If / Else** : **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — ou le nom que porte l'état résolu dans votre projet. Voir [États et sévérités des incidents](/docs/incidents/states-and-severities).

Depuis la branche **Oui**, il faut d'abord retrouver le ticket ouvert à l'Étape 2. Demandez-le à Jira par l'id que vous avez stocké à l'Étape 3, avec un bloc **API Post (JSON)** dont l'**Identifier** est `find-issue` :

- **URL** : `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body** :

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Si vous avez utilisé un champ personnalisé plutôt qu'un label, la clause devient `cf[10050] ~ \"...\"` avec votre propre identifiant de champ.

L'id du ticket est alors `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, et tous les points de terminaison ci-dessous acceptent un id aussi volontiers qu'une clé.

Trois choses méritent d'être connues à propos de ce point de terminaison. **Postez le JQL, ne le mettez pas dans l'URL** — une chaîne de requête contenant un `=` à l'intérieur d'une valeur est tronquée en sortant d'un workflow, et le JQL n'est fait que de signes `=`. **La requête doit être bornée** : un simple `order by key desc` est rejeté par un `400`, d'où la présence de la clause `project =`. Et `/rest/api/3/search/jql` est le point de terminaison actuel — l'ancien `/rest/api/3/search` est déprécié et en fin de vie, ne l'utilisez donc pas.

**Laisser un commentaire** tient dans un seul bloc **API Post (JSON)** vers `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, avec un corps au format Atlassian Document Format comme pour la description :

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Faire transiter le ticket** demande deux appels, parce qu'une transition est identifiée par un identifiant qui diffère d'un workflow Jira à l'autre et, sur certains tableaux, d'un ticket à l'autre.

1. Un bloc **API Get (JSON)** sur `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` renvoie les transitions disponibles *depuis le statut actuel du ticket*, chacune avec un `id` et un `name`, ainsi qu'un objet `to` nommant le statut auquel elle mène.
2. Un bloc **API Post (JSON)** vers la même URL en exécute une :

   ```json
   { "transition": { "id": "31" } }
   ```

Une transition réussie répond `204` sans corps. Si vous préférez ne pas lire la liste à l'exécution, appelez-la une fois à la main pour un ticket dans le bon statut et codez l'identifiant en dur — souvenez-vous simplement qu'il est lié à ce workflow Jira, si bien qu'un administrateur qui le modifie peut casser le vôtre en silence.

## Entrant — de Jira vers OneUptime

Maintenant l'autre direction : quelqu'un fait passer le ticket à Done, et l'incident OneUptime doit suivre.

### Construire d'abord le workflow récepteur

1. **Créer un flux de travail**, nommez-le `Jira → OneUptime`, et ajoutez le déclencheur **Webhook**.
2. Ouvrez les **Paramètres** de ce workflow et copiez la **clé secrète du webhook**. Votre URL est :

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Les installations auto-hébergées utilisent leur propre hôte. Traitez cette URL comme un mot de passe — quiconque la possède peut démarrer le workflow — et régénérez la clé depuis cette même page en cas de fuite.

3. Ajoutez un bloc **If / Else** qui vérifie un secret partagé avant que quoi que ce soit d'autre ne s'exécute. **Input 1** est `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** est `{{global.variables.JIRA_WEBHOOK_SECRET}}` — une valeur que vous inventez et enregistrez comme variable globale secrète.
4. Depuis la branche **Oui**, ajoutez un bloc **Update One Incident** :

   - **Query** : `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)** : ce que le changement côté Jira doit signifier ici — en général un changement d'état.

   Déplacer un incident demande l'id de l'état cible, qu'un bloc **Find One Incident State** avec la requête `{"name": "Resolved"}` vous donnera sous la forme `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Écrivez-le dans `currentIncidentStateId`.

Laissez le workflow activé. Il reste à donner à Jira quelque chose à appeler.

### Envoyer l'événement depuis une règle d'automatisation Jira

1. Dans Jira, ouvrez les règles d'automatisation du projet : **Space settings → Automation** sur les tenants récents, **Project settings → Automation** sur les plus anciens. Pour une règle couvrant plusieurs projets, utilisez **Settings → System → Global automation**, ce qui exige la permission globale *Administer Jira*.
2. **Create rule**, puis choisissez le déclencheur **Work item transitioned** — **Issue transitioned** sur les tenants plus anciens. Réglez-le pour qu'il s'exécute quand le statut passe *vers* **Done**.

   Utilisez ce déclencheur, pas *Work item updated* : le déclencheur de mise à jour exclut délibérément les changements de statut.

3. Ajoutez l'action **Send web request** (envoyer une requête web) et configurez-la :

   - **Web request URL** : l'URL de webhook OneUptime obtenue plus haut.
   - **HTTP method** : `POST`
   - **Headers** : `Content-Type` / `application/json`, et `X-OneUptime-Secret` / votre secret partagé. Utilisez l'option **Hide** sur la valeur du secret pour que les autres éditeurs de la règle ne puissent pas la lire — notez que le masquage est irréversible pour cette valeur, et que les valeurs masquées sont perdues si la règle est exportée ou dupliquée.
   - **Web request body** : **Custom format**, pour que vous contrôliez la forme :

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Si vous avez utilisé un label plutôt qu'un champ personnalisé à l'Étape 3, envoyez `"labels": "{{issue.labels}}"` et extrayez l'id avec un bloc **Run Custom JavaScript** côté OneUptime.

4. Activez la règle, faites passer un ticket de test à Done, et vérifiez des deux côtés : le journal d'audit de la règle dans Jira, et **Exécutions & journaux** dans OneUptime.

Ce qu'il faut savoir avant de compter sur ce mécanisme :

- **Le port de destination est restreint.** Send web request n'atteint que les ports 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 et 9900. OneUptime Cloud est sur le 443 ; une installation auto-hébergée sur un port inhabituel ne peut pas être appelée de cette façon.
- **Il n'y a pas de signature de requête.** L'action n'offre aucune option HMAC : un secret partagé dans un en-tête sur HTTPS est donc le mécanisme documenté par Atlassian. La vérification **If / Else** de l'étape 3 du workflow récepteur est ce qui lui donne sa valeur.
- **Les exécutions de règles sont comptabilisées.** Jira Cloud décompte les exécutions de règles réussies d'un quota mensuel qui dépend de votre plan — 100 sur Free, 1 700 sur Standard, 1 000 × utilisateurs sur Premium, illimité sur Enterprise. Une règle qui se déclenche à chaque transition dans un projet chargé finit par peser.
- **Les valeurs ne sont pas encodées pour l'URL** à votre place. Cela ne compte que si vous envoyez un corps encodé en formulaire ; le JSON ci-dessus ne pose pas de problème.
- **Atlassian publie ses plages de sortie** sur [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) si votre installation OneUptime est derrière une liste d'autorisation. Elles changent : interrogez le flux plutôt que de figer des adresses.

### Ou bien utiliser un webhook Jira

Un administrateur Jira peut enregistrer un webhook directement sous **Settings → System → Advanced → WebHooks**, en choisissant les événements à envoyer et, éventuellement, une requête JQL qui restreint les tickets concernés. Comparé à une règle d'automatisation :

- La charge utile est celle de Jira, pas la vôtre : `webhookEvent`, `issue_event_type_name`, l'`issue` complète, et un `changelog` dont le tableau `items` contient l'avant et l'après de chaque champ modifié. Pour un changement de statut, c'est l'entrée dont le `field` vaut `status` qui vous intéresse. La lire dans un workflow demande en général un bloc **Run Custom JavaScript**.
- Les webhooks **peuvent** être signés — donnez un secret au webhook et Jira envoie un en-tête `X-Hub-Signature` contenant un HMAC du corps de la requête — mais un workflow ne peut pas le vérifier. La signature couvre les octets exacts envoyés par Jira, or le déclencheur Webhook remet au workflow un corps déjà analysé en JSON : il ne reste plus rien à hacher. Si vous voulez authentifier la requête, utilisez plutôt une règle d'automatisation avec un en-tête à secret partagé.
- L'URL doit être en HTTPS sur un port issu de la liste propre à Jira, qui n'est *pas* la même que celle utilisée par l'action d'automatisation — le port 80 n'est pas autorisé ici.
- La remise est réessayée jusqu'à cinq fois avec un délai de cinq à quinze minutes : votre workflow doit donc tolérer de recevoir deux fois le même événement.

Les webhooks enregistrés par une application via `/rest/api/3/webhook` sont encore autre chose : ils expirent 30 jours après leur enregistrement s'ils ne sont pas rafraîchis. Ceux enregistrés par un administrateur, ci-dessus, n'expirent pas.

## Jira Data Center

Jira auto-géré fonctionne de la même façon, à quelques substitutions près. **Jira Server** a atteint sa fin de support en février 2024 et ne reçoit plus de correctifs : considérez donc Data Center comme la cible auto-gérée.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — il n'y a pas de v3 sur Data Center                        |
| `description` sous forme de document Atlassian Document Format | `description` sous forme de chaîne simple en wiki markup         |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| Jeton d'API depuis id.atlassian.com               | **Profile → Personal access tokens → Create token** sur votre propre compte Jira |
| Action d'automatisation **Send web request**      | Action d'automatisation **Send outgoing web request**                        |

Le bloc de création de ticket devient donc un `POST` vers `/rest/api/2/issue` avec :

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

ce qui est plus simple à modéliser — pas d'arbre de document.

Autres différences à prévoir :

- **Les personal access tokens** existent depuis Jira Core et Jira Software 8.14 et Jira Service Management 4.15. Ils expirent — 365 jours par défaut — et l'interface signale un jeton comme *Expires soon* cinq jours avant. La Basic auth avec un nom d'utilisateur et un mot de passe fonctionne toujours sur Data Center, mais quelques échecs de connexion déclenchent un CAPTCHA qui bloque entièrement le compte hors de l'API REST jusqu'à ce qu'un humain le débloque dans un navigateur, ce qui est une mauvaise façon de découvrir une faute de frappe. Préférez un jeton.
- **L'automatisation est intégrée** depuis Jira Data Center 10.0. Avant cela, il s'agissait de l'application Automation for Jira à installer séparément. Sa requête sortante a un délai d'expiration par défaut de 3000 ms, réglable avec la propriété `outgoing.webhook.timeout.ms`.
- **Les webhooks** s'enregistrent sous **Administration → System → Advanced → WebHooks**, et le filtrage JQL est pris en charge. Gardez ces filtres étroits : Jira évalue le JQL de chaque webhook enregistré sur le fil d'exécution qui a levé l'événement, si bien qu'une douzaine de filtres larges ralentissent l'action utilisateur qui les a déclenchés.
- **Depuis Data Center 10.0, la remise des webhooks est asynchrone** et il n'existe pas d'option synchrone : les événements peuvent donc arriver dans le désordre. Rendez le workflow récepteur idempotent.
- **Jira 10 a supprimé le `$` dans les variables d'URL de webhook** — `${issue.id}` est devenu `{issue.id}` — et a déplacé la ressource REST des webhooks de `/rest/webhooks/1.0/webhook` vers `/rest/jira-webhook/1.0/webhooks`.

## Faire la même chose pour les alertes

Tout ce qui précède est écrit autour des incidents parce que c'est le cas le plus courant, mais les alertes fonctionnent à l'identique — changez le type d'enregistrement et rien d'autre ne bouge :

| Incident                                 | Alerte                                      |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Un workflow n'a qu'un seul déclencheur : incidents et alertes demandent donc un workflow chacun. Si les deux devaient faire le même travail, construisez la moitié Jira une seule fois et appelez-la depuis les deux avec le composant **Execute Workflow**.

## Dépannage

Ouvrez d'abord le bloc en échec dans **Exécutions & journaux**. Jira renvoie un corps JSON nommant exactement ce qu'il a rejeté, et le composant API le conserve dans `response-body`.

**`401 Unauthorized`.** Ré-encodez `email:api_token` avec `printf` et mettez `JIRA_AUTH` à jour ; un retour à la ligne final laissé par `echo` en est la cause habituelle. Confirmez ensuite que le compte propriétaire du jeton peut créer des tickets dans ce projet. Sur Data Center, vérifiez que vous envoyez `Bearer`, et non `Basic`.

**`400 Bad Request` nommant un champ.** Le type de ticket n'existe pas dans le projet, ou le projet a un champ obligatoire que vous n'envoyez pas. Exécutez les appels `createmeta` ci-dessus sur ce projet et ce type de ticket, puis comparez.

**`400` se plaignant de `description`.** Sur Cloud v3, la description doit être un document Atlassian Document Format, pas une chaîne. Envoyez soit le document montré plus haut, soit basculez ce bloc sur `/rest/api/2/issue` et envoyez du texte brut.

**`404 Not Found`.** Vérifiez l'URL de base et la version de l'API — `/rest/api/3/...` sur Cloud, `/rest/api/2/...` sur Data Center.

**`429 Too Many Requests`.** Jira limite le débit. La réponse porte un `Retry-After` en secondes et un `RateLimit-Reason` nommant la limite atteinte. Les écritures sur un même ticket sont plafonnées de façon serrée — de l'ordre de vingt en deux secondes — si bien qu'un workflow qui commente puis fait transiter en succession rapide peut la déclencher sur un seul ticket. Placez un bloc **Delay** entre les appels, ou déplacez le travail en masse vers un workflow planifié.

**L'appel de transition renvoie `400`.** L'identifiant de transition n'est pas valide depuis le statut *actuel* du ticket. Récupérez `/transitions` pour ce ticket et utilisez un identifiant issu de la réponse.

**La règle d'automatisation apparaît comme réussie mais rien n'arrive dans OneUptime.** Vérifiez d'abord le port — voir la liste restreinte ci-dessus. Envoyez ensuite vous-même une requête à l'URL de webhook avec `curl` et regardez si elle apparaît dans **Exécutions & journaux** ; si la vôtre arrive et pas celle de Jira, le problème est du côté de Jira.

**Le workflow s'exécute mais l'incident ne change pas.** Un bloc **Update One Incident** rapporte `Items Updated: 0` quand sa requête n'a rien trouvé, et cela compte comme un succès, pas comme une erreur. Vérifiez que l'id présent dans la charge utile est bien l'id de l'incident OneUptime et que vous interrogez `_id`.

**Une référence `{{...}}` apparaît littéralement dans un ticket Jira.** Une référence non résolue est transmise telle quelle sous forme de texte plutôt que vidée. Le journal d'exécution nomme toute référence qui n'a pas été résolue — en général un identifiant de bloc mal saisi ou une variable renommée.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas entrant et sortant, et l'aide-mémoire d'authentification.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — la même construction bidirectionnelle avec Dynamics.
- [Présentation des workflows](/docs/workflows/index) et [Créer un workflow](/docs/workflows/authoring) — le canevas, les identifiants, et l'activation d'un workflow.
- [Composants](/docs/workflows/components) — les blocs API, If / Else, et les composants de données OneUptime.
- [Variables](/docs/workflows/variables) — les secrets, et la lecture de la sortie d'un bloc depuis le suivant.
- [Configuration et sécurité](/docs/workflows/configuration) — la sécurité des webhooks et l'accès réseau sortant.
- [ServiceNow](/docs/integrations/servicenow) et [PagerDuty](/docs/integrations/pagerduty) — le même schéma sortant pour d'autres outils.
