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
  DEFAULT_LANGUAGE,
  createTranslator,
  translatableTerm,
  translationKey,
  Translator,
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
 * Every sentence is the reader's language (#5702's follow-up): each is one
 * key of the Dashboard's locale files, worded whole by the translator the
 * guide is built with - its intro, each step's text, Advanced and
 * Troubleshooting, the tabs' names. What fills a sentence - a host, a
 * cloud.platform value, an image - and every command, configuration and
 * code span are written as they are typed: a translation keeps each `code`
 * span, link and placeholder of its English. The titles, descriptions and
 * summaries are keys the card words where it draws them (SetupGuideCard).
 * Without a translator the guide reads in English, word for word as before.
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
 * then required by the type of CLOUD_GUIDE_BUILDERS. Each platform's
 * description is a key the card words in the reader's language
 * (Common/Types/Cloud/CloudPlatform).
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
  // The reader's: every sentence is worded by it. English without one.
  translator?: Translator | undefined;
}

/*
 * One sentence of the guide in the reader's language: `text` is the English
 * (a key of the locale files), `values` fill its {{placeholders}} as
 * written.
 */
export type CloudGuideText = (
  text: string,
  values?: Record<string, string> | undefined,
) => string;

interface CloudGuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  descriptor: ManagedCloudPlatformDescriptor;
  translator: Translator;
  tx: CloudGuideText;
}

type CloudGuideBuilder = (context: CloudGuideContext) => SetupGuideContent;

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// The example service every snippet configures.
const SERVICE_NAME: string = "checkout-api";
const COLLECTOR_IMAGE: string = "otel/opentelemetry-collector-contrib:latest";
const SIDECAR_ENDPOINT: string = "http://localhost:4318";
const CLOUD_TROUBLESHOOTING_URL: string =
  "/docs/telemetry/cloud-troubleshooting";

// The tabs of a step that depends on how telemetry leaves the workload.
const SIDECAR_COLLECTOR: string = translationKey("Sidecar collector");
const SDK_DIRECT: string = translationKey("SDK direct");

interface ProviderExample {
  region: string;
  accountId: string;
}

const PROVIDER_EXAMPLES: Readonly<Record<CloudProvider, ProviderExample>> = {
  [CloudProvider.AWS]: {
    region: "us-east-1",
    accountId: "123456789012",
  },
  [CloudProvider.GCP]: {
    region: "us-central1",
    accountId: "my-project",
  },
  [CloudProvider.Azure]: {
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
    : context.tx(
        "Pick an ingestion key in step 1 to fill in `{{placeholder}}`.",
        { placeholder: SETUP_GUIDE_API_KEY_PLACEHOLDER },
      );
}

// "Your application instrumented with an OpenTelemetry SDK that exports OTLP".
function instrumentedAppPrerequisite(context: CloudGuideContext): string {
  return context.tx(
    "Your application instrumented with an OpenTelemetry SDK that exports OTLP",
  );
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
    description: `${context.tx(
      "Pick a Server key, or create one — the commands below update to use it.",
    )} ${secretNote}`,
    // A key: the key picker words its label in the reader's language.
    endpointLabel: translationKey("OTLP Endpoint"),
    endpointValue: otlpEndpoint(context),
  };
}

function secretStoreNote(context: CloudGuideContext, store: string): string {
  return context.translator.translateTemplate(
    "It is a secret: the next step keeps it in {{store}} rather than in a plain environment variable, which everyone who can view the configuration can read.",
    { store: translatableTerm(store) },
  );
}

/*
 * The values the first sentence of a platform's intro is filled with: the
 * platform it reports, and the name its first environment gets.
 */
function environmentValues(context: CloudGuideContext): Record<string, string> {
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];

  return {
    platform: context.descriptor.platform,
    name: buildCloudEnvironmentName({
      platform: context.descriptor.platform,
      region: example.region,
      accountId: example.accountId,
    }),
  };
}

interface ShapeTab {
  label: string;
  description: string;
}

