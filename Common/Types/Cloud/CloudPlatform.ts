/*
 * The managed cloud compute platforms OneUptime groups into a **Cloud
 * Environment** (one row per cloud.platform + cloud.account.id +
 * cloud.region), and everything that has to agree about them.
 *
 * This is the single source of truth for:
 *
 *   - the telemetry ingest gate (OtelIngestBaseService.autoDiscoverCloudResource)
 *   - the environment key / display name that ingest mints
 *   - the Cloud Resources create form in the dashboard
 *   - the platform picker on the in-app "Connect" guide
 *   - the docs pages and the tests that pin the docs to the product
 *
 * The values are the OpenTelemetry semantic-convention `cloud.platform`
 * strings (https://opentelemetry.io/docs/specs/semconv/resource/cloud/).
 * Raw virtual machines (aws_ec2, gcp_compute_engine, azure_vm) are
 * deliberately absent — they stay Hosts — and Kubernetes platforms route via
 * the k8s.* attributes. Function-as-a-Service platforms are listed separately
 * so the Serverless product and this one never claim the same resource by
 * accident.
 */

export enum CloudProvider {
  AWS = "aws",
  GCP = "gcp",
  Azure = "azure",
}

export enum ManagedCloudPlatform {
  AwsEcs = "aws_ecs",
  AwsElasticBeanstalk = "aws_elastic_beanstalk",
  AwsAppRunner = "aws_app_runner",
  GcpCloudRun = "gcp_cloud_run",
  GcpAppEngine = "gcp_app_engine",
  AzureContainerApps = "azure_container_apps",
  AzureContainerInstances = "azure_container_instances",
  AzureAppService = "azure_app_service",
}

/*
 * cloud.platform values that denote a Function-as-a-Service runtime. Owned by
 * the Serverless Functions product; listed here so the two products share one
 * vocabulary and the docs can say which is which.
 */
export enum FaasCloudPlatform {
  AwsLambda = "aws_lambda",
  GcpCloudFunctions = "gcp_cloud_functions",
  AzureFunctions = "azure_functions",
  TencentCloudScf = "tencent_cloud_scf",
  AlibabaCloudFc = "alibaba_cloud_fc",
}

export interface ManagedCloudPlatformDescriptor {
  platform: ManagedCloudPlatform;
  provider: CloudProvider;
  /*
   * Short display label. Ingest mints environment names from this
   * ("AWS ECS · us-east-1 · 123456789012"), so changing a label renames
   * every environment discovered after the change — keep them stable.
   */
  label: string;
  /* Longer, human-facing product name used by docs and pickers. */
  productName: string;
  /* One line for pickers and the docs hub. */
  description: string;
  /* Docs page with the end-to-end setup walkthrough for this platform. */
  docsUrl: string;
  /*
   * How the cloud.* resource attributes normally get filled in on this
   * platform: an OpenTelemetry resource detector, or by hand.
   */
  detection: "detector" | "manual";
  /*
   * The resource attribute that identifies one running task / instance /
   * replica on this platform, after `service.instance.id`. Mirrors the order
   * in CloudInstanceIdentity — listed here so the docs can name it.
   */
  instanceAttribute: string;
}

