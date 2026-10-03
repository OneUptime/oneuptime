import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  buildCloudEnvironmentName,
  getManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideKeyStep,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  shellQuote,
} from "../SetupGuide/SetupGuide";
import {
  translatableTerm,
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The "Connect a managed cloud environment" guide, one per managed platform.
 *
 * Each guide is the part people need while the cloud console is open in the
 * next tab: store the token as a secret, put the settings on the service,
 * check that it worked — with the OTLP endpoint and the token already filled
 * in. Where a platform has two ways to send telemetry (the SDK exporting
 * straight to OneUptime, or a sidecar OpenTelemetry Collector), the steps
 * that differ carry a tab for each, and the sidecar's tab holds its collector
 * configuration, because that is pasted into the same task or container
 * definition. Networking, how the environment is identified and what it
 * shows are folded under Advanced; the full artefacts (a whole ECS task
 * definition, the Cloud Run service YAML) stay on the docs pages the guide
 * links to.
 *
 * Platform facts — labels, cloud.platform values, docs URLs, the instance
 * identity attribute — come from the shared registry, so the guide can never
 * name a platform ingest does not accept, or link to a page that moved.
 */

/*
 * The platform the guide opens on when nothing better is known: the
 * environment being viewed has no cloud.platform yet, or the caller is the
 * empty-state card. ECS is the most common managed platform by far.
 */
export const DEFAULT_CLOUD_DOC_PLATFORM: ManagedCloudPlatform =
  ManagedCloudPlatform.AwsEcs;

/*
 * The picker, in registry order and grouped by provider, so someone who only
 * knows "we are on Azure" finds their platform without reading all eight.
 * Adding a platform to the registry adds it here; its guide builder below is
 * then required by the type of CLOUD_GUIDE_BUILDERS.
 */
export const CLOUD_PLATFORM_OPTIONS: Array<
  SetupGuideOption<ManagedCloudPlatform>
> = MANAGED_CLOUD_PLATFORMS.map(
  (
    descriptor: ManagedCloudPlatformDescriptor,
  ): SetupGuideOption<ManagedCloudPlatform> => {
    return {
      key: descriptor.platform,
      label: descriptor.productName,
      description: descriptor.description,
      group: CLOUD_PROVIDER_LABELS[descriptor.provider],
    };
  },
);

/*
 * The value comes from a database column, so it may be empty (an environment
 * created by hand that ingest has not matched yet) or something ingest would
 * not accept. Neither should blank the guide.
 */
export function resolveCloudPlatform(
  platform: string | null | undefined,
): ManagedCloudPlatform {
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(platform);
  return descriptor ? descriptor.platform : DEFAULT_CLOUD_DOC_PLATFORM;
}

export interface CloudSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  platform: ManagedCloudPlatform;
}

interface CloudGuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  descriptor: ManagedCloudPlatformDescriptor;
}

type CloudGuideBuilder = (context: CloudGuideContext) => SetupGuideContent;

// The example service every snippet configures.
const SERVICE_NAME: string = "checkout-api";
const COLLECTOR_IMAGE: string = "otel/opentelemetry-collector-contrib:latest";
const SIDECAR_ENDPOINT: string = "http://localhost:4318";
const CLOUD_TROUBLESHOOTING_URL: string =
  "/docs/telemetry/cloud-troubleshooting";

// The tabs of a step that depends on how telemetry leaves the workload.
const SIDECAR_COLLECTOR: string = "Sidecar collector";
const SDK_DIRECT: string = "SDK direct";

const INSTRUMENTED_APP_PREREQUISITE: string =
  "Your application instrumented with an OpenTelemetry SDK that exports OTLP";

interface ProviderExample {
  // What cloud.account.id holds on this provider.
  scope: string;
  region: string;
  accountId: string;
}

const PROVIDER_EXAMPLES: Readonly<Record<CloudProvider, ProviderExample>> = {
  [CloudProvider.AWS]: {
    scope: "account",
    region: "us-east-1",
    accountId: "123456789012",
  },
  [CloudProvider.GCP]: {
    scope: "project",
    region: "us-central1",
    accountId: "my-project",
  },
  [CloudProvider.Azure]: {
    scope: "subscription",
    region: "eastus",
    accountId: "00000000-0000-0000-0000-000000000000",
  },
};

function paragraphs(parts: Array<string>): string {
  return parts
    .filter((part: string): boolean => {
      return part.trim().length > 0;
    })
    .join("\n\n");
}

function numbered(items: Array<string>): string {
  return items
    .map((item: string, index: number): string => {
      return `${index + 1}. ${item}`;
    })
    .join("\n");
}

function bullets(items: Array<string>): string {
  return items
    .map((item: string): string => {
      return `- ${item}`;
    })
    .join("\n");
}

function otlpEndpoint(context: CloudGuideContext): string {
  return `${context.oneuptimeUrl}/otlp`;
}

/*
 * The host part of the OneUptime URL, for the "allow egress to ..." lines
 * and the managed agent's gRPC endpoint. The URL is either a real origin or
 * the placeholder SetupGuideCard shows when HOST is unset; the placeholder
 * has no scheme, so it is returned unchanged.
 */
