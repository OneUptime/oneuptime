import {
  GuideLink,
  GuideSnippet,
  GuideStep,
  GuideTabs,
  InlineText,
  VerificationService,
} from "./GuideTypes";

/*
 * What every guide says the same way, whatever the language: where OneUptime
 * takes OTLP, the key that goes with it, where to look once data arrives, and
 * the docs pages that go deeper. Each guide writes its own framework's words
 * around these; the facts here are the product's, kept in one place.
 */

// OneUptime Cloud's OTLP/HTTP endpoint. SDKs add /v1/traces, /v1/metrics, /v1/logs.
export const CLOUD_OTLP_ENDPOINT: string = "https://oneuptime.com/otlp";

/*
 * A self-hosted installation's endpoint, as the guides write it: the
 * reader's own host. oneuptime.example.com is a documentation domain.
 */
export const SELF_HOSTED_OTLP_ENDPOINT: string =
  "https://oneuptime.example.com/otlp";

// What a reader replaces with their ingestion key's Secret Key.
export const INGESTION_KEY_PLACEHOLDER: string = "YOUR_ONEUPTIME_INGESTION_KEY";

// The same for a Browser key, which ships in a web page.
export const BROWSER_KEY_PLACEHOLDER: string = "YOUR_ONEUPTIME_BROWSER_KEY";

// The header OneUptime reads the key from.
export const INGESTION_KEY_HEADER: string = "x-oneuptime-token";

// Where the dashboard lists what arrives.
export const SCREENS: {
  services: string;
  traces: string;
  logs: string;
  metrics: string;
  exceptions: string;
  rum: string;
  ingestionKeys: string;
} = {
  services: "**Products → Resources → Services**",
  traces: "**Products → Observability → Traces**",
  logs: "**Products → Observability → Logs**",
  metrics: "**Products → Observability → Metrics**",
  exceptions: "**Products → Observability → Exceptions**",
  rum: "**Products → Resources → Real User Monitoring**",
  ingestionKeys: "**Project Settings → Telemetry & APM → Ingestion Keys**",
};

export const DOCS: Record<
  | "openTelemetry"
  | "ingestionKeys"
  | "services"
  | "traces"
  | "logs"
  | "metrics"
  | "exceptions"
  | "dropFilters"
  | "searchSyntax"
  | "dataRetention"
  | "kubernetesAgent"
  | "browserSetup"
  | "webVitals"
  | "sessionReplay"
  | "sourceMaps"
  | "rum",
  GuideLink
> = {
  openTelemetry: {
    title: "OpenTelemetry",
    href: "/docs/telemetry/open-telemetry",
    description:
      "Endpoints, limits, gRPC, every response code and the Collector.",
  },
  ingestionKeys: {
    title: "Ingestion keys",
    href: "/docs/telemetry/ingestion-keys",
    description: "Server and Browser keys, rotating a key, every refusal.",
  },
  services: {
    title: "Services",
    href: "/docs/telemetry/services",
    description: "The service catalog your service.name lands in.",
  },
  traces: {
    title: "Traces explorer",
    href: "/docs/telemetry/traces-explorer",
    description: "Search spans, read a trace's waterfall, chart latency.",
  },
  logs: {
    title: "Logs explorer",
    href: "/docs/telemetry/logs-explorer",
    description: "Search logs and open the trace a log was written in.",
  },
  metrics: {
    title: "Metrics explorer",
    href: "/docs/telemetry/metrics-explorer",
    description: "Chart, filter and group the metrics your service sends.",
  },
  exceptions: {
    title: "Exception tracking",
    href: "/docs/telemetry/exceptions",
    description: "How errors are grouped into issues, and how to triage them.",
  },
  dropFilters: {
    title: "Drop filters and scrub rules",
    href: "/docs/telemetry/drop-filters-and-scrub-rules",
    description: "Drop noise and mask secrets as data arrives.",
  },
  searchSyntax: {
    title: "Search syntax",
    href: "/docs/telemetry/search-syntax",
    description: "Find spans and logs by attribute, status and duration.",
  },
  dataRetention: {
    title: "Data retention",
    href: "/docs/telemetry/data-retention",
    description: "How long traces, logs and metrics are kept.",
  },
  kubernetesAgent: {
    title: "Kubernetes agent",
    href: "/docs/telemetry/kubernetes-agent",
    description: "Cluster, node and pod telemetry beside your services.",
  },
  browserSetup: {
    title: "Browser RUM setup",
    href: "/docs/rum/browser-setup",
    description: "Browser keys, linking to backend traces, CSP.",
  },
  webVitals: {
    title: "Core Web Vitals",
    href: "/docs/rum/web-vitals",
    description: "The metric names the Core Web Vitals card reads.",
  },
  sessionReplay: {
    title: "Session Replay",
    href: "/docs/telemetry/session-replay",
    description: "Watch what a user saw when an error happened.",
  },
  sourceMaps: {
    title: "Source maps",
    href: "/docs/telemetry/source-maps",
    description: "Readable stack traces from minified bundles.",
  },
  rum: {
    title: "Real User Monitoring",
    href: "/docs/rum/index",
    description: "How OneUptime files browser telemetry as a RUM application.",
  },
};

