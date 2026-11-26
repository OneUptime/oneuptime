import { CloudProvider } from "./CloudPlatform";
import { addUtcDays, addUtcMonths, fromCloudCostDay, startOfUtcMonth } from "./CloudCost";

/*
 * CLOUD COSTS AS A FOCUS 1.2 DATASET (#11009).
 *
 * FOCUS, the FinOps Open Cost and Usage Specification, is the column set
 * cost tools read and write: finance loads a FOCUS file into whatever they
 * use. OneUptime writes version 1.2 (FOCUS_Spec, tag v1.2,
 * https://focus.finops.org/focus-specification/v1-2/): the version
 * CloudHealth exports, and the one FOCUS readers take today (1.3 and 1.4
 * are published since; their files add columns a 1.2 reader leaves).
 *
 * One row per cost OneUptime keeps (CloudCost: a day, an account, a
 * service, a Region and, where the cloud names it, a resource), with the
 * columns 1.2 makes Mandatory, and the Conditional ones OneUptime has the
 * data for:
 *
 *   - BilledCost is what the cloud billed (the billed basis), EffectiveCost
 *     what it cost with commitments spread over what they cover (the
 *     amortized basis, #11007). ListCost and ContractedCost are BilledCost:
 *     the costs are read without unit prices, and FOCUS asks for BilledCost
 *     there ("When ListUnitPrice is null ... ListCost ... MUST match the
 *     BilledCost").
 *   - What the cloud took off - credits, refunds and discounts, the
 *     difference between the net basis and the amortized one - is a row of
 *     its own, ChargeCategory "Credit", as FOCUS keeps credits apart.
 *   - ChargeCategory is "Usage", or "Tax" for the costs AWS bills under its
 *     Tax service: the costs are read by service, not by charge type, so a
 *     purchase (a reservation's upfront fee) is the usage of the service it
 *     was bought for.
 *   - Dates are whole UTC days, ChargePeriodEnd and BillingPeriodEnd
 *     exclusive, as "YYYY-MM-DDTHH:mm:ssZ"; the billing period is the
 *     calendar month.
 *   - BillingAccountId is the account the connection reads the bill from:
 *     an AWS organization's management account (else the account), a
 *     Google Cloud billing account, or - Azure's billing account is not
 *     read - the subscription. SubAccountId is the AWS account, Azure
 *     subscription or Google Cloud project.
 *   - Tags is the cost's tags as a JSON object, keys as the cloud wrote
 *     them, null when it carries none.
 *
 * What 1.2 asks that OneUptime cannot give, and leaves null: PricingQuantity
 * and PricingUnit (MUST NOT be null for usage), the usage quantities, SKUs,
 * unit prices, commitment discount and capacity reservation columns, and
 * invoice IDs - the costs are read by day, service, Region and resource,
 * not by usage type. The docs say so (telemetry/cloud-costs.md).
 *
 * In the CSV, a null is an empty, unquoted field, every text is quoted -
 * an empty text never stands for a null - and a text that would start a
 * spreadsheet formula starts with an apostrophe.
 *
 * React-free and server-safe: the export route writes it as it streams the
 * rows, and its tests read it.
 */

export const CLOUD_COST_FOCUS_VERSION: string = "1.2";

// The columns written, in the order FOCUS lists them: alphabetically.
export const CLOUD_COST_FOCUS_COLUMNS: ReadonlyArray<string> = [
  "BilledCost",
  "BillingAccountId",
  "BillingAccountName",
  "BillingCurrency",
  "BillingPeriodEnd",
  "BillingPeriodStart",
  "ChargeCategory",
  "ChargeClass",
  "ChargeDescription",
  "ChargePeriodEnd",
  "ChargePeriodStart",
  "ContractedCost",
  "EffectiveCost",
  "InvoiceIssuerName",
  "ListCost",
  "PricingQuantity",
  "PricingUnit",
  "ProviderName",
  "PublisherName",
  "RegionId",
  "RegionName",
  "ResourceId",
  "ResourceName",
  "ServiceCategory",
  "ServiceName",
  "SubAccountId",
  "SubAccountName",
  "Tags",
];

