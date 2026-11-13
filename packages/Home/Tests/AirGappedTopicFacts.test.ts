import { plainText } from "../Utils/AirGapped";
import {
  AirGappedTopicCapability,
  AirGappedTopicChange,
  AirGappedTopicConfigureStep,
  AirGappedTopicFaq,
  AirGappedTopicPage,
  AirGappedTopicPages,
  AirGappedTopicSlug,
  getAirGappedTopicPage,
} from "../Utils/AirGappedPages";
import { Claim, getClaim } from "../Utils/Claims";
import LlmType from "Common/Types/LLM/LlmType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  CALL_AND_SMS_PROVIDERS,
  CallAndSmsProvider,
} from "Common/Types/CallAndSMS/CallAndSmsProvider";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY SENTENCE OF THE AIR-GAPPED PRODUCT PAGES, HELD TO THE FILE THAT MAKES
 * IT TRUE.
 *
 * Each page of /enterprise/air-gapped/<product> (Utils/AirGappedPages.ts) tells
 * a buyer whose network never reaches the internet what works there, what
 * changes and what still needs a route out. Each statement rests on a docs
 * page, a chart value or a line of product code, and EVIDENCE below pairs the
 * words on the page with the words in that file. When a fact moves, the entry
 * that pins it fails, naming the file and the words it no longer has, and the
 * sentence to change with it.
 *
 * Every capability, change, step, caption, answer, proof point and lead must
 * have an entry: the first test below fails on one that has none, so a page
 * cannot state something without saying what backs it. Files are read as text,
 * as in Tests/AirGappedFacts.test.ts: this job installs only Home's and
 * Common's dependencies.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

const fileCache: Map<string, string> = new Map<string, string>();

function repoFile(relativePath: string): string {
  if (!fileCache.has(relativePath)) {
    fileCache.set(
      relativePath,
      fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"),
    );
  }

  return fileCache.get(relativePath)!;
}

function docs(page: string): string {
  return `packages/App/FeatureSet/Docs/Content/en/${page}.md`;
}

// Words of the page, the file that backs them, and the words that file has.
interface Evidence {
  claim: string;
  file: string;
  says: string;
}

function fact(claim: string, file: string, says: string): Evidence {
  return { claim, file, says };
}

const CHART_VALUES: string = "HelmChart/Public/oneuptime/values.yaml";
const CHART_CONFIGURATION: string =
  "HelmChart/Public/oneuptime/docs/configuration.md";
const AGENT_VALUES: string = "HelmChart/Public/kubernetes-agent/values.yaml";
const AGENT_README: string = "HelmChart/Public/kubernetes-agent/README.md";
const AGENT_AIR_GAPPED_VALUES: string =
  "HelmChart/Tests/kubernetes-agent-air-gapped-values.yaml";
const AGENT_CHART_TEMPLATES: string =
  "HelmChart/Public/kubernetes-agent/templates";
const PROBE_DOCKERFILE: string = "packages/Probe/Dockerfile.tpl";

const AGENT_INSTALL: string = docs("monitor/kubernetes-agent");
const AI_AGENT: string = docs("ai/ai-agent");
const AI_SRE: string = docs("ai/ai-sre");
const ARCHITECTURE: string = docs("self-hosted/architecture");
const ASK_AI: string = docs("ai/ask-ai");
const BRANDING: string = docs("status-pages/branding-and-domains");
const CALENDAR_FEEDS: string = docs("on-call/calendar-feeds");
const CEPH: string = docs("telemetry/ceph");
const OPENSTACK: string = docs("telemetry/openstack");
const OPENSTACK_AGENTLESS: string = docs("telemetry/openstack-agentless");
const COMPOSE: string = docs("installation/docker-compose");
const CUSTOM_CHANNELS: string = docs(
  "self-hosted/custom-notification-channels",
);
const CUSTOM_PROBE: string = docs("probe/custom-probe");
const DATA_RETENTION: string = docs("telemetry/data-retention");
const DATA_SOURCES: string = docs("dashboards/data-sources");
const DECLARING: string = docs("incidents/declaring-incidents");
const DNS_MONITOR: string = docs("monitor/dns-monitor");
const DOCKER_MONITOR: string = docs("monitor/docker-monitor");
const DROP_FILTERS: string = docs("telemetry/drop-filters-and-scrub-rules");
const ENTERPRISE: string = docs("self-hosted/enterprise");
const EPISODES: string = docs("incidents/episodes");
const EXTERNAL_MCP: string = docs("ai/external-mcp-servers");
const FIREWALL: string = docs("self-hosted/behind-a-firewall");
const FLUENT_BIT: string = docs("telemetry/fluentbit");
const FLUENTD: string = docs("telemetry/fluentd");
const GATEWAY: string = docs("self-hosted/sms-and-call-gateway");
const GITHUB_INTEGRATION: string = docs("self-hosted/github-integration");
const HOSTS: string = docs("telemetry/hosts");
const INCIDENTS: string = docs("incidents/index");
const INCOMING_CALLS: string = docs("on-call/incoming-call-policy");
const INCOMING_EMAIL: string = docs("monitor/incoming-email-monitor");
const INCOMING_INGRESS: string = docs("probe/incoming-request-ingress");
const IRC: string = docs("integrations/irc");
const JIRA: string = docs("integrations/jira");
const KUBERNETES_COST: string = docs("telemetry/kubernetes-cost");
const KUBERNETES_MONITOR: string = docs("monitor/kubernetes-monitor");
const LLM_PROVIDERS: string = docs("ai/llm-provider");
const LOG_PIPELINES: string = docs("telemetry/log-pipelines");
const LOG_RECORDING: string = docs("telemetry/log-recording-rules");
const LOGS_EXPLORER: string = docs("telemetry/logs-explorer");
const LOGS_MONITOR: string = docs("monitor/logs-monitor");
const MCP_SERVER: string = docs("ai/mcp-server");
const METRICS_EXPLORER: string = docs("telemetry/metrics-explorer");
const MOBILE_FAQ: string = docs("mobile-desktop-apps/faq-troubleshooting");
const NETWORK_DEVICE: string = docs("monitor/network-device-monitor");
const NETWORK_EVENTS: string = docs("monitor/network-events");
const NETWORK_SITES: string = docs("monitor/network-sites");
const NETWORK_TRAFFIC: string = docs("monitor/network-traffic");
const NOTES: string = docs("incidents/notes-owners-and-feed");
const ON_CALL: string = docs("on-call/index");
const OPENTELEMETRY: string = docs("telemetry/open-telemetry");
const PACKET_CAPTURE: string = docs("probe/packet-capture");
const POSTMORTEMS: string = docs("incidents/postmortems");
const PRIVATE_NETWORK: string = docs("self-hosted/private-network-access");
const PROFILES: string = docs("telemetry/profiles");
const PROXMOX: string = docs("telemetry/proxmox");
const PUSH: string = docs("self-hosted/push-notifications");
const RUM: string = docs("rum/index");
const RUNBOOK_AGENTS: string = docs("runbooks/agents");
const RUNBOOK_AUTHORING: string = docs("runbooks/authoring");
const SCHEDULES: string = docs("on-call/schedules");
const SECURITY_CASES: string = docs("telemetry/security-cases");
const SECURITY_EVENTS: string = docs("telemetry/security-events");
const SECURITY_START: string = docs("telemetry/security-getting-started");
const SENDGRID: string = docs("self-hosted/sendgrid-inbound-email");
const SERVER_MONITOR: string = docs("monitor/server-monitor");
const SESSION_REPLAY: string = docs("telemetry/session-replay");
const SIZING: string = docs("installation/sizing");
const SLACK: string = docs("self-hosted/slack-integration");
const SMTP: string = docs("emails/smtp");
const STATUS_PAGES: string = docs("status-pages/index");
const STORAGE_ARRAYS: string = docs("telemetry/storage-arrays");
const SUBSCRIBERS: string = docs("status-pages/subscribers");
const SYSLOG: string = docs("telemetry/syslog");
const TEAMS: string = docs("self-hosted/microsoft-teams-integration");
const THREAT_INTEL: string = docs("telemetry/threat-intelligence");
const TRACES_EXPLORER: string = docs("telemetry/traces-explorer");
const VIDEO_CALLS: string = docs("workspace-connections/video-calls");
const VMWARE: string = docs("telemetry/vmware-agentless");
const WORKFLOW_COMPONENTS: string = docs("workflows/components");
const WORKFLOW_TRIGGERS: string = docs("workflows/triggers");
const WORKFLOWS: string = docs("workflows/index");

const INGESTION_KEYS: Evidence = fact(
  "Project Settings > Telemetry & APM > Ingestion Keys",
  OPENTELEMETRY,
  "**Project Settings → Telemetry & APM → Ingestion Keys**",
);

const SYSLOG_ON_A_PROBE: string =
  "Every probe listens for syslog on port 5140, over UDP and over TCP.";

const EVERY_EDITION_ROW: string =
  "| Monitoring, alerts, incidents, on-call, status pages, logs, metrics, traces, exceptions, dashboards, workflows, AI features, API and Terraform | Yes | Yes | Every plan |";

const SHOW_ID_AND_KEY: Evidence = fact(
  "Show ID and Key",
  CUSTOM_PROBE,
  "open the probe's menu in the **Custom Probes** table and pick **Show ID and Key**",
);

const COMES_WITH_THE_INSTALL: (claim: string) => Evidence = (
  claim: string,
): Evidence => {
  return fact(claim, ENTERPRISE, EVERY_EDITION_ROW);
};

/*
 * Keyed <page>/<part>/<which>, where the part is lead, flow, install, caption,
 * proof, capability, change, step or faq.
 */
