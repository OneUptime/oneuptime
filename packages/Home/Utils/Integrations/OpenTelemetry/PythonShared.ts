import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The Python guides' shared facts: the packages they install, at the
 * versions the end-to-end check ran (Verifications.json records them, and
 * Tests/OpenTelemetryGuides holds every install command to them), and the
 * lines every Python guide's setup needs.
 *
 * OpenTelemetry Python, October 2026: the API, SDK and exporters are
 * 1.45.x, the distro and every instrumentation 0.66b1, released together;
 * both support Python 3.10 to 3.14.
 */
export const PYTHON_PACKAGE_VERSIONS: Record<string, string> = {
  "opentelemetry-distro": "0.66b1",
  "opentelemetry-exporter-otlp-proto-http": "1.45.1",
  // What sends Python's logging records to OneUptime (SDK 1.45 deprecates its own handler).
  "opentelemetry-instrumentation-logging": "0.66b1",
  "opentelemetry-instrumentation-system-metrics": "0.66b1",
  "opentelemetry-instrumentation-django": "0.66b1",
  "opentelemetry-instrumentation-flask": "0.66b1",
  "opentelemetry-instrumentation-fastapi": "0.66b1",
  "opentelemetry-instrumentation-celery": "0.66b1",
  "opentelemetry-instrumentation-requests": "0.66b1",
  "opentelemetry-instrumentation-httpx": "0.66b1",
  "opentelemetry-instrumentation-sqlite3": "0.66b1",
  "opentelemetry-instrumentation-psycopg": "0.66b1",
  "opentelemetry-instrumentation-sqlalchemy": "0.66b1",
  "opentelemetry-instrumentation-redis": "0.66b1",
  /*
   * A library a guide pins for its instrumentation's sake: the SQLAlchemy
   * instrumentation supports SQLAlchemy up to 2.0.
   */
  sqlalchemy: "2.0.55",
};

// The oldest Python the SDK supports, and the newest it is released for.
export const MINIMUM_PYTHON_VERSION: string = "3.10";

// Every Python guide's first prerequisite.
export const PYTHON_PREREQUISITE: InlineText = `Python ${MINIMUM_PYTHON_VERSION} to 3.14, which OpenTelemetry Python 1.45 supports, and a virtual environment for your app.`;

/*
 * Python's HTTP instrumentations still write the older names of HTTP spans
 * and metrics unless asked for the stable ones, which every other
 * OpenTelemetry SDK writes: the Python guides ask, so a Python service's
 * request latency charts beside a Java or Node.js one's.
 */
export const PYTHON_STABLE_HTTP_LINE: string =
  'export OTEL_SEMCONV_STABILITY_OPT_IN="http"';

// Why the Python guides set the protocol, the same fact on every page.
export const PYTHON_PROTOCOL_NOTE: InlineText =
  "The Python distro sends OTLP over gRPC unless told otherwise, and gRPC needs a package these steps do not install: without `OTEL_EXPORTER_OTLP_PROTOCOL`, `opentelemetry-instrument` stops with `Requested component 'otlp_proto_grpc' not found` and your app runs with no telemetry at all.";

// Why they ask for the stable HTTP names.
export const PYTHON_STABLE_HTTP_NOTE: InlineText =
  "`OTEL_SEMCONV_STABILITY_OPT_IN=http` gives HTTP spans and metrics the stable names every other OpenTelemetry SDK writes, such as `http.server.request.duration` and `http.response.status_code`, in place of Python's older `http.server.duration` and `http.status_code`.";

// A package at its pinned version: "opentelemetry-distro==0.66b1".
export function pinnedPythonPackage(packageName: string): string {
  const version: string | undefined = PYTHON_PACKAGE_VERSIONS[packageName];

  if (!version) {
    throw new Error(`No pinned version for ${packageName}`);
  }

  return `${packageName}==${version}`;
}

/*
 * `pip install` of the given OpenTelemetry packages at their pinned
 * versions, one a line, then the app's own packages as the guide pins them.
 */
export function pipInstallSnippet(
  id: string,
  packages: Array<string>,
  appPackages: Array<string> = [],
): GuideSnippet {
  return {
    id: id,
    language: "bash",
    code: `pip install ${[...packages.map(pinnedPythonPackage), ...appPackages].join(" \\\n  ")}`,
    check: "run",
  };
}

export interface PythonDockerfileOptions {
  // The command the container runs, as JSON array parts.
  command: Array<string>;
  // The port it listens on; none for a worker.
  port?: number | undefined;
  // ENV lines the app needs in every environment: DJANGO_SETTINGS_MODULE.
  environment?: Record<string, string> | undefined;
}

/*
 * A Python 3.14 image that installs requirements.txt and starts the app
 * under OpenTelemetry. PYTHONUNBUFFERED keeps print and logging output
 * moving as the app writes it.
 */
export function pythonDockerfileSnippet(
  options: PythonDockerfileOptions,
): GuideSnippet {
  const lines: Array<string> = [
    "FROM python:3.14-slim",
    "WORKDIR /app",
    "COPY requirements.txt ./",
    "RUN pip install --no-cache-dir -r requirements.txt",
    "COPY . .",
    "ENV PYTHONUNBUFFERED=1",
    ...Object.entries(options.environment || {}).map(
      ([name, value]: [string, string]): string => {
        return `ENV ${name}=${value}`;
      },
    ),
    ...(options.port === undefined ? [] : [`EXPOSE ${options.port}`]),
    `CMD [${options.command
      .map((part: string): string => {
        return `"${part}"`;
      })
      .join(", ")}]`,
  ];

  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: lines.join("\n"),
    check: "parse",
  };
}
