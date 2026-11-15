import { TelemetryGuideLanguageKey } from "Common/Types/Telemetry/OpenTelemetryGuides";

/*
 * THE OPENTELEMETRY SDK SNIPPETS the telemetry Setup Guide (and Send your
 * first traces, metrics, logs or exceptions) hands out per language: how to
 * install the SDK, and how to point its exporters at OneUptime.
 *
 * <YOUR_ONEUPTIME_URL> is the OTLP endpoint the guide's first step shows,
 * <scheme>://<HOST>/otlp. The App serves OTLP over HTTP under it, at
 * /v1/traces, /v1/metrics and /v1/logs. Nothing answers the endpoint
 * itself, nor /v1/<signal> at the server's root (issue #7885).
 *
 * An SDK takes the address one of two ways:
 *  - as the endpoint (OTEL_EXPORTER_OTLP_ENDPOINT, Java's
 *    otel.exporter.otlp.endpoint, Elixir's otlp_endpoint), to which it adds
 *    /v1/<signal> itself: <YOUR_ONEUPTIME_URL> as it is;
 *  - as an address given to an exporter in code, which it posts to as
 *    written: the signal's own URL, <YOUR_ONEUPTIME_URL>/v1/<signal>. So do
 *    Python's endpoint=, .NET's Endpoint (with HttpProtobuf), Go's
 *    WithEndpointURL and Rust's with_endpoint (opentelemetry-otlp 0.16 and
 *    later), as Node's, PHP's, Ruby's, C++'s and Swift's already did.
 *
 * Before, Python's and .NET's exporters were given <YOUR_ONEUPTIME_URL> as
 * it is and posted to /otlp itself, which answers 404. Go's WithEndpoint
 * took the host alone and posted to https://<HOST>/v1/traces: https
 * whatever the server is, so a server on http failed the handshake, and a
 * path at the root, which no server block sends to the App. Rust's code was
 * opentelemetry-otlp 0.17's (install_batch returns the provider), under a
 * Cargo.toml pinning 0.15, which does not build it; it now pins the
 * versions its code is for, and sets the global provider itself, which
 * install_batch stopped doing in 0.17.
 *
 * React-free on purpose: the snippets are tested without the guide.
 */

type Language = TelemetryGuideLanguageKey;

/*
 * Fills the placeholders the guide's snippets carry: the OTLP endpoint, the
 * Pyroscope server address (profiles) and the picked key's token.
 */
export function replacePlaceholders(
  code: string,
  otlpUrl: string,
  token: string,
  pyroscopeUrl: string,
): string {
  return code
    .replace(/<YOUR_ONEUPTIME_URL>/g, otlpUrl)
    .replace(/<YOUR_ONEUPTIME_PYROSCOPE_URL>/g, pyroscopeUrl)
    .replace(/<YOUR_ONEUPTIME_TOKEN>/g, token);
}

// --- OpenTelemetry code snippets per language ---

export function getOtelInstallSnippet(lang: Language): {
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
opentelemetry = "0.26"
opentelemetry_sdk = { version = "0.26", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.26", features = ["http-proto", "reqwest-client"] }
tracing = "0.1"
tracing-opentelemetry = "0.27"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
reqwest = { version = "0.12", features = ["blocking"] }`,
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

export function getOtelConfigSnippet(lang: Language): {
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
            endpoint="<YOUR_ONEUPTIME_URL>/v1/traces",
            headers={"x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>"},
        )
    )
)
trace.set_tracer_provider(trace_provider)

# Metrics
metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(
        endpoint="<YOUR_ONEUPTIME_URL>/v1/metrics",
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
        otlptracehttp.WithEndpointURL("<YOUR_ONEUPTIME_URL>/v1/traces"),
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
            options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>/v1/traces");
            options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
            options.Protocol = OtlpExportProtocol.HttpProtobuf;
        })
    )
    .WithMetrics(metrics => metrics
        .SetResourceBuilder(resourceBuilder)
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(options => {
            options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>/v1/metrics");
            options.Headers = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";
            options.Protocol = OtlpExportProtocol.HttpProtobuf;
        })
    );

// Logs
builder.Logging.AddOpenTelemetry(logging => {
    logging.SetResourceBuilder(resourceBuilder);
    logging.AddOtlpExporter(options => {
        options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>/v1/logs");
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
        .with_endpoint("<YOUR_ONEUPTIME_URL>/v1/traces")
        .with_headers(headers);

    let provider = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(exporter)
        .with_trace_config(
            sdktrace::Config::default()
                .with_resource(Resource::new(vec![
                    KeyValue::new("service.name", "my-service"),
                ])),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .unwrap();

    global::set_tracer_provider(provider.clone());
    provider
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
      // This file is served to your users, so this token is public.
      // It must be a Browser ingestion key, never a Server one.
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
      // This file is served to your users, so this token is public.
      // It must be a Browser ingestion key, never a Server one.
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

export function getEnvVarSnippet(): string {
  return `# Alternatively, configure via environment variables (works with any language):
export OTEL_SERVICE_NAME="my-service"
export OTEL_EXPORTER_OTLP_ENDPOINT="<YOUR_ONEUPTIME_URL>"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"`;
}