const EVIDENCE: Record<string, Array<Evidence>> = {
  // ---------------------------------------------------------- OBSERVABILITY
  "observability/lead": [
    fact(
      "to your own install",
      OPENTELEMETRY,
      "Use your OneUptime URL wherever this page says `https://oneuptime.com`:",
    ),
    fact(
      "every log, metric, trace, exception and profile in ClickHouse",
      ARCHITECTURE,
      "Logs, metrics, traces, exceptions, profiles and monitor logs.",
    ),
  ],
  "observability/flow": [
    fact(
      "OpenTelemetry Collector, Fluent Bit, Fluentd",
      ARCHITECTURE,
      'Senders["Telemetry senders:<br/>OpenTelemetry,<br/>Fluent Bit,<br/>syslog, agents"]',
    ),
    fact("Syslog through a probe", NETWORK_EVENTS, SYSLOG_ON_A_PROBE),
    fact(
      "Your telemetry beside your own data sources",
      DATA_SOURCES,
      "so your dashboards can chart its data beside your own",
    ),
  ],
  "observability/install": [
    COMES_WITH_THE_INSTALL("Observability comes with the install"),
  ],
  "observability/proof/0": [
    fact(
      "OpenTelemetry to your own URL",
      OPENTELEMETRY,
      "Use your OneUptime URL wherever this page says `https://oneuptime.com`:",
    ),
  ],
  "observability/proof/1": [
    fact(
      "Stored in your own ClickHouse",
      ARCHITECTURE,
      "keeps telemetry in ClickHouse",
    ),
  ],
  "observability/proof/2": [
    fact(
      "No object store to run",
      SIZING,
      "OneUptime does **not** archive or move old telemetry to object storage.",
    ),
  ],
  "observability/proof/3": [
    fact(
      "Recorder served by your install",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayInstallSnippet.tsx",
      "This deployment's public origin, from the Dashboard's own config.",
    ),
  ],
  "observability/capability/logs": [
    fact(
      "Search the logs your services, hosts and agents send",
      LOGS_EXPLORER,
      "search and read the logs your services, hosts and agents send to OneUptime",
    ),
    fact(
      "before they are stored",
      LOG_PIPELINES,
      "Log pipelines transform logs as OneUptime ingests them, before they are stored.",
    ),
  ],
  "observability/capability/metrics": [
    fact(
      "change them as they arrive, before they are stored",
      METRICS_EXPLORER,
      "changes metrics as they arrive, before they are stored",
    ),
  ],
  "observability/capability/traces": [
    fact(
      "every step of the request as a waterfall, a flame graph or a service map",
      TRACES_EXPLORER,
      "open a trace to see every step of the request as a waterfall, a flame graph or a service map",
    ),
  ],
  "observability/capability/exceptions-and-profiles": [
    fact(
      "Errors from traces and logs roll into one Exceptions view",
      OPENTELEMETRY,
      "OneUptime finds exceptions inside your **logs** and rolls them into the same **Exceptions** view that trace errors feed.",
    ),
    fact(
      "how your application spends CPU time and memory, function by function",
      PROFILES,
      "Continuous profiling shows how your application spends CPU time and memory, function by function.",
    ),
  ],
  "observability/capability/dashboards": [
    fact(
      "Prometheus, a SQL database, Loki or Elasticsearch",
      DATA_SOURCES,
      "such as Prometheus, a SQL database, ClickHouse, Loki, Elasticsearch or a REST API",
    ),
    fact(
      "on your network",
      DATA_SOURCES,
      "allowed on a self-hosted installation unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`",
    ),
    fact(
      "Each widget runs a read-only query",
      DATA_SOURCES,
      "each widget then runs a read-only query in that system's own language",
    ),
  ],
  "observability/capability/rum": [
    fact(
      "Point an OpenTelemetry browser or mobile SDK at your install",
      RUM,
      "you point an OpenTelemetry browser or mobile SDK at OneUptime",
    ),
    fact(
      "recordings stay in ClickHouse",
      SESSION_REPLAY,
      "Recordings are stored in ClickHouse. No object storage is required.",
    ),
  ],
  "observability/change/otlp-grpc": [
    fact(
      "An ingress that ends TLS itself",
      COMPOSE,
      "OTLP over gRPC reaches OneUptime only when its own ingress ends TLS (`PROVISION_SSL=true`).",
    ),
    fact(
      "with a certificate from Let's Encrypt",
      "config.example.env",
      "This requires port 80/443 to be reachable for Let's Encrypt validation",
    ),
    fact(
      "Send over OTLP/HTTP to /otlp. It works behind your own proxy",
      COMPOSE,
      "Behind your own proxy, send telemetry over OTLP/HTTP (`/otlp`).",
    ),
  ],
  "observability/change/build-time": [
    fact(
      "npm, GitHub and Docker Hub",
      OPENTELEMETRY,
      "curl -L -O https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar",
    ),
    fact(
      "OneUptime does not ship these",
      OPENTELEMETRY,
      "otel/opentelemetry-collector-contrib:latest",
    ),
  ],
  "observability/change/replay-assets": [
    fact(
      "Playback loads them from their original addresses, in the viewer's browser",
      SESSION_REPLAY,
      "**Playback loads those files from their original addresses, in your browser, while you watch.**",
    ),
    fact(
      "Stylesheets the recorder can read are kept in the recording",
      SESSION_REPLAY,
      "A stylesheet the recorder can read is copied into the recording in full",
    ),
  ],
  "observability/change/cloud-accounts": [
    fact(
      "Your AWS, Azure and Google Cloud accounts",
      docs("telemetry/cloud-accounts"),
      "Connect an AWS account, an Azure subscription or a Google Cloud project from the dashboard",
    ),
  ],
  "observability/step/ingestion-key": [INGESTION_KEYS],
  "observability/step/endpoint": [
    fact(
      "your install's /otlp address",
      OPENTELEMETRY,
      "`OTEL_EXPORTER_OTLP_ENDPOINT` is `https://YOUR-ONEUPTIME-HOST/otlp`",
    ),
    fact(
      "x-oneuptime-token header",
      OPENTELEMETRY,
      "`x-oneuptime-token=YOUR_ONEUPTIME_INGESTION_KEY`",
    ),
  ],
  "observability/step/protocol": [
    fact(
      "http/protobuf",
      OPENTELEMETRY,
      "| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | OTLP over HTTP.",
    ),
  ],
  "observability/caption": [
    fact(
      "accepts requests of up to 4 MB on /otlp",
      OPENTELEMETRY,
      "The bundled ingress accepts requests of up to 4 MB on `/otlp`.",
    ),
    fact(
      "may have a lower limit",
      OPENTELEMETRY,
      "A proxy you run in front of OneUptime may have a lower limit",
    ),
  ],
  "observability/faq/0": [
    fact(
      "No monitoring data, telemetry, logs or configuration leave the install.",
      ENTERPRISE,
      "No monitoring data, telemetry, logs or configuration leave the install.",
    ),
  ],
  "observability/faq/1": [
    fact(
      "gRPC reaches OneUptime only over HTTPS",
      OPENTELEMETRY,
      "On a self-hosted installation, gRPC reaches OneUptime only over HTTPS: a plain-HTTP (h2c) connection is refused.",
    ),
    fact(
      "only when its own ingress ends TLS",
      COMPOSE,
      "only when its own ingress ends TLS",
    ),
    fact(
      "and over plain HTTP",
      OPENTELEMETRY,
      "or `http://YOUR-ONEUPTIME-HOST/otlp` if you serve OneUptime over plain HTTP.",
    ),
  ],
  "observability/faq/2": [
    fact(
      "OneUptime does not archive or move old telemetry to object storage",
      SIZING,
      "OneUptime does **not** archive or move old telemetry to object storage.",
    ),
    fact(
      "Decide your retention first, and size ClickHouse storage to match",
      SIZING,
      "decide it before you size disk",
    ),
  ],
  "observability/faq/3": [
    fact(
      "15 days unless you change it",
      DATA_RETENTION,
      "15 days unless you change it",
    ),
    fact(
      "default retention is in every edition",
      DATA_RETENTION,
      "The project's default retention is in every edition and plan.",
    ),
    fact(
      "needs an Enterprise license",
      DATA_RETENTION,
      "A self-hosted installation needs an Enterprise license",
    ),
  ],

  // --------------------------------------------------------- LOG MANAGEMENT
  "log-management/lead": [
    fact(
      "shape and scrub them as they arrive",
      DROP_FILTERS,
      "Drop filters and scrub rules act on your logs and spans as they arrive, before anything is stored.",
    ),
  ],
  "log-management/flow": [
    fact("Over OTLP/HTTP", FLUENT_BIT, 'logs_uri: "/otlp/v1/logs"'),
    fact(
      "To its own endpoint",
      FLUENTD,
      'fluentd -->|"HTTP output, JSON + ingestion key"| ingest["OneUptime /fluentd/logs"]',
    ),
    fact(
      "To a probe, or over HTTPS",
      SYSLOG,
      "OneUptime accepts syslog over HTTPS.",
    ),
    fact(
      "Security events from your logs",
      SECURITY_START,
      "OneUptime reads the project's new logs every minute and turns the lines it recognizes into security events",
    ),
  ],
  "log-management/install": [
    COMES_WITH_THE_INSTALL("Log management comes with the install"),
  ],
  "log-management/proof/0": [
    fact(
      "Fluent Bit, Fluentd and syslog",
      ARCHITECTURE,
      'Senders["Telemetry senders:<br/>OpenTelemetry,<br/>Fluent Bit,<br/>syslog, agents"]',
    ),
  ],
  "log-management/proof/1": [
    fact(
      "Pipelines before storage",
      LOG_PIPELINES,
      "Log pipelines transform logs as OneUptime ingests them, before they are stored.",
    ),
  ],
  "log-management/proof/2": [
    fact(
      "Secrets masked as logs arrive",
      DROP_FILTERS,
      "A scrub rule masks personal data and secrets",
    ),
  ],
  "log-management/proof/3": [
    fact(
      "Kept in your own ClickHouse",
      ARCHITECTURE,
      "keeps telemetry in ClickHouse",
    ),
  ],
  "log-management/capability/shippers": [
    fact(
      "Fluent Bit sends over OTLP/HTTP",
      FLUENT_BIT,
      'logs_uri: "/otlp/v1/logs"',
    ),
    fact(
      "Fluentd posts to /fluentd/logs",
      FLUENTD,
      "endpoint https://oneuptime.com/fluentd/logs",
    ),
  ],
  "log-management/capability/syslog": [
    fact(
      "RFC 5424 and RFC 3164 messages over HTTPS",
      SYSLOG,
      "Post RFC 5424 or RFC 3164 messages to `/syslog/v1/logs` with your ingestion key",
    ),
    fact(
      "every probe listens for syslog on port 5140, over UDP and over TCP",
      NETWORK_EVENTS,
      SYSLOG_ON_A_PROBE,
    ),
  ],
  "log-management/capability/pipelines": [
    fact(
      "Transform logs as they arrive, before they are stored",
      LOG_PIPELINES,
      "Log pipelines transform logs as OneUptime ingests them, before they are stored.",
    ),
    fact(
      "key=value pairs",
      LOG_PIPELINES,
      "| Key=Value Parser   | Splits a line of `key=value` pairs",
    ),
  ],
  "log-management/capability/scrub": [
    fact(
      "Throw away the records you never need",
      DROP_FILTERS,
      "A drop filter throws away the records you never need",
    ),
    fact(
      "mask personal data and secrets",
      DROP_FILTERS,
      "A scrub rule masks personal data and secrets",
    ),
    fact(
      "before anything is stored",
      DROP_FILTERS,
      "as they arrive, before anything is stored.",
    ),
  ],
  "log-management/capability/search": [
    fact(
      "Narrow millions of lines down to the few that matter",
      LOGS_EXPLORER,
      "Narrow millions of lines down to the few that matter, follow new ones as they arrive, chart them, and save the views your team comes back to.",
    ),
  ],
  "log-management/capability/alerts": [
    fact(
      "A Logs monitor counts matching logs and can create an alert or declare an incident",
      LOGS_MONITOR,
      "creates an alert or declares an incident when the count meets your criteria",
    ),
    fact(
      "A recording rule turns logs into a metric",
      LOG_RECORDING,
      "A **Log Recording Rule** turns logs into a metric.",
    ),
  ],
  "log-management/change/syslog-senders": [
    fact(
      "The chart's global probe",
      PACKET_CAPTURE,
      "The probes that come with a self-hosted OneUptime install, through Docker Compose or the Helm chart, are global probes",
    ),
    fact(
      "which drops what it cannot match to a device",
      NETWORK_EVENTS,
      "A global probe drops it.",
    ),
    fact(
      "It keeps those messages until you say which device they belong to",
      NETWORK_EVENTS,
      "until you say which device it belongs to",
    ),
  ],
  "log-management/change/syslog-tls": [
    fact(
      "The probe takes plain UDP and TCP",
      NETWORK_EVENTS,
      "The probe takes plain UDP and TCP; keep the path between the devices and the probe on a network you trust.",
    ),
    fact(
      "an rsyslog relay that forwards over HTTPS",
      SYSLOG,
      "Point them at an rsyslog relay, and let the relay forward over HTTPS.",
    ),
  ],
  "log-management/change/shipper-images": [
    fact(
      "OneUptime does not ship these",
      FLUENT_BIT,
      "Replace the `http` input with the inputs you need",
    ),
    fact(
      "set their output to your install",
      FLUENT_BIT,
      "## Self-hosted OneUptime",
    ),
  ],
  "log-management/step/ingestion-key": [INGESTION_KEYS],
  "log-management/step/host": [
    fact(
      "Set host to the host of your OneUptime install",
      FLUENT_BIT,
      "Set `host` to the host of your OneUptime instance.",
    ),
  ],
  "log-management/step/header": [
    fact(
      "x-oneuptime-token",
      FLUENT_BIT,
      "- x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN",
    ),
  ],
  "log-management/caption": [
    fact(
      "served over plain HTTP",
      FLUENT_BIT,
      "If it is served over plain HTTP rather than HTTPS, also set `port` to the port it listens on (usually `80`) and remove `tls`:",
    ),
  ],
  "log-management/faq/0": [
    fact("port 5140, over UDP and over TCP", NETWORK_EVENTS, SYSLOG_ON_A_PROBE),
    fact(
      "a global probe drops messages from senders it does not poll",
      NETWORK_EVENTS,
      "A global probe drops it.",
    ),
    fact(
      "keep it on a network you trust",
      NETWORK_EVENTS,
      "keep the path between the devices and the probe on a network you trust",
    ),
  ],
  "log-management/faq/1": [
    fact(
      "email addresses, card numbers and passwords",
      DROP_FILTERS,
      "such as email addresses, card numbers and passwords",
    ),
  ],
  "log-management/faq/2": [
    fact(
      "15 days unless you change it",
      DATA_RETENTION,
      "15 days unless you change it",
    ),
    fact(
      "default retention is in every edition",
      DATA_RETENTION,
      "The project's default retention is in every edition and plan.",
    ),
    fact(
      "extend the window and size ClickHouse storage to match",
      SIZING,
      "extend the retention window and size ClickHouse storage to match",
    ),
  ],

  // ------------------------------------------------------------- MONITORING
  "monitoring/lead": [
    fact(
      "nothing has to reach it from outside",
      CUSTOM_PROBE,
      "Nothing has to reach the probe from outside your network.",
    ),
  ],
  "monitoring/flow": [
    fact(
      "Chromium and Firefox",
      PROBE_DOCKERFILE,
      "npx playwright install --with-deps chromium firefox",
    ),
    fact(
      "Declared when criteria match",
      INCIDENTS,
      "let a monitor declare it the moment its criteria match",
    ),
  ],
  "monitoring/install": [
    fact(
      "the chart runs a probe in your cluster",
      CHART_VALUES,
      "probes:\n  one:\n",
    ),
  ],
  "monitoring/proof/0": [
    fact(
      "Probes anywhere on your network",
      CUSTOM_PROBE,
      "Nothing has to reach the probe from outside your network.",
    ),
  ],
  "monitoring/proof/1": [
    fact(
      "Chromium and Firefox in the probe image",
      PROBE_DOCKERFILE,
      "npx playwright install --with-deps chromium firefox",
    ),
  ],
  "monitoring/proof/2": [
    fact(
      "Private certificate authorities trusted",
      CHART_CONFIGURATION,
      "### Example: trust an internal CA",
    ),
  ],
  "monitoring/proof/3": [COMES_WITH_THE_INSTALL("Monitoring in every edition")],
  "monitoring/capability/web-and-api": [
    fact(
      "check internal sites and services",
      docs("monitor/website-monitor"),
      "The site is only reachable on your network.",
    ),
    fact(
      "once the probe may reach private addresses",
      CUSTOM_PROBE,
      "Probes refuse private addresses until you allow them.",
    ),
  ],
  "monitoring/capability/network-checks": [
    fact(
      "Ping hosts",
      docs("monitor/ping-monitor"),
      "Ping hosts on your own network.",
    ),
    fact(
      "check ports",
      docs("monitor/port-monitor"),
      "Check ports on your own network.",
    ),
    fact(
      "query internal DNS servers",
      DNS_MONITOR,
      "Query internal DNS servers from your own network.",
    ),
    fact(
      "check time servers",
      docs("monitor/ntp-monitor"),
      "Check time servers on your own network.",
    ),
  ],
  "monitoring/capability/certificates": [
    fact(
      "a service on your network",
      docs("monitor/ssl-certificate-monitor"),
      "A service on a private network needs a",
    ),
  ],
  "monitoring/capability/databases": [
    fact(
      "Run checks from inside your network.",
      docs("monitor/sql-monitor"),
      "Run checks from inside your network.",
    ),
    fact(
      "only has to be reachable from the probe",
      docs("monitor/database-health-monitor"),
      "the database only needs to be reachable from the probe.",
    ),
  ],
  "monitoring/capability/synthetic": [
    fact(
      "The browsers ship inside the probe's Docker image",
      docs("monitor/synthetic-monitor"),
      "The browsers ship inside the probe's Docker image,",
    ),
    fact(
      "so a test downloads nothing when it runs",
      PROBE_DOCKERFILE,
      "npx playwright install --with-deps chromium firefox",
    ),
  ],
  "monitoring/capability/heartbeats": [
    fact(
      "segments with no outbound HTTPS access",
      INCOMING_INGRESS,
      "Your services run in an isolated network segment with no outbound HTTPS access",
    ),
  ],
  "monitoring/change/private-addresses": [
    fact(
      "A stock probe refuses private addresses",
      PRIVATE_NETWORK,
      "On a stock probe they can reach public HTTP(S) targets, but refuse private address space.",
    ),
    fact(
      "probes.one.allowPrivateNetworkMonitors: true",
      CHART_VALUES,
      "    allowPrivateNetworkMonitors: false\n",
    ),
    fact(
      "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true",
      CUSTOM_PROBE,
      "`PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`",
    ),
  ],
  "monitoring/change/private-ca": [
    fact(
      "point NODE_EXTRA_CA_CERTS at it",
      CHART_CONFIGURATION,
      "`NODE_EXTRA_CA_CERTS` at a mounted bundle is enough for every outbound TLS call",
    ),
    fact(
      "Chromium reads the OS trust store instead",
      CHART_CONFIGURATION,
      "trust store instead. Synthetic monitors against an internally-signed site need",
    ),
    fact(
      "the certificate baked into the image",
      CHART_CONFIGURATION,
      "the certificate baked into the image's `/usr/local/share/ca-certificates`",
    ),
  ],
  "monitoring/change/dnssec": [
    fact(
      "1.1.1.1, 8.8.8.8 and 9.9.9.9",
      "packages/Common/Types/Monitor/MonitorStepDnssecMonitor.ts",
      "9.9.9.9",
    ),
    fact(
      "List your own validating resolvers on a DNSSEC monitor",
      docs("monitor/dnssec-monitor"),
      "Keep the default **Resolvers**, or list your own, separated by commas.",
    ),
    fact(
      "in DNS Server on a DNS monitor",
      DNS_MONITOR,
      "**DNSSEC Is Valid** asks the server in **DNS Server (Optional)**",
    ),
  ],
  "monitoring/change/external-status-page": [
    fact(
      "The public status page of a service you depend on",
      docs("monitor/external-status-page-monitor"),
      "watches the public status page of a service you depend on",
    ),
    fact(
      "with the same private-address setting",
      docs("monitor/external-status-page-monitor"),
      "Set `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` on a probe inside your network",
    ),
  ],
  "monitoring/change/incoming-email": [
    fact(
      "SendGrid, which has to connect to your install",
      SENDGRID,
      "Inbound Parse requires SendGrid to initiate a connection to OneUptime.",
    ),
    fact(
      "Receive heartbeats and webhooks over HTTP",
      INCOMING_EMAIL,
      "Receive heartbeats and webhooks over HTTP instead.",
    ),
  ],
  "monitoring/change/domain": [
    fact(
      "IANA's RDAP registry",
      docs("monitor/domain-monitor"),
      "The IANA RDAP bootstrap registry, which says where each TLD's RDAP server is.",
    ),
  ],
  "monitoring/step/add-probe": [SHOW_ID_AND_KEY],
  "monitoring/step/run-probe": [
    fact(
      "ONEUPTIME_URL set to your install",
      CUSTOM_PROBE,
      "| `ONEUPTIME_URL` | Where OneUptime is: `https://oneuptime.com`, or your own installation's URL.",
    ),
  ],
  "monitoring/step/private-addresses": [
    fact(
      "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true",
      CUSTOM_PROBE,
      "Set to `true` to let Website, API, External Status Page and Custom Code monitors on this probe reach private addresses.",
    ),
  ],
  "monitoring/caption": [
    fact(
      "nothing has to reach it from outside your network",
      CUSTOM_PROBE,
      "Nothing has to reach the probe from outside your network.",
    ),
  ],
  "monitoring/faq/0": [
    fact(
      "does not need public internet connectivity",
      "packages/Probe/Utils/OnlineCheck.ts",
      "// Self-hosted probes do not require public internet connectivity.",
    ),
  ],
  "monitoring/faq/1": [
    fact(
      "Chromium and Firefox ship inside the probe's Docker image",
      docs("monitor/synthetic-monitor"),
      "The browsers ship inside the probe's Docker image,",
    ),
  ],
  "monitoring/faq/2": [
    fact(
      "covers every outbound TLS call OneUptime's own code makes",
      CHART_CONFIGURATION,
      "`NODE_EXTRA_CA_CERTS` covers Node.js, which is every outbound call OneUptime's",
    ),
    fact(
      "the probes' included",
      CHART_CONFIGURATION,
      "That reaches app, worker, every probe",
    ),
    fact(
      "Chromium reads the OS trust store instead",
      CHART_CONFIGURATION,
      "trust store instead. Synthetic monitors against an internally-signed site need",
    ),
  ],
  "monitoring/faq/3": [
    fact(
      "Domain monitors read the public registries",
      docs("monitor/domain-monitor"),
      "The IANA RDAP bootstrap registry",
    ),
    fact(
      "Incoming Email monitors need SendGrid to reach your install",
      SENDGRID,
      "Inbound Parse requires SendGrid to initiate a connection to OneUptime.",
    ),
  ],

  // ---------------------------------------------------- INCIDENT MANAGEMENT
  "incident-management/lead": [
    fact(
      "Declare incidents by hand or from a monitor",
      INCIDENTS,
      "You can declare an incident by hand at 3am, or let a monitor declare it the moment its criteria match.",
    ),
  ],
  "incident-management/flow": [
    fact(
      "By hand, or from a template",
      DECLARING,
      "## Declaring from a template",
    ),
    fact("Through the API", DECLARING, "## Declaring through the API"),
    fact(
      "Reported by anyone you share one with",
      DECLARING,
      "## Reporting through a form",
    ),
    fact(
      "Mattermost or IRC on your network",
      WORKFLOW_COMPONENTS,
      "on Mattermost Cloud or on a server of your own",
    ),
  ],
  "incident-management/install": [
    COMES_WITH_THE_INSTALL("Incident management comes with the install"),
  ],
  "incident-management/proof/0": [
    fact(
      "Declared by monitors or people",
      INCIDENTS,
      "You can declare an incident by hand at 3am, or let a monitor declare it the moment its criteria match.",
    ),
  ],
  "incident-management/proof/1": [
    fact(
      "Postmortems on the incident itself",
      POSTMORTEMS,
      "In OneUptime you write it on the incident itself.",
    ),
  ],
  "incident-management/proof/2": [
    fact(
      "Runbooks on a Runner you host",
      RUNBOOK_AGENTS,
      "The Runner only needs **outbound HTTPS** to your OneUptime instance.",
    ),
  ],
  "incident-management/proof/3": [
    fact(
      "AI drafts on a model you run",
      POSTMORTEMS,
      "It can start from your own template or from a draft by OneUptime AI",
    ),
  ],
  "incident-management/capability/declare": [
    fact(
      "Declare an incident by hand at 3am, or let a monitor declare it the moment its criteria match.",
      INCIDENTS,
      "You can declare an incident by hand at 3am, or let a monitor declare it the moment its criteria match.",
    ),
    fact(
      "Its on-call policies page people",
      DECLARING,
      "its on-call policies page people",
    ),
  ],
  "incident-management/capability/record": [
    fact(
      "an activity feed of everything that happened",
      NOTES,
      "updates for your customers, working notes for your team, and an activity feed of everything that happened",
    ),
  ],
  "incident-management/capability/episodes": [
    fact(
      "An episode groups related incidents, so your team works on them as one",
      EPISODES,
      "An episode groups related incidents, or related alerts, so your team works on them as one: one place to see them, one set of owners, one state to acknowledge and resolve.",
    ),
  ],
  "incident-management/capability/postmortems": [
    fact(
      "Write the postmortem on the incident itself",
      POSTMORTEMS,
      "In OneUptime you write it on the incident itself.",
    ),
    fact(
      "from your own template, and publish it on your status page",
      POSTMORTEMS,
      "It can start from your own template or from a draft by OneUptime AI, and it can be published on your status page",
    ),
  ],
  "incident-management/capability/runbooks": [
    fact(
      "only needs outbound HTTPS to your install",
      RUNBOOK_AGENTS,
      "The Runner only needs **outbound HTTPS** to your OneUptime instance. It does not accept any inbound connections.",
    ),
  ],
  "incident-management/capability/ai-drafts": [
    fact(
      "Ollama or another model on your own machines",
      LLM_PROVIDERS,
      "Ollama runs open-source models on your own machines.",
    ),
    fact("draft a postmortem", POSTMORTEMS, "from a draft by OneUptime AI"),
  ],
  "incident-management/change/chat": [
    fact(
      "Their cloud services, which have to reach your install",
      SLACK,
      "A public HTTPS hostname for OneUptime that Slack can reach.",
    ),
    fact(
      "Post to Mattermost or IRC on your network through a workflow",
      IRC,
      "Post incident updates to a channel on any IRC network: Libera.Chat, OFTC or a server of your own.",
    ),
    fact(
      "These post messages",
      IRC,
      "This integration is **outbound**: OneUptime posts in the channel, and doesn't read what's said there.",
    ),
  ],
  "incident-management/change/video": [
    fact(
      "Zoom, Google Meet, Microsoft Teams and Slack huddles",
      VIDEO_CALLS,
      "(a Zoom meeting, a Google Meet, a Microsoft Teams meeting or the Slack huddle of the incident's channel)",
    ),
    fact(
      "such as a Jitsi room",
      VIDEO_CALLS,
      "a Webex personal room or a Jitsi room",
    ),
    fact(
      "https",
      VIDEO_CALLS,
      "Paste its https join link into the connection form",
    ),
    fact(
      "start the call from the incident by hand",
      VIDEO_CALLS,
      "The **Video Call** card on an incident's or alert's page has **Start call**",
    ),
    fact(
      "Every incident shares that room",
      VIDEO_CALLS,
      "Every incident and alert started with this connection shares the room",
    ),
  ],
  "incident-management/change/jira": [
    fact(
      "Self-managed Jira works the same way with a handful of substitutions",
      JIRA,
      "Self-managed Jira works the same way with a handful of substitutions.",
    ),
    fact(
      "once workflows may reach private addresses",
      docs("workflows/configuration"),
      "ALLOW_PRIVATE_NETWORK_WEBHOOKS",
    ),
  ],
  "incident-management/change/cloud-tools": [
    fact(
      "ServiceNow",
      docs("integrations/servicenow"),
      "https://your-instance.service-now.com",
    ),
  ],
  "incident-management/step/allow-private": [
    fact(
      "webhooks.allowPrivateNetwork",
      PRIVATE_NETWORK,
      "| `ALLOW_PRIVATE_NETWORK_WEBHOOKS` | `webhooks.allowPrivateNetwork` |",
    ),
    fact(
      "webhooks.privateNetworkAllowlist",
      PRIVATE_NETWORK,
      "| `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | `webhooks.privateNetworkAllowlist` |",
    ),
  ],
  "incident-management/step/trigger": [
    fact(
      "OneUptime event trigger",
      WORKFLOW_TRIGGERS,
      "React when a record is created, updated or deleted.",
    ),
  ],
  "incident-management/step/post": [
    fact(
      "the Mattermost block with your incoming webhook",
      WORKFLOW_COMPONENTS,
      "Post a message to a Mattermost channel through an incoming webhook, on Mattermost Cloud or on a server of your own.",
    ),
    fact(
      "the IRC block with your server and channel",
      WORKFLOW_COMPONENTS,
      "Post a message to an IRC channel on any IRC network: Libera.Chat, OFTC, or a server of your own.",
    ),
  ],
  "incident-management/caption": [
    fact(
      "Set one or both",
      PRIVATE_NETWORK,
      "Set one or both of these on the API server and restart.",
    ),
    fact(
      "only the hosts and ranges it names",
      PRIVATE_NETWORK,
      "The hosts and CIDRs it names, whatever their tier.",
    ),
  ],
  "incident-management/faq/0": [
    COMES_WITH_THE_INSTALL("all run on your install"),
  ],
  "incident-management/faq/1": [
    fact(
      "both need a public HTTPS hostname",
      SLACK,
      "A public HTTPS hostname for OneUptime that Slack can reach.",
    ),
    fact(
      "both need a public HTTPS hostname",
      TEAMS,
      "A public HTTPS hostname for OneUptime that Azure Bot Service can reach.",
    ),
  ],
  "incident-management/faq/2": [
    fact(
      "Self-managed Jira works the same way with a handful of substitutions",
      JIRA,
      "Self-managed Jira works the same way with a handful of substitutions.",
    ),
  ],
  "incident-management/faq/3": [
    fact(
      "Start the call from the incident's Video Call card",
      VIDEO_CALLS,
      "The **Video Call** card on an incident's or alert's page has **Start call**",
    ),
    fact(
      "automatic calls need a Slack or Microsoft Teams rule",
      VIDEO_CALLS,
      "When a Slack or Microsoft Teams notification rule fires for a new incident or alert, OneUptime starts a dedicated meeting",
    ),
  ],

  // ---------------------------------------------------------------- ON-CALL
  "on-call/lead": [
    fact(
      "a gateway you run for SMS and calls",
      GATEWAY,
      "OneUptime can send its SMS and calls through a gateway you run, instead of Twilio.",
    ),
  ],
  "on-call/flow": [
    fact(
      "pages level by level until somebody acknowledges",
      ON_CALL,
      "its on-call policies page people level by level until somebody acknowledges",
    ),
    fact(
      "Custom channels, Enterprise Edition",
      CUSTOM_CHANNELS,
      "Custom channels are part of the [OneUptime Enterprise Edition](/docs/self-hosted/enterprise)",
    ),
  ],
  "on-call/install": [COMES_WITH_THE_INSTALL("On-call comes with the install")],
  "on-call/proof/0": [
    COMES_WITH_THE_INSTALL("Schedules and escalation on your install"),
  ],
  "on-call/proof/1": [
    fact(
      "SMS and calls through your own gateway",
      GATEWAY,
      "OneUptime can send its SMS and calls through a gateway you run, instead of Twilio.",
    ),
  ],
  "on-call/proof/2": [
    fact(
      "The gateway is in every edition",
      "packages/App/FeatureSet/Notification/Config.ts",
      "CallAndSmsGatewayConfig",
    ),
  ],
  "on-call/proof/3": [
    fact(
      "Acknowledge from a link, a call or a reply",
      GATEWAY,
      "When the person answers a call or a reply, your gateway sends a `POST` request to the matching link in `actions`.",
    ),
  ],
  "on-call/capability/schedules": [
    fact(
      "A schedule decides who is on call at any moment",
      SCHEDULES,
      "An on-call schedule decides who is on call at any moment.",
    ),
    fact(
      "a user override covers for someone who is away",
      docs("on-call/user-overrides"),
      "While someone is away, a user override sends the pages that would reach them to the person who covers for them",
    ),
  ],
  "on-call/capability/escalation": [
    fact(
      "pages level by level until somebody acknowledges",
      ON_CALL,
      "page people level by level until somebody acknowledges",
    ),
    fact(
      "records each run, rule by rule",
      ON_CALL,
      "records each run, rule by rule, in **Execution Logs**",
    ),
  ],
  "on-call/capability/personal-rules": [
    fact(
      "which of their methods is tried, and after how long",
      ON_CALL,
      "Each person is reached as their How to Reach Me says: which of their methods is tried, and after how long.",
    ),
  ],
  "on-call/capability/readiness": [
    fact(
      "as Ready, Needs setup or Unreachable, with what is missing",
      ON_CALL,
      "Everyone your policies can page is listed as **Ready**, **Needs setup** or **Unreachable**, with what is missing.",
    ),
  ],
  "on-call/capability/email": [
    fact(
      "Set Email Server Type to Custom SMTP",
      SMTP,
      "set **Email Server Type** to `Custom SMTP`",
    ),
  ],
  "on-call/capability/custom-channels": [
    fact(
      "With the Enterprise Edition",
      CUSTOM_CHANNELS,
      "Custom channels are part of the [OneUptime Enterprise Edition](/docs/self-hosted/enterprise)",
    ),
    fact(
      "a service you run",
      CUSTOM_CHANNELS,
      "A custom channel sends on-call pages to a service you run",
    ),
    fact(
      "acknowledge, escalate or resolve it",
      CUSTOM_CHANNELS,
      "Acknowledge, escalate or resolve from your own app.",
    ),
  ],
  "on-call/change/sms-and-calls": [
    fact(
      "signed JSON request",
      GATEWAY,
      "OneUptime posts each SMS and call to your gateway as a signed JSON request, and your gateway delivers it.",
    ),
    fact(
      "the Gateway URL can be on your private network",
      GATEWAY,
      "enter the **Gateway URL**. It can be on your private network.",
    ),
  ],
  "on-call/change/acknowledge": [
    fact(
      "Pressing 1 on a call",
      FIREWALL,
      "| A responder presses 1 on an on-call phone call | Twilio |",
    ),
    fact(
      "offers the actions its own way, such as key presses",
      GATEWAY,
      "Offer the actions your own way, such as key presses, and call the matching link.",
    ),
  ],
  "on-call/change/webhooks": [
    fact(
      "Private addresses refused",
      PRIVATE_NETWORK,
      "| Workflows, project webhooks, on-call user webhooks | The **API server**'s environment | Private addresses refused |",
    ),
    fact(
      "webhooks.allowPrivateNetwork: true",
      PRIVATE_NETWORK,
      "  allowPrivateNetwork: true",
    ),
  ],
  "on-call/change/calendars": [
    fact(
      "fetch from their own servers",
      CALENDAR_FEEDS,
      "Google Calendar, Outlook on the web, Fastmail and Proton fetch **from their own servers**",
    ),
    fact(
      "Apple Calendar, Thunderbird and classic Outlook fetch from the device",
      CALENDAR_FEEDS,
      "Apple Calendar, Thunderbird and classic Outlook fetch from the device",
    ),
  ],
  "on-call/change/push": [
    fact(
      "OneUptime's push relay or Expo",
      PUSH,
      "A server with no access to its relay or external push services cannot deliver these notifications.",
    ),
    fact(
      "turn push off for the whole server",
      PUSH,
      "turn **Send push notifications** off",
    ),
  ],
  "on-call/change/whatsapp-telegram": [
    fact(
      "Meta and api.telegram.org",
      FIREWALL,
      "Sending alerts needs only outbound HTTPS to `api.telegram.org`.",
    ),
    fact(
      "Meta and api.telegram.org",
      FIREWALL,
      "OneUptime connects out to your mail server, Twilio, Telegram, Meta",
    ),
  ],
  "on-call/change/incoming-calls": [
    fact(
      "A phone number on your own Twilio account",
      INCOMING_CALLS,
      "The numbers and the calls run on your own Twilio account.",
    ),
  ],
  "on-call/step/choose": [
    fact(
      "go to Settings > Call and SMS, click Edit Provider",
      GATEWAY,
      "In the Admin Dashboard, go to **Settings > Call and SMS**, and click **Edit Provider**",
    ),
    fact(
      "choose Your own gateway",
      GATEWAY,
      "Choose **Your own gateway**, and enter the **Gateway URL**.",
    ),
  ],
  "on-call/step/url": [
    fact(
      "OneUptime makes a signing secret for you to copy into your gateway",
      GATEWAY,
      "OneUptime makes a signing secret for you. Copy it from the card into your gateway.",
    ),
  ],
  "on-call/step/test": [
    fact(
      "Your gateway should answer with a 2xx status and send nothing.",
      GATEWAY,
      "Your gateway should answer with a 2xx status and send nothing.",
    ),
  ],
  "on-call/caption": [
    fact(
      "HMAC-SHA256 signature of its body",
      GATEWAY,
      "the hex HMAC-SHA256 of the body",
    ),
    fact(
      "A 2xx answer within 10 seconds counts as delivered",
      GATEWAY,
      "A request counts as delivered when your gateway answers with a 2xx status within 10 seconds.",
    ),
    fact(
      "OneUptime does not learn whether the message reached the phone",
      GATEWAY,
      "OneUptime does not learn whether the message reached the phone",
    ),
  ],
  "on-call/faq/0": [
    fact(
      "on-call pages, notifications, verification codes and status page subscriber SMS",
      GATEWAY,
      "on-call pages, notifications, verification codes and status page subscriber SMS",
    ),
  ],
  "on-call/faq/1": [
    fact(
      "The gateway is in the Community Edition",
      "packages/Common/Types/CallAndSMS/CallAndSmsProvider.ts",
      "WHAT CARRIES THE ONEUPTIME SERVER'S SMS AND CALLS: TWILIO, OR A GATEWAY.",
    ),
    fact(
      "need an Enterprise license that includes them",
      CUSTOM_CHANNELS,
      "need an Enterprise license that includes them",
    ),
  ],
  "on-call/faq/2": [
    fact(
      "A phone on your VPN can open your install in the app",
      MOBILE_FAQ,
      "If your OneUptime is on a private network, connect the",
    ),
    fact(
      "a phone needs Apple's or Google's push service",
      PUSH,
      "iOS devices need APNs access",
    ),
  ],
  "on-call/faq/3": [
    fact(
      "From the link in an email or SMS, on a device that can reach your install",
      FIREWALL,
      "The acknowledgement links in emails, SMS, WhatsApp and Telegram messages open, because the phone reaches your server.",
    ),
    fact(
      "when the person answers a call or a reply",
      GATEWAY,
      "When the person answers a call or a reply, your gateway sends a `POST` request to the matching link in `actions`.",
    ),
  ],
  "on-call/faq/4": [
    fact(
      "after 1 second and after 4 seconds more: three attempts in all",
      GATEWAY,
      "is sent again after 1 second and after 4 seconds more: three attempts in all.",
    ),
    fact(
      "The person's on-call log says why it was not delivered",
      GATEWAY,
      "or why it was not delivered, never the URL.",
    ),
    fact(
      "If nobody acknowledges before the rule's wait runs out, the next rule pages.",
      ON_CALL,
      "If nobody acknowledges before the rule's wait runs out, the next rule pages.",
    ),
  ],

  // ----------------------------------------------------------- STATUS PAGES
  "status-pages/lead": [
    fact(
      "behind your own sign-in",
      STATUS_PAGES,
      "visitors land on `/login` and sign in as a private user, or with your SSO or OIDC provider",
    ),
  ],
  "status-pages/flow": [
    fact(
      "Through your gateway",
      GATEWAY,
      "on-call pages, notifications, verification codes and status page subscriber SMS",
    ),
  ],
  "status-pages/install": [
    COMES_WITH_THE_INSTALL("Status pages come with the install"),
  ],
  "status-pages/proof/0": [
    COMES_WITH_THE_INSTALL("Served from your own install"),
  ],
  "status-pages/proof/1": [
    fact(
      "SAML and OpenID Connect in every edition",
      ENTERPRISE,
      "| SAML SSO and OpenID Connect for private status page sign-in | Yes | Yes |",
    ),
  ],
  "status-pages/proof/2": [
    fact(
      "Certificates you upload",
      BRANDING,
      "switch **Upload Custom Certificate** on",
    ),
  ],
  "status-pages/proof/3": [
    fact(
      "Subscribers by email and SMS",
      SUBSCRIBERS,
      "they hand you an email address, a phone number, a Slack webhook or an HTTP endpoint once",
    ),
  ],
  "status-pages/capability/access": [
    fact(
      "to anyone with the link",
      STATUS_PAGES,
      "**Anyone with the link** — the page is public.",
    ),
    fact(
      "people who sign in",
      STATUS_PAGES,
      "**Only people who sign in** — visitors land on `/login`",
    ),
    fact(
      "unlock it with one password you share",
      STATUS_PAGES,
      "unlock the page with one password you share with them",
    ),
  ],
  "status-pages/capability/sso": [
    fact(
      "SAML and OpenID Connect sign-in, in every edition",
      ENTERPRISE,
      "| SAML SSO and OpenID Connect for private status page sign-in | Yes | Yes |",
    ),
    fact(
      "can require it for everyone",
      STATUS_PAGES,
      "the **Require SSO for Login** switch",
    ),
  ],
  "status-pages/capability/domain": [
    fact(
      "OneUptime serves it within 15 minutes of saving",
      BRANDING,
      "If you uploaded your own certificate under **More fields**, OneUptime serves that one instead, within 15 minutes of saving.",
    ),
  ],
  "status-pages/capability/email-subscribers": [
    fact(
      "incidents, announcements and scheduled maintenance",
      STATUS_PAGES,
      "whose items are prefixed `Incident: `, `Announcement: ` and `Scheduled Maintenance: `",
    ),
    fact(
      "through your own mail server",
      SMTP,
      "set **Email Server Type** to `Custom SMTP`",
    ),
  ],
  "status-pages/capability/sms-subscribers": [
    fact(
      "goes through the gateway you run",
      GATEWAY,
      "on-call pages, notifications, verification codes and status page subscriber SMS",
    ),
  ],
  "status-pages/capability/maintenance": [
    fact(
      "read it from a calendar on your own network",
      docs("scheduled-maintenance/calendar"),
      "A self-hosted server can read a calendar on your own network, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`.",
    ),
  ],
  "status-pages/change/certificates": [
    fact(
      "Let's Encrypt, which checks your server on port 80",
      BRANDING,
      "make sure the server answers on ports 80 and 443: visitors and Let's Encrypt reach every custom domain there",
    ),
    fact(
      "a domain is live as soon as its CNAME record is verified",
      BRANDING,
      "There, a domain is live as soon as its CNAME record is verified",
    ),
    fact("at your own proxy", BRANDING, "serve its HTTPS at your own proxy"),
  ],
  "status-pages/change/sms-signup": [
    fact(
      "A text with a link to open",
      SUBSCRIBERS,
      "We have sent a text message to this phone number. Open the link in it to confirm your subscription.",
    ),
    fact(
      "Subscribers your team adds skip that step",
      SUBSCRIBERS,
      "so do SMS subscribers your team adds",
    ),
  ],
  "status-pages/change/private-feeds": [
    fact(
      "its calendar is empty, since an app cannot sign in",
      STATUS_PAGES,
      "A private page's calendar is empty, since a calendar app cannot sign in.",
    ),
    fact(
      "A private page's feed lists nothing",
      "packages/Common/Server/Utils/StatusPage/StatusPageRssFeed.ts",
      "so a private page's feed lists nothing",
    ),
  ],
  "status-pages/change/chat-subscribers": [
    fact(
      "hooks.slack.com",
      SUBSCRIBERS,
      "A **Slack Incoming Webhook URL** must start with `https://hooks.slack.com/services/`.",
    ),
    fact(
      "Microsoft's own addresses",
      SUBSCRIBERS,
      "A **Microsoft Teams Incoming Webhook URL** must be an `https` address on `office.com`",
    ),
  ],
  "status-pages/change/webhook-subscribers": [
    fact(
      "Ones your team adds reach your own tools",
      PRIVATE_NETWORK,
      "- Status page webhook subscribers your team adds, from the dashboard, with an API key or by a workflow",
    ),
    fact(
      "once webhooks may reach private addresses",
      PRIVATE_NETWORK,
      "| `ALLOW_PRIVATE_NETWORK_WEBHOOKS` | `webhooks.allowPrivateNetwork` | The whole private tier, when set to `true`. |",
    ),
    fact(
      "People who subscribe themselves on the page still need a public address",
      PRIVATE_NETWORK,
      "**Not** covered, and never will be: **webhook subscribers who sign up on a status page**.",
    ),
    fact(
      "People who subscribe themselves on the page still need a public address",
      SUBSCRIBERS,
      "are rejected for a subscriber who signs up on the status page, whatever your instance allows.",
    ),
  ],
  "status-pages/step/cname": [
    fact(
      "a hostname that points at your OneUptime server",
      BRANDING,
      "set it to a hostname that points at your OneUptime server",
    ),
  ],
  "status-pages/step/domain": [
    fact(
      "Project Settings > Advanced > Domains",
      BRANDING,
      "**Project Settings → Advanced → Domains**",
    ),
  ],
  "status-pages/step/certificate": [
    fact(
      "Under More fields, switch Upload Custom Certificate on",
      BRANDING,
      "switch **Upload Custom Certificate** on",
    ),
  ],
  "status-pages/caption": [
    fact(
      "a self-hosted install without one issues no free certificates",
      BRANDING,
      "(`letsEncrypt.accountKey` in the Helm chart), issues no free certificates",
    ),
  ],
  "status-pages/faq/0": [
    fact(
      "sign in as a private user or with your SSO or OIDC provider",
      STATUS_PAGES,
      "sign in as a private user, or with your SSO or OIDC provider",
    ),
    fact(
      "IP allowlists",
      "packages/Common/Server/Enterprise/EnterpriseEdition.ts",
      "ipWhitelist: EnterpriseFeature.IpAllowlists,",
    ),
    fact(
      "reader session length are part of the Enterprise Edition",
      "packages/Common/Server/Enterprise/EnterpriseEdition.ts",
      "privateUserSessionLengthInHours:\n        EnterpriseFeature.StatusPageAccessControls,",
    ),
  ],
  "status-pages/faq/1": [
    fact(
      "Single sign-on is in every edition",
      ENTERPRISE,
      "**Single sign-on is in every edition.** SAML and OIDC sign-in for projects and status pages",
    ),
  ],
  "status-pages/faq/2": [
    fact(
      "those never reach a private address, and no setting changes that",
      PRIVATE_NETWORK,
      "This is not configurable.",
    ),
    fact(
      "Project webhooks and workflows do, once you allow private addresses",
      PRIVATE_NETWORK,
      "| Workflows, project webhooks, on-call user webhooks |",
    ),
  ],
  "status-pages/faq/3": [
    fact(
      "a domain is live as soon as its CNAME record is verified",
      BRANDING,
      "There, a domain is live as soon as its CNAME record is verified",
    ),
  ],

  // ------------------------------------------------------------- KUBERNETES
  "kubernetes/lead": [
    fact(
      "sends what it collects to your own OneUptime URL over OTLP, with the ingestion key you give it",
      AGENT_INSTALL,
      "Each one sends what it collects to your OneUptime URL over OTLP, with the ingestion key you give it.",
    ),
  ],
  "kubernetes/flow": [
    fact(
      "On every Linux node",
      AGENT_INSTALL,
      'nodes["Every Linux node:<br/>node collector, eBPF"]',
    ),
    fact("Cluster collector", AGENT_INSTALL, 'collector["Cluster collector"]'),
    fact(
      "Twenty-one templates",
      KUBERNETES_MONITOR,
      "Twenty-one ready-made alerts, from a silent cluster to etcd.",
    ),
  ],
  "kubernetes/install": [
    fact(
      "The Kubernetes agent has a chart and images of its own",
      AGENT_README,
      "# OneUptime Kubernetes Agent",
    ),
  ],
  "kubernetes/proof/0": [
    fact(
      "Every image takes your registry",
      AGENT_AIR_GAPPED_VALUES,
      "registry.example.com/otel/opentelemetry-collector-contrib",
    ),
  ],
  "kubernetes/proof/1": [
    fact(
      "Sends to your own URL",
      AGENT_INSTALL,
      "Each one sends what it collects to your OneUptime URL over OTLP",
    ),
  ],
  "kubernetes/proof/2": [
    fact(
      "OpenShift presets",
      AGENT_INSTALL,
      "| `openshift-restricted` | **OpenShift**, where an admin will not add an SCC |",
    ),
  ],
  "kubernetes/proof/3": [
    fact(
      "Cost from a rate card of your own",
      KUBERNETES_COST,
      "Clusters whose nodes have no public cloud list price can set a rate card.",
    ),
  ],
  "kubernetes/capability/signals": [
    fact(
      "cluster metrics, events, pod logs, application traces through eBPF, and OS-level node metrics",
      AGENT_README,
      "Collects cluster metrics, events, pod logs, **application traces (HTTP/gRPC via eBPF)**, and **OS-level node metrics**",
    ),
  ],
  "kubernetes/capability/your-url": [
    fact(
      "sends what it collects to your OneUptime URL over OTLP",
      AGENT_INSTALL,
      "Each one sends what it collects to your OneUptime URL over OTLP, with the ingestion key you give it.",
    ),
  ],
  "kubernetes/capability/alerts": [
    fact(
      "from a silent cluster to etcd",
      KUBERNETES_MONITOR,
      "Twenty-one ready-made alerts, from a silent cluster to etcd.",
    ),
  ],
  "kubernetes/capability/openshift": [
    fact(
      "OpenShift Container Platform, ROSA, ARO and OKD",
      AGENT_INSTALL,
      "| `openshift` | **OpenShift**: OpenShift Container Platform, ROSA, ARO, OKD |",
    ),
    fact(
      "where an admin will not add an SCC",
      AGENT_INSTALL,
      "**OpenShift**, where an admin will not add an SCC",
    ),
  ],
  "kubernetes/capability/ai-agent": [
    fact(
      "its calls are HTTPS requests to your own install",
      "agents/KubernetesAIAgent/README.md",
      "/kubernetes-ai-agent-ingest/*",
    ),
  ],
  "kubernetes/capability/cost": [
    fact(
      "in USD per resource-hour",
      KUBERNETES_COST,
      "OpenCost then prices every resource from these figures, all in USD per resource-hour:",
    ),
  ],
  "kubernetes/change/images": [
    fact(
      "Docker Hub",
      AGENT_VALUES,
      "repository: otel/opentelemetry-collector-contrib",
    ),
    fact(
      "registry.k8s.io",
      AGENT_VALUES,
      "repository: registry.k8s.io/kube-state-metrics/kube-state-metrics",
    ),
    fact("ghcr.io", AGENT_VALUES, "repository: ghcr.io/opencost/opencost"),
    fact("quay.io", AGENT_VALUES, "repository: quay.io/prometheus/prometheus"),
    fact(
      "such as cost or profiling",
      AGENT_VALUES,
      "repository: otel/opentelemetry-collector-ebpf-profiler",
    ),
  ],
  "kubernetes/change/pull-secrets": [
    fact("aiAgent.imagePullSecrets", AGENT_VALUES, "  imagePullSecrets: []"),
    fact(
      "reaches the AI agent's pod and no other",
      `${AGENT_CHART_TEMPLATES}/ai-agent.yaml`,
      "imagePullSecrets",
    ),
  ],
  "kubernetes/change/chart": [
    fact(
      "helm-chart.oneuptime.com",
      AGENT_INSTALL,
      "helm repo add oneuptime https://helm-chart.oneuptime.com",
    ),
    fact(
      "It is signed with the same key",
      ".github/workflows/release.yml",
      "helm package --sign --key 'key@oneuptime.com' --keyring ~/.gnupg/secring.gpg kubernetes-agent",
    ),
  ],
  "kubernetes/change/private-ca": [
    fact(
      "The collector image's trust store",
      "HelmChart/Public/kubernetes-agent/troubleshoot.sh",
      "The collector image's trust store must accept the cert.",
    ),
  ],
  "kubernetes/change/cost-prices": [
    fact(
      "Your cloud provider's public list prices",
      KUBERNETES_COST,
      "OpenCost prices nodes from your cloud provider's public list prices (AWS, Google Cloud, Azure) with no credentials.",
    ),
    fact(
      "cost.opencost.customPricing",
      KUBERNETES_COST,
      "    customPricing:\n      enabled: true",
    ),
  ],
  "kubernetes/step/mirror": [
    fact(
      "pin the ones that track release",
      AGENT_VALUES,
      'Pin a OneUptime version (e.g. "14.1.0") to hold it.',
    ),
  ],
  "kubernetes/step/values": [
    fact(
      "Set each image's repository",
      AGENT_VALUES,
      "To use a\n    # mirror, set repository (e.g. registry.example.com/oneuptime/kubernetes-ai-agent).",
    ),
  ],
  "kubernetes/step/install": [
    fact(
      "oneuptime.url set to your install",
      AGENT_README,
      "--set oneuptime.url=https://oneuptime.com",
    ),
  ],
  "kubernetes/caption": [
    fact(
      "A test renders the chart with exactly these values",
      "HelmChart/Tests/suites/air-gapped.sh",
      'AGENT_VALUES="${TESTS_DIR}/kubernetes-agent-air-gapped-values.yaml"',
    ),
    fact(
      "every image comes from your registry",
      "HelmChart/Tests/suites/air-gapped.sh",
      'assert_eq "every image of the agent comes from ${REGISTRY}"',
    ),
    fact(
      "These are the images a default install runs",
      "HelmChart/Tests/suites/air-gapped.sh",
      'assert_eq "a stock agent chart runs the three images the values name" "3"',
    ),
  ],
  "kubernetes/faq/0": [
    fact(
      "sends what it collects to your OneUptime URL",
      AGENT_INSTALL,
      "Each one sends what it collects to your OneUptime URL over OTLP",
    ),
    fact(
      "the Kubernetes AI agent's calls go to that URL too",
      "agents/KubernetesAIAgent/README.md",
      "/kubernetes-ai-agent-ingest/*",
    ),
  ],
  "kubernetes/faq/1": [
    fact(
      "set each image's repository",
      AGENT_VALUES,
      "repository: oneuptime/kubernetes-ai-agent",
    ),
    fact("aiAgent.imagePullSecrets", AGENT_VALUES, "  imagePullSecrets: []"),
  ],
  "kubernetes/faq/2": [
    fact(
      "preset=openshift-restricted",
      AGENT_INSTALL,
      "| `openshift-restricted` | **OpenShift**, where an admin will not add an SCC |",
    ),
  ],
  "kubernetes/faq/3": [
    fact(
      "The collector image's trust store has to accept the certificate",
      "HelmChart/Public/kubernetes-agent/troubleshoot.sh",
      "The collector image's trust store must accept the cert.",
    ),
  ],

  // ----------------------------------------------------- NETWORK MONITORING
  "network-monitoring/lead": [
    fact(
      "builds your topology from LLDP",
      NETWORK_DEVICE,
      "built from the LLDP neighbours that interface walks collect,",
    ),
    fact(
      "Its OID names and map outlines ship with OneUptime",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldGeometry.ts",
      "On-demand loader for the checked-in world country outlines",
    ),
  ],
  "network-monitoring/flow": [
    fact(
      "NetFlow, IPFIX and sFlow",
      NETWORK_TRAFFIC,
      "| UDP 6343 | sFlow v5                    |",
    ),
    fact(
      "From LLDP neighbours",
      NETWORK_DEVICE,
      "built from the LLDP neighbours that interface walks collect,",
    ),
  ],
  "network-monitoring/install": [
    fact(
      "A probe on the device network runs the image you mirrored",
      CUSTOM_PROBE,
      "-d oneuptime/probe:release",
    ),
  ],
  "network-monitoring/proof/0": [
    fact(
      "SNMP v1, v2c and v3",
      NETWORK_DEVICE,
      "| SNMP Version | V1, V2c or V3. |",
    ),
  ],
  "network-monitoring/proof/1": [
    fact(
      "NetFlow, IPFIX and sFlow",
      NETWORK_TRAFFIC,
      "It listens on three UDP ports, and every port reads every format:",
    ),
  ],
  "network-monitoring/proof/2": [
    fact(
      "OID names built in",
      "packages/Common/Utils/NetworkDevice/SnmpOidNameUtil.ts",
      "the way snmpwalk names an OID whose MIB it lacks",
    ),
  ],
  "network-monitoring/proof/3": [
    fact(
      "No map service to reach",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteGeoMap.tsx",
      "Inline-SVG world map of network sites: checked-in country outlines",
    ),
  ],
  "network-monitoring/capability/snmp": [
    fact(
      "anything with an address on your network, whether or not it speaks SNMP",
      NETWORK_DEVICE,
      "anything with an address on your network, whether or not it speaks SNMP.",
    ),
    fact(
      "the probe walks it too",
      NETWORK_DEVICE,
      "Give it SNMP credentials and the same probe also walks it",
    ),
  ],
  "network-monitoring/capability/traps": [
    fact(
      "v1 and v2c traps and informs",
      NETWORK_DEVICE,
      "takes v1 and v2c traps and informs",
    ),
    fact(
      "UDP 162 by default",
      CUSTOM_PROBE,
      "| SNMP traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | On, UDP 162 |",
    ),
  ],
  "network-monitoring/capability/syslog": [
    fact(
      "Every probe listens for syslog on port 5140, over UDP and over TCP",
      NETWORK_EVENTS,
      SYSLOG_ON_A_PROBE,
    ),
  ],
  "network-monitoring/capability/flows": [
    fact(
      "Every probe runs a flow collector",
      NETWORK_TRAFFIC,
      "Every probe runs a flow collector. It listens on three UDP ports, and every port reads every format:",
    ),
  ],
  "network-monitoring/capability/topology": [
    fact(
      "A scan is a plain ICMP sweep",
      NETWORK_DEVICE,
      "a scan is a plain ICMP sweep",
    ),
    fact(
      "built from the LLDP neighbours that interface walks collect",
      NETWORK_DEVICE,
      "built from the LLDP neighbours that interface walks collect,",
    ),
  ],
  "network-monitoring/capability/sites": [
    fact("Sites form a tree", NETWORK_SITES, "Sites form a tree."),
    fact(
      "outlines that ship with OneUptime",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteGeoMap.tsx",
      "checked-in country outlines",
    ),
  ],
  "network-monitoring/change/unknown-senders": [
    fact(
      "A global probe drops them",
      NETWORK_TRAFFIC,
      "A global probe drops them.",
    ),
    fact(
      "It keeps them until you say which device they belong to",
      NETWORK_TRAFFIC,
      "until you say which device they belong to",
    ),
  ],
  "network-monitoring/change/container-ports": [
    fact(
      "Reachable only with host networking, or when published",
      CUSTOM_PROBE,
      "Inside a container, a port is reachable from other machines only with host networking or when you publish it.",
    ),
  ],
  "network-monitoring/change/packet-capture": [
    fact(
      "The probes that come with an install never capture",
      PACKET_CAPTURE,
      "are global probes, so they never capture.",
    ),
    fact(
      "Run a custom probe in the network you want to capture in.",
      PACKET_CAPTURE,
      "Run a custom probe in the network you want to capture in.",
    ),
  ],
  "network-monitoring/change/meraki": [
    fact(
      "api.meraki.com",
      NETWORK_TRAFFIC,
      "Allow HTTPS (port 443) from OneUptime's servers to `api.meraki.com`",
    ),
    fact(
      "Send NetFlow from the MX appliances",
      NETWORK_TRAFFIC,
      "send NetFlow from the MX appliances",
    ),
  ],
  "network-monitoring/step/add-probe": [SHOW_ID_AND_KEY],
  "network-monitoring/step/host-network": [
    fact(
      "so devices can reach its ports",
      CUSTOM_PROBE,
      "Inside a container, a port is reachable from other machines only with host networking or when you publish it.",
    ),
  ],
  "network-monitoring/step/point-devices": [
    fact(
      "Send traps to UDP 162",
      CUSTOM_PROBE,
      "| SNMP traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | On, UDP 162 |",
    ),
    fact(
      "syslog to port 5140",
      CUSTOM_PROBE,
      "| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | On, UDP and TCP 5140 |",
    ),
    fact(
      "flows to UDP 2055, 4739 or 6343",
      CUSTOM_PROBE,
      "| NetFlow, IPFIX and sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | On, UDP 2055, 4739 and 6343 |",
    ),
  ],
  "network-monitoring/caption": [
    fact(
      "Syslog takes plain UDP and TCP",
      NETWORK_EVENTS,
      "The probe takes plain UDP and TCP; keep the path between the devices and the probe on a network you trust.",
    ),
  ],
  "network-monitoring/faq/0": [
    fact(
      "the way snmpwalk names one whose MIB it lacks",
      "packages/Common/Utils/NetworkDevice/SnmpOidNameUtil.ts",
      "the way snmpwalk names an OID whose MIB it lacks",
    ),
  ],
  "network-monitoring/faq/1": [
    fact(
      "country outlines that ship with OneUptime",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteGeoMap.tsx",
      "checked-in country outlines",
    ),
  ],
  "network-monitoring/faq/2": [
    fact(
      "they drop syslog and flows from senders they do not poll",
      NETWORK_EVENTS,
      "A global probe drops it.",
    ),
    fact(
      "they never capture packets",
      PACKET_CAPTURE,
      "are global probes, so they never capture.",
    ),
  ],
  "network-monitoring/faq/3": [
    fact(
      "syslog over TLS is not included",
      NETWORK_EVENTS,
      "- **Syslog over TLS** (RFC 5425). The probe takes plain UDP and TCP",
    ),
  ],

  // --------------------------------------------------------- INFRASTRUCTURE
  "infrastructure/lead": [
    fact(
      "Add hosts with one command from your own install",
      HOSTS,
      "Every OneUptime serves its own installers",
    ),
  ],
  "infrastructure/flow": [
    fact(
      "Linux, Windows and macOS",
      HOSTS,
      "Add a Linux, Windows or macOS machine to OneUptime with one command.",
    ),
    fact(
      "vCenter or a standalone ESXi host",
      VMWARE,
      "Monitor a vCenter Server, or a standalone ESXi host, without installing anything",
    ),
  ],
  "infrastructure/install": [
    fact(
      "Your install then serves the installers",
      HOSTS,
      "Every OneUptime serves its own installers",
    ),
  ],
  "infrastructure/proof/0": [
    fact(
      "Installers served by your install",
      HOSTS,
      "Every OneUptime serves its own installers, so a self-hosted OneUptime hands out the installer of its own release",
    ),
  ],
  "infrastructure/proof/1": [
    fact(
      "Downloads from a mirror you run",
      HOSTS,
      "Downloads the releases from a mirror with the same folder layout as GitHub's.",
    ),
  ],
  "infrastructure/proof/2": [
    fact("VMware with no agent", VMWARE, "There is no agent to install"),
  ],
  "infrastructure/proof/3": [
    fact(
      "Read-only accounts and tokens",
      VMWARE,
      "enter vCenter's address and a read-only account in OneUptime",
    ),
    fact(
      "Read-only accounts and tokens",
      PROXMOX,
      "It reads the cluster through the Proxmox VE API with a read-only token",
    ),
  ],
  "infrastructure/capability/hosts": [
    fact(
      "Add a Linux, Windows or macOS machine with one command",
      HOSTS,
      "Add a Linux, Windows or macOS machine to OneUptime with one command.",
    ),
    fact(
      "OneUptime sends the collector its config and keeps it up to date",
      HOSTS,
      "OneUptime sends the collector its config and keeps it up to date",
    ),
  ],
  "infrastructure/capability/vmware": [
    fact(
      "pick the probe that can reach it, and the probe collects the data",
      VMWARE,
      "pick the probe that can reach it, and the probe collects the same data",
    ),
  ],
  "infrastructure/capability/proxmox": [
    fact(
      "reach every node's API on port 8006",
      PROXMOX,
      "on a machine that can reach every node's Proxmox VE API on port 8006.",
    ),
    fact("a read-only token", PROXMOX, "with a read-only token"),
  ],
  "infrastructure/capability/openstack": [
    fact(
      "reach Keystone and each service's endpoint",
      OPENSTACK,
      "A route from that machine to Keystone and to each service's public endpoint.",
    ),
    fact(
      "a probe with nothing to install",
      OPENSTACK_AGENTLESS,
      "# OpenStack Without an Agent",
    ),
  ],
  "infrastructure/capability/storage": [
    fact(
      "reach your mgr daemons on port 9283",
      CEPH,
      "on a machine that can reach your Ceph mgr daemons on port 9283.",
    ),
    fact(
      "cluster health",
      CEPH,
      "its health, monitor quorum, OSDs, pools and placement groups",
    ),
    fact(
      "the array's management interface over HTTPS",
      STORAGE_ARRAYS,
      "on a machine that can reach the array's management interface over HTTPS (TCP 443).",
    ),
    fact(
      "capacity, latency and hardware health",
      STORAGE_ARRAYS,
      "capacity and data reduction, latency, IOPS and bandwidth, volumes, hosts, pods and replication, hardware health",
    ),
  ],
  "infrastructure/capability/containers": [
    fact(
      "so nothing is probed from outside",
      DOCKER_MONITOR,
      "so nothing is probed from outside",
    ),
  ],
  "infrastructure/change/host-collector": [
    fact(
      "GitHub, the OpenTelemetry Collector's releases",
      "packages/App/FeatureSet/Docs/Static/scripts/host-collector/install.sh",
      'DEFAULT_DOWNLOAD_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download"',
    ),
    fact(
      "a mirror with the same folder layout as GitHub's",
      HOSTS,
      "Downloads the releases from a mirror with the same folder layout as GitHub's.",
    ),
    fact(
      ".sha256",
      "packages/App/FeatureSet/Docs/Static/scripts/host-collector/install.sh",
      'fail "Could not download $url.sha256"',
    ),
  ],
  "infrastructure/change/agent-images": [
    fact(
      "Docker Hub, ghcr.io and quay.io",
      "agents/ProxmoxAgent/docker-compose.yml",
      "image: prompve/prometheus-pve-exporter:latest",
    ),
    fact(
      "Docker Hub, ghcr.io and quay.io",
      "agents/StorageArrayAgent/docker-compose.yml",
      "image: quay.io/purestorage/pure-fa-om-exporter",
    ),
    fact(
      "OpenStack and storage array agents run stock images",
      "agents/OpenStackAgent/docker-compose.yml",
      "image: otel/opentelemetry-collector-contrib",
    ),
    fact(
      "ghcr.io",
      "agents/OpenStackAgent/docker-compose.yml",
      "image: ghcr.io/openstack-exporter/openstack-exporter",
    ),
    fact(
      "stock images named in their docker-compose.yml",
      "agents/CephAgent/docker-compose.yml",
      "image: otel/opentelemetry-collector-contrib",
    ),
    fact(
      "Their files come from your install",
      PROXMOX,
      "Every OneUptime serves the agent's install script and files for its own release",
    ),
  ],
  "infrastructure/change/infrastructure-agent": [
    fact(
      "GitHub, and packages.oneuptime.com for apt and yum",
      "agents/InfrastructureAgent/RELEASING.md",
      "the GitHub Pages site of `OneUptime/packages`",
    ),
    fact(
      "Create Monitor no longer offers it",
      SERVER_MONITOR,
      "**Create Monitor** no longer offers **Server / VM**.",
    ),
  ],
  "infrastructure/step/mirror": [
    fact(
      "with the same folder layout as GitHub's",
      HOSTS,
      "Downloads the releases from a mirror with the same folder layout as GitHub's.",
    ),
  ],
  "infrastructure/step/ingestion-key": [
    fact(
      "Add Host creates one for you",
      HOSTS,
      "**Add Host** creates one for you, or pick one you made under **Project Settings → Telemetry & APM → Ingestion Keys**.",
    ),
  ],
  "infrastructure/step/run": [
    fact(
      "in both places",
      HOSTS,
      "replace `https://oneuptime.com` with your URL in both places",
    ),
  ],
  "infrastructure/caption": [
    fact(
      "A host needs outbound HTTPS to your OneUptime URL",
      HOSTS,
      "Outbound HTTPS from the host to your OneUptime URL",
    ),
  ],
  "infrastructure/faq/0": [
    fact(
      "Your install serves the installer",
      HOSTS,
      "Every OneUptime serves its own installers",
    ),
    fact(
      "come from GitHub by default",
      "packages/App/FeatureSet/Docs/Static/scripts/host-collector/install.sh",
      'DEFAULT_DOWNLOAD_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download"',
    ),
  ],
  "infrastructure/faq/1": [
    fact(
      "There is no agent to install, upgrade or look after",
      VMWARE,
      "There is no agent to install",
    ),
  ],
  "infrastructure/faq/2": [
    fact(
      "Server / VM monitors you already have keep working",
      SERVER_MONITOR,
      "Server / VM monitors you already have keep working",
    ),
    fact(
      "Use a Host monitor",
      SERVER_MONITOR,
      "To watch a new server, create a [Host monitor](/docs/monitor/host-monitor) instead",
    ),
  ],
  "infrastructure/faq/3": [
    fact(
      "those are not on your install",
      "agents/ProxmoxAgent/docker-compose.yml",
      "image: prompve/prometheus-pve-exporter:latest",
    ),
    fact(
      "The OpenStack agent's installer has no option to download from a mirror",
      OPENSTACK,
      "with no option to download from a mirror instead",
    ),
  ],

  // --------------------------------------------------------------------- AI
  "ai/lead": [
    fact(
      "Investigations, Ask AI, drafts and fixes",
      LLM_PROVIDERS,
      "An LLM provider is the model behind every AI feature in OneUptime: investigations, Ask AI, drafts and fix pull requests.",
    ),
    fact(
      "Investigations are read-only, and secrets are redacted before anything reaches the model.",
      AI_SRE,
      "**Secrets are redacted** from tool results before anything is sent to the LLM (tokens, credentials, key patterns).",
    ),
  ],
  "ai/flow": [
    fact(
      "In your cluster, on your GPUs",
      LLM_PROVIDERS,
      "inside your cluster and serve local models on your own GPUs",
    ),
    fact(
      "LocalAI, LM Studio and others",
      LLM_PROVIDERS,
      "Any OpenAI-compatible server: vLLM, LocalAI, LM Studio and others",
    ),
  ],
  "ai/install": [
    fact(
      "with no provider, no AI feature runs",
      LLM_PROVIDERS,
      "Nothing runs, and<br/>the AI pages say<br/>a provider is missing",
    ),
  ],
  "ai/proof/0": [
    fact(
      "Ollama or any OpenAI-compatible server",
      LLM_PROVIDERS,
      "Any OpenAI-compatible server: vLLM, LocalAI, LM Studio and others",
    ),
  ],
  "ai/proof/1": [
    fact(
      "vLLM in the Helm chart",
      LLM_PROVIDERS,
      "### Self-Hosted vLLM on Kubernetes (Helm)",
    ),
  ],
  "ai/proof/2": [
    fact(
      "Investigations are read-only",
      AI_SRE,
      "the investigation itself is **strictly read-only**",
    ),
  ],
  "ai/proof/3": [
    fact(
      "Secrets redacted before the model",
      AI_SRE,
      "**Secrets are redacted** from tool results before anything is sent to the LLM",
    ),
  ],
  "ai/capability/investigations": [
    fact(
      "investigates it across your own telemetry and posts a cited root cause analysis",
      AI_SRE,
      "it wakes up, investigates it across your own telemetry",
    ),
    fact(
      "cited root cause analysis",
      AI_SRE,
      "posts a cited root cause analysis",
    ),
  ],
  "ai/capability/ask-ai": [
    fact(
      "Chat over your project's data, with a citation on every claim",
      ASK_AI,
      "Ask AI is OneUptime's chat over your project's data.",
    ),
    fact(
      "a citation on every claim",
      ASK_AI,
      "answers with a citation on every claim",
    ),
  ],
  "ai/capability/drafts": [
    fact(
      "Start a postmortem from a draft by OneUptime AI",
      POSTMORTEMS,
      "It can start from your own template or from a draft by OneUptime AI",
    ),
  ],
  "ai/capability/fixes": [
    fact(
      "reach the Git servers of its own network",
      AI_AGENT,
      "A self-hosted OneUptime, and its global Runner, reach the Git servers of its own network.",
    ),
  ],
  "ai/capability/read-only": [
    fact(
      "cannot acknowledge, resolve, page or modify anything",
      AI_SRE,
      "The AI cannot acknowledge, resolve, page, or modify anything from an investigation.",
    ),
    fact(
      "three independent checks keep it read-only",
      AI_SRE,
      "Three independent checks keep it read-only",
    ),
  ],
  "ai/capability/redaction": [
    fact(
      "Tokens, credentials and key patterns",
      AI_SRE,
      "(tokens, credentials, key patterns)",
    ),
  ],
  "ai/change/hosted-models": [
    fact(
      "Groq, Mistral and Azure OpenAI",
      "packages/Common/Types/LLM/LlmType.ts",
      'AzureOpenAI = "AzureOpenAI",',
    ),
    fact(
      "Groq, Mistral and Azure OpenAI",
      "packages/Common/Types/LLM/LlmType.ts",
      'Mistral = "Mistral",',
    ),
    fact(
      "vLLM in your cluster from the Helm chart",
      LLM_PROVIDERS,
      "### Self-Hosted vLLM on Kubernetes (Helm)",
    ),
  ],
  "ai/change/git-provider": [
    fact(
      "The GitHub App, which needs a public hostname for webhooks",
      GITHUB_INTEGRATION,
      "A public HTTPS hostname for OneUptime that GitHub can reach for webhooks.",
    ),
    fact("GitLab", AI_AGENT, "**GitLab**, on GitLab.com or your own"),
    fact(
      "Forgejo or Gitea",
      AI_AGENT,
      "**Forgejo or Gitea**, on Codeberg or your own",
    ),
    fact(
      "any Git server over HTTPS",
      AI_AGENT,
      "**Any Git server**, over HTTPS",
    ),
  ],
  "ai/change/external-mcp": [
    fact(
      "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true",
      EXTERNAL_MCP,
      "A self-hosted OneUptime reaches private addresses unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` is set.",
    ),
  ],
  "ai/change/mcp-sign-in": [
    fact(
      "on an instance that cannot reach the internet",
      MCP_SERVER,
      "Set to `true` on an instance that cannot reach the internet. A client may identify itself with a URL that OneUptime fetches",
    ),
    fact(
      "mcpOAuth.disableClientIdMetadataDocuments",
      MCP_SERVER,
      "`mcpOAuth.disableClientIdMetadataDocuments`",
    ),
  ],
  "ai/change/model-weights": [
    fact("ollama pull", LLM_PROVIDERS, "Pull a model: `ollama pull llama3.1`"),
    fact(
      "vLLM's first start",
      LLM_PROVIDERS,
      "(the first start downloads the model)",
    ),
  ],
  "ai/step/model": [
    fact(
      "The first start downloads the model",
      LLM_PROVIDERS,
      "(the first start downloads the model)",
    ),
  ],
  "ai/step/values": [
    fact("on NVIDIA GPU nodes", LLM_PROVIDERS, "(it needs NVIDIA GPU nodes)"),
  ],
  "ai/step/upgrade": [
    fact(
      "registered automatically as a Global LLM Provider at startup",
      LLM_PROVIDERS,
      "vLLM is registered automatically as a Global LLM Provider at startup",
    ),
    fact(
      "AI features work for all projects",
      LLM_PROVIDERS,
      "so AI features work for all projects",
    ),
  ],
  "ai/caption": [
    fact(
      "A GPU is mandatory for the official vLLM image.",
      CHART_VALUES,
      "A GPU is mandatory for the official vLLM image.",
    ),
    fact(
      "about 3 GB",
      "HelmChart/Public/oneuptime/docs/ai-vllm.md",
      "Default is small (~3GB), Apache-2.0 and not gated.",
    ),
  ],
  "ai/faq/0": [
    fact(
      "investigations, Ask AI, drafts and fix pull requests",
      LLM_PROVIDERS,
      "investigations, Ask AI, drafts and fix pull requests",
    ),
    fact(
      "With no provider, no AI feature runs",
      LLM_PROVIDERS,
      "Nothing runs, and<br/>the AI pages say<br/>a provider is missing",
    ),
  ],
  "ai/faq/1": [
    fact(
      "With your own LLM provider, local Ollama included, telemetry never leaves your infrastructure.",
      AI_SRE,
      "With your own LLM provider (including local Ollama), telemetry never leaves your infrastructure.",
    ),
  ],
  "ai/faq/2": [
    fact("ollama pull", LLM_PROVIDERS, "Pull a model: `ollama pull llama3.1`"),
    fact(
      "vLLM's first start",
      LLM_PROVIDERS,
      "(the first start downloads the model)",
    ),
  ],
  "ai/faq/3": [
    fact(
      "a small self-hosted model without it answers poorly",
      ASK_AI,
      "a small self-hosted model without reliable tool calling answers poorly.",
    ),
    fact(
      "65,536 tokens is what Ollama recommends for agents",
      LLM_PROVIDERS,
      "65,536 tokens is what Ollama recommends for agents",
    ),
  ],
  "ai/faq/4": [
    fact(
      "cannot acknowledge, resolve, page or modify anything",
      AI_SRE,
      "The AI cannot acknowledge, resolve, page, or modify anything from an investigation.",
    ),
  ],

  // -------------------------------------------------------- SECURITY EVENTS
  "security-events/lead": [
    fact(
      "turns the lines it recognizes into security events",
      SECURITY_START,
      "OneUptime reads the project's new logs every minute and turns the lines it recognizes into security events",
    ),
    fact(
      "Detection rules ship with the install",
      "packages/Common/Types/SecurityEvent/DetectionRuleLibrary.ts",
      "The rule library: ready-made detection rules a project adds with one click",
    ),
  ],
  "security-events/flow": [
    fact("Read every minute", SECURITY_START, "new logs every minute"),
    fact(
      "An HTTPS POST from anything",
      SECURITY_EVENTS,
      "An HTTPS POST, a Fluent Bit output, or a connection to a security product.",
    ),
    fact(
      "Linked to the case",
      SECURITY_CASES,
      "| Escalate | Declare an incident | Opens a OneUptime incident linked to the case |",
    ),
    fact(
      "An escalation step",
      SECURITY_CASES,
      "| Escalate | Page on-call | Runs an on-call policy |",
    ),
  ],
  "security-events/install": [
    COMES_WITH_THE_INSTALL("Security events come with the install"),
    fact(
      "there is no separate edition, image or chart",
      SECURITY_START,
      "Two clicks set it up, and there is nothing to install.",
    ),
  ],
  "security-events/proof/0": [
    fact(
      "Detection rules in the product",
      docs("telemetry/security-cases"),
      "has ready-made detection rules, for identity, endpoint, cloud, network, web and Kubernetes threats.",
    ),
  ],
  "security-events/proof/1": [
    fact(
      "MITRE ATT&CK data built in",
      "packages/Common/Types/SecurityEvent/MitreAttack.ts",
      "MITRE ATT&CK for Enterprise",
    ),
  ],
  "security-events/proof/2": [
    fact(
      "Feeds from your own server",
      THREAT_INTEL,
      "from your own MISP, OpenCTI or OpenTAXII server or a provider",
    ),
  ],
  "security-events/proof/3": [
    fact(
      "Cases and entity risk stay inside",
      docs("telemetry/security-entity-risk"),
      "Entity risk adds up what your detection rules, threat intelligence, connected products and Data Security find",
    ),
  ],
  "security-events/capability/logs": [
    fact(
      "OneUptime reads the project's new logs every minute and turns the lines it recognizes into security events.",
      SECURITY_START,
      "OneUptime reads the project's new logs every minute and turns the lines it recognizes into security events",
    ),
  ],
  "security-events/capability/rules": [
    fact(
      "identity, endpoint, cloud, network, web and Kubernetes threats",
      SECURITY_CASES,
      "has ready-made detection rules, for identity, endpoint, cloud, network, web and Kubernetes threats.",
    ),
  ],
  "security-events/capability/cases": [
    fact(
      "the same user, host or address",
      SECURITY_CASES,
      "with every detection about the same user, host or address grouped into it.",
    ),
  ],
  "security-events/capability/entity-risk": [
    fact(
      "Adds up what your detection rules, threat intelligence, connected products and Data Security find.",
      docs("telemetry/security-entity-risk"),
      "Entity risk adds up what your detection rules, threat intelligence, connected products and Data Security find",
    ),
  ],
  "security-events/capability/threat-intel": [
    fact(
      "your own MISP, OpenCTI or OpenTAXII server",
      THREAT_INTEL,
      "from your own MISP, OpenCTI or OpenTAXII server or a provider",
    ),
    fact(
      "a list at an https address",
      THREAT_INTEL,
      "The address must use `https`",
    ),
  ],
  "security-events/capability/on-network-sources": [
    fact(
      "a search head on your private network",
      docs("integrations/splunk"),
      "can reach a search head on your private network",
    ),
    fact(
      "your own Elastic stack",
      docs("integrations/elastic-security"),
      "on Elastic Cloud or your own Elastic stack",
    ),
  ],
  "security-events/change/cloud-connections": [
    fact(
      "Microsoft Sentinel",
      SECURITY_EVENTS,
      "| Microsoft Sentinel | Incidents, as Incident Findings |",
    ),
    fact(
      "CrowdStrike Falcon",
      SECURITY_EVENTS,
      "| CrowdStrike Falcon | Alerts, as Detection Findings |",
    ),
    fact(
      "poll the product's own service",
      SECURITY_EVENTS,
      "**Connections** polls a security product for you",
    ),
  ],
  "security-events/change/containment": [
    fact(
      "Okta, CrowdStrike, Microsoft Defender, Entra ID and Google",
      SECURITY_CASES,
      "| Contain the host in CrowdStrike, Lift containment in CrowdStrike | CrowdStrike Falcon |",
    ),
    fact(
      "They act through those products",
      SECURITY_CASES,
      "The Contain steps act through a connection that needs more than read access",
    ),
    fact(
      "Page on-call, Email people or Declare an incident",
      SECURITY_CASES,
      "| Notify | Email people | Emails users and teams a summary of the case",
    ),
  ],
  "security-events/change/free-lists": [
    fact(
      "at an https address",
      THREAT_INTEL,
      "For a list, an `https` address that downloads a text file with one indicator a line.",
    ),
    fact(
      "Public lists",
      THREAT_INTEL,
      "Feodo Tracker, Emerging Threats and the Tor exit nodes, in one click.",
    ),
  ],
  "security-events/change/chat-steps": [
    fact(
      "Post to Slack, Post to Microsoft Teams",
      SECURITY_CASES,
      "| Notify | Post to Slack | Posts a summary of the case to a Slack channel |",
    ),
  ],
  "security-events/change/mitre-links": [
    fact(
      "attack.mitre.org",
      SECURITY_CASES,
      "each linked to its page on attack.mitre.org.",
    ),
    fact(
      "from data built into the product",
      "packages/Common/Types/SecurityEvent/MitreAttack.ts",
      "the tactics and parent techniques of the",
    ),
  ],
  "security-events/step/ingestion-key": [INGESTION_KEYS],
  "security-events/step/format": [
    fact(
      "OCSF, Google UDM or generic JSON",
      SECURITY_EVENTS,
      "@tab Generic JSON",
    ),
    fact("Google UDM", SECURITY_EVENTS, "@tab Google UDM"),
  ],
  "security-events/step/post": [
    fact(
      "x-oneuptime-token",
      SECURITY_EVENTS,
      "Send JSON to `/security-events/v1/ingest` with the key in `x-oneuptime-token`:",
    ),
  ],
  "security-events/caption": [
    fact(
      "the same shape, OCSF, whatever format it arrived in",
      SECURITY_EVENTS,
      "gives every one the same shape, [OCSF](https://schema.ocsf.io/) (the Open Cybersecurity Schema Framework), whatever format it arrived in.",
    ),
  ],
  "security-events/faq/0": [
    fact(
      "The rule library and the MITRE ATT&CK data ship with the install",
      "packages/Common/Types/SecurityEvent/DetectionRuleLibrary.ts",
      "The rule library: ready-made detection rules a project adds with one click",
    ),
    fact(
      "the MITRE ATT&CK data",
      "packages/Common/Types/SecurityEvent/MitreAttack.ts",
      "MITRE ATT&CK for Enterprise",
    ),
  ],
  "security-events/faq/1": [
    fact(
      "MISP, OpenCTI or OpenTAXII",
      THREAT_INTEL,
      "from your own MISP, OpenCTI or OpenTAXII server or a provider",
    ),
    fact(
      "Servers that require a TLS client certificate are not supported",
      THREAT_INTEL,
      "Servers that require a TLS client certificate (mutual TLS), such as CISA AIS, are not supported.",
    ),
  ],
  "security-events/faq/2": [
    fact(
      "Splunk Enterprise Security and Elastic Security can be on your own network",
      docs("integrations/splunk"),
      "can reach a search head on your private network",
    ),
  ],
  "security-events/faq/3": [
    fact(
      "The Contain steps act through Okta, CrowdStrike, Microsoft and Google",
      SECURITY_CASES,
      "The Contain steps act through a connection that needs more than read access",
    ),
  ],

  // -------------------------------------------------------------- WORKFLOWS
  "workflows/lead": [
    fact(
      "runbooks run your scripts on a Runner you host",
      RUNBOOK_AGENTS,
      "Run it on a host inside your infrastructure",
    ),
  ],
  "workflows/flow": [
    fact(
      "A record is created, updated or deleted",
      WORKFLOW_TRIGGERS,
      "React when a record is created, updated or deleted.",
    ),
    fact(
      "A cron expression",
      WORKFLOW_TRIGGERS,
      "Run it on a repeating schedule, written as a cron expression.",
    ),
    fact(
      "Another system calls a URL",
      WORKFLOW_TRIGGERS,
      "Let another system start it by calling a URL.",
    ),
    fact(
      "On an incident, at 3am",
      docs("runbooks/index"),
      "a checklist anyone on call can follow at 3am",
    ),
  ],
  "workflows/install": [
    fact(
      "A Runner of your own runs the image you mirrored",
      RUNBOOK_AGENTS,
      "docker pull oneuptime/runner:release",
    ),
  ],
  "workflows/proof/0": [
    fact(
      "Runner needs outbound HTTPS alone",
      RUNBOOK_AGENTS,
      "The Runner only needs **outbound HTTPS** to your OneUptime instance.",
    ),
  ],
  "workflows/proof/1": [
    fact(
      "Mattermost and IRC on your network",
      WORKFLOW_COMPONENTS,
      "on Mattermost Cloud or on a server of your own",
    ),
  ],
  "workflows/proof/2": [
    fact(
      "SSH, Bash and kubectl steps",
      RUNBOOK_AGENTS,
      "When you write a JavaScript, Bash, SSH or kubectl step",
    ),
  ],
  "workflows/proof/3": [
    fact(
      "No run limits when self-hosted",
      WORKFLOWS,
      "Self-hosted installations without billing have neither limit.",
    ),
  ],
  "workflows/capability/triggers": [
    fact(
      "when a record is created, updated or deleted",
      WORKFLOW_TRIGGERS,
      "React when a record is created, updated or deleted.",
    ),
    fact(
      "on a schedule",
      WORKFLOW_TRIGGERS,
      "Run it on a repeating schedule, written as a cron expression.",
    ),
    fact(
      "when another system calls its URL",
      WORKFLOW_TRIGGERS,
      "Let another system start it by calling a URL.",
    ),
  ],
  "workflows/capability/chat": [
    fact(
      "through an incoming webhook",
      WORKFLOW_COMPONENTS,
      "Post a message to a Mattermost channel through an incoming webhook, on Mattermost Cloud or on a server of your own.",
    ),
    fact(
      "on a server of your own",
      WORKFLOW_COMPONENTS,
      "Post a message to an IRC channel on any IRC network: Libera.Chat, OFTC, or a server of your own.",
    ),
  ],
  "workflows/capability/runner": [
    fact(
      "does not accept any inbound connections",
      RUNBOOK_AGENTS,
      "It does not accept any inbound connections.",
    ),
  ],
  "workflows/capability/ssh": [
    fact(
      "a machine only has to be reachable from the Runner",
      RUNBOOK_AUTHORING,
      "The Runner opens the connection, so the machine only has to be reachable from the Runner",
    ),
  ],
  "workflows/capability/http": [
    fact(
      "reach private networks on a self-hosted install, unless you block them",
      RUNBOOK_AUTHORING,
      "A self-hosted OneUptime also reaches private networks, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`.",
    ),
  ],
  "workflows/capability/no-limits": [
    fact(
      "Self-hosted installations without billing have no limit",
      WORKFLOWS,
      "Self-hosted installations without billing have neither limit.",
    ),
  ],
  "workflows/change/private-webhooks": [
    fact(
      "Workflow API, Mattermost and JavaScript requests",
      PRIVATE_NETWORK,
      "- The workflow **Mattermost** component",
    ),
    fact(
      "Private addresses refused",
      PRIVATE_NETWORK,
      "| Workflows, project webhooks, on-call user webhooks | The **API server**'s environment | Private addresses refused |",
    ),
  ],
  "workflows/change/global-runner": [
    fact(
      "Reaches public internet addresses only",
      RUNBOOK_AGENTS,
      "Its HTTP requests reach public internet addresses only",
    ),
    fact(
      "bind steps to it",
      RUNBOOK_AGENTS,
      "you pick the Runner from a dropdown under the step's **More fields**",
    ),
  ],
  "workflows/change/javascript-steps": [
    fact(
      "A JavaScript step cannot reach a private address, even on your own Runner",
      RUNBOOK_AGENTS,
      "it can call public HTTP APIs with `axios`, but not addresses on a private network",
    ),
    fact(
      "Use a Bash step with curl",
      RUNBOOK_AUTHORING,
      "use a [Bash](#bash) step with `curl`.",
    ),
  ],
  "workflows/change/cloud-chat-steps": [
    fact(
      "Slack, Microsoft Teams and Discord steps",
      WORKFLOW_COMPONENTS,
      "It must start with `https://hooks.slack.com/services/`.",
    ),
  ],
  "workflows/change/email-trigger": [
    fact(
      "SendGrid, which has to connect to your install",
      SENDGRID,
      "Inbound Parse requires SendGrid to initiate a connection to OneUptime.",
    ),
    fact(
      "let the other system call a URL",
      WORKFLOW_TRIGGERS,
      "Let another system start it by calling a URL.",
    ),
  ],
  "workflows/step/create": [
    fact(
      "Show setup instructions",
      RUNBOOK_AGENTS,
      "On the Runner's row, click **Show setup instructions**.",
    ),
  ],
  "workflows/step/run": [
    fact(
      "reach other hosts over SSH",
      RUNBOOK_AGENTS,
      "do what your steps need to do, such as reach other hosts over SSH",
    ),
  ],
  "workflows/step/bind": [
    fact(
      "make it the project's default",
      RUNBOOK_AGENTS,
      "A step that picks none runs on the project's default Runner, if you set one",
    ),
  ],
  "workflows/caption": [
    fact(
      "every 5 seconds",
      RUNBOOK_AGENTS,
      "The Runner asks OneUptime for work every 5 seconds",
    ),
  ],
  "workflows/faq/0": [
    fact(
      "API, Mattermost and JavaScript blocks reach private addresses once you allow them",
      PRIVATE_NETWORK,
      "- Workflow **API** components (GET / POST / PUT / PATCH / DELETE)",
    ),
  ],
  "workflows/faq/1": [
    fact(
      "the machine only has to be reachable from the Runner",
      RUNBOOK_AUTHORING,
      "so the machine only has to be reachable from the Runner",
    ),
    fact(
      "A global Runner never reaches your network",
      RUNBOOK_AGENTS,
      "so a global Runner never reaches your network",
    ),
  ],
  "workflows/faq/2": [
    fact(
      "A request to a private network is refused, even on your own Runner",
      RUNBOOK_AUTHORING,
      "a request to a private network, to the Runner's own host or to a cloud metadata endpoint is refused.",
    ),
  ],
  "workflows/faq/3": [
    fact(
      "another system on your network calls the workflow's URL",
      WORKFLOW_TRIGGERS,
      "Let another system start it by calling a URL.",
    ),
    fact(
      "The Incoming Email trigger needs SendGrid to reach your install",
      SENDGRID,
      "Inbound Parse requires SendGrid to initiate a connection to OneUptime.",
    ),
  ],
};

