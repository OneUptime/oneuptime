import {
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  getManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";

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
    "> **This token is a secret.** Use a **Server** ingestion key here and set it",
    "> as a function environment variable. A key that reaches a browser can be",
    "> read by anyone who views the page source; for anything running in a",
    "> browser, create a **Browser** ingestion key instead.",
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

/*
 * ---------------------------------------------------------------------------
 * Cloud Environments
 * ---------------------------------------------------------------------------
 *
 * One condensed guide per managed platform. The docs pages carry the full
 * artefacts (a whole ECS task definition, the Cloud Run service YAML, the
 * Container Apps YAML); the in-app version is the part people need while
 * the console is open in the next tab — where the settings go, the one or
 * two snippets to paste, the IAM / networking that has to be in place, and
 * how to check it worked — with the endpoint and token already filled in.
 *
 * Platform facts (labels, `cloud.platform` values, docs URLs, the instance
 * identity attribute) come from the shared registry so the guide can never
 * name a platform ingest does not accept, or link to a page that moved.
 */

type CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
) => Array<string>;

/*
 * The host part of the OneUptime URL, for the "allow egress to ..." lines.
 * The URL is either a real origin or the "<YOUR_ONEUPTIME_URL>" placeholder
 * ResourceDocumentationCard substitutes when HOST is unset; the placeholder
 * has no scheme, so it is returned unchanged.
 */
const oneuptimeHost: (vars: DocVars) => string = (vars: DocVars): string => {
  return vars.oneuptimeUrl.replace(/^https?:\/\//, "");
};

const tokenIsSecretNote: (store: string) => Array<string> = (
  store: string,
): Array<string> => {
  return [
    `> **This token is a secret.** Use a **Server** ingestion key and keep it in ${store},`,
    "> referenced from the container as a secret-backed environment variable. A",
    "> token typed into a plain environment variable is readable by everyone",
    "> who can view the configuration. Never put a Server key in browser",
    "> JavaScript — a **Browser** ingestion key exists for that.",
  ];
};

/*
 * SDKs read OTEL_EXPORTER_OTLP_HEADERS as a whole "name=value" pair and the
 * platforms inject a secret's value verbatim, so the secret has to hold the
 * complete header for the SDK-direct shape. The collector shape keeps the
 * bare token because the YAML supplies the header name.
 */
const headerSecretNote: (vars: DocVars) => Array<string> = (
  vars: DocVars,
): Array<string> => {
  return [
    "The platform injects the secret's value verbatim and",
    "`OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair, so for the",
    "SDK-direct shape store the secret as the complete header",
    `\`x-oneuptime-token=${vars.apiKey}\`. For the sidecar shape store just the`,
    "token.",
  ];
};

const sdkEnvBlock: (
  endpoint: string,
  extraLines: Array<string>,
) => Array<string> = (
  endpoint: string,
  extraLines: Array<string>,
): Array<string> => {
  return [
    "```bash",
    "OTEL_SERVICE_NAME=checkout-api",
    `OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`,
    "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
    ...extraLines,
    "```",
  ];
};

const sdkDirectHeaderLine: (vars: DocVars) => string = (
  vars: DocVars,
): string => {
  return `OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${vars.apiKey}`;
};

/*
 * A sidecar collector configuration. `detectorsLine` is the whole
 * `detectors:` value; `extraReceivers` / `extraProcessors` / the metric
 * receiver list let ECS add the container-metrics receiver and Azure add the
 * resource processor without each guide re-typing the pipeline.
 */
const collectorConfigBlock: (data: {
  vars: DocVars;
  detectorsLine: string;
  detectorComment: string;
  extraReceiverLines?: Array<string>;
  detectorExtraLines?: Array<string>;
  extraProcessorLines?: Array<string>;
  metricReceivers?: string;
  processorList?: string;
}) => Array<string> = (data: {
  vars: DocVars;
  detectorsLine: string;
  detectorComment: string;
  extraReceiverLines?: Array<string>;
  detectorExtraLines?: Array<string>;
  extraProcessorLines?: Array<string>;
  metricReceivers?: string;
  processorList?: string;
}): Array<string> => {
  const processors: string = data.processorList || "[resourcedetection, batch]";
  return [
    "```yaml",
    "receivers:",
    "  otlp:",
    "    protocols:",
    "      http:",
    "        endpoint: 0.0.0.0:4318",
    "      grpc:",
    "        endpoint: 0.0.0.0:4317",
    ...(data.extraReceiverLines || []),
    "processors:",
    `  # ${data.detectorComment}`,
    "  resourcedetection:",
    `    detectors: ${data.detectorsLine}`,
    "    timeout: 5s",
    ...(data.detectorExtraLines || []),
    ...(data.extraProcessorLines || []),
    "  batch: {}",
    "exporters:",
    "  otlphttp/oneuptime:",
    `    endpoint: ${data.vars.oneuptimeUrl}/otlp`,
    "    headers:",
    "      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}",
    "service:",
    "  pipelines:",
    "    traces:",
    "      receivers: [otlp]",
    `      processors: ${processors}`,
    "      exporters: [otlphttp/oneuptime]",
    "    metrics:",
    `      receivers: ${data.metricReceivers || "[otlp]"}`,
    `      processors: ${processors}`,
    "      exporters: [otlphttp/oneuptime]",
    "    logs:",
    "      receivers: [otlp]",
    `      processors: ${processors}`,
    "      exporters: [otlphttp/oneuptime]",
    "```",
  ];
};

const verifySection: (vars: DocVars, stepNumber: number) => Array<string> = (
  vars: DocVars,
  stepNumber: number,
): Array<string> => {
  return [
    `### ${stepNumber}. Verify`,
    "",
    "Check the token first — it is the cheapest check and it invalidates",
    'everything after it. `200` with `"valid": true` means the token resolves',
    "to this project; `401` means it is unknown, revoked or mistyped:",
    "",
    "```bash",
    `curl -i ${vars.oneuptimeUrl}/otlp/v1/validate \\`,
    `  -H "x-oneuptime-token: ${vars.apiKey}"`,
    "```",
    "",
    "Run it from inside the workload when you can, so it proves egress from",
    "where the exporter runs. Then send one request and look for the",
    "environment at **Cloud → All Environments** — it appears within a minute of",
    "the first span, log or metric.",
  ];
};

const whatYouGetSection: (
  descriptor: ManagedCloudPlatformDescriptor,
  cpuMemoryLine: string,
) => Array<string> = (
  descriptor: ManagedCloudPlatformDescriptor,
  cpuMemoryLine: string,
): Array<string> => {
  return [
    "### What fills in",
    "",
    "- **Overview** — requests, error rate and p95 latency from traces.",
    `- **Instances** — one row per running instance, named from \`${descriptor.instanceAttribute}\` (the platform's own identity), or from \`service.instance.id\` when the platform sets none.`,
    `- **CPU / Memory** tiles — ${cpuMemoryLine}`,
    "- **Logs**, **Traces** and **Metrics** tabs scoped to the environment, and the per-service view under **Services**.",
  ];
};

const footerSection: (
  descriptor: ManagedCloudPlatformDescriptor,
) => Array<string> = (
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    `Full guide with the complete artefacts: [${descriptor.productName}](${descriptor.docsUrl}).`,
    "Something not showing up? [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting).",
  ];
};

