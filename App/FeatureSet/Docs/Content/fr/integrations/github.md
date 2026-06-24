# Intégration GitHub

Ouvrez automatiquement un ticket [GitHub](https://github.com) lorsqu'un incident OneUptime est créé — pour que le suivi du travail d'ingénierie soit dans le dépôt propriétaire du service concerné.

Cette intégration est **sortante** : OneUptime appelle l'[API REST GitHub](https://docs.github.com/en/rest/issues/issues). Elle utilise un **[Workflow](/docs/workflows/index)** OneUptime avec un déclencheur **Incident → On Create** et un **composant API**.

> **Vous cherchez la connexion GitHub plus approfondie ?** OneUptime dispose également d'une intégration native **GitHub App** pour connecter des dépôts de code (utilisée par l'agent IA et les fonctionnalités de code). Elle se configure avec des variables d'environnement, pas avec des workflows — voir [Intégration GitHub (auto-hébergé)](/docs/self-hosted/github-integration). Cette page concerne spécifiquement la _création de tickets depuis des incidents_.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Prérequis

- Un dépôt GitHub où vous souhaitez créer des tickets.
- Un jeton pouvant créer des tickets :

  - Un **PAT à granularité fine** limité à ce dépôt avec **Issues : Read and write**, ou
  - un **PAT classique** avec la portée `repo`.

  Créez-en un sur [github.com/settings/tokens](https://github.com/settings/tokens).

- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Stocker le jeton

1. Allez dans **Workflows → Global Variables → Create**.
2. Nommez-le `GITHUB_TOKEN`, collez le jeton, et activez **Is Secret**.

## Étape 2 — Créer le workflow

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → GitHub Issues`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un bloc **API** connecté au déclencheur :

   - **Method** : `POST`
   - **URL** : `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers** :

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body** :

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Enregistrez**, activez, et créez un incident de test. Un `201 Created` dans les journaux du workflow signifie que le ticket a été créé ; le corps de la réponse contient son `number` et son `html_url`.

## Conseils

- **GitHub Enterprise Server** : utilisez `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Assignataires / jalon** : ajoutez `"assignees": ["octocat"]` ou `"milestone": 3` au corps.
- **Lien en retour** : lisez `{{CreateIssue.response-body.html_url}}` et stockez-le sur l'incident avec un bloc **Update Incident**.

## Dépannage

- **`401`** — le jeton est incorrect ou expiré. Les jetons à granularité fine doivent explicitement accorder le dépôt et la permission **Issues**.
- **`403` / limite de débit** — incluez l'en-tête `User-Agent` (GitHub rejette les requêtes sans lui) et vérifiez que vous n'avez pas atteint la limite de débit.
- **`404`** — le chemin `owner/repo` est incorrect, ou le jeton ne peut pas voir un dépôt privé.
- **`422`** — un label qui n'existe pas est acceptable (GitHub crée les labels référencés), mais un corps mal formé ne l'est pas — vérifiez votre JSON.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas et l'aide-mémoire d'authentification.
- [GitLab](/docs/integrations/gitlab) — la même idée pour GitLab.
- [Intégration GitHub (auto-hébergé)](/docs/self-hosted/github-integration) — la connexion native GitHub App.
