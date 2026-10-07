import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { AWS_CLOUDWATCH_DISCOVERY_NAMESPACES } from "Common/Types/Cloud/CloudResourceCatalog";
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

/*
 * The "Discover your cloud resources" guide: connect a cloud account so its
 * IaaS and PaaS resources appear under Cloud → All Resources.
 *
 * Nothing about the cloud account is given to OneUptime. An OpenTelemetry
 * Collector the reader runs - with read-only access to the provider's
 * monitoring API - reads the metrics the provider publishes about every
 * resource and exports them to OneUptime; ingest tells from each datapoint
 * which resource it is about (Common/Types/Cloud/CloudMonitoredResource) and
 * creates the Cloud Resource. So each guide is the same four steps: grant
 * read access, configure the collector, run it, verify.
 *
 * The collector configurations here are the receivers' own shapes - the
 * ones the resolver reads - and the docs page (/docs/telemetry/cloud-resources)
 * carries the same ones; CloudMonitoringSetupGuide.test parses both.
 */

export enum CloudMonitoringGuideOption {
  AzureMonitor = "azure_monitor",
  AwsCloudWatch = "aws_cloudwatch",
  AwsMetricStreams = "aws_metric_streams",
  GoogleCloudMonitoring = "googlecloudmonitoring",
}

// The guide a page without a provider in mind opens on.
export const DEFAULT_CLOUD_MONITORING_GUIDE_OPTION: CloudMonitoringGuideOption =
  CloudMonitoringGuideOption.AwsCloudWatch;

export const CLOUD_MONITORING_GUIDE_OPTIONS: Array<
  SetupGuideOption<CloudMonitoringGuideOption>
> = [
  {
    key: CloudMonitoringGuideOption.AwsCloudWatch,
    label: "CloudWatch (polling)",
    description: "The collector reads CloudWatch for the namespaces you pick.",
    group: "AWS",
  },
  {
    key: CloudMonitoringGuideOption.AwsMetricStreams,
    label: "CloudWatch Metric Streams",
    description:
      "CloudWatch pushes metrics to the collector through Amazon Data Firehose.",
    group: "AWS",
  },
  {
    key: CloudMonitoringGuideOption.AzureMonitor,
    label: "Azure Monitor",
    description: "Every resource in an Azure subscription.",
    group: "Azure",
  },
  {
    key: CloudMonitoringGuideOption.GoogleCloudMonitoring,
    label: "Cloud Monitoring",
    description: "The Google Cloud resources of a project.",
    group: "Google Cloud",
  },
];

// The guide each provider's resources were discovered through, by default.
const OPTION_BY_PROVIDER: Readonly<
  Record<CloudProvider, CloudMonitoringGuideOption>
> = {
  [CloudProvider.AWS]: CloudMonitoringGuideOption.AwsCloudWatch,
  [CloudProvider.Azure]: CloudMonitoringGuideOption.AzureMonitor,
  [CloudProvider.GCP]: CloudMonitoringGuideOption.GoogleCloudMonitoring,
};

/*
 * The guide to open on for a value a page has: an option key as is, a
 * provider ("azure", "aws", "gcp") as its guide - a resource's page opens on
 * its own provider's - and anything else as the default.
 */
export function resolveCloudMonitoringGuideOption(
  value: string | null | undefined,
): CloudMonitoringGuideOption {
  const text: string = (value || "").trim();
  const options: Array<string> = Object.values(CloudMonitoringGuideOption);
  if (options.includes(text)) {
    return text as CloudMonitoringGuideOption;
  }
  const byProvider: CloudMonitoringGuideOption | undefined =
    OPTION_BY_PROVIDER[text.toLowerCase() as CloudProvider];
  return byProvider || DEFAULT_CLOUD_MONITORING_GUIDE_OPTION;
}

export interface CloudMonitoringSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  option: CloudMonitoringGuideOption;
}

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
}

export const CLOUD_RESOURCES_DOCS_URL: string =
  "/docs/telemetry/cloud-resources";