export const MANAGED_CLOUD_PLATFORMS: ReadonlyArray<ManagedCloudPlatformDescriptor> =
  [
    {
      platform: ManagedCloudPlatform.AwsEcs,
      provider: CloudProvider.AWS,
      label: "AWS ECS",
      productName: "AWS ECS / Fargate",
      description:
        "Tasks on Amazon Elastic Container Service, on Fargate or EC2 launch types.",
      docsUrl: "/docs/telemetry/cloud-aws-ecs",
      detection: "detector",
      instanceAttribute: "aws.ecs.task.arn",
    },
    {
      platform: ManagedCloudPlatform.AwsElasticBeanstalk,
      provider: CloudProvider.AWS,
      label: "AWS Elastic Beanstalk",
      productName: "AWS Elastic Beanstalk",
      description: "Environments managed by AWS Elastic Beanstalk.",
      docsUrl: "/docs/telemetry/cloud-other-platforms",
      detection: "detector",
      instanceAttribute: "host.id",
    },
    {
      platform: ManagedCloudPlatform.AwsAppRunner,
      provider: CloudProvider.AWS,
      label: "AWS App Runner",
      productName: "AWS App Runner",
      description: "Services running on AWS App Runner.",
      docsUrl: "/docs/telemetry/cloud-other-platforms",
      detection: "manual",
      instanceAttribute: "host.name",
    },
    {
      platform: ManagedCloudPlatform.GcpCloudRun,
      provider: CloudProvider.GCP,
      label: "GCP Cloud Run",
      productName: "Google Cloud Run",
      description: "Cloud Run services and jobs.",
      docsUrl: "/docs/telemetry/cloud-gcp-cloud-run",
      detection: "detector",
      instanceAttribute: "faas.instance",
    },
    {
      platform: ManagedCloudPlatform.GcpAppEngine,
      provider: CloudProvider.GCP,
      label: "GCP App Engine",
      productName: "Google App Engine",
      description: "App Engine standard and flexible environments.",
      docsUrl: "/docs/telemetry/cloud-other-platforms",
      detection: "detector",
      instanceAttribute: "faas.instance",
    },
    {
      platform: ManagedCloudPlatform.AzureContainerApps,
      provider: CloudProvider.Azure,
      label: "Azure Container Apps",
      productName: "Azure Container Apps",
      description: "Container Apps replicas in a Container Apps environment.",
      docsUrl: "/docs/telemetry/cloud-azure-container-apps",
      /*
       * The Collector's `azurecontainerapps` detector and the Node / .NET
       * Azure detectors read CONTAINER_APP_NAME / CONTAINER_APP_REPLICA_NAME.
       * None of them knows the region or subscription, so those two still
       * come from OTEL_RESOURCE_ATTRIBUTES — the docs page says so.
       */
      detection: "detector",
      instanceAttribute: "azure.container_app.instance.id",
    },
    {
      platform: ManagedCloudPlatform.AzureContainerInstances,
      provider: CloudProvider.Azure,
      label: "Azure Container Instances",
      productName: "Azure Container Instances",
      description: "Container groups on Azure Container Instances.",
      docsUrl: "/docs/telemetry/cloud-other-platforms",
      detection: "manual",
      instanceAttribute: "host.name",
    },
    {
      platform: ManagedCloudPlatform.AzureAppService,
      provider: CloudProvider.Azure,
      label: "Azure App Service",
      productName: "Azure App Service",
      description: "Web apps on Azure App Service.",
      docsUrl: "/docs/telemetry/cloud-other-platforms",
      detection: "detector",
      instanceAttribute: "host.id",
    },
  ];

const DESCRIPTORS_BY_PLATFORM: ReadonlyMap<
  string,
  ManagedCloudPlatformDescriptor
> = new Map(
  MANAGED_CLOUD_PLATFORMS.map(
    (
      descriptor: ManagedCloudPlatformDescriptor,
    ): [string, ManagedCloudPlatformDescriptor] => {
      return [descriptor.platform, descriptor];
    },
  ),
);

export const MANAGED_CLOUD_PLATFORM_VALUES: ReadonlySet<string> = new Set(
  MANAGED_CLOUD_PLATFORMS.map((descriptor: ManagedCloudPlatformDescriptor) => {
    return descriptor.platform;
  }),
);

export const FAAS_CLOUD_PLATFORM_VALUES: ReadonlySet<string> = new Set(
  Object.values(FaasCloudPlatform),
);

export const CLOUD_PROVIDER_LABELS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "AWS",
  [CloudProvider.GCP]: "Google Cloud",
  [CloudProvider.Azure]: "Azure",
};

/*
 * Spellings of cloud.platform that mean one of the semconv values above but
 * are not written that way. The Node (@opentelemetry/resource-detector-azure)
 * and .NET (OpenTelemetry.Resources.Azure) Azure detectors emit dotted
 * values — "azure.container_apps", "azure.app_service", "azure.functions",
 * "azure.vm" — where the semantic conventions and the Collector's own Azure
 * detectors use underscores. Without this table an application on Container
 * Apps that used the official SDK detector never became a Cloud Environment
 * and, worse, one team's Node app and another's Collector sidecar in the
 * same subscription landed in two different environments.
 *
 * Ingest rewrites the attribute itself (OtelIngestBaseService) so the value
 * stored on the environment row and the value stored on every span, log and
 * metric agree — the dashboard scopes an environment's telemetry by exact
 * attribute match, so the two must be spelled identically.
 */
export const CLOUD_PLATFORM_ALIASES: Readonly<Record<string, string>> = {
  "azure.container_apps": ManagedCloudPlatform.AzureContainerApps,
  "azure.container_instances": ManagedCloudPlatform.AzureContainerInstances,
  "azure.app_service": ManagedCloudPlatform.AzureAppService,
  "azure.functions": FaasCloudPlatform.AzureFunctions,
  "azure.vm": "azure_vm",
  "azure.aks": "azure_aks",
};

