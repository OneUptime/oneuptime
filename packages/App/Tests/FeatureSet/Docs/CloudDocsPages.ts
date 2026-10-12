/*
 * The Cloud docs pages (docs overhaul task 23), and how each of their bold
 * words and menu paths is named in every docs language. CloudDocsFacts holds
 * the English pages to the product; CloudDocsTranslations holds every
 * translation to its English page through these lists.
 *
 * A bold word on these pages is one of three things:
 *
 *   - a label of OneUptime's Dashboard ("Instances", "Create Cloud
 *     Resource"): each language names it as its Dashboard draws it;
 *   - a label of a cloud provider's console or a name of the provider's
 *     own ("Create new revision", "Key Vault Secrets User"): it stays as
 *     the console shows it in English, in every language, as the in-app
 *     guide shows it, because the docs cannot check how each console words
 *     it in each language. Some of these are Dashboard words by
 *     coincidence ("Create", "Settings", "Deploy"), so each page lists
 *     them;
 *   - one of the pages' own bold leads, which a translation words freely.
 *
 * A menu path is OneUptime's ("Cloud → All Environments") or a console's
 * ("AWS Console → ... → Task definitions"). A console path stays as it is in
 * every language. OneUptime's is drawn segment by segment: a product of the
 * Products menu by the menu's own title, the rest as Dashboard labels. Every
 * language but Persian bolds it as one span with " → " between the
 * segments; Persian, written right to left, bolds each segment on its own
 * with " > " between them, because ">" is mirrored with the text and "→" is
 * not.
 */

export const CLOUD_ENVIRONMENTS: string = "telemetry/cloud-environments";
export const CLOUD_AWS_ECS: string = "telemetry/cloud-aws-ecs";
export const CLOUD_GCP_CLOUD_RUN: string = "telemetry/cloud-gcp-cloud-run";
export const CLOUD_AZURE_CONTAINER_APPS: string =
  "telemetry/cloud-azure-container-apps";
export const CLOUD_OTHER_PLATFORMS: string = "telemetry/cloud-other-platforms";
export const CLOUD_TROUBLESHOOTING: string = "telemetry/cloud-troubleshooting";
export const CLOUD_RESOURCES: string = "telemetry/cloud-resources";

export interface CloudDocsPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const CLOUD_DOCS_PAGES: ReadonlyArray<CloudDocsPage> = [
  { page: CLOUD_ENVIRONMENTS, navTitle: "Cloud Environments" },
  { page: CLOUD_AWS_ECS, navTitle: "AWS ECS / Fargate" },
  { page: CLOUD_GCP_CLOUD_RUN, navTitle: "Google Cloud Run" },
  { page: CLOUD_AZURE_CONTAINER_APPS, navTitle: "Azure Container Apps" },
  { page: CLOUD_OTHER_PLATFORMS, navTitle: "Other Cloud Platforms" },
  { page: CLOUD_TROUBLESHOOTING, navTitle: "Cloud Troubleshooting" },
  { page: CLOUD_RESOURCES, navTitle: "Cloud Resources (IaaS & PaaS)" },
];

export const CLOUD_PAGE_NAMES: ReadonlyArray<string> = CLOUD_DOCS_PAGES.map(
  (entry: CloudDocsPage): string => {
    return entry.page;
  },
);

export const PERSIAN_PATH_SEPARATOR: string = " > ";

/*
 * The products of the Products menu a OneUptime path on these pages starts
 * at, with the navbar key the menu draws each one's title from.
 */
export const PRODUCTS_MENU_KEYS: Readonly<Record<string, string>> = {
  Cloud: "cloudTitle",
  "Project Settings": "projectSettingsTitle",
};

