# Intégration Grafana

Transformez les alertes [Grafana](https://grafana.com) en incidents OneUptime. Grafana évalue les règles d'alerte sur vos tableaux de bord ; OneUptime les enregistre, les escalade et les suit.

Cette intégration est **entrante** : le système d'alertes de Grafana publie vers un **[Workflow](/docs/workflows/index)** OneUptime qui commence par un **déclencheur Webhook**, en utilisant un **point de contact Webhook** Grafana.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prérequis

- Grafana 9+ avec les [alertes unifiées](https://grafana.com/docs/grafana/latest/alerting/) activées (valeur par défaut sur les versions modernes de Grafana).
- Grafana doit pouvoir atteindre votre instance OneUptime via HTTPS.
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Créer le workflow OneUptime

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Grafana → Incidents`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Webhook** et **copiez son URL**. Renommez le bloc `Grafana`.
3. Ajoutez un bloc **Conditions** connecté au déclencheur :
   - **Left** : `{{Grafana.Request Body.status}}`
   - **Operator** : `==`
   - **Right** : `firing`
4. Depuis **Yes**, ajoutez un bloc **Create Incident** :
   - **Title** : `{{Grafana.Request Body.title}}`
   - **Description** : `{{Grafana.Request Body.message}}`
   - **Severity** : choisissez-en une (ou branchez sur `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Enregistrez** (laissez désactivé jusqu'au test).

La charge utile webhook de Grafana suit la forme Alertmanager — elle inclut `status`, un tableau `alerts`, `commonLabels` et `commonAnnotations`, ainsi que des champs pratiques `title` et `message` au niveau supérieur.

## Étape 2 — Configurer le point de contact Grafana

1. Dans Grafana, allez dans **Alerting → Contact points → Add contact point**.
2. **Name** : `OneUptime`. **Integration** : **Webhook**.
3. **URL** : collez l'URL webhook de votre workflow. **HTTP Method** : `POST`.
4. Enregistrez le point de contact.
5. Allez dans **Alerting → Notification policies** et routez les alertes souhaitées (ou la politique par défaut) vers le point de contact **OneUptime**.

## Étape 3 — Tester

1. Activez le workflow.
2. Dans l'écran du point de contact, utilisez **Test** pour envoyer un exemple de notification, ou laissez une vraie règle d'alerte se déclencher.
3. Vérifiez l'onglet **Logs** du workflow et votre liste **Incidents**.

## Résolution à la reprise (optionnel)

Lorsque l'alerte se résorbe, Grafana envoie une autre notification avec `status: resolved`. Ajoutez une seconde branche **Conditions** (`status == resolved`), trouvez l'incident correspondant, et faites-le passer à votre état résolu avec **Update Incident**.

## Notes

- **Alertes legacy (Grafana 8 et antérieur)** envoient une charge utile différente (`ruleName`, `state`, `evalMatches`). Si vous utilisez des alertes legacy, référencez `{{Grafana.Request Body.ruleName}}` et `{{Grafana.Request Body.state}}` à la place, et branchez sur `state == alerting`.
- Vous pouvez également contourner entièrement le système d'alertes de Grafana et laisser OneUptime surveiller directement les mêmes métriques — voir le [Monitor de métriques](/docs/monitor/metrics-monitor).

## Dépannage

- **Aucune exécution n'apparaît** — confirmez que Grafana peut atteindre l'URL (vérifiez les journaux serveur de Grafana) et que le workflow est **Enabled**.
- **Champs vides** — inspectez la sortie du déclencheur dans l'onglet **Logs** ; référencez les champs qui existent pour votre version d'alertes.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — le schéma entrant.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — charge utile étroitement liée.
- [Monitor de métriques](/docs/monitor/metrics-monitor) — surveiller les métriques directement dans OneUptime.
