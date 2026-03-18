import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { TELEMETRY_URL } from "Common/UI/Config";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

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
  shortLabel: string;
}

const languages: Array<LanguageOption> = [
  { key: "node", label: "Node.js / TypeScript", shortLabel: "Node.js" },
  { key: "python", label: "Python", shortLabel: "Python" },
  { key: "go", label: "Go", shortLabel: "Go" },
  { key: "java", label: "Java", shortLabel: "Java" },
  { key: "dotnet", label: ".NET / C#", shortLabel: ".NET" },
  { key: "rust", label: "Rust", shortLabel: "Rust" },
];

type IntegrationMethod = "opentelemetry" | "fluentbit" | "fluentd";

interface IntegrationOption {
  key: IntegrationMethod;
  label: string;
  description: string;
}

// Helper to replace placeholders in code snippets
function replacePlaceholders(
  code: string,
  otlpUrl: string,
  otlpHost: string,
  token: string,
): string {
  return code
    .replace(/<YOUR_ONEUPTIME_OTLP_URL>/g, otlpUrl)
    .replace(/<YOUR_ONEUPTIME_OTLP_HOST>/g, otlpHost)
    .replace(/<YOUR_ONEUPTIME_TOKEN>/g, token);
}

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
  const [selectedMethod, setSelectedMethod] =
    useState<IntegrationMethod>("opentelemetry");

  // Token management state
  const [ingestionKeys, setIngestionKeys] = useState<
    Array<TelemetryIngestionKey>
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(true);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");

  const telemetryType: TelemetryType = props.telemetryType || "logs";

  const showLogCollectors: boolean =
    telemetryType === "logs" || telemetryType === "exceptions";

  // Compute OTLP URL and host from config
  const otlpUrl: string = TELEMETRY_URL.toString();
  const otlpHost: string = TELEMETRY_URL.hostname.toString();

  // Fetch ingestion keys on mount
  useEffect(() => {
    loadIngestionKeys().catch(() => {});
  }, []);

  const loadIngestionKeys: () => Promise<void> =
    async (): Promise<void> => {
      try {
        setIsLoadingKeys(true);
        setKeyError("");
        const result: ListResult<TelemetryIngestionKey> =
          await ModelAPI.getList<TelemetryIngestionKey>({
            modelType: TelemetryIngestionKey,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 50,
            skip: 0,
            select: {
              _id: true,
              name: true,
              secretKey: true,
              description: true,
            },
            sort: {},
          });

        setIngestionKeys(result.data);

        // Auto-select the first key if available and none selected
        if (result.data.length > 0 && !selectedKeyId) {
          setSelectedKeyId(
            result.data[0]!.id?.toString() || "",
          );
        }
      } catch (err) {
        setKeyError(API.getFriendlyErrorMessage(err as Error));
      } finally {
        setIsLoadingKeys(false);
      }
    };

  // Get the selected key object
  const selectedKey: TelemetryIngestionKey | undefined = useMemo(() => {
    return ingestionKeys.find((k: TelemetryIngestionKey) => {
      return k.id?.toString() === selectedKeyId;
    });
  }, [ingestionKeys, selectedKeyId]);

  // Get token string for code snippets
  const tokenValue: string = selectedKey?.secretKey?.toString() || "<YOUR_ONEUPTIME_TOKEN>";
  const otlpUrlValue: string = otlpUrl || "<YOUR_ONEUPTIME_OTLP_URL>";
  const otlpHostValue: string = otlpHost || "<YOUR_ONEUPTIME_OTLP_HOST>";

  const integrationMethods: Array<IntegrationOption> = useMemo(() => {
    const methods: Array<IntegrationOption> = [
      {
        key: "opentelemetry",
        label: "OpenTelemetry",
        description: "Recommended. Auto-instrumentation for most frameworks.",
      },
    ];

    if (showLogCollectors) {
      methods.push({
        key: "fluentbit",
        label: "FluentBit",
        description: "Lightweight log processor with minimal resource usage.",
      });
      methods.push({
        key: "fluentd",
        label: "Fluentd",
        description: "Mature data collector with rich plugin ecosystem.",
      });
    }

    return methods;
  }, [showLogCollectors]);

  const titleForType: Record<TelemetryType, string> = {
    logs: "Log Ingestion Setup",
    metrics: "Metrics Ingestion Setup",
    traces: "Trace Ingestion Setup",
    exceptions: "Exception Tracking Setup",
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

  // Step component with vertical line connector
  const renderStep: (
    stepNumber: number,
    title: string,
    description: string,
    content: ReactElement,
    isLast?: boolean,
  ) => ReactElement = (
    stepNumber: number,
    title: string,
    description: string,
    content: ReactElement,
    isLast?: boolean,
  ): ReactElement => {
    return (
      <div className="relative flex gap-5">
        {/* Step indicator with connecting line */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-indigo-50 border-2 border-indigo-500 text-indigo-600 flex items-center justify-center text-sm font-bold z-10">
            {stepNumber}
          </div>
          {!isLast && (
            <div className="w-0.5 flex-1 bg-gray-200 mt-2 mb-0" />
          )}
        </div>
        {/* Step content */}
        <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-8"}`}>
          <h4 className="text-sm font-semibold text-gray-900 leading-9">
            {title}
          </h4>
          <p className="text-sm text-gray-500 mt-0.5 mb-3 leading-relaxed">
            {description}
          </p>
          {content}
        </div>
      </div>
    );
  };

  // Token selector section
  const renderTokenSelector: () => ReactElement = (): ReactElement => {
    if (isLoadingKeys) {
      return (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-500">Loading ingestion keys...</p>
        </div>
      );
    }

    if (keyError) {
      return (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">
            Failed to load ingestion keys: {keyError}
          </p>
          <button
            type="button"
            onClick={() => {
              loadIngestionKeys().catch(() => {});
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider">
              Ingestion Token
            </label>
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
            >
              <Icon icon={IconProp.Add} className="w-3.5 h-3.5" />
              Create New Key
            </button>
          </div>

          {ingestionKeys.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-3">
                No ingestion keys found. Create one to get started.
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                <Icon icon={IconProp.Add} className="w-4 h-4" />
                Create Ingestion Key
              </button>
            </div>
          ) : (
            <div>
              <select
                value={selectedKeyId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  setSelectedKeyId(e.target.value);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              >
                {ingestionKeys.map((key: TelemetryIngestionKey) => {
                  return (
                    <option key={key.id?.toString()} value={key.id?.toString()}>
                      {key.name || "Unnamed Key"}
                    </option>
                  );
                })}
              </select>

              {selectedKey && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md bg-white border border-gray-200 px-3 py-2">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">
                      OTLP Endpoint
                    </div>
                    <div className="text-sm text-gray-900 font-mono break-all">
                      {otlpUrlValue}
                    </div>
                  </div>
                  <div className="rounded-md bg-white border border-gray-200 px-3 py-2">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">
                      Token
                    </div>
                    <div className="text-sm text-gray-900 font-mono break-all">
                      {selectedKey.secretKey?.toString() || "—"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Language selector
  const renderLanguageSelector: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Select Language
        </label>
        <div className="flex flex-wrap gap-1.5">
          {languages.map((lang: LanguageOption) => {
            const isSelected: boolean = selectedLanguage === lang.key;
            return (
              <button
                key={lang.key}
                type="button"
                onClick={() => {
                  handleLanguageSelect(lang.key);
                }}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-lg border transition-all ${
                  isSelected
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50"
                }`}
              >
                {lang.shortLabel}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Integration method selector
  const renderMethodSelector: () => ReactElement = (): ReactElement => {
    if (integrationMethods.length <= 1) {
      return <></>;
    }

    return (
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Integration Method
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {integrationMethods.map((method: IntegrationOption) => {
            const isSelected: boolean = selectedMethod === method.key;
            return (
              <button
                key={method.key}
                type="button"
                onClick={() => {
                  setSelectedMethod(method.key);
                }}
                className={`text-left px-4 py-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div
                  className={`text-sm font-semibold ${isSelected ? "text-indigo-700" : "text-gray-900"}`}
                >
                  {method.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {method.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // OpenTelemetry content
  const renderOpenTelemetryContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        {renderLanguageSelector()}

        <div className="mt-2">
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
            "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance.",
            <CodeBlock
              code={replacePlaceholders(
                configSnippet.code,
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
              )}
              language={configSnippet.language}
            />,
          )}

          {renderStep(
            3,
            "Set Environment Variables (Alternative)",
            "You can also configure OpenTelemetry via environment variables instead of code.",
            <CodeBlock
              code={replacePlaceholders(
                getEnvVarSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
              )}
              language="bash"
            />,
            true,
          )}
        </div>
      </div>
    );
  };

  // FluentBit content
  const renderFluentBitContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mt-2">
          {renderStep(
            1,
            "Create FluentBit Configuration",
            "Create a fluent-bit.conf file that reads logs and forwards them to OneUptime via the OpenTelemetry output plugin.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentBitSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            2,
            "Run with Docker (Optional)",
            "Run FluentBit as a Docker container alongside your application.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentBitDockerSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            3,
            "Run FluentBit",
            "Start FluentBit with your configuration file.",
            <CodeBlock
              code="fluent-bit -c fluent-bit.conf"
              language="bash"
            />,
            true,
          )}
        </div>
      </div>
    );
  };

  // Fluentd content
  const renderFluentdContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mt-2">
          {renderStep(
            1,
            "Create Fluentd Configuration",
            "Create a fluentd.conf file that collects logs and sends them to OneUptime over HTTP.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentdSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            2,
            "Run with Docker (Optional)",
            "Run Fluentd as a Docker container.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentdDockerSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            3,
            "Run Fluentd",
            "Start Fluentd with your configuration.",
            <CodeBlock
              code="fluentd -c fluentd.conf"
              language="bash"
            />,
            true,
          )}
        </div>
      </div>
    );
  };

  const renderActiveContent: () => ReactElement = (): ReactElement => {
    switch (selectedMethod) {
      case "fluentbit":
        return renderFluentBitContent();
      case "fluentd":
        return renderFluentdContent();
      default:
        return renderOpenTelemetryContent();
    }
  };

  return (
    <div className="mb-5">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-indigo-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {titleForType[telemetryType]}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                {descriptionForType[telemetryType]}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {renderTokenSelector()}
          {renderMethodSelector()}
          {renderActiveContent()}
        </div>
      </div>

      {/* Create Ingestion Key Modal */}
      {showCreateModal && (
        <ModelFormModal<TelemetryIngestionKey>
          modelType={TelemetryIngestionKey}
          name="Create Ingestion Key"
          title="Create Ingestion Key"
          description="Create a new telemetry ingestion key for sending data to OneUptime."
          onClose={() => {
            setShowCreateModal(false);
          }}
          submitButtonText="Create Key"
          onSuccess={(item: TelemetryIngestionKey) => {
            setShowCreateModal(false);
            // Refresh the list and select the new key
            loadIngestionKeys()
              .then(() => {
                if (item.id) {
                  setSelectedKeyId(item.id.toString());
                }
              })
              .catch(() => {});
          }}
          formProps={{
            name: "Create Ingestion Key",
            modelType: TelemetryIngestionKey,
            id: "create-ingestion-key",
            fields: [
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "e.g. Production Key",
                validation: {
                  minLength: 2,
                },
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "Optional description for this key",
              },
            ],
            formType: FormType.Create,
          }}
          onBeforeCreate={(
            item: TelemetryIngestionKey,
          ): Promise<TelemetryIngestionKey> => {
            item.projectId = ProjectUtil.getCurrentProjectId()!;
            return Promise.resolve(item);
          }}
        />
      )}
    </div>
  );
};

export default TelemetryDocumentation;
