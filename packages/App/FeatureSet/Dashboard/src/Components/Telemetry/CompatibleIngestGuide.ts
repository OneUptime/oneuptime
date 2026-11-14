import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  DATADOG_BASE_PATH,
  LOKI_PUSH_PATH,
  PROMETHEUS_REMOTE_WRITE_PATH,
  SENTRY_BASE_PATH,
  SENTRY_DSN_PROJECT_NUMBER,
  SPLUNK_HEC_BASE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE SETUP GUIDE'S "ALREADY USING ANOTHER TOOL?" WAYS TO SEND (issue
 * #6797).
 *
 * A team that already runs Prometheus, a Loki client, a Splunk forwarder,
 * the Datadog Agent or a Sentry SDK should not have to re-instrument to try
 * OneUptime. Each of these ways keeps what they run and changes where it
 * sends - a URL and the ingestion key - through the compatible endpoints
 * (Common/Types/Telemetry/CompatibleIngest), which store what arrives as
 * OpenTelemetry data.
 *
 * Each guide lists in the Setup Guide of the products it fills, after the
 * OpenTelemetry way (still the recommended one) and under a heading of its
 * own, so a reader starting fresh is not asked to choose between tools they
 * do not run. Its three steps: the key (with the URL the tool is pointed
 * at), the tool's own configuration with that URL and key filled in, and
 * what the data becomes in OneUptime.
 *
 * React-free on purpose: the snippets and words are tested without the
 * guide.
 */

export enum CompatibleIngestMethod {
  Prometheus = "prometheus",
  Loki = "loki",
  SplunkHec = "splunk-hec",
  Datadog = "datadog",
  Sentry = "sentry",
}

// The Setup Guides a way is listed in.
export type CompatibleIngestSignal =
  | "logs"
  | "metrics"
  | "traces"
  | "exceptions";

// Where a Sentry SDK runs: a browser app gets a Browser key, as its DSN is public.
export enum SentryRuntime {
  Server = "server",
  Browser = "browser",
}

export interface CompatibleIngestEndpoint {
  // "https" or "http", as the install is served.
  protocol: string;
  // The install's host, with its port when it has one: "oneuptime.com".
  host: string;
  // The ingestion key, or the placeholder until one is picked.
  key: string;
}

export interface CompatibleIngestSnippet {
  // A tool's name (not translated), or a translationKey.
  label: string;
  language: string;
  code: string;
}

export interface CompatibleIngestGuideCopy {
  method: CompatibleIngestMethod;
  // The tool's own name, the same in every language.
  label: string;
  logo: ProviderLogo;
  description: string;
  signals: Array<CompatibleIngestSignal>;
  // What the key step shows the URL as: "Remote write URL".
  endpointLabel: string;
  configureDescription: string;
  // What the data becomes, one sentence each.
  notes: Array<string>;
  dataTestId: string;
}

export const COMPATIBLE_INGEST_HEADING: string = translationKey(
  "Already using another tool?",
);

export const COMPATIBLE_INGEST_DESCRIPTION: string = translationKey(
  "Keep the agent or SDK you run today. Point it at OneUptime and nothing else changes.",
);

export const COMPATIBLE_INGEST_CONFIGURE_TITLE: string = translationKey(
  "Point it at OneUptime",
);

export const COMPATIBLE_INGEST_NOTES_TITLE: string = translationKey(
  "What you will see in OneUptime",
);

export const COMPATIBLE_INGEST_NOTES_DESCRIPTION: string = translationKey(
  "Data appears within a minute of the first send.",
);

export const SENTRY_RUNTIME_CAPTION: string = translationKey(
  "Where does your app run?",
);

export const SENTRY_RUNTIME_LABELS: Record<SentryRuntime, string> = {
  [SentryRuntime.Server]: translationKey("On a server"),
  [SentryRuntime.Browser]: translationKey("In the browser"),
};