export const COLLECTOR_IMAGE: string =
  "otel/opentelemetry-collector-contrib:latest";
// Where the contrib image reads its configuration from.
const COLLECTOR_CONFIG_PATH: string = "/etc/otelcol-contrib/config.yaml";

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

function otlpEndpoint(context: GuideContext): string {
  return `${context.oneuptimeUrl}/otlp`;
}

/*
 * The exporter and the batch processor every guide's collector shares. The
 * token is read from ONEUPTIME_TOKEN, which `docker run -e` sets, so it is
 * never written into the configuration file.
 */
function exporterLines(context: GuideContext): Array<string> {
  return [
    "exporters:",
    "  otlphttp/oneuptime:",
    `    endpoint: ${otlpEndpoint(context)}`,
    "    headers:",
    "      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}",
  ];
}

function keyStep(context: GuideContext): SetupGuideKeyStep {
  return {
    description:
      "Pick a Server key, or create one — the commands below update to use it. The collector reads it from an environment variable, never from its configuration file.",
    endpointLabel: "OTLP Endpoint",
    endpointValue: otlpEndpoint(context),
  };
}

/*
 * `docker run` for the collector: one flag per line, every line but the last
 * continued. `flags` are the provider's own (credentials, ports, mounts);
 * `note` is markdown under the command.
 */
function runStep(
  context: GuideContext,
  flags: Array<string>,
  note: string = "",
): SetupGuideStep {
  return {
    title: "Run the collector",
    description:
      "Run it anywhere with outbound access to your cloud provider and to OneUptime: a small VM, a container, or your Kubernetes cluster.",
    markdown: paragraphs([
      codeBlock(
        "bash",
        [
          "docker run -d --name oneuptime-cloud-collector --restart unless-stopped \\",
          `  -e ONEUPTIME_TOKEN=${shellQuote(context.apiKey)} \\`,
          ...flags.map((flag: string): string => {
            return `  ${flag} \\`;
          }),
          `  -v "$(pwd)/config.yaml:${COLLECTOR_CONFIG_PATH}" \\`,
          `  ${COLLECTOR_IMAGE}`,
        ].join("\n"),
      ),
      note,
    ]),
  };
}

function verifyStep(context: GuideContext, timing: string): SetupGuideStep {
  return {
    title: "Verify",
    description: "Check the token first, then look for the resources.",
    markdown: paragraphs([
      codeBlock(
        "bash",
        `curl -i ${shellQuote(`${otlpEndpoint(context)}/v1/validate`)} \\
  -H "x-oneuptime-token: ${context.apiKey}"`,
      ),
      '`200` with `"valid": true` means the token resolves to this project; `401` means it is unknown, revoked or mistyped.',
      `Then open **Cloud → All Resources**. ${timing} Each resource's **Metrics** tab lists what its provider reports; open a metric and choose **Create monitor from this view** to alert on it.`,
      context.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
        ? `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`
        : "",
    ]),
  };
}

const COLLECTOR_HOST_TOPIC: SetupGuideTopic = {
  title: "Keep this pipeline free of resource detection",
  summary: "Otherwise the metrics are filed under the collector's own host",
  markdown:
    "Do not add the `resourcedetection` processor to this pipeline. It stamps the collector machine's own `host.name` and `os.type` on every datapoint, and OneUptime then files your cloud's metrics under that machine in **Hosts** as well. A collector that also monitors its own host should do that in a pipeline of its own.",
};

function identityTopic(markdown: string): SetupGuideTopic {
  return {
    title: "How a resource is identified",
    summary: "One Cloud Resource per resource the provider reports on",
    markdown: markdown,
  };
}

function noResourcesTopic(items: Array<string>): SetupGuideTopic {
  return {
    title: "No resources appear",
    markdown: numbered([
      "Run the token check from the last step: `401` means the token is unknown, revoked or mistyped.",
      "Read the collector's log (`docker logs oneuptime-cloud-collector`). An authentication or authorization error names the permission the collector is missing.",
      ...items,
      `Still nothing? The [Cloud Resources documentation](${CLOUD_RESOURCES_DOCS_URL}#troubleshooting) works through the rest.`,
    ]),
  };
}

