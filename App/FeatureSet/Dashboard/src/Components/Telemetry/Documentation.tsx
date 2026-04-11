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
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Protocol from "Common/Types/API/Protocol";

export type TelemetryType =
  | "logs"
  | "metrics"
  | "traces"
  | "exceptions"
  | "profiles";

export interface ComponentProps {
  telemetryType?: TelemetryType | undefined;
  onClose?: (() => void) | undefined;
}

type Language =
  | "node"
  | "python"
  | "go"
  | "java"
  | "dotnet"
  | "rust"
  | "php"
  | "ruby"
  | "elixir"
  | "cpp"
  | "swift"
  | "react"
  | "angular";

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
  { key: "php", label: "PHP", shortLabel: "PHP" },
  { key: "ruby", label: "Ruby", shortLabel: "Ruby" },
  { key: "elixir", label: "Elixir", shortLabel: "Elixir" },
  { key: "cpp", label: "C++", shortLabel: "C++" },
  { key: "swift", label: "Swift", shortLabel: "Swift" },
  { key: "react", label: "React (Browser)", shortLabel: "React" },
  { key: "angular", label: "Angular (Browser)", shortLabel: "Angular" },
];

type IntegrationMethod = "opentelemetry" | "fluentbit" | "fluentd" | "alloy";

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
  pyroscopeUrl: string,
): string {
  return code
    .replace(/<YOUR_ONEUPTIME_URL>/g, otlpUrl)
    .replace(/<YOUR_ONEUPTIME_PYROSCOPE_URL>/g, pyroscopeUrl)
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
  opentelemetry-exporter-otlp-proto-http \\
  opentelemetry-instrumentation`,
        language: "bash",
      };
    case "go":
      return {
        code: `go get go.opentelemetry.io/otel \\
  go.opentelemetry.io/otel/sdk \\
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp \\
  go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp \\
  go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp`,
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
opentelemetry-otlp = { version = "0.15", features = ["http-proto", "reqwest-client"] }
tracing = "0.1"
tracing-opentelemetry = "0.23"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
reqwest = { version = "0.11", features = ["blocking"] }`,
        language: "bash",
      };
    case "php":
      return {
        code: `composer require open-telemetry/sdk \\
  open-telemetry/exporter-otlp \\
  open-telemetry/transport-http`,
        language: "bash",
      };
    case "ruby":
      return {
        code: `# Add to Gemfile
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'

# Then run:
bundle install`,
        language: "bash",
      };
    case "elixir":
      return {
        code: `# Add to mix.exs deps
defp deps do
  [
    {:opentelemetry, "~> 1.4"},
    {:opentelemetry_sdk, "~> 1.4"},
    {:opentelemetry_exporter, "~> 1.7"},
    {:opentelemetry_phoenix, "~> 1.2"},
    {:opentelemetry_ecto, "~> 1.2"}
  ]
end

# Then run:
mix deps.get`,
        language: "bash",
      };
    case "cpp":
      return {
        code: `# Using vcpkg
vcpkg install opentelemetry-cpp[otlp-http]

# Or using CMake FetchContent:
# include(FetchContent)
# FetchContent_Declare(opentelemetry-cpp
#   GIT_REPOSITORY https://github.com/open-telemetry/opentelemetry-cpp.git
#   GIT_TAG v1.14.0)
# set(WITH_OTLP_HTTP ON)
# FetchContent_MakeAvailable(opentelemetry-cpp)`,
        language: "bash",
      };
    case "swift":
      return {
        code: `// Add to Package.swift dependencies:
.package(url: "https://github.com/open-telemetry/opentelemetry-swift.git", from: "1.9.0")

// And add to target dependencies:
.product(name: "OpenTelemetryApi", package: "opentelemetry-swift"),
.product(name: "OpenTelemetrySdk", package: "opentelemetry-swift"),
.product(name: "OtlpHttpSpanExporting", package: "opentelemetry-swift"),`,
        language: "bash",
      };
    case "react":
      return {
        code: `npm install @opentelemetry/api \\
  @opentelemetry/sdk-trace-web \\
  @opentelemetry/sdk-trace-base \\
  @opentelemetry/exporter-trace-otlp-http \\
  @opentelemetry/instrumentation-document-load \\
  @opentelemetry/instrumentation-fetch \\
  @opentelemetry/instrumentation-xml-http-request \\
  @opentelemetry/context-zone`,
        language: "bash",
      };
    case "angular":
      return {
        code: `npm install @opentelemetry/api \\
  @opentelemetry/sdk-trace-web \\
  @opentelemetry/sdk-trace-base \\
  @opentelemetry/exporter-trace-otlp-http \\
  @opentelemetry/instrumentation-document-load \\
  @opentelemetry/instrumentation-fetch \\
  @opentelemetry/instrumentation-xml-http-request \\
  @opentelemetry/context-zone`,
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
    url: '<YOUR_ONEUPTIME_URL>/v1/traces',
    headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: '<YOUR_ONEUPTIME_URL>/v1/metrics',
      headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
    }),
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: '<YOUR_ONEUPTIME_URL>/v1/logs',
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
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.name": "my-service"})

