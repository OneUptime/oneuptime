import { GuideSnippet } from "./GuideTypes";

/*
 * The JavaScript guides' shared facts: the OpenTelemetry packages they
 * install, at the versions the end-to-end check ran (Verifications.json
 * records them, and Tests/OpenTelemetryGuides holds every install command to
 * them), and the instrumentation file the Node.js frameworks load.
 *
 * OpenTelemetry JS 3.0 (October 2026): the SDK packages are 3.x, the
 * experimental ones 0.300.x, and @opentelemetry/api 1.10 carries the Logs
 * API (logs, SeverityNumber). It needs Node.js 22.15 or later.
 */
export const JAVASCRIPT_PACKAGE_VERSIONS: Record<string, string> = {
  "@opentelemetry/api": "1.10.0",
  "@opentelemetry/sdk-node": "0.300.0",
  "@opentelemetry/auto-instrumentations-node": "0.82.0",
  "@opentelemetry/instrumentation": "0.300.0",
  "@opentelemetry/winston-transport": "0.35.0",
  "@fastify/otel": "0.21.4",
  // Loggers a guide asks for, at the versions its check ran with.
  "nestjs-pino": "5.3.1",
  "pino-http": "11.0.0",
  pino: "10.4.0",
  "hapi-pino": "13.0.0",
  winston: "3.19.0",
  // In the browser.
  "@opentelemetry/sdk-trace": "3.0.0",
  "@opentelemetry/sdk-logs": "3.0.0",
  "@opentelemetry/sdk-metrics": "3.0.0",
  "@opentelemetry/core": "3.0.0",
  "@opentelemetry/resources": "3.0.0",
  "@opentelemetry/context-zone": "3.0.0",
  "@opentelemetry/exporter-trace-otlp-http": "0.300.0",
  "@opentelemetry/exporter-logs-otlp-http": "0.300.0",
  "@opentelemetry/exporter-metrics-otlp-http": "0.300.0",
  "@opentelemetry/auto-instrumentations-web": "0.69.0",
  "@opentelemetry/opentelemetry-browser-detector": "0.300.0",
  "web-vitals": "6.2.3",
  "zone.js": "0.16.3",
};

// The oldest Node.js the SDK supports (its package.json engines).
export const MINIMUM_NODE_VERSION: string = "22.15";

// The Node.js frameworks' first prerequisite.
export const NODE_PREREQUISITE: string = `Node.js ${MINIMUM_NODE_VERSION} or later, which the OpenTelemetry JS SDK 3.0 needs.`;

// A package at its pinned version: "@opentelemetry/api@1.10.0".
export function pinned(packageName: string): string {
  const version: string | undefined = JAVASCRIPT_PACKAGE_VERSIONS[packageName];

  if (!version) {
    throw new Error(`No pinned version for ${packageName}`);
  }

  return `${packageName}@${version}`;
}

/*
 * `npm install` of the given packages at their pinned versions, one a line.
 * Packages the guide does not pin (its framework's own) go in `unpinned`.
 */
export function npmInstallSnippet(
  id: string,
  packages: Array<string>,
  unpinned: Array<string> = [],
): GuideSnippet {
  const names: Array<string> = [
    ...packages.map((packageName: string): string => {
      return pinned(packageName);
    }),
    ...unpinned,
  ];

  return {
    id: id,
    language: "bash",
    code: `npm install ${names.join(" \\\n  ")}`,
    check: "run",
  };
}

// `bun add` of the given packages at their pinned versions, one a line.
export function bunAddSnippet(id: string, packages: Array<string>): GuideSnippet {
  return {
    id: id,
    language: "bash",
    code: `bun add ${packages.map(pinned).join(" \\\n  ")}`,
    check: "run",
  };
}

export interface NodeInstrumentationOptions {
  // Imports after the SDK's own, for instrumentations outside the bundle.
  extraImports?: Array<string> | undefined;
  /*
   * Lines inside getNodeAutoInstrumentations({ ... }), before the http
   * instrumentation's options: an instrumentation switched off, with why.
   */
  autoInstrumentationLines?: Array<string> | undefined;
  // Instrumentations added after the bundle's, one a line, with commas.
  extraInstrumentationLines?: Array<string> | undefined;
  // The health check path the http instrumentation leaves out.
  healthCheckPath?: string | undefined;
}

/*
 * The instrumentation file the Node.js frameworks load before the app with
 * `node --import ./instrumentation.mjs`. ES modules or CommonJS, the same
 * file: it registers the ES module hook the instrumentations need to patch
 * imported packages, starts the SDK, and flushes on shutdown - waiting for
 * the app when the app handles the signal itself, as NestJS does - and when
 * a script's event loop empties, so a job that ends on its own loses nothing.
 */
export function nodeInstrumentationFile(
  options: NodeInstrumentationOptions = {},
): string {
  const healthCheckPath: string = options.healthCheckPath || "/healthz";

  const lines: Array<string> = [
    'import { register } from "node:module";',
    'import { NodeSDK } from "@opentelemetry/sdk-node";',
    'import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";',
    ...(options.extraImports || []),
    "",
    "// Lets the instrumentations patch the packages your ES modules import.",
    'register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);',
    "",
    "// Reads OTEL_SERVICE_NAME and the OTEL_EXPORTER_OTLP_* variables, and sends",
    "// traces, metrics and logs to OneUptime over OTLP/HTTP.",
    "const sdk = new NodeSDK({",
    "  instrumentations: [",
    "    getNodeAutoInstrumentations({",
    ...(options.autoInstrumentationLines || []).map((line: string): string => {
      return `      ${line}`;
    }),
    '      "@opentelemetry/instrumentation-http": {',
    "        // Load balancer health checks would be most of your traces.",
    `        ignoreIncomingRequestHook: (request) => request.url === "${healthCheckPath}",`,
    "      },",
    "    }),",
    ...(options.extraInstrumentationLines || []).map(
      (line: string): string => {
        return `    ${line}`;
      },
    ),
    "  ],",
    "});",
    "",
    "sdk.start();",
    "",
    "// On SIGTERM or Ctrl+C, send what is still buffered, then exit - unless your",
    "// app handles the signal too: then it decides when the process stops.",
    "let flushing;",
    'for (const signal of ["SIGTERM", "SIGINT"]) {',
    "  process.on(signal, async () => {",
    "    await (flushing ??= sdk.shutdown());",
    "    if (process.listenerCount(signal) === 1) process.exit(0);",
    "  });",
    "}",
    "",
    "// A script or a job that ends on its own sends what is still buffered first.",
    'process.once("beforeExit", () => {',
    "  flushing ??= sdk.shutdown();",
    "});",
  ];

  return lines.join("\n");
}

export interface NodeDockerfileOptions {
  // The command the container runs, as JSON array parts.
  command: Array<string>;
  // Files copied beside package.json before `npm ci`, then the rest.
  buildSteps?: Array<string> | undefined;
  port: number;
}

// A Node.js 24 image that loads OpenTelemetry before the app.
export function nodeDockerfileSnippet(options: NodeDockerfileOptions): GuideSnippet {
  const lines: Array<string> = [
    "FROM node:24-alpine",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm ci --omit=dev",
    "COPY . .",
    ...(options.buildSteps || []),
    "ENV NODE_ENV=production",
    `EXPOSE ${options.port}`,
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