const NOT_REPORTING_TOPIC: SetupGuideTopic = {
  title: "A resource reads Not reporting",
  markdown:
    "A resource reads **Not reporting** after an hour without a single datapoint. Some resources are quiet by nature — a Key Vault nobody called, a bucket whose storage metrics CloudWatch publishes once a day — and come back with their next datapoint. One that sends nothing for 7 days is archived, and restored as soon as it reports again.",
};

function links(): Array<SetupGuideLink> {
  return [
    {
      title: "Cloud Resources documentation",
      url: CLOUD_RESOURCES_DOCS_URL,
    },
  ];
}

/*
 * ---- Azure Monitor -------------------------------------------------------
 */

export function getAzureMonitorCollectorConfig(context: GuideContext): string {
  return codeBlock(
    "yaml",
    [
      "extensions:",
      "  azure_auth:",
      "    service_principal:",
      "      tenant_id: ${env:AZURE_TENANT_ID}",
      "      client_id: ${env:AZURE_CLIENT_ID}",
      "      client_secret: ${env:AZURE_CLIENT_SECRET}",
      "",
      "receivers:",
      "  azure_monitor:",
      '    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]',
      "    auth:",
      "      authenticator: azure_auth",
      "    collection_interval: 60s",
      "    # No `services` list: every resource type in the subscription.",
      "    # Series Azure returns per metric and resource (default 10).",
      "    maximum_number_of_records_per_resource: 50",
      "",
      "processors:",
      "  batch: {}",
      "",
      ...exporterLines(context),
      "",
      "service:",
      "  extensions: [azure_auth]",
      "  pipelines:",
      "    metrics:",
      "      receivers: [azure_monitor]",
      "      processors: [batch]",
      "      exporters: [otlphttp/oneuptime]",
    ].join("\n"),
  );
}

