# Intégration Opsgenie

Créez une alerte [Opsgenie](https://www.atlassian.com/software/opsgenie) chaque fois qu'un incident OneUptime est créé, et fermez-la lorsque OneUptime résout.

Cette intégration est **sortante** : OneUptime appelle l'[API d'alertes Opsgenie](https://docs.opsgenie.com/docs/alert-api). Elle utilise un **[Workflow](/docs/workflows/index)** OneUptime avec un déclencheur **Incident → On Create** et un **composant API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Prérequis

- Une **clé d'API** Opsgenie depuis une intégration API : **Settings → Integrations → Add → API**. Copiez la clé.
- Connaissez votre région. L'hôte API par défaut est `https://api.opsgenie.com` ; les comptes UE utilisent `https://api.eu.opsgenie.com`.
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Stocker la clé d'API

1. Allez dans **Workflows → Global Variables → Create**.
2. Nommez-la `OPSGENIE_KEY`, collez la clé d'API, et activez **Is Secret**.

## Étape 2 — Créer le workflow « créer une alerte »

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → Opsgenie`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un bloc **API** connecté au déclencheur :

   - **Method** : `POST`
   - **URL** : `https://api.opsgenie.com/v2/alerts` _(utilisez `api.eu.opsgenie.com` pour l'UE)_
   - **Headers** :

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body** :

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   L'**`alias`** lie cette alerte Opsgenie à l'incident OneUptime pour pouvoir la fermer plus tard par alias. Notez que le schéma d'authentification Opsgenie est le mot littéral `GenieKey` suivi d'un espace et de votre clé.

4. **Enregistrez**, activez, et créez un incident de test. Une réponse `202 Accepted` dans les journaux du workflow signifie qu'Opsgenie a mis l'alerte en file d'attente.

## Étape 3 — Fermer lors de la résolution OneUptime (recommandé)

1. Créez un **second** workflow nommé `Close Opsgenie` avec un déclencheur **Incident → On Update**.
2. Ajoutez un bloc **Conditions** qui vérifie que l'incident est maintenant résolu (branchez sur `{{Incident.currentIncidentState.name}}`).
3. Depuis **Yes**, ajoutez un bloc **API** :
   - **Method** : `POST`
   - **URL** : `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers** : le même `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body** : `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie recherche l'alerte par alias et la ferme.

## Association des priorités (optionnel)

Les priorités Opsgenie vont de `P1` à `P5`. Faites correspondre les gravités OneUptime avec des branches **Conditions** sur `{{Incident.incidentSeverity.name}}` avant le bloc API.

## Dépannage

- **`401`/`403`** — clé incorrecte, mauvais hôte régional, ou l'intégration n'a pas la permission de créer des alertes. Confirmez que vous utilisez une clé d'intégration **API** et l'hôte `api`/`api.eu` correspondant.
- **La fermeture retourne `404`** — l'`alias` de l'appel de fermeture doit correspondre exactement à celui de l'appel de création, et `identifierType=alias` doit être dans la chaîne de requête.
- **Rien ne se passe** — confirmez que le workflow est **Enabled**.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas et l'aide-mémoire d'authentification.
- [PagerDuty](/docs/integrations/pagerduty) — la même idée pour PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — l'escalade intégrée de OneUptime.