function oneuptimeHost(context: CloudGuideContext): string {
  return context.oneuptimeUrl.replace(/^https?:\/\//, "");
}

/*
 * SDKs read OTEL_EXPORTER_OTLP_HEADERS as a whole "name=value" pair and the
 * platforms inject a secret's value verbatim, so a secret the SDK reads has
 * to hold the complete header. A collector's secret keeps the bare token,
 * because its configuration supplies the header name.
 */
function headerValue(context: CloudGuideContext): string {
  return `x-oneuptime-token=${context.apiKey}`;
}

function headerLine(context: CloudGuideContext): string {
  return `OTEL_EXPORTER_OTLP_HEADERS=${headerValue(context)}`;
}

function hasApiKey(context: CloudGuideContext): boolean {
  return context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER;
}

// Shown on the step that stores the token, until a key is picked.
function pickKeyNote(context: CloudGuideContext): string {
  return hasApiKey(context)
    ? ""
    : `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;
}

// cloud.* set by hand, for the platforms no resource detector covers.
function resourceAttributes(context: CloudGuideContext): string {
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];
  return `cloud.provider=${context.descriptor.provider},cloud.platform=${context.descriptor.platform},cloud.region=${example.region},cloud.account.id=${example.accountId}`;
}

function cloudKeyStep(
  context: CloudGuideContext,
  secretNote: string,
): SetupGuideKeyStep {
  return {
    // Two whole sentences, each in the reader's language.
    description: `${translateText(
      "Pick a Server key, or create one — the commands below update to use it.",
    )} ${secretNote}`,
    endpointLabel: "OTLP Endpoint",
    endpointValue: otlpEndpoint(context),
  };
}

function secretStoreNote(store: string): string {
  return translateTemplate(
    "It is a secret: the next step keeps it in {{store}} rather than in a plain environment variable, which everyone who can view the configuration can read.",
    { store: translatableTerm(store) },
  );
}

function environmentSentence(context: CloudGuideContext, unit: string): string {
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];
  const name: string = buildCloudEnvironmentName({
    platform: context.descriptor.platform,
    region: example.region,
    accountId: example.accountId,
  });
  return `Every ${unit} that reports \`cloud.platform=${context.descriptor.platform}\` is grouped into one **Cloud Environment** per ${example.scope} and region, such as _${name}_.`;
}

interface ShapeTab {
  label: string;
  description: string;
}

function shapeTabs(tabs: Array<ShapeTab>): string {
  return `The steps below have a tab for each way to send telemetry, and picking one switches every step:

${bullets(
  tabs.map((tab: ShapeTab): string => {
    return `**${tab.label}** — ${tab.description}`;
  }),
)}`;
}

function sdkEnvBlock(endpoint: string, extraLines: Array<string>): string {
  return codeBlock(
    "bash",
    [
      `OTEL_SERVICE_NAME=${SERVICE_NAME}`,
      `OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`,
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
      ...extraLines,
    ].join("\n"),
  );
}

// Where the SDK-direct shape needs a language's own resource detector switch.
function detectorSwitchNote(detector: string, others: Array<string>): string {
  return `\`OTEL_NODE_RESOURCE_DETECTORS\` turns on the ${detector} resource detector in Node.js. Other languages turn it on with: ${others.join(", ")}.`;
}

interface CollectorConfigOptions {
  // The whole `detectors:` value.
  detectors: string;
  // Comment lines above the resourcedetection processor.
  detectorComment: Array<string>;
  extraReceiverLines?: Array<string> | undefined;
  detectorExtraLines?: Array<string> | undefined;
  extraProcessorLines?: Array<string> | undefined;
  metricReceivers?: string | undefined;
  processors?: string | undefined;
  // The health_check extension a startup probe needs.
  healthCheck?: boolean | undefined;
}

/*
 * A collector configuration that stamps cloud.* with the resourcedetection
 * processor and exports to OneUptime. `${env:ONEUPTIME_TOKEN}` is expanded by
 * the collector from the secret the platform injects, so the token itself is
 * never written into the configuration.
 */
function collectorConfig(
  context: CloudGuideContext,
  options: CollectorConfigOptions,
): string {
  const processors: string = options.processors || "[resourcedetection, batch]";
  return codeBlock(
    "yaml",
    [
      "receivers:",
      "  otlp:",
      "    protocols:",
      "      http:",
      "        endpoint: 0.0.0.0:4318",
      "      grpc:",
      "        endpoint: 0.0.0.0:4317",
      ...(options.extraReceiverLines || []),
      "processors:",
      ...options.detectorComment.map((line: string): string => {
        return `  # ${line}`;
      }),
      "  resourcedetection:",
      `    detectors: ${options.detectors}`,
      "    timeout: 5s",
      ...(options.detectorExtraLines || []),
      ...(options.extraProcessorLines || []),
      "  batch: {}",
      "exporters:",
      "  otlphttp/oneuptime:",
      `    endpoint: ${otlpEndpoint(context)}`,
      "    headers:",
      "      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}",
      ...(options.healthCheck
        ? ["extensions:", "  health_check:", "    endpoint: 0.0.0.0:13133"]
        : []),
      "service:",
      ...(options.healthCheck ? ["  extensions: [health_check]"] : []),
      "  pipelines:",
      "    traces:",
      "      receivers: [otlp]",
      `      processors: ${processors}`,
      "      exporters: [otlphttp/oneuptime]",
      "    metrics:",
      `      receivers: ${options.metricReceivers || "[otlp]"}`,
      `      processors: ${processors}`,
      "      exporters: [otlphttp/oneuptime]",
      "    logs:",
      "      receivers: [otlp]",
      `      processors: ${processors}`,
      "      exporters: [otlphttp/oneuptime]",
    ].join("\n"),
  );
}

function verifyStep(context: CloudGuideContext): SetupGuideStep {
  return {
    title: "Verify the connection",
    description:
      "Check the token first — it is the cheapest check — then look for the environment.",
    markdown: paragraphs([
      codeBlock(
        "bash",
        `curl -i ${shellQuote(`${otlpEndpoint(context)}/v1/validate`)} \\
  -H "x-oneuptime-token: ${context.apiKey}"`,
      ),
      '`200` with `"valid": true` means the token resolves to this project; `401` means it is unknown, revoked or mistyped. Run it from inside the workload when you can, so it proves egress from where the exporter runs.',
      "Then send one request: the environment appears at **Cloud → All Environments** within a minute of the first span, log or metric.",
    ]),
  };
}

function networkingTopic(
  summary: string,
  items: Array<string>,
): SetupGuideTopic {
  return {
    title: "Networking and permissions",
    summary: summary,
    markdown: bullets(items),
  };
}

function identificationTopic(
  summary: string,
  markdown: string,
): SetupGuideTopic {
  return {
    title: "How the environment is identified",
    summary: summary,
    markdown: markdown,
  };
}

function environmentShowsTopic(data: {
  summary: string;
  instances: string;
  cpuMemory: string;
}): SetupGuideTopic {
  return {
    title: "What the environment shows",
    summary: data.summary,
    markdown: bullets([
      "**Overview** — requests, error rate and p95 latency from traces.",
      `**Instances** — ${data.instances}`,
      `**CPU / Memory** tiles — ${data.cpuMemory}`,
      "**Logs**, **Traces** and **Metrics** tabs scoped to the environment, and the per-service view under **Services** — services keep their own rows there; the environment is the roll-up.",
    ]),
  };
}

function refusedExportsTopic(markdown: string): SetupGuideTopic {
  return {
    title: "Exports are refused with 401",
    markdown: markdown,
  };
}

function environmentMissingTopic(context: CloudGuideContext): SetupGuideTopic {
  return {
    title: "The environment does not appear",
    markdown: numbered([
      "Run the token check from the last step first: `401` means the token is unknown, revoked or mistyped.",
      `Open any trace of the service under **Services → Traces** and check that its resource attributes carry \`cloud.platform=${context.descriptor.platform}\` — without it, the telemetry is not filed as a cloud environment.`,
      `Still nothing? [Cloud Troubleshooting](${CLOUD_TROUBLESHOOTING_URL}) works through the rest in order: blocked egress, environments that land under **Hosts** or **Serverless Functions**, duplicates, and hand-made environments that never match.`,
    ]),
  };
}

function cloudLinks(context: CloudGuideContext): Array<SetupGuideLink> {
  return [
    {
      title: translateTemplate("{{product}} documentation", {
        product: context.descriptor.productName,
      }),
      url: context.descriptor.docsUrl,
    },
    {
      title: "Cloud troubleshooting",
      url: CLOUD_TROUBLESHOOTING_URL,
    },
  ];
}

const buildAwsEcsGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);

  const createSecret: (value: string) => string = (value: string): string => {
    return codeBlock(
      "bash",
      `aws secretsmanager create-secret \\
  --name oneuptime/ingestion-token \\
  --secret-string "${value}"`,
    );
  };

  const executionRoleNote: string =
    "The **task execution role** needs `secretsmanager:GetSecretValue` on the secret (and `kms:Decrypt` on its key if it is customer-managed) — without it the task sticks in `PENDING` with `unable to pull secrets`.";

  const openRevision: string =
    "**AWS Console → Amazon Elastic Container Service → Task definitions** → select the family → **Create new revision**.";
  const confirmRole: string =
    "Under **Task execution role**, confirm the role that can read the secret.";
  const deploy: string =
    "**Create**, then **Clusters → your cluster → Services → select the service → Update → Task definition revision: latest → Deploy**.";

  return {
    keyStep: cloudKeyStep(context, secretStoreNote("AWS Secrets Manager")),
    intro: paragraphs([
      environmentSentence(context, "ECS task"),
      shapeTabs([
        {
          label: SIDECAR_COLLECTOR,
          description:
            "the app exports to `localhost`, and an OpenTelemetry Collector in the task stamps `cloud.*` on everything and ships per-task CPU / memory. Most teams end up here.",
        },
        {
          label: SDK_DIRECT,
          description:
            "the SDK exports straight to OneUptime with the AWS resource detector turned on: no extra container, and no per-task CPU / memory.",
        },
      ]),
    ]),
    prerequisites: [
      "An ECS cluster, and a task definition you can revise",
      "The AWS CLI (`aws`), configured for the cluster's account",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token in Secrets Manager",
        description: "Create the secret the task reads the token from.",
        markdown: pickKeyNote(context) || undefined,
        variants: [
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              createSecret(context.apiKey),
              "The collector's configuration adds the header name, so this secret holds just the token.",
              executionRoleNote,
            ]),
          },
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              createSecret(headerValue(context)),
              "ECS injects the secret's value verbatim and `OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair, so this secret holds the complete header.",
              executionRoleNote,
            ]),
          },
        ],
      },
      {
        title: "Update the task definition",
        description:
          "Add the settings to a new revision of the task definition, then deploy it.",
        variants: [
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              numbered([
                openRevision,
                "Under your application container, expand **Environment variables** and add the application variables below.",
                `**+ Add container** → name \`otel-collector\`, image \`${COLLECTOR_IMAGE}\`, **Essential: No**, **Docker configuration → Command** \`--config=env:OTEL_COLLECTOR_CONFIG\`.`,
                "On the collector container add environment variable `ONEUPTIME_TOKEN` with **Value type: ValueFrom** → the secret ARN, and `OTEL_COLLECTOR_CONFIG` with **Value type: Value** → the collector configuration below.",
                "Under **Startup dependency ordering** on the app container add `otel-collector`, condition **Start**.",
                confirmRole,
                deploy,
              ]),
              "Application variables — in `awsvpc` mode every container in the task shares `localhost`, so the app reaches the sidecar there:",
              sdkEnvBlock(SIDECAR_ENDPOINT, []),
              "Collector configuration — the collector expands `${env:ONEUPTIME_TOKEN}` from the secret ECS injects:",
              collectorConfig(context, {
                detectors: "[env, ecs]",
                detectorComment: [
                  "Stamps cloud.platform=aws_ecs, cloud.account.id, cloud.region and aws.ecs.task.arn on everything.",
                ],
                extraReceiverLines: [
                  "  # Per-task CPU / memory from the task metadata endpoint — fills the tiles.",
                  "  awsecscontainermetrics:",
                  "    collection_interval: 20s",
                ],
                metricReceivers: "[otlp, awsecscontainermetrics]",
              }),
            ]),
          },
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              numbered([
                openRevision,
                "Under your application container, expand **Environment variables** and add the variables below, with `OTEL_EXPORTER_OTLP_HEADERS` as **Value type: ValueFrom** and the secret ARN.",
                confirmRole,
                deploy,
              ]),
              sdkEnvBlock(otlpEndpoint(context), [
                "# Injected from Secrets Manager (secrets / valueFrom), not typed here.",
                headerLine(context),
                "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
              ]),
              detectorSwitchNote("AWS", [
                "Python `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs` (package `opentelemetry-sdk-extension-aws`)",
                "Java `-Dotel.resource.providers.aws.enabled=true`",
                "Go `go.opentelemetry.io/contrib/detectors/aws/ecs`",
                ".NET `OpenTelemetry.Resources.AWS` with `AddAWSECSDetector()`",
              ]),
            ]),
          },
        ],
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "The execution role, private subnets and security group egress.",
        [
          "The **task execution role** needs `secretsmanager:GetSecretValue` on the secret (and `kms:Decrypt` on its key if it is customer-managed). Without it the task sticks in `PENDING` with `unable to pull secrets`.",
          "**Fargate tasks in private subnets** need a NAT gateway on the route table, or `assignPublicIp=ENABLED` in a public subnet — Secrets Manager and OneUptime are both outside the VPC.",
          `**Security group egress** must allow TCP 443 to \`${host}\`. No inbound rule is needed.`,
          "Nothing else: the ECS detector and the container-metrics receiver use the local metadata endpoint.",
        ],
      ),
      identificationTopic(
        "The ECS resource detector fills in the platform, account, region and task.",
        "The ECS resource detector — in the collector's `resourcedetection` processor, or turned on in the SDK — stamps `cloud.platform=aws_ecs`, `cloud.account.id`, `cloud.region` and `aws.ecs.task.arn` on everything the task sends. It reads the task metadata endpoint ECS gives every container, so it needs no IAM permission, and neither does the collector's `awsecscontainermetrics` receiver.",
      ),
      environmentShowsTopic({
        summary:
          "Requests, errors and latency, one row per task, and CPU and memory from the sidecar.",
        instances:
          "one row per running task, named from `aws.ecs.task.arn` (the platform's own identity), or from `service.instance.id` when the platform sets none.",
        cpuMemory:
          "from the `awsecscontainermetrics` receiver's `ecs.task.cpu.utilized` / `ecs.task.memory.utilized` — sidecar collector only; SDK direct ships no container metrics.",
      }),
    ],
    troubleshooting: [
      {
        title: 'Task stuck in PENDING with "unable to pull secrets"',
        markdown: bullets([
          "The **task execution role** needs `secretsmanager:GetSecretValue` on the secret, and `kms:Decrypt` on its key if it is customer-managed.",
          "Or the task cannot reach Secrets Manager: **Fargate tasks in private subnets** need a NAT gateway on the route table, or `assignPublicIp=ENABLED` in a public subnet.",
        ]),
      },
      refusedExportsTopic(
        "The secret holds the wrong value. For the sidecar collector `oneuptime/ingestion-token` must be the bare token; for SDK direct, the whole header `x-oneuptime-token=...`. Check the token itself with the command in the last step.",
      ),
      {
        title: "CPU and Memory tiles stay empty",
        markdown:
          "They come from the sidecar collector's `awsecscontainermetrics` receiver, so SDK direct never fills them. With the sidecar, keep the receiver in the `metrics` pipeline (`receivers: [otlp, awsecscontainermetrics]`) and keep `resourcedetection` in that pipeline too, or the metrics arrive without `cloud.platform`.",
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildGcpCloudRunGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);

  const createSecret: (name: string, value: string) => string = (
    name: string,
    value: string,
  ): string => {
    return codeBlock(
      "bash",
      `printf '%s' "${value}" | gcloud secrets create ${name} --data-file=-
gcloud secrets add-iam-policy-binding ${name} \\
  --member="serviceAccount:checkout-api@my-project.iam.gserviceaccount.com" \\
  --role="roles/secretmanager.secretAccessor"`,
    );
  };

  const runtimeAccountNote: string =
    "Put the service's **runtime service account** (not your user) in `--member` — without `roles/secretmanager.secretAccessor` the revision fails with `Permission denied on secret`.";

  const editRevision: string =
    "**Google Cloud console → Cloud Run → click the service → Edit & deploy new revision**.";
  const confirmAccount: string =
    "**Security** tab → confirm the **Service account** is the one granted `roles/secretmanager.secretAccessor`.";

  return {
    keyStep: cloudKeyStep(context, secretStoreNote("Secret Manager")),
    intro: paragraphs([
      environmentSentence(context, "Cloud Run service or job"),
      shapeTabs([
        {
          label: SDK_DIRECT,
          description:
            "the SDK exports straight to OneUptime with the GCP resource detector turned on. No sidecar: right for one service, and for Cloud Run jobs.",
        },
        {
          label: SIDECAR_COLLECTOR,
          description:
            "the app exports to `localhost`, and a collector container stamps `cloud.*` and `faas.*` on everything and holds the token. Right when several services share one project, or when the SDK cannot run a detector.",
        },
      ]),
    ]),
    prerequisites: [
      "`gcloud`, signed in to the project, with the Secret Manager API enabled (`gcloud services enable secretmanager.googleapis.com`)",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token in Secret Manager",
        description:
          "Create the secret and let the service's runtime service account read it.",
        markdown: pickKeyNote(context) || undefined,
        variants: [
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              createSecret("oneuptime-otlp-headers", headerValue(context)),
              "Cloud Run injects the secret's value verbatim and `OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair, so this secret holds the complete header.",
              runtimeAccountNote,
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              createSecret("oneuptime-ingestion-token", context.apiKey),
              "The collector's configuration adds the header name, so this secret holds just the token.",
              runtimeAccountNote,
            ]),
          },
        ],
      },
      {
        title: "Configure the Cloud Run service",
        description: "Add the settings to a new revision of the service.",
        variants: [
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              numbered([
                editRevision,
                "**Containers** tab → your container → **Variables & Secrets**: add the variables below, and **Reference a secret** → `oneuptime-otlp-headers`, version `latest`, exposed as environment variable `OTEL_EXPORTER_OTLP_HEADERS`.",
                confirmAccount,
                "**Deploy**.",
              ]),
              sdkEnvBlock(otlpEndpoint(context), [
                "# Secret-backed (Variables & Secrets → Reference a secret), not typed here.",
                headerLine(context),
                "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp",
              ]),
              detectorSwitchNote("GCP", [
                "Python `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector` (package `opentelemetry-resourcedetector-gcp`)",
                "Java `-Dotel.resource.providers.gcp.enabled=true`",
                "Go `go.opentelemetry.io/contrib/detectors/gcp`",
                ".NET `OpenTelemetry.Resources.Gcp` with `AddGcpDetector()`",
              ]),
              "Or deploy it from the CLI:",
              codeBlock(
                "bash",
                `gcloud run services update ${SERVICE_NAME} --region us-central1 \\
  --set-env-vars "^@^OTEL_SERVICE_NAME=${SERVICE_NAME}@OTEL_EXPORTER_OTLP_ENDPOINT=${otlpEndpoint(context)}@OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf@OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp" \\
  --set-secrets "OTEL_EXPORTER_OTLP_HEADERS=oneuptime-otlp-headers:latest"`,
              ),
              "The `^@^` prefix makes gcloud split that flag on `@` instead of `,`, so the comma-separated detector list survives.",
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              numbered([
                editRevision,
                "**Containers** tab → your container → **Variables & Secrets**: add the application variables below.",
                `**+ Add container** → image \`${COLLECTOR_IMAGE}\`, argument \`--config=env:OTEL_COLLECTOR_CONFIG\`; **Variables & Secrets** → **Reference a secret** \`oneuptime-ingestion-token\` as \`ONEUPTIME_TOKEN\`, and add \`OTEL_COLLECTOR_CONFIG\` with the collector configuration below; **Settings** → startup probe HTTP \`/\` port \`13133\`, and **Container start-up order** → the app depends on \`otel-collector\`.`,
                confirmAccount,
                "**Deploy**.",
              ]),
              "Application variables — containers in one Cloud Run instance share `localhost`:",
              sdkEnvBlock(SIDECAR_ENDPOINT, []),
              "Collector configuration — the `health_check` extension answers the startup probe on port `13133`:",
              collectorConfig(context, {
                detectors: "[env, gcp]",
                detectorComment: [
                  "Stamps cloud.platform=gcp_cloud_run, cloud.account.id, cloud.region and faas.* on everything.",
                ],
                healthCheck: true,
              }),
              "From the CLI, the sidecar is `gcloud run services replace service.yaml` with the `run.googleapis.com/container-dependencies` annotation — the full guide has the service YAML.",
            ]),
          },
        ],
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "The runtime service account, and VPC egress through Cloud NAT.",
        [
          "The **runtime service account** of the service (not your user) needs `roles/secretmanager.secretAccessor` on the secret, or the revision fails with `Permission denied on secret`.",
          `Default egress reaches \`${host}\` directly. With **VPC egress: all traffic** (Direct VPC egress or a connector) the VPC needs **Cloud NAT** and a firewall egress rule for TCP 443 to that host.`,
          "A self-hosted OneUptime inside the VPC is the reverse: route traffic through the VPC so the host resolves.",
        ],
      ),
      identificationTopic(
        "The GCP resource detector fills in the platform, project, region and instance.",
        "The GCP resource detector — in the SDK or in the collector — sets `cloud.platform=gcp_cloud_run`, the project as `cloud.account.id`, `cloud.region`, and `faas.name` / `faas.instance`. Because it sets `faas.name`, each service also appears under **Serverless Functions** on its own. The environment is the roll-up of the project and region; nothing is duplicated.",
      ),
      environmentShowsTopic({
        summary: "Requests, errors and latency, and one row per instance.",
        instances:
          "one row per running instance, named from `faas.instance` (the platform's own identity), or from `service.instance.id` when the platform sets none.",
        cpuMemory:
          "Cloud Run does not expose container stats to a sidecar; the tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` with the same `faas.instance` yourself. Read the Requests tiles instead.",
      }),
    ],
    troubleshooting: [
      {
        title: 'Revision fails with "Permission denied on secret"',
        markdown:
          "The service's **runtime service account** (not your user) needs `roles/secretmanager.secretAccessor` on the secret. Run the `gcloud secrets add-iam-policy-binding` command from step 2 with that account as `--member`, and confirm it on the **Security** tab of the revision.",
      },
      refusedExportsTopic(
        "The secret holds the wrong value. `oneuptime-ingestion-token` (sidecar collector) must be the bare token; `oneuptime-otlp-headers` (SDK direct) the whole header `x-oneuptime-token=...`. Check the token itself with the command in the last step.",
      ),
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAzureContainerAppsGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);
  const attributes: string = resourceAttributes(context);
  const secretsPortal: string =
    "**Azure portal → Container Apps → your app → Settings → Secrets → + Add**";

  return {
    keyStep: cloudKeyStep(
      context,
      secretStoreNote(translationKey("a Container Apps secret")),
    ),
    intro: paragraphs([
      `${environmentSentence(context, "Container Apps replica")} No detector knows the region or the subscription, so you set those two by hand.`,
      shapeTabs([
        {
          label: SDK_DIRECT,
          description: "the SDK exports straight to OneUptime. No sidecar.",
        },
        {
          label: SIDECAR_COLLECTOR,
          description:
            "the app exports to `localhost`, and a collector container stamps `cloud.*` and the replica id on everything and holds the token.",
        },
      ]),
    ]),
    prerequisites: [
      "The Azure CLI with the `containerapp` extension (`az extension add --name containerapp --upgrade`), signed in to the subscription",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token as a Container Apps secret",
        description:
          "Keep the token on the container app, where its environment variables can reference it.",
        markdown: pickKeyNote(context) || undefined,
        variants: [
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              codeBlock(
                "bash",
                `az containerapp secret set --name ${SERVICE_NAME} --resource-group my-rg \\
  --secrets oneuptime-otlp-headers="${headerValue(context)}"`,
              ),
              `The SDK's \`OTEL_EXPORTER_OTLP_HEADERS\` wants the whole header, so the secret holds it. In the portal: ${secretsPortal} → key \`oneuptime-otlp-headers\`, the header value.`,
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              codeBlock(
                "bash",
                `az containerapp secret set --name ${SERVICE_NAME} --resource-group my-rg \\
  --secrets ${shellQuote(`oneuptime-token=${context.apiKey}`)}`,
              ),
              `The collector adds the header name itself, so the secret holds just the token. In the portal: ${secretsPortal} → key \`oneuptime-token\`, the token.`,
            ]),
          },
        ],
      },
      {
        title: "Configure the container app",
        description:
          "Add the settings to the app — a new revision is deployed with them.",
        variants: [
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              codeBlock(
                "bash",
                [
                  `az containerapp update --name ${SERVICE_NAME} --resource-group my-rg \\`,
                  "  --set-env-vars \\",
                  `    OTEL_SERVICE_NAME=${SERVICE_NAME} \\`,
                  `    ${shellQuote(`OTEL_EXPORTER_OTLP_ENDPOINT=${otlpEndpoint(context)}`)} \\`,
                  "    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \\",
                  "    OTEL_EXPORTER_OTLP_HEADERS=secretref:oneuptime-otlp-headers \\",
                  "    OTEL_NODE_RESOURCE_DETECTORS=env,host,os \\",
                  `    "OTEL_RESOURCE_ATTRIBUTES=${attributes}"`,
                ].join("\n"),
              ),
              "Replace the region and subscription id with your own. Add `azure` to `OTEL_NODE_RESOURCE_DETECTORS` (Node) or call `.AddAzureContainerAppsDetector()` (.NET, `OpenTelemetry.Resources.Azure`) for the replica id; other languages set `service.instance.id` in code from `CONTAINER_APP_REPLICA_NAME`, or leave it to the host detector, whose `host.name` is the replica name.",
              "In the portal instead: **Application → Containers → Edit and deploy → Container** tab → select the container → **Edit** → **Environment variables**: add each variable above with source **Manual entry**, and `OTEL_EXPORTER_OTLP_HEADERS` with source **Reference a secret**. **Create** deploys a new revision.",
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              "Export the app, add the collector to `template.containers`, and apply it:",
              codeBlock(
                "bash",
                `az containerapp show --name ${SERVICE_NAME} --resource-group my-rg -o yaml > ${SERVICE_NAME}.yaml
# add the otel-collector container as below
az containerapp update --name ${SERVICE_NAME} --resource-group my-rg --yaml ${SERVICE_NAME}.yaml`,
              ),
              "The application container exports to the sidecar in the same replica:",
              sdkEnvBlock(SIDECAR_ENDPOINT, []),
              `The \`otel-collector\` container runs \`${COLLECTOR_IMAGE}\` with the argument \`--config=env:OTEL_COLLECTOR_CONFIG\`, and carries \`ONEUPTIME_TOKEN\` as a \`secretRef\` to \`oneuptime-token\`, plus \`OTEL_RESOURCE_ATTRIBUTES\` for its \`env\` detector — replace the region and subscription id with your own:`,
              codeBlock("bash", `OTEL_RESOURCE_ATTRIBUTES=${attributes}`),
              "Its `OTEL_COLLECTOR_CONFIG` is this configuration:",
              collectorConfig(context, {
                detectors: "[env, azurecontainerapps]",
                detectorComment: [
                  "env: region + subscription from OTEL_RESOURCE_ATTRIBUTES; azurecontainerapps: provider, platform, app name, replica id.",
                ],
                detectorExtraLines: [
                  "    # Keep the service.name the application set; the detector would",
                  "    # otherwise replace it with the Container App name.",
                  "    override: false",
                ],
              }),
              `In the portal instead: on the **Container** tab **+ Add** a container \`otel-collector\`, image \`${COLLECTOR_IMAGE}\`, **Arguments override** \`--config=env:OTEL_COLLECTOR_CONFIG\`, environment variables \`ONEUPTIME_TOKEN\` (**Reference a secret**), \`OTEL_RESOURCE_ATTRIBUTES\` and \`OTEL_COLLECTOR_CONFIG\` (the YAML above). **Create** deploys a new revision.`,
            ]),
          },
        ],
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "No role is needed. Outbound is open unless a custom VNet routes it.",
        [
          "No role assignment is needed for telemetry. Key Vault references need the app's managed identity to hold **Key Vault Secrets User** on the vault.",
          `Outbound is **open by default** — a replica reaches \`${host}\` without configuration. Only an environment on a custom VNet with a user-defined route or NSG needs TCP 443 to that host allowed on the firewall.`,
        ],
      ),
      {
        title: "Use the environment's managed OpenTelemetry agent",
        summary:
          "Forward OTLP from every app in the environment without a sidecar, over gRPC.",
        markdown: paragraphs([
          `The environment's managed OpenTelemetry agent forwards from every app in the environment without a sidecar. It exports OTLP over **gRPC only**, so point it at \`${host}:443\` (OneUptime serves OTLP/gRPC on the same host over TLS), not at the \`/otlp\` HTTP path:`,
          codeBlock(
            "bash",
            `az containerapp env telemetry otlp add --name my-aca-env --resource-group my-rg \\
  --otlp-name oneuptime --endpoint ${shellQuote(`${host}:443`)} --insecure false \\
  --headers "${headerValue(context)}" \\
  --enable-open-telemetry-traces true --enable-open-telemetry-logs true \\
  --enable-open-telemetry-metrics true`,
          ),
          "The `cloud.*` attributes still have to be set on each app, and each app exports to the agent's injected `OTEL_EXPORTER_OTLP_ENDPOINT`.",
        ]),
      },
      identificationTopic(
        "The detectors fill in the platform and the replica; region and subscription are set by hand.",
        paragraphs([
          "The Collector's `azurecontainerapps` detector and the Node / .NET Azure detectors read `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME` and set `cloud.provider`, `cloud.platform`, `service.name` and the replica id (`azure.container_app.instance.id`). None of them knows the region or the subscription, so `cloud.region` and `cloud.account.id` are set by hand, in `OTEL_RESOURCE_ATTRIBUTES`.",
          "The Node and .NET detectors spell the platform `azure.container_apps`; OneUptime rewrites that to `azure_container_apps` on ingest. The replica name is also the container hostname, so an SDK that runs only the host detector still gets an instance identity from `host.name`.",
        ]),
      ),
      environmentShowsTopic({
        summary: "Requests, errors and latency, and one row per replica.",
        instances:
          "one row per replica, named from `azure.container_app.instance.id` (the platform's own identity), from `service.instance.id` when no detector set it, or from `host.name` — the replica name — when only the host detector ran.",
        cpuMemory:
          "Container Apps does not expose replica stats to a sidecar; the tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` with the replica identity yourself.",
      }),
    ],
    troubleshooting: [
      refusedExportsTopic(
        "The secret holds the wrong value. `oneuptime-token` (sidecar collector) must be the bare token; `oneuptime-otlp-headers` (SDK direct) the whole header `x-oneuptime-token=...`. Check the token itself with the command in the last step.",
      ),
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAwsElasticBeanstalkGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);

  return {
    keyStep: cloudKeyStep(context, secretStoreNote("AWS Secrets Manager")),
    intro: `${environmentSentence(context, "Beanstalk instance")} An OpenTelemetry Collector on each instance stamps the \`cloud.*\` attributes on everything the application sends.`,
    prerequisites: [
      "An Elastic Beanstalk environment you can configure and deploy to",
      "The AWS CLI (`aws`), configured for the environment's account",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token in Secrets Manager",
        description:
          "Keep the token out of the environment properties, which are not a secret store.",
        markdown: paragraphs([
          codeBlock(
            "bash",
            `aws secretsmanager create-secret \\
  --name oneuptime/ingestion-token \\
  --secret-string "${context.apiKey}"`,
          ),
          "Beanstalk environment properties are stored in the environment configuration, not a secret store. Read this secret in a platform hook with the instance profile (it needs `secretsmanager:GetSecretValue`) and write it to the collector's environment, rather than pasting it as a property.",
          pickKeyNote(context),
        ]),
      },
      {
        title: "Set the environment properties",
        description:
          "Point the application at the collector on its own instance.",
        markdown: paragraphs([
          numbered([
            "**AWS Console → Elastic Beanstalk → Environments → your environment → Configuration**.",
            "**Updates, monitoring, and logging → Edit → Environment properties**: add the variables below.",
            "**Apply** — Beanstalk restarts the application.",
          ]),
          sdkEnvBlock(SIDECAR_ENDPOINT, []),
        ]),
      },
      {
        title: "Run a collector on each instance",
        description:
          "Install the OpenTelemetry Collector from a platform hook, reading the token from the secret.",
        markdown: paragraphs([
          "Install `otelcol-contrib` from a `.platform/hooks/postdeploy/` script and give it this configuration. The same hook reads the secret into the collector's environment as `ONEUPTIME_TOKEN`:",
          collectorConfig(context, {
            detectors: "[env, elastic_beanstalk, ec2]",
            detectorComment: [
              "elastic_beanstalk sets cloud.platform and service.instance.id; ec2 adds cloud.account.id, cloud.region and host.id.",
            ],
            extraProcessorLines: [
              "  # The Beanstalk detector's service.instance.id is the deployment id,",
              "  # shared by every instance of a deployment: drop it so that ec2's",
              "  # host.id names each instance.",
              "  resource:",
              "    attributes:",
              "      - key: service.instance.id",
              "        action: delete",
            ],
            processors: "[resourcedetection, resource, batch]",
          }),
          "In the Collector the first detector to set an attribute wins, so keep `elastic_beanstalk` ahead of `ec2`.",
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "The instance profile, private subnets and security group egress.",
        [
          "The instance profile needs `secretsmanager:GetSecretValue` on the secret if the hook reads it.",
          `Instances in a private subnet need a NAT gateway; the instance security group must allow egress on TCP 443 to \`${host}\`.`,
        ],
      ),
      {
        title: "Skip the collector (Node.js)",
        summary:
          "Node.js apps can export straight to OneUptime, with the token in an environment property.",
        markdown: paragraphs([
          "The Node.js SDK's detectors include Beanstalk and EC2, so a Node.js application can export straight to OneUptime. Set these environment properties instead of the ones in step 3:",
          sdkEnvBlock(otlpEndpoint(context), [
            headerLine(context),
            "# Node.js SDK detectors (includes Beanstalk and EC2):",
            "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
          ]),
          "The token then sits in an environment property, which Beanstalk stores in the environment configuration rather than a secret store. Check a trace's resource attributes afterwards: if `cloud.platform` comes out as `aws_ec2`, your SDK version's merge order favoured the EC2 detector and the collector is the reliable path.",
        ]),
      },
      identificationTopic(
        "The Beanstalk and EC2 detectors fill in the platform, account, region and instance.",
        "The Beanstalk detector sets `cloud.platform=aws_elastic_beanstalk` and `service.instance.id` from `/var/elasticbeanstalk/xray/environment.conf` but not the account or region — pair it with the EC2 detector, which does, and which sets `host.id` too. That `service.instance.id` is the deployment id, shared by every instance of a deployment, so the collector configuration deletes it and the EC2 detector's `host.id` (the instance id) names each instance.",
      ),
      environmentShowsTopic({
        summary: "Requests, errors and latency, and one row per instance.",
        instances:
          "one row per instance, named from `host.id` — the EC2 instance id — once the collector has dropped the deployment-level `service.instance.id`.",
        cpuMemory:
          "fill only if the collector on the instance ships `container.cpu.utilization` / `container.memory.usage` (for example from the `docker_stats` receiver on a Docker platform) with the instance identity.",
      }),
    ],
    troubleshooting: [
      {
        title: "Instances show up under Hosts instead",
        markdown:
          "The EC2 detector's `cloud.platform=aws_ec2` won. In the Collector the first detector to set an attribute wins, so keep `elastic_beanstalk` ahead of `ec2` in `detectors`. Without a collector, the Node.js SDK's merge order can favour the EC2 detector too — run the collector.",
      },
      {
        title: "Every instance shares one row under Instances",
        markdown:
          "The Beanstalk detector's `service.instance.id` is the deployment id, shared by every instance of a deployment, and it is read before `host.id`. Keep the `resource` processor from step 4, which deletes it, in every pipeline.",
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAwsAppRunnerGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);

  return {
    keyStep: cloudKeyStep(context, secretStoreNote("AWS Secrets Manager")),
    intro: `${environmentSentence(context, "App Runner instance")} No resource detector exists for App Runner, so the \`cloud.*\` attributes are set by hand.`,
    prerequisites: [
      "An App Runner service you can configure",
      "The AWS CLI (`aws`), configured for the service's account",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token in Secrets Manager",
        description: "Create a secret holding the whole header the SDK sends.",
        markdown: paragraphs([
          codeBlock(
            "bash",
            `aws secretsmanager create-secret \\
  --name oneuptime/otlp-headers \\
  --secret-string "${headerValue(context)}"`,
          ),
          "App Runner injects the secret verbatim into the variable, so it holds the whole header.",
          pickKeyNote(context),
        ]),
      },
      {
        title: "Configure the App Runner service",
        description:
          "Add the variables to the service — App Runner deploys a new version.",
        markdown: paragraphs([
          numbered([
            "**AWS Console → App Runner → Services → your service → Configuration → Configure service** (in the **Configuration** tab click **Edit**).",
            "**Environment variables → Add environment variable** for each plain value below.",
            "Add `OTEL_EXPORTER_OTLP_HEADERS` with **Source: Secrets Manager** and the secret ARN.",
            "**Security → Instance role**: pick a role with `secretsmanager:GetSecretValue` on that secret — the instance role, not the access role that pulls the image.",
            "**Save changes** — App Runner deploys a new version.",
          ]),
          sdkEnvBlock(otlpEndpoint(context), [
            "# From Secrets Manager, not typed here.",
            headerLine(context),
            `OTEL_RESOURCE_ATTRIBUTES=${resourceAttributes(context)}`,
            "OTEL_NODE_RESOURCE_DETECTORS=env,host,os",
          ]),
          "Replace the region and account id in `OTEL_RESOURCE_ATTRIBUTES` with your own. The host detector's `host.name`, unique per instance, names each instance.",
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic("The instance role, and egress through a custom VPC.", [
        "The **instance role** (not the access role that pulls the image) needs `secretsmanager:GetSecretValue` on the secret.",
        `A service without a VPC connector reaches \`${host}\` directly. With **Outgoing network traffic: Custom VPC**, egress goes through your VPC and needs a NAT gateway plus a security group egress rule on TCP 443.`,
      ]),
      identificationTopic(
        "No detector exists, so the cloud attributes are set by hand.",
        "No resource detector exists for App Runner: the `cloud.*` attributes come from `OTEL_RESOURCE_ATTRIBUTES`, set by hand. The host detector's `host.name` (unique per instance) is the instance identity.",
      ),
      environmentShowsTopic({
        summary: "Requests, errors and latency, and one row per instance.",
        instances:
          "one row per instance, named from `service.instance.id` when the telemetry carries one, otherwise from `host.name` — the container's hostname, unique per instance.",
        cpuMemory:
          "App Runner exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
      }),
    ],
    troubleshooting: [
      refusedExportsTopic(
        "App Runner injects the secret verbatim, so it must hold the whole header `x-oneuptime-token=...`, not the bare token. Check the token itself with the command in the last step.",
      ),
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildGcpAppEngineGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);

  return {
    keyStep: cloudKeyStep(context, secretStoreNote("Secret Manager")),
    intro: `${environmentSentence(context, "App Engine service")} As on Cloud Run, each service also appears under **Serverless Functions** on its own.`,
    prerequisites: [
      "`gcloud`, signed in to the project, with the Secret Manager API enabled (`gcloud services enable secretmanager.googleapis.com`)",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token in Secret Manager",
        description:
          "Create a secret holding the whole header, readable by the App Engine service account.",
        markdown: paragraphs([
          codeBlock(
            "bash",
            `printf '%s' "${headerValue(context)}" | gcloud secrets create oneuptime-otlp-headers --data-file=-
gcloud secrets add-iam-policy-binding oneuptime-otlp-headers \\
  --member="serviceAccount:my-project@appspot.gserviceaccount.com" \\
  --role="roles/secretmanager.secretAccessor"`,
          ),
          "The binding lets the App Engine service account read the secret, which it needs if the app reads it at start-up.",
          pickKeyNote(context),
        ]),
      },
      {
        title: "Set the variables in app.yaml",
        description:
          "App Engine has no console editor for environment variables — they live in app.yaml.",
        markdown: paragraphs([
          "Add the `env_variables` block to `app.yaml`:",
          codeBlock(
            "yaml",
            [
              "runtime: nodejs22",
              "env_variables:",
              `  OTEL_SERVICE_NAME: ${SERVICE_NAME}`,
              `  OTEL_EXPORTER_OTLP_ENDPOINT: ${otlpEndpoint(context)}`,
              "  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf",
              "  # Substituted at deploy time — do not commit the real value.",
              `  OTEL_EXPORTER_OTLP_HEADERS: ${headerValue(context)}`,
              "  # Python: OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector; Java",
              "  # -Dotel.resource.providers.gcp.enabled=true; Go contrib detectors/gcp; .NET AddGcpDetector()",
              "  OTEL_NODE_RESOURCE_DETECTORS: env,host,os,gcp",
            ].join("\n"),
          ),
          "Keep a placeholder in the committed file and substitute the secret in the deploy pipeline, or read it at start-up with the Secret Manager client and pass it to the exporter's `headers` option in code. Then deploy:",
          codeBlock("bash", "gcloud app deploy"),
          "In the console, **App Engine → Versions** shows the new version; **App Engine → Services** shows the service that appears under Serverless Functions.",
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "The service account, and egress from the flexible environment.",
        [
          "The App Engine service account needs `roles/secretmanager.secretAccessor` if the app reads the secret at start-up.",
          `The standard environment reaches \`${host}\` directly. Flexible environment instances live in a VPC and need Cloud NAT if the subnet has no external IPs, plus a firewall egress rule on TCP 443.`,
        ],
      ),
      identificationTopic(
        "The GCP resource detector fills in the platform, project, region and instance.",
        "The GCP resource detector recognises App Engine from `GAE_SERVICE` / `GAE_VERSION` / `GAE_INSTANCE` and sets `cloud.platform=gcp_app_engine`, the project, the region and `faas.name` / `faas.instance` — so, as on Cloud Run, each service also appears under **Serverless Functions** while the environment groups the project and region.",
      ),
      environmentShowsTopic({
        summary: "Requests, errors and latency, and one row per instance.",
        instances:
          "one row per running instance, named from `faas.instance` (the platform's own identity), or from `service.instance.id` when the platform sets none.",
        cpuMemory:
          "App Engine exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
      }),
    ],
    troubleshooting: [environmentMissingTopic(context)],
    links: cloudLinks(context),
  };
};

const buildAzureAppServiceGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];
  const keyVaultReference: string =
    "@Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/oneuptime-otlp-headers/)";

  return {
    keyStep: cloudKeyStep(context, secretStoreNote("Key Vault")),
    intro: `${environmentSentence(context, "App Service instance")} The Azure detectors fill in the platform, the region and the instance, but not the subscription id, which you add by hand.`,
    prerequisites: [
      "An App Service app, and an Azure Key Vault you can add a secret to",
      INSTRUMENTED_APP_PREREQUISITE,
    ],
    steps: [
      {
        title: "Store the token in Key Vault",
        description:
          "Keep the header in Key Vault and let the app's managed identity read it.",
        markdown: paragraphs([
          numbered([
            "Enable the app's **system-assigned managed identity** (**Settings → Identity**).",
            "Grant it **Key Vault Secrets User** on the vault.",
            "Store the whole header as the secret `oneuptime-otlp-headers`:",
          ]),
          codeBlock("text", headerValue(context)),
          pickKeyNote(context),
        ]),
      },
      {
        title: "Set the application settings",
        description:
          "Add the variables as application settings — the app restarts with them.",
        markdown: paragraphs([
          numbered([
            "**Azure portal → App Services → your app → Settings → Environment variables** (**Configuration → Application settings** on older portals).",
            `**+ Add** each variable below. For \`OTEL_EXPORTER_OTLP_HEADERS\` use the Key Vault reference \`${keyVaultReference}\` as the value.`,
            "**Apply → Confirm** — the app restarts. Mark the token as a **deployment slot setting** if only one slot should send telemetry.",
          ]),
          sdkEnvBlock(otlpEndpoint(context), [
            "# The Key Vault reference, which resolves to the header from step 2.",
            `OTEL_EXPORTER_OTLP_HEADERS=${keyVaultReference}`,
            `OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=${example.accountId}`,
            "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure",
          ]),
          "Replace the subscription id with your own — no detector sets `cloud.account.id`. `OTEL_NODE_RESOURCE_DETECTORS` is for Node.js; on .NET use `OpenTelemetry.Resources.Azure` with `AddAzureAppServiceDetector()`. Other languages add `cloud.provider=azure,cloud.platform=azure_app_service,cloud.region=<region>` to `OTEL_RESOURCE_ATTRIBUTES` and set `service.instance.id` from `WEBSITE_INSTANCE_ID` in code.",
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "Key Vault access for the managed identity, and VNet integration.",
        [
          "The managed identity needs **Key Vault Secrets User** on the vault for the reference to resolve; an unresolved reference is passed through as the literal `@Microsoft.KeyVault(...)` string and the exporter gets `401`.",
          `App Service reaches \`${host}\` directly unless **VNet integration** with **Route All** is on, in which case the VNet needs a NAT gateway or a firewall route allowing TCP 443 to that host.`,
        ],
      ),
      identificationTopic(
        "The Azure detectors fill in the platform, region and instance, but not the subscription.",
        "The Node and .NET Azure detectors (and the Collector's `azureappservice` detector) read the `WEBSITE_*` variables and set `cloud.platform`, `cloud.region`, `service.instance.id` (`WEBSITE_INSTANCE_ID`) and `host.id`. The SDK detectors spell the platform `azure.app_service`; OneUptime rewrites it to `azure_app_service` on ingest. None of them sets `cloud.account.id`, so add the subscription id by hand or the environment key gets an empty account segment.",
      ),
      environmentShowsTopic({
        summary: "Requests, errors and latency, and one row per instance.",
        instances:
          "one row per instance, named from `service.instance.id` — `WEBSITE_INSTANCE_ID`, which the Azure detectors set — otherwise from `host.id`.",
        cpuMemory:
          "App Service exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
      }),
    ],
    troubleshooting: [
      refusedExportsTopic(
        "The Key Vault reference did not resolve, so App Service passed the literal `@Microsoft.KeyVault(...)` string through as the header. Give the app's managed identity **Key Vault Secrets User** on the vault, and check that the secret holds the whole header `x-oneuptime-token=...`.",
      ),
      {
        title: "The environment key has an empty account segment",
        markdown:
          "None of the App Service detectors sets `cloud.account.id`. Add the subscription id to `OTEL_RESOURCE_ATTRIBUTES` (step 3) on every app: telemetry with and without it lands in two different environments, and the one without stops receiving telemetry once every app sends it.",
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAzureContainerInstancesGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const host: string = oneuptimeHost(context);
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];

  return {
    keyStep: cloudKeyStep(
      context,
      "It is a secret: the next step passes it as a secure environment variable, which — unlike a plain environment variable — is not shown in the portal or returned by az container show.",
    ),
    intro: `${environmentSentence(context, "container group")} No resource detector exists for Container Instances, so the \`cloud.*\` attributes are set by hand.`,
    prerequisites: [
      "The Azure CLI (`az`), signed in to the subscription — or the Azure portal",
      "Your application's container image, instrumented with an OpenTelemetry SDK that exports OTLP",
    ],
    steps: [
      {
        title: "Create the container group",
        description:
          "Pass the settings when you create the group — its environment variables are fixed at creation.",
        markdown: paragraphs([
          codeBlock(
            "bash",
            [
              `az container create --resource-group my-rg --name ${SERVICE_NAME} \\`,
              `  --image myregistry.azurecr.io/${SERVICE_NAME}:1.4.2 --location ${example.region} \\`,
              "  --environment-variables \\",
              `    OTEL_SERVICE_NAME=${SERVICE_NAME} \\`,
              `    ${shellQuote(`OTEL_EXPORTER_OTLP_ENDPOINT=${otlpEndpoint(context)}`)} \\`,
              "    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \\",
              `    "OTEL_RESOURCE_ATTRIBUTES=${resourceAttributes(context)}" \\`,
              "    OTEL_NODE_RESOURCE_DETECTORS=env,host,os \\",
              "  --secure-environment-variables \\",
              `    "${headerLine(context)}"`,
            ].join("\n"),
          ),
          "Replace the region and subscription id with your own. A secure variable is not returned by `az container show` or shown in the portal; a plain one is. The host detector's `host.name`, the group's hostname, names the instance.",
          "In the portal instead:",
          numbered([
            "**Azure portal → Container Instances → + Create** → fill in **Basics** (resource group, name, region, image).",
            "**Advanced** tab → **Environment variables**: add each variable above; for `OTEL_EXPORTER_OTLP_HEADERS` set **Mark as secure: Yes**.",
            "**Review + create → Create**.",
          ]),
          pickKeyNote(context),
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        "No role is needed. Groups in a VNet subnet need an outbound route.",
        [
          "No role assignment is needed for telemetry.",
          `A group with a public IP reaches \`${host}\` directly. One in a VNet subnet has outbound access only through the VNet's route — add a NAT gateway or allow TCP 443 to that host on the firewall / NSG.`,
        ],
      ),
      {
        title: "Run a sidecar collector",
        summary:
          "A container group can run a collector next to the app, as on Container Apps.",
        markdown:
          "A sidecar collector works here too — a container group is a multi-container unit — with the same `detectors: [env]` plus `OTEL_RESOURCE_ATTRIBUTES` pattern as Azure Container Apps. It is also what fills the CPU / Memory tiles here, if it ships `container.cpu.utilization` / `container.memory.usage` with the group's identity.",
      },
      identificationTopic(
        "No detector exists, so the cloud attributes are set by hand.",
        "No resource detector exists for Container Instances: the `cloud.*` attributes come from `OTEL_RESOURCE_ATTRIBUTES`, set by hand. The host detector's `host.name` (the container group's hostname) is the instance identity.",
      ),
      environmentShowsTopic({
        summary:
          "Requests, errors and latency, and one row per container group.",
        instances:
          "one row per container group, named from `service.instance.id` when the telemetry carries one, otherwise from `host.name` — the group's hostname.",
        cpuMemory:
          "fill only if a sidecar collector in the group ships `container.cpu.utilization` / `container.memory.usage` with the group's identity.",
      }),
    ],
    troubleshooting: [
      {
        title: "A changed variable has no effect",
        markdown:
          "A container group's environment variables are fixed at creation. Delete the group and create it again with the new values.",
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
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

/**
 * The setup guide for one managed platform, filled in with the reader's
 * OneUptime URL and ingestion key. A platform the registry does not know
 * falls back to the default rather than throwing.
 */
export function getCloudSetupGuide(
  options: CloudSetupGuideOptions,
): SetupGuideContent {
  const descriptor: ManagedCloudPlatformDescriptor =
    getManagedCloudPlatformDescriptor(resolveCloudPlatform(options.platform))!;

  return CLOUD_GUIDE_BUILDERS[descriptor.platform]({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    descriptor: descriptor,
  });
}
