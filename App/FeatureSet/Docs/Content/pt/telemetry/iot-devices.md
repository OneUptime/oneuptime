# Dispositivos IoT do OneUptime

## Visão geral

O OneUptime monitora frotas de dispositivos IoT — sensores, gateways, controladores e edge boxes — ingerindo métricas OpenTelemetry (OTLP) padrão. Cada dispositivo (ou um gateway em seu nome) envia um pequeno conjunto de métricas `iot_*` via OTLP HTTP, marcado com a **frota** à qual pertence e seu próprio **device id**. O OneUptime agrupa essas métricas em uma frota, constrói um inventário de dispositivos ao vivo e acompanha bateria, conectividade, temperatura, CPU, memória e disponibilidade por dispositivo.

Não há agente para instalar no lado do dispositivo — qualquer coisa que fale OTLP (um SDK OpenTelemetry no dispositivo, ou um OpenTelemetry Collector em execução em um gateway que distribui para muitos dispositivos) funciona. Esta página é o **guia de ingestão**. Para configurar monitores e alertas de IoT sobre os dados que você envia, consulte [Monitor de Dispositivo IoT](/docs/monitor/iot-device-monitor).

## Pré-requisitos

- Um dispositivo, gateway ou coletor que possa enviar OTLP/HTTP para o OneUptime
- Acessibilidade de rede do dispositivo/gateway até a sua instância do OneUptime
- Um **OneUptime Telemetry Ingestion Token** — crie um em _Project Settings → Telemetry Ingestion Keys_ e copie o valor de `x-oneuptime-token`

## Como o OneUptime modela IoT

O OneUptime mapeia seus dispositivos em dois conceitos usando atributos de recurso do OpenTelemetry:

- **Frota** — um grupo lógico de dispositivos (por exemplo `building-a-sensors` ou `field-gateways`). A frota é derivada do atributo de recurso `iot.fleet.name` e aparece no OneUptime como o serviço de telemetria `iot/<fleet>`. Defina `service.name=iot/<fleet>` para que logs e métricas se alinhem sob o mesmo serviço.
- **Dispositivo** — um dispositivo individual dentro de uma frota, identificado pelo atributo `device.id`. O OneUptime constrói e mantém um inventário de dispositivos por frota indexado por `device.id`.

Atributos opcionais refinam como cada dispositivo é classificado e delimitado nos monitores:

| Atributo             | Obrigatório | Descrição                                                                        |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Sim      | A frota à qual este dispositivo pertence. Torna-se o serviço `iot/<fleet>` do OneUptime    |
| `device.id`          | Sim      | Id estável e único para o dispositivo dentro da frota                                |
| `iot.device.kind`    | Não       | A classe do dispositivo — por exemplo `Device`, `Sensor` ou `Gateway`. O padrão é `Device` |
| `iot.device.type`    | Não       | Um tipo/modelo de dispositivo mais detalhado usado para filtrar monitores (por exemplo `temp-sensor`) |
| `iot.device.firmware`| Não       | Versão de firmware reportada pelo dispositivo                                          |

## Enviando métricas via o SDK do OpenTelemetry

Se o seu dispositivo executar um SDK OpenTelemetry diretamente, aponte-o para o OneUptime e carimbe os atributos de recurso IoT por meio das variáveis de ambiente `OTEL_*` padrão. Substitua o token, o endpoint, o nome da frota e o device id por valores do seu ambiente.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Variável de ambiente          | Obrigatório | Descrição                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Sim      | Endpoint OTLP do OneUptime (`https://oneuptime.com/otlp`, ou `http(s)://YOUR-ONEUPTIME-HOST/otlp` self-hosted) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Sim      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Sim      | Atributos de recurso separados por vírgula. Deve incluir `iot.fleet.name`, `device.id` e `service.name=iot/<fleet>` |