// Every place on a page that needs evidence, as an EVIDENCE key.
function keysOf(page: AirGappedTopicPage): Array<string> {
  return [
    `${page.slug}/lead`,
    `${page.slug}/flow`,
    `${page.slug}/install`,
    `${page.slug}/caption`,
    ...page.proofPoints.map((_point: string, index: number): string => {
      return `${page.slug}/proof/${index}`;
    }),
    ...page.inside.capabilities.map(
      (capability: AirGappedTopicCapability): string => {
        return `${page.slug}/capability/${capability.key}`;
      },
    ),
    ...page.changes.rows.map((change: AirGappedTopicChange): string => {
      return `${page.slug}/change/${change.key}`;
    }),
    ...page.configure.steps.map((step: AirGappedTopicConfigureStep): string => {
      return `${page.slug}/step/${step.key}`;
    }),
    ...page.faqs.map((_faq: AirGappedTopicFaq, index: number): string => {
      return `${page.slug}/faq/${index}`;
    }),
  ];
}

function flowWords(page: AirGappedTopicPage): string {
  return [
    ...page.flow.from.items,
    ...page.flow.to.items,
    ...page.flow.oneUptime.items,
  ]
    .map((item: { label: string; detail?: string }): string => {
      return `${item.label} ${item.detail || ""}`;
    })
    .concat(page.flow.oneUptime.detail)
    .join(" ");
}