export const COMPATIBLE_INGEST_GUIDES: Array<CompatibleIngestGuideCopy> = [
  {
    method: CompatibleIngestMethod.Prometheus,
    label: "Prometheus",
    logo: ProviderLogo.Prometheus,
    description: translationKey(
      "Prometheus, Grafana Alloy or any agent that speaks remote write.",
    ),
    signals: ["metrics"],
    endpointLabel: translationKey("Remote write URL"),
    configureDescription: translationKey(
      "Add OneUptime as a remote write target. Your scrape configuration stays as it is.",
    ),
    notes: [
      translationKey(
        "Each job becomes a service, and every series keeps its name and labels.",
      ),
      translationKey(
        "Counters, histograms and summaries keep their types, so their rates chart correctly.",
      ),
    ],
    dataTestId: "compatible-ingest-prometheus",
  },
  {
    method: CompatibleIngestMethod.Loki,
    label: "Loki",
    logo: ProviderLogo.Grafana,
    description: translationKey(
      "Promtail, Grafana Alloy, Fluent Bit or Vector, through Loki's push API.",
    ),
    signals: ["logs"],
    endpointLabel: translationKey("Push URL"),
    configureDescription: translationKey(
      "Add OneUptime as a Loki client. Your pipelines and labels stay as they are.",
    ),
    notes: [
      translationKey(
        "The service comes from the service_name, app, container or job label, as Loki finds it.",
      ),
      translationKey(
        "Labels and structured metadata become attributes, and levels are read from a level label or the line itself.",
      ),
    ],
    dataTestId: "compatible-ingest-loki",
  },
  {
    method: CompatibleIngestMethod.SplunkHec,
    label: "Splunk HEC",
    logo: ProviderLogo.Splunk,
    description: translationKey(
      "Splunk's Docker logging driver or any HTTP Event Collector client.",
    ),
    signals: ["logs", "metrics"],
    endpointLabel: translationKey("HTTP Event Collector URL"),
    configureDescription: translationKey(
      "Use OneUptime as the HTTP Event Collector, with the ingestion key as the HEC token.",
    ),
    notes: [
      translationKey(
        "Every log keeps its host, source, sourcetype and index, and its fields become attributes.",
      ),
      translationKey(
        "Metric events are stored as metrics. Set service.name in an event's fields to name its service.",
      ),
    ],
    dataTestId: "compatible-ingest-splunk-hec",
  },
  {
    method: CompatibleIngestMethod.Datadog,
    label: "Datadog Agent",
    logo: ProviderLogo.Datadog,
    description: translationKey(
      "The Datadog Agent you already run: its metrics and logs.",
    ),
    signals: ["logs", "metrics"],
    endpointLabel: translationKey("Datadog URL"),
    configureDescription: translationKey(
      "Point the Agent's metrics and logs at OneUptime, with the ingestion key as its API key.",
    ),
    notes: [
      translationKey(
        "Tags become attributes, and the service, env and version tags name the service.",
      ),
      translationKey(
        "Metrics, distributions, service checks and logs are kept. Turn off APM and process collection, which OneUptime does not read from the Agent yet.",
      ),
    ],
    dataTestId: "compatible-ingest-datadog",
  },
  {
    method: CompatibleIngestMethod.Sentry,
    label: "Sentry SDK",
    logo: ProviderLogo.Sentry,
    description: translationKey("Keep your Sentry SDK and change its DSN."),
    signals: ["exceptions", "traces"],
    endpointLabel: translationKey("DSN"),
    configureDescription: translationKey(
      "Replace the DSN where you set up Sentry. The rest of your Sentry code stays as it is.",
    ),
    notes: [
      translationKey(
        "Errors appear in Exceptions with their stack traces, transactions in Traces and Sentry logs in Logs.",
      ),
      translationKey(
        "The release's name before the @ names the service: my-service@1.4.2 is my-service.",
      ),
    ],
    dataTestId: "compatible-ingest-sentry",
  },
];

// The ways listed in one product's Setup Guide.
export function getCompatibleIngestGuides(
  signal: string,
): Array<CompatibleIngestGuideCopy> {
  return COMPATIBLE_INGEST_GUIDES.filter(
    (guide: CompatibleIngestGuideCopy): boolean => {
      return (guide.signals as Array<string>).includes(signal);
    },
  );
}

export function isCompatibleIngestMethod(
  method: string,
): method is CompatibleIngestMethod {
  return (Object.values(CompatibleIngestMethod) as Array<string>).includes(
    method,
  );
}

export function getCompatibleIngestGuide(
  method: CompatibleIngestMethod,
): CompatibleIngestGuideCopy {
  return COMPATIBLE_INGEST_GUIDES.find(
    (guide: CompatibleIngestGuideCopy): boolean => {
      return guide.method === method;
    },
  )!;
}

/*
 * A key as Sentry's DSN and Datadog's API key need it: 32 hex digits, no
 * hyphens (the compatible endpoints put them back). A placeholder is left
 * as it is.
 */