function buildAzureMonitorGuide(context: GuideContext): SetupGuideContent {
  return {
    keyStep: keyStep(context),
    intro: paragraphs([
      "An OpenTelemetry Collector reads Azure Monitor's platform metrics for every resource in a subscription — virtual machines, App Service plans and apps, SQL databases, storage accounts, load balancers, Key Vaults and the rest — and sends them to OneUptime. Each resource appears under **Cloud → All Resources**, with its metrics, owners and labels.",
      "The collector only needs to read metrics: OneUptime never holds your Azure credentials.",
    ]),
    prerequisites: [
      "An Azure subscription, and permission to create a service principal in its tenant",
      "The Azure CLI (`az`), signed in to that tenant",
      "Docker, or any other place to run the OpenTelemetry Collector (contrib distribution)",
    ],
    steps: [
      {
        title: "Give the collector read access",
        description:
          "Create a service principal that can read metrics and list resources, and nothing else.",
        markdown: paragraphs([
          codeBlock(
            "bash",
            `az ad sp create-for-rbac \\
  --name oneuptime-cloud-collector \\
  --role "Monitoring Reader" \\
  --scopes /subscriptions/<SUBSCRIPTION_ID>`,
          ),
          "It prints an `appId` (the client id), a `password` (the client secret) and the `tenant`: keep them for the next steps. **Monitoring Reader** reads metrics and lists resources; it cannot change anything. Give it the role on more subscriptions to read them with the same collector.",
        ]),
      },
      {
        title: "Configure the collector",
        description:
          "Save this as config.yaml. With no list of services, every resource type in the subscription is read.",
        markdown: getAzureMonitorCollectorConfig(context),
      },
      runStep(context, [
        "-e AZURE_TENANT_ID=<TENANT>",
        "-e AZURE_CLIENT_ID=<APP_ID>",
        "-e AZURE_CLIENT_SECRET=<PASSWORD>",
        "-e AZURE_SUBSCRIPTION_ID=<SUBSCRIPTION_ID>",
      ]),
      verifyStep(
        context,
        "The receiver lists the subscription's resources, then reads their metrics every minute: resources appear within a few minutes of the collector starting.",
      ),
    ],
    advanced: [
      {
        title: "Read fewer resources or metrics",
        summary: "Filter by resource group, service or tag",
        markdown: paragraphs([
          bullets([
            "`resource_groups: [rg-prod, rg-data]` reads those resource groups only.",
            "`services: [Microsoft.Compute/virtualMachines, Microsoft.Sql/servers/databases]` reads those resource types only.",
            "`resource_tags: [{ name: environment, value: production }]` reads the resources carrying that tag.",
            "`metrics:` limits each resource type to the metrics and aggregations you list — once a type is listed, only its listed metrics are read.",
          ]),
          "`discover_subscriptions: true` reads every subscription the service principal can see, instead of `subscription_ids`.",
        ]),
      },
      {
        title: "Large subscriptions",
        summary: "Azure's API limits, and the batch API",
        markdown:
          "The receiver makes one Resource Manager call per resource and batch of 20 metrics, and Resource Manager allows about 12,000 reads per hour. For a subscription with hundreds of resources, set `use_batch_api: true`: it reads up to 50 resources per call from the Azure Monitor data plane, whose limit is far higher. `maximum_number_of_records_per_resource` is how many series Azure returns per metric and resource; raise it when a resource's metrics split by a dimension with many values.",
      },
      COLLECTOR_HOST_TOPIC,
      identityTopic(
        "Every datapoint carries its resource's Azure resource id (`azuremonitor.resource_id`), so every resource the receiver reads becomes a Cloud Resource — the common types with a friendly name (Virtual Machine, Storage Account, SQL Database, …), any other under its Resource Manager type. The resource id is what identifies it, without regard to case; its name, region, subscription and resource group are shown with it.",
      ),
    ],
    troubleshooting: [
      noResourcesTopic([
        "`AuthorizationFailed` means the service principal lacks **Monitoring Reader** on the subscription; `AADSTS` errors mean the tenant, client id or secret is wrong.",
        "The receiver lists resources once a day by default (`cache_resources`): a resource created after the collector started can take up to a day to appear. Restart the collector to list them now.",
      ]),
      NOT_REPORTING_TOPIC,
    ],
    links: links(),
  };
}

/*
 * ---- CloudWatch, polling -------------------------------------------------
 */

// The namespaces the polling example reads: the common IaaS and PaaS ones.
export const AWS_POLLING_EXAMPLE_NAMESPACES: ReadonlyArray<string> = [
  "AWS/EC2",
  "AWS/EBS",
  "AWS/ApplicationELB",
  "AWS/RDS",
  "AWS/Lambda",
  "AWS/DynamoDB",
];

function awsReceiverName(namespace: string): string {
  return `aws_cloudwatch/${namespace.split("/")[1]!.toLowerCase()}`;
}

export function getAwsCloudWatchCollectorConfig(context: GuideContext): string {
  const receivers: Array<string> = [];

  for (const namespace of AWS_POLLING_EXAMPLE_NAMESPACES) {
    receivers.push(
      `  ${awsReceiverName(namespace)}:`,
      "    region: ${env:AWS_REGION}",
      "    metrics:",
      "      collection_interval: 5m",
      "      period: 5m",
      "      delay: 10m",
      "      discovery:",
      "        filters:",
      `          namespace: ${namespace}`,
      "        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.",
      "        limit: 1000",
    );
  }

  return codeBlock(
    "yaml",
    [
      "receivers:",
      ...receivers,
      "",
      "processors:",
      "  batch: {}",
      "",
      ...exporterLines(context),
      "",
      "service:",
      "  pipelines:",
      "    metrics:",
      `      receivers: [${AWS_POLLING_EXAMPLE_NAMESPACES.map(awsReceiverName).join(", ")}]`,
      "      processors: [batch]",
      "      exporters: [otlphttp/oneuptime]",
    ].join("\n"),
  );
}