// The words on the page at an EVIDENCE key, with no code marks.
function wordsAt(key: string): string {
  const [slug, part, which] = key.split("/") as [
    AirGappedTopicSlug,
    string,
    string,
  ];
  const page: AirGappedTopicPage = getAirGappedTopicPage(slug);
  const index: number = Number(which);

  const words: Record<string, () => string> = {
    lead: (): string => {
      return page.lead;
    },
    flow: (): string => {
      return flowWords(page);
    },
    install: (): string => {
      return page.installNote;
    },
    caption: (): string => {
      return page.configure.caption;
    },
    proof: (): string => {
      return page.proofPoints[index]!;
    },
    capability: (): string => {
      const capability: AirGappedTopicCapability =
        page.inside.capabilities.find(
          (entry: AirGappedTopicCapability): boolean => {
            return entry.key === which;
          },
        )!;

      return `${capability.title} ${capability.description}`;
    },
    change: (): string => {
      const change: AirGappedTopicChange = page.changes.rows.find(
        (entry: AirGappedTopicChange): boolean => {
          return entry.key === which;
        },
      )!;

      return `${change.name} ${change.usually} ${change.inside}`;
    },
    step: (): string => {
      const step: AirGappedTopicConfigureStep = page.configure.steps.find(
        (entry: AirGappedTopicConfigureStep): boolean => {
          return entry.key === which;
        },
      )!;

      return `${step.title} ${step.description}`;
    },
    faq: (): string => {
      const faq: AirGappedTopicFaq = page.faqs[index]!;

      return `${faq.question} ${faq.answer}`;
    },
  };

  return plainText(words[part]!());
}