const UUID_KEY: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getUndashedKey(key: string): string {
  return UUID_KEY.test(key) ? key.replace(/-/g, "").toLowerCase() : key;
}

const HOST_WITH_PORT: RegExp = /^(.*):(\d+)$/;
const BRACKETED_IPV6: RegExp = /^\[.*\]$/;

// The host without its port, and the port: what Fluent Bit and Datadog take.
export function getHostAndPort(endpoint: CompatibleIngestEndpoint): {
  hostname: string;
  port: string;
} {
  const match: RegExpMatchArray | null = endpoint.host.match(HOST_WITH_PORT);

  // A port after a name or an IPv4 address, or after a bracketed IPv6 one.
  if (match && (!match[1]!.includes(":") || BRACKETED_IPV6.test(match[1]!))) {
    return { hostname: match[1]!, port: match[2]! };
  }

  return {
    hostname: endpoint.host,
    port: endpoint.protocol === "http" ? "80" : "443",
  };
}

/*
 * The host and the port as a Fluent Bit output writes them, as two settings:
 * the address itself, and the port. Fluent Bit resolves Host as it is
 * written, so a bracketed IPv6 host ("[::1]") fails as "Misformatted domain
 * name" and sends nothing, where "::1" connects (#7753).
 *
 * Every Fluent Bit file the guides hand out takes them from here: the Loki
 * output below, the logs guide's (LogShipperSnippets) and the Security
 * Events guide's (#7889).
 */
export function getFluentBitHostAndPort(endpoint: CompatibleIngestEndpoint): {
  host: string;
  port: string;
} {
  const { hostname, port } = getHostAndPort(endpoint);

  return { host: HostAddressUtil.stripBrackets(hostname), port };
}

function getOrigin(endpoint: CompatibleIngestEndpoint): string {
  return `${endpoint.protocol}://${endpoint.host}`;
}

// The URL the key step shows: what the tool is pointed at.
export function getCompatibleIngestEndpointValue(
  method: CompatibleIngestMethod,
  endpoint: CompatibleIngestEndpoint,
): string {
  const origin: string = getOrigin(endpoint);

  switch (method) {
    case CompatibleIngestMethod.Prometheus:
      return `${origin}${COMPATIBLE_INGEST_URL_PREFIX}${PROMETHEUS_REMOTE_WRITE_PATH}`;
    case CompatibleIngestMethod.Loki:
      return `${origin}${COMPATIBLE_INGEST_URL_PREFIX}${LOKI_PUSH_PATH}`;
    case CompatibleIngestMethod.SplunkHec:
      return `${origin}${COMPATIBLE_INGEST_URL_PREFIX}${SPLUNK_HEC_BASE_PATH}`;
    case CompatibleIngestMethod.Datadog:
      return `${origin}${COMPATIBLE_INGEST_URL_PREFIX}${DATADOG_BASE_PATH}`;
    case CompatibleIngestMethod.Sentry:
      return getSentryDsn(endpoint);
    default:
      return origin;
  }
}

/*
 * The DSN: https://<key>@<host>/telemetry/sentry/1. SDKs post to
 * <host>/telemetry/sentry/api/1/envelope/ and send the key with it.
 */
export function getSentryDsn(endpoint: CompatibleIngestEndpoint): string {
  return `${endpoint.protocol}://${getUndashedKey(endpoint.key)}@${endpoint.host}${COMPATIBLE_INGEST_URL_PREFIX}${SENTRY_BASE_PATH}/${SENTRY_DSN_PROJECT_NUMBER}`;
}