Emita suas leituras como métricas usando os nomes `iot_*` abaixo (consulte [Convenções de Métricas](#metric-conventions)). Em cerca de um minuto, o dispositivo aparece na seção **IoT** do dashboard do OneUptime.

## Enviando métricas via um OpenTelemetry Collector

Quando muitos dispositivos reportam por meio de um gateway, execute um OpenTelemetry Collector no gateway e exporte para o OneUptime. O processador `resource` carimba os atributos da frota; receba leituras dos seus dispositivos (OTLP, ponte MQTT, logs de arquivo, etc.) e encaminhe-as:

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
    # O OneUptime requer o codificador JSON em vez do Proto(buf) padrão
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

- O **`resource`** carimba cada registro com os atributos da frota. Defina `iot.fleet.name` (e o `service.name=iot/<fleet>` correspondente) por gateway para que os dispositivos de cada gateway caiam na frota certa.
- Mantenha `device.id` (e opcionalmente `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) em cada datapoint para que o OneUptime possa resolver o dispositivo individual dentro da frota.
- O **`otlphttp`** envia para o OneUptime via HTTPS com o token de ingestão anexado. Observe que `encoding: json` e o cabeçalho `Content-Type: application/json` são obrigatórios.

## Convenções de Métricas

O OneUptime reconhece os seguintes nomes de métricas `iot_*`. Cada datapoint deve carregar o label `device.id` para que a leitura seja atribuída ao dispositivo certo. Você só precisa enviar as métricas que fazem sentido para o seu dispositivo — as ausentes simplesmente não são plotadas em gráficos.

| Nome da Métrica             | Significado                                                                     |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Disponibilidade do dispositivo. `1` = ativo/acessível, `0` = inativo. Aciona o monitor de Dispositivo IoT |
| `iot_device_info`           | Sinal somente de identidade. Carrega `device.id` / kind / type / firmware para que um dispositivo apareça no inventário mesmo antes de reportar leituras |
| `iot_battery_percent`       | Nível de carga da bateria, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Intensidade do sinal sem fio em dBm (por exemplo RSSI de Wi-Fi / LoRa / celular)      |
| `iot_temperature_celsius`   | Temperatura do dispositivo ou sensor em °C                                             |
| `iot_cpu_usage_ratio`       | Utilização de CPU como uma razão `0`–`1` (o OneUptime a armazena como porcentagem)        |
| `iot_memory_usage_bytes`    | Memória atualmente em uso, em bytes                                                |
| `iot_memory_size_bytes`     | Memória total disponível no dispositivo, em bytes                                 |
| `iot_uptime_seconds`        | Segundos desde a última inicialização do dispositivo                                           |

## Verifique a Instalação

1. Confirme que o seu dispositivo ou gateway está exportando sem erros (verifique os logs do SDK/coletor em busca de falhas de exportação e respostas HTTP `401`/`403`).
2. No dashboard do OneUptime, abra a seção **IoT** — sua frota deve aparecer como `iot/<fleet>` em cerca de um minuto.
3. Abra a aba **Devices** da frota — cada `device.id` que você enviou deve estar listado com sua bateria, sinal, temperatura, CPU, memória e status de ativo/inativo mais recentes.
4. Abra **Metrics** na frota para plotar em gráfico qualquer uma das séries `iot_*` acima.

## Solução de Problemas

### A Frota Não Aparece

1. Verifique se `iot.fleet.name` está definido como um atributo de **recurso** (não um label de datapoint) e se `service.name` é `iot/<fleet>`.
2. Confirme que o endpoint do exportador é `https://oneuptime.com/otlp` (ou seu `…/otlp` self-hosted) e que o cabeçalho `x-oneuptime-token` carrega um token válido.
3. Se estiver usando um coletor, certifique-se de que `encoding: json` e `Content-Type: application/json` estejam definidos no exportador `otlphttp`.

### Dispositivos Ausentes no Inventário

1. Certifique-se de que cada datapoint carrega um label `device.id` — os dispositivos são indexados por ele.
2. Envie `iot_device_info` (somente identidade) para dispositivos que ainda não reportaram leituras, para que eles ainda apareçam no inventário.
3. Verifique se os valores de `device.id` são estáveis entre os relatórios; um id que muda cria linhas de dispositivo duplicadas.

### HTTP 401 / 403 do Exportador

O token de ingestão é inválido, foi revogado ou está ausente. Gere um novo em _Project Settings → Telemetry Ingestion Keys_ e atualize o cabeçalho `x-oneuptime-token`.

### Métricas Não Plotadas em Gráficos

1. Confirme que você está usando os nomes de métricas `iot_*` exatos da tabela [Convenções de Métricas](#metric-conventions) — nomes não reconhecidos são armazenados como métricas genéricas e não preencherão os gráficos de IoT.
2. Lembre-se de que `iot_cpu_usage_ratio` é uma razão `0`–`1`; envie a razão bruta e o OneUptime a renderiza como porcentagem.
3. Aguarde até um minuto para que os primeiros datapoints apareçam depois que um dispositivo começa a reportar.

## OneUptime self-hosted

Se você estiver hospedando o OneUptime por conta própria, aponte o endpoint para a sua própria instância:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Ou, em um coletor:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Se a sua instância for somente HTTP, altere o esquema para `http://` e use a porta apropriada.

## Próximos passos

- Configure um **Monitor de Dispositivo IoT** para alertar sobre condições de dispositivo offline, bateria baixa, sinal fraco, temperatura alta e CPU alta — consulte [Monitor de Dispositivo IoT](/docs/monitor/iot-device-monitor).
- Para hosts não conteinerizados (VMs Linux / macOS / Windows e bare metal), use o [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Para aprender a integração OTLP subjacente em profundidade, consulte [Integre o OpenTelemetry com o OneUptime](/docs/telemetry/open-telemetry).