describe("every sentence on the air-gapped product pages has evidence", () => {
  test.each(
    AirGappedTopicPages.map((page: AirGappedTopicPage) => {
      return [page.slug, page];
    }) as Array<[string, AirGappedTopicPage]>,
  )(
    "%s names what backs each of its statements",
    (_slug: string, page: AirGappedTopicPage) => {
      const missing: Array<string> = keysOf(page).filter(
        (key: string): boolean => {
          return !EVIDENCE[key] || EVIDENCE[key]!.length === 0;
        },
      );

      expect(missing).toEqual([]);
    },
  );

  test("every entry belongs to something a page says", () => {
    const known: Set<string> = new Set<string>(
      AirGappedTopicPages.flatMap(keysOf),
    );
    const orphans: Array<string> = Object.keys(EVIDENCE).filter(
      (key: string): boolean => {
        return !known.has(key);
      },
    );

    expect(orphans).toEqual([]);
  });

  test("the table is not empty: the walk above checks something", () => {
    expect(Object.keys(EVIDENCE).length).toBeGreaterThan(250);
  });
});

describe.each(Object.entries(EVIDENCE))(
  "%s",
  (key: string, evidence: Array<Evidence>) => {
    test.each(evidence)(
      '$file says what "$claim" rests on',
      (entry: Evidence) => {
        // The page still makes the claim, and the file still backs it.
        expect([key, entry.claim, wordsAt(key).includes(entry.claim)]).toEqual([
          key,
          entry.claim,
          true,
        ]);
        expect([
          entry.file,
          entry.says,
          repoFile(entry.file).includes(entry.says),
        ]).toEqual([entry.file, entry.says, true]);
      },
    );
  },
);