export function getCompatibleIngestSnippets(
  method: CompatibleIngestMethod,
  endpoint: CompatibleIngestEndpoint,
  options?: { sentryRuntime?: SentryRuntime | undefined },
): Array<CompatibleIngestSnippet> {
  const url: string = getCompatibleIngestEndpointValue(method, endpoint);
  const { hostname, port } = getHostAndPort(endpoint);
  const fluentBit: { host: string; port: string } =
    getFluentBitHostAndPort(endpoint);
  const isTls: boolean = endpoint.protocol !== "http";

  switch (method) {
    case CompatibleIngestMethod.Prometheus:
      return [
        {
          label: "Prometheus",
          language: "yaml",
          code: `# prometheus.yml
remote_write:
  - url: ${url}
    authorization:
      credentials: ${endpoint.key}`,
        },
        {
          label: "Grafana Alloy",
          language: "nginx",
          code: `prometheus.remote_write "oneuptime" {
  endpoint {
    url          = "${url}"
    bearer_token = "${endpoint.key}"
  }
}`,
        },
      ];
    case CompatibleIngestMethod.Loki:
      return [
        {
          label: "Promtail",
          language: "yaml",
          code: `# promtail.yaml
clients:
  - url: ${url}
    bearer_token: ${endpoint.key}`,
        },
        {
          label: "Grafana Alloy",
          language: "nginx",
          code: `loki.write "oneuptime" {
  endpoint {
    url          = "${url}"
    bearer_token = "${endpoint.key}"
  }
}`,
        },
        {
          label: "Fluent Bit",
          language: "nginx",
          code: `[OUTPUT]
    Name         loki
    Match        *
    Host         ${fluentBit.host}
    Port         ${fluentBit.port}
    Tls          ${isTls ? "On" : "Off"}
    Uri          ${COMPATIBLE_INGEST_URL_PREFIX}${LOKI_PUSH_PATH}
    Http_User    oneuptime
    Http_Passwd  ${endpoint.key}
    Labels       job=fluent-bit, service_name=my-service`,
        },
      ];
    case CompatibleIngestMethod.SplunkHec:
      return [
        {
          label: "Docker",
          language: "bash",
          code: `docker run \\
  --log-driver=splunk \\
  --log-opt splunk-url=${getOrigin(endpoint)} \\
  --log-opt splunk-token=${endpoint.key} \\
  --log-opt splunk-format=json \\
  --log-opt tag=my-service \\
  your-image`,
        },
        {
          label: "OpenTelemetry Collector",
          language: "yaml",
          code: `exporters:
  splunk_hec:
    token: ${endpoint.key}
    endpoint: ${url}`,
        },
        {
          label: "curl",
          language: "bash",
          code: `curl ${url}/event \\
  -H "Authorization: Splunk ${endpoint.key}" \\
  -d '{"event": "Hello from the HTTP Event Collector", "sourcetype": "manual", "fields": {"service": "my-service"}}'`,
        },
      ];
    case CompatibleIngestMethod.Datadog:
      return [
        {
          label: "datadog.yaml",
          language: "yaml",
          code: `# datadog.yaml
api_key: ${getUndashedKey(endpoint.key)}
dd_url: ${url}
logs_enabled: true
logs_config:
  use_http: true
  logs_dd_url: ${hostname}:${port}${isTls ? "" : "\n  logs_no_ssl: true"}
# Not read from the Agent yet: leave them off.
apm_config:
  enabled: false
process_config:
  process_collection:
    enabled: false`,
        },
        {
          label: translationKey("Environment variables"),
          language: "bash",
          code: `DD_API_KEY=${getUndashedKey(endpoint.key)}
DD_DD_URL=${url}
DD_LOGS_ENABLED=true
DD_LOGS_CONFIG_USE_HTTP=true
DD_LOGS_CONFIG_LOGS_DD_URL=${hostname}:${port}${isTls ? "" : "\nDD_LOGS_CONFIG_LOGS_NO_SSL=true"}
DD_APM_ENABLED=false
DD_PROCESS_CONFIG_PROCESS_COLLECTION_ENABLED=false`,
        },
      ];
    case CompatibleIngestMethod.Sentry: {
      const dsn: string = getSentryDsn(endpoint);

      if (options?.sentryRuntime === SentryRuntime.Browser) {
        return [
          {
            label: "JavaScript",
            language: "javascript",
            code: `import * as Sentry from "@sentry/browser"; // or @sentry/react, @sentry/vue, ...

Sentry.init({
  dsn: "${dsn}",
  release: "my-service@1.0.0",
  environment: "production",
});`,
          },
        ];
      }

      return [
        {
          label: "Node.js",
          language: "javascript",
          code: `const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "${dsn}",
  release: "my-service@1.0.0",
  environment: "production",
});`,
        },
        {
          label: "Python",
          language: "python",
          code: `import sentry_sdk

sentry_sdk.init(
    dsn="${dsn}",
    release="my-service@1.0.0",
    environment="production",
)`,
        },
        {
          label: translationKey("Environment variables"),
          language: "bash",
          code: `SENTRY_DSN=${dsn}
SENTRY_RELEASE=my-service@1.0.0`,
        },
      ];
    }
    default:
      return [];
  }
}
