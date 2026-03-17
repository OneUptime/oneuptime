import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Accordion from "Common/UI/Components/Accordion/Accordion";

export type TelemetryType = "logs" | "metrics" | "traces" | "exceptions";

export interface ComponentProps {
  telemetryType?: TelemetryType | undefined;
}

type Language =
  | "node"
  | "python"
  | "go"
  | "java"
  | "dotnet"
  | "rust";

interface LanguageOption {
  key: Language;
  label: string;
}

const languages: Array<LanguageOption> = [
  { key: "node", label: "Node.js / TypeScript" },
  { key: "python", label: "Python" },
  { key: "go", label: "Go" },
  { key: "java", label: "Java" },
  { key: "dotnet", label: ".NET / C#" },
  { key: "rust", label: "Rust" },
];

// --- OpenTelemetry code snippets per language ---

function getOtelInstallSnippet(lang: Language): {
  code: string;
  language: string;
} {
  switch (lang) {
    case "node":
      return {
        code: `npm install @opentelemetry/sdk-node \\
  @opentelemetry/auto-instrumentations-node \\
  @opentelemetry/exporter-trace-otlp-proto \\
  @opentelemetry/exporter-metrics-otlp-proto \\
  @opentelemetry/exporter-logs-otlp-proto`,
        language: "bash",
      };
    case "python":
      return {
        code: `pip install opentelemetry-api \\
  opentelemetry-sdk \\
  opentelemetry-exporter-otlp-proto-grpc \\
  opentelemetry-instrumentation`,
        language: "bash",
      };
    case "go":
      return {
        code: `go get go.opentelemetry.io/otel \\
  go.opentelemetry.io/otel/sdk \\
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc \\
  go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc \\
  go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc`,
        language: "bash",
      };
    case "java":
      return {
        code: `# Download the OpenTelemetry Java Agent
curl -L -o opentelemetry-javaagent.jar \\
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar`,
        language: "bash",
      };
    case "dotnet":
      return {
        code: `dotnet add package OpenTelemetry
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http`,
        language: "bash",
      };
    case "rust":
      return {
        code: `# Add to Cargo.toml
[dependencies]
opentelemetry = "0.22"
opentelemetry_sdk = { version = "0.22", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.15", features = ["tonic"] }
tracing = "0.1"
tracing-opentelemetry = "0.23"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }`,
        language: "bash",
      };
  }
}