function shapeTabs(context: CloudGuideContext, tabs: Array<ShapeTab>): string {
  return `${context.tx(
    "The steps below have a tab for each way to send telemetry, and picking one switches every step:",
  )}

${bullets(
  tabs.map((tab: ShapeTab): string => {
    return `**${context.translator.translateText(tab.label) || tab.label}** — ${tab.description}`;
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
function detectorSwitchNote(
  context: CloudGuideContext,
  detector: string,
  others: Array<string>,
): string {
  return context.tx(
    "`OTEL_NODE_RESOURCE_DETECTORS` turns on the {{detector}} resource detector in Node.js. Other languages turn it on with: {{others}}.",
    { detector, others: others.join(", ") },
  );
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
 * never written into the configuration. Its comments are the configuration's
 * own, pasted with it, and stay as written.
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
  const tx: CloudGuideText = context.tx;

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
      tx(
        '`200` with `"valid": true` means the token resolves to this project; `401` means it is unknown, revoked or mistyped. Run it from inside the workload when you can, so it proves egress from where the exporter runs.',
      ),
      tx(
        "Then send one request: the environment appears at **App Platforms → All Environments** within a minute of the first span, log or metric.",
      ),
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

/*
 * What an environment's pages show: its Overview, Instances and CPU and
 * Memory tiles, and its Logs, Traces and Metrics. `instances` and
 * `cpuMemory` are the platform's own lines, already in the reader's words.
 */
function environmentShowsTopic(
  context: CloudGuideContext,
  data: {
    summary: string;
    instances: string;
    cpuMemory: string;
  },
): SetupGuideTopic {
  const tx: CloudGuideText = context.tx;

  return {
    title: "What the environment shows",
    summary: data.summary,
    markdown: bullets([
      tx("**Overview** — requests, error rate and p95 latency from traces."),
      data.instances,
      data.cpuMemory,
      tx(
        "**Logs**, **Traces** and **Metrics** tabs scoped to the environment, and the per-service view under **Services** — services keep their own rows there; the environment is the roll-up.",
      ),
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
  const tx: CloudGuideText = context.tx;

  return {
    title: "The environment does not appear",
    markdown: numbered([
      tx(
        "Run the token check from the last step first: `401` means the token is unknown, revoked or mistyped.",
      ),
      tx(
        "Open any trace of the service under **Services → Traces** and check that its resource attributes carry `cloud.platform={{platform}}` — without it, the telemetry is not filed as a cloud environment.",
        { platform: context.descriptor.platform },
      ),
      tx(
        "Still nothing? [Cloud Troubleshooting]({{url}}) works through the rest in order: blocked egress, environments that land under **Hosts** or **Serverless Functions**, duplicates, and hand-made environments that never match.",
        { url: CLOUD_TROUBLESHOOTING_URL },
      ),
    ]),
  };
}

function cloudLinks(context: CloudGuideContext): Array<SetupGuideLink> {
  return [
    {
      title: context.translator.translateTemplate("{{product}} documentation", {
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
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);

  const createSecret: (value: string) => string = (value: string): string => {
    return codeBlock(
      "bash",
      `aws secretsmanager create-secret \\
  --name oneuptime/ingestion-token \\
  --secret-string "${value}"`,
    );
  };

  const executionRoleNote: string = tx(
    "The **task execution role** needs `secretsmanager:GetSecretValue` on the secret (and `kms:Decrypt` on its key if it is customer-managed) — without it the task sticks in `PENDING` with `unable to pull secrets`.",
  );

  const openRevision: string = tx(
    "**AWS Console → Amazon Elastic Container Service → Task definitions** → select the family → **Create new revision**.",
  );
  const confirmRole: string = tx(
    "Under **Task execution role**, confirm the role that can read the secret.",
  );
  const deploy: string = tx(
    "**Create**, then **Clusters → your cluster → Services → select the service → Update → Task definition revision: latest → Deploy**.",
  );

  return {
    keyStep: cloudKeyStep(
      context,
      secretStoreNote(context, "AWS Secrets Manager"),
    ),
    intro: paragraphs([
      tx(
        "Every ECS task that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per account and region, such as _{{name}}_.",
        environmentValues(context),
      ),
      shapeTabs(context, [
        {
          label: SIDECAR_COLLECTOR,
          description: tx(
            "the app exports to `localhost`, and an OpenTelemetry Collector in the task stamps `cloud.*` on everything and ships per-task CPU / memory. Most teams end up here.",
          ),
        },
        {
          label: SDK_DIRECT,
          description: tx(
            "the SDK exports straight to OneUptime with the AWS resource detector turned on: no extra container, and no per-task CPU / memory.",
          ),
        },
      ]),
    ]),
    prerequisites: [
      tx("An ECS cluster, and a task definition you can revise"),
      tx("The AWS CLI (`aws`), configured for the cluster's account"),
      instrumentedAppPrerequisite(context),
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
              tx(
                "The collector's configuration adds the header name, so this secret holds just the token.",
              ),
              executionRoleNote,
            ]),
          },
          {
            label: SDK_DIRECT,
            markdown: paragraphs([
              createSecret(headerValue(context)),
              tx(
                "ECS injects the secret's value verbatim and `OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair, so this secret holds the complete header.",
              ),
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
                tx(
                  "Under your application container, expand **Environment variables** and add the application variables below.",
                ),
                tx(
                  "**+ Add container** → name `otel-collector`, image `{{image}}`, **Essential: No**, **Docker configuration → Command** `--config=env:OTEL_COLLECTOR_CONFIG`.",
                  { image: COLLECTOR_IMAGE },
                ),
                tx(
                  "On the collector container add environment variable `ONEUPTIME_TOKEN` with **Value type: ValueFrom** → the secret ARN, and `OTEL_COLLECTOR_CONFIG` with **Value type: Value** → the collector configuration below.",
                ),
                tx(
                  "Under **Startup dependency ordering** on the app container add `otel-collector`, condition **Start**.",
                ),
                confirmRole,
                deploy,
              ]),
              tx(
                "Application variables — in `awsvpc` mode every container in the task shares `localhost`, so the app reaches the sidecar there:",
              ),
              sdkEnvBlock(SIDECAR_ENDPOINT, []),
              tx(
                "Collector configuration — the collector expands `{{variable}}` from the secret ECS injects:",
                { variable: "${env:ONEUPTIME_TOKEN}" },
              ),
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
                tx(
                  "Under your application container, expand **Environment variables** and add the variables below, with `OTEL_EXPORTER_OTLP_HEADERS` as **Value type: ValueFrom** and the secret ARN.",
                ),
                confirmRole,
                deploy,
              ]),
              sdkEnvBlock(otlpEndpoint(context), [
                "# Injected from Secrets Manager (secrets / valueFrom), not typed here.",
                headerLine(context),
                "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
              ]),
              detectorSwitchNote(context, "AWS", [
                tx(
                  "Python `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs` (package `opentelemetry-sdk-extension-aws`)",
                ),
                "Java `-Dotel.resource.providers.aws.enabled=true`",
                "Go `go.opentelemetry.io/contrib/detectors/aws/ecs`",
                tx(
                  ".NET `OpenTelemetry.Resources.AWS` with `AddAWSECSDetector()`",
                ),
              ]),
            ]),
          },
        ],
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "The execution role, private subnets and security group egress.",
        ),
        [
          tx(
            "The **task execution role** needs `secretsmanager:GetSecretValue` on the secret (and `kms:Decrypt` on its key if it is customer-managed). Without it the task sticks in `PENDING` with `unable to pull secrets`.",
          ),
          tx(
            "**Fargate tasks in private subnets** need a NAT gateway on the route table, or `assignPublicIp=ENABLED` in a public subnet — Secrets Manager and OneUptime are both outside the VPC.",
          ),
          tx(
            "**Security group egress** must allow TCP 443 to `{{host}}`. No inbound rule is needed.",
            { host },
          ),
          tx(
            "Nothing else: the ECS detector and the container-metrics receiver use the local metadata endpoint.",
          ),
        ],
      ),
      identificationTopic(
        translationKey(
          "The ECS resource detector fills in the platform, account, region and task.",
        ),
        tx(
          "The ECS resource detector — in the collector's `resourcedetection` processor, or turned on in the SDK — stamps `cloud.platform=aws_ecs`, `cloud.account.id`, `cloud.region` and `aws.ecs.task.arn` on everything the task sends. It reads the task metadata endpoint ECS gives every container, so it needs no IAM permission, and neither does the collector's `awsecscontainermetrics` receiver.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, one row per task, and CPU and memory from the sidecar.",
        ),
        instances: tx(
          "**Instances** — one row per running task, named from `aws.ecs.task.arn` (the platform's own identity), or from `service.instance.id` when the platform sets none.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — from the `awsecscontainermetrics` receiver's `ecs.task.cpu.utilized` / `ecs.task.memory.utilized` — sidecar collector only; SDK direct ships no container metrics.",
        ),
      }),
    ],
    troubleshooting: [
      {
        title: 'Task stuck in PENDING with "unable to pull secrets"',
        markdown: bullets([
          tx(
            "The **task execution role** needs `secretsmanager:GetSecretValue` on the secret, and `kms:Decrypt` on its key if it is customer-managed.",
          ),
          tx(
            "Or the task cannot reach Secrets Manager: **Fargate tasks in private subnets** need a NAT gateway on the route table, or `assignPublicIp=ENABLED` in a public subnet.",
          ),
        ]),
      },
      refusedExportsTopic(
        tx(
          "The secret holds the wrong value. For the sidecar collector `oneuptime/ingestion-token` must be the bare token; for SDK direct, the whole header `x-oneuptime-token=...`. Check the token itself with the command in the last step.",
        ),
      ),
      {
        title: "CPU and Memory tiles stay empty",
        markdown: tx(
          "They come from the sidecar collector's `awsecscontainermetrics` receiver, so SDK direct never fills them. With the sidecar, keep the receiver in the `metrics` pipeline (`receivers: [otlp, awsecscontainermetrics]`) and keep `resourcedetection` in that pipeline too, or the metrics arrive without `cloud.platform`.",
        ),
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildGcpCloudRunGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
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

  const runtimeAccountNote: string = tx(
    "Put the service's **runtime service account** (not your user) in `--member` — without `roles/secretmanager.secretAccessor` the revision fails with `Permission denied on secret`.",
  );

  const editRevision: string = tx(
    "**Google Cloud console → Cloud Run → click the service → Edit & deploy new revision**.",
  );
  const confirmAccount: string = tx(
    "**Security** tab → confirm the **Service account** is the one granted `roles/secretmanager.secretAccessor`.",
  );
  const deploy: string = tx("**Deploy**.");

  return {
    keyStep: cloudKeyStep(context, secretStoreNote(context, "Secret Manager")),
    intro: paragraphs([
      tx(
        "Every Cloud Run service or job that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per project and region, such as _{{name}}_.",
        environmentValues(context),
      ),
      shapeTabs(context, [
        {
          label: SDK_DIRECT,
          description: tx(
            "the SDK exports straight to OneUptime with the GCP resource detector turned on. No sidecar: right for one service, and for Cloud Run jobs.",
          ),
        },
        {
          label: SIDECAR_COLLECTOR,
          description: tx(
            "the app exports to `localhost`, and a collector container stamps `cloud.*` and `faas.*` on everything and holds the token. Right when several services share one project, or when the SDK cannot run a detector.",
          ),
        },
      ]),
    ]),
    prerequisites: [
      tx(
        "`gcloud`, signed in to the project, with the Secret Manager API enabled (`gcloud services enable secretmanager.googleapis.com`)",
      ),
      instrumentedAppPrerequisite(context),
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
              tx(
                "Cloud Run injects the secret's value verbatim and `OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair, so this secret holds the complete header.",
              ),
              runtimeAccountNote,
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              createSecret("oneuptime-ingestion-token", context.apiKey),
              tx(
                "The collector's configuration adds the header name, so this secret holds just the token.",
              ),
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
                tx(
                  "**Containers** tab → your container → **Variables & Secrets**: add the variables below, and **Reference a secret** → `oneuptime-otlp-headers`, version `latest`, exposed as environment variable `OTEL_EXPORTER_OTLP_HEADERS`.",
                ),
                confirmAccount,
                deploy,
              ]),
              sdkEnvBlock(otlpEndpoint(context), [
                "# Secret-backed (Variables & Secrets → Reference a secret), not typed here.",
                headerLine(context),
                "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp",
              ]),
              detectorSwitchNote(context, "GCP", [
                tx(
                  "Python `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector` (package `opentelemetry-resourcedetector-gcp`)",
                ),
                "Java `-Dotel.resource.providers.gcp.enabled=true`",
                "Go `go.opentelemetry.io/contrib/detectors/gcp`",
                tx(
                  ".NET `OpenTelemetry.Resources.Gcp` with `AddGcpDetector()`",
                ),
              ]),
              tx("Or deploy it from the CLI:"),
              codeBlock(
                "bash",
                `gcloud run services update ${SERVICE_NAME} --region us-central1 \\
  --set-env-vars "^@^OTEL_SERVICE_NAME=${SERVICE_NAME}@OTEL_EXPORTER_OTLP_ENDPOINT=${otlpEndpoint(context)}@OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf@OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp" \\
  --set-secrets "OTEL_EXPORTER_OTLP_HEADERS=oneuptime-otlp-headers:latest"`,
              ),
              tx(
                "The `^@^` prefix makes gcloud split that flag on `@` instead of `,`, so the comma-separated detector list survives.",
              ),
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              numbered([
                editRevision,
                tx(
                  "**Containers** tab → your container → **Variables & Secrets**: add the application variables below.",
                ),
                tx(
                  "**+ Add container** → image `{{image}}`, argument `--config=env:OTEL_COLLECTOR_CONFIG`; **Variables & Secrets** → **Reference a secret** `oneuptime-ingestion-token` as `ONEUPTIME_TOKEN`, and add `OTEL_COLLECTOR_CONFIG` with the collector configuration below; **Settings** → startup probe HTTP `/` port `13133`, and **Container start-up order** → the app depends on `otel-collector`.",
                  { image: COLLECTOR_IMAGE },
                ),
                confirmAccount,
                deploy,
              ]),
              tx(
                "Application variables — containers in one Cloud Run instance share `localhost`:",
              ),
              sdkEnvBlock(SIDECAR_ENDPOINT, []),
              tx(
                "Collector configuration — the `health_check` extension answers the startup probe on port `13133`:",
              ),
              collectorConfig(context, {
                detectors: "[env, gcp]",
                detectorComment: [
                  "Stamps cloud.platform=gcp_cloud_run, cloud.account.id, cloud.region and faas.* on everything.",
                ],
                healthCheck: true,
              }),
              tx(
                "From the CLI, the sidecar is `gcloud run services replace service.yaml` with the `run.googleapis.com/container-dependencies` annotation — the full guide has the service YAML.",
              ),
            ]),
          },
        ],
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "The runtime service account, and VPC egress through Cloud NAT.",
        ),
        [
          tx(
            "The **runtime service account** of the service (not your user) needs `roles/secretmanager.secretAccessor` on the secret, or the revision fails with `Permission denied on secret`.",
          ),
          tx(
            "Default egress reaches `{{host}}` directly. With **VPC egress: all traffic** (Direct VPC egress or a connector) the VPC needs **Cloud NAT** and a firewall egress rule for TCP 443 to that host.",
            { host },
          ),
          tx(
            "A self-hosted OneUptime inside the VPC is the reverse: route traffic through the VPC so the host resolves.",
          ),
        ],
      ),
      identificationTopic(
        translationKey(
          "The GCP resource detector fills in the platform, project, region and instance.",
        ),
        tx(
          "The GCP resource detector — in the SDK or in the collector — sets `cloud.platform=gcp_cloud_run`, the project as `cloud.account.id`, `cloud.region`, and `faas.name` / `faas.instance`. Because it sets `faas.name`, each service also appears under **Serverless Functions** on its own. The environment is the roll-up of the project and region; nothing is duplicated.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per instance.",
        ),
        instances: tx(
          "**Instances** — one row per running instance, named from `faas.instance` (the platform's own identity), or from `service.instance.id` when the platform sets none.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — Cloud Run does not expose container stats to a sidecar; the tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` with the same `faas.instance` yourself. Read the Requests tiles instead.",
        ),
      }),
    ],
    troubleshooting: [
      {
        title: 'Revision fails with "Permission denied on secret"',
        markdown: tx(
          "The service's **runtime service account** (not your user) needs `roles/secretmanager.secretAccessor` on the secret. Run the `gcloud secrets add-iam-policy-binding` command from step 2 with that account as `--member`, and confirm it on the **Security** tab of the revision.",
        ),
      },
      refusedExportsTopic(
        tx(
          "The secret holds the wrong value. `oneuptime-ingestion-token` (sidecar collector) must be the bare token; `oneuptime-otlp-headers` (SDK direct) the whole header `x-oneuptime-token=...`. Check the token itself with the command in the last step.",
        ),
      ),
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAzureContainerAppsGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);
  const attributes: string = resourceAttributes(context);
  const secretsPortal: string = tx(
    "**Azure portal → Container Apps → your app → Settings → Secrets → + Add**",
  );

  return {
    keyStep: cloudKeyStep(
      context,
      secretStoreNote(context, translationKey("a Container Apps secret")),
    ),
    intro: paragraphs([
      tx(
        "Every Container Apps replica that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per subscription and region, such as _{{name}}_. No detector knows the region or the subscription, so you set those two by hand.",
        environmentValues(context),
      ),
      shapeTabs(context, [
        {
          label: SDK_DIRECT,
          description: tx("the SDK exports straight to OneUptime. No sidecar."),
        },
        {
          label: SIDECAR_COLLECTOR,
          description: tx(
            "the app exports to `localhost`, and a collector container stamps `cloud.*` and the replica id on everything and holds the token.",
          ),
        },
      ]),
    ]),
    prerequisites: [
      tx(
        "The Azure CLI with the `containerapp` extension (`az extension add --name containerapp --upgrade`), signed in to the subscription",
      ),
      instrumentedAppPrerequisite(context),
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
              tx(
                "The SDK's `OTEL_EXPORTER_OTLP_HEADERS` wants the whole header, so the secret holds it. In the portal: {{portal}} → key `oneuptime-otlp-headers`, the header value.",
                { portal: secretsPortal },
              ),
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
              tx(
                "The collector adds the header name itself, so the secret holds just the token. In the portal: {{portal}} → key `oneuptime-token`, the token.",
                { portal: secretsPortal },
              ),
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
              tx(
                "Replace the region and subscription id with your own. Add `azure` to `OTEL_NODE_RESOURCE_DETECTORS` (Node) or call `.AddAzureContainerAppsDetector()` (.NET, `OpenTelemetry.Resources.Azure`) for the replica id; other languages set `service.instance.id` in code from `CONTAINER_APP_REPLICA_NAME`, or leave it to the host detector, whose `host.name` is the replica name.",
              ),
              tx(
                "In the portal instead: **Application → Containers → Edit and deploy → Container** tab → select the container → **Edit** → **Environment variables**: add each variable above with source **Manual entry**, and `OTEL_EXPORTER_OTLP_HEADERS` with source **Reference a secret**. **Create** deploys a new revision.",
              ),
            ]),
          },
          {
            label: SIDECAR_COLLECTOR,
            markdown: paragraphs([
              tx(
                "Export the app, add the collector to `template.containers`, and apply it:",
              ),
              codeBlock(
                "bash",
                `az containerapp show --name ${SERVICE_NAME} --resource-group my-rg -o yaml > ${SERVICE_NAME}.yaml
# add the otel-collector container as below
az containerapp update --name ${SERVICE_NAME} --resource-group my-rg --yaml ${SERVICE_NAME}.yaml`,
              ),
              tx(
                "The application container exports to the sidecar in the same replica:",
              ),
              sdkEnvBlock(SIDECAR_ENDPOINT, []),
              tx(
                "The `otel-collector` container runs `{{image}}` with the argument `--config=env:OTEL_COLLECTOR_CONFIG`, and carries `ONEUPTIME_TOKEN` as a `secretRef` to `oneuptime-token`, plus `OTEL_RESOURCE_ATTRIBUTES` for its `env` detector — replace the region and subscription id with your own:",
                { image: COLLECTOR_IMAGE },
              ),
              codeBlock("bash", `OTEL_RESOURCE_ATTRIBUTES=${attributes}`),
              tx("Its `OTEL_COLLECTOR_CONFIG` is this configuration:"),
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
              tx(
                "In the portal instead: on the **Container** tab **+ Add** a container `otel-collector`, image `{{image}}`, **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`, environment variables `ONEUPTIME_TOKEN` (**Reference a secret**), `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_COLLECTOR_CONFIG` (the YAML above). **Create** deploys a new revision.",
                { image: COLLECTOR_IMAGE },
              ),
            ]),
          },
        ],
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "No role is needed. Outbound is open unless a custom VNet routes it.",
        ),
        [
          tx(
            "No role assignment is needed for telemetry. Key Vault references need the app's managed identity to hold **Key Vault Secrets User** on the vault.",
          ),
          tx(
            "Outbound is **open by default** — a replica reaches `{{host}}` without configuration. Only an environment on a custom VNet with a user-defined route or NSG needs TCP 443 to that host allowed on the firewall.",
            { host },
          ),
        ],
      ),
      {
        title: "Use the environment's managed OpenTelemetry agent",
        summary: translationKey(
          "Forward OTLP from every app in the environment without a sidecar, over gRPC.",
        ),
        markdown: paragraphs([
          tx(
            "The environment's managed OpenTelemetry agent forwards from every app in the environment without a sidecar. It exports OTLP over **gRPC only**, so point it at `{{endpoint}}` (OneUptime serves OTLP/gRPC on the same host over TLS), not at the `/otlp` HTTP path:",
            { endpoint: `${host}:443` },
          ),
          codeBlock(
            "bash",
            `az containerapp env telemetry otlp add --name my-aca-env --resource-group my-rg \\
  --otlp-name oneuptime --endpoint ${shellQuote(`${host}:443`)} --insecure false \\
  --headers "${headerValue(context)}" \\
  --enable-open-telemetry-traces true --enable-open-telemetry-logs true \\
  --enable-open-telemetry-metrics true`,
          ),
          tx(
            "The `cloud.*` attributes still have to be set on each app, and each app exports to the agent's injected `OTEL_EXPORTER_OTLP_ENDPOINT`.",
          ),
        ]),
      },
      identificationTopic(
        translationKey(
          "The detectors fill in the platform and the replica; region and subscription are set by hand.",
        ),
        paragraphs([
          tx(
            "The Collector's `azurecontainerapps` detector and the Node / .NET Azure detectors read `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME` and set `cloud.provider`, `cloud.platform`, `service.name` and the replica id (`azure.container_app.instance.id`). None of them knows the region or the subscription, so `cloud.region` and `cloud.account.id` are set by hand, in `OTEL_RESOURCE_ATTRIBUTES`.",
          ),
          tx(
            "The Node and .NET detectors spell the platform `azure.container_apps`; OneUptime rewrites that to `azure_container_apps` on ingest. The replica name is also the container hostname, so an SDK that runs only the host detector still gets an instance identity from `host.name`.",
          ),
        ]),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per replica.",
        ),
        instances: tx(
          "**Instances** — one row per replica, named from `azure.container_app.instance.id` (the platform's own identity), from `service.instance.id` when no detector set it, or from `host.name` — the replica name — when only the host detector ran.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — Container Apps does not expose replica stats to a sidecar; the tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` with the replica identity yourself.",
        ),
      }),
    ],
    troubleshooting: [
      refusedExportsTopic(
        tx(
          "The secret holds the wrong value. `oneuptime-token` (sidecar collector) must be the bare token; `oneuptime-otlp-headers` (SDK direct) the whole header `x-oneuptime-token=...`. Check the token itself with the command in the last step.",
        ),
      ),
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAwsElasticBeanstalkGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);

  return {
    keyStep: cloudKeyStep(
      context,
      secretStoreNote(context, "AWS Secrets Manager"),
    ),
    intro: tx(
      "Every Beanstalk instance that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per account and region, such as _{{name}}_. An OpenTelemetry Collector on each instance stamps the `cloud.*` attributes on everything the application sends.",
      environmentValues(context),
    ),
    prerequisites: [
      tx("An Elastic Beanstalk environment you can configure and deploy to"),
      tx("The AWS CLI (`aws`), configured for the environment's account"),
      instrumentedAppPrerequisite(context),
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
          tx(
            "Beanstalk environment properties are stored in the environment configuration, not a secret store. Read this secret in a platform hook with the instance profile (it needs `secretsmanager:GetSecretValue`) and write it to the collector's environment, rather than pasting it as a property.",
          ),
          pickKeyNote(context),
        ]),
      },
      {
        title: "Set the environment properties",
        description:
          "Point the application at the collector on its own instance.",
        markdown: paragraphs([
          numbered([
            tx(
              "**AWS Console → Elastic Beanstalk → Environments → your environment → Configuration**.",
            ),
            tx(
              "**Updates, monitoring, and logging → Edit → Environment properties**: add the variables below.",
            ),
            tx("**Apply** — Beanstalk restarts the application."),
          ]),
          sdkEnvBlock(SIDECAR_ENDPOINT, []),
        ]),
      },
      {
        title: "Run a collector on each instance",
        description:
          "Install the OpenTelemetry Collector from a platform hook, reading the token from the secret.",
        markdown: paragraphs([
          tx(
            "Install `otelcol-contrib` from a `.platform/hooks/postdeploy/` script and give it this configuration. The same hook reads the secret into the collector's environment as `ONEUPTIME_TOKEN`:",
          ),
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
          tx(
            "In the Collector the first detector to set an attribute wins, so keep `elastic_beanstalk` ahead of `ec2`.",
          ),
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "The instance profile, private subnets and security group egress.",
        ),
        [
          tx(
            "The instance profile needs `secretsmanager:GetSecretValue` on the secret if the hook reads it.",
          ),
          tx(
            "Instances in a private subnet need a NAT gateway; the instance security group must allow egress on TCP 443 to `{{host}}`.",
            { host },
          ),
        ],
      ),
      {
        title: "Skip the collector (Node.js)",
        summary: translationKey(
          "Node.js apps can export straight to OneUptime, with the token in an environment property.",
        ),
        markdown: paragraphs([
          tx(
            "The Node.js SDK's detectors include Beanstalk and EC2, so a Node.js application can export straight to OneUptime. Set these environment properties instead of the ones in step 3:",
          ),
          sdkEnvBlock(otlpEndpoint(context), [
            headerLine(context),
            "# Node.js SDK detectors (includes Beanstalk and EC2):",
            "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
          ]),
          tx(
            "The token then sits in an environment property, which Beanstalk stores in the environment configuration rather than a secret store. Check a trace's resource attributes afterwards: if `cloud.platform` comes out as `aws_ec2`, your SDK version's merge order favoured the EC2 detector and the collector is the reliable path.",
          ),
        ]),
      },
      identificationTopic(
        translationKey(
          "The Beanstalk and EC2 detectors fill in the platform, account, region and instance.",
        ),
        tx(
          "The Beanstalk detector sets `cloud.platform=aws_elastic_beanstalk` and `service.instance.id` from `/var/elasticbeanstalk/xray/environment.conf` but not the account or region — pair it with the EC2 detector, which does, and which sets `host.id` too. That `service.instance.id` is the deployment id, shared by every instance of a deployment, so the collector configuration deletes it and the EC2 detector's `host.id` (the instance id) names each instance.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per instance.",
        ),
        instances: tx(
          "**Instances** — one row per instance, named from `host.id` — the EC2 instance id — once the collector has dropped the deployment-level `service.instance.id`.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — fill only if the collector on the instance ships `container.cpu.utilization` / `container.memory.usage` (for example from the `docker_stats` receiver on a Docker platform) with the instance identity.",
        ),
      }),
    ],
    troubleshooting: [
      {
        title: "Instances show up under Hosts instead",
        markdown: tx(
          "The EC2 detector's `cloud.platform=aws_ec2` won. In the Collector the first detector to set an attribute wins, so keep `elastic_beanstalk` ahead of `ec2` in `detectors`. Without a collector, the Node.js SDK's merge order can favour the EC2 detector too — run the collector.",
        ),
      },
      {
        title: "Every instance shares one row under Instances",
        markdown: tx(
          "The Beanstalk detector's `service.instance.id` is the deployment id, shared by every instance of a deployment, and it is read before `host.id`. Keep the `resource` processor from step 4, which deletes it, in every pipeline.",
        ),
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAwsAppRunnerGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);

  return {
    keyStep: cloudKeyStep(
      context,
      secretStoreNote(context, "AWS Secrets Manager"),
    ),
    intro: tx(
      "Every App Runner instance that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per account and region, such as _{{name}}_. No resource detector exists for App Runner, so the `cloud.*` attributes are set by hand.",
      environmentValues(context),
    ),
    prerequisites: [
      tx("An App Runner service you can configure"),
      tx("The AWS CLI (`aws`), configured for the service's account"),
      instrumentedAppPrerequisite(context),
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
          tx(
            "App Runner injects the secret verbatim into the variable, so it holds the whole header.",
          ),
          pickKeyNote(context),
        ]),
      },
      {
        title: "Configure the App Runner service",
        description:
          "Add the variables to the service — App Runner deploys a new version.",
        markdown: paragraphs([
          numbered([
            tx(
              "**AWS Console → App Runner → Services → your service → Configuration → Configure service** (in the **Configuration** tab click **Edit**).",
            ),
            tx(
              "**Environment variables → Add environment variable** for each plain value below.",
            ),
            tx(
              "Add `OTEL_EXPORTER_OTLP_HEADERS` with **Source: Secrets Manager** and the secret ARN.",
            ),
            tx(
              "**Security → Instance role**: pick a role with `secretsmanager:GetSecretValue` on that secret — the instance role, not the access role that pulls the image.",
            ),
            tx("**Save changes** — App Runner deploys a new version."),
          ]),
          sdkEnvBlock(otlpEndpoint(context), [
            "# From Secrets Manager, not typed here.",
            headerLine(context),
            `OTEL_RESOURCE_ATTRIBUTES=${resourceAttributes(context)}`,
            "OTEL_NODE_RESOURCE_DETECTORS=env,host,os",
          ]),
          tx(
            "Replace the region and account id in `OTEL_RESOURCE_ATTRIBUTES` with your own. The host detector's `host.name`, unique per instance, names each instance.",
          ),
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey("The instance role, and egress through a custom VPC."),
        [
          tx(
            "The **instance role** (not the access role that pulls the image) needs `secretsmanager:GetSecretValue` on the secret.",
          ),
          tx(
            "A service without a VPC connector reaches `{{host}}` directly. With **Outgoing network traffic: Custom VPC**, egress goes through your VPC and needs a NAT gateway plus a security group egress rule on TCP 443.",
            { host },
          ),
        ],
      ),
      identificationTopic(
        translationKey(
          "No detector exists, so the cloud attributes are set by hand.",
        ),
        tx(
          "No resource detector exists for App Runner: the `cloud.*` attributes come from `OTEL_RESOURCE_ATTRIBUTES`, set by hand. The host detector's `host.name` (unique per instance) is the instance identity.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per instance.",
        ),
        instances: tx(
          "**Instances** — one row per instance, named from `service.instance.id` when the telemetry carries one, otherwise from `host.name` — the container's hostname, unique per instance.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — App Runner exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
        ),
      }),
    ],
    troubleshooting: [
      refusedExportsTopic(
        tx(
          "App Runner injects the secret verbatim, so it must hold the whole header `x-oneuptime-token=...`, not the bare token. Check the token itself with the command in the last step.",
        ),
      ),
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildGcpAppEngineGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);

  return {
    keyStep: cloudKeyStep(context, secretStoreNote(context, "Secret Manager")),
    intro: tx(
      "Every App Engine service that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per project and region, such as _{{name}}_. As on Cloud Run, each service also appears under **Serverless Functions** on its own.",
      environmentValues(context),
    ),
    prerequisites: [
      tx(
        "`gcloud`, signed in to the project, with the Secret Manager API enabled (`gcloud services enable secretmanager.googleapis.com`)",
      ),
      instrumentedAppPrerequisite(context),
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
          tx(
            "The binding lets the App Engine service account read the secret, which it needs if the app reads it at start-up.",
          ),
          pickKeyNote(context),
        ]),
      },
      {
        title: "Set the variables in app.yaml",
        description:
          "App Engine has no console editor for environment variables — they live in app.yaml.",
        markdown: paragraphs([
          tx("Add the `env_variables` block to `app.yaml`:"),
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
          tx(
            "Keep a placeholder in the committed file and substitute the secret in the deploy pipeline, or read it at start-up with the Secret Manager client and pass it to the exporter's `headers` option in code. Then deploy:",
          ),
          codeBlock("bash", "gcloud app deploy"),
          tx(
            "In the console, **App Engine → Versions** shows the new version; **App Engine → Services** shows the service that appears under Serverless Functions.",
          ),
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "The service account, and egress from the flexible environment.",
        ),
        [
          tx(
            "The App Engine service account needs `roles/secretmanager.secretAccessor` if the app reads the secret at start-up.",
          ),
          tx(
            "The standard environment reaches `{{host}}` directly. Flexible environment instances live in a VPC and need Cloud NAT if the subnet has no external IPs, plus a firewall egress rule on TCP 443.",
            { host },
          ),
        ],
      ),
      identificationTopic(
        translationKey(
          "The GCP resource detector fills in the platform, project, region and instance.",
        ),
        tx(
          "The GCP resource detector recognises App Engine from `GAE_SERVICE` / `GAE_VERSION` / `GAE_INSTANCE` and sets `cloud.platform=gcp_app_engine`, the project, the region and `faas.name` / `faas.instance` — so, as on Cloud Run, each service also appears under **Serverless Functions** while the environment groups the project and region.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per instance.",
        ),
        instances: tx(
          "**Instances** — one row per running instance, named from `faas.instance` (the platform's own identity), or from `service.instance.id` when the platform sets none.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — App Engine exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
        ),
      }),
    ],
    troubleshooting: [environmentMissingTopic(context)],
    links: cloudLinks(context),
  };
};

const buildAzureAppServiceGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];
  const keyVaultReference: string =
    "@Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/oneuptime-otlp-headers/)";

  return {
    keyStep: cloudKeyStep(context, secretStoreNote(context, "Key Vault")),
    intro: tx(
      "Every App Service instance that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per subscription and region, such as _{{name}}_. The Azure detectors fill in the platform, the region and the instance, but not the subscription id, which you add by hand.",
      environmentValues(context),
    ),
    prerequisites: [
      tx("An App Service app, and an Azure Key Vault you can add a secret to"),
      instrumentedAppPrerequisite(context),
    ],
    steps: [
      {
        title: "Store the token in Key Vault",
        description:
          "Keep the header in Key Vault and let the app's managed identity read it.",
        markdown: paragraphs([
          numbered([
            tx(
              "Enable the app's **system-assigned managed identity** (**Settings → Identity**).",
            ),
            tx("Grant it **Key Vault Secrets User** on the vault."),
            tx(
              "Store the whole header as the secret `oneuptime-otlp-headers`:",
            ),
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
            tx(
              "**Azure portal → App Services → your app → Settings → Environment variables** (**Configuration → Application settings** on older portals).",
            ),
            tx(
              "**+ Add** each variable below. For `OTEL_EXPORTER_OTLP_HEADERS` use the Key Vault reference `{{reference}}` as the value.",
              { reference: keyVaultReference },
            ),
            tx(
              "**Apply → Confirm** — the app restarts. Mark the token as a **deployment slot setting** if only one slot should send telemetry.",
            ),
          ]),
          sdkEnvBlock(otlpEndpoint(context), [
            "# The Key Vault reference, which resolves to the header from step 2.",
            `OTEL_EXPORTER_OTLP_HEADERS=${keyVaultReference}`,
            `OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=${example.accountId}`,
            "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure",
          ]),
          tx(
            "Replace the subscription id with your own — no detector sets `cloud.account.id`. `OTEL_NODE_RESOURCE_DETECTORS` is for Node.js; on .NET use `OpenTelemetry.Resources.Azure` with `AddAzureAppServiceDetector()`. Other languages add `cloud.provider=azure,cloud.platform=azure_app_service,cloud.region=<region>` to `OTEL_RESOURCE_ATTRIBUTES` and set `service.instance.id` from `WEBSITE_INSTANCE_ID` in code.",
          ),
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "Key Vault access for the managed identity, and VNet integration.",
        ),
        [
          tx(
            "The managed identity needs **Key Vault Secrets User** on the vault for the reference to resolve; an unresolved reference is passed through as the literal `@Microsoft.KeyVault(...)` string and the exporter gets `401`.",
          ),
          tx(
            "App Service reaches `{{host}}` directly unless **VNet integration** with **Route All** is on, in which case the VNet needs a NAT gateway or a firewall route allowing TCP 443 to that host.",
            { host },
          ),
        ],
      ),
      identificationTopic(
        translationKey(
          "The Azure detectors fill in the platform, region and instance, but not the subscription.",
        ),
        tx(
          "The Node and .NET Azure detectors (and the Collector's `azureappservice` detector) read the `WEBSITE_*` variables and set `cloud.platform`, `cloud.region`, `service.instance.id` (`WEBSITE_INSTANCE_ID`) and `host.id`. The SDK detectors spell the platform `azure.app_service`; OneUptime rewrites it to `azure_app_service` on ingest. None of them sets `cloud.account.id`, so add the subscription id by hand or the environment key gets an empty account segment.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per instance.",
        ),
        instances: tx(
          "**Instances** — one row per instance, named from `service.instance.id` — `WEBSITE_INSTANCE_ID`, which the Azure detectors set — otherwise from `host.id`.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — App Service exposes no container stats to the application; the tiles stay empty and the Requests tiles are the ones to read.",
        ),
      }),
    ],
    troubleshooting: [
      refusedExportsTopic(
        tx(
          "The Key Vault reference did not resolve, so App Service passed the literal `@Microsoft.KeyVault(...)` string through as the header. Give the app's managed identity **Key Vault Secrets User** on the vault, and check that the secret holds the whole header `x-oneuptime-token=...`.",
        ),
      ),
      {
        title: "The environment key has an empty account segment",
        markdown: tx(
          "None of the App Service detectors sets `cloud.account.id`. Add the subscription id to `OTEL_RESOURCE_ATTRIBUTES` (step 3) on every app: telemetry with and without it lands in two different environments, and the one without stops receiving telemetry once every app sends it.",
        ),
      },
      environmentMissingTopic(context),
    ],
    links: cloudLinks(context),
  };
};