// The values FOCUS 1.2 allows in ChargeCategory.
export enum CloudCostFocusChargeCategory {
  Usage = "Usage",
  Purchase = "Purchase",
  Tax = "Tax",
  Credit = "Credit",
  Adjustment = "Adjustment",
}

// The values FOCUS 1.2 allows in ServiceCategory.
export enum CloudCostFocusServiceCategory {
  AiAndMachineLearning = "AI and Machine Learning",
  Analytics = "Analytics",
  BusinessApplications = "Business Applications",
  Compute = "Compute",
  Databases = "Databases",
  DeveloperTools = "Developer Tools",
  Multicloud = "Multicloud",
  Identity = "Identity",
  Integration = "Integration",
  InternetOfThings = "Internet of Things",
  ManagementAndGovernance = "Management and Governance",
  Media = "Media",
  Migration = "Migration",
  Mobile = "Mobile",
  Networking = "Networking",
  Security = "Security",
  Storage = "Storage",
  Web = "Web",
  Other = "Other",
}

/*
 * ---------------------------------------------------------------------------
 * Who bills it
 * ---------------------------------------------------------------------------
 */

/*
 * ProviderName, PublisherName and InvoiceIssuerName: the cloud, as its own
 * FOCUS exports name itself. A marketplace's sellers are not told apart -
 * the costs are read by service.
 */
export function getCloudCostFocusProviderName(provider: string): string {
  const key: string = (provider || "").trim().toLowerCase();

  if (key === CloudProvider.AWS) {
    return "AWS";
  }

  if (key === CloudProvider.Azure) {
    return "Microsoft";
  }

  if (key === CloudProvider.GCP) {
    return "Google Cloud";
  }

  return provider || "Unknown";
}

// An AWS role's account: "arn:aws:iam::123456789012:role/OneUptime" -> "123456789012".
const AWS_ROLE_ACCOUNT: RegExp = /^arn:aws[a-z-]*:iam::(\d{12}):/;

// A Google Cloud billing export's billing account, from its table's name.
const GCP_EXPORT_BILLING_ACCOUNT: RegExp =
  /gcp_billing_export_(?:resource_)?v1_([0-9A-F]{6})_([0-9A-F]{6})_([0-9A-F]{6})$/i;

/*
 * BillingAccountId: the account the connection reads the bill from. An AWS
 * connection's role is in the organization's management account when it
 * reads the organization; a Google Cloud export is one billing account's;
 * Azure's billing account is not read, so the subscription stands for it.
 * Without what says it, the account itself.
 */
