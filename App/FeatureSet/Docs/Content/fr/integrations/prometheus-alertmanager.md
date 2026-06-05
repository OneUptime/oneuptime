# Intégration Prometheus Alertmanager

Transformez les notifications [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) en incidents OneUptime. Prometheus évalue vos règles d'alerte, Alertmanager les route, et OneUptime les enregistre et les escalade.

Cette intégration est **entrante** : Alertmanager POSTs vers un **[Workflow](/docs/workflows/index)** OneUptime qui commence par un **déclencheur Webhook**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prérequis

- Une configuration Prometheus + Alertmanager où vous pouvez modifier `alertmanager.yml`.
- Alertmanager doit pouvoir atteindre votre instance OneUptime via HTTPS.
- Un projet OneUptime où vous pouvez créer des workflows.

## Étape 1 — Créer le workflow OneUptime

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Alertmanager → Incidents`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Webhook** et **copiez son URL**. Renommez le bloc `Alertmanager`.
3. Ajoutez un bloc **Conditions** connecté au déclencheur :
   - **Left** : `{{Alertmanager.Request Body.status}}`
   - **Operator** : `==`
   - **Right** : `firing`
4. Depuis **Yes**, ajoutez un bloc **Create Incident** :
   - **Title** : `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description** : `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity** : choisissez-en une (ou branchez d'abord sur `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Enregistrez** (laissez désactivé jusqu'au test).

> **À propos des alertes groupées.** Alertmanager regroupe les alertes et envoie un **tableau** `alerts`. Les `commonLabels` et `commonAnnotations` ci-dessus sont les champs partagés dans le groupe — parfaits pour un incident par notification. Si vous souhaitez **un incident par alerte**, ajoutez un bloc [Custom Code](/docs/workflows/components#custom-code) qui parcourt `Request Body.alerts` et crée un incident pour chacune. Affinez le regroupement avec `group_by` dans votre route.

## Étape 2 — Configurer Alertmanager

Ajoutez un récepteur webhook pointant vers l'URL du workflow, et routez les alertes vers lui. Dans `alertmanager.yml` :

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Rechargez Alertmanager (`curl -X POST http://localhost:9093/-/reload` ou redémarrez-le).

## Étape 3 — Tester

1. Activez le workflow.
2. Déclenchez une alerte de test — par exemple, avec `amtool` :

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Vérifiez l'onglet **Logs** du workflow et votre liste **Incidents**.

## Résolution à la reprise (optionnel)

Avec `send_resolved: true`, Alertmanager POSTs également lorsqu'une alerte se résorbe, cette fois avec `status: resolved`. Ajoutez une seconde branche **Conditions** (`status == resolved`), trouvez l'incident correspondant (faites correspondre sur `commonLabels.alertname`), et faites-le passer à votre état résolu avec **Update Incident**.

## Dépannage

- **Aucune exécution n'apparaît** — confirmez qu'Alertmanager peut atteindre l'URL (vérifiez ses journaux pour les erreurs de livraison) et que le workflow est **Enabled**.
- **Les champs d'incident sont vides** — différentes règles définissent différentes annotations. Inspectez la sortie du déclencheur dans l'onglet **Logs** et référencez les champs qui existent réellement (`commonAnnotations` vs `annotations` par alerte).
- **Trop d'incidents** — augmentez `group_by`/`group_interval` pour qu'Alertmanager regroupe les alertes connexes.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — le schéma entrant.
- [Grafana](/docs/integrations/grafana) — la même idée, alertes Grafana.
- [Déclencheur Webhook](/docs/workflows/triggers#webhook) — comment fonctionne l'URL réceptrice.
