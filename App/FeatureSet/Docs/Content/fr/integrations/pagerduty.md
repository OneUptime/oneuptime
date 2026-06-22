# Intégration PagerDuty

Déclenchez un incident [PagerDuty](https://www.pagerduty.com) chaque fois qu'un incident OneUptime est créé, et résolvez-le lorsque OneUptime résout. Utile lorsque PagerDuty gère vos escalades et plannings d'astreinte et que vous souhaitez que le monitoring OneUptime l'alimente.

Cette intégration est **sortante** : OneUptime appelle l'[Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) de PagerDuty. Elle utilise un **[Workflow](/docs/workflows/index)** OneUptime avec un déclencheur **Incident → On Create** et un **composant API**.

> OneUptime dispose de sa propre fonctionnalité d'astreinte et d'escalade intégrée — voir [On Call](/docs/on-call/incoming-call-policy). N'utilisez cette intégration que si vous souhaitez spécifiquement que les événements arrivent également dans PagerDuty.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Prérequis

- Un service PagerDuty avec une intégration **Events API v2**. Dans PagerDuty : **Service → Integrations → Add integration → Events API v2**. Copiez la **clé d'intégration** (aussi appelée _routing key_).
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Stocker la routing key

1. Allez dans **Workflows → Global Variables → Create**.
2. Nommez-la `PAGERDUTY_ROUTING_KEY`, collez la clé d'intégration, et activez **Is Secret**.

## Étape 2 — Créer le workflow « trigger »

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → PagerDuty`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un bloc **API** connecté au déclencheur :

   - **Method** : `POST`
   - **URL** : `https://events.pagerduty.com/v2/enqueue`
   - **Headers** : `Content-Type: application/json`
   - **Body** :

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   Le **`dedup_key`** lie cet incident PagerDuty à l'incident OneUptime pour pouvoir le résoudre plus tard. Utiliser l'id de l'incident OneUptime le rend unique et prévisible.

4. **Enregistrez**, activez, et créez un incident de test. Une réponse `202` dans les journaux du workflow signifie que PagerDuty a accepté l'événement.

## Étape 3 — Résoudre lors de la résolution OneUptime (recommandé)

1. Dans le **même** workflow, ajouter un second déclencheur **Incident** ? Non — un workflow n'a qu'un seul déclencheur. Créez plutôt un **second** workflow nommé `Resolve PagerDuty` avec un déclencheur **Incident → On Update**.
2. Ajoutez un bloc **Conditions** pour vérifier que l'incident est maintenant résolu (branchez sur l'état de l'incident / `{{Incident.currentIncidentState.name}}` égal à votre nom d'état résolu).
3. Depuis **Yes**, ajoutez un bloc **API** vers PagerDuty avec le **même `dedup_key`** et `event_action` défini sur `resolve` :

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty fait correspondre le `dedup_key` et ferme l'incident original.

## Association des gravités (optionnel)

Le champ `severity` de PagerDuty accepte `critical`, `error`, `warning` ou `info`. Pour faire correspondre les gravités OneUptime, ajoutez des branches **Conditions** sur `{{Incident.incidentSeverity.name}}` avant le bloc API et envoyez un corps différent depuis chaque branche.

## Entrant (optionnel)

Pour aller dans l'autre sens — ouvrir un incident OneUptime depuis un événement PagerDuty — ajoutez un workflow avec un déclencheur **Webhook** et pointez un [webhook V3](https://developer.pagerduty.com/docs/webhooks/v3-overview/) PagerDuty (ou une orchestration d'événements) vers son URL, puis utilisez **Create Incident**. Voir le [schéma entrant](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Dépannage

- **`400` avec `"invalid routing key"`** — l'intégration doit être **Events API v2**, pas l'ancienne Events API v1 ni un autre type d'intégration. Recopiez la clé.
- **La résolution ne ferme rien** — le `dedup_key` de l'appel de résolution doit correspondre exactement à celui de l'appel de déclenchement.
- **Rien dans les journaux** — confirmez que le workflow est **Enabled** et que le déclencheur est sur **On Create**.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas et l'aide-mémoire d'authentification.
- [On Call](/docs/on-call/incoming-call-policy) — l'escalade intégrée de OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — la même idée pour Opsgenie.