/*
 * Canonical cloud.platform for a value as sent. Trims, maps the known
 * aliases above, and otherwise returns the value untouched — an unknown
 * platform is still unknown, it is just not mis-spelled. Null in, null out.
 */
export function normalizeCloudPlatform(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const trimmed: string = value.trim();
  if (!trimmed) {
    return null;
  }
  /*
   * Own-property lookup only: the value comes off the wire, and a plain
   * object lookup would hand back Object.prototype members for
   * "constructor" / "__proto__" / "toString" — a function, not a platform.
   */
  const alias: string | undefined = Object.prototype.hasOwnProperty.call(
    CLOUD_PLATFORM_ALIASES,
    trimmed,
  )
    ? CLOUD_PLATFORM_ALIASES[trimmed]
    : undefined;
  return typeof alias === "string" && alias ? alias : trimmed;
}

export function isManagedCloudPlatform(
  value: string | null | undefined,
): boolean {
  return Boolean(value) && MANAGED_CLOUD_PLATFORM_VALUES.has(value as string);
}

export function isFaasCloudPlatform(value: string | null | undefined): boolean {
  return Boolean(value) && FAAS_CLOUD_PLATFORM_VALUES.has(value as string);
}

export function getManagedCloudPlatformDescriptor(
  platform: string | null | undefined,
): ManagedCloudPlatformDescriptor | null {
  if (!platform) {
    return null;
  }
  return DESCRIPTORS_BY_PLATFORM.get(platform) || null;
}

/*
 * Display label for a platform. Unknown values fall back to the raw string
 * so nothing renders blank.
 */
export function getManagedCloudPlatformLabel(
  platform: string | null | undefined,
): string {
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(platform);
  return descriptor ? descriptor.label : platform || "";
}

export function getCloudProviderForPlatform(
  platform: string | null | undefined,
): CloudProvider | null {
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(platform);
  return descriptor ? descriptor.provider : null;
}

export function getCloudProviderLabel(
  provider: string | null | undefined,
): string {
  if (!provider) {
    return "";
  }
  const label: string | undefined =
    CLOUD_PROVIDER_LABELS[provider as CloudProvider];
  return label || provider;
}

export interface CloudEnvironmentIdentity {
  platform: string;
  accountId?: string | null | undefined;
  region?: string | null | undefined;
}

/*
 * The environment key is the CloudResource.resourceIdentifier. It is what a
 * manually created environment must carry for ingest to find it instead of
 * creating a duplicate, so it is built in exactly one place. Missing parts
 * are kept as empty segments ("aws_ecs||us-east-1") rather than dropped, so
 * an environment that later gains an account id does not silently split.
 */
export const CLOUD_ENVIRONMENT_KEY_SEPARATOR: string = "|";

export function buildCloudEnvironmentKey(
  identity: CloudEnvironmentIdentity,
): string {
  return [
    identity.platform.trim(),
    (identity.accountId || "").trim(),
    (identity.region || "").trim(),
  ].join(CLOUD_ENVIRONMENT_KEY_SEPARATOR);
}

export interface ParsedCloudEnvironmentKey {
  platform: string;
  accountId: string;
  region: string;
}

export function parseCloudEnvironmentKey(
  key: string | null | undefined,
): ParsedCloudEnvironmentKey | null {
  if (!key) {
    return null;
  }
  const parts: Array<string> = key.split(CLOUD_ENVIRONMENT_KEY_SEPARATOR);
  if (parts.length !== 3 || !parts[0]) {
    return null;
  }
  return {
    platform: parts[0],
    accountId: parts[1] || "",
    region: parts[2] || "",
  };
}

/*
 * "AWS ECS · us-east-1 · 123456789012" — the name ingest gives a freshly
 * discovered environment, and the name the create form suggests.
 */
export function buildCloudEnvironmentName(
  identity: CloudEnvironmentIdentity,
): string {
  const parts: Array<string> = [
    getManagedCloudPlatformLabel(identity.platform),
  ];
  const region: string = (identity.region || "").trim();
  const accountId: string = (identity.accountId || "").trim();
  if (region) {
    parts.push(region);
  }
  if (accountId) {
    parts.push(accountId);
  }
  return parts.join(" · ");
}