// ------------------------------------------------------------------ the code

function configureCode(slug: AirGappedTopicSlug): Array<string> {
  return getAirGappedTopicPage(slug).configure.code.text.split("\n");
}

function linesOf(relativePath: string): Set<string> {
  return new Set<string>(
    repoFile(relativePath)
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      }),
  );
}

// Lines of a YAML file without its comment lines, trimmed.
function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trimStart().startsWith("#");
    })
    .join("\n")
    .trim();
}

function expectLinesIn(
  relativePath: string,
  lines: Array<string>,
  fromPage: (line: string) => string = (line: string): string => {
    return line;
  },
): void {
  const known: Set<string> = linesOf(relativePath);

  for (const line of lines) {
    expect([relativePath, line, known.has(fromPage(line).trim())]).toEqual([
      relativePath,
      line,
      true,
    ]);
  }
}

// A page shows its own host and registry where the docs show oneuptime.com's.
function asTheDocsWriteIt(line: string): string {
  return line
    .split("https://oneuptime.example.com")
    .join("https://oneuptime.com")
    .split("registry.example.com/oneuptime/")
    .join("oneuptime/");
}

describe("the code each page shows is the code the docs and the chart give", () => {
  test("observability: the docs' environment, at your own host", () => {
    const [endpoint, ...rest] = configureCode("observability") as [
      string,
      ...Array<string>,
    ];

    expect(endpoint).toContain("https://YOUR-ONEUPTIME-HOST/otlp");
    expectLinesIn(OPENTELEMETRY, rest);
  });

  test("log management: the docs' Fluent Bit output for an install on plain HTTP", () => {
    expectLinesIn(FLUENT_BIT, configureCode("log-management"));
  });

  test("monitoring: the docs' docker run, from your registry, allowed private addresses", () => {
    const lines: Array<string> = configureCode("monitoring");
    const allow: string = "  -e PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true \\";

    expect(lines).toContain(allow);
    expectLinesIn(
      CUSTOM_PROBE,
      lines.filter((line: string): boolean => {
        return line !== allow;
      }),
      asTheDocsWriteIt,
    );
  });

  test("incident management: the docs' values for a chat server on the network", () => {
    expectLinesIn(PRIVATE_NETWORK, configureCode("incident-management"));
  });

  test("on-call: what a gateway receives, line for line from the docs", () => {
    const lines: Array<string> = configureCode("on-call");

    expectLinesIn(GATEWAY, lines);
    // The excerpt is still JSON, once the docs' elisions are read as text.
    expect((): void => {
      JSON.parse(lines.join("\n"));
    }).not.toThrow();
  });

  test("status pages: the docs' values for the CNAME record", () => {
    expectLinesIn(BRANDING, configureCode("status-pages"));
  });

  test("kubernetes: exactly the values the chart's suite renders", () => {
    expect(getAirGappedTopicPage("kubernetes").configure.code.text).toBe(
      withoutComments(repoFile(AGENT_AIR_GAPPED_VALUES)),
    );
  });

  test("network monitoring: the docs' Compose file, from your registry", () => {
    expectLinesIn(
      CUSTOM_PROBE,
      configureCode("network-monitoring"),
      asTheDocsWriteIt,
    );
  });

  test("infrastructure: the docs' command, from your install, with a mirror", () => {
    const command: string = getAirGappedTopicPage(
      "infrastructure",
    ).configure.code.text.replace(/\s*\\\n\s*/g, " ");
    const [install, mirror] = command.split(" --download-url ") as [
      string,
      string,
    ];

    expect(repoFile(HOSTS)).toContain(asTheDocsWriteIt(install));
    expect(mirror).toContain("/releases/download");
  });

  test("ai: the docs' values for vLLM", () => {
    expectLinesIn(LLM_PROVIDERS, configureCode("ai"));
  });

  test("security events: the docs' request, to your own install", () => {
    const lines: Array<string> = configureCode("security-events");

    expectLinesIn(SECURITY_EVENTS, lines.slice(0, -1), asTheDocsWriteIt);
    expect(lines[lines.length - 1]).toBe("  -d @events.json");
  });

  test("workflows: the docs' docker run, from your registry", () => {
    expectLinesIn(RUNBOOK_AGENTS, configureCode("workflows"), asTheDocsWriteIt);
  });
});