export const AWS_READ_POLICY: string = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "cloudwatch:ListMetrics",
          "cloudwatch:GetMetricData",
          "sts:GetCallerIdentity",
        ],
        Resource: "*",
      },
    ],
  },
  null,
  2,
);

function buildAwsCloudWatchGuide(context: GuideContext): SetupGuideContent {
  return {
    keyStep: keyStep(context),
    intro: paragraphs([
      "An OpenTelemetry Collector polls CloudWatch for the namespaces you pick — EC2 instances, EBS volumes, load balancers, RDS databases, Lambda functions, DynamoDB tables and more — and sends the metrics to OneUptime. Each resource appears under **Cloud → All Resources**, with its metrics, owners and labels.",
      "The collector only needs to read metrics: OneUptime never holds your AWS credentials.",
    ]),
    prerequisites: [
      "An AWS account, and permission to create an IAM policy and attach it to a role or user",
      "Docker, or any other place to run the OpenTelemetry Collector (contrib distribution)",
    ],
    steps: [
      {
        title: "Give the collector read access",
        description:
          "Create a policy that can read CloudWatch metrics, and nothing else.",
        markdown: paragraphs([
          codeBlock("json", AWS_READ_POLICY),
          "Attach it to the role the collector runs as — an EC2 instance profile, an ECS task role, an EKS service account — or to an IAM user whose access keys you give the collector. `sts:GetCallerIdentity` lets the receiver report the account id, which names each resource's ARN.",
        ]),
      },
      {
        title: "Configure the collector",
        description:
          "Save this as config.yaml. One receiver reads one namespace in one region: add one for each namespace and region you want.",
        markdown: getAwsCloudWatchCollectorConfig(context),
      },
      runStep(
        context,
        [
          "-e AWS_REGION=us-east-1",
          "-e AWS_ACCESS_KEY_ID=<ACCESS_KEY_ID>",
          "-e AWS_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY>",
        ],
        "On an EC2 instance, ECS task or EKS pod that has the role, leave out the two key variables: the collector uses the role's credentials.",
      ),
      verifyStep(
        context,
        "Each receiver lists its namespace's metrics, then reads them every five minutes, ten minutes behind (CloudWatch publishes each period a few minutes late): resources appear within about twenty minutes of the collector starting.",
      ),
    ],
    advanced: [
      {
        title: "Every namespace OneUptime recognises",
        summary: "Add a receiver for any of them",
        markdown: paragraphs([
          AWS_CLOUDWATCH_DISCOVERY_NAMESPACES.map(
            (namespace: string): string => {
              return `\`${namespace}\``;
            },
          ).join(", "),
          "A namespace that is not listed still reaches **Metrics**, but its datapoints name no resource OneUptime can tell apart, so no Cloud Resource is created for it. The [documentation](/docs/telemetry/cloud-resources#aws) lists the dimension that identifies a resource in each.",
        ]),
      },
      {
        title: "What polling costs",
        summary: "GetMetricData is billed per metric read",
        markdown:
          "Without `stats`, each metric is read as one summary — four statistics, four GetMetricData queries — per scrape, and AWS bills GetMetricData per metric requested. `discovery.limit` caps how many metrics a receiver reads per scrape, and a longer `collection_interval` reads them less often. For an account with thousands of metrics, CloudWatch Metric Streams usually cost less and arrive sooner.",
      },
      COLLECTOR_HOST_TOPIC,
      identityTopic(
        "A CloudWatch metric names its resource in a dimension that depends on the namespace — `InstanceId` in `AWS/EC2`, `LoadBalancer` in `AWS/ApplicationELB`, `DBInstanceIdentifier` in `AWS/RDS`. A datapoint carrying it is that resource's, together with its account and region; one aggregated over something else (`InstanceType`, an account-wide total) names no resource. Each resource is shown with its ARN where its metrics name it completely.",
      ),
    ],
    troubleshooting: [
      noResourcesTopic([
        "`AccessDenied` on `cloudwatch:ListMetrics` or `cloudwatch:GetMetricData` means the policy is not attached to the identity the collector runs as.",
        "Check `region`: one receiver reads one region, and a resource in another region is not read.",
      ]),
      {
        title: "Resources have no account or ARN",
        markdown:
          "The receiver reports the account id only when it may call `sts:GetCallerIdentity`. Without it, resources are named without their account and shown without an ARN; add the permission and they gain both. A resource read once with and once without the account id is two Cloud Resources: archive the one without.",
      },
      NOT_REPORTING_TOPIC,
    ],
    links: links(),
  };
}

