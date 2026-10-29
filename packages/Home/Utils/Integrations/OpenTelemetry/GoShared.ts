import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The Go guides' shared facts: the modules they add, at the versions the
 * end-to-end check ran (Verifications.json records the versions go.mod
 * selected, and Tests/OpenTelemetryGuides holds every `go get` to them),
 * the file that starts the SDK - the same on every Go guide - and the
 * image the guides build.
 *
 * OpenTelemetry Go, October 2026: the API and the SDK are v1.47.0 for
 * traces, metrics and logs (stable since this release); the OTLP log
 * exporter is still v0.23.0, and the contrib instrumentations are v0.72.0.
 * They need Go 1.26 or later.
 */
export const GO_PACKAGE_VERSIONS: Record<string, string> = {
  "go.opentelemetry.io/otel": "v1.47.0",
  "go.opentelemetry.io/otel/sdk": "v1.47.0",
  "go.opentelemetry.io/otel/sdk/metric": "v1.47.0",
  "go.opentelemetry.io/otel/sdk/log": "v1.47.0",
  "go.opentelemetry.io/otel/log": "v1.47.0",
  "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp": "v1.47.0",
  "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp":
    "v1.47.0",
  "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp": "v0.23.0",
  "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp": "v0.72.0",
  "go.opentelemetry.io/contrib/instrumentation/runtime": "v0.72.0",
  "go.opentelemetry.io/contrib/bridges/otelslog": "v0.21.0",
  "go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin":
    "v0.72.0",
  "go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc":
    "v0.72.0",
  // database/sql's instrumentation, and SQLite in pure Go: no C compiler.
  "github.com/XSAM/otelsql": "v0.44.0",
  "modernc.org/sqlite": "v1.61.0",
  // The instrumentations of GORM, pgx and go-redis, each its maker's.
  "gorm.io/plugin/opentelemetry": "v0.1.16",
  "github.com/exaring/otelpgx": "v0.13.0",
  "github.com/redis/go-redis/extra/redisotel/v9": "v9.23.0",
  // The frameworks and their own OpenTelemetry middleware.
  "github.com/gin-gonic/gin": "v1.12.0",
  "github.com/labstack/echo/v5": "v5.4.2",
  "github.com/labstack/echo-otel/v5": "v5.0.0",
  "github.com/labstack/echo/v4": "v4.16.2",
  "github.com/labstack/echo-otel/v4": "v4.0.0",
  "github.com/gofiber/fiber/v3": "v3.6.1",
  "github.com/gofiber/contrib/v3/otel": "v1.3.1",
  "github.com/gofiber/fiber/v2": "v2.52.16",
  "github.com/gofiber/contrib/otelfiber/v2": "v2.2.3",
  "google.golang.org/grpc": "v1.85.0",
  // The code generators of a gRPC service.
  "google.golang.org/protobuf/cmd/protoc-gen-go": "v1.36.12",
  "google.golang.org/grpc/cmd/protoc-gen-go-grpc": "v1.6.2",
};

// The Go every guide was checked with, and the oldest the SDK builds on.
export const GO_VERSION: string = "1.27";
export const MINIMUM_GO_VERSION: string = "1.26";

// Every Go guide's first prerequisite.
export const GO_PREREQUISITE: InlineText = `Go ${MINIMUM_GO_VERSION} or later, which OpenTelemetry Go v1.47 needs. These steps were checked with Go ${GO_VERSION}.`;

/*
 * The modules every Go guide adds: the API, the SDK for each signal, an
 * OTLP exporter for each, slog's bridge to OpenTelemetry's logs, and the
 * runtime's metrics.
 */
export const GO_SDK_MODULES: ReadonlyArray<string> = [
  "go.opentelemetry.io/otel",
  "go.opentelemetry.io/otel/sdk",
  "go.opentelemetry.io/otel/sdk/metric",
  "go.opentelemetry.io/otel/sdk/log",
  "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp",
  "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp",
  "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp",
  "go.opentelemetry.io/contrib/bridges/otelslog",
  "go.opentelemetry.io/contrib/instrumentation/runtime",
];

// A module at its pinned version: "go.opentelemetry.io/otel@v1.47.0".
export function pinnedGoModule(module: string): string {
  const version: string | undefined = GO_PACKAGE_VERSIONS[module];

  if (!version) {
    throw new Error(`No pinned version for ${module}`);
  }

  return `${module}@${version}`;
}

// `go get` of the given modules at their pinned versions, one a line.
export function goGetSnippet(
  id: string,
  modules: ReadonlyArray<string>,
): GuideSnippet {
  return {
    id: id,
    language: "bash",
    code: `go get ${modules.map(pinnedGoModule).join(" \\\n  ")}`,
    check: "run",
  };
}

export interface GoSetupOptions {
  /*
   * The package the file is in: "main" for one program, or a package of
   * its own that every program of a module imports ("telemetry").
   */
  packageName: string;
  // Where the page shows it: "otel.go", "telemetry/otel.go".
  title: string;
  // The function's name: setupOpenTelemetry in main, Setup in a package.
  functionName: string;
}