// The paths through a cloud provider's console, kept as they are.
export const CONSOLE_PATHS: Readonly<Record<string, Array<string>>> = {
  [CLOUD_AWS_ECS]: [
    "AWS Console → Amazon Elastic Container Service → Task definitions",
    "Docker configuration → Command",
    "Clusters → your cluster → Services → select the service → Update → Task definition revision: latest → Deploy",
  ],
  [CLOUD_GCP_CLOUD_RUN]: [
    "Google Cloud console → Cloud Run → click the service → Edit & deploy new revision",
  ],
  [CLOUD_AZURE_CONTAINER_APPS]: [
    "Azure portal → Container Apps → your app → Settings → Secrets → + Add",
    "Application → Containers → Edit and deploy",
  ],
  [CLOUD_OTHER_PLATFORMS]: [
    "AWS Console → Elastic Beanstalk → Environments → your environment → Configuration",
    "AWS Console → App Runner → Services → your service → Configuration → Configure service",
    "Security → Instance role",
    "App Engine → Versions",
    "App Engine → Services",
    "Settings → Identity",
    "Azure portal → App Services → your app → Settings → Environment variables",
    "Configuration → Application settings",
    "Azure portal → Container Instances → + Create",
  ],
  [CLOUD_RESOURCES]: [
    "Amazon Data Firehose → Create Firehose stream",
    "CloudWatch → Metrics → Streams → Create metric stream",
  ],
};

/*
 * The consoles' labels, the providers' role and product names, and the
 * code-only leads: kept as written in every language, even where the
 * Dashboard has the same word.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, Array<string>>> = {
  [CLOUD_AWS_ECS]: [
    "Create new revision",
    "Container - 1",
    "Environment variables",
    "+ Add container",
    "Essential container: No",
    "Value type: ValueFrom",
    "Value type: Value",
    "Startup dependency ordering",
    "Start",
    "Task execution role",
    "Create",
  ],
  [CLOUD_GCP_CLOUD_RUN]: [
    "`gcloud`",
    "Containers",
    "Variables & Secrets",
    "Reference a secret",
    "Security",
    "Service account",
    "+ Add container",
    "Container command and arguments",
    "Settings",
    "Startup probe",
    "Container start-up order",
    "Deploy",
  ],
  [CLOUD_AZURE_CONTAINER_APPS]: [
    "Container Apps secret",
    "Add",
    "Key Vault Secrets User",
    "Container",
    "Edit",
    "Environment variables",
    "Manual entry",
    "Reference a secret",
    "Save",
    "+ Add",
    "Arguments override",
    "Create",
    "Revisions and replicas",
  ],
  [CLOUD_OTHER_PLATFORMS]: [
    "Updates, monitoring, and logging",
    "Edit",
    "Environment properties",
    "Apply",
    "Configuration",
    "Environment variables",
    "Add environment variable",
    "Source: Secrets Manager",
    "Save changes",
    "Outgoing network traffic: Custom VPC",
    "Key Vault Secrets User",
    "+ Add",
    "Confirm",
    "deployment slot setting",
    "VNet integration",
    "Route All",
    "Basics",
    "Advanced",
    "Mark as secure",
    "Yes",
    "Review + create",
    "Create",
  ],
  [CLOUD_TROUBLESHOOTING]: ["VPC egress: All traffic"],
  [CLOUD_RESOURCES]: [
    "Monitoring Reader",
    "Direct PUT",
    "HTTP Endpoint",
    "OpenTelemetry 1.0",
    "JSON",
    "Monitoring Viewer",
  ],
};

// A table's create button, drawn as translateNamedAction draws it.
export const CREATE_BUTTONS: Readonly<Record<string, Array<string>>> = {
  [CLOUD_ENVIRONMENTS]: ["Create Cloud Resource"],
  [CLOUD_TROUBLESHOOTING]: ["Create Cloud Resource"],
};

/*
 * The pages' own bold leads: neither Dashboard labels nor the consoles'
 * words, so a translation words them freely.
 */
