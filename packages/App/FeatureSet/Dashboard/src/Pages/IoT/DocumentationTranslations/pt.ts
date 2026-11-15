import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Um dispositivo com um SDK do OpenTelemetry que exporta OTLP via HTTP",
  "Network access from the device to your OneUptime instance":
    "Acesso de rede do dispositivo à sua instância do OneUptime",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Substitua `building-a-sensors` e `sensor-001` pelo nome da sua frota e pelo id do dispositivo. Mantenha `iot.fleet.name` estável: alterá-lo registra uma frota totalmente nova.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Emita suas leituras como métricas com nomes segundo as convenções `iot_*` e dê a cada ponto de dados um atributo `device.id`, por exemplo:",
  "| Metric | Value | Datapoint attribute |":
    "| Métrica | Valor | Atributo do ponto de dados |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "O inventário de dispositivos é indexado pelo `device.id` do ponto de dados, não pelo do recurso, então defina-o em cada medição e também em `OTEL_RESOURCE_ATTRIBUTES`. Todos os nomes reconhecidos estão em **Convenções de métricas**, em Avançado.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Confirme que o dispositivo exporta sem erros: verifique nos registros do SDK se há falhas de exportação e respostas HTTP `401` ou `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. No painel do OneUptime, abra a seção **IoT**: sua frota deve aparecer em cerca de um minuto.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Abra a aba **Dispositivos** da frota: cada `device.id` enviado deve aparecer com o último estado de bateria, sinal, temperatura, CPU, memória e ativo/inativo.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Abra **Métricas** na frota para traçar qualquer uma das séries `iot_*`.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Não há nenhum agente para instalar no dispositivo. O OneUptime associa seus dispositivos a dois conceitos usando atributos do OpenTelemetry:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Frota**: um grupo lógico de dispositivos (por exemplo `building-a-sensors` ou `field-gateways`). A frota é derivada do atributo de recurso `iot.fleet.name` e aparece no OneUptime como o serviço de telemetria `iot/<fleet>`. Defina `service.name=iot/<fleet>` para que registros e métricas fiquem sob o mesmo serviço.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Dispositivo**: um dispositivo individual dentro de uma frota, identificado pelo atributo `device.id` de cada ponto de dados. O OneUptime cria e mantém um inventário de dispositivos por frota, indexado por `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Os atributos que o OneUptime lê; os opcionais refinam como cada dispositivo é classificado e delimitado nos monitores:",
  "| Attribute | Set on | Required | Description |":
    "| Atributo | Definido em | Obrigatório | Descrição |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Recurso | Sim | A frota à qual este dispositivo pertence. Torna-se o serviço do OneUptime `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Cada ponto de dados | Sim | Id estável e único do dispositivo dentro da frota |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Cada ponto de dados | Não | A classe do dispositivo, por exemplo `Device`, `Sensor` ou `Gateway`. Padrão: `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Cada ponto de dados | Não | Um tipo ou modelo de dispositivo mais específico, usado para filtrar monitores (por exemplo `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Cada ponto de dados | Não | Versão do firmware informada pelo dispositivo |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "O OneUptime reconhece os seguintes nomes de métricas `iot_*`. Cada ponto de dados deve levar o rótulo `device.id` para que a leitura seja atribuída ao dispositivo certo. Você só precisa enviar as métricas que fazem sentido para o seu dispositivo: as que faltarem simplesmente não são traçadas.",
  "| Metric Name | Meaning |": "| Nome da métrica | Significado |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Disponibilidade do dispositivo. `1` = ativo/acessível, `0` = inativo. Alimenta o monitor de dispositivos IoT |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Sinal só de identidade. Leva `device.id` / classe / tipo / firmware para que um dispositivo apareça no inventário antes mesmo de enviar leituras |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Nível de carga da bateria, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Intensidade do sinal sem fio em dBm (por exemplo, RSSI de Wi-Fi, LoRa ou celular) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Temperatura do dispositivo ou do sensor em °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | Uso de CPU como proporção `0`–`1` (o inventário de dispositivos a mostra como porcentagem) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Memória em uso no momento, em bytes |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Memória total disponível no dispositivo, em bytes |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Segundos desde a última inicialização do dispositivo |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Verifique se `iot.fleet.name` está definido como atributo de **recurso** (não como rótulo do ponto de dados) e se `service.name` é `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Confirme que o endpoint do exportador é `<YOUR_ONEUPTIME_URL>/otlp` e que o cabeçalho `x-oneuptime-token` leva uma chave de ingestão válida.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Garanta que cada ponto de dados leve um rótulo `device.id`: os dispositivos são indexados por ele.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Envie `iot_device_info` (só identidade) para os dispositivos que ainda não enviaram leituras, para que apareçam mesmo assim no inventário.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Verifique se os valores de `device.id` são estáveis entre os envios; um id que muda cria linhas de dispositivo duplicadas.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` significa que a chave de ingestão está ausente, errada ou expirada; `422` significa que ela foi desativada ou é uma chave de navegador, que não pode enviar telemetria de dispositivos. Selecione outra chave acima (ou crie uma nova) e atualize o cabeçalho `x-oneuptime-token` que seu dispositivo ou coletor envia.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Use os nomes exatos de métricas `iot_*` de **Convenções de métricas**, em Avançado: outros nomes são armazenados como métricas genéricas e não preenchem os gráficos de IoT.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` é uma proporção `0`–`1`; envie a proporção bruta e o OneUptime a exibe como porcentagem.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Aguarde até um minuto para que os primeiros pontos de dados apareçam depois que um dispositivo começar a enviar.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Isso envia as leituras para a frota **`fleet-1`**. Substitua `sensor-001` pelo id do dispositivo e mantenha `iot.fleet.name` exatamente como está: outro nome registra uma nova frota.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Um gateway capaz de executar o OpenTelemetry Collector (com Docker ou com o binário `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Dispositivos que enviam OTLP ao gateway, e acesso de rede do gateway à sua instância do OneUptime",
  "Save this as `config.yaml` on the gateway:":
    "Salve isto como `config.yaml` no gateway:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Defina `iot.fleet.name` (e o `service.name=iot/<fleet>` correspondente) em cada gateway para que os dispositivos de cada gateway caiam na frota certa.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Mantenha `device.id` (e, opcionalmente, `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) em cada ponto de dados para que o OneUptime possa identificar o dispositivo individual dentro da frota.",
  "Run it from the directory that holds `config.yaml`:":
    "Execute-o a partir do diretório que contém `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Os dispositivos então enviam OTLP ao gateway (gRPC na porta `4317`, HTTP na porta `4318`), por exemplo com `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` no SDK de cada dispositivo.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Já tem `otelcol-contrib` no gateway? Aponte-o para o arquivo:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Confirme que o coletor do gateway exporta sem erros: verifique nos registros dele se há falhas de exportação e respostas HTTP `401` ou `422` (`docker logs -f otel-collector` quando ele roda no Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** recebe dos seus dispositivos via gRPC (`4317`) e HTTP (`4318`). Receba leituras de qualquer outra forma que o coletor suporte (uma ponte MQTT, registros em arquivo, …) e encaminhe-as pelo mesmo pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** marca cada registro com os atributos da frota. Defina `iot.fleet.name` (e o `service.name=iot/<fleet>` correspondente) em cada gateway para que os dispositivos de cada gateway caiam na frota certa.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** agrupa os registros antes da exportação para que o gateway não pague uma ida e volta HTTP por leitura.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** envia ao OneUptime via HTTPS com o token de ingestão anexado. Tanto a codificação protobuf padrão quanto `encoding: json` são aceitas.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Cada leitura que este gateway encaminha vai para a frota **`fleet-1`**: mantenha `iot.fleet.name` e `service.name` exatamente como estão, ou as leituras registram uma nova frota. Um gateway de outra frota define os seus.",
  "Any MQTT client that can connect over WebSocket":
    "Qualquer cliente MQTT que consiga se conectar via WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Por exemplo, com o cliente `mqtt` do Node.js (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Substitua `building-a-sensors` e `sensor-001` pelo nome da sua frota e pelo id do dispositivo: o OneUptime cria a frota e o dispositivo a partir do tópico. O Last Will informa que o dispositivo está offline no momento em que a conexão cai; dispositivos que se conectam diretamente se saem melhor com uma credencial própria (ambos em Avançado).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Confirme que o cliente se conecta e publica sem erros: uma conexão recusada com o código de retorno 4 (usuário ou senha incorretos) significa que a chave está errada.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Abra a aba **Dispositivos** da frota: cada dispositivo para o qual você publicou deve aparecer com o último estado de bateria, sinal, temperatura, CPU, memória e ativo/inativo.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Não há nenhum agente para instalar no dispositivo. O OneUptime associa seus dispositivos a dois conceitos e, com MQTT, o tópico define os dois:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Frota**: o `<fleet>` em `oneuptime/<fleet>/…`, um grupo lógico de dispositivos (por exemplo `building-a-sensors`). Torna-se o `iot.fleet.name` das leituras e aparece no OneUptime como o serviço de telemetria `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Dispositivo**: o `<device>` em `oneuptime/<fleet>/<device>/…`, um dispositivo individual dentro da frota. Torna-se o `device.id` de cada leitura, e o OneUptime cria e mantém um inventário de dispositivos por frota indexado por ele.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Atributos opcionais refinam como cada dispositivo é classificado e delimitado nos monitores. Coloque-os no mapa `"attributes"` de uma publicação de telemetria: eles são aplicados a cada ponto de dados dessa publicação:',
  "| Attribute | Description |": "| Atributo | Descrição |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | A classe do dispositivo, por exemplo `Device`, `Sensor` ou `Gateway`. Padrão: `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Um tipo ou modelo de dispositivo mais específico, usado para filtrar monitores (por exemplo `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Versão do firmware informada pelo dispositivo |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "O OneUptime reconhece os seguintes nomes de métricas `iot_*`. Com MQTT, o tópico nomeia o dispositivo, então cada leitura é atribuída a ele. Você só precisa enviar as métricas que fazem sentido para o seu dispositivo: as que faltarem simplesmente não são traçadas.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "A chave de ingestão do projeto inteiro serve para gateways que publicam em nome de muitos dispositivos. Para dispositivos que se conectam diretamente, registre cada um na aba **Registro de dispositivos** da frota: ela emite uma credencial por dispositivo; o ID da credencial é o **usuário** MQTT e o segredo é a **senha**. A frota aparece com sua primeira leitura, então envie primeiro uma com a chave do projeto, como na etapa 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Isolamento de tópicos**: uma credencial de dispositivo só pode publicar sob os próprios tópicos `oneuptime/<fleet>/<device>/…`; todo o resto é descartado.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Revogação individual**: desative ou exclua a credencial de um dispositivo sem mexer no resto da frota; um dispositivo conectado é desligado em poucos segundos.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Detecção de queda silenciosa**: um dispositivo registrado permanece no inventário como offline quando para de enviar, em vez de sumir, mesmo que caia sem Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registre um **Last Will** do MQTT em `oneuptime/<fleet>/<device>/status` com o payload `offline`: se o dispositivo cair, o OneUptime publica `iot_device_up = 0` em nome dele no momento em que a sessão cai, o que dispara o modelo de alerta Device Offline incluído, sem polling. Publique `online` no mesmo tópico depois de conectar para que o dispositivo volte a aparecer como ativo; o exemplo da etapa 2 faz as duas coisas. Qualquer leitura que o dispositivo publica também conta como ativo, então um dispositivo que continua enviando leituras permanece ativo sem publicar o status de novo. O tópico de status também aceita `1`/`0`, `true`/`false` e `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Mantenha o keepalive do MQTT **abaixo de 5 minutos** no endpoint WebSocket (os padrões de 60 s das bibliotecas cliente servem): conexões WebSocket ociosas são fechadas após 300 segundos, o que dispararia o Last Will e um falso alerta de offline.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Publique sob o prefixo fixo `oneuptime/`. Os segmentos de frota e de dispositivo não podem conter `/`, `+` ou `#` nem começar com `$`, e são limitados a 100 caracteres.",
  "| Topic | Payload |": "| Tópico | Payload |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Um objeto JSON de leituras, `{"metrics":{"iot_temperature_celsius":21.5}}`, ou um objeto plano cujos campos numéricos são as métricas |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Um único valor: um número simples (`23.4`) ou `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` ou `offline`, convertido em `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Os payloads de telemetria também podem levar `"attributes"` (um mapa de strings aplicado a cada ponto de dados; use-o para `iot.device.kind`, `iot.device.type`, `iot.device.firmware` ou seus próprios rótulos) e `"timestamp"` (ISO-8601, ou segundos/milissegundos Unix). Ambos são opcionais; o horário de ingestão é usado quando `timestamp` está ausente.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "O endpoint é só de ingestão: assinaturas são recusadas. Uma publicação é limitada a 128 KB e 100 métricas. Publicações fora deste contrato, ou com payloads malformados, são aceitas e descartadas (o MQTT 3.1.1 não tem resposta de erro por mensagem), e o OneUptime registra um aviso com o motivo.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Instalações auto-hospedadas podem expor também MQTT puro sobre TCP (`MQTT_INGEST_PORT`, padrão `1883`). O listener é interno à rede do cluster ou do Compose por padrão: exponha-o se seus dispositivos não falarem WebSocket. O limite de keepalive do WebSocket não se aplica ali.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Defina `MQTT_INGEST_ENABLED=false` no serviço do app para desligar os listeners MQTT.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Confirme que o tópico segue exatamente `oneuptime/<fleet>/<device>/…`: é o segmento de frota do tópico que cria a frota.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Publicações fora do contrato de tópicos, ou com payloads malformados, são aceitas e descartadas (o MQTT 3.1.1 não tem resposta de erro por mensagem). Compare as suas com **Tópicos e payloads MQTT**, em Avançado; em uma instância auto-hospedada, os registros do app informam o motivo (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "O OneUptime rejeita credenciais incorretas no CONNECT com o código de retorno 4. Verifique se:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- a senha é uma chave de ingestão válida ou, para um dispositivo registrado, o segredo da credencial, com o ID da credencial como usuário;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- a chave é uma chave de servidor (chaves de navegador são recusadas via MQTT) e não foi desativada nem expirou.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. O id do dispositivo é o segmento `<device>` do tópico: mantenha-o estável entre publicações; um id que muda cria linhas de dispositivo duplicadas.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Publique `iot_device_info` (só identidade) ou uma mensagem `status` para os dispositivos que ainda não enviaram leituras, para que apareçam mesmo assim no inventário.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "No endpoint WebSocket, conexões ociosas são fechadas após 300 segundos, o que dispara o Last Will e um falso alerta Device Offline. Mantenha o keepalive do MQTT abaixo de 5 minutos; os padrões de 60 s das bibliotecas cliente servem.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Substitua `sensor-001` pelo id do dispositivo: o OneUptime adiciona o dispositivo à frota **`fleet-1`** a partir do tópico. O Last Will informa que o dispositivo está offline no momento em que a conexão cai; dispositivos que se conectam diretamente se saem melhor com uma credencial própria (ambos em Avançado).",
};

export default TRANSLATION;