/*
 * The standard variables the OpenTelemetry SDKs read their exporter's
 * settings from. A framework with names of its own (Quarkus reads
 * QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT, and ignores these) passes its own.
 */
export interface OtlpVariableNames {
  endpoint: string;
  headers: string;
  serviceName: string;
  resourceAttributes: string;
}

export const STANDARD_OTLP_VARIABLES: OtlpVariableNames = {
  endpoint: "OTEL_EXPORTER_OTLP_ENDPOINT",
  headers: "OTEL_EXPORTER_OTLP_HEADERS",
  serviceName: "OTEL_SERVICE_NAME",
  resourceAttributes: "OTEL_RESOURCE_ATTRIBUTES",
};

/*
 * OTLP over HTTP, which is what the /otlp endpoint takes. The JavaScript
 * SDK and the Java agent send it by default; the Python distro, the .NET
 * exporter and the Java SDK on its own default to gRPC, so their guides
 * add this line.
 */
export const OTLP_HTTP_PROTOCOL_LINE: string =
  'export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"';

export interface OtlpEnvironmentOptions {
  // The service.name the guide's example app reports.
  serviceName: string;
  // Lines added after the standard three, such as OTEL_DENO=true.
  extraLines?: Array<string> | undefined;
  // The variables' names, where the framework reads names of its own.
  variables?: OtlpVariableNames | undefined;
  // A sentence under the Cloud tab's code.
  cloudNote?: InlineText | undefined;
  // A sentence under the self-hosted tab's code.
  selfHostedNote?: InlineText | undefined;
}

function environmentLines(
  endpoint: string,
  options: OtlpEnvironmentOptions,
): string {
  const variables: OtlpVariableNames =
    options.variables || STANDARD_OTLP_VARIABLES;

  return [
    `export ${variables.endpoint}="${endpoint}"`,
    `export ${variables.headers}="${INGESTION_KEY_HEADER}=${INGESTION_KEY_PLACEHOLDER}"`,
    `export ${variables.serviceName}="${options.serviceName}"`,
    ...(options.extraLines || []),
  ].join("\n");
}

/*
 * The exporter's configuration as environment variables, for OneUptime Cloud
 * and for a self-hosted installation. The end-to-end check runs the Cloud
 * tab's lines (pointed at its local receiver), so the variable names are
 * checked; the self-hosted tab differs only in the host.
 */
export function otlpEnvironmentTabs(
  options: OtlpEnvironmentOptions,
): GuideTabs {
  return {
    group: "deployment",
    tabs: [
      {
        label: "OneUptime Cloud",
        snippets: [
          {
            id: "env-cloud",
            language: "bash",
            title: "Environment",
            code: environmentLines(CLOUD_OTLP_ENDPOINT, options),
            check: "run",
          },
        ],
        notes: options.cloudNote ? [options.cloudNote] : [],
      },
      {
        label: "Self-hosted",
        snippets: [
          {
            id: "env-self-hosted",
            language: "bash",
            title: "Environment",
            code: environmentLines(SELF_HOSTED_OTLP_ENDPOINT, options),
            check: "parse",
          },
        ],
        notes: [
          options.selfHostedNote ||
            "Use your own OneUptime host in place of `oneuptime.example.com`, with `http://` if your installation is served over plain HTTP.",
        ],
      },
    ],
  };
}

