# Intégration Grafana

Transformez les alertes [Grafana](https://grafana.com) en incidents OneUptime. Grafana évalue les règles d'alerte de vos tableaux de bord ; OneUptime les enregistre, les escalade et les suit.

Cette intégration est **entrante** : un **point de contact Webhook** Grafana envoie en POST vers OneUptime. Il y a deux façons de le recevoir.

| Approche                                                                                  | Utilisez-la lorsque                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Moniteur de requêtes entrantes](/docs/monitor/incoming-request-monitor)** (recommandé) | Vous voulez que les alertes deviennent des incidents avec escalade d'astreinte, un incident par alerte, et résolution automatique à la reprise.                        |
| **[Workflow](/docs/workflows/index) avec un déclencheur Webhook**                         | Vous avez besoin d'une logique de routage que OneUptime ne fait pas nativement — appeler d'autres systèmes, remodeler les charges utiles, brancher conditionnellement. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

La charge utile webhook de Grafana suit la forme Alertmanager — `status`, un tableau `alerts`, `commonLabels` et `commonAnnotations`, ainsi que des champs pratiques `title` et `message` au niveau supérieur.

## Prérequis

- Grafana 9+ avec [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) activé (le défaut sur Grafana moderne).
- Grafana doit pouvoir joindre votre instance OneUptime en HTTPS.
- Un projet OneUptime où vous pouvez créer des moniteurs (ou des workflows).

## Option 1 — Moniteur de requêtes entrantes

1. Allez dans **Moniteurs → Créer un moniteur** et choisissez **Requête entrante**. Ouvrez-le et cliquez sur **Documentation** dans le menu de gauche pour copier l'URL.
2. Ouvrez les **Criteria** du moniteur et réglez **Filter Type** sur `JavaScript Expression` et **Value** sur `"{{requestBody.status}}" === "firing"`.
3. Déclarez un incident en cas de correspondance, choisissez les **On-Call Policies** à alerter, et activez **Auto Resolve Incident** sous **Advanced Options**.
4. Sous **Settings**, activez **Group incidents and alerts by a payload field** et renseignez :

   | Champ                              | Valeur                              |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Titrez l'incident `{{requestBody.commonLabels.alertname}}` et décrivez-le avec `{{requestBody.message}}` ou `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` contient la clé de regroupement elle-même, mais c'est un hachage — pas quelque chose à montrer à la personne d'astreinte.)
6. Pointez le point de contact Grafana vers l'URL du moniteur (voir les étapes du point de contact ci-dessous).

Chaque valeur de regroupement **distincte** devient son propre incident, et chacun se ferme lorsque Grafana le signale résolu. Le `fingerprint` par alerte de Grafana est unique à l'ensemble des labels d'une alerte, d'où son usage comme chemin de regroupement ci-dessus. La page [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) détaille la même configuration plus en profondeur — la forme de la charge utile est identique, donc chaque étape s'y applique aussi ici.

> **Warning:** Ne regroupez pas sur un label constant dans une notification. La politique de notification par défaut de Grafana regroupe par `grafana_folder` et `alertname` : toutes les alertes d'un même webhook partagent donc le même alertname — regrouper sur `requestBody.alerts[*].labels.alertname` fondrait toute la charge utile en un seul incident. Les chemins de regroupement doivent en outre commencer par le littéral `requestBody.`, et seul le premier `[*]` d'un chemin est un joker. Toutes ces erreurs échouent en silence.

## Option 2 — Workflow

Utilisez ceci lorsque vous avez besoin d'une logique dépassant « une alerte devient un incident ».

### Étape 1 — Créer le workflow OneUptime

1. Ouvrez **Flux de travail → Créer un flux de travail**, nommez-le `Grafana → Incidents`, et ouvrez le **Constructeur**.
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

## Configurer le point de contact Grafana

1. Dans Grafana, allez dans **Alerting → Contact points → Add contact point**.
2. **Name** : `OneUptime`. **Integration** : **Webhook**.
3. **URL** : collez l'URL du moniteur de l'Option 1, ou l'URL du webhook du workflow de l'Option 2. **HTTP Method** : `POST`.
4. Enregistrez le point de contact.
5. Allez dans **Alerting → Notification policies** et routez les alertes voulues (ou la politique par défaut) vers le point de contact **OneUptime**.

## Tester

1. Activez le workflow, si vous en avez construit un.
2. Dans l'écran du point de contact, utilisez **Test** pour envoyer une notification d'exemple, ou laissez une vraie règle d'alerte se déclencher.
3. Consultez votre liste d'**Incidents** — et l'onglet **Journaux** du workflow si vous avez utilisé l'Option 2.

## Résolution à la reprise

Lorsque l'alerte se calme, Grafana envoie une autre notification avec `status: resolved`.

Avec l'**Option 1**, le champ et la valeur de rétablissement configurés ci-dessus ferment automatiquement l'incident correspondant — à condition que **Auto Resolve Incident** soit activé.

Avec l'**Option 2**, ajoutez une seconde branche **Conditions** (`status == resolved`), retrouvez l'incident correspondant, et déplacez-le vers votre état résolu avec **Update Incident**.

## Notes

- **L'alerting historique (Grafana 8 et antérieur)** envoie une charge utile différente (`ruleName`, `state`, `evalMatches`). Si vous utilisez l'alerting historique, référencez plutôt `{{Grafana.Request Body.ruleName}}` et `{{Grafana.Request Body.state}}`, et branchez sur `state == alerting`.
- Vous pouvez aussi contourner entièrement l'alerting de Grafana et faire surveiller les mêmes métriques directement par OneUptime — voir le [Moniteur de métriques](/docs/monitor/metrics-monitor).

## Dépannage

- **Rien n'arrive** — vérifiez que Grafana peut joindre l'URL (consultez les journaux serveur de Grafana) et, pour l'Option 2, que le workflow est **Activé**. OneUptime répond à chaque requête entrante par un `200` vide avant de la valider : un `200` dans les journaux de Grafana ne confirme donc pas que la charge utile a été acceptée.
- **Les incidents s'ouvrent mais ne se ferment jamais** — vérifiez le champ et la valeur de rétablissement sur le critère, et que **Auto Resolve Incident** est activé sous les **Advanced Options** de l'incident. La comparaison est sensible à la casse.
- **Un seul incident pour une charge utile pleine d'alertes** — vous avez regroupé sur un label qui ne varie pas au sein d'une notification. Regroupez plutôt sur `requestBody.alerts[*].fingerprint`.
- **Le texte de l'incident affiche des espaces réservés `{{...}}` bruts** — le chemin ne s'est pas résolu, et les espaces réservés non résolus sont laissés en place plutôt que vidés. Référencez des champs qui existent pour votre version d'alerting ; inspectez la sortie du déclencheur dans l'onglet **Journaux** si vous avez utilisé l'Option 2.

## Pour aller plus loin

- [Moniteur de requêtes entrantes](/docs/monitor/incoming-request-monitor) — le type de moniteur, ses critères et le regroupement d'incidents en détail.
- [Présentation des intégrations](/docs/integrations/index) — le schéma entrant.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — charge utile très proche.
- [Moniteur de métriques](/docs/monitor/metrics-monitor) — surveillez les métriques directement dans OneUptime.