// --------------------------------------------------- facts that take more than a phrase

describe("what the pages say the agent chart does", () => {
  test("one template takes a pull secret: the AI agent's", () => {
    const templates: string = path.join(REPO_ROOT, AGENT_CHART_TEMPLATES);
    const withPullSecrets: Array<string> = fs
      .readdirSync(templates)
      .filter((name: string): boolean => {
        return fs
          .readFileSync(path.join(templates, name), "utf8")
          .includes("imagePullSecrets");
      });

    expect(withPullSecrets).toEqual(["ai-agent.yaml"]);
  });

  test("no value of the agent chart names a CA bundle or one registry", () => {
    const values: string = repoFile(AGENT_VALUES);

    expect(values).not.toMatch(/^registry:/m);
    expect(values).not.toContain("caBundle");
    expect(values).not.toContain("NODE_EXTRA_CA_CERTS");
  });

  test("every repository the page says to mirror is a value of the chart", () => {
    const values: string = repoFile(AGENT_VALUES);

    for (const repository of [
      "otel/opentelemetry-collector-contrib",
      "otel/ebpf-instrument",
      "oneuptime/kubernetes-ai-agent",
    ]) {
      expect(values).toContain(`repository: ${repository}\n`);
      expect(getAirGappedTopicPage("kubernetes").configure.code.text).toContain(
        `repository: registry.example.com/${repository}`,
      );
    }
  });

  test("the values file's keys sit where the agent chart reads them", () => {
    const values: string = repoFile(AGENT_VALUES);

    expect(values).toContain(
      "image:\n  repository: otel/opentelemetry-collector-contrib",
    );
    expect(values).toContain("ebpf:\n");
    expect(values).toContain("aiAgent:\n");
  });
});