const introSection: (
  descriptor: ManagedCloudPlatformDescriptor,
  exampleName: string,
  unitNoun: string,
) => Array<string> = (
  descriptor: ManagedCloudPlatformDescriptor,
  exampleName: string,
  unitNoun: string,
): Array<string> => {
  return [
    `## Connect ${descriptor.productName}`,
    "",
    `OneUptime groups every ${unitNoun} that reports \`cloud.platform=${descriptor.platform}\``,
    "into one **Cloud Environment** per account and region — for example",
    `_${exampleName}_. Services keep their own rows under **Services**; the`,
    "environment is the roll-up, and its **Instances** tab lists what is running.",
  ];
};

const buildAwsEcsGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "AWS ECS · us-east-1 · 123456789012",
      "ECS task",
    ),
    "",
    "Two shapes. **A — the SDK exports straight to OneUptime**: enable the AWS",
    "resource detector in the SDK; no extra container, no per-task CPU / memory.",
    "**B — a sidecar OpenTelemetry Collector** in the task: the app exports to",
    "`localhost`, the collector stamps `cloud.*` on everything and ships per-task",
    "CPU / memory. Most teams end up on B.",
    "",
    "### 1. Store the token in Secrets Manager",
    "",
    ...tokenIsSecretNote("AWS Secrets Manager"),
    "",
    "```bash",
    "aws secretsmanager create-secret \\",
    "  --name oneuptime/ingestion-token \\",
    `  --secret-string "${vars.apiKey}"`,
    "```",
    "",
    ...headerSecretNote(vars),
    "",
    "### 2. Update the task definition",
    "",
    "1. **AWS Console → Amazon Elastic Container Service → Task definitions** → select the family → **Create new revision**.",
    "2. Under your application container, expand **Environment variables** and add the variables below. Shape A only: `OTEL_EXPORTER_OTLP_HEADERS` with **Value type: ValueFrom** and the secret ARN, plus the detector switch for your language.",
    "3. Shape B: **+ Add container** → name `otel-collector`, image `otel/opentelemetry-collector-contrib:latest`, **Essential: No**, **Docker configuration → Command** `--config=env:OTEL_COLLECTOR_CONFIG`.",
    "4. On the collector container add environment variable `ONEUPTIME_TOKEN` with **Value type: ValueFrom** → the secret ARN, and `OTEL_COLLECTOR_CONFIG` with **Value type: Value** → the YAML below.",
    "5. Under **Startup dependency ordering** on the app container add `otel-collector`, condition **Start**.",
    "6. **Create**, then **Clusters → your cluster → Services → Update → Task definition revision: latest → Deploy**.",
    "",
    "Application container, Shape B (with a sidecar) — in `awsvpc` mode every container in the task shares `localhost`:",
    "",
    ...sdkEnvBlock("http://localhost:4318", []),
    "",
    "Application container, Shape A (SDK direct):",
    "",
    ...sdkEnvBlock(`${vars.oneuptimeUrl}/otlp`, [
      "# Injected from Secrets Manager (secrets / valueFrom), not typed here.",
      sdkDirectHeaderLine(vars),
      "# Node.js — other languages: Python OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs",
      "# (opentelemetry-sdk-extension-aws); Java -Dotel.resource.providers.aws.enabled=true;",
      "# Go go.opentelemetry.io/contrib/detectors/aws/ecs; .NET OpenTelemetry.Resources.AWS AddAWSECSDetector()",
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
    ]),
    "",
    "### 3. Sidecar collector configuration (Shape B)",
    "",
    "Passed to the collector as the `OTEL_COLLECTOR_CONFIG` environment variable;",
    "`${env:ONEUPTIME_TOKEN}` is expanded by the collector from the secret ECS",
    "injects. Neither the `ecs` detector nor the `awsecscontainermetrics` receiver",
    "needs IAM — both read the task metadata endpoint ECS gives every container.",
    "",
    ...collectorConfigBlock({
      vars: vars,
      detectorsLine: "[env, ecs]",
      detectorComment:
        "Stamps cloud.platform=aws_ecs, cloud.account.id, cloud.region and aws.ecs.task.arn on everything.",
      extraReceiverLines: [
        "  # Per-task CPU / memory from the task metadata endpoint — fills the tiles.",
        "  awsecscontainermetrics:",
        "    collection_interval: 20s",
      ],
      metricReceivers: "[otlp, awsecscontainermetrics]",
    }),
    "",
    "### 4. IAM and networking checklist",
    "",
    "- The **task execution role** needs `secretsmanager:GetSecretValue` on the secret (and `kms:Decrypt` on its key if it is customer-managed). Without it the task sticks in `PENDING` with `unable to pull secrets`.",
    "- **Fargate tasks in private subnets** need a NAT gateway on the route table, or `assignPublicIp=ENABLED` in a public subnet — Secrets Manager and OneUptime are both outside the VPC.",
    `- **Security group egress** must allow TCP 443 to \`${oneuptimeHost(vars)}\`. No inbound rule is needed.`,
    "- Nothing else: the ECS detector and the container-metrics receiver use the local metadata endpoint.",
    "",
    ...verifySection(vars, 5),
    "",
    ...whatYouGetSection(
      descriptor,
      "from the `awsecscontainermetrics` receiver's `ecs.task.cpu.utilized` / `ecs.task.memory.utilized` (Shape B only; Shape A ships no container metrics).",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildGcpCloudRunGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "GCP Cloud Run · us-central1 · my-project",
      "Cloud Run service or job",
    ),
    "",
    "The GCP resource detector sets `cloud.platform=gcp_cloud_run`, the project",
    "as `cloud.account.id`, `cloud.region`, and — because it also sets",
    "`faas.name` / `faas.instance` — each service appears under **Serverless",
    "Functions** on its own too. The environment is the roll-up of the project",
    "and region; nothing is duplicated.",
    "",
    "### 1. Store the token in Secret Manager",
    "",
    ...tokenIsSecretNote("Secret Manager"),
    "",
    "```bash",
    "# Bare token — the sidecar collector (Shape B) reads it.",
    `printf '%s' "${vars.apiKey}" | gcloud secrets create oneuptime-ingestion-token --data-file=-`,
    "# Whole header — the SDK-direct shape (Shape A) binds it to OTEL_EXPORTER_OTLP_HEADERS.",
    `printf '%s' "x-oneuptime-token=${vars.apiKey}" | gcloud secrets create oneuptime-otlp-headers --data-file=-`,
    "for s in oneuptime-ingestion-token oneuptime-otlp-headers; do",
    '  gcloud secrets add-iam-policy-binding "$s" \\',
    '    --member="serviceAccount:checkout-api@my-project.iam.gserviceaccount.com" \\',
    '    --role="roles/secretmanager.secretAccessor"',
    "done",
    "```",
    "",
    ...headerSecretNote(vars),
    "",
    "### 2. Edit the service in the console",
    "",
    "1. **Google Cloud console → Cloud Run → click the service → Edit & deploy new revision**.",
    "2. **Containers** tab → your container → **Variables & Secrets**: add the variables below. Shape A: **Reference a secret** → `oneuptime-otlp-headers` (the whole-header secret), version `latest`, exposed as environment variable `OTEL_EXPORTER_OTLP_HEADERS`; add the detector switch for your language.",
    "3. Shape B: **+ Add container** → image `otel/opentelemetry-collector-contrib:latest`, argument `--config=env:OTEL_COLLECTOR_CONFIG`; **Variables & Secrets** → reference the secret as `ONEUPTIME_TOKEN` and add `OTEL_COLLECTOR_CONFIG` with the YAML below; **Settings** → startup probe HTTP `/` port `13133`, and **Container start-up order** → the app depends on `otel-collector`.",
    "4. **Security** tab → confirm the **Service account** is the one granted `roles/secretmanager.secretAccessor`.",
    "5. **Deploy**. From the CLI, Shape B is `gcloud run services replace service.yaml` with the `run.googleapis.com/container-dependencies` annotation (see the full guide); Shape A is:",
    "",
    "```bash",
    "gcloud run services update checkout-api --region us-central1 \\",
    `  --set-env-vars "^@^OTEL_SERVICE_NAME=checkout-api@OTEL_EXPORTER_OTLP_ENDPOINT=${vars.oneuptimeUrl}/otlp@OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf@OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp" \\`,
    '  --set-secrets "OTEL_EXPORTER_OTLP_HEADERS=oneuptime-otlp-headers:latest"',
    "```",
    "",
    "The `^@^` prefix makes gcloud split that flag on `@` instead of `,`, so the",
    "comma-separated detector list survives.",
    "",
    "Application container, Shape B:",
    "",
    ...sdkEnvBlock("http://localhost:4318", []),
    "",
    "Application container, Shape A:",
    "",
    ...sdkEnvBlock(`${vars.oneuptimeUrl}/otlp`, [
      "# Secret-backed (Variables & Secrets → Reference a secret), not typed here.",
      sdkDirectHeaderLine(vars),
      "# Node.js — Python: OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector",
      "# (opentelemetry-resourcedetector-gcp); Java -Dotel.resource.providers.gcp.enabled=true;",
      "# Go go.opentelemetry.io/contrib/detectors/gcp; .NET OpenTelemetry.Resources.Gcp AddGcpDetector()",
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp",
    ]),
    "",
    "### 3. Sidecar collector configuration (Shape B)",
    "",
    ...collectorConfigBlock({
      vars: vars,
      detectorsLine: "[env, gcp]",
      detectorComment:
        "Stamps cloud.platform=gcp_cloud_run, cloud.account.id, cloud.region and faas.* on everything.",
    }),
    "",
    "Add a `health_check` extension on `0.0.0.0:13133` for the startup probe;",
    "the full guide's YAML includes it.",
    "",
    "### 4. IAM and networking checklist",
    "",
    "- The **runtime service account** of the service (not your user) needs `roles/secretmanager.secretAccessor` on the secret, or the revision fails with `Permission denied on secret`.",
    `- Default egress reaches \`${oneuptimeHost(vars)}\` directly. With **VPC egress: all traffic** (Direct VPC egress or a connector) the VPC needs **Cloud NAT** and a firewall egress rule for TCP 443 to that host.`,
    "- A self-hosted OneUptime inside the VPC is the reverse: route traffic through the VPC so the host resolves.",
    "",
    ...verifySection(vars, 5),
    "",
    ...whatYouGetSection(
      descriptor,
      "Cloud Run does not expose container stats to a sidecar; the tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` with the same `faas.instance` yourself. Read the Requests tiles instead.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildAzureContainerAppsGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  const resourceAttributes: string =
    "cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000";
  return [
    ...introSection(
      descriptor,
      "Azure Container Apps · eastus · <subscription id>",
      "Container Apps replica",
    ),
    "",
    "The Collector's `azurecontainerapps` detector and the Node / .NET Azure",
    "detectors read `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME` and",
    "set `cloud.provider`, `cloud.platform`, `service.name` and the replica id",
    "(`azure.container_app.instance.id`). None of them knows the region or the",
    "subscription, so `cloud.region` and `cloud.account.id` are set by hand —",
    "the two values below. (The Node and .NET detectors spell the platform",
    "`azure.container_apps`; OneUptime rewrites that to `azure_container_apps`",
    "on ingest.) The replica name is also the container hostname, so an SDK",
    "that runs only the host detector still gets an instance identity from",
    "`host.name`; `service.instance.id` is used when no platform identity is",
    "present.",
    "",
    "### 1. Store the token as a Container Apps secret",
    "",
    ...tokenIsSecretNote("a Container Apps secret (or a Key Vault reference)"),
    "",
    "```bash",
    "az containerapp secret set --name checkout-api --resource-group my-rg \\",
    `  --secrets oneuptime-token=${vars.apiKey} \\`,
    `            oneuptime-otlp-headers="x-oneuptime-token=${vars.apiKey}"`,
    "```",
    "",
    "Two secrets because the SDK wants the whole header and the collector wants",
    "the bare token; keep the one your shape uses.",
    "",
    "### 2. Shape A — set the variables on the app",
    "",
    "```bash",
    "az containerapp update --name checkout-api --resource-group my-rg \\",
    "  --set-env-vars \\",
    "    OTEL_SERVICE_NAME=checkout-api \\",
    `    OTEL_EXPORTER_OTLP_ENDPOINT=${vars.oneuptimeUrl}/otlp \\`,
    "    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \\",
    "    OTEL_EXPORTER_OTLP_HEADERS=secretref:oneuptime-otlp-headers \\",
    "    OTEL_NODE_RESOURCE_DETECTORS=env,host,os \\",
    `    "OTEL_RESOURCE_ATTRIBUTES=${resourceAttributes}"`,
    "```",
    "",
    "Replace the region and subscription id with your own. Add `azure` to",
    "`OTEL_NODE_RESOURCE_DETECTORS` (Node) or call `.AddAzureContainerAppsDetector()`",
    "(.NET, `OpenTelemetry.Resources.Azure`) for the replica id; other",
    "languages set `service.instance.id` in code from `CONTAINER_APP_REPLICA_NAME`,",
    "or leave it to the host detector, whose `host.name` is the replica name.",
    "",
    "In the portal:",
    "",
    "1. **Azure portal → Container Apps → your app → Settings → Secrets → + Add** → key `oneuptime-otlp-headers`, the header value.",
    "2. **Application → Containers → Edit and deploy → Container** tab → select the container → **Edit** → **Environment variables**: add each variable above with source **Manual entry**, and `OTEL_EXPORTER_OTLP_HEADERS` with source **Reference a secret**.",
    "3. Shape B: **+ Add** a container `otel-collector`, image `otel/opentelemetry-collector-contrib:latest`, **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`, environment variables `ONEUPTIME_TOKEN` (**Reference a secret**), `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_COLLECTOR_CONFIG` (the YAML below).",
    "4. **Create** — a new revision is deployed.",
    "",
    "### 3. Shape B — sidecar collector configuration",
    "",
    "Export the app (`az containerapp show ... -o yaml`), add the container to",
    "`template.containers`, apply with `az containerapp update --yaml`. The",
    "collector container carries `OTEL_RESOURCE_ATTRIBUTES` (read by the `env`",
    "detector), `ONEUPTIME_TOKEN` as a `secretRef`, and this config:",
    "",
    ...collectorConfigBlock({
      vars: vars,
      detectorsLine: "[env, azurecontainerapps]",
      detectorComment:
        "env: region + subscription from OTEL_RESOURCE_ATTRIBUTES; azurecontainerapps: provider, platform, app name, replica id.",
      detectorExtraLines: [
        "    # Keep the service.name the application set; the detector would",
        "    # otherwise replace it with the Container App name.",
        "    override: false",
      ],
    }),
    "",
    "Alternative: the environment's managed OpenTelemetry agent forwards from",
    "every app in the environment without a sidecar. It exports OTLP over",
    `**gRPC only**, so point it at \`${oneuptimeHost(vars)}:443\` (OneUptime serves`,
    "OTLP/gRPC on the same host over TLS), not at the `/otlp` HTTP path:",
    "",
    "```bash",
    "az containerapp env telemetry otlp add --name my-aca-env --resource-group my-rg \\",
    `  --otlp-name oneuptime --endpoint ${oneuptimeHost(vars)}:443 --insecure false \\`,
    `  --headers "x-oneuptime-token=${vars.apiKey}" \\`,
    "  --enable-open-telemetry-traces true --enable-open-telemetry-logs true \\",
    "  --enable-open-telemetry-metrics true",
    "```",
    "",
    "The `cloud.*` attributes still have to be set on each app, and each app",
    "exports to the agent's injected `OTEL_EXPORTER_OTLP_ENDPOINT`.",
    "",
    "### 4. IAM and networking checklist",
    "",
    "- No role assignment is needed for telemetry. Key Vault references need the app's managed identity to hold **Key Vault Secrets User** on the vault.",
    `- Outbound is **open by default** — a replica reaches \`${oneuptimeHost(vars)}\` without configuration. Only an environment on a custom VNet with a user-defined route or NSG needs TCP 443 to that host allowed on the firewall.`,
    "",
    ...verifySection(vars, 5),
    "",
    ...whatYouGetSection(
      descriptor,
      "Container Apps does not expose replica stats to a sidecar; the tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` with the replica identity yourself.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildAwsElasticBeanstalkGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "AWS Elastic Beanstalk · us-east-1 · 123456789012",
      "Beanstalk instance",
    ),
    "",
    "The Beanstalk detector sets `cloud.platform=aws_elastic_beanstalk` and",
    "`service.instance.id` from `/var/elasticbeanstalk/xray/environment.conf`",
    "but not the account or region — pair it with the EC2 detector, which does.",
    "In the Collector the first detector to set an attribute wins, so keep",
    "`elastic_beanstalk` ahead of `ec2`.",
    "",
    "### 1. Keep the token out of the environment properties",
    "",
    ...tokenIsSecretNote("AWS Secrets Manager"),
    "",
    "Beanstalk environment properties are stored in the environment",
    "configuration, not a secret store. Read the secret in a platform hook with",
    "the instance profile (it needs `secretsmanager:GetSecretValue`) and write",
    "it to the collector's environment, rather than pasting it as a property.",
    "",
    "### 2. Set the environment properties",
    "",
    "1. **AWS Console → Elastic Beanstalk → Environments → your environment → Configuration**.",
    "2. **Updates, monitoring, and logging → Edit → Environment properties**: add the variables below.",
    "3. **Apply** — Beanstalk restarts the application.",
    "",
    ...sdkEnvBlock("http://localhost:4318", [
      "# With a collector on the instance. Without one, point the endpoint at",
      `# ${vars.oneuptimeUrl}/otlp and add:`,
      `# ${sdkDirectHeaderLine(vars)}`,
      "# Node.js SDK detectors (includes Beanstalk and EC2):",
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
    ]),
    "",
    "### 3. Collector on the instance",
    "",
    "Install `otelcol-contrib` from a `.platform/hooks/postdeploy/` script and",
    "give it this configuration:",
    "",
    ...collectorConfigBlock({
      vars: vars,
      detectorsLine: "[env, elastic_beanstalk, ec2]",
      detectorComment:
        "elastic_beanstalk sets cloud.platform and service.instance.id; ec2 adds cloud.account.id, cloud.region and host.id.",
    }),
    "",
    "### 4. IAM and networking checklist",
    "",
    "- The instance profile needs `secretsmanager:GetSecretValue` on the secret if the hook reads it.",
    `- Instances in a private subnet need a NAT gateway; the instance security group must allow egress on TCP 443 to \`${oneuptimeHost(vars)}\`.`,
    "",
    ...verifySection(vars, 5),
    "",
    ...whatYouGetSection(
      descriptor,
      "fill only if the collector on the instance ships `container.cpu.utilization` / `container.memory.usage` (for example from the `docker_stats` receiver on a Docker platform) with the instance identity.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildAwsAppRunnerGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "AWS App Runner · us-east-1 · 123456789012",
      "App Runner instance",
    ),
    "",
    "No resource detector exists for App Runner: set the `cloud.*` attributes",
    "by hand. The host detector's `host.name` (unique per instance) is the",
    "instance identity.",
    "",
    "### 1. Store the token in Secrets Manager",
    "",
    ...tokenIsSecretNote("AWS Secrets Manager"),
    "",
    "```bash",
    "aws secretsmanager create-secret \\",
    "  --name oneuptime/otlp-headers \\",
    `  --secret-string "x-oneuptime-token=${vars.apiKey}"`,
    "```",
    "",
    "App Runner injects the secret verbatim into the variable, so it holds the",
    "whole header.",
    "",
    "### 2. Configure the service",
    "",
    "1. **AWS Console → App Runner → Services → your service → Configuration → Edit** (Configure service).",
    "2. **Environment variables → Add environment variable** for each plain value below.",
    "3. Add `OTEL_EXPORTER_OTLP_HEADERS` with **Source: Secrets Manager** and the secret ARN.",
    "4. **Security → Instance role**: pick a role with `secretsmanager:GetSecretValue` on that secret.",
    "5. **Save changes** — App Runner deploys a new version.",
    "",
    ...sdkEnvBlock(`${vars.oneuptimeUrl}/otlp`, [
      "# From Secrets Manager, not typed here.",
      sdkDirectHeaderLine(vars),
      "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=aws,cloud.platform=aws_app_runner,cloud.region=us-east-1,cloud.account.id=123456789012",
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os",
    ]),
    "",
    "### 3. IAM and networking checklist",
    "",
    "- The **instance role** (not the access role that pulls the image) needs `secretsmanager:GetSecretValue` on the secret.",
    `- A service without a VPC connector reaches \`${oneuptimeHost(vars)}\` directly. With **Outgoing network traffic: Custom VPC**, egress goes through your VPC and needs a NAT gateway plus a security group egress rule on TCP 443.`,
    "",
    ...verifySection(vars, 4),
    "",
    ...whatYouGetSection(
      descriptor,
      "App Runner exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildGcpAppEngineGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "GCP App Engine · us-central1 · my-project",
      "App Engine service",
    ),
    "",
    "The GCP resource detector recognises App Engine from `GAE_SERVICE` /",
    "`GAE_VERSION` / `GAE_INSTANCE` and sets `cloud.platform=gcp_app_engine`,",
    "the project, the region and `faas.name` / `faas.instance` — so, as on",
    "Cloud Run, each service also appears under **Serverless Functions** while",
    "the environment groups the project and region.",
    "",
    "### 1. Store the token in Secret Manager",
    "",
    ...tokenIsSecretNote("Secret Manager"),
    "",
    "```bash",
    `printf '%s' "x-oneuptime-token=${vars.apiKey}" | gcloud secrets create oneuptime-otlp-headers --data-file=-`,
    "gcloud secrets add-iam-policy-binding oneuptime-otlp-headers \\",
    '  --member="serviceAccount:my-project@appspot.gserviceaccount.com" \\',
    '  --role="roles/secretmanager.secretAccessor"',
    "```",
    "",
    "### 2. Set the variables in app.yaml",
    "",
    "App Engine has no console editor for environment variables — they live in",
    "`app.yaml`. Keep a placeholder in the committed file and substitute the",
    "secret in the deploy pipeline, or read it at start-up with the Secret",
    "Manager client and pass it to the exporter's `headers` option in code.",
    "",
    "1. Add the `env_variables` block below to `app.yaml`.",
    "2. `gcloud app deploy`.",
    "3. **Google Cloud console → App Engine → Versions** shows the new version; **App Engine → Services** shows the service that appears under Serverless Functions.",
    "",
    "```yaml",
    "runtime: nodejs22",
    "env_variables:",
    "  OTEL_SERVICE_NAME: checkout-api",
    `  OTEL_EXPORTER_OTLP_ENDPOINT: ${vars.oneuptimeUrl}/otlp`,
    "  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf",
    "  # Substituted at deploy time — do not commit the real value.",
    `  OTEL_EXPORTER_OTLP_HEADERS: x-oneuptime-token=${vars.apiKey}`,
    "  # Python: OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector; Java",
    "  # -Dotel.resource.providers.gcp.enabled=true; Go contrib detectors/gcp; .NET AddGcpDetector()",
    "  OTEL_NODE_RESOURCE_DETECTORS: env,host,os,gcp",
    "```",
    "",
    "### 3. IAM and networking checklist",
    "",
    "- The App Engine service account needs `roles/secretmanager.secretAccessor` if the app reads the secret at start-up.",
    `- The standard environment reaches \`${oneuptimeHost(vars)}\` directly. Flexible environment instances live in a VPC and need Cloud NAT if the subnet has no external IPs, plus a firewall egress rule on TCP 443.`,
    "",
    ...verifySection(vars, 4),
    "",
    ...whatYouGetSection(
      descriptor,
      "App Engine exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildAzureAppServiceGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "Azure App Service · eastus · <subscription id>",
      "App Service instance",
    ),
    "",
    "The Node and .NET Azure detectors (and the Collector's `azureappservice`",
    "detector) read the `WEBSITE_*` variables and set `cloud.platform`,",
    "`cloud.region`, `service.instance.id` (`WEBSITE_INSTANCE_ID`) and `host.id`.",
    "The SDK detectors spell the platform `azure.app_service`; OneUptime",
    "rewrites it to `azure_app_service` on ingest. None of them sets",
    "`cloud.account.id`, so add the subscription id by hand or the environment",
    "key gets an empty account segment.",
    "",
    "### 1. Store the token in Key Vault",
    "",
    ...tokenIsSecretNote("Key Vault, referenced from the app settings"),
    "",
    "Enable the app's **system-assigned managed identity** (**Settings →",
    "Identity**), grant it **Key Vault Secrets User** on the vault, and store",
    `the secret as the whole header \`x-oneuptime-token=${vars.apiKey}\`.`,
    "",
    "### 2. Set the application settings",
    "",
    "1. **Azure portal → App Services → your app → Settings → Environment variables** (**Configuration → Application settings** on older portals).",
    "2. **+ Add** each variable below. For `OTEL_EXPORTER_OTLP_HEADERS` use the Key Vault reference `@Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/oneuptime-otlp-headers/)` as the value.",
    "3. **Apply → Confirm** — the app restarts. Mark the token as a **deployment slot setting** if only one slot should send telemetry.",
    "",
    ...sdkEnvBlock(`${vars.oneuptimeUrl}/otlp`, [
      "# Key Vault reference, not typed here.",
      sdkDirectHeaderLine(vars),
      "OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=00000000-0000-0000-0000-000000000000",
      "# Node.js. .NET: OpenTelemetry.Resources.Azure AddAzureAppServiceDetector(). Other",
      "# languages: add cloud.provider=azure,cloud.platform=azure_app_service,cloud.region=<region>",
      "# to OTEL_RESOURCE_ATTRIBUTES and set service.instance.id from WEBSITE_INSTANCE_ID in code.",
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure",
    ]),
    "",
    "### 3. IAM and networking checklist",
    "",
    "- The managed identity needs **Key Vault Secrets User** on the vault for the reference to resolve; an unresolved reference is passed through as the literal `@Microsoft.KeyVault(...)` string and the exporter gets `401`.",
    `- App Service reaches \`${oneuptimeHost(vars)}\` directly unless **VNet integration** with **Route All** is on, in which case the VNet needs a NAT gateway or a firewall route allowing TCP 443 to that host.`,
    "",
    ...verifySection(vars, 4),
    "",
    ...whatYouGetSection(
      descriptor,
      "App Service exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const buildAzureContainerInstancesGuide: CloudGuideBuilder = (
  vars: DocVars,
  descriptor: ManagedCloudPlatformDescriptor,
): Array<string> => {
  return [
    ...introSection(
      descriptor,
      "Azure Container Instances · eastus · <subscription id>",
      "container group",
    ),
    "",
    "No resource detector exists for Container Instances: set the `cloud.*`",
    "attributes by hand. The host detector's `host.name` (the container",
    "group's hostname) is the instance identity. A container group's",
    "environment variables are fixed at creation — changing them means",
    "recreating the group.",
    "",
    "### 1. Pass the token as a secure environment variable",
    "",
    ...tokenIsSecretNote("`--secure-environment-variables`"),
    "",
    "A secure variable is not returned by `az container show` or shown in the",
    "portal; a plain one is.",
    "",
    "### 2. Create the container group",
    "",
    "1. **Azure portal → Container Instances → + Create** → fill in **Basics** (resource group, name, region, image).",
    "2. **Advanced** tab → **Environment variables**: add each variable below; for `OTEL_EXPORTER_OTLP_HEADERS` set **Mark as secure: Yes**.",
    "3. **Review + create → Create**.",
    "",
    "```bash",
    "az container create --resource-group my-rg --name checkout-api \\",
    "  --image myregistry.azurecr.io/checkout-api:1.4.2 --location eastus \\",
    "  --environment-variables \\",
    "    OTEL_SERVICE_NAME=checkout-api \\",
    `    OTEL_EXPORTER_OTLP_ENDPOINT=${vars.oneuptimeUrl}/otlp \\`,
    "    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \\",
    '    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_instances,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000" \\',
    "    OTEL_NODE_RESOURCE_DETECTORS=env,host,os \\",
    "  --secure-environment-variables \\",
    `    "${sdkDirectHeaderLine(vars)}"`,
    "```",
    "",
    "A sidecar collector works here too — a container group is a",
    "multi-container unit — with the same `detectors: [env]` plus",
    "`OTEL_RESOURCE_ATTRIBUTES` pattern as Azure Container Apps.",
    "",
    "### 3. IAM and networking checklist",
    "",
    "- No role assignment is needed for telemetry.",
    `- A group with a public IP reaches \`${oneuptimeHost(vars)}\` directly. One in a VNet subnet has outbound access only through the VNet's route — add a NAT gateway or allow TCP 443 to that host on the firewall / NSG.`,
    "",
    ...verifySection(vars, 4),
    "",
    ...whatYouGetSection(
      descriptor,
      "fill only if a sidecar collector in the group ships `container.cpu.utilization` / `container.memory.usage` with the group's identity.",
    ),
    "",
    ...footerSection(descriptor),
  ];
};

const CLOUD_GUIDE_BUILDERS: Readonly<
  Record<ManagedCloudPlatform, CloudGuideBuilder>
> = {
  [ManagedCloudPlatform.AwsEcs]: buildAwsEcsGuide,
  [ManagedCloudPlatform.AwsElasticBeanstalk]: buildAwsElasticBeanstalkGuide,
  [ManagedCloudPlatform.AwsAppRunner]: buildAwsAppRunnerGuide,
  [ManagedCloudPlatform.GcpCloudRun]: buildGcpCloudRunGuide,
  [ManagedCloudPlatform.GcpAppEngine]: buildGcpAppEngineGuide,
  [ManagedCloudPlatform.AzureContainerApps]: buildAzureContainerAppsGuide,
  [ManagedCloudPlatform.AzureContainerInstances]:
    buildAzureContainerInstancesGuide,
  [ManagedCloudPlatform.AzureAppService]: buildAzureAppServiceGuide,
};

/*
 * The platform the guide opens on when nothing better is known: the
 * environment being viewed has no cloud.platform yet, or the caller is the
 * empty-state card. ECS is the most common managed platform by far.
 */
export const DEFAULT_CLOUD_DOC_PLATFORM: ManagedCloudPlatform =
  ManagedCloudPlatform.AwsEcs;

/*
 * The guide for one managed platform. An unknown or empty platform string
 * falls back to the default rather than throwing, because the value comes
 * from a database column a user may have typed by hand.
 */
export const getCloudDocMarkdownForPlatform: (
  vars: DocVars,
  platform: string,
) => string = (vars: DocVars, platform: string): string => {
  const descriptor: ManagedCloudPlatformDescriptor =
    getManagedCloudPlatformDescriptor(platform) ||
    getManagedCloudPlatformDescriptor(DEFAULT_CLOUD_DOC_PLATFORM)!;
  return CLOUD_GUIDE_BUILDERS[descriptor.platform](vars, descriptor).join("\n");
};

/*
 * The one-line pointer appended to the platform-less entry point, so a page
 * that renders the guide without a picker still tells the reader where the
 * other platforms are.
 */
export const CLOUD_DOC_OTHER_PLATFORMS_POINTER: string = [
  "Running on a different platform? Google Cloud Run, Azure Container Apps,",
  "Elastic Beanstalk, App Runner, App Engine, App Service and Container",
  "Instances are selectable from the platform picker, and each has a page under",
  "[Cloud Environments](/docs/telemetry/cloud-environments).",
].join(" ");

/*
 * Kept for the callers that predate the picker: the AWS ECS / Fargate guide
 * plus a pointer to the other platforms.
 */
export const getCloudDocMarkdown: (vars: DocVars) => string = (
  vars: DocVars,
): string => {
  return [
    getCloudDocMarkdownForPlatform(vars, DEFAULT_CLOUD_DOC_PLATFORM),
    "",
    CLOUD_DOC_OTHER_PLATFORMS_POINTER,
  ].join("\n");
};

export const getRumDocMarkdown: (vars: DocVars) => string = (
  vars: DocVars,
): string => {
  return [
    "## Instrument a browser or mobile app",
    "",
    "OneUptime classifies telemetry as **RUM** when its resource carries client",
    "attributes — `browser.platform` / `browser.language` / `browser.brands` for",
    "web, or `device.id` / `device.model.identifier` / `device.manufacturer` for",
    "mobile. The application is identified by `service.name`, and its telemetry is",
    "owned by this RUM application (it is never duplicated as a backend Service).",
    "",
    "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser",
    "> SDKs do not add `browser.*` attributes unless you enable the browser",
    "> resource detector or set them yourself — without them this becomes a",
    "> backend Service, not a RUM application.",
    "",
    "### Use a Browser ingestion key",
    "",
    "Everything in the browser section below ships to your users. The token in it",
    "is public — anyone who views source, opens devtools or reads your bundle can",
    "copy it. Create the key as a **Browser** key in **Settings > Telemetry",
    "Ingestion Keys** and list the origins your site is served from:",
    "",
    "- it is accepted only from those origins, so a copied key does not work from",
    "  anyone else's page;",
    "- it can only write traces, logs, metrics and session replays — not profiles,",
    "  source maps, syslog, Fluent, Pyroscope or security events;",
    "- it is rate limited per key, can be switched off in one edit, and can be",
    "  given an expiry.",
    "",
    "> **Never ship a Server ingestion key to a browser.** A Server key has full",
    "> ingest access from anywhere, with no origin check. Once it is in page",
    "> source, anyone who finds it can write forged spans, logs and metrics into",
    "> this project — poisoning dashboards, firing false alerts and running up your",
    "> metered usage — until you notice and rotate it.",
    "",
    "### Browser (OpenTelemetry Web)",
    "",
    "```bash",
    "npm install @opentelemetry/sdk-trace-web @opentelemetry/resources \\",
    "  @opentelemetry/semantic-conventions @opentelemetry/context-zone \\",
    "  @opentelemetry/opentelemetry-browser-detector \\",
    "  @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation \\",
    "  @opentelemetry/instrumentation-document-load \\",
    "  @opentelemetry/instrumentation-fetch",
    "```",
    "",
    "Create `src/telemetry.ts` and import it as the **first** import of your app:",
    "",
    "```ts",
    'import { WebTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";',
    'import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";',
    'import { ZoneContextManager } from "@opentelemetry/context-zone";',
    'import { registerInstrumentations } from "@opentelemetry/instrumentation";',
    'import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";',
    'import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";',
    'import { defaultResource, detectResources, resourceFromAttributes } from "@opentelemetry/resources";',
    'import { browserDetector } from "@opentelemetry/opentelemetry-browser-detector";',
    'import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";',
    "",
    "// browserDetector supplies the browser.* attributes that make this RUM.",
    "const resource = defaultResource()",
    "  .merge(detectResources({ detectors: [browserDetector] }))",
    "  .merge(",
    "    resourceFromAttributes({",
    '      [ATTR_SERVICE_NAME]: "storefront-web",',
    "    }),",
    "  );",
    "",
    "const provider = new WebTracerProvider({",
    "  resource: resource,",
    "  spanProcessors: [",
    "    new BatchSpanProcessor(",
    "      new OTLPTraceExporter({",
    `        url: "${vars.oneuptimeUrl}/otlp/v1/traces",`,
    "        // This value is public. It must be a Browser ingestion key,",
    "        // never a Server one.",
    `        headers: { "x-oneuptime-token": "${vars.apiKey}" },`,
    "      }),",
    "    ),",
    "  ],",
    "});",
    "",
    "provider.register({ contextManager: new ZoneContextManager() });",
    "",
    "registerInstrumentations({",
    "  instrumentations: [",
    "    new DocumentLoadInstrumentation(),",
    "    // List only origins whose API allows the traceparent header.",
    "    new FetchInstrumentation({",
    "      propagateTraceHeaderCorsUrls: [/^https:\\/\\/api\\.example\\.com/],",
    "    }),",
    "  ],",
    "});",
    "```",
    "",
    "If your site sends a Content Security Policy, allow the exporter or it will",
    "fail silently:",
    "",
    "```",
    `connect-src 'self' ${vars.oneuptimeUrl};`,
    "```",
    "",
    "### Mobile (Swift / Android)",
    "",
    "Use the OpenTelemetry Swift or Android SDK, set `service.name`, and export",
    "OTLP to OneUptime:",
    "",
    "> **Mobile needs a Server key, and a mobile bundle can be unpacked.** A",
    "> Browser key is enforced against the `Origin` header, which a mobile SDK",
    "> does not send, so it cannot be used here. Assume the token shipped in your",
    "> app will be extracted, and use the controls that do apply: pin a service",
    "> name on the key so extracted copies cannot forge backend telemetry, set a",
    "> requests-per-minute limit and an expiry, and rotate the key with each",
    "> release train.",
    "",
    "```bash",
    `OTEL_EXPORTER_OTLP_ENDPOINT="${vars.oneuptimeUrl}/otlp"`,
    `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${vars.apiKey}"`,
    'OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-mobile,device.manufacturer=Acme,device.model.identifier=AC-100"',
    "```",
    "",
    "Most mobile SDKs set the `device.*` attributes for you — verify it, and set",
    "them explicitly as above if the application is filed under Services instead.",
    "",
    "### Verify the token",
    "",
    "```bash",
    `curl -i ${vars.oneuptimeUrl}/otlp/v1/validate \\`,
    `  -H "x-oneuptime-token: ${vars.apiKey}"`,
    "```",
    "",
    "Once events arrive, the app appears under **RUM** with page views, error rate",
    "and p95 duration. Full guides: [Browser Setup](/docs/rum/browser-setup),",
    "[Mobile Setup](/docs/rum/mobile-setup), [Core Web Vitals](/docs/rum/web-vitals)",
    "and [Troubleshooting](/docs/rum/troubleshooting).",
  ].join("\n");
};