const buildAzureContainerInstancesGuide: CloudGuideBuilder = (
  context: CloudGuideContext,
): SetupGuideContent => {
  const tx: CloudGuideText = context.tx;
  const host: string = oneuptimeHost(context);
  const example: ProviderExample =
    PROVIDER_EXAMPLES[context.descriptor.provider];

  return {
    keyStep: cloudKeyStep(
      context,
      tx(
        "It is a secret: the next step passes it as a secure environment variable, which — unlike a plain environment variable — is not shown in the portal or returned by az container show.",
      ),
    ),
    intro: tx(
      "Every container group that reports `cloud.platform={{platform}}` is grouped into one **Cloud Environment** per subscription and region, such as _{{name}}_. No resource detector exists for Container Instances, so the `cloud.*` attributes are set by hand.",
      environmentValues(context),
    ),
    prerequisites: [
      tx(
        "The Azure CLI (`az`), signed in to the subscription — or the Azure portal",
      ),
      tx(
        "Your application's container image, instrumented with an OpenTelemetry SDK that exports OTLP",
      ),
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
          tx(
            "Replace the region and subscription id with your own. A secure variable is not returned by `az container show` or shown in the portal; a plain one is. The host detector's `host.name`, the group's hostname, names the instance.",
          ),
          tx("In the portal instead:"),
          numbered([
            tx(
              "**Azure portal → Container Instances → + Create** → fill in **Basics** (resource group, name, region, image).",
            ),
            tx(
              "**Advanced** tab → **Environment variables**: add each variable above; for `OTEL_EXPORTER_OTLP_HEADERS` set **Mark as secure: Yes**.",
            ),
            tx("**Review + create → Create**."),
          ]),
          pickKeyNote(context),
        ]),
      },
      verifyStep(context),
    ],
    advanced: [
      networkingTopic(
        translationKey(
          "No role is needed. Groups in a VNet subnet need an outbound route.",
        ),
        [
          tx("No role assignment is needed for telemetry."),
          tx(
            "A group with a public IP reaches `{{host}}` directly. One in a VNet subnet has outbound access only through the VNet's route — add a NAT gateway or allow TCP 443 to that host on the firewall / NSG.",
            { host },
          ),
        ],
      ),
      {
        title: "Run a sidecar collector",
        summary: translationKey(
          "A container group can run a collector next to the app, as on Container Apps.",
        ),
        markdown: tx(
          "A sidecar collector works here too — a container group is a multi-container unit — with the same `detectors: [env]` plus `OTEL_RESOURCE_ATTRIBUTES` pattern as Azure Container Apps. It is also what fills the CPU / Memory tiles here, if it ships `container.cpu.utilization` / `container.memory.usage` with the group's identity.",
        ),
      },
      identificationTopic(
        translationKey(
          "No detector exists, so the cloud attributes are set by hand.",
        ),
        tx(
          "No resource detector exists for Container Instances: the `cloud.*` attributes come from `OTEL_RESOURCE_ATTRIBUTES`, set by hand. The host detector's `host.name` (the container group's hostname) is the instance identity.",
        ),
      ),
      environmentShowsTopic(context, {
        summary: translationKey(
          "Requests, errors and latency, and one row per container group.",
        ),
        instances: tx(
          "**Instances** — one row per container group, named from `service.instance.id` when the telemetry carries one, otherwise from `host.name` — the group's hostname.",
        ),
        cpuMemory: tx(
          "**CPU / Memory** tiles — fill only if a sidecar collector in the group ships `container.cpu.utilization` / `container.memory.usage` with the group's identity.",
        ),
      }),
    ],
    troubleshooting: [
      {
        title: "A changed variable has no effect",
        markdown: tx(
          "A container group's environment variables are fixed at creation. Delete the group and create it again with the new values.",
        ),
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
 * OneUptime URL and ingestion key, and worded in the translator's language
 * (English without one). A platform the registry does not know falls back
 * to the default rather than throwing.
 */
export function getCloudSetupGuide(
  options: CloudSetupGuideOptions,
): SetupGuideContent {
  const descriptor: ManagedCloudPlatformDescriptor =
    getManagedCloudPlatformDescriptor(resolveCloudPlatform(options.platform))!;
  const translator: Translator = options.translator || ENGLISH;

  return CLOUD_GUIDE_BUILDERS[descriptor.platform]({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    descriptor: descriptor,
    translator: translator,
    tx: (text: string, values?: Record<string, string> | undefined): string => {
      return values
        ? translator.translateTemplate(text, values)
        : translator.translateText(text) || text;
    },
  });
}