/*
 * ---- CloudWatch Metric Streams ------------------------------------------
 */

export function getAwsMetricStreamsCollectorConfig(
  context: GuideContext,
): string {
  return codeBlock(
    "yaml",
    [
      "extensions:",
      "  awscloudwatchmetricstreams_encoding:",
      "    format: opentelemetry1.0",
      "",
      "receivers:",
      "  awsfirehose:",
      "    # Firehose delivers to HTTPS on port 443 only: expose this port as",
      "    # 443, for example behind a load balancer.",
      "    endpoint: 0.0.0.0:4433",
      "    encoding: awscloudwatchmetricstreams_encoding",
      "    access_key: ${env:FIREHOSE_ACCESS_KEY}",
      "    tls:",
      "      cert_file: /etc/otelcol-contrib/tls/server.crt",
      "      key_file: /etc/otelcol-contrib/tls/server.key",
      "",
      "processors:",
      "  batch: {}",
      "",
      ...exporterLines(context),
      "",
      "service:",
      "  extensions: [awscloudwatchmetricstreams_encoding]",
      "  pipelines:",
      "    metrics:",
      "      receivers: [awsfirehose]",
      "      processors: [batch]",
      "      exporters: [otlphttp/oneuptime]",
    ].join("\n"),
  );
}

function buildAwsMetricStreamsGuide(context: GuideContext): SetupGuideContent {
  return {
    keyStep: keyStep(context),
    intro: paragraphs([
      "A CloudWatch Metric Stream pushes metrics as CloudWatch publishes them, through Amazon Data Firehose, to an OpenTelemetry Collector that sends them to OneUptime. It suits large accounts: there is nothing to poll, and every namespace you include arrives within minutes. Each resource appears under **Cloud → All Resources**.",
      "Firehose delivers to the collector, so the collector has to be reachable from AWS over HTTPS. If it cannot be, use **CloudWatch (polling)** instead.",
    ]),
    prerequisites: [
      "An AWS account, and permission to create a Firehose stream and a CloudWatch Metric Stream",
      "A place to run the OpenTelemetry Collector (contrib distribution) that Firehose can reach over HTTPS on port 443, with a certificate",
    ],
    steps: [
      {
        title: "Configure the collector",
        description:
          "Save this as config.yaml, with a certificate and key for the collector's address next to it.",
        markdown: getAwsMetricStreamsCollectorConfig(context),
      },
      runStep(context, [
        "-e FIREHOSE_ACCESS_KEY=<A_LONG_RANDOM_SECRET>",
        "-p 4433:4433",
        '-v "$(pwd)/tls:/etc/otelcol-contrib/tls:ro"',
      ]),
      {
        title: "Create the Firehose stream and the metric stream",
        description:
          "Send the stream to the collector, in the OpenTelemetry 1.0 format.",
        markdown: numbered([
          "**Amazon Data Firehose → Create Firehose stream**: source **Direct PUT**, destination **HTTP Endpoint**. The endpoint URL is the collector's `https://` address on port 443; the access key is the `FIREHOSE_ACCESS_KEY` the collector was started with. Pick or create an S3 bucket for failed deliveries.",
          "**CloudWatch → Metrics → Streams → Create metric stream**: choose the namespaces to include (or all), the Firehose stream you just created, and the output format **OpenTelemetry 1.0**.",
          "Create a stream in each region you want: a metric stream carries the metrics of its own region.",
        ]),
      },
      verifyStep(
        context,
        "Resources appear within a few minutes of the stream starting, as CloudWatch publishes their metrics.",
      ),
    ],
    advanced: [
      {
        title: "What a metric stream costs",
        summary: "Billed per metric update streamed",
        markdown:
          "AWS bills a metric stream per metric update it delivers, plus Firehose's own data charges. Include only the namespaces you want — or exclude the busy ones you do not — to keep both down.",
      },
      {
        title: "The JSON output format",
        summary: "Works too; OpenTelemetry 1.0 is preferred",
        markdown:
          "A stream in the JSON format (`format: json` in the encoding extension) is read too, and names the same resources. Prefer OpenTelemetry 1.0: the JSON format also writes each namespace into `service.name`, so every namespace shows up in **Services** as well.",
      },
      COLLECTOR_HOST_TOPIC,
      identityTopic(
        "A CloudWatch metric names its resource in a dimension that depends on the namespace — `InstanceId` in `AWS/EC2`, `LoadBalancer` in `AWS/ApplicationELB`, `DBInstanceIdentifier` in `AWS/RDS`. A datapoint carrying it is that resource's, together with its account and region; one aggregated over something else names no resource. Each resource is shown with its ARN.",
      ),
    ],
    troubleshooting: [
      noResourcesTopic([
        "In the Firehose stream's **Monitoring** tab, failed HTTP endpoint deliveries mean Firehose cannot reach the collector, or the access key does not match.",
        "Check the metric stream's output format: it must be **OpenTelemetry 1.0** for the configuration above.",
      ]),
      NOT_REPORTING_TOPIC,
    ],
    links: links(),
  };
}

