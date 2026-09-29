# Intégration Prometheus Alertmanager

Transformez les notifications de [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) en incidents OneUptime. Prometheus évalue vos règles d'alerte, Alertmanager les route, et OneUptime les enregistre et les escalade.

Cette intégration est **entrante**, et il y a deux façons de la construire :

| Approche                                                                                  | Utilisez-la lorsque                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Moniteur de requêtes entrantes](/docs/monitor/incoming-request-monitor)** (recommandé) | Vous voulez que les alertes deviennent des incidents avec escalade d'astreinte, un incident par alerte, et résolution automatique à la reprise. Aucune logique à maintenir. |
| **[Workflow](/docs/workflows/index) avec un déclencheur Webhook**                         | Vous avez besoin d'une logique de routage que OneUptime ne fait pas nativement — appeler d'autres systèmes, remodeler les charges utiles, brancher conditionnellement.      |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Prérequis

- Une installation Prometheus + Alertmanager où vous pouvez modifier `alertmanager.yml`.
- Alertmanager doit pouvoir joindre votre instance OneUptime en HTTPS.
- Un projet OneUptime où vous pouvez créer des moniteurs (ou des workflows).

## Option 1 — Moniteur de requêtes entrantes

### Étape 1 — Créer le moniteur

1. Allez dans **Moniteurs → Créer un moniteur** et choisissez **Requête entrante**.
2. Ouvrez le moniteur et cliquez sur **Documentation** dans le menu de gauche. Copiez l'URL :

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Utilisez votre propre hôte si vous l'hébergez vous-même. La clé secrète dans le chemin est la seule information d'authentification.

### Étape 2 — Pointer Alertmanager vers lui

Dans `alertmanager.yml` :

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` est obligatoire — c'est ce qui indique à OneUptime qu'une alerte est rétablie. Rechargez Alertmanager avec `curl -X POST http://localhost:9093/-/reload`, ou redémarrez-le.

Alertmanager envoie `Content-Type: application/json`, ce dont OneUptime a besoin pour lire les champs de la charge utile.

### Étape 3 — Configurer les critères

Ouvrez les **Criteria** du moniteur et modifiez le premier critère.

**Filtre**

- **Filter Type** : `JavaScript Expression`
- **Filter Condition** : `Evaluates To True`
- **Value** : `"{{requestBody.status}}" === "firing"`

  Les guillemets autour de l'espace réservé sont nécessaires pour une comparaison de chaînes. Un filtre `Request Body` / `Contains` / `"status":"firing"` fonctionne aussi si vous préférez éviter une expression.

**Actions**

- Activez _When filters match, change monitor status_ et réglez-le sur **Offline** (ou Degraded).
- Activez _When filters match, declare an incident_. Renseignez le **Title**, la **Severity** et les **On-Call Policies** à alerter.
- Sous **Advanced Options** de cet incident, activez **Auto Resolve Incident**. Sans cela, les notifications de rétablissement sont ignorées et les incidents restent ouverts indéfiniment.

**Settings → Group incidents and alerts by a payload field**

Activez-le pour qu'un même endpoint puisse porter plusieurs incidents simultanés — un par alerte — au lieu d'un seul incident par notification.

| Champ                              | Valeur                              |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` se déploie sur le tableau `alerts` d'Alertmanager et ouvre un incident par valeur extraite **distincte**. Comme les deux chemins utilisent `[*]`, le rétablissement est jugé alerte par alerte : dans une charge utile où une alerte est résolue et deux sont encore actives, seule la résolue se ferme.

> **Warning:** Regroupez sur quelque chose de véritablement unique par alerte. Le `fingerprint` d'Alertmanager est un hachage de l'ensemble complet des labels de l'alerte : il l'est donc toujours. Un label ne convient que s'il varie **à l'intérieur** d'une notification — et tout label figurant dans le `group_by` de votre route ne varie jamais, puisque c'est précisément ce qui définit le groupe d'agrégation. Avec le `group_by: ["alertname", "instance"]` ci-dessus, regrouper sur `requestBody.alerts[*].labels.alertname` extrait la même valeur de chaque alerte de la charge utile : toutes se fondent alors en un seul incident. Pire, seule la **première** occurrence des valeurs dupliquées est conservée : une charge utile dont la première alerte est `resolved` ferme cet incident alors que les autres sont encore actives.

### Étape 4 — Rédiger le titre et la description de l'incident

La clé de regroupement est disponible sous forme de variable nommée d'après le dernier segment du chemin : `requestBody.alerts[*].fingerprint` vous donne donc `{{fingerprint}}`. C'est un hachage, pas quelque chose à montrer à la personne d'astreinte — titrez plutôt l'incident à partir des labels partagés par la notification. `commonLabels` porte tous les labels du `group_by` de votre route : avec la configuration ci-dessus, `alertname` et `instance` sont donc tous deux disponibles :

- **Title** : `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description** :

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` et `commonAnnotations` contiennent les champs partagés par la notification. Un chemin propre à une alerte comme `requestBody.alerts[0].annotations.summary` lit toujours la _première_ alerte de la charge utile, pas celle pour laquelle cet incident précis a été ouvert — gardez donc un `group_by` resserré si vous voulez que chaque incident porte son propre texte d'annotation. Un chemin qui ne se résout pas est affiché littéralement, accolades comprises, plutôt que laissé vide. Voir [Modèles dynamiques d'incident et d'alerte](/docs/monitor/incident-alert-templating) pour la liste complète des variables.

### Étape 5 — Remettre le moniteur en Operational (optionnel)

Les critères n'agissent que lorsqu'ils correspondent : ajoutez donc un second critère pour que le moniteur ne reste pas Offline une fois tout rentré dans l'ordre :

- **Filter Type** : `JavaScript Expression`, **Value** : `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, et ne déclarez aucun incident.