// Asks OneUptime whether it accepts a key, before anything else is checked.
export function validateKeySnippet(
  placeholder: string = INGESTION_KEY_PLACEHOLDER,
): GuideSnippet {
  return {
    id: "validate-key",
    language: "bash",
    title: "Check the key",
    code: [
      `curl -i -H "${INGESTION_KEY_HEADER}: ${placeholder}" \\`,
      `  ${CLOUD_OTLP_ENDPOINT}/v1/validate`,
    ].join("\n"),
    check: "parse",
  };
}

// The prerequisite every server guide has: a key that writes from anywhere.
export const SERVER_KEY_PREREQUISITE: InlineText = `A OneUptime ingestion key of the **Server** type, from ${SCREENS.ingestionKeys}: see [Ingestion keys](/docs/telemetry/ingestion-keys).`;

// ...and every browser guide: a key that only writes from its origins.
export const BROWSER_KEY_PREREQUISITE: InlineText = `A OneUptime ingestion key of the **Browser** type, from ${SCREENS.ingestionKeys}, with every origin your pages are served from in its **Allowed Origins**: see [Ingestion keys](/docs/telemetry/ingestion-keys).`;

export const VALIDATE_SERVER_KEY_BODY: InlineText =
  '`200` with `"valid": true` means OneUptime accepts the key. A `401` says why it does not: the key is unknown, switched off or expired.';

export const VALIDATE_BROWSER_KEY_BODY: InlineText =
  '`200` with `"valid": true` means OneUptime accepts the key; for a Browser key, the message adds that it works only from a browser, from one of its Allowed Origins. A `401` says why it does not.';

// Every guide's first check: whether OneUptime accepts the key at all.
export function validateKeyStep(kind: "server" | "browser"): GuideStep {
  return {
    title: "Ask OneUptime whether it accepts the key",
    body:
      kind === "server" ? VALIDATE_SERVER_KEY_BODY : VALIDATE_BROWSER_KEY_BODY,
    snippets: [
      validateKeySnippet(
        kind === "server" ? INGESTION_KEY_PLACEHOLDER : BROWSER_KEY_PLACEHOLDER,
      ),
    ],
  };
}

export interface KubernetesManifestOptions {
  // The Deployment's name and app label: "checkout-api".
  name: string;
  image: string;
  /*
   * The port the container listens on; none for a worker or a job, which
   * take no requests.
   */
  containerPort?: number | undefined;
  // Variables the container gets besides the three standard ones.
  extraEnv?: Array<{ name: string; value: string }> | undefined;
  // The variables' names, where the framework reads names of its own.
  variables?: OtlpVariableNames | undefined;
  // The container's command, when the image's own does not load OpenTelemetry.
  command?: Array<string> | undefined;
  // How many pods: 2 unless the app must run alone, as a scheduled importer does.
  replicas?: number | undefined;
}

// The Secret every manifest reads the key from: never in an image or in git.
function ingestionKeySecretLines(variables: OtlpVariableNames): Array<string> {
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: oneuptime-otlp",
    "stringData:",
    `  ${variables.headers}: "${INGESTION_KEY_HEADER}=${INGESTION_KEY_PLACEHOLDER}"`,
    "---",
  ];
}

/*
 * A container's envFrom (the Secret) and env (the rest of the exporter's
 * settings), indented to sit under its `- name:` line.
 */
function containerEnvironmentLines(
  name: string,
  variables: OtlpVariableNames,
  extraEnv: Array<{ name: string; value: string }>,
  indent: string,
): Array<string> {
  const env: Array<{ name: string; value: string }> = [
    { name: variables.serviceName, value: name },
    { name: variables.endpoint, value: CLOUD_OTLP_ENDPOINT },
    {
      name: variables.resourceAttributes,
      value: "deployment.environment.name=production",
    },
    ...extraEnv,
  ];

  return [
    `${indent}envFrom:`,
    `${indent}  - secretRef:`,
    `${indent}      name: oneuptime-otlp`,
    `${indent}env:`,
    ...env.flatMap((variable: { name: string; value: string }) => {
      return [
        `${indent}  - name: ${variable.name}`,
        `${indent}    value: "${variable.value}"`,
      ];
    }),
  ];
}

/*
 * The ingestion key in a Secret and the rest of the exporter's settings on
 * the Deployment: the key never sits in an image or a manifest in git.
 */