export function getCloudCostFocusBillingAccountId(data: {
  provider: string;
  // The account's own id in its cloud: the SubAccountId.
  accountId: string;
  roleArn?: string | undefined;
  billingExportTable?: string | undefined;
}): string {
  const provider: string = (data.provider || "").trim().toLowerCase();

  if (provider === CloudProvider.AWS && data.roleArn) {
    const match: RegExpMatchArray | null = data.roleArn
      .trim()
      .match(AWS_ROLE_ACCOUNT);

    if (match?.[1]) {
      return match[1];
    }
  }

  if (provider === CloudProvider.GCP && data.billingExportTable) {
    const match: RegExpMatchArray | null = data.billingExportTable
      .trim()
      .match(GCP_EXPORT_BILLING_ACCOUNT);

    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`.toUpperCase();
    }
  }

  return data.accountId;
}

/*
 * ---------------------------------------------------------------------------
 * What it is for
 * ---------------------------------------------------------------------------
 */

/*
 * The services each cloud bills, by the name its billing gives them, and
 * the FOCUS category that best fits each. A service named in none is
 * matched by the words its name carries, and the rest are "Other", as
 * FOCUS asks ("ServiceName MUST be associated with the ServiceCategory
 * 'Other' when no suitable ServiceCategory is available").
 */
const SERVICE_CATEGORIES: ReadonlyArray<{
  pattern: RegExp;
  category: CloudCostFocusServiceCategory;
}> = [
  // AI and machine learning.
  {
    pattern:
      /sagemaker|bedrock|comprehend|rekognition|textract|polly|transcribe|translate|lex\b|kendra|forecast|personalize|cognitive services|azure openai|openai|machine learning|vertex ai|ai platform|dialogflow|vision ai|natural language|speech-to-text|text-to-speech|automl|gemini|document ai|\bai\b/i,
    category: CloudCostFocusServiceCategory.AiAndMachineLearning,
  },
  // Databases, before storage: "Amazon DynamoDB" is no store of files.
  {
    pattern:
      /\brds\b|relational database|dynamodb|aurora|redshift|elasticache|memorydb|documentdb|neptune|keyspaces|timestream|qldb|\bsql\b|cosmos|database|mysql|postgres|mariadb|redis|cache for redis|bigtable|spanner|firestore|datastore|memorystore|alloydb|cloud sql|mongodb/i,
    category: CloudCostFocusServiceCategory.Databases,
  },
  // Analytics.
  {
    pattern:
      /athena|\bemr\b|elastic mapreduce|kinesis|glue|quicksight|opensearch|elasticsearch|lake formation|msk|managed streaming for apache kafka|data factory|synapse|databricks|hdinsight|stream analytics|data explorer|event hubs|bigquery|dataflow|dataproc|pub\/sub lite|looker|composer|data fusion|analytics/i,
    category: CloudCostFocusServiceCategory.Analytics,
  },
  // Management and governance: monitoring, logs, configuration, support.
  {
    pattern:
      /cloudwatch|cloudtrail|\bconfig\b|systems manager|cloudformation|control tower|organizations|trusted advisor|service catalog|x-ray|managed grafana|managed service for prometheus|monitor|log analytics|application insights|automation|advisor|cost management|policy|cloud logging|cloud monitoring|stackdriver|operations|cloud trace|cloud asset|resource manager|\bsupport\b/i,
    category: CloudCostFocusServiceCategory.ManagementAndGovernance,
  },
  // Security.
  {
    pattern:
      /guardduty|inspector|macie|security hub|\bwaf\b|shield|firewall|key management|\bkms\b|key vault|secrets manager|secret manager|certificate|defender|sentinel|security|ddos|cloud armor|cloudhsm|detective/i,
    category: CloudCostFocusServiceCategory.Security,
  },
  // Identity.
  {
    pattern:
      /cognito|\biam\b|identity|directory service|active directory|entra|single sign-on|\bsso\b/i,
    category: CloudCostFocusServiceCategory.Identity,
  },
  // Integration.
  {
    pattern:
      /\bsqs\b|simple queue|\bsns\b|simple notification|eventbridge|step functions|\bmq\b|appsync|api gateway|api management|service bus|event grid|logic apps|pub\/sub|cloud tasks|workflows|eventarc|apigee|cloud scheduler/i,
    category: CloudCostFocusServiceCategory.Integration,
  },
  // Networking.
  {
    pattern:
      /cloudfront|route ?53|\bvpc\b|virtual private cloud|direct connect|transit gateway|load balanc|\belb\b|global accelerator|data transfer|nat gateway|privatelink|virtual network|bandwidth|front door|\bcdn\b|application gateway|expressroute|vpn|traffic manager|\bdns\b|network|networking|interconnect|cloud nat|cloud router/i,
    category: CloudCostFocusServiceCategory.Networking,
  },
  // Storage.
  {
    pattern:
      /\bs3\b|simple storage|glacier|elastic block store|\bebs\b|elastic file system|\befs\b|fsx|storage gateway|backup|storage|blob|disks|files|archive|filestore|persistent disk/i,
    category: CloudCostFocusServiceCategory.Storage,
  },
  // Compute.
  {
    pattern:
      /\bec2\b|elastic compute cloud|lambda|\becs\b|elastic container|\beks\b|kubernetes|fargate|lightsail|batch|elastic beanstalk|app runner|outposts|virtual machines|vm scale sets|functions|app service|container apps|container instances|aks|compute engine|cloud run|cloud functions|app engine|\bgke\b|compute|container|serverless|spot/i,
    category: CloudCostFocusServiceCategory.Compute,
  },
  // Developer tools.
  {
    pattern:
      /codebuild|codecommit|codedeploy|codepipeline|codeartifact|cloud9|devops|cloud build|artifact registry|container registry|source repositories|cloud deploy|\becr\b|registry/i,
    category: CloudCostFocusServiceCategory.DeveloperTools,
  },
  // Internet of Things.
  {
    pattern: /\biot\b|internet of things|greengrass|digital twins/i,
    category: CloudCostFocusServiceCategory.InternetOfThings,
  },
  // Media.
  {
    pattern:
      /elemental|media|interactive video|\bivs\b|transcoder|video|live stream/i,
    category: CloudCostFocusServiceCategory.Media,
  },
  // Migration.
  {
    pattern:
      /migration|database migration|\bdms\b|snowball|datasync|transfer family|application discovery|azure migrate|transfer service/i,
    category: CloudCostFocusServiceCategory.Migration,
  },
  // Mobile.
  {
    pattern: /amplify|device farm|pinpoint|mobile|notification hubs|firebase/i,
    category: CloudCostFocusServiceCategory.Mobile,
  },
  // Web.
  {
    pattern: /static web apps|web apps|website/i,
    category: CloudCostFocusServiceCategory.Web,
  },
  // Business applications.
  {
    pattern:
      /workspaces|workdocs|workmail|chime|connect|simple email|\bses\b|communication services|marketplace|dynamics|power bi|maps/i,
    category: CloudCostFocusServiceCategory.BusinessApplications,
  },
  // Several clouds at once.
  {
    pattern: /anthos|azure arc|outposts|multicloud|hybrid/i,
    category: CloudCostFocusServiceCategory.Multicloud,
  },
];

export function getCloudCostFocusServiceCategory(
  service: string,
): CloudCostFocusServiceCategory {
  const name: string = (service || "").trim();

  if (!name) {
    return CloudCostFocusServiceCategory.Other;
  }

  for (const entry of SERVICE_CATEGORIES) {
    if (entry.pattern.test(name)) {
      return entry.category;
    }
  }

  return CloudCostFocusServiceCategory.Other;
}

// The service AWS bills its taxes under.
const AWS_TAX_SERVICE: string = "tax";

export function getCloudCostFocusChargeCategory(data: {
  provider: string;
  service: string;
}): CloudCostFocusChargeCategory {
  if (
    (data.provider || "").trim().toLowerCase() === CloudProvider.AWS &&
    (data.service || "").trim().toLowerCase() === AWS_TAX_SERVICE
  ) {
    return CloudCostFocusChargeCategory.Tax;
  }

  return CloudCostFocusChargeCategory.Usage;
}

/*
 * ---------------------------------------------------------------------------
 * Where it ran
 * ---------------------------------------------------------------------------
 */

// Each cloud's names for its Regions, as its own console writes them.
const REGION_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    [CloudProvider.AWS]: {
      "us-east-1": "US East (N. Virginia)",
      "us-east-2": "US East (Ohio)",
      "us-west-1": "US West (N. California)",
      "us-west-2": "US West (Oregon)",
      "af-south-1": "Africa (Cape Town)",
      "ap-east-1": "Asia Pacific (Hong Kong)",
      "ap-south-1": "Asia Pacific (Mumbai)",
      "ap-south-2": "Asia Pacific (Hyderabad)",
      "ap-southeast-1": "Asia Pacific (Singapore)",
      "ap-southeast-2": "Asia Pacific (Sydney)",
      "ap-southeast-3": "Asia Pacific (Jakarta)",
      "ap-southeast-4": "Asia Pacific (Melbourne)",
      "ap-northeast-1": "Asia Pacific (Tokyo)",
      "ap-northeast-2": "Asia Pacific (Seoul)",
      "ap-northeast-3": "Asia Pacific (Osaka)",
      "ca-central-1": "Canada (Central)",
      "ca-west-1": "Canada West (Calgary)",
      "eu-central-1": "Europe (Frankfurt)",
      "eu-central-2": "Europe (Zurich)",
      "eu-west-1": "Europe (Ireland)",
      "eu-west-2": "Europe (London)",
      "eu-west-3": "Europe (Paris)",
      "eu-south-1": "Europe (Milan)",
      "eu-south-2": "Europe (Spain)",
      "eu-north-1": "Europe (Stockholm)",
      "il-central-1": "Israel (Tel Aviv)",
      "me-south-1": "Middle East (Bahrain)",
      "me-central-1": "Middle East (UAE)",
      "sa-east-1": "South America (São Paulo)",
      "us-gov-east-1": "AWS GovCloud (US-East)",
      "us-gov-west-1": "AWS GovCloud (US-West)",
      global: "Global",
    },
    [CloudProvider.Azure]: {
      eastus: "East US",
      eastus2: "East US 2",
      centralus: "Central US",
      northcentralus: "North Central US",
      southcentralus: "South Central US",
      westcentralus: "West Central US",
      westus: "West US",
      westus2: "West US 2",
      westus3: "West US 3",
      canadacentral: "Canada Central",
      canadaeast: "Canada East",
      brazilsouth: "Brazil South",
      northeurope: "North Europe",
      westeurope: "West Europe",
      uksouth: "UK South",
      ukwest: "UK West",
      francecentral: "France Central",
      germanywestcentral: "Germany West Central",
      switzerlandnorth: "Switzerland North",
      norwayeast: "Norway East",
      swedencentral: "Sweden Central",
      polandcentral: "Poland Central",
      italynorth: "Italy North",
      spaincentral: "Spain Central",
      uaenorth: "UAE North",
      qatarcentral: "Qatar Central",
      israelcentral: "Israel Central",
      southafricanorth: "South Africa North",
      centralindia: "Central India",
      southindia: "South India",
      westindia: "West India",
      eastasia: "East Asia",
      southeastasia: "Southeast Asia",
      japaneast: "Japan East",
      japanwest: "Japan West",
      koreacentral: "Korea Central",
      koreasouth: "Korea South",
      australiaeast: "Australia East",
      australiasoutheast: "Australia Southeast",
      australiacentral: "Australia Central",
      global: "Global",
    },
    [CloudProvider.GCP]: {
      "us-central1": "Iowa",
      "us-east1": "South Carolina",
      "us-east4": "Northern Virginia",
      "us-east5": "Columbus",
      "us-south1": "Dallas",
      "us-west1": "Oregon",
      "us-west2": "Los Angeles",
      "us-west3": "Salt Lake City",
      "us-west4": "Las Vegas",
      "northamerica-northeast1": "Montréal",
      "northamerica-northeast2": "Toronto",
      "southamerica-east1": "São Paulo",
      "southamerica-west1": "Santiago",
      "europe-west1": "Belgium",
      "europe-west2": "London",
      "europe-west3": "Frankfurt",
      "europe-west4": "Netherlands",
      "europe-west6": "Zurich",
      "europe-west8": "Milan",
      "europe-west9": "Paris",
      "europe-west10": "Berlin",
      "europe-west12": "Turin",
      "europe-north1": "Finland",
      "europe-central2": "Warsaw",
      "europe-southwest1": "Madrid",
      "me-west1": "Tel Aviv",
      "me-central1": "Doha",
      "me-central2": "Dammam",
      "africa-south1": "Johannesburg",
      "asia-east1": "Taiwan",
      "asia-east2": "Hong Kong",
      "asia-northeast1": "Tokyo",
      "asia-northeast2": "Osaka",
      "asia-northeast3": "Seoul",
      "asia-south1": "Mumbai",
      "asia-south2": "Delhi",
      "asia-southeast1": "Singapore",
      "asia-southeast2": "Jakarta",
      "australia-southeast1": "Sydney",
      "australia-southeast2": "Melbourne",
      global: "Global",
    },
  };

/*
 * RegionName: the cloud's own name for the Region where OneUptime knows it,
 * else its ID - FOCUS asks for a name wherever there is an ID.
 */
export function getCloudCostFocusRegionName(data: {
  provider: string;
  regionId: string;
}): string {
  const names: Readonly<Record<string, string>> | undefined =
    REGION_NAMES[(data.provider || "").trim().toLowerCase()];

  return names?.[(data.regionId || "").trim().toLowerCase()] || data.regionId;
}

/*
 * ResourceName: the name a person gave the resource - its Name tag, or the
 * last part of an Azure or Google Cloud ID, which their owners name - and
 * null where only a generated ID names it (FOCUS: ResourceName "MUST NOT
 * duplicate ResourceId when the resource ... only has a system-generated
 * ResourceId"), as an AWS ARN's i-0abc... is.
 */
export function getCloudCostFocusResourceName(data: {
  provider: string;
  resourceId: string;
  tags: Record<string, string>;
}): string | null {
  const resourceId: string = (data.resourceId || "").trim();

  if (!resourceId) {
    return null;
  }

  for (const key of Object.keys(data.tags || {})) {
    if (key.toLowerCase() === "name" && (data.tags[key] || "").trim()) {
      return data.tags[key]!.trim();
    }
  }

  const provider: string = (data.provider || "").trim().toLowerCase();

  if (provider === CloudProvider.Azure || provider === CloudProvider.GCP) {
    let end: number = resourceId.length;

    while (end > 0 && resourceId.charAt(end - 1) === "/") {
      end--;
    }

    const trimmed: string = resourceId.slice(0, end);
    const slash: number = trimmed.lastIndexOf("/");
    const name: string = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;

    return name && name !== resourceId ? name : null;
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * The rows
 * ---------------------------------------------------------------------------
 */

// One cost as OneUptime keeps it (CloudCost), with what names its accounts.
export interface CloudCostFocusSource {
  // "2026-11-02", or the day's start.
  day: string | Date;
  provider: string;
  // The AWS account, Azure subscription or Google Cloud project.
  accountId: string;
  // What OneUptime calls it, and what the bill calls the account it is billed to.
  accountName: string;
  billingAccountId: string;
  billingAccountName?: string | null | undefined;
  service: string;
  region: string;
  resourceId: string;
  currency: string;
  // The three bases (#11007): billed, amortized, net.
  cost: number;
  amortizedCost: number;
  netCost: number;
  tags: Record<string, string>;
}

export type CloudCostFocusValue = string | number | null;

export type CloudCostFocusRow = Record<string, CloudCostFocusValue>;

// A moment as FOCUS writes it: "2026-11-02T00:00:00Z", in UTC.
export function toCloudCostFocusDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function toDayStart(day: string | Date): Date {
  if (day instanceof Date) {
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
    );
  }

  return fromCloudCostDay(String(day).slice(0, 10));
}

/*
 * What the cloud took off a cost: credits, refunds and discounts - its
 * amortized figure less its net one. Nothing for a cost read before the
 * bases (#11007), whose three figures are all its billed one.
 */
export function getCloudCostFocusCredit(source: CloudCostFocusSource): number {
  const credit: number =
    (Number(source.netCost) || 0) - (Number(source.amortizedCost) || 0);

  return Math.abs(credit) < 0.0000001 ? 0 : credit;
}

/*
 * A cost's FOCUS rows: its usage (or tax), and - when the cloud took
 * something off it - a Credit row of what it took off, on the same day,
 * account, service, Region and resource.
 */
export function toCloudCostFocusRows(
  source: CloudCostFocusSource,
): Array<CloudCostFocusRow> {
  const dayStart: Date = toDayStart(source.day);
  const monthStart: Date = startOfUtcMonth(dayStart);
  const providerName: string = getCloudCostFocusProviderName(source.provider);
  const service: string = (source.service || "").trim() || "Unknown";
  const regionId: string = (source.region || "").trim();
  const resourceId: string = (source.resourceId || "").trim();
  const tags: Record<string, string> = source.tags || {};
  const chargeCategory: CloudCostFocusChargeCategory =
    getCloudCostFocusChargeCategory({
      provider: source.provider,
      service,
    });

  const shared: CloudCostFocusRow = {
    BillingAccountId: source.billingAccountId || source.accountId,
    BillingAccountName:
      (source.billingAccountName || "").trim() ||
      (source.billingAccountId === source.accountId
        ? (source.accountName || "").trim() || null
        : null),
    BillingCurrency: (source.currency || "").trim().toUpperCase(),
    BillingPeriodEnd: toCloudCostFocusDateTime(addUtcMonths(monthStart, 1)),
    BillingPeriodStart: toCloudCostFocusDateTime(monthStart),
    ChargeClass: null,
    ChargePeriodEnd: toCloudCostFocusDateTime(addUtcDays(dayStart, 1)),
    ChargePeriodStart: toCloudCostFocusDateTime(dayStart),
    InvoiceIssuerName: providerName,
    PricingQuantity: null,
    PricingUnit: null,
    ProviderName: providerName,
    PublisherName: providerName,
    RegionId: regionId || null,
    RegionName: regionId
      ? getCloudCostFocusRegionName({ provider: source.provider, regionId })
      : null,
    ResourceId: resourceId || null,
    ResourceName: getCloudCostFocusResourceName({
      provider: source.provider,
      resourceId,
      tags,
    }),
    ServiceCategory: getCloudCostFocusServiceCategory(service),
    ServiceName: service,
    SubAccountId: source.accountId,
    SubAccountName: (source.accountName || "").trim() || source.accountId,
    Tags: Object.keys(tags).length > 0 ? JSON.stringify(tags) : null,
  };

  const billed: number = Number(source.cost) || 0;
  const rows: Array<CloudCostFocusRow> = [
    {
      ...shared,
      BilledCost: billed,
      ChargeCategory: chargeCategory,
      ChargeDescription:
        chargeCategory === CloudCostFocusChargeCategory.Tax
          ? "Tax"
          : `${service} usage`,
      ContractedCost: billed,
      EffectiveCost: Number(source.amortizedCost) || 0,
      ListCost: billed,
    },
  ];

  const credit: number = getCloudCostFocusCredit(source);

  if (credit !== 0) {
    rows.push({
      ...shared,
      BilledCost: credit,
      ChargeCategory: CloudCostFocusChargeCategory.Credit,
      ChargeDescription: `Credits, refunds and discounts on ${service}`,
      ContractedCost: credit,
      // A charge unrelated to others: its EffectiveCost is its BilledCost.
      EffectiveCost: credit,
      ListCost: credit,
    });
  }

  return rows;
}

/*
 * A decimal as FOCUS writes one: plain digits and one point, a minus for a
 * negative, no sign for a positive, no exponent - to ten places, the
 * zeros after the last digit left off.
 */
export function toCloudCostFocusDecimal(value: number): string {
  const number: number = Number(value);

  if (!Number.isFinite(number) || Math.abs(number) < 0.00000000005) {
    return "0";
  }

  const text: string = number.toFixed(10).replace(/\.?0+$/, "");

  return text === "-0" ? "0" : text;
}

// What starts a spreadsheet formula, which a CSV field must never.
const FORMULA_LEAD: RegExp = /^[=+\-@\t\r]/;

// A FOCUS field: null as nothing, a figure as it is, text quoted.
export function toCloudCostFocusField(value: CloudCostFocusValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return toCloudCostFocusDecimal(value);
  }

  const safe: string = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

// The file's first line: the columns' IDs.
export function getCloudCostFocusCsvHeader(): string {
  return `${CLOUD_COST_FOCUS_COLUMNS.join(",")}\n`;
}

// A row as one line of the file, its columns in their order.
export function toCloudCostFocusCsvLine(row: CloudCostFocusRow): string {
  return `${CLOUD_COST_FOCUS_COLUMNS.map((column: string): string => {
    return toCloudCostFocusField(
      Object.prototype.hasOwnProperty.call(row, column) ? row[column]! : null,
    );
  }).join(",")}\n`;
}