export const PROSE_LEADS: Readonly<Record<string, Array<string>>> = {
  [CLOUD_ENVIRONMENTS]: [
    "A resource detector says where the workload runs.",
    "The environment is the roll-up.",
    "Each running task is an instance.",
    "An ingestion key.",
    "OpenTelemetry in your application.",
    "Resource detector:",
    "Set by hand:",
    "Azure detectors know less.",
    "Dotted Azure spellings work.",
    "environment key",
    "Instance identity",
    "From your telemetry:",
    "From rules:",
  ],
  [CLOUD_AWS_ECS]: [
    "The ECS detector names the environment.",
    "The task names each instance.",
    "A sidecar collector adds CPU and memory.",
    "An ingestion key.",
    "An ECS cluster and a task definition you can revise",
    "Your application instrumented with an OpenTelemetry SDK",
    "Fargate tasks in private subnets",
    "Security group egress",
    "VPC interface endpoints",
  ],
  [CLOUD_GCP_CLOUD_RUN]: [
    "An ingestion key.",
    "Your application instrumented with an OpenTelemetry SDK",
    "By default",
    "With VPC egress: All traffic",
    "Firewall egress rules",
    "A self-hosted OneUptime inside the VPC",
  ],
  [CLOUD_AZURE_CONTAINER_APPS]: [
    "Dotted spellings work.",
    "The hostname is the replica name.",
    "An ingestion key.",
    "The Azure CLI with the `containerapp` extension",
    "Your application instrumented with an OpenTelemetry SDK",
    "OTLP/gRPC only",
    "Self-hosted:",
    "The apps still set the attributes.",
    "Your `OTEL_RESOURCE_ATTRIBUTES` wins.",
    "Outbound traffic is open by default.",
    "Custom VNets are the exception.",
    "A self-hosted OneUptime inside the VNet",
    "No Azure role is needed for telemetry.",
  ],
  [CLOUD_OTHER_PLATFORMS]: ["Networking:"],
  [CLOUD_TROUBLESHOOTING]: [
    "`cloud.platform` is missing, or is not a managed value.",
    "The token is wrong.",
    "Egress is blocked.",
    "ECS and Fargate:",
    "Cloud Run:",
    "Container Apps:",
    "Everywhere:",
    "On ECS,",
    "On Cloud Run, Container Apps and the other platforms,",
    "With SDK direct,",
    "A busy environment shows Disconnected:",
    "A staging environment that scales to zero overnight",
    "Stale:",
    "Deleted:",
  ],
  [CLOUD_RESOURCES]: [
    "The provider already measures your resources.",
    "A collector you run reads them.",
    "Each resource appears with its first metric.",
    "An ingestion key.",
    "Somewhere to run the OpenTelemetry Collector",
    "Read access to the provider's monitoring API.",
    "Leave `stats` unset.",
    "Data arrives late.",
    "The list is read when the collector starts:",
    "One receiver reads one project:",
    "Reading has a cost and a quota.",
    "Identified by",
    "no metric for 7 days",
    "5,000",
    "Inventory:",
    "Rules:",
    "Azure:",
    "AWS:",
    "Google Cloud:",
    "Any provider:",
    "Only metrics.",
    "Discovery follows the metrics.",
    "No retention setting of its own.",
    "Polling costs money",
  ],
};

/*
 * The setups the platform pages offer, as the in-app guide names its tabs:
 * the Dashboard draws them in English in every language, so the pages keep
 * them as they are, and a reader's pick follows them from page to page.
 */
export const SHAPE_TABS: ReadonlyArray<string> = [
  "Sidecar collector",
  "SDK direct",
];

/*
 * The tables of Cloud Resources that hold the product's own resource types
 * (codes, the catalog's labels and the service model): a translation keeps
 * every body row as it is, under the heading in the English one's place.
 */
export const IDENTITY_TABLE_HEADINGS: ReadonlyArray<string> = [
  "### Azure",
  "### AWS",
  "### Google Cloud",
];