/*
 * The file that starts OpenTelemetry in a Go program: a provider and an
 * OTLP exporter for each signal, the W3C propagators, and the runtime's
 * metrics. The exporters and the resource read the standard variables, so
 * the code holds no endpoint, key or service name. It returns the function
 * that sends what is still buffered: a Go program must call it before it
 * exits, or the last batches are lost.
 */
export function goSetupSnippet(
  options: GoSetupOptions = {
    packageName: "main",
    title: "otel.go",
    functionName: "setupOpenTelemetry",
  },
): GuideSnippet {
  return {
    id: "otel-setup",
    language: "go",
    title: options.title,
    code: [
      `package ${options.packageName}`,
      "",
      "import (",
      '\t"context"',
      '\t"errors"',
      "",
      '\t"go.opentelemetry.io/contrib/instrumentation/runtime"',
      '\t"go.opentelemetry.io/otel"',
      '\t"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"',
      '\t"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"',
      '\t"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"',
      '\t"go.opentelemetry.io/otel/log/global"',
      '\t"go.opentelemetry.io/otel/propagation"',
      '\tsdklog "go.opentelemetry.io/otel/sdk/log"',
      '\tsdkmetric "go.opentelemetry.io/otel/sdk/metric"',
      '\tsdktrace "go.opentelemetry.io/otel/sdk/trace"',
      ")",
      "",
      `// ${options.functionName} starts a provider for traces, metrics and logs. The`,
      "// exporters read OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS, and",
      "// the resource reads OTEL_SERVICE_NAME. Call the function it returns before the",
      "// program exits: it sends what is still buffered.",
      `func ${options.functionName}(ctx context.Context) (func(context.Context) error, error) {`,
      "\tvar shutdowns []func(context.Context) error",
      "\tshutdown := func(ctx context.Context) error {",
      "\t\tvar err error",
      "\t\tfor _, stop := range shutdowns {",
      "\t\t\terr = errors.Join(err, stop(ctx))",
      "\t\t}",
      "\t\treturn err",
      "\t}",
      "",
      "\totel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(",
      "\t\tpropagation.TraceContext{}, propagation.Baggage{},",
      "\t))",
      "",
      "\ttraceExporter, err := otlptracehttp.New(ctx)",
      "\tif err != nil {",
      "\t\treturn shutdown, err",
      "\t}",
      "\ttracerProvider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traceExporter))",
      "\tshutdowns = append(shutdowns, tracerProvider.Shutdown)",
      "\totel.SetTracerProvider(tracerProvider)",
      "",
      "\tmetricExporter, err := otlpmetrichttp.New(ctx)",
      "\tif err != nil {",
      "\t\treturn shutdown, err",
      "\t}",
      "\tmeterProvider := sdkmetric.NewMeterProvider(",
      "\t\tsdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)),",
      "\t)",
      "\tshutdowns = append(shutdowns, meterProvider.Shutdown)",
      "\totel.SetMeterProvider(meterProvider)",
      "",
      "\tlogExporter, err := otlploghttp.New(ctx)",
      "\tif err != nil {",
      "\t\treturn shutdown, err",
      "\t}",
      "\tloggerProvider := sdklog.NewLoggerProvider(",
      "\t\tsdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)),",
      "\t)",
      "\tshutdowns = append(shutdowns, loggerProvider.Shutdown)",
      "\tglobal.SetLoggerProvider(loggerProvider)",
      "",
      "\t// The Go runtime's own metrics: memory, goroutines, garbage collection.",
      "\tif err := runtime.Start(); err != nil {",
      "\t\treturn shutdown, err",
      "\t}",
      "",
      "\treturn shutdown, nil",
      "}",
    ].join("\n"),
    check: "run",
  };
}

/*
 * One top-level declaration of a Go file, as gofmt writes it: from the
 * line that starts with `firstLine` to the closing brace (or parenthesis)
 * at the start of a line. A guide shows a handler this way, word for word
 * as the file the end-to-end check builds holds it.
 */
export function goDeclaration(source: string, firstLine: string): string {
  const lines: Array<string> = source.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(firstLine);
  });
  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return start >= 0 && index >= start && (line === "}" || line === ")");
    },
  );

  if (start < 0 || end < 0) {
    throw new Error(`No Go declaration starts with ${firstLine}`);
  }

  return lines.slice(start, end + 1).join("\n");
}

export interface GoDockerfileOptions {
  // What `go build` builds: "." for the module's root, "./cmd/orders".
  build: string;
  // The binary's name in the image.
  binary: string;
  // The port it listens on.
  port: number;
}

/*
 * A two-stage image: the Go image builds a static binary, and a distroless
 * image runs it as a user without privileges - no shell, no package
 * manager, a few megabytes.
 */
export function goDockerfileSnippet(
  options: GoDockerfileOptions,
): GuideSnippet {
  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: [
      `FROM golang:${GO_VERSION} AS build`,
      "WORKDIR /src",
      "COPY go.mod go.sum ./",
      "RUN go mod download",
      "COPY . .",
      `RUN CGO_ENABLED=0 go build -o /out/${options.binary} ${options.build}`,
      "",
      "FROM gcr.io/distroless/static-debian13:nonroot",
      `COPY --from=build /out/${options.binary} /${options.binary}`,
      `EXPOSE ${options.port}`,
      `ENTRYPOINT ["/${options.binary}"]`,
    ].join("\n"),
    check: "parse",
  };
}