export function kubernetesManifestSnippet(
  options: KubernetesManifestOptions,
): GuideSnippet {
  const variables: OtlpVariableNames =
    options.variables || STANDARD_OTLP_VARIABLES;

  const lines: Array<string> = [
    ...ingestionKeySecretLines(variables),
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    `  name: ${options.name}`,
    "spec:",
    `  replicas: ${options.replicas === undefined ? 2 : options.replicas}`,
    "  selector:",
    "    matchLabels:",
    `      app: ${options.name}`,
    "  template:",
    "    metadata:",
    "      labels:",
    `        app: ${options.name}`,
    "    spec:",
    "      containers:",
    `        - name: ${options.name}`,
    `          image: ${options.image}`,
  ];

  if (options.command) {
    lines.push(
      `          command: [${options.command
        .map((part: string): string => {
          return `"${part}"`;
        })
        .join(", ")}]`,
    );
  }

  if (options.containerPort !== undefined) {
    lines.push(
      "          ports:",
      `            - containerPort: ${options.containerPort}`,
    );
  }

  lines.push(
    ...containerEnvironmentLines(
      options.name,
      variables,
      options.extraEnv || [],
      "          ",
    ),
  );

  return {
    id: "kubernetes",
    language: "yaml",
    title: "kubernetes.yaml",
    code: lines.join("\n"),
    check: "parse",
  };
}

export interface KubernetesCronJobOptions {
  // The CronJob's name and its container's.
  name: string;
  image: string;
  // When it runs, in cron's five fields: "*/15 * * * *".
  schedule: string;
  // Variables the container gets besides the three standard ones.
  extraEnv?: Array<{ name: string; value: string }> | undefined;
}

/*
 * A job that runs on a schedule, with the key in the same Secret: each run
 * is a pod that starts, sends its telemetry as it ends, and is gone.
 */
export function kubernetesCronJobSnippet(
  options: KubernetesCronJobOptions,
): GuideSnippet {
  const lines: Array<string> = [
    ...ingestionKeySecretLines(STANDARD_OTLP_VARIABLES),
    "apiVersion: batch/v1",
    "kind: CronJob",
    "metadata:",
    `  name: ${options.name}`,
    "spec:",
    `  schedule: "${options.schedule}"`,
    "  concurrencyPolicy: Forbid",
    "  jobTemplate:",
    "    spec:",
    "      template:",
    "        spec:",
    "          restartPolicy: OnFailure",
    "          containers:",
    `            - name: ${options.name}`,
    `              image: ${options.image}`,
    ...containerEnvironmentLines(
      options.name,
      STANDARD_OTLP_VARIABLES,
      options.extraEnv || [],
      "              ",
    ),
  ];

  return {
    id: "kubernetes",
    language: "yaml",
    title: "kubernetes.yaml",
    code: lines.join("\n"),
    check: "parse",
  };
}

/*
 * The receiver the end-to-end check sends to: a stand-in for OneUptime's
 * /otlp ingest (same paths, same 401 without the key) in front of a real
 * OpenTelemetry Collector that decodes every request.
 */
export const VERIFICATION_RECEIVER: string =
  "OpenTelemetry Collector Contrib 0.161.0, behind a stand-in for OneUptime's /otlp endpoint that refuses a request without the x-oneuptime-token header";

/*
 * The PostgreSQL an end-to-end run starts beside an app that keeps its rows
 * there: a database, user and password all named shop. The app is given
 * the port the check maps through appEnvironment, {port} standing for it.
 */
export function postgresService(
  appEnvironment: Record<string, string>,
): VerificationService {
  return {
    name: "postgres",
    image: "postgres:15",
    containerPort: 5432,
    environment: {
      POSTGRES_USER: "shop",
      POSTGRES_PASSWORD: "shop",
      POSTGRES_DB: "shop",
    },
    appEnvironment: appEnvironment,
    // Once before it creates the database, and once after.
    readyLog: {
      text: "database system is ready to accept connections",
      times: 2,
    },
  };
}

// The Redis an end-to-end run starts beside an app that caches or queues there.
export function redisService(
  appEnvironment: Record<string, string>,
): VerificationService {
  return {
    name: "redis",
    image: "redis:8.10.3-alpine",
    containerPort: 6379,
    appEnvironment: appEnvironment,
    readyLog: { text: "Ready to accept connections", times: 1 },
  };
}
