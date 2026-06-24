# Intégration ServiceNow

Ouvrez automatiquement un incident [ServiceNow](https://www.servicenow.com) chaque fois qu'un incident OneUptime est créé — pour que l'ITSM et le monitoring restent synchronisés.

Cette intégration est **sortante** : OneUptime appelle l'[API Table](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) de ServiceNow. Elle utilise un **[Workflow](/docs/workflows/index)** OneUptime avec un déclencheur **Incident → On Create** et un **composant API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Prérequis

- Une instance ServiceNow (`https://your-instance.service-now.com`).
- Un utilisateur ServiceNow avec les rôles `rest_api_explorer` / `itil` (ou suffisamment de droits pour créer des enregistrements `incident`). Basic auth avec les identifiants de cet utilisateur est le départ le plus simple ; OAuth est recommandé pour la production.
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Stocker les identifiants comme secret

L'API Table de ServiceNow accepte **Basic auth**.

1. Encodez en base64 `username:password` une seule fois :

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. Dans OneUptime, allez dans **Workflows → Global Variables → Create**, nommez-la `SERVICENOW_AUTH`, collez la chaîne base64, et activez **Is Secret**.

## Étape 2 — Créer le workflow

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → ServiceNow`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un bloc **API** connecté au déclencheur :

   - **Method** : `POST`
   - **URL** : `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers** :

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body** :

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` garde un lien vers l'incident OneUptime — pratique si vous ajoutez une étape de résolution plus tard. ServiceNow utilise `1` (élevé), `2` (moyen), `3` (faible) pour `urgency`/`impact`.

4. **Enregistrez**, activez, et créez un incident de test. Une réponse `201 Created` dans les journaux du workflow retourne le `sys_id` et le `number` du nouvel enregistrement (par exemple `INC0012345`).

## Étape 3 — Résoudre lors de la résolution OneUptime (optionnel)

1. Créez un **second** workflow avec un déclencheur **Incident → On Update** et un bloc **Conditions** qui vérifie que l'incident est résolu.
2. Pour mettre à jour le bon enregistrement ServiceNow, vous avez besoin de son `sys_id`. Soit vous le stockez sur l'incident OneUptime à l'Étape 2 (lisez `{{CreateRecord.response-body.result.sys_id}}` et écrivez-le dans un label avec **Update Incident**), soit recherchez d'abord l'enregistrement avec un `GET` sur `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Ajoutez un bloc **API** : **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, corps `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Résolu dans le workflow ITIL par défaut).

## Dépannage

- **`401`** — réencodez `username:password` avec `printf` (pas `echo`, qui ajoute un retour à la ligne) et mettez à jour `SERVICENOW_AUTH`.
- **`403`** — l'utilisateur n'a pas les droits pour écrire dans la table `incident` ; ajoutez le rôle `itil`.
- **`400`** — un nom de champ ou une valeur est incorrect pour les personnalisations de votre instance. Vérifiez les noms de champs dans **System Definition → Tables → incident**.
- **L'instance rejette l'appel** — certaines instances restreignent l'API Table ; confirmez que REST est activé et que votre IP n'est pas bloquée par une ACL.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas et l'aide-mémoire d'authentification.
- [Jira](/docs/integrations/jira) — le même schéma sortant pour Jira.
- [Composant API](/docs/workflows/components#api) — lecture du corps de la réponse.