/*
 * ---- Google Cloud Monitoring ---------------------------------------------
 */

// The services whose metrics the example reads, by metric-type prefix.
export const GCP_EXAMPLE_METRIC_PREFIXES: ReadonlyArray<string> = [
  "compute.googleapis.com/",
  "cloudsql.googleapis.com/",
  "loadbalancing.googleapis.com/",
  "storage.googleapis.com/",
  "redis.googleapis.com/",
  "run.googleapis.com/",
];

export function getGoogleCloudMonitoringCollectorConfig(
  context: GuideContext,
): string {
  return codeBlock(
    "yaml",
    [
      "receivers:",
      "  googlecloudmonitoring:",
      "    project_id: ${env:GCP_PROJECT_ID}",
      "    collection_interval: 2m",
      "    # Only the metric types these filters list are read.",
      "    metrics_list:",
      ...GCP_EXAMPLE_METRIC_PREFIXES.map((prefix: string): string => {
        return `      - metric_descriptor_filter: 'metric.type = starts_with("${prefix}")'`;
      }),
      "",
      "processors:",
      "  batch: {}",
      "",
      ...exporterLines(context),
      "",
      "service:",
      "  pipelines:",
      "    metrics:",
      "      receivers: [googlecloudmonitoring]",
      "      processors: [batch]",
      "      exporters: [otlphttp/oneuptime]",
    ].join("\n"),
  );
}