function getOtelConfigSnippet(lang: Language): {
  code: string;
  language: string;
} {
  switch (lang) {
    case "node":
      return {
        code: `// tracing.ts - Run with: node --require ./tracing.ts app.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

const sdk = new NodeSDK({
  serviceName: 'my-service',
  traceExporter: new OTLPTraceExporter({
    url: '<YOUR_ONEUPTIME_OTLP_URL>/v1/traces',
    headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: '<YOUR_ONEUPTIME_OTLP_URL>/v1/metrics',
      headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
    }),
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: '<YOUR_ONEUPTIME_OTLP_URL>/v1/logs',
        headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
      })
    ),
  ],
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();`,
        language: "typescript",
      };
    case "python":
      return {
        code: `# tracing.py
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.name": "my-service"})

# Traces
trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(
            endpoint="<YOUR_ONEUPTIME_OTLP_URL>",
            headers={"x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>"},
        )
    )
)
trace.set_tracer_provider(trace_provider)

# Metrics
metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(
        endpoint="<YOUR_ONEUPTIME_OTLP_URL>",
        headers={"x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>"},
    )
)
metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[metric_reader]))`,
        language: "python",
      };
    case "go":
      return {
        code: `package main

import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/metadata"
)

func initTracer() (*sdktrace.TracerProvider, error) {
    ctx := metadata.AppendToOutgoingContext(
        context.Background(),
        "x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>",
    )

    exporter, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("<YOUR_ONEUPTIME_OTLP_HOST>"),
        otlptracegrpc.WithTLSCredentials(insecure.NewCredentials()),
    )
    if err != nil {
        return nil, err
    }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithResource(resource.NewWithAttributes(
            semconv.SchemaURL,
            semconv.ServiceName("my-service"),
        )),
    )
    otel.SetTracerProvider(tp)
    return tp, nil
}`,
        language: "go",
      };
    case "java":
      return {
        code: `# Run your Java application with the OpenTelemetry agent:
java -javaagent:opentelemetry-javaagent.jar \\
  -Dotel.service.name=my-service \\
  -Dotel.exporter.otlp.endpoint=<YOUR_ONEUPTIME_OTLP_URL> \\
  -Dotel.exporter.otlp.headers="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>" \\
  -Dotel.metrics.exporter=otlp \\
  -Dotel.logs.exporter=otlp \\
  -jar my-app.jar`,
        language: "bash",
      };
    case "dotnet":
      return {
        code: `// Program.cs
using OpenTelemetry;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;
using OpenTelemetry.Logs;
using OpenTelemetry.Resources;

var builder = WebApplication.CreateBuilder(args);

var resourceBuilder = ResourceBuilder.CreateDefault()
    .AddService("my-service");

// Traces
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .SetResourceBuilder(resourceBuilder)
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter(options => {
            options.Endpoint = new Uri("<YOUR_ONEUPTIME_OTLP_URL>");
            options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
        })
    )
    .WithMetrics(metrics => metrics
        .SetResourceBuilder(resourceBuilder)
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(options => {
            options.Endpoint = new Uri("<YOUR_ONEUPTIME_OTLP_URL>");
            options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
        })
    );

// Logs
builder.Logging.AddOpenTelemetry(logging => {
    logging.SetResourceBuilder(resourceBuilder);
    logging.AddOtlpExporter(options => {
        options.Endpoint = new Uri("<YOUR_ONEUPTIME_OTLP_URL>");
        options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
    });
});

var app = builder.Build();
app.Run();`,
        language: "csharp",
      };
    case "rust":
      return {
        code: `use opentelemetry::global;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{trace as sdktrace, Resource};
use opentelemetry::KeyValue;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn init_tracer() -> sdktrace::TracerProvider {
    let exporter = opentelemetry_otlp::new_exporter()
        .tonic()
        .with_endpoint("<YOUR_ONEUPTIME_OTLP_URL>")
        .with_metadata({
            let mut map = tonic::metadata::MetadataMap::new();
            map.insert("x-oneuptime-token",
                "<YOUR_ONEUPTIME_TOKEN>".parse().unwrap());
            map
        });

    opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(exporter)
        .with_trace_config(
            sdktrace::Config::default()
                .with_resource(Resource::new(vec![
                    KeyValue::new("service.name", "my-service"),
                ])),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .unwrap()
}`,
        language: "rust",
      };
  }
}

function getEnvVarSnippet(): string {
  return `# Alternatively, configure via environment variables (works with any language):
export OTEL_SERVICE_NAME="my-service"
export OTEL_EXPORTER_OTLP_ENDPOINT="<YOUR_ONEUPTIME_OTLP_URL>"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>"
export OTEL_EXPORTER_OTLP_PROTOCOL="grpc"`;
}

// --- FluentBit snippets ---

function getFluentBitSnippet(): string {
  return `# fluent-bit.conf
[SERVICE]
    Flush        5
    Log_Level    info
    Parsers_File parsers.conf

[INPUT]
    Name         tail
    Path         /var/log/*.log
    Tag          app.logs

[OUTPUT]
    Name         opentelemetry
    Match        *
    Host         <YOUR_ONEUPTIME_OTLP_HOST>
    Port         443
    Tls          On
    Header       x-oneuptime-token <YOUR_ONEUPTIME_TOKEN>
    Logs_uri     /v1/logs`;
}

function getFluentBitDockerSnippet(): string {
  return `# docker-compose.yml
services:
  fluent-bit:
    image: fluent/fluent-bit:latest
    volumes:
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf
      - /var/log:/var/log:ro
    environment:
      - FLB_ES_HOST=<YOUR_ONEUPTIME_OTLP_HOST>`;
}

// --- Fluentd snippets ---