# Traces
trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(
            endpoint="<YOUR_ONEUPTIME_URL>",
            headers={"x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>"},
        )
    )
)
trace.set_tracer_provider(trace_provider)

# Metrics
metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(
        endpoint="<YOUR_ONEUPTIME_URL>",
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
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
)

func initTracer() (*sdktrace.TracerProvider, error) {
    ctx := context.Background()

    exporter, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpoint("<YOUR_ONEUPTIME_OTLP_HOST>"),
        otlptracehttp.WithHeaders(map[string]string{
            "x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>",
        }),
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
  -Dotel.exporter.otlp.endpoint=<YOUR_ONEUPTIME_URL> \\
  -Dotel.exporter.otlp.headers="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>" \\
  -Dotel.exporter.otlp.protocol=http/protobuf \\
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
using OpenTelemetry.Exporter;

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
            options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>");
            options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
            options.Protocol = OtlpExportProtocol.HttpProtobuf;
        })
    )
    .WithMetrics(metrics => metrics
        .SetResourceBuilder(resourceBuilder)
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(options => {
            options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>");
            options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
            options.Protocol = OtlpExportProtocol.HttpProtobuf;
        })
    );

// Logs
builder.Logging.AddOpenTelemetry(logging => {
    logging.SetResourceBuilder(resourceBuilder);
    logging.AddOtlpExporter(options => {
        options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>");
        options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
        options.Protocol = OtlpExportProtocol.HttpProtobuf;
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
use std::collections::HashMap;

fn init_tracer() -> sdktrace::TracerProvider {
    let mut headers = HashMap::new();
    headers.insert(
        "x-oneuptime-token".to_string(),
        "<YOUR_ONEUPTIME_TOKEN>".to_string(),
    );

    let exporter = opentelemetry_otlp::new_exporter()
        .http()
        .with_endpoint("<YOUR_ONEUPTIME_URL>")
        .with_headers(headers);

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
    case "php":
      return {
        code: `<?php
// bootstrap.php
use OpenTelemetry\\API\\Globals;
use OpenTelemetry\\SDK\\Trace\\TracerProviderBuilder;
use OpenTelemetry\\SDK\\Trace\\SpanProcessor\\BatchSpanProcessor;
use OpenTelemetry\\Contrib\\Otlp\\SpanExporter;
use OpenTelemetry\\SDK\\Common\\Attribute\\Attributes;
use OpenTelemetry\\SDK\\Resource\\ResourceInfo;
use OpenTelemetry\\SemConv\\ResourceAttributes;
use OpenTelemetry\\Contrib\\Otlp\\HttpTransportFactory;

$transport = (new HttpTransportFactory())->create(
    '<YOUR_ONEUPTIME_URL>/v1/traces',
    'application/x-protobuf',
    ['x-oneuptime-token' => '<YOUR_ONEUPTIME_TOKEN>']
);

$exporter = new SpanExporter($transport);

$resource = ResourceInfo::create(Attributes::create([
    ResourceAttributes::SERVICE_NAME => 'my-service',
]));

$tracerProvider = (new TracerProviderBuilder())
    ->addSpanProcessor(new BatchSpanProcessor($exporter))
    ->setResource($resource)
    ->build();

Globals::registerTracerProvider($tracerProvider);`,
        language: "php",
      };
    case "ruby":
      return {
        code: `# config/initializers/opentelemetry.rb
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'my-service'

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: '<YOUR_ONEUPTIME_URL>/v1/traces',
        headers: { 'x-oneuptime-token' => '<YOUR_ONEUPTIME_TOKEN>' }
      )
    )
  )

  c.use_all # Auto-instrument all available libraries
end`,
        language: "ruby",
      };
    case "elixir":
      return {
        code: `# config/runtime.exs
config :opentelemetry,
  resource: %{service: %{name: "my-service"}},
  span_processor: :batch,
  traces_exporter: :otlp

config :opentelemetry_exporter,
  otlp_protocol: :http_protobuf,
  otlp_endpoint: "<YOUR_ONEUPTIME_URL>",
  otlp_headers: [{"x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>"}]

# In application.ex, add to children:
# {OpentelemetryPhoenix, []},
# {OpentelemetryEcto, repo: MyApp.Repo}`,
        language: "elixir",
      };
    case "cpp":
      return {
        code: `#include <opentelemetry/sdk/trace/tracer_provider_factory.h>
#include <opentelemetry/exporters/otlp/otlp_http_exporter_factory.h>
#include <opentelemetry/sdk/trace/batch_span_processor_factory.h>
#include <opentelemetry/sdk/resource/resource.h>
#include <opentelemetry/trace/provider.h>

namespace trace = opentelemetry::trace;
namespace sdktrace = opentelemetry::sdk::trace;
namespace otlp = opentelemetry::exporter::otlp;

void initTracer() {
    otlp::OtlpHttpExporterOptions opts;
    opts.url = "<YOUR_ONEUPTIME_URL>/v1/traces";
    opts.http_headers = {{"x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>"}};

    auto exporter = otlp::OtlpHttpExporterFactory::Create(opts);

    sdktrace::BatchSpanProcessorOptions bspOpts;
    auto processor = sdktrace::BatchSpanProcessorFactory::Create(
        std::move(exporter), bspOpts);

    auto resource = opentelemetry::sdk::resource::Resource::Create({
        {"service.name", "my-service"}
    });

    auto provider = sdktrace::TracerProviderFactory::Create(
        std::move(processor), resource);

    trace::Provider::SetTracerProvider(std::move(provider));
}`,
        language: "cpp",
      };
    case "swift":
      return {
        code: `import OpenTelemetryApi
import OpenTelemetrySdk
import OtlpHttpSpanExporting

func initTracer() {
    let exporter = OtlpHttpSpanExporter(
        endpoint: URL(string: "<YOUR_ONEUPTIME_URL>/v1/traces")!,
        config: OtlpConfiguration(
            headers: [("x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>")]
        )
    )

    let spanProcessor = BatchSpanProcessor(spanExporter: exporter)

    let tracerProvider = TracerProviderBuilder()
        .add(spanProcessor: spanProcessor)
        .with(resource: Resource(attributes: [
            ResourceAttributes.serviceName.rawValue: AttributeValue.string("my-service")
        ]))
        .build()

    OpenTelemetry.registerTracerProvider(tracerProvider: tracerProvider)
}`,
        language: "swift",
      };
    case "react":
      return {
        code: `// src/tracing.ts - Import this file in your index.tsx before ReactDOM.render()
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { Resource } from '@opentelemetry/resources';

const provider = new WebTracerProvider({
  resource: new Resource({
    'service.name': 'my-react-app',
  }),
});

provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: '<YOUR_ONEUPTIME_URL>/v1/traces',
      headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
    })
  )
);

provider.register({
  contextManager: new ZoneContextManager(),
});

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
    }),
  ],
});

// In index.tsx:
// import './tracing';  // Must be first import
// import React from 'react';
// ...`,
        language: "typescript",
      };
    case "angular":
      return {
        code: `// src/tracing.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { Resource } from '@opentelemetry/resources';

const provider = new WebTracerProvider({
  resource: new Resource({
    'service.name': 'my-angular-app',
  }),
});

provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: '<YOUR_ONEUPTIME_URL>/v1/traces',
      headers: { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' },
    })
  )
);

provider.register({
  contextManager: new ZoneContextManager(),
});

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
    }),
  ],
});

// In main.ts, import before bootstrapping:
// import './tracing';  // Must be first import
// import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
// ...`,
        language: "typescript",
      };
  }
}

function getEnvVarSnippet(): string {
  return `# Alternatively, configure via environment variables (works with any language):
export OTEL_SERVICE_NAME="my-service"
export OTEL_EXPORTER_OTLP_ENDPOINT="<YOUR_ONEUPTIME_URL>"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"`;
}

// --- Profile-specific snippets ---

const profileLanguages: Array<Language> = [
  "node",
  "python",
  "go",
  "java",
  "dotnet",
  "ruby",
  "rust",
];

function getProfileInstallSnippet(lang: Language): {
  code: string;
  language: string;
} {
  switch (lang) {
    case "node":
      return {
        code: `npm install @pyroscope/nodejs`,
        language: "bash",
      };
    case "python":
      return {
        code: `pip install pyroscope-io`,
        language: "bash",
      };
    case "go":
      return {
        code: `go get github.com/grafana/pyroscope-go`,
        language: "bash",
      };
    case "java":
      return {
        code: `<!-- Add to pom.xml -->
<dependency>
  <groupId>io.pyroscope</groupId>
  <artifactId>agent</artifactId>
  <version>2.1.2</version>
</dependency>

# Or download the Java agent JAR:
curl -L -o pyroscope.jar \\
  https://github.com/grafana/pyroscope-java/releases/latest/download/pyroscope.jar`,
        language: "bash",
      };
    case "dotnet":
      return {
        code: `dotnet add package Pyroscope

# Download the native profiler library:
curl -s -L https://github.com/grafana/pyroscope-dotnet/releases/download/v0.13.0-pyroscope/pyroscope.0.13.0-glibc-x86_64.tar.gz | tar xvz -C .`,
        language: "bash",
      };
    case "ruby":
      return {
        code: `bundle add pyroscope`,
        language: "bash",
      };
    case "rust":
      return {
        code: `cargo add pyroscope pyroscope_pprofrs`,
        language: "bash",
      };
    default:
      return {
        code: `# Profiling SDK not available for this language.\n# Use Grafana Alloy (eBPF) for zero-code profiling instead.`,
        language: "bash",
      };
  }
}

function getProfileConfigSnippet(lang: Language): {
  code: string;
  language: string;
} {
  switch (lang) {
    case "node":
      return {
        code: `const Pyroscope = require('@pyroscope/nodejs');

Pyroscope.init({
  serverAddress: '<YOUR_ONEUPTIME_PYROSCOPE_URL>',
  appName: 'my-service',
  tags: {
    region: process.env.REGION || 'default',
  },
  authToken: '<YOUR_ONEUPTIME_TOKEN>',
});

Pyroscope.start();`,
        language: "javascript",
      };
    case "python":
      return {
        code: `import pyroscope

pyroscope.configure(
    application_name="my-service",
    server_address="<YOUR_ONEUPTIME_PYROSCOPE_URL>",
    sample_rate=100,
    tags={
        "region": "us-east-1",
    },
    auth_token="<YOUR_ONEUPTIME_TOKEN>",
)`,
        language: "python",
      };
    case "go":
      return {
        code: `package main

import (
    "os"
    "runtime"

    "github.com/grafana/pyroscope-go"
)

func main() {
    // Enable mutex and block profiling
    runtime.SetMutexProfileFraction(5)
    runtime.SetBlockProfileRate(5)

    pyroscope.Start(pyroscope.Config{
        ApplicationName: "my-service",
        ServerAddress:   "<YOUR_ONEUPTIME_PYROSCOPE_URL>",
        AuthToken:       os.Getenv("ONEUPTIME_TOKEN"),
        Tags:            map[string]string{"hostname": os.Getenv("HOSTNAME")},
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
            pyroscope.ProfileGoroutines,
            pyroscope.ProfileMutexCount,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockCount,
            pyroscope.ProfileBlockDuration,
        },
    })

    // Your application code here
}`,
        language: "go",
      };
    case "java":
      return {
        code: `// Option 1: Start from code
import io.pyroscope.javaagent.PyroscopeAgent;
import io.pyroscope.javaagent.config.Config;
import io.pyroscope.javaagent.EventType;
import io.pyroscope.http.Format;

PyroscopeAgent.start(
    new Config.Builder()
        .setApplicationName("my-service")
        .setProfilingEvent(EventType.ITIMER)
        .setFormat(Format.JFR)
        .setServerAddress("<YOUR_ONEUPTIME_PYROSCOPE_URL>")
        .setAuthToken("<YOUR_ONEUPTIME_TOKEN>")
        .build()
);

// Option 2: Attach as Java agent (no code changes)
// java -javaagent:pyroscope.jar \\
//   -Dpyroscope.application.name=my-service \\
//   -Dpyroscope.server.address=<YOUR_ONEUPTIME_PYROSCOPE_URL> \\
//   -Dpyroscope.auth.token=<YOUR_ONEUPTIME_TOKEN> \\
//   -jar my-app.jar`,
        language: "java",
      };
    case "dotnet":
      return {
        code: `# Set environment variables before running your .NET application:
export PYROSCOPE_APPLICATION_NAME=my-service
export PYROSCOPE_SERVER_ADDRESS=<YOUR_ONEUPTIME_PYROSCOPE_URL>
export PYROSCOPE_AUTH_TOKEN=<YOUR_ONEUPTIME_TOKEN>
export PYROSCOPE_PROFILING_ENABLED=1
export CORECLR_ENABLE_PROFILING=1
export CORECLR_PROFILER={BD1A650D-AC5D-4896-B64F-D6FA25D6B26A}
export CORECLR_PROFILER_PATH=./Pyroscope.Profiler.Native.so
export LD_PRELOAD=./Pyroscope.Linux.ApiWrapper.x64.so

# Then run your application:
dotnet run`,
        language: "bash",
      };
    case "ruby":
      return {
        code: `# config/initializers/pyroscope.rb
require 'pyroscope'

Pyroscope.configure do |config|
  config.application_name = "my-service"
  config.server_address   = "<YOUR_ONEUPTIME_PYROSCOPE_URL>"
  config.auth_token       = "<YOUR_ONEUPTIME_TOKEN>"
  config.tags = {
    "hostname" => ENV["HOSTNAME"],
    "region"   => ENV.fetch("REGION", "default"),
  }
end`,
        language: "ruby",
      };
    case "rust":
      return {
        code: `use pyroscope::PyroscopeAgent;
use pyroscope_pprofrs::{pprof_backend, PprofConfig};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pprof_config = PprofConfig::new().sample_rate(100);
    let backend_impl = pprof_backend(pprof_config);

    let agent = PyroscopeAgent::builder(
            "<YOUR_ONEUPTIME_PYROSCOPE_URL>", "my-service"
        )
        .backend(backend_impl)
        .auth_token("<YOUR_ONEUPTIME_TOKEN>".to_string())
        .tags([("hostname", "localhost")].to_vec())
        .build()?;

    let agent_running = agent.start()?;

    // Your application code here

    let agent_ready = agent_running.stop()?;
    agent_ready.shutdown();

    Ok(())
}`,
        language: "rust",
      };
    default:
      return {
        code: `# Profiling SDK not available for this language.\n# Use Grafana Alloy (eBPF) for zero-code profiling instead.`,
        language: "bash",
      };
  }
}

function getAlloyEbpfSnippet(): string {
  return `# alloy-config.alloy
# Grafana Alloy eBPF-based profiling — no code changes required.
# Supports: Go, Rust, C/C++, Java, Python, Ruby, PHP, Node.js, .NET

discovery.process "all" {
  refresh_interval = "60s"
}

discovery.relabel "alloy_profiles" {
  targets = discovery.process.all.targets

  rule {
    action       = "replace"
    source_labels = ["__meta_process_exe"]
    target_label  = "service_name"
  }
}

pyroscope.ebpf "default" {
  targets    = discovery.relabel.alloy_profiles.output
  forward_to = [pyroscope.write.oneuptime.receiver]

  collect_interval = "15s"
  sample_rate      = 97
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "<YOUR_ONEUPTIME_PYROSCOPE_URL>"
    headers = {
      "x-oneuptime-token" = "<YOUR_ONEUPTIME_TOKEN>",
    }
  }
}`;
}

function getAlloyDockerSnippet(): string {
  return `# docker-compose.yml
services:
  alloy:
    image: grafana/alloy:latest
    privileged: true
    pid: host
    volumes:
      - ./alloy-config.alloy:/etc/alloy/config.alloy
      - /proc:/proc:ro
      - /sys:/sys:ro
    command:
      - run
      - /etc/alloy/config.alloy`;
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
  const [selectedMethod, setSelectedMethod] = useState<IntegrationMethod>(
    props.telemetryType === "profiles" ? "alloy" : "opentelemetry",
  );

  // Token management state
  const [ingestionKeys, setIngestionKeys] = useState<
    Array<TelemetryIngestionKey>
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(true);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");

  const telemetryType: TelemetryType = props.telemetryType || "logs";

  const showLogCollectors: boolean = telemetryType === "logs";
  const isProfiles: boolean = telemetryType === "profiles";

  // Compute OTLP URL and host
  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const otlpHost: string = HOST ? HOST : "<YOUR_ONEUPTIME_OTLP_HOST>";
  const otlpUrl: string = HOST
    ? `${httpProtocol}://${HOST}/otlp`
    : "<YOUR_ONEUPTIME_URL>";
  const pyroscopeUrl: string = HOST
    ? `${httpProtocol}://${HOST}/pyroscope`
    : "<YOUR_ONEUPTIME_PYROSCOPE_URL>";

  // Fetch ingestion keys on mount
  useEffect(() => {
    loadIngestionKeys().catch(() => {});
  }, []);

  const loadIngestionKeys: () => Promise<void> = async (): Promise<void> => {
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
        setSelectedKeyId(result.data[0]!.id?.toString() || "");
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
  const tokenValue: string =
    selectedKey?.secretKey?.toString() || "<YOUR_ONEUPTIME_TOKEN>";
  const otlpUrlValue: string = otlpUrl;
  const otlpHostValue: string = otlpHost;

  const integrationMethods: Array<IntegrationOption> = useMemo(() => {
    if (isProfiles) {
      return [
        {
          key: "alloy" as IntegrationMethod,
          label: "Grafana Alloy (eBPF)",
          description:
            "Recommended. Zero-code profiling for all languages on Linux using eBPF.",
        },
        {
          key: "opentelemetry" as IntegrationMethod,
          label: "Language SDK",
          description:
            "In-process profiling using Pyroscope SDKs for fine-grained control.",
        },
      ];
    }

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
  }, [showLogCollectors, isProfiles]);

  const titleForType: Record<TelemetryType, string> = {
    logs: "Log Ingestion Setup",
    metrics: "Metrics Ingestion Setup",
    traces: "Trace Ingestion Setup",
    exceptions: "Exception Tracking Setup",
    profiles: "Profiles Ingestion Setup",
  };

  const descriptionForType: Record<TelemetryType, string> = {
    logs: "Send logs from your application to OneUptime using OpenTelemetry, FluentBit, or Fluentd.",
    metrics:
      "Send metrics from your application to OneUptime using OpenTelemetry SDKs.",
    traces:
      "Send distributed traces from your application to OneUptime using OpenTelemetry SDKs.",
    exceptions:
      "Capture and track exceptions from your application using OpenTelemetry SDKs.",
    profiles:
      "Send continuous profiling data from your application to OneUptime using OpenTelemetry SDKs.",
  };

  const installSnippet: { code: string; language: string } = useMemo(() => {
    if (isProfiles) {
      return getProfileInstallSnippet(selectedLanguage);
    }
    return getOtelInstallSnippet(selectedLanguage);
  }, [selectedLanguage, isProfiles]);

  const configSnippet: { code: string; language: string } = useMemo(() => {
    if (isProfiles) {
      return getProfileConfigSnippet(selectedLanguage);
    }
    return getOtelConfigSnippet(selectedLanguage);
  }, [selectedLanguage, isProfiles]);

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
          <div className="w-9 h-9 rounded-full bg-indigo-50 border-2 border-indigo-500 text-indigo-600 flex items-center justify-center text-sm font-bold">
            {stepNumber}
          </div>
          {!isLast && <div className="w-0.5 flex-1 bg-gray-200 mt-2 mb-0" />}
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

  // Token step content (rendered inside Step 1)
  const renderTokenStepContent: () => ReactElement = (): ReactElement => {
    if (isLoadingKeys) {
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-500">Loading ingestion keys...</p>
        </div>
      );
    }

    if (keyError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
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

    if (ingestionKeys.length === 0) {
      return (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-3">
            <Icon icon={IconProp.Key} className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">
            No ingestion keys yet
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Create an ingestion key to authenticate your telemetry data.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Icon icon={IconProp.Add} className="w-4 h-4" />
            Create Ingestion Key
          </button>
        </div>
      );
    }

    return (
      <div>
        {/* Key selector row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <Dropdown
              options={ingestionKeys.map(
                (key: TelemetryIngestionKey): DropdownOption => {
                  return {
                    value: key.id?.toString() || "",
                    label: key.name || "Unnamed Key",
                  };
                },
              )}
              value={
                ingestionKeys
                  .filter((key: TelemetryIngestionKey) => {
                    return key.id?.toString() === selectedKeyId;
                  })
                  .map((key: TelemetryIngestionKey): DropdownOption => {
                    return {
                      value: key.id?.toString() || "",
                      label: key.name || "Unnamed Key",
                    };
                  })[0]
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value) {
                  setSelectedKeyId(value.toString());
                }
              }}
              placeholder="Select an ingestion key"
              ariaLabel="Select ingestion key"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors flex-shrink-0"
          >
            <Icon icon={IconProp.Add} className="w-4 h-4" />
            New Key
          </button>
        </div>

        {/* Credentials display */}
        {selectedKey && (
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-gray-100">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon
                    icon={IconProp.Globe}
                    className="w-4 h-4 text-blue-600"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    OTLP Endpoint
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {otlpUrlValue}
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon
                    icon={IconProp.Key}
                    className="w-4 h-4 text-amber-600"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ingestion Token
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {selectedKey.secretKey?.toString() || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Language selector
  const renderLanguageSelector: () => ReactElement = (): ReactElement => {
    const availableLanguages: Array<LanguageOption> = isProfiles
      ? languages.filter((l: LanguageOption) => {
          return profileLanguages.includes(l.key);
        })
      : languages;

    return (
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Select Language
        </label>
        <div className="flex flex-wrap gap-1.5">
          {availableLanguages.map((lang: LanguageOption) => {
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
            "Get Your Ingestion Credentials",
            "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            "Install Dependencies",
            isProfiles
              ? `Install the Pyroscope profiling SDK for ${
                  languages.find((l: LanguageOption) => {
                    return l.key === selectedLanguage;
                  })?.label || selectedLanguage
                }.`
              : `Install the OpenTelemetry SDK and exporters for ${
                  languages.find((l: LanguageOption) => {
                    return l.key === selectedLanguage;
                  })?.label || selectedLanguage
                }.`,
            <CodeBlock
              code={installSnippet.code}
              language={installSnippet.language}
            />,
          )}

          {renderStep(
            3,
            isProfiles ? "Configure the Profiler" : "Configure the SDK",
            isProfiles
              ? "Initialize the Pyroscope profiling SDK and point it to your OneUptime instance. Profiles will be continuously captured and sent."
              : "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance.",
            <CodeBlock
              code={replacePlaceholders(
                configSnippet.code,
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language={configSnippet.language}
            />,
            Boolean(isProfiles),
          )}

          {!isProfiles &&
            renderStep(
              4,
              "Set Environment Variables (Alternative)",
              "You can also configure OpenTelemetry via environment variables instead of code.",
              <CodeBlock
                code={replacePlaceholders(
                  getEnvVarSnippet(),
                  otlpUrlValue,
                  otlpHostValue,
                  tokenValue,
                  pyroscopeUrl,
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
            "Get Your Ingestion Credentials",
            "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            "Create FluentBit Configuration",
            "Create a fluent-bit.conf file that reads logs and forwards them to OneUptime via the OpenTelemetry output plugin.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentBitSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            3,
            "Run with Docker (Optional)",
            "Run FluentBit as a Docker container alongside your application.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentBitDockerSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            4,
            "Run FluentBit",
            "Start FluentBit with your configuration file.",
            <CodeBlock code="fluent-bit -c fluent-bit.conf" language="bash" />,
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
            "Get Your Ingestion Credentials",
            "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            "Create Fluentd Configuration",
            "Create a fluentd.conf file that collects logs and sends them to OneUptime over HTTP.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentdSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            3,
            "Run with Docker (Optional)",
            "Run Fluentd as a Docker container.",
            <CodeBlock
              code={replacePlaceholders(
                getFluentdDockerSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            4,
            "Run Fluentd",
            "Start Fluentd with your configuration.",
            <CodeBlock code="fluentd -c fluentd.conf" language="bash" />,
            true,
          )}
        </div>
      </div>
    );
  };

  // Grafana Alloy eBPF content (for profiles)
  const renderAlloyContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mt-2">
          {renderStep(
            1,
            "Get Your Ingestion Credentials",
            "Select an existing ingestion key or create a new one. These credentials authenticate your profiling data.",
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            "Create Alloy Configuration",
            "Create an Alloy configuration file that uses eBPF to collect CPU profiles from all processes on your Linux host — no code changes required. Supports Go, Rust, C/C++, Java, Python, Ruby, PHP, Node.js, and .NET.",
            <CodeBlock
              code={replacePlaceholders(
                getAlloyEbpfSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language="nginx"
            />,
          )}

          {renderStep(
            3,
            "Run with Docker",
            "Run Grafana Alloy as a privileged Docker container with access to the host PID namespace.",
            <CodeBlock
              code={replacePlaceholders(
                getAlloyDockerSnippet(),
                otlpUrlValue,
                otlpHostValue,
                tokenValue,
                pyroscopeUrl,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            4,
            "Run Alloy",
            "Or run Alloy directly on the host.",
            <CodeBlock code="alloy run alloy-config.alloy" language="bash" />,
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
      case "alloy":
        return renderAlloyContent();
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
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {titleForType[telemetryType]}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                {descriptionForType[telemetryType]}
              </p>
            </div>
            {props.onClose && (
              <button
                type="button"
                onClick={props.onClose}
                className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Close documentation"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
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