function buildGoogleCloudMonitoringGuide(
  context: GuideContext,
): SetupGuideContent {
  return {
    keyStep: keyStep(context),
    intro: paragraphs([
      "An OpenTelemetry Collector reads Cloud Monitoring's metrics for the services you list — Compute Engine VMs, Cloud SQL, load balancers, Cloud Storage buckets, Memorystore, Cloud Run and more — and sends them to OneUptime. Each resource appears under **Cloud → All Resources**, with its metrics, owners and labels.",
      "The collector only needs to read metrics: OneUptime never holds your Google Cloud credentials.",
    ]),
    prerequisites: [
      "A Google Cloud project, and permission to create a service account and grant it a role",
      "The Google Cloud CLI (`gcloud`), signed in to that project",
      "Docker, or any other place to run the OpenTelemetry Collector (contrib distribution)",
    ],
    steps: [
      {
        title: "Give the collector read access",
        description:
          "Create a service account that can read metrics, and nothing else.",
        markdown: paragraphs([
          codeBlock(
            "bash",
            `gcloud iam service-accounts create oneuptime-cloud-collector \\
  --project <PROJECT_ID>

gcloud projects add-iam-policy-binding <PROJECT_ID> \\
  --member "serviceAccount:oneuptime-cloud-collector@<PROJECT_ID>.iam.gserviceaccount.com" \\
  --role roles/monitoring.viewer

gcloud iam service-accounts keys create key.json \\
  --iam-account oneuptime-cloud-collector@<PROJECT_ID>.iam.gserviceaccount.com`,
          ),
          "**Monitoring Viewer** reads metrics; it cannot change anything. On Google Cloud itself, run the collector as this service account instead of creating a key.",
        ]),
      },
      {
        title: "Configure the collector",
        description:
          "Save this as config.yaml. Each filter reads every metric type of one service; add one for each service you want.",
        markdown: getGoogleCloudMonitoringCollectorConfig(context),
      },
      runStep(context, [
        "-e GCP_PROJECT_ID=<PROJECT_ID>",
        "-e GOOGLE_APPLICATION_CREDENTIALS=/etc/otelcol-contrib/key.json",
        '-v "$(pwd)/key.json:/etc/otelcol-contrib/key.json:ro"',
      ]),
      verifyStep(
        context,
        "The receiver reads every two minutes, and Cloud Monitoring publishes most metrics a few minutes late: resources appear within about ten minutes of the collector starting.",
      ),
    ],
    advanced: [
      {
        title: "Which metric types are read",
        summary: "Only the ones `metrics_list` names",
        markdown:
          'The receiver reads only the metric types its `metrics_list` matches, and reads the list when it starts: restart the collector after a change. A filter such as `metric.type = starts_with("compute.googleapis.com/")` reads one service\'s every type; `metric_name: compute.googleapis.com/instance/cpu/utilization` reads one. One receiver reads one project: add one per project.',
      },
      {
        title: "What reading costs",
        summary: "Cloud Monitoring API reads and quotas",
        markdown:
          "Each metric type is one Cloud Monitoring API read per collection interval. Reading Google Cloud's own metrics is free within the API's monthly allowance, and project quotas limit reads per minute: a longer `collection_interval`, or fewer filters, keeps a large project inside both.",
      },
      COLLECTOR_HOST_TOPIC,
      identityTopic(
        "Cloud Monitoring names each metric's monitored resource with a type and labels — `gce_instance` with `project_id`, `zone` and `instance_id`; `cloudsql_database` with `database_id`. A datapoint of a type OneUptime recognises is that resource's; its own labels never split it. Kubernetes types (`k8s_container`, `k8s_pod`, …) are left to the Kubernetes product.",
      ),
    ],
    troubleshooting: [
      noResourcesTopic([
        "`PermissionDenied` means the service account lacks **Monitoring Viewer** on the project; a credentials error means `GOOGLE_APPLICATION_CREDENTIALS` does not point at the key.",
        "Check that `metrics_list` names the services whose resources you expect.",
      ]),
      NOT_REPORTING_TOPIC,
    ],
    links: links(),
  };
}

const GUIDE_BUILDERS: Readonly<
  Record<
    CloudMonitoringGuideOption,
    (context: GuideContext) => SetupGuideContent
  >
> = {
  [CloudMonitoringGuideOption.AzureMonitor]: buildAzureMonitorGuide,
  [CloudMonitoringGuideOption.AwsCloudWatch]: buildAwsCloudWatchGuide,
  [CloudMonitoringGuideOption.AwsMetricStreams]: buildAwsMetricStreamsGuide,
  [CloudMonitoringGuideOption.GoogleCloudMonitoring]:
    buildGoogleCloudMonitoringGuide,
};

export function getCloudMonitoringSetupGuide(
  options: CloudMonitoringSetupGuideOptions,
): SetupGuideContent {
  return GUIDE_BUILDERS[options.option]({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
  });
}
