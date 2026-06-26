# Monitoramento de Usuário Real (Navegador e Dispositivos Móveis)

## Visão Geral

O OneUptime classifica a telemetria recebida como **RUM** quando ela carrega atributos de cliente — `browser.*` para web ou `device.*` para dispositivos móveis. Cada aplicação é identificada pelo seu `service.name` e pertence inteiramente à sua aplicação RUM (a telemetria de cliente nunca é duplicada como um Service de backend).

Use-o para ver o que seus usuários realmente experimentam: visualizações de página, erros, latência, as plataformas / dispositivos em uso e — quando seu SDK os emite — Core Web Vitals.

## Pré-requisitos

- Um **Token de Ingestão de Telemetria do OneUptime** — crie um a partir de _Project Settings → Telemetry Ingestion Keys_.
- O SDK do OpenTelemetry para navegador ou dispositivos móveis.

## Como o OneUptime identifica uma aplicação RUM

| Atributo                 | Obrigatório              | Finalidade                                         |
| ------------------------ | ------------------------ | -------------------------------------------------- |
| `service.name`           | **sim**                  | Identidade da aplicação (ex.: `storefront-web`)    |
| `browser.*`              | para web                 | Marca a telemetria como RUM de navegador           |
| `device.*`               | para dispositivos móveis | Marca a telemetria como RUM de dispositivos móveis |
| `telemetry.sdk.language` | não                      | ex.: `webjs`, `swift`, exibido na visão geral      |

## Navegador (OpenTelemetry Web)

Aponte o exportador OTLP/HTTP para o OneUptime e defina `service.name` com o nome da sua aplicação:

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

A instrumentação do navegador adiciona os atributos de recurso `browser.*` automaticamente — é isso que roteia os dados para o RUM.

## Dispositivos Móveis (Swift / Android)

Use o SDK do OpenTelemetry para Swift ou Android, defina `service.name` e exporte OTLP para o OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Os atributos `device.*` do SDK roteiam a telemetria para o RUM. Se você hospedar o OneUptime por conta própria, use `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Se a instrumentação do seu navegador emite web vitals (LCP, INP, CLS, FCP, TTFB) como métricas do OpenTelemetry, o OneUptime as apresenta na visão geral da aplicação com classificações de bom / precisa-melhorar / ruim. Se nenhuma métrica de web vital for reportada, o painel explica como começar a enviá-las.

## O que você obtém

- **Visualizações de página**, **taxa de erros** e **duração p95** com gráficos de tendência ao longo de um intervalo selecionável.
- **Clientes** — as plataformas de navegador / modelos de dispositivo observados.
- **Core Web Vitals** (quando reportados).
- Abas completas de **Logs**, **Traces** e **Metrics** com escopo na aplicação.
