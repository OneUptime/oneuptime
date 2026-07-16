# Appareils IoT OneUptime

## Vue d'ensemble

OneUptime surveille des flottes d'appareils IoT — capteurs, passerelles, contrôleurs et boîtiers edge — en ingérant un petit ensemble de métriques `iot_*`, étiquetées avec la **flotte** à laquelle chaque relevé appartient et son propre **identifiant d'appareil**. OneUptime regroupe ces métriques dans une flotte, construit un inventaire d'appareils en temps réel et suit pour chaque appareil la batterie, la connectivité, la température, le CPU, la mémoire et la disponibilité.

Les appareils peuvent envoyer leurs relevés de deux façons, et toutes deux alimentent exactement le même inventaire de flotte, les mêmes tableaux de bord et les mêmes moniteurs :

- **OpenTelemetry (OTLP)** — un SDK OTel sur l'appareil, ou un OpenTelemetry Collector sur une passerelle qui redistribue vers de nombreux appareils.
- **MQTT** — connectez-vous directement à l'endpoint MQTT intégré de OneUptime (MQTT sur WebSocket à l'adresse `wss://<your-host>/mqtt`, ou MQTT TCP brut sur les déploiements auto-hébergés) et publiez des relevés JSON. Aucun collector requis, et la prise en charge du Last Will offre une détection hors ligne instantanée.

