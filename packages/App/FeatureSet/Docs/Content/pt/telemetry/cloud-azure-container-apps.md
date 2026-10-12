# Azure Container Apps

Envie os traços, logs e métricas dos seus Azure Container Apps para o OneUptime. Toda réplica que reporta `cloud.platform=azure_container_apps` entra em um **Cloud Environment** por assinatura do Azure e região, como _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, com as réplicas em execução listadas em **Instâncias**.

:::cards
- [Como funciona](#como-funciona): O que os detectores definem, e os dois atributos que você mesmo define.
- [Configuração](#configuração): Guardar o token, configurar o app com a CLI do Azure ou com o portal, e verificar.
- [Usar o agente OpenTelemetry gerenciado do ambiente](#usar-o-agente-opentelemetry-gerenciado-do-ambiente): Encaminhar todos os apps do ambiente sem sidecar.
- [Solução de problemas](#solução-de-problemas): Exportações recusadas, ambientes ausentes e instâncias vazias.
:::

## Como funciona

```mermaid title="De onde vêm os atributos de uma réplica do Container Apps"
flowchart TB
    detector["Detector do Azure:<br/>plataforma e réplica"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: região<br/>e assinatura"] --> exporter
    exporter["Seu app, ou o<br/>coletor sidecar dele"] -->|"OTLP por HTTPS"| ou["OneUptime"]
    ou --> env["Ambiente de nuvem<br/>assinatura e região"]
    ou --> inst["Instâncias<br/>uma linha por réplica"]
```

O Container Apps tem detectores de recursos: o detector `azurecontainerapps` do Collector, e os de Node.js (`@opentelemetry/resource-detector-azure`) e .NET (`OpenTelemetry.Resources.Azure`). Eles leem `CONTAINER_APP_NAME` e `CONTAINER_APP_REPLICA_NAME`, e definem `cloud.provider`, `cloud.platform`, `service.name` e o ID da réplica. Nenhum deles conhece a região ou a assinatura, então você mesmo define `cloud.region` e `cloud.account.id`, em `OTEL_RESOURCE_ATTRIBUTES`.

| Atributo | Valor | Para que serve |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Mostrado na visão geral |
| `cloud.platform` | `azure_container_apps` | Arquiva a telemetria em **Ambientes de nuvem** |
| `cloud.region` | a região do ambiente, como `eastus`: definida por você | Parte da chave do ambiente |
| `cloud.account.id` | o ID da assinatura: definido por você | Parte da chave do ambiente |
| `azure.container_app.instance.id` | o nome da réplica, definido pelos detectores a partir de `CONTAINER_APP_REPLICA_NAME` | Nomeia uma réplica em execução: uma linha para cada em **Instâncias** |
| `service.instance.id` | o nome da réplica, se você mesmo o definir | Usado quando nenhum detector definiu o ID da réplica |

- **Grafias com ponto funcionam.** Os detectores de Node.js e .NET escrevem a plataforma como `azure.container_apps`, com um ponto. O OneUptime a reescreve como `azure_container_apps` ao recebê-la, então as duas grafias caem no mesmo ambiente.
- **O nome do host é o nome da réplica.** Um SDK que roda só o detector `host` informa o nome da réplica como `host.name`, e o OneUptime nomeia a instância por ele quando não há nada mais específico.

A chave do ambiente é `azure_container_apps|<subscription id>|eastus`.

## Antes de começar

- **Uma chave de ingestão.** Crie uma chave **Servidor** em **Configurações do projeto → Telemetria e APM → Chaves de ingestão** e copie o token dela.
- **A CLI do Azure com a extensão `containerapp`** (`az extension add --name containerapp --upgrade`), conectada à assinatura, ou o portal do Azure.
- **Sua aplicação instrumentada com um SDK do OpenTelemetry** que exporte OTLP.

## Escolher como a telemetria sai do app

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Contêiner extra | Nenhum | `otel-collector` no app, dividindo a CPU e a memória da réplica |
| Define os atributos | O SDK e `OTEL_RESOURCE_ATTRIBUTES` no app | O coletor, para tudo o que passa por ele |
| O segredo | `oneuptime-otlp-headers`, o cabeçalho completo | `oneuptime-token`, só o token |

Uma terceira forma, o agente OpenTelemetry gerenciado do ambiente, encaminha todos os apps do ambiente sem sidecar: veja [Usar o agente OpenTelemetry gerenciado do ambiente](#usar-o-agente-opentelemetry-gerenciado-do-ambiente). Cada etapa abaixo tem uma aba para SDK direct e outra para o coletor sidecar; escolha uma e todas as etapas a seguem.

## Configuração

:::steps
### Guardar o token como um segredo do Container Apps

> [!IMPORTANT]
> O token é um segredo. Guarde-o como um segredo do Container Apps e faça referência a ele nas variáveis de ambiente com `secretref:`. Depois de definido, um segredo não aparece em `az containerapp show` nem no portal; uma variável de ambiente comum aparece.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

O `OTEL_EXPORTER_OTLP_HEADERS` do SDK precisa do cabeçalho `name=value` completo, então o segredo o contém.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

O coletor acrescenta o nome do cabeçalho, então o segredo contém só o token.
:::

No portal: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Digite a chave, escolha o tipo **Container Apps secret**, cole o valor e clique em **Add**.

Se você guarda segredos no Key Vault, faça referência ao segredo em vez de copiar o valor. A identidade gerenciada do app precisa da função **Key Vault Secrets User** no cofre:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Configurar o aplicativo de contêiner

:::tabs
@tab SDK direct
Defina o exportador, e os atributos que nenhum detector conhece, no contêiner da aplicação. Substitua a região e o ID da assinatura pelos seus:

```bash
az containerapp update \
  --name checkout-api \
  --resource-group my-rg \
  --set-env-vars \
    OTEL_SERVICE_NAME=checkout-api \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_EXPORTER_OTLP_HEADERS=secretref:oneuptime-otlp-headers \
    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000"
```

Para a identidade da réplica, ative o detector do Azure do SDK: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` no Node.js, ou `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` com `OpenTelemetry.Resources.Azure` no .NET. Ele define `azure.container_app.instance.id` a partir de `CONTAINER_APP_REPLICA_NAME`.

O Container Apps não consegue colocar uma variável de ambiente dentro de outra, então nas outras linguagens `service.instance.id` não pode ir em `OTEL_RESOURCE_ATTRIBUTES`. Ative o detector de host (o `host.name` dele é o nome da réplica), ou defina-o no código:

```js title="tracing.js"
// Node.js: the file you load with --require before the app starts
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.instance.id": process.env.CONTAINER_APP_REPLICA_NAME,
  }),
});
sdk.start();
```

```python title="tracing.py"
# Python: before the tracer provider is created
import os
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.instance.id": os.environ.get("CONTAINER_APP_REPLICA_NAME", "")})
```

Seja qual for o detector, mantenha `cloud.region` e `cloud.account.id` em `OTEL_RESOURCE_ATTRIBUTES`: nenhum detector do Container Apps os define, e a chave do ambiente precisa deles.

Ou, no portal:

1. Abra **Application → Containers → Edit and deploy**, selecione seu contêiner na aba **Container** e clique em **Edit**.
2. Em **Environment variables**, adicione cada variável acima com a origem **Manual entry**, e `OTEL_EXPORTER_OTLP_HEADERS` com a origem **Reference a secret**, apontando para `oneuptime-otlp-headers`.
3. Clique em **Save**.
@tab Sidecar collector
Um sidecar roda na mesma réplica, então vê as mesmas `CONTAINER_APP_NAME` e `CONTAINER_APP_REPLICA_NAME`. O detector `azurecontainerapps` dele as transforma em `cloud.provider`, `cloud.platform`, `service.name` e `azure.container_app.instance.id`, e o detector `env` dele lê `cloud.region` e `cloud.account.id` de `OTEL_RESOURCE_ATTRIBUTES` no próprio ambiente do coletor. A aplicação só exporta para `http://localhost:4318`.

Exporte a definição do app, adicione o coletor a `template.containers` e aplique-a:

```bash
az containerapp show --name checkout-api --resource-group my-rg -o yaml > checkout-api.yaml
# edit checkout-api.yaml as below
az containerapp update --name checkout-api --resource-group my-rg --yaml checkout-api.yaml
```

```yaml title="checkout-api.yaml"
properties:
  configuration:
    secrets:
      - name: oneuptime-token
        value: YOUR_TELEMETRY_INGESTION_TOKEN
  template:
    containers:
      - name: app
        image: myregistry.azurecr.io/checkout-api:1.4.2
        env:
          - name: OTEL_SERVICE_NAME
            value: checkout-api
          - name: OTEL_EXPORTER_OTLP_ENDPOINT
            value: http://localhost:4318
          - name: OTEL_EXPORTER_OTLP_PROTOCOL
            value: http/protobuf
        resources:
          cpu: 0.5
          memory: 1Gi
      - name: otel-collector
        image: otel/opentelemetry-collector-contrib:latest
        args:
          - --config=env:OTEL_COLLECTOR_CONFIG
        env:
          - name: ONEUPTIME_TOKEN
            secretRef: oneuptime-token
          # Read by the resourcedetection processor's env detector.
          - name: OTEL_RESOURCE_ATTRIBUTES
            value: cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000
          - name: OTEL_COLLECTOR_CONFIG
            value: |
              receivers:
                otlp:
                  protocols:
                    http:
                      endpoint: 0.0.0.0:4318
                    grpc:
                      endpoint: 0.0.0.0:4317
              processors:
                # env: cloud.region + cloud.account.id from OTEL_RESOURCE_ATTRIBUTES.
                # azurecontainerapps: cloud.provider, cloud.platform, service.name
                # and azure.container_app.instance.id from the CONTAINER_APP_*
                # variables. override: false keeps the service.name the
                # application set instead of the Container App's name.
                resourcedetection:
                  detectors: [env, azurecontainerapps]
                  timeout: 2s
                  override: false
                batch: {}
              exporters:
                otlphttp/oneuptime:
                  endpoint: https://oneuptime.com/otlp
                  headers:
                    x-oneuptime-token: ${env:ONEUPTIME_TOKEN}
              service:
                pipelines:
                  traces:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
                  metrics:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
                  logs:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
        resources:
          cpu: 0.25
          memory: 0.5Gi
```

`az containerapp show` não exporta os valores dos segredos, então adicione de volta a entrada `secrets` à mão, ou deixe-a de fora se você definiu o segredo na primeira etapa: uma atualização mantém os segredos existentes. O Container Apps soma a CPU e a memória de todos os contêineres de uma réplica, então os `resources` do sidecar contam contra os do app.

Ou, no portal:

1. Abra **Application → Containers → Edit and deploy**. Na aba **Container**, use **+ Add** para um contêiner chamado `otel-collector` com a imagem `otel/opentelemetry-collector-contrib:latest` e o **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Adicione as variáveis de ambiente dele: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` e `OTEL_COLLECTOR_CONFIG` (**Manual entry**, com os valores acima).
3. Clique em **Save**.
:::

Se você hospeda o OneUptime por conta própria, use `https://YOUR-ONEUPTIME-HOST/otlp` como endpoint.

### Implantar a nova revisão

`az containerapp update` implanta uma nova revisão por conta própria. No portal, clique em **Create**. Se várias revisões estiverem ativas, mova o tráfego para a nova em **Revisions and replicas**.

### Verificar a conexão

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` com `"valid": true` significa que o token é aceito. `401` significa que ele é desconhecido, revogado, desativado ou expirado. Depois leia a saída do coletor:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Procure por `Everything is ready`, e nenhum `401` ou `connection refused`. Em um minuto após o primeiro span, log ou métrica, o ambiente aparece em **Nuvem → All Environments** como _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Usar o agente OpenTelemetry gerenciado do ambiente

Um ambiente do Container Apps pode rodar o agente OpenTelemetry gerenciado do Azure. Ele recebe OTLP de todos os apps do ambiente e o encaminha para um endpoint que você configura, sem sidecar em cada app. O agente exporta **só por OTLP/gRPC**, então não pode usar o caminho HTTP `/otlp`. Aponte-o para o host do OneUptime na porta 443, onde o OneUptime serve OTLP/gRPC sobre TLS:

```bash
az containerapp env telemetry otlp add \
  --name my-aca-env \
  --resource-group my-rg \
  --otlp-name oneuptime \
  --endpoint oneuptime.com:443 \
  --insecure false \
  --headers "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true \
  --enable-open-telemetry-metrics true
```

- **Auto-hospedado:** use `YOUR-ONEUPTIME-HOST:443`. Um OneUptime auto-hospedado só aceita OTLP/gRPC sobre TLS: veja [OTLP sobre gRPC](/docs/telemetry/open-telemetry#otlp-sobre-grpc).
- **Os apps ainda definem os atributos.** O agente coloca o próprio `OTEL_EXPORTER_OTLP_ENDPOINT` e `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` em todos os apps, então deixe esses dois de fora do app e mantenha `OTEL_SERVICE_NAME` e `OTEL_RESOURCE_ATTRIBUTES`. O agente encaminha o que os apps enviam, então `cloud.*` e o ID da réplica ainda vêm de cada app.
- **O seu `OTEL_RESOURCE_ATTRIBUTES` prevalece.** O agente também define `OTEL_RESOURCE_ATTRIBUTES`, e um valor definido no app o substitui: inclua no seu o nome do Container App e o ID da réplica, ou defina-os no código.

## Rede

- **O tráfego de saída é liberado por padrão.** Uma réplica alcança `oneuptime.com:443` sem nenhuma configuração, seja a entrada do ambiente externa ou interna.
- **VNets personalizadas são a exceção.** Em uma VNet com uma rota definida pelo usuário que envia `0.0.0.0/0` para um firewall ou um gateway NAT, ou com um grupo de segurança de rede na sub-rede, libere TCP 443 para o host do OneUptime (ou a porta do seu próprio host) no firewall ou no NSG.
- **Um OneUptime auto-hospedado dentro da VNet** precisa ser resolvível e roteável a partir da sub-rede do ambiente.
- **Nenhuma função do Azure é necessária para a telemetria.** Só as referências ao Key Vault exigem que a identidade gerenciada do app tenha **Key Vault Secrets User** no cofre.

## O que você recebe

- **Visão geral**: requisições, taxa de erro e latência p95 dos seus traços. O Container Apps não mostra a um sidecar o uso de recursos de uma réplica, então os blocos **CPU** e **Memória** só se preenchem se você enviar métricas `container.cpu.utilization` e `container.memory.usage` com a identidade da réplica. A maioria das equipes deixa isso para o Azure Monitor.
- **Instâncias**: uma linha por réplica, nomeada pelo `azure.container_app.instance.id` dos detectores, pelo `service.instance.id` quando você mesmo o define, ou pelo `host.name` quando só o detector de host rodou.
- **Registros**, **Traços** e **Métricas**, filtrados para o ambiente, e a visão por serviço em **Serviços**.

## Solução de problemas

:::details Nada aparece, e o coletor registra 401
O segredo contém o valor errado. `oneuptime-token` precisa ser só o token; `oneuptime-otlp-headers`, o cabeçalho completo `x-oneuptime-token=...`.
:::

:::details O app está em Serviços, mas não existe nenhum ambiente
`OTEL_RESOURCE_ATTRIBUTES` está faltando, ou `cloud.platform` não é exatamente `azure_container_apps`. Veja o que o app tem com `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details O ambiente existe, mas Instâncias está vazia
Nenhum entre `service.instance.id`, `azure.container_app.instance.id` e `host.name` está no recurso. Adicione o detector `azurecontainerapps` ao coletor, ative o detector do Azure ou de host do SDK, ou defina `service.instance.id` no código.
:::

:::details Dois ambientes para uma assinatura
Um app define `cloud.region` (ou `cloud.account.id`) e outro não, ou um escreve a região de outro jeito (`eastus` e `East US`). Os valores precisam coincidir caractere por caractere.
:::

Todo o resto está em [Solução de problemas na nuvem](/docs/telemetry/cloud-troubleshooting).

## Próximos passos

:::cards
- [Ambientes de nuvem](/docs/telemetry/cloud-environments): Como ambientes e instâncias são identificados.
- [Outras plataformas de nuvem](/docs/telemetry/cloud-other-platforms): Azure App Service e Azure Container Instances.
- [Solução de problemas na nuvem](/docs/telemetry/cloud-troubleshooting): As falhas que todas as plataformas compartilham.
- [Recursos de nuvem (IaaS e PaaS)](/docs/telemetry/cloud-resources): Todos os recursos da sua assinatura, a partir do Azure Monitor.
:::
