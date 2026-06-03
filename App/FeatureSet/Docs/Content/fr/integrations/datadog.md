# Intégration Datadog

Transformez les alertes de monitor [Datadog](https://www.datadoghq.com) en incidents OneUptime, pour que la détection Datadog alimente la réponse aux incidents et les pages de statut de OneUptime.

Cette intégration est **entrante** : l'[intégration Webhooks](https://docs.datadoghq.com/integrations/webhooks/) de Datadog publie vers un **[Workflow](/docs/workflows/index)** OneUptime qui commence par un **déclencheur Webhook**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prérequis

- Un compte Datadog où vous pouvez configurer des intégrations et des monitors.
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Créer le workflow OneUptime

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Datadog → Incidents`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Webhook** et **copiez son URL**. Renommez le bloc `Datadog`.
3. Ajoutez un bloc **Conditions** connecté au déclencheur :
   - **Left** : `{{Datadog.Request Body.transition}}`
   - **Operator** : `==`
   - **Right** : `Triggered`
4. Depuis **Yes**, ajoutez un bloc **Create Incident** :
   - **Title** : `{{Datadog.Request Body.title}}`
   - **Description** : `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity** : choisissez-en une.
5. **Enregistrez** (laissez désactivé jusqu'au test).

## Étape 2 — Créer le webhook Datadog

1. Dans Datadog, allez dans **Integrations → Webhooks** (installez l'intégration **Webhooks** si ce n'est pas déjà fait).
2. **Ajoutez un webhook** :
   - **Name** : `oneuptime` (cela devient `@webhook-oneuptime`).
   - **URL** : l'URL webhook de votre workflow.
   - **Payload** — Datadog vous permet de définir le corps JSON en utilisant des [variables de modèle](https://docs.datadoghq.com/integrations/webhooks/#usage) :

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Enregistrez le webhook.

## Étape 3 — Envoyer les alertes d'un monitor vers le webhook

Ajoutez le handle du webhook aux monitors que vous souhaitez transmettre. Dans le **message de notification** de chaque monitor, incluez :

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Cela envoie à la fois l'alerte et la reprise vers OneUptime. (Pour tout transmettre, vous pouvez également ajouter `@webhook-oneuptime` à un monitor de façon inconditionnelle.)

## Étape 4 — Tester

1. Activez le workflow.
2. Depuis un monitor, utilisez **Test Notifications → Alert**, ou laissez un vrai monitor se déclencher.
3. Vérifiez l'onglet **Logs** du workflow et votre liste **Incidents**.

## Résolution à la reprise (optionnel)

`$ALERT_TRANSITION` vaut `Recovered` lorsqu'un monitor se rétablit. Ajoutez une seconde branche **Conditions** (`transition == Recovered`), trouvez l'incident correspondant (faites correspondre sur l'`id` envoyé), et faites-le passer à votre état résolu avec **Update Incident**.

## Dépannage

- **Aucune exécution n'apparaît** — confirmez que le message du monitor inclut `@webhook-oneuptime` et que le workflow est **Enabled**.
- **Les champs sont vides** — Datadog ne substitue que les variables de modèle qui s'appliquent à l'événement. Inspectez la sortie du déclencheur dans l'onglet **Logs** et ajustez votre charge utile webhook.
- **Incidents en double** — un monitor qui ré-alerte (renotify) envoie plusieurs événements `Triggered` ; déduplication avec une vérification **Find Incident** sur l'`id` avant la création.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — le schéma entrant.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) et [Grafana](/docs/integrations/grafana) — autres sources entrantes.
- [Déclencheur Webhook](/docs/workflows/triggers#webhook) — comment fonctionne l'URL réceptrice.
