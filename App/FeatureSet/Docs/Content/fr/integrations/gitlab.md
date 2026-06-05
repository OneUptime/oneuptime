# Intégration GitLab

Ouvrez automatiquement un ticket [GitLab](https://gitlab.com) lorsqu'un incident OneUptime est créé — pour que le suivi du travail d'ingénierie atterrisse dans le projet propriétaire du service concerné.

Cette intégration est **sortante** : OneUptime appelle l'[API REST GitLab](https://docs.gitlab.com/ee/api/issues.html). Elle utilise un **[Workflow](/docs/workflows/index)** OneUptime avec un déclencheur **Incident → On Create** et un **composant API**. Elle fonctionne de la même façon sur GitLab.com et sur les instances GitLab auto-gérées.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Prérequis

- Un projet GitLab et son **ID de projet** (affiché sur la page d'aperçu du projet, sous le nom du projet).
- Un jeton d'accès pouvant créer des tickets — un **jeton d'accès de projet, de groupe ou personnel** avec la portée `api` : **Settings → Access Tokens**.
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Stocker le jeton

1. Allez dans **Workflows → Global Variables → Create**.
2. Nommez-le `GITLAB_TOKEN`, collez le jeton, et activez **Is Secret**.

## Étape 2 — Créer le workflow

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → GitLab Issues`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un bloc **API** connecté au déclencheur :
   - **Method** : `POST`
   - **URL** : `https://gitlab.com/api/v4/projects/12345678/issues`  *(remplacez `12345678` par votre ID de projet ; pour une instance auto-gérée, utilisez votre propre hôte)*
   - **Headers** :

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body** :

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Enregistrez**, activez, et créez un incident de test. Un `201 Created` dans les journaux du workflow signifie que le ticket a été créé ; le corps de la réponse contient son `iid` et son `web_url`.

## Conseils

- **GitLab auto-géré** : remplacez `https://gitlab.com` par l'URL de votre instance ; le chemin `/api/v4/...` reste le même.
- **Chemin de projet au lieu de l'ID** : vous pouvez encoder l'URL du chemin — par ex. `group%2Fproject` — à la place de l'ID numérique.
- **Assignataire / date d'échéance** : ajoutez `"assignee_ids": [42]` ou `"due_date": "2026-01-31"` au corps.
- **Lien en retour** : lisez `{{CreateIssue.response-body.web_url}}` et stockez-le sur l'incident avec un bloc **Update Incident**.

## Dépannage

- **`401`** — le jeton est invalide ou expiré, ou n'a pas la portée `api`.
- **`404`** — l'ID de projet est incorrect, ou le jeton ne peut pas accéder à un projet privé.
- **`400`** — un champ requis est manquant ou mal formé ; `title` est obligatoire.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas et l'aide-mémoire d'authentification.
- [GitHub](/docs/integrations/github) — la même idée pour GitHub.
- [Composant API](/docs/workflows/components#api) — lecture du corps de la réponse.
