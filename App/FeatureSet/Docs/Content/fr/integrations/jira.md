# Intégration Jira

Ouvrez automatiquement un ticket [Jira](https://www.atlassian.com/software/jira) chaque fois qu'un incident OneUptime est créé — pour que le travail d'ingénierie soit suivi là où vos développeurs travaillent déjà, avec un lien vers l'incident.

Cette intégration est **sortante** : OneUptime appelle l'API REST de Jira. Elle utilise un **[Workflow](/docs/workflows/index)** OneUptime avec un déclencheur **Incident → On Create** et un **composant API**. Vous pouvez éventuellement ajouter un chemin **entrant** pour que la fermeture du ticket Jira résolve l'incident OneUptime.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Prérequis

- Un site Jira Cloud (`https://your-domain.atlassian.net`) et un projet dans lequel créer des tickets — notez sa **clé de projet** (par ex. `OPS`).
- Un compte Jira pouvant créer des tickets, et un **jeton d'API** depuis [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Un projet OneUptime où vous pouvez créer des workflows.

> Vous utilisez **Jira Data Center / Server** (auto-géré) ? Le fonctionnement est identique — utilisez votre propre URL de base et un [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) avec un en-tête d'authentification `Bearer` au lieu de Basic auth. Le point de terminaison `/rest/api/2/issue` accepte une description en texte brut, ce qui simplifie les modèles.

## Étape 1 — Stocker vos identifiants Jira comme secret

Jira Cloud utilise **Basic auth** avec votre e-mail et votre jeton d'API, encodés en base64.

1. Encodez en base64 `email:api_token` une seule fois. Sur macOS/Linux :

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. Dans OneUptime, allez dans **Workflows → Global Variables → Create**.
3. Nommez-la `JIRA_AUTH`, collez la chaîne base64 comme valeur, et activez **Is Secret**.

Vous pouvez maintenant utiliser `Basic {{variable.JIRA_AUTH}}` comme en-tête d'authentification et le jeton n'apparaît jamais dans le workflow ni dans ses journaux.

## Étape 2 — Créer le workflow

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → Jira`, et ouvrez le **Builder**.
2. Faites glisser un déclencheur **Incident** sur le canevas et choisissez l'événement **On Create**. Renommez-le `Incident`.
3. Faites glisser un bloc **API** et connectez le déclencheur à celui-ci. Configurez :
   - **Method** : `POST`
   - **URL** : `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers** :

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 utilise le format de document Atlassian pour la description) :

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Remplacez `OPS` par votre clé de projet et `Bug` par un type de ticket existant dans ce projet.
4. **Enregistrez.** Laissez le workflow désactivé jusqu'à ce que vous l'ayez testé.

## Étape 3 — Tester

1. Activez **Enabled** dans le workflow.
2. Créez un incident de test dans OneUptime (ou déclenchez-en un depuis un monitor).
3. Ouvrez l'onglet **Logs** du workflow. Le bloc **API** devrait afficher un statut `201` et un corps de réponse contenant la `key` du nouveau ticket (par exemple `OPS-1234`).
4. Vérifiez dans Jira — le ticket est là.

Si le bloc API retourne une erreur, développez-le dans les journaux — la réponse de Jira explique exactement quel champ a été rejeté. Voir [Dépannage](#dépannage).

## Étape 4 — Lier l'incident au ticket (recommandé)

Il est utile de stocker la clé du ticket Jira sur l'incident pour que les gens puissent passer de l'un à l'autre.

- La réponse du bloc API est disponible sous `{{CreateIssue.response-body.key}}` (si vous avez nommé le bloc `CreateIssue`).
- Ajoutez un bloc **Update Incident** après lui et écrivez la clé dans un label, un champ personnalisé ou une note sur l'incident.

Cela rend également possible la synchronisation bidirectionnelle optionnelle ci-dessous.

## Synchronisation bidirectionnelle (optionnel)

Pour résoudre l'incident OneUptime lorsque quelqu'un ferme le ticket Jira, ajoutez un workflow **entrant** :

1. Créez un second workflow qui commence par un déclencheur **Webhook** et copiez son URL.
2. Dans Jira, allez dans **Project settings → Automation → Create rule** :
   - **Trigger** : *Issue transitioned* vers **Done** (ou *Issue resolved*).
   - **Action** : *Send web request* → méthode `POST`, URL = l'URL webhook de votre workflow, le corps inclut la clé du ticket et l'id de l'incident OneUptime, par ex. :

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. Dans le workflow, utilisez un bloc **Find Incident** pour localiser l'incident par la clé stockée, puis un bloc **Update Incident** pour le faire passer à votre état résolu.

Si vous avez stocké la clé Jira sur l'incident à l'Étape 4, la correspondance est simple. Voir [Composants → Composants de données OneUptime](/docs/workflows/components#oneuptime-data-components).

## Personnaliser le ticket

Quelques ajustements courants au corps du bloc API :

- **Priority** — ajoutez `"priority": { "name": "High" }` dans `fields`. Vous pouvez vous brancher sur `{{Incident.incidentSeverity.name}}` avec **Conditions** pour associer les gravités OneUptime aux priorités Jira.
- **Labels** — ajoutez `"labels": ["oneuptime", "incident"]`.
- **Assignee** — ajoutez `"assignee": { "id": "<accountId>" }` (Jira Cloud utilise des ID de compte, pas des noms d'utilisateur).
- **Champs personnalisés** — ajoutez `"customfield_XXXXX": "..."` en utilisant l'ID du champ depuis votre administration Jira.

Pour découvrir les noms de champs exacts attendus par un projet, appelez le point de terminaison Jira `GET /rest/api/3/issue/createmeta` une fois depuis votre navigateur ou `curl`.

## Dépannage

**`401 Unauthorized`.**
- Réencodez `email:api_token` et mettez à jour la variable `JIRA_AUTH`. Un retour à la ligne final est la cause habituelle — utilisez `printf` (pas `echo`) lors de l'encodage.
- Confirmez que le compte propriétaire du jeton d'API peut créer des tickets dans le projet.

**`400 Bad Request` mentionnant un champ.**
- Le type de ticket ou un champ requis est incorrect. Vérifiez le nom du **type de ticket** du projet et s'il a des champs personnalisés requis. Utilisez `createmeta` (ci-dessus) pour voir ce qui est obligatoire.

**`404 Not Found`.**
- Vérifiez l'URL de base et que vous accédez à `/rest/api/3/issue` (Cloud) ou `/rest/api/2/issue` (Server/Data Center).

**La description s'affiche sur une seule ligne / semble bizarre.**
- v3 exige le format de document Atlassian indiqué ci-dessus. Si vous préférez envoyer du texte brut, utilisez le point de terminaison `/rest/api/2/issue` avec `"description": "{{Incident.description}}"` comme chaîne simple.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas entrant/sortant et l'aide-mémoire d'authentification.
- [Composant API](/docs/workflows/components#api) — méthodes, en-têtes et lecture de la réponse.
- [Variables](/docs/workflows/variables) — secrets et champs d'incident.
- [PagerDuty](/docs/integrations/pagerduty) et [ServiceNow](/docs/integrations/servicenow) — le même schéma sortant pour d'autres outils.