Il n'y a aucun agent propriétaire à installer côté appareil. Cette page est le **guide d'ingestion**. Pour configurer des moniteurs et des alertes IoT par-dessus les données que vous envoyez, consultez [Moniteur d'appareil IoT](/docs/monitor/iot-device-monitor).

## Prérequis

- Un appareil, une passerelle ou un collector capable d'envoyer du OTLP/HTTP vers OneUptime
- Une accessibilité réseau depuis l'appareil/la passerelle vers votre instance OneUptime
- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis _Project Settings → Telemetry Ingestion Keys_ et copiez la valeur `x-oneuptime-token`

## Comment OneUptime modélise l'IoT

OneUptime fait correspondre vos appareils à deux concepts à l'aide des attributs de ressource OpenTelemetry :

- **Flotte** — un groupe logique d'appareils (par exemple `building-a-sensors` ou `field-gateways`). La flotte est dérivée de l'attribut de ressource `iot.fleet.name` et apparaît dans OneUptime comme le service de télémétrie `iot/<fleet>`. Définissez `service.name=iot/<fleet>` pour que les logs et les métriques s'alignent sous le même service.
- **Appareil** — un appareil individuel au sein d'une flotte, identifié par l'attribut `device.id`. OneUptime construit et maintient un inventaire d'appareils par flotte, indexé sur `device.id`.

Des attributs facultatifs affinent la façon dont chaque appareil est classé et délimité dans les moniteurs :

| Attribut             | Requis   | Description                                                                       |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Oui      | La flotte à laquelle cet appareil appartient. Devient le service OneUptime `iot/<fleet>` |
| `device.id`          | Oui      | Identifiant stable et unique de l'appareil au sein de la flotte                  |
| `iot.device.kind`    | Non      | La classe de l'appareil — par exemple `Device`, `Sensor` ou `Gateway`. Vaut `Device` par défaut |
| `iot.device.type`    | Non      | Un type/modèle d'appareil plus fin utilisé pour filtrer les moniteurs (par exemple `temp-sensor`) |
| `iot.device.firmware`| Non      | Version du firmware rapportée par l'appareil                                     |

## Envoyer des métriques via le SDK OpenTelemetry

Si votre appareil exécute directement un SDK OpenTelemetry, pointez-le vers OneUptime et estampillez les attributs de ressource IoT via les variables d'environnement `OTEL_*` standard. Remplacez le jeton, l'endpoint, le nom de la flotte et l'identifiant d'appareil par les valeurs correspondant à votre environnement.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Variable d'environnement      | Requis   | Description                                                                                           |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Oui      | Endpoint OTLP de OneUptime (`https://oneuptime.com/otlp`, ou `http(s)://YOUR-ONEUPTIME-HOST/otlp` en auto-hébergé) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Oui      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Oui      | Attributs de ressource séparés par des virgules. Doit inclure `iot.fleet.name`, `device.id` et `service.name=iot/<fleet>` |

Émettez vos relevés sous forme de métriques en utilisant les noms `iot_*` ci-dessous (voir [Conventions de métriques](#conventions-de-métriques)). En l'espace d'une minute environ, l'appareil apparaît dans la section **IoT** du tableau de bord OneUptime.

## Envoyer des métriques via un OpenTelemetry Collector

Lorsque de nombreux appareils rapportent via une passerelle, exécutez un OpenTelemetry Collector sur la passerelle et exportez vers OneUptime. Le processeur `resource` estampille les attributs de flotte ; recevez les relevés de vos appareils (OTLP, pont MQTT, fichiers de logs, etc.) et transférez-les :

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** estampille chaque enregistrement avec les attributs de flotte. Définissez `iot.fleet.name` (et le `service.name=iot/<fleet>` correspondant) par passerelle afin que les appareils de chaque passerelle atterrissent dans la bonne flotte.
- Conservez `device.id` (et éventuellement `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) sur chaque point de données pour que OneUptime puisse résoudre l'appareil individuel à l'intérieur de la flotte.
- **`otlphttp`** envoie vers OneUptime en HTTPS avec le jeton d'ingestion attaché. L'encodage protobuf par défaut et `encoding: json` sont tous deux acceptés.

## Envoyer des métriques via MQTT

OneUptime embarque un endpoint MQTT intégré, si bien que les appareils qui parlent déjà MQTT peuvent envoyer leurs relevés directement — sans SDK OpenTelemetry, sans collector et sans pont. Tout ce qui est publié via MQTT atterrit dans le même pipeline que l'OTLP : les flottes sont créées automatiquement, l'inventaire d'appareils se met à jour, et chaque moniteur et modèle d'alerte IoT fonctionne sans modification.

**Endpoints**

| Transport             | Adresse                                | Notes                                                                                     |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| MQTT sur WebSocket    | `wss://<your-host>/mqtt`               | Fonctionne sur tous les déploiements — passe par le port HTTPS habituel via l'ingress OneUptime |
| MQTT sur TCP          | `<app-host>:1883` (`MQTT_INGEST_PORT`) | Auto-hébergé : interne au réseau du cluster/compose par défaut ; exposez-le si vous en avez besoin |

**Authentification** — deux options :

- **À l'échelle du projet** : envoyez votre **jeton d'ingestion de télémétrie** comme mot de passe MQTT (le nom d'utilisateur est ignoré ; si votre client n'expose qu'un champ nom d'utilisateur, placez-y le jeton à la place). Adapté aux passerelles qui publient pour le compte de nombreux appareils.
- **Par appareil** (recommandé pour les appareils qui se connectent directement) : enregistrez l'appareil depuis l'onglet **Device Registry** de la flotte dans le tableau de bord. L'enregistrement délivre un identifiant propre à l'appareil — l'ID de l'identifiant est le **nom d'utilisateur** MQTT et le secret est le **mot de passe**. Les clients authentifiés par appareil ne peuvent publier que sous leurs propres topics `oneuptime/<fleet>/<device>/…`, un appareil compromis peut être révoqué depuis le tableau de bord sans toucher au reste de la flotte (la révocation prend effet en une minute environ, même pour les sessions connectées), et les appareils enregistrés bénéficient de la **détection de mort silencieuse** : ils restent dans l'inventaire avec le statut Offline au lieu de disparaître lorsqu'ils cessent de rapporter, et le modèle d'alerte Device Offline se déclenche pour eux même s'ils meurent sans Last Will.

Les identifiants invalides sont rejetés dès le CONNECT avec le code de retour 4 (bad username or password) ; un appareil mal configuré échoue donc bruyamment.

**Topics** — publiez sous le préfixe fixe `oneuptime/`. Les segments de flotte et d'appareil ne doivent pas contenir `/`, `+` ni `#`, et sont limités à 100 caractères :

| Topic                                            | Charge utile                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | Objet JSON de relevés — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, ou un objet plat dont les champs numériques sont les métriques |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| Une valeur unique — un nombre brut (`23.4`) ou `{ "value": 23.4 }`                                    |
| `oneuptime/<fleet>/<device>/status`              | `"online"` ou `"offline"` (également `1`/`0`, `true`/`false`, `up`/`down`) — correspond à `iot_device_up` |

Les charges utiles de télémétrie peuvent également porter `"attributes"` (une map de chaînes estampillée sur chaque point de données — utilisez-la pour `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, ou vos propres labels) et `"timestamp"` (ISO-8601, ou unix en secondes/millisecondes). Les deux sont facultatifs ; l'heure d'ingestion est utilisée lorsque `timestamp` est absent.

**Détection hors ligne avec Last Will** — enregistrez un Last Will MQTT sur `oneuptime/<fleet>/<device>/status` avec la charge utile `offline`. Si l'appareil meurt ou quitte le réseau, le broker publie `iot_device_up = 0` en son nom dès la fin de la session — ce qui déclenche le modèle d'alerte **Device Offline** fourni en standard et bascule l'appareil en Down dans l'inventaire, sans polling et sans attendre une collecte manquée. Publiez `online` sur le même topic après la connexion pour que l'appareil réapparaisse en service.

Exemple avec `mosquitto_pub` (TCP brut, auto-hébergé) :

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

Exemple avec le module Node.js `mqtt` sur WebSocket (fonctionne avec oneuptime.com et toute instance auto-hébergée) :

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignoré — c'est le jeton ci-dessous qui authentifie
  password: "YOUR_TELEMETRY_INGESTION_TOKEN",
  will: {
    topic: "oneuptime/building-a-sensors/sensor-001/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("oneuptime/building-a-sensors/sensor-001/status", "online");
  setInterval(() => {
    client.publish(
      "oneuptime/building-a-sensors/sensor-001/telemetry",
      JSON.stringify({
        metrics: {
          iot_device_up: 1,
          iot_battery_percent: readBattery(),
          iot_temperature_celsius: readTemperature(),
        },
      }),
    );
  }, 60 * 1000);
});
```

Exemple avec Python `paho-mqtt` sur WebSocket :

```python
import json
import paho.mqtt.client as mqtt

client = mqtt.Client(transport="websockets")
client.username_pw_set("oneuptime", "YOUR_TELEMETRY_INGESTION_TOKEN")
client.tls_set()
client.will_set("oneuptime/building-a-sensors/sensor-001/status", "offline")
client.ws_set_options(path="/mqtt")
client.connect("oneuptime.com", 443)

client.publish("oneuptime/building-a-sensors/sensor-001/status", "online")
client.publish(
    "oneuptime/building-a-sensors/sensor-001/telemetry",
    json.dumps({"metrics": {"iot_device_up": 1, "iot_temperature_celsius": 21.5}}),
)
```

Remarques :

- L'endpoint est **réservé à l'ingestion** : les abonnements sont refusés (échec SUBACK). Utilisez QoS 1 si vous voulez que le broker accuse réception. L'ingestion est **au moins une fois** — une retransmission QoS 1/2 après un accusé de réception perdu peut produire des points de données en double.
- Les publications hors du contrat de topics ou avec des charges utiles malformées sont acceptées puis **abandonnées** (MQTT 3.1.1 n'a pas de réponse d'erreur par message) — le serveur journalise un avertissement avec la raison, vérifiez donc les logs de l'application OneUptime si les données n'arrivent pas.
- Sur l'endpoint WebSocket, gardez le keepalive MQTT **en dessous de 5 minutes** — l'ingress OneUptime ferme les connexions WebSocket inactives après 300 secondes, ce qui déclencherait votre Last Will et une fausse alerte Device Offline. Les valeurs par défaut des bibliothèques clientes (60 s pour `mqtt` et `paho-mqtt`) conviennent. L'endpoint TCP brut n'a pas ce plafond.
- Les charges utiles sont plafonnées à 128 Ko et 100 métriques par publication ; les paquets trop volumineux entraînent la fermeture de la connexion.

## Conventions de métriques

OneUptime reconnaît les noms de métriques `iot_*` suivants. Chaque point de données doit porter le label `device.id` afin que le relevé soit attribué au bon appareil. Vous n'avez besoin d'envoyer que les métriques qui ont du sens pour votre appareil — celles qui sont absentes ne sont tout simplement pas tracées.

| Nom de la métrique          | Signification                                                                   |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Disponibilité de l'appareil. `1` = en service/joignable, `0` = hors service. Alimente le moniteur d'appareil IoT |
| `iot_device_info`           | Signal d'identité uniquement. Porte `device.id` / kind / type / firmware afin qu'un appareil apparaisse dans l'inventaire même avant de rapporter des relevés |
| `iot_battery_percent`       | Niveau de charge de la batterie, `0`–`100` (%)                                 |
| `iot_signal_strength_dbm`   | Force du signal sans fil en dBm (par exemple RSSI Wi-Fi / LoRa / cellulaire)    |
| `iot_temperature_celsius`   | Température de l'appareil ou du capteur en °C                                  |
| `iot_cpu_usage_ratio`       | Utilisation du CPU sous forme de ratio `0`–`1` (OneUptime le stocke en pourcentage) |
| `iot_memory_usage_bytes`    | Mémoire actuellement utilisée, en bytes                                        |
| `iot_memory_size_bytes`     | Mémoire totale disponible sur l'appareil, en bytes                             |
| `iot_uptime_seconds`        | Secondes écoulées depuis le dernier démarrage de l'appareil                    |

## Vérifier l'installation

1. Confirmez que votre appareil ou passerelle exporte sans erreurs (vérifiez dans les logs du SDK/collector les échecs d'export et les réponses HTTP `401`/`403`).
2. Dans le tableau de bord OneUptime, ouvrez la section **IoT** — votre flotte devrait apparaître comme `iot/<fleet>` en l'espace d'une minute environ.
3. Ouvrez l'onglet **Devices** de la flotte — chaque `device.id` que vous avez envoyé devrait être listé avec ses dernières valeurs de batterie, signal, température, CPU, mémoire et son statut en service/hors service.
4. Ouvrez **Metrics** sous la flotte pour tracer n'importe quelle des séries `iot_*` ci-dessus.

## Dépannage

### La flotte n'apparaît pas

1. Vérifiez que `iot.fleet.name` est défini comme attribut de **ressource** (et non comme label de point de données), et que `service.name` vaut `iot/<fleet>`.
2. Confirmez que l'endpoint de l'exportateur est `https://oneuptime.com/otlp` (ou votre `…/otlp` auto-hébergé) et que l'en-tête `x-oneuptime-token` porte un jeton valide.
3. Si vous utilisez MQTT, confirmez que le topic suit exactement `oneuptime/<fleet>/<device>/…` — c'est le segment de flotte du topic qui crée la flotte.

### Des appareils manquent dans l'inventaire

1. Assurez-vous que chaque point de données porte un label `device.id` — les appareils sont indexés dessus.
2. Envoyez `iot_device_info` (identité uniquement) pour les appareils qui n'ont pas encore rapporté de relevés afin qu'ils apparaissent tout de même dans l'inventaire.
3. Vérifiez que les valeurs de `device.id` sont stables d'un rapport à l'autre ; un identifiant changeant crée des lignes d'appareils en double.

### HTTP 401 / 403 depuis l'exportateur

Le jeton d'ingestion est invalide, révoqué ou manquant. Générez-en un nouveau depuis _Project Settings → Telemetry Ingestion Keys_ et mettez à jour l'en-tête `x-oneuptime-token`.

### Les métriques ne se tracent pas

1. Confirmez que vous utilisez exactement les noms de métriques `iot_*` du tableau [Conventions de métriques](#conventions-de-métriques) — les noms non reconnus sont stockés comme des métriques génériques et ne rempliront pas les graphiques IoT.
2. Rappelez-vous que `iot_cpu_usage_ratio` est un ratio `0`–`1` ; envoyez le ratio brut et OneUptime l'affiche en pourcentage.
3. Comptez jusqu'à une minute pour que les premiers points de données apparaissent après qu'un appareil a commencé à rapporter.

## OneUptime auto-hébergé

Si vous auto-hébergez OneUptime, pointez l'endpoint vers votre propre instance :

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Ou, dans un collector :

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Pour MQTT, connectez-vous à `wss://your-oneuptime-host.example.com/mqtt`, ou exposez le port MQTT TCP brut du service app (`MQTT_INGEST_PORT`, `1883` par défaut) si vos appareils ne savent pas parler WebSocket. Définissez `MQTT_INGEST_ENABLED=false` sur le service app pour désactiver entièrement les listeners MQTT.

Si votre instance est uniquement en HTTP, remplacez le schéma par `http://` (et `ws://` pour MQTT) et utilisez le port approprié.

## Étapes suivantes

- Configurez un **Moniteur d'appareil IoT** pour alerter sur les conditions d'appareil hors ligne, de batterie faible, de signal faible, de température élevée et de CPU élevé — consultez [Moniteur d'appareil IoT](/docs/monitor/iot-device-monitor).
- Pour les hôtes non conteneurisés (VMs Linux / macOS / Windows et serveurs physiques), utilisez le [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Pour apprendre en profondeur l'intégration OTLP sous-jacente, consultez [Intégrer OpenTelemetry avec OneUptime](/docs/telemetry/open-telemetry).
