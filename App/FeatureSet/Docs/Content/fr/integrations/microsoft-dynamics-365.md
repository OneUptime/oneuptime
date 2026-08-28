# Intégration Microsoft Dynamics 365

Ouvrez un **Case** dans [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) chaque fois qu'un incident OneUptime est déclaré, gardez ce case en phase à mesure que l'incident évolue, et laissez Dynamics renvoyer les changements du case dans OneUptime — le tout avec un [Workflow](/docs/workflows/index). Il n'y a aucun bloc spécifique à Dynamics à installer : OneUptime dialogue avec la **Dataverse Web API** grâce au [composant API](/docs/workflows/components#api), et Dynamics répond via un [déclencheur Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Cette page couvre les deux directions. Construisez d'abord la moitié sortante — c'est celle qui demande la configuration Microsoft Entra ID, et une fois qu'elle fonctionne, la moitié entrante tient en un seul flux.

## Prérequis

- Un environnement **Dynamics 365** contenant la table **Case**. Les cases viennent de Dynamics 365 Customer Service ; un environnement Dataverse sans lui n'a pas de table `incident` où écrire.
- Le **Web API endpoint** de l'environnement. Trouvez-le dans le [Power Platform admin center](https://admin.powerplatform.microsoft.com/) sous les **Settings → Developer resources** de votre environnement, ou dans **make.powerapps.com → Settings → Developer resources**. Il ressemble à `https://yourorg.crm.dynamics.com/api/data/v9.2/` — le segment de région varie (`crm` pour l'Amérique du Nord, `crm2` pour l'Amérique du Sud, `crm7` pour le Japon, et ainsi de suite).
- Le droit d'enregistrer une application dans **Microsoft Entra ID** et de créer un **application user** dans l'environnement Dynamics. Ce sont généralement deux administrateurs différents.
- Un projet OneUptime où vous pouvez créer des workflows et des variables globales.

> Tout ce qui suit utilise les noms de tables Dataverse, pas les libellés affichés sur les formulaires Dynamics. Un case, c'est la table **`incident`**, sa collection dans une URL est **`incidents`**, sa clé primaire est **`incidentid`**, et sa colonne de titre est **`title`**. Le numéro de case visible dans l'interface est **`ticketnumber`**.

## Étape 1 — Enregistrer une application dans Microsoft Entra ID

OneUptime s'authentifie en tant qu'application, pas en tant que personne : il utilise donc le flux OAuth 2.0 **client credentials**.

