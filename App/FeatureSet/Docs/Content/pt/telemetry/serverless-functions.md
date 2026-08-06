# Funções Serverless

## Visão Geral

O OneUptime reconhece automaticamente uma **Função serverless** no momento em que recebe dados do OpenTelemetry marcados com o atributo de recurso `faas.name`. Não há nada para criar manualmente — instrumente sua função com o OpenTelemetry SDK para o seu runtime, aponte o exportador OTLP dela para o OneUptime, e a função aparece em **Funções serverless** com seus traces, logs e métricas.

Isso funciona para AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers, ou qualquer runtime FaaS capaz de emitir OpenTelemetry.

## Pré-requisitos

- Um **Token de Ingestão de Telemetria do OneUptime** — crie um em _Configurações do projeto → Telemetria e APM → Chaves de ingestão_ e copie o valor `x-oneuptime-token`.
- O OpenTelemetry SDK (ou uma camada de auto-instrumentação) para a linguagem da sua função.

## Como o OneUptime identifica uma função

O OneUptime indexa cada função pelo atributo de recurso `faas.name`:

| Atributo                                               | Obrigatório | Finalidade                                                  |
| ------------------------------------------------------ | ----------- | ----------------------------------------------------------- |
| `faas.name`                                            | **sim**     | Identidade da função (ex.: `checkout-handler`)              |
| `faas.version`                                         | não         | Exibido na visão geral                                      |
| `faas.instance`                                        | não         | Rastreado por instância na aba **Instâncias**               |
| `cloud.platform`                                       | não         | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | não         | Exibido na visão geral                                      |

> Uma função que também define `service.name` continua aparecendo em **Serviços** também. A visão **Funções serverless** é a lente focada em FaaS, delimitada por `faas.name`.

## Passo 1 — Defina as variáveis de ambiente do exportador OTLP

A maioria das auto-instrumentações de linguagem respeita as variáveis de ambiente padrão do OpenTelemetry:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Se você hospeda o OneUptime por conta própria, substitua o endpoint por `https://YOUR-ONEUPTIME-HOST/otlp`.

## Passo 2 — (AWS Lambda) adicione a camada do OpenTelemetry

Para o AWS Lambda, o caminho mais simples é a [camada Lambda do OpenTelemetry](https://opentelemetry.io/docs/faas/lambda-auto/). Anexe a camada para o seu runtime e defina:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

A camada define `faas.name` a partir do nome da função automaticamente, e o detector de recurso preenche `cloud.platform`, `cloud.region` e `cloud.account.id`.

## O que você obtém

Assim que a função emite um span, log ou métrica, ela aparece em **Funções serverless**. A visão geral mostra:

- **Invocações**, **error rate** e **duração p95** — derivados dos seus traces, em um intervalo de tempo selecionável, com gráficos de tendência.
- **Instâncias** — uma contagem ao vivo dos valores de `faas.instance` observados.
- Abas completas de **Registros**, **Traços** e **Métricas** delimitadas a esta função.

Você também pode aplicar rótulos e proprietários automaticamente em _Serverless → Configurações → Regras de Rótulos / Regras de proprietário_.
