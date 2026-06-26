# Appareils IoT OneUptime

## Vue d'ensemble

OneUptime surveille des flottes d'appareils IoT — capteurs, passerelles, contrôleurs et boîtiers edge — en ingérant des métriques OpenTelemetry (OTLP) standard. Chaque appareil (ou une passerelle agissant en son nom) envoie un petit ensemble de métriques `iot_*` via OTLP HTTP, étiquetées avec la **flotte** à laquelle il appartient et son propre **identifiant d'appareil**. OneUptime regroupe ces métriques dans une flotte, construit un inventaire d'appareils en temps réel et suit pour chaque appareil la batterie, la connectivité, la température, le CPU, la mémoire et la disponibilité.

Il n'y a aucun agent à installer côté appareil — tout ce qui sait parler OTLP (un SDK OpenTelemetry sur l'appareil, ou un OpenTelemetry Collector exécuté sur une passerelle qui redistribue vers de nombreux appareils) fonctionne. Cette page est le **guide d'ingestion**. Pour configurer des moniteurs et des alertes IoT par-dessus les données que vous envoyez, consultez [Moniteur d'appareil IoT](/docs/monitor/iot-device-monitor).

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

Émettez vos relevés sous forme de métriques en utilisant les noms `iot_*` ci-dessous (voir [Conventions de métriques](#metric-conventions)). En l'espace d'une minute environ, l'appareil apparaît dans la section **IoT** du tableau de bord OneUptime.

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
    # OneUptime requiert l'encodeur JSON au lieu du Proto(buf) par défaut
    encoding: json
    headers:
      "Content-Type": "application/json"
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
- **`otlphttp`** envoie vers OneUptime en HTTPS avec le jeton d'ingestion attaché. Notez que `encoding: json` et l'en-tête `Content-Type: application/json` sont requis.

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
3. Si vous utilisez un collector, assurez-vous que `encoding: json` et `Content-Type: application/json` sont définis sur l'exportateur `otlphttp`.

### Des appareils manquent dans l'inventaire

1. Assurez-vous que chaque point de données porte un label `device.id` — les appareils sont indexés dessus.
2. Envoyez `iot_device_info` (identité uniquement) pour les appareils qui n'ont pas encore rapporté de relevés afin qu'ils apparaissent tout de même dans l'inventaire.
3. Vérifiez que les valeurs de `device.id` sont stables d'un rapport à l'autre ; un identifiant changeant crée des lignes d'appareils en double.

### HTTP 401 / 403 depuis l'exportateur

Le jeton d'ingestion est invalide, révoqué ou manquant. Générez-en un nouveau depuis _Project Settings → Telemetry Ingestion Keys_ et mettez à jour l'en-tête `x-oneuptime-token`.

### Les métriques ne se tracent pas

1. Confirmez que vous utilisez exactement les noms de métriques `iot_*` du tableau [Conventions de métriques](#metric-conventions) — les noms non reconnus sont stockés comme des métriques génériques et ne rempliront pas les graphiques IoT.
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
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Si votre instance est uniquement en HTTP, remplacez le schéma par `http://` et utilisez le port approprié.

## Étapes suivantes

- Configurez un **Moniteur d'appareil IoT** pour alerter sur les conditions d'appareil hors ligne, de batterie faible, de signal faible, de température élevée et de CPU élevé — consultez [Moniteur d'appareil IoT](/docs/monitor/iot-device-monitor).
- Pour les hôtes non conteneurisés (VMs Linux / macOS / Windows et serveurs physiques), utilisez le [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Pour apprendre en profondeur l'intégration OTLP sous-jacente, consultez [Intégrer OpenTelemetry avec OneUptime](/docs/telemetry/open-telemetry).