function getFluentdSnippet(): string {
  return `# fluentd.conf
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<source>
  @type tail
  path /var/log/*.log
  pos_file /var/log/fluentd.pos
  tag app.logs
  <parse>
    @type json
  </parse>
</source>

<match **>
  @type http
  endpoint https://<YOUR_ONEUPTIME_OTLP_HOST>/v1/logs
  headers {"x-oneuptime-token":"<YOUR_ONEUPTIME_TOKEN>"}
  json_array true
  <format>
    @type json
  </format>
  <buffer>
    @type memory
    flush_interval 5s
  </buffer>
</match>`;
}

function getFluentdDockerSnippet(): string {
  return `# docker-compose.yml
services:
  fluentd:
    image: fluent/fluentd:latest
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluentd.conf
      - /var/log:/var/log:ro
    ports:
      - "24224:24224"`;
}

// --- Main Component ---

const TelemetryDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("node");

  const telemetryType: TelemetryType = props.telemetryType || "logs";

  const titleForType: Record<TelemetryType, string> = {
    logs: "Getting Started with Log Ingestion",
    metrics: "Getting Started with Metrics Ingestion",
    traces: "Getting Started with Trace Ingestion",
    exceptions: "Getting Started with Exception Tracking",
  };

  const descriptionForType: Record<TelemetryType, string> = {
    logs: "Send logs from your application to OneUptime using OpenTelemetry, FluentBit, or Fluentd.",
    metrics:
      "Send metrics from your application to OneUptime using OpenTelemetry SDKs.",
    traces:
      "Send distributed traces from your application to OneUptime using OpenTelemetry SDKs.",
    exceptions:
      "Capture and track exceptions from your application using OpenTelemetry SDKs.",
  };

  const installSnippet: { code: string; language: string } = useMemo(() => {
    return getOtelInstallSnippet(selectedLanguage);
  }, [selectedLanguage]);

  const configSnippet: { code: string; language: string } = useMemo(() => {
    return getOtelConfigSnippet(selectedLanguage);
  }, [selectedLanguage]);

  const handleLanguageSelect: (lang: Language) => void = useCallback(
    (lang: Language) => {
      setSelectedLanguage(lang);
    },
    [],
  );

  // Language selector pills
  const renderLanguageSelector: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap gap-2 mb-5">
        {languages.map((lang: LanguageOption) => {
          const isSelected: boolean = selectedLanguage === lang.key;
          return (
            <button
              key={lang.key}
              type="button"
              onClick={() => {
                handleLanguageSelect(lang.key);
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all ${
                isSelected
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-white text-gray-600 border-gray-300 hover:border-indigo-400 hover:text-indigo-600"
              }`}
            >
              {lang.label}
            </button>
          );
        })}
      </div>
    );
  };

  // Step component
  const renderStep: (
    stepNumber: number,
    title: string,
    description: string,
    content: ReactElement,
  ) => ReactElement = (
    stepNumber: number,
    title: string,
    description: string,
    content: ReactElement,
  ): ReactElement => {
    return (
      <div className="flex gap-4 mb-6">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-semibold">
            {stepNumber}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-gray-900 mb-1">{title}</h4>
          <p className="text-sm text-gray-500 mb-3">{description}</p>
          {content}
        </div>
      </div>
    );
  };

  // OpenTelemetry tab content
  const renderOpenTelemetryContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mb-5 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
          <p className="text-sm text-indigo-800">
            <span className="font-semibold">OpenTelemetry</span> is the
            recommended way to send telemetry data to OneUptime. It supports
            logs, metrics, and traces with auto-instrumentation for most
            frameworks.
          </p>
        </div>

        {renderLanguageSelector()}

        {renderStep(
          1,
          "Install Dependencies",
          `Install the OpenTelemetry SDK and exporters for ${languages.find((l: LanguageOption) => { return l.key === selectedLanguage; })?.label || selectedLanguage}.`,
          <CodeBlock
            code={installSnippet.code}
            language={installSnippet.language}
          />,
        )}

        {renderStep(
          2,
          "Configure the SDK",
          "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance. Replace the placeholder values with your actual OneUptime OTLP URL and token.",
          <CodeBlock
            code={configSnippet.code}
            language={configSnippet.language}
          />,
        )}

        {renderStep(
          3,
          "Set Environment Variables (Alternative)",
          "You can also configure OpenTelemetry via environment variables instead of code. This works with any language.",
          <CodeBlock code={getEnvVarSnippet()} language="bash" />,
        )}

        <Accordion
          title="Where do I find my OTLP URL and Token?"
          description="You can find your OTLP endpoint URL and ingestion token in **Project Settings > Telemetry Ingestion Keys**."
          isLastElement={true}
        >
          <div className="text-sm text-gray-600">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Navigate to <strong>Project Settings</strong> from the sidebar.
              </li>
              <li>
                Click on <strong>Telemetry Ingestion Keys</strong>.
              </li>
              <li>
                Copy the <strong>OTLP Endpoint</strong> and{" "}
                <strong>Token</strong> values.
              </li>
              <li>
                Replace <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">&lt;YOUR_ONEUPTIME_OTLP_URL&gt;</code>{" "}
                and <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">&lt;YOUR_ONEUPTIME_TOKEN&gt;</code>{" "}
                in the code above with these values.
              </li>
            </ol>
          </div>
        </Accordion>
      </div>
    );
  };

  // FluentBit tab content
  const renderFluentBitContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">FluentBit</span> is a lightweight
            log processor and forwarder. It is ideal for collecting logs from
            files, containers, and system services with minimal resource usage.
          </p>
        </div>

        {renderStep(
          1,
          "Create FluentBit Configuration",
          "Create a fluent-bit.conf file that reads logs and forwards them to OneUptime via the OpenTelemetry output plugin.",
          <CodeBlock code={getFluentBitSnippet()} language="yaml" />,
        )}

        {renderStep(
          2,
          "Run with Docker (Optional)",
          "You can run FluentBit as a Docker container alongside your application.",
          <CodeBlock code={getFluentBitDockerSnippet()} language="yaml" />,
        )}

        {renderStep(
          3,
          "Run FluentBit",
          "Start FluentBit with your configuration file.",
          <CodeBlock
            code="fluent-bit -c fluent-bit.conf"
            language="bash"
          />,
        )}
      </div>
    );
  };

  // Fluentd tab content
  const renderFluentdContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mb-5 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800">
            <span className="font-semibold">Fluentd</span> is a mature
            open-source data collector with a rich plugin ecosystem. It supports
            1000+ input sources and is widely used in production for log
            aggregation.
          </p>
        </div>

        {renderStep(
          1,
          "Create Fluentd Configuration",
          "Create a fluentd.conf file that collects logs and sends them to OneUptime over HTTP.",
          <CodeBlock code={getFluentdSnippet()} language="yaml" />,
        )}

        {renderStep(
          2,
          "Run with Docker (Optional)",
          "You can run Fluentd as a Docker container.",
          <CodeBlock code={getFluentdDockerSnippet()} language="yaml" />,
        )}

        {renderStep(
          3,
          "Run Fluentd",
          "Start Fluentd with your configuration.",
          <CodeBlock
            code="fluentd -c fluentd.conf"
            language="bash"
          />,
        )}
      </div>
    );
  };

  // Build tabs based on telemetry type
  const showLogCollectors: boolean =
    telemetryType === "logs" || telemetryType === "exceptions";

  const tabs: Array<Tab> = useMemo(() => {
    const result: Array<Tab> = [
      {
        name: "OpenTelemetry",
        children: <div />,
      },
    ];

    if (showLogCollectors) {
      result.push({
        name: "FluentBit",
        children: <div />,
      });
      result.push({
        name: "Fluentd",
        children: <div />,
      });
    }

    return result;
  }, [showLogCollectors]);

  const [activeTab, setActiveTab] = useState<string>("OpenTelemetry");

  const handleTabChange: (tab: Tab) => void = useCallback((tab: Tab) => {
    setActiveTab(tab.name);
  }, []);

  const renderActiveContent: () => ReactElement = (): ReactElement => {
    switch (activeTab) {
      case "FluentBit":
        return renderFluentBitContent();
      case "Fluentd":
        return renderFluentdContent();
      default:
        return renderOpenTelemetryContent();
    }
  };

  return (
    <Card
      title={titleForType[telemetryType]}
      description={descriptionForType[telemetryType]}
    >
      <Tabs tabs={tabs} onTabChange={handleTabChange} />
      <div className="mt-2">{renderActiveContent()}</div>
    </Card>
  );
};

export default TelemetryDocumentation;
