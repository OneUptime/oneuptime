/*
 * Per-resource-type "how to send telemetry" markdown for the in-app
 * Documentation tab. Each builder receives the project's OneUptime URL and
 * the selected ingestion key so the snippets are copy-paste ready.
 */
export interface DocVars {
  oneuptimeUrl: string;
  apiKey: string;
}

export const getServerlessDocMarkdown: (vars: DocVars) => string = (
  vars: DocVars,
): string => {
  return [
    "## Send telemetry from your serverless functions",
    "",
    "OneUptime auto-discovers a **Serverless Function** as soon as it receives",
    "telemetry tagged with the `faas.name` resource attribute. Instrument your",
    "function with the OpenTelemetry SDK for your runtime and export OTLP to",
    "OneUptime.",
    "",
    "### 1. Set resource attributes",
    "",
    "| Attribute | Required | Example |",
    "| --- | --- | --- |",
    "| `faas.name` | yes | `checkout-handler` |",
    "| `faas.version` | no | `1.4.2` |",
    "| `faas.instance` | no | per-instance id (shows under Instances) |",
    "| `cloud.platform` | no | `aws_lambda`, `gcp_cloud_functions`, `azure_functions` |",
    "| `cloud.region` | no | `us-east-1` |",
    "",
    "### 2. Point the OTLP exporter at OneUptime",
    "",
    "Most language auto-instrumentations read these environment variables:",
    "",
    "```bash",
    `OTEL_EXPORTER_OTLP_ENDPOINT="${vars.oneuptimeUrl}/otlp"`,
    `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${vars.apiKey}"`,
    `OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"`,
    "```",
    "",
    "### 3. Deploy",
    "",
    "Once the function emits a span, log or metric it appears under **Serverless",
    "Functions**. The overview shows invocations, error rate and p95 duration",
    "derived from your traces.",
  ].join("\n");
};

export const getCloudDocMarkdown: (vars: DocVars) => string = (
  vars: DocVars,
): string => {
  return [
    "## Connect a managed cloud environment",
    "",
    "OneUptime groups managed compute (AWS ECS / Fargate, Google Cloud Run,",
    "Azure Container Apps, Elastic Beanstalk, App Runner, ...) into a **Cloud",
    "Environment** — one per `cloud.platform` + `cloud.account.id` +",
    "`cloud.region`.",
    "",
    "### 1. Enable the cloud resource detector",
    "",
    "OpenTelemetry SDKs and the Collector ship resource detectors that fill in",
    "`cloud.platform`, `cloud.account.id` and `cloud.region` automatically:",
    "",
    "- AWS ECS / Fargate: `OTEL_RESOURCE_DETECTORS=env,ecs` (or the Collector",
    "  `resourcedetection` processor with `detectors: [ecs]`)",
    "- Google Cloud Run: `detectors: [gcp]`",
    "- Azure Container Apps: `detectors: [azure]`",
    "",
    "### 2. Export OTLP to OneUptime",
    "",
    "```yaml",
    "exporters:",
    "  otlphttp/oneuptime:",
    `    endpoint: ${vars.oneuptimeUrl}/otlp`,
    "    headers:",
    `      x-oneuptime-token: ${vars.apiKey}`,
    "```",
    "",
    "### 3. View",
    "",
    "Workloads running on this environment show up grouped here. The overview",
    "shows CPU and memory per task (from container metrics) and request volume",
    "from your traces.",
  ].join("\n");
};

export const getRumDocMarkdown: (vars: DocVars) => string = (
  vars: DocVars,
): string => {
  return [
    "## Instrument a browser or mobile app",
    "",
    "OneUptime classifies telemetry as **RUM** when it carries client",
    "attributes (`browser.*` or `device.*`). The application is identified by",
    "`service.name`, and its telemetry is owned by this RUM application (it is",
    "never duplicated as a backend Service).",
    "",
    "### Browser (OpenTelemetry Web)",
    "",
    "Configure the OTLP/HTTP exporter to send to OneUptime:",
    "",
    "```js",
    "// Resource attributes identify the app:",
    "//   service.name           = storefront-web",
    "//   telemetry.sdk.language = webjs",
    "// OTLP/HTTP exporter:",
    `//   url:     ${vars.oneuptimeUrl}/otlp/v1/traces`,
    `//   headers: { "x-oneuptime-token": "${vars.apiKey}" }`,
    "```",
    "",
    "### Mobile (Swift / Android)",
    "",
    "Use the OpenTelemetry Swift or Android SDK, set `service.name`, and export",
    "OTLP to OneUptime:",
    "",
    "```bash",
    `OTEL_EXPORTER_OTLP_ENDPOINT="${vars.oneuptimeUrl}/otlp"`,
    `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${vars.apiKey}"`,
    "```",
    "",
    "The `device.*` attributes the mobile SDK adds route the telemetry to RUM",
    "automatically. Once events arrive, the app appears under **RUM** with page",
    "views, error rate and p95 duration.",
  ].join("\n");
};