### Étape 6 — Tester

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Vous devriez obtenir deux incidents — un par `fingerprint`. Renvoyez la requête avec le `status` des deux alertes à `resolved` et les deux devraient se fermer.

Vous pouvez aussi déclencher une vraie alerte avec `amtool` :

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Option 2 — Workflow

Utilisez ceci lorsque vous avez besoin d'une logique dépassant « une alerte devient un incident ».

1. Ouvrez **Flux de travail → Créer un flux de travail**, nommez-le `Alertmanager → Incidents`, et ouvrez le **Constructeur**.
2. Ajoutez un déclencheur **Webhook** et **copiez son URL**. Renommez le bloc `Alertmanager`.
3. Ajoutez un bloc **Conditions** connecté au déclencheur :
   - **Left** : `{{Alertmanager.Request Body.status}}`
   - **Operator** : `==`
   - **Right** : `firing`
4. Depuis **Yes**, ajoutez un bloc **Create Incident** :
   - **Title** : `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description** : `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity** : choisissez-en une (ou branchez d'abord sur `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Enregistrez**, puis pointez l'URL de `webhook_configs` de l'Étape 2 ci-dessus vers l'URL du workflow.

Pour un incident par alerte, ajoutez un bloc [Custom Code](/docs/workflows/components#custom-code) qui parcourt `Request Body.alerts`. Avec `send_resolved: true`, ajoutez une seconde branche **Conditions** sur `status == resolved` qui retrouve l'incident correspondant et le déplace vers votre état résolu avec **Update Incident**.

## Dispositif d'homme mort

Aucune des deux options ne vous dit quand Prometheus lui-même s'arrête — l'absence d'alertes ressemble exactement à l'absence de problème. La réponse habituelle est une alerte toujours active routée vers un moniteur qui l'attend selon une planification. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) en fournit une nommée `Watchdog` ; sur un Prometheus simple, ajoutez une règle d'alerte avec une expression toujours vraie (`vector(1)`).

Créez un **second** moniteur de requêtes entrantes, routez `Watchdog` vers lui avec un `repeat_interval` court, et donnez à ce moniteur un critère **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. C'est le seul cas où un critère de requête manquante a sa place sur un récepteur d'alertes.

Voici la configuration de l'Étape 2 avec la route et le récepteur du watchdog intégrés — une sous-route est évaluée avant le récepteur propre de la route parente, si bien que `Watchdog` part vers le second moniteur et tout le reste continue vers le premier :

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Dépannage

- **Rien n'arrive** — vérifiez qu'Alertmanager peut joindre l'URL ; consultez ses journaux pour d'éventuelles erreurs de livraison. OneUptime répond à chaque requête par un `200` vide avant toute validation : un `200` ne confirme donc pas que la charge utile a été acceptée. Consultez plutôt la chronologie du moniteur.
- **Les incidents s'ouvrent mais ne se ferment jamais** — vérifiez `send_resolved: true` dans Alertmanager, le champ et la valeur de rétablissement sur le critère (la comparaison est sensible à la casse), et **Auto Resolve Incident** sous les **Advanced Options** de l'incident. Deux causes plus subtiles : une charge utile portant plus de clés distinctes que **Max incidents per request** masque aussi au rétablissement celles situées au-delà du plafond ; et si la notification `resolved` est justement celle écartée par la fusion à l'ingestion (voir plus bas), l'incident reste bloqué définitivement, car Alertmanager répète les notifications d'activation mais pas celles de résolution. Fermez celles-là à la main.
- **Aucun incident, et statut du moniteur inchangé** — le chemin de regroupement doit commencer par le littéral `requestBody.`, et seul le premier `[*]` d'un chemin est un joker. Ces deux erreurs échouent en silence.
- **Le texte de l'incident affiche des espaces réservés `{{...}}` bruts** — le chemin ne s'est pas résolu, et OneUptime laisse les espaces réservés non résolus en place plutôt que de les vider. Des règles différentes définissent des annotations différentes : référencez des champs qui existent réellement pour vos règles (`commonAnnotations` par rapport aux `annotations` de chaque alerte).
- **Un seul incident pour une charge utile pleine d'alertes** — vous avez regroupé sur un label qui ne varie pas au sein d'une notification, le plus souvent un label figurant aussi dans le `group_by` de votre route. Regroupez plutôt sur `requestBody.alerts[*].fingerprint`.
- **Trop d'incidents** — élargissez `group_by` / `group_interval` pour qu'Alertmanager regroupe les alertes liées. Baisser **Max incidents per request** les plafonne, mais masque aussi au rétablissement les clés au-delà du plafond.
- **Certaines notifications semblent ignorées lors de fortes rafales** — les requêtes vers un même moniteur sont fusionnées à l'ingestion pour qu'un émetteur ne puisse pas le saturer, ce qui peut écarter une charge utile intermédiaire lorsque les notifications se succèdent. Augmenter `group_wait` et `group_interval` les espace. La fusion est pilotée par la variable d'environnement `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` du conteneur de l'application, activée par défaut ; les exploitants auto-hébergés qui ont besoin que chaque charge utile soit évaluée peuvent la passer à `false` sur ce conteneur.

## Pour aller plus loin

- [Moniteur de requêtes entrantes](/docs/monitor/incoming-request-monitor) — le type de moniteur, ses critères et le regroupement d'incidents en détail.
- [Présentation des intégrations](/docs/integrations/index) — les schémas entrant et sortant.
- [Grafana](/docs/integrations/grafana) — même idée, avec l'alerting Grafana.
- [Déclencheur Webhook](/docs/workflows/triggers#webhook) — comment fonctionne l'URL de réception du workflow.