describe("what the infrastructure page says about downloads", () => {
  const collector: string =
    "packages/App/FeatureSet/Docs/Static/scripts/host-collector/install.sh";
  const olderAgent: string =
    "packages/App/FeatureSet/Docs/Static/scripts/infrastructure-agent/install.sh";

  test("the host collector takes a mirror, and checks what it downloads", () => {
    expect(repoFile(collector)).toContain("--download-url)");
    expect(repoFile(collector)).toContain('"$url.sha256"');
  });

  test("the older agent's installer has no mirror option, as the page says", () => {
    const script: string = repoFile(olderAgent);

    expect(script).toContain("api.github.com");
    expect(script).not.toContain("--download-url");
    expect(script).not.toContain("mirror");
  });
});

describe("what the pages say about SMS, calls and editions", () => {
  test("Twilio and a gateway are the two providers a server can send through", () => {
    expect(CALL_AND_SMS_PROVIDERS).toEqual([
      CallAndSmsProvider.Twilio,
      CallAndSmsProvider.Gateway,
    ]);
  });

  test("the gateway's code lives in the core, and asks for no license", () => {
    for (const file of [
      "packages/Common/Types/CallAndSMS/CallAndSmsProvider.ts",
      "packages/Common/Server/Utils/CallAndSmsGatewayConfig.ts",
      "packages/App/FeatureSet/Notification/Services/CallAndSmsGatewayService.ts",
    ]) {
      const source: string = repoFile(file);

      // The words any gate would use: the page says every edition has it.
      for (const word of [
        "EnterpriseFeature",
        "EnterpriseEdition",
        "License",
      ]) {
        expect([file, word, source.includes(word)]).toEqual([
          file,
          word,
          false,
        ]);
      }
    }
  });

  test("custom channels are the Enterprise Edition's, and the page says so everywhere it names them", () => {
    const page: AirGappedTopicPage = getAirGappedTopicPage("on-call");

    expect(
      page.inside.capabilities.find(
        (entry: AirGappedTopicCapability): boolean => {
          return entry.key === "custom-channels";
        },
      )!.description,
    ).toContain("With the Enterprise Edition");
    expect(page.flow.to.items[3]!.detail).toContain("Enterprise Edition");
    expect(page.faqs[1]!.answer).toContain(
      "part of the Enterprise Edition and need an Enterprise license",
    );
  });

  test("the docs agree with the page: SMS and calls need Twilio or a gateway", () => {
    expect(repoFile(docs("notifications/notification-methods"))).toContain(
      "SMS and calls also need a Twilio account or a gateway you run",
    );
    expect(repoFile(docs("on-call/escalation-rules"))).toContain(
      "needs a Twilio account, an SMS and call gateway or a Telegram bot",
    );
  });
});

describe("the monitor types and providers the pages name exist", () => {
  test("every monitor the monitoring page names is a monitor type", () => {
    expect([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.DNS,
      MonitorType.SSLCertificate,
      MonitorType.SQLQuery,
      MonitorType.SyntheticMonitor,
    ]).toEqual([
      "Website",
      "API",
      "Ping",
      "Port",
      "DNS",
      "SSL Certificate",
      "SQL Query",
      "Synthetic Monitor",
    ]);
  });

  test("every hosted provider the AI page names is a provider type", () => {
    expect(Object.values(LlmType)).toEqual(
      expect.arrayContaining([
        LlmType.OpenAI,
        LlmType.Anthropic,
        LlmType.Ollama,
        LlmType.OpenAICompatible,
      ]),
    );
  });

  test("the AI page's safety line agrees with the governed claim", () => {
    const claim: Claim = getClaim("encryption-secrets-redaction")!;

    expect(claim.statement).toContain(
      "AI investigations are read-only and secrets are redacted before anything reaches a model.",
    );
    expect(getAirGappedTopicPage("ai").lead).toContain(
      "Investigations are read-only, and secrets are redacted before anything reaches the model.",
    );
  });

  test("the air-gapped claim is still what the pages do: an internal equivalent, or off", () => {
    const claim: Claim = getClaim("deployment-air-gapped")!;

    expect(claim.qualifier).toContain(
      "need an internal equivalent or must stay off",
    );
  });
});