1. Connectez-vous au [portail Azure](https://portal.azure.com) en tant qu'administrateur du même tenant que votre environnement Dynamics, et ouvrez **Microsoft Entra ID**.
2. Allez dans **App registrations → New registration**. Donnez-lui un nom tel que `OneUptime Integration`, laissez **Supported account types** sur **Accounts in this organizational directory only**, et sélectionnez **Register**.
3. Depuis la page **Overview** de l'application, copiez l'**Application (client) ID** et le **Directory (tenant) ID**.
4. Allez dans **Certificates & secrets → Client secrets → New client secret**. Copiez la **Value** du secret — pas son ID — avant de quitter la page. Elle n'est plus jamais affichée. Un client secret vit au plus 24 mois : notez donc son expiration là où vous la reverrez.

Deux choses que l'on ajoute ici et dont vous n'avez pas besoin :

- **Aucune API permission.** Dans le flux client credentials il n'y a pas d'utilisateur connecté : les permissions déléguées ne servent donc à rien. `user_impersonation` sous **Dataverse** est une permission déléguée, réservée aux applications interactives. Microsoft Entra ID émettra volontiers un jeton pour Dataverse sans aucune permission configurée — l'accès se décide côté Dynamics, à l'Étape 2.
- **Aucune étape de consentement administrateur.** Pour la même raison.

Microsoft préfère un certificat à un client secret pour les applications de production. Cette option exige que l'appelant construise et signe lui-même une assertion JWT, ce qu'un workflow ne sait pas faire : le client secret est donc le choix pratique ici — traitez-le en conséquence, gardez-le dans une variable secrète et faites-le tourner avant son expiration.

## Étape 2 — Créer l'application user dans Dynamics

C'est l'étape que l'on saute, et la sauter produit l'échec le plus déroutant de toute cette intégration : la demande de jeton réussit, puis chaque appel Dataverse échoue avec un `403 Forbidden` et le code d'erreur `0x80072560` — *« The user isn't a member of the organization. »* Entra ID émet le jeton sans rien savoir de Dynamics ; Dynamics cherche ensuite une ligne utilisateur correspondant à l'application, et il n'y en a pas.

1. Ouvrez le [Power Platform admin center](https://admin.powerplatform.microsoft.com/) et sélectionnez **Manage → Environments**, puis votre environnement.
2. Sélectionnez **Settings → Users + permissions → Application users**.
3. Sélectionnez **+ New app user**, puis **+ Add an app**, choisissez l'enregistrement de l'Étape 1, et sélectionnez **Add**.
4. Choisissez une **Business unit**, saisissez une **Email address**, puis utilisez l'icône de modification à côté de **Security roles**.
5. Affectez un rôle de sécurité **personnalisé** disposant des privilèges de création, de lecture et d'écriture sur la table **Case**. Un application user ne peut pas recevoir l'un des rôles intégrés — Microsoft exige un rôle personnalisé. Si vous n'avez pas de rôle approprié, copiez-en un existant et allégez-le.
6. Sélectionnez **Save**, puis **Create**.

Vous ne pouvez avoir qu'un seul application user par application enregistrée dans un environnement. Les application users ne consomment pas de licence et échappent aux règles d'appartenance aux groupes de sécurité de l'environnement.

## Étape 3 — Stocker les identifiants dans OneUptime

Allez dans **Flux de travail → Variables globales → Créer** et ajoutez ceci, en activant **Secret** pour les entrées indiquées :

| Nom                      | Valeur                                                      | Secret |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | Le Directory (tenant) ID de l'Étape 1                       | Non    |
| `DYNAMICS_CLIENT_ID`     | L'Application (client) ID de l'Étape 1                      | Non    |
| `DYNAMICS_CLIENT_SECRET` | La **Value** du client secret de l'Étape 1                  | Oui    |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — sans barre oblique finale | Non  |

Collez le client secret exactement tel qu'Entra ID vous l'a donné. OneUptime encode le corps de formulaire pour vous : ne l'encodez donc pas en URL à la main.

Référencez n'importe laquelle d'entre elles depuis un bloc avec `{{global.variables.DYNAMICS_CLIENT_ID}}`. Voir [Variables](/docs/workflows/variables) pour la façon dont les secrets sont effacés des journaux d'exécution.

## Étape 4 — Obtenir un jeton d'accès

Chaque exécution récupère son propre jeton. Les jetons durent 60 à 90 minutes et le flux client credentials n'émet jamais de jeton de rafraîchissement : il n'y a donc rien à mettre en cache ni à renouveler — un appel HTTP supplémentaire par exécution, c'est tout le coût.

1. Ouvrez **Flux de travail → Créer un flux de travail**, nommez-le `Incidents → Dynamics 365`, et ouvrez le **Constructeur**.
2. Cliquez sur le bloc en pointillés, ajoutez le déclencheur **On Create Incident**, et dans son **Select Fields** demandez les colonnes que vous voulez envoyer :

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Laissez son **Identifier** sur `incident-on-create-1`.

3. Cliquez sur **Ajouter un composant**, ajoutez un bloc **API Post (JSON)**, reliez-y le point **Succès** du déclencheur, et ouvrez ses réglages. Réglez son **Identifier** sur `get-token`, puis :

   - **URL** : `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers** :

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body** :

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Écrivez le nom de l'en-tête `Content-Type` avec exactement cette casse.** C'est lui qui indique à OneUptime d'envoyer le corps sous forme de formulaire plutôt qu'en JSON, seule forme acceptée par le point de terminaison de jeton Microsoft. `content-type` en minuscules ne correspond pas, la requête part en JSON et revient en `400`.

Le `scope` doit être l'URL de votre environnement suivie de `/.default` — c'est la forme pour client confidentiel. Une mauvaise URL d'environnement ici est la cause habituelle de `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Le jeton est désormais disponible en aval sous la forme :

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Étape 5 — Créer le case

Ajoutez un second bloc **API Post (JSON)**, reliez-y le point **Succès** de `get-token`, et réglez son **Identifier** sur `create-case`.

- **URL** : `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers** :

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body** :

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Remplacez le GUID de compte par celui du compte auquel ces cases appartiennent. **`customerid` est réellement obligatoire sur un case** — c'est l'une des colonnes que Dataverse impose lors de toute écriture programmatique, si bien qu'une création sans elle est rejetée. Comme elle peut pointer soit vers un account, soit vers un contact, on n'écrit jamais `customerid@odata.bind` ; on écrit `customerid_account@odata.bind` ou `customerid_contact@odata.bind`, et ces noms sont sensibles à la casse. `title` est obligatoire d'une autre manière : les formulaires Dynamics l'exigent, l'API non — envoyez-le quand même.

`Prefer: return=representation` est ce qui rend cet appel utilisable depuis un workflow. Sans lui, une création réussie répond `204 No Content` et place l'URI du nouvel enregistrement dans un en-tête de réponse `OData-EntityId`, dont il faudrait ensuite extraire un GUID. Avec lui, la réponse est `201 Created` et porte l'enregistrement lui-même, si bien que le bloc suivant peut lire :

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Activez maintenant le workflow — **Vue d'ensemble → Modifier le flux de travail → Activé** — déclarez un incident de test, et lisez l'exécution sous **Exécutions & journaux**. Le bloc `create-case` devrait afficher un `201` et un corps contenant le nouvel `incidentid`. Les modifications faites sur le canevas s'enregistrent d'elles-mêmes ; il n'y a pas de bouton Enregistrer.

### Associer gravité et statut

Dynamics livre `severitycode` avec une seule option, « Default Value » : il n'existe donc pas d'échelle de gravité prête à l'emploi à faire correspondre. Utilisez plutôt **`prioritycode`**, et créez un embranchement avec un bloc **If / Else** sur `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` si vous voulez des priorités par gravité.

| Colonne          | Valeurs                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` est personnalisable : un tenant peut donc avoir ajouté ses propres valeurs. Envoyez des entiers, pas des libellés.

## Étape 6 — Garder l'incident et le case repérables l'un depuis l'autre

Tout ce que vous ferez ensuite — commenter, résoudre, resynchroniser — exige que l'un des deux systèmes conserve l'identifiant de l'autre. Placez-le du côté Dynamics.

Ajoutez une colonne **single line of text** à la table Case, par exemple `new_oneuptimeincidentid`, et renseignez-la au moment de créer le case :

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

N'importe quel workflow ultérieur peut alors retrouver le case avec un filtre :

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Si vous définissez cette colonne comme **alternate key** sur la table Case, vous pouvez sauter entièrement la recherche et faire un `PATCH` direct sur `incidents(new_oneuptimeincidentid='<id>')` — un upsert qui crée le case s'il manque et le met à jour s'il existe. La clé doit avoir fini de se construire (son état devient **Active**) avant de pouvoir être utilisée, et les valeurs d'alternate key ne peuvent pas contenir `/ < > * % & : \ ? + #`. Un id OneUptime est un simple UUID : il ne pose donc aucun problème.

La direction inverse — stocker l'id du case Dynamics sur l'incident OneUptime — fonctionne aussi, avec un bloc **Update One Incident** qui écrit dans `customFields`. Prudence : `customFields` est une unique colonne JSON, si bien que l'écrire remplace toutes les valeurs de champs personnalisés de cet incident, pas seulement la vôtre. Garder le lien du côté Dynamics évite complètement ce problème.

## Étape 7 — Résoudre le case quand l'incident est résolu

Construisez ceci comme un **second** workflow, pour qu'un échec ici ne puisse pas empêcher l'ouverture des cases.

1. **Créer un flux de travail**, nommez-le `Incident resolved → Close Dynamics case`, et ajoutez le déclencheur **On Update Incident**.
2. Dans le **Listen on** du déclencheur, mettez `{"currentIncidentStateId": true}` pour que le workflow ne se réveille que pour les changements d'état, et non à chaque modification. Dans **Select Fields**, demandez `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Ajoutez un bloc **If / Else**. **Input 1** est `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** est `==`, **Input 2** est `Resolved` — ou le nom que porte l'état résolu dans votre projet. Voir [États et sévérités des incidents](/docs/incidents/states-and-severities).
4. Depuis la branche **Oui**, répétez le bloc `get-token` de l'Étape 4.
5. Ajoutez un bloc **API Get (JSON)**, réglez son **Identifier** sur `find-case`, et donnez-lui l'URL avec `$filter` de l'Étape 6. Une requête Dataverse répond par un tableau `value`, et une référence de workflow peut indexer un tableau avec des crochets : l'id du case est donc `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Ajoutez un bloc **API Post (JSON)** qui ferme le case :

   - **URL** : `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers** : les mêmes qu'à l'Étape 5, moins `Prefer`.
   - **Request Body** :

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` est une valeur de `statuscode` dans l'état Resolved — `5` correspond à *Problem Solved*.

     **Testez ce corps sur votre propre environnement avant de compter dessus.** `CloseIncident` prend deux paramètres, `IncidentResolution` et `Status`, mais Microsoft n'en publie aucun exemple HTTP — tous les échantillons officiels sont en C#. La forme ci-dessus est la traduction conventionnelle. Si votre environnement la rejette, essayez d'identifier le case avec une simple propriété `"incidentid": "<the case id>"` plutôt qu'avec la forme `@odata.bind`, qui est la façon dont les autres exemples d'actions de Microsoft référencent un enregistrement existant.

**Pourquoi ne pas simplement faire un `PATCH` du case vers `statecode: 1` ?** Vous le pouvez — Microsoft documente un `PATCH` de `statecode` et `statuscode` comme l'équivalent Web API de l'ancien message SetState, et c'est le bon outil pour déplacer un case entre statuts actifs. Ce qu'il ne fait pas, c'est créer l'activité **Case Resolution** qu'un case résolu est censé avoir dans Dynamics 365 Customer Service, et il sera refusé net dans un environnement où un administrateur a configuré des transitions de statut personnalisées. Utilisez `CloseIncident` pour résoudre ; utilisez `PATCH` pour tout le reste. Et chaque fois que vous écrivez `statecode`, renseignez `statuscode` dans la même requête — sinon Dynamics applique silencieusement le statut par défaut de cet état.

`CloseIncident` vient de Dynamics 365 Customer Service et non de Dataverse de base, et il ne figure pas dans la référence des actions Dataverse. S'il renvoie `404`, confirmez qu'il existe dans votre environnement en récupérant `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` et en y cherchant `CloseIncident`.

Pour tout ce qui reste en deçà de la fermeture du case — une note, une montée de priorité, un changement de titre — utilisez un bloc **API Patch (JSON)** vers `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` avec un en-tête `If-Match: *`, qui empêche un upsert accidentel de créer un nouveau case. N'envoyez que les colonnes que vous modifiez.

## Entrant — de Dynamics 365 vers OneUptime

Maintenant l'autre direction : quelqu'un ferme le case dans Dynamics, ou un agent ajoute une note, et OneUptime doit le savoir.

### Construire d'abord le workflow récepteur

1. **Créer un flux de travail**, nommez-le `Dynamics 365 → OneUptime`, et ajoutez le déclencheur **Webhook**.
2. Ouvrez les **Paramètres** de ce workflow et copiez la **clé secrète du webhook**. Votre URL est :

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Sur une installation auto-hébergée, mettez votre propre hôte. Traitez cette URL comme un mot de passe — quiconque la possède peut démarrer le workflow. Vous pouvez régénérer la clé depuis cette même page.

3. Ajoutez un bloc **If / Else** qui vérifie un secret partagé avant que quoi que ce soit d'autre ne se produise. **Input 1** est `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — une valeur que vous inventez et enregistrez comme variable globale secrète.
4. Depuis la branche **Oui**, ajoutez un bloc **Update One Incident** :

   - **Query** : `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)** : ce que le changement du case doit signifier dans OneUptime — un changement d'état, une note, un label.

   Pour faire passer l'incident dans un état, il vous faudra l'id de cet état : un bloc **Find One Incident State** avec la requête `{"name": "Resolved"}` vous donne `{{local.components.incident-state-find-one-1.returnValues.model._id}}` à écrire dans `currentIncidentStateId`.

Laissez-le activé et prêt. Il reste à donner à Dynamics quelque chose à appeler.

### Option A — un flux Power Automate (recommandé)

C'est la voie que la plupart des équipes devraient prendre : vous contrôlez la charge utile, et il n'y a rien à installer.

1. Dans [Power Automate](https://make.powerautomate.com), créez un **Automated cloud flow**.
2. Déclencheur : **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type** : `Modified`
   - **Table name** : `Cases`
   - **Scope** : `Organization` — tout choix plus restreint ne se déclenche que pour les lignes dont vous ou votre business unit êtes propriétaires.
   - **Select columns** : `statecode,statuscode`. C'est un filtre qui ne s'applique qu'aux mises à jour, et il vaut la peine de le régler correctement. Les colonnes de recherche n'y sont pas prises en charge, et ne listez jamais une colonne présente à chaque mise à jour (comme la clé primaire), sans quoi le flux se déclenche à chaque enregistrement.

3. Ajoutez **Microsoft Dataverse → Get a row by ID**, table `Cases`, id de ligne issu du déclencheur, et un **Select columns** de `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Ce second appel vaut son coût. Lors d'une mise à jour, le déclencheur ne transporte que les colonnes qui ont changé : les identifiants dont vous avez besoin pour la correspondance peuvent tout simplement ne pas être là.

4. Ajoutez l'action intégrée **HTTP** :

   - **Method** : `POST`
   - **URI** : l'URL de webhook OneUptime obtenue plus haut
   - **Headers** : `Content-Type: application/json` et `X-OneUptime-Secret: <the same secret>`
   - **Body** : construisez-le à partir des sorties de *Get a row by ID*, par exemple

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Enregistrez et activez le flux.

Ce qu'il faut savoir avant de vous engager sur cette voie :

- Le **connecteur Microsoft Dataverse est premium.** Pour un flux automatisé, seul le propriétaire du flux a besoin de la licence, pas toutes les personnes que le case concerne — mais l'expiration de la licence du propriétaire arrête le flux en silence.
- Les déclencheurs Dataverse fonctionnent **par push, pas par sondage** — Dynamics enregistre un rappel et le déclenche. La remise se fait normalement en quelques secondes ; au-delà de cinq minutes, c'est que le service asynchrone est engorgé, ce que vous pouvez voir sous **Settings → System Jobs** dans l'admin center.
- Les en-têtes personnalisés survivent. Power Automate retire plusieurs familles d'en-têtes standards des actions HTTP (la plupart des en-têtes `Accept-*` et `Content-*`, `Host`, `Origin`, `Cookie`), mais un en-tête à vous tel que `X-OneUptime-Secret` est transmis tel quel.
- Le flux doit vivre dans le même environnement que la table qu'il surveille.
- Les requêtes sont décomptées de l'allocation de requêtes Power Platform de votre tenant, et la limitation du connecteur se manifeste par un `429` dans l'exécution du flux.

### Option B — un webhook Dataverse natif

Si Power Automate n'est pas disponible, Dataverse peut appeler OneUptime directement. Enregistrez le point de terminaison avec le [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook) : **Register New WebHook**, donnez-lui l'URL OneUptime, choisissez l'authentification **HttpHeader**, et ajoutez `X-OneUptime-Secret` avec votre secret. Enregistrez ensuite une étape sur la table **incident** pour le message **Update**, avec des **Filtering Attributes** limités aux colonnes qui vous intéressent, l'étape **PostOperation**, et le mode d'exécution **Asynchronous**.

Prenez cette voie en connaissance de cause :

- **Ports 80 et 443 uniquement.** Un OneUptime auto-hébergé sur tout autre port ne peut pas être enregistré.
- **Dataverse ne vérifie pas votre secret.** Il envoie l'en-tête ; rejeter une requête qui ne le porte pas est entièrement le travail de votre workflow — c'est à cela que sert le bloc **If / Else** du workflow récepteur.
- **La charge utile n'est pas un objet JSON accueillant.** C'est un `RemoteExecutionContext` sérialisé, dans lequel `InputParameters` est un *tableau* de paires `{key, value}` et où la ligne modifiée se trouve sous la clé `Target`, ses colonnes rangées dans un autre tableau `Attributes`. Attendez-vous à ajouter un bloc **Run Custom JavaScript** pour l'aplatir avant que quoi que ce soit d'autre puisse le lire.
- **Seules les colonnes modifiées sont incluses** lors d'une mise à jour : enregistrez donc une **Post Image** si vous avez besoin de `ticketnumber` ou de votre colonne d'id OneUptime.
- **Au-delà de 256 Ko, les parties intéressantes sont retirées** — `InputParameters`, `PreEntityImages` et `PostEntityImages` disparaissent, et la requête porte un en-tête `x-ms-dynamics-msg-size-exceeded`. `PrimaryEntityId` et `PrimaryEntityName` survivent : le repli consiste donc à relire la ligne via la Web API.
- **La remise est presque impitoyable.** Dataverse attend 60 secondes une réponse `2xx` et réessaie exactement une fois, uniquement pour `502`, `503` et `504`. Tout le reste — y compris un `500` venu de chez vous — n'est pas réessayé ; cela se solde par un System Job en échec.
- Choisissez **Asynchronous**. Une étape synchrone bloque l'enregistrement de l'agent sur votre point de terminaison, et si la transaction est annulée ensuite, la requête est déjà partie et ne peut pas être rappelée.

Les workflows d'arrière-plan classiques de Dynamics n'ont aucune étape HTTP ni webhook : ils ne constituent donc pas une troisième option ici.

## Faire la même chose pour les alertes

Tout ce qui précède est écrit autour des incidents parce que c'est le cas le plus courant, mais les alertes fonctionnent à l'identique — changez le type d'enregistrement et rien d'autre ne bouge :

| Incident                                                     | Alerte                                              |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Un workflow n'a qu'un seul déclencheur : incidents et alertes demandent donc un workflow chacun. Si les deux devaient faire le même travail, construisez la moitié Dynamics une seule fois et appelez-la depuis les deux avec le composant **Execute Workflow**.

## Dépannage

Lisez d'abord le bloc en échec dans **Exécutions & journaux** — les deux points de terminaison Microsoft renvoient un corps JSON explicatif, et le composant API le conserve dans `response-body`.

**La demande de jeton échoue avec un `400` et `invalid_request` ou un type de grant non pris en charge.** L'en-tête `Content-Type` n'est pas exactement `Content-Type: application/x-www-form-urlencoded`, et le corps est donc parti en JSON. Vérifiez la casse.

**`400` avec `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** Le `scope` n'est pas l'URL de votre environnement suivie de `/.default`. Copiez l'URL depuis **Developer resources** et retirez toute barre oblique finale ainsi que tout chemin `/api/data/...`.

**`401 Unauthorized` venant de Dynamics.** L'en-tête `Authorization` est absent, mal formé, ou le jeton a expiré en cours d'exécution. Il doit se lire `Bearer <token>` avec une seule espace.

**`403 Forbidden` avec `0x80072560`, « The user isn't a member of the organization ».** L'Étape 2 a été sautée, ou l'application user est rattachée à un autre enregistrement d'application. Le jeton est correct ; c'est l'utilisateur côté Dynamics qui n'existe pas.

**`403 Forbidden` avec une erreur de privilège.** L'application user existe, mais son rôle de sécurité personnalisé n'a pas Create, Read ou Write sur **Case**.

**`400 Bad Request` mentionnant le customer.** `customerid` est obligatoire. Renseignez `customerid_account@odata.bind` ou `customerid_contact@odata.bind`, orthographié exactement, avec une URI commençant par une barre oblique telle que `/accounts(<guid>)`.

**`404 Not Found` sur `/CloseIncident`.** L'action appartient à Dynamics 365 Customer Service. Cherchez-la dans le `$metadata` de votre environnement avant de la supposer disponible.

**`412 Precondition Failed` avec `DuplicateRecord`.** Une règle de détection de doublons a trouvé une correspondance. Restreignez la règle, ou cessez d'envoyer le champ sur lequel elle s'appuie.

**`429 Too Many Requests`.** Les limites de protection du service Dataverse — environ 6 000 requêtes et 20 minutes de temps d'exécution par utilisateur sur une fenêtre glissante de cinq minutes, par serveur web. La réponse porte un `Retry-After` en secondes. Si un workflow envoie des rafales, mettez-y un bloc **Delay** ou déplacez le travail vers un workflow planifié qui traite par lots.

**Rien n'arrive du côté de OneUptime.** Envoyez vous-même une requête à l'URL de webhook avec `curl` et regardez les **Exécutions & journaux** du workflow. Si votre propre requête apparaît et pas celle de Dynamics, le problème est en amont : pour Power Automate, regardez l'historique d'exécution du flux ; pour un webhook natif, regardez **Settings → System Jobs** filtré sur les échecs.

**Le workflow s'exécute mais l'incident ne change pas.** Un bloc **Update One Incident** rapporte `Items Updated: 0` quand la requête n'a rien trouvé — c'est un succès, pas une erreur. Vérifiez que l'id présent dans la charge utile est bien l'id de l'incident OneUptime et que vous interrogez `_id`.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas entrant et sortant, et l'aide-mémoire d'authentification.
- [Jira](/docs/integrations/jira) — la même construction bidirectionnelle avec Jira.
- [Présentation des workflows](/docs/workflows/index) et [Créer un workflow](/docs/workflows/authoring) — le canevas, les identifiants, et l'activation d'un workflow.
- [Composants](/docs/workflows/components) — les blocs API, If / Else, et les composants de données OneUptime.
- [Variables](/docs/workflows/variables) — les secrets, et la lecture de la sortie d'un bloc depuis le suivant.
- [Configuration et sécurité](/docs/workflows/configuration) — la sécurité des webhooks et l'accès réseau sortant.
- [Adresses IP](/docs/configuration/ip-addresses) — les plages sortantes de OneUptime, si Dynamics est derrière une liste d'autorisation.
