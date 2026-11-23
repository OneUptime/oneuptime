import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "./CloudMonitoredResource";
import { CloudProvider, ManagedCloudPlatform } from "./CloudPlatform";

/*
 * THE CLOUD RESOURCE AN APP RUNS AS, IN ITS PROVIDER'S MONITORING (issues
 * #6770, #10294, #10407, #6793, #6794).
 *
 * An app's own telemetry says nothing of its requests unless it sends
 * traces, and on most managed platforms nothing of its CPU or memory: no
 * container stats reach the app. The provider's monitoring measures every
 * app whatever it sends - Azure Monitor an App Service site, its deployment
 * slots and a Container App; Google Cloud Monitoring a Cloud Run or App
 * Engine service; Amazon CloudWatch an App Runner or ECS service - and once
 * the account is connected (Cloud > Connect) each reaches OneUptime as a
 * Cloud Resource, its provider's id as providerResourceId. This finds the
 * one an app runs as, so the app's page and its lists can show those
 * numbers beside its own.
 *
 * Which resource is the app's, by platform (each read by the end of the
 * row's id, never by the row's name: a person may rename a resource, and a
 * short name such as "api" starts the names of many):
 *
 *   - App Service, production: the site whose ARM id is the app's
 *     cloud.resource_id (which the App Service detectors set), matched
 *     without regard to case as ARM does; else a site named as the app is
 *     (its service.name, from WEBSITE_SITE_NAME) in the subscription its
 *     telemetry names - its cloud.resource_id's, else its environment's
 *     cloud.account.id - and in its environment's region before any other.
 *     A site of that name in another subscription is not the app's
 *     (#10294).
 *   - App Service, any other slot (its group, from WEBSITE_SLOT_NAME): the
 *     slot itself (Microsoft.Web/sites/slots), which Azure Monitor measures
 *     as a resource of its own - the slot under the site its
 *     cloud.resource_id names, else a slot of that name of the site of its
 *     name, in its subscription as above. Never the site: the detectors
 *     write the site's id for every slot, and the site's numbers are the
 *     production slot's alone (#6793).
 *   - Container Apps: the Container App its cloud.resource_id names, else
 *     the one named as the app is (service.name, from CONTAINER_APP_NAME),
 *     in its subscription and region as a site is.
 *   - Cloud Run and App Engine: the service of the app's name (faas.name,
 *     from K_SERVICE or GAE_SERVICE) in its environment's project - and,
 *     for Cloud Run, its region. Cloud Monitoring reports a revision, and an
 *     App Engine version, as part of its service: one row is the service.
 *   - App Runner: the service its cloud.resource_id names (the service's
 *     ARN), else the one named as the app is, in its environment's account
 *     and region.
 *   - ECS: the service of the app's cluster (its group, from
 *     aws.ecs.cluster.arn) that runs the app's task definition family, as
 *     the account's inventory lists the service's task definition; else,
 *     for a service whose task definition was never listed, the one named
 *     as the family. A service that runs another family is never the app's.
 *
 * Where more than one Cloud Run, App Engine, App Runner or ECS service
 * answers to the app (its environment names no region, or two services of
 * one cluster run its family), none is the app's: the numbers of either
 * would be half its own. Where two rows are one resource (a listing and a
 * metrics row in two spellings), the one seen last is.
 *
 * One answer, wherever it is asked (#10407): the server ties each app to
 * its resource with it and keeps the answer on the app
 * (CloudApp.platformCloudResourceId, CloudAppService
 * .linkPlatformResources), and the app's page, which reads the kept
 * resource first, looks it up with the same rules while none is kept.
 * Pure, so the matching is tested alone.
 */

export const APP_SERVICE_SITE_TYPE: string = "Microsoft.Web/sites";
// A site's deployment slot other than production (#6793).
export const APP_SERVICE_SLOT_TYPE: string = "Microsoft.Web/sites/slots";
export const CONTAINER_APP_TYPE: string = "Microsoft.App/containerApps";
// One Cloud Run service, whichever revision a series is on (CloudResourceCatalog).
export const CLOUD_RUN_SERVICE_TYPE: string = "cloud_run_revision";
// One App Engine service, whichever version a series is on.
export const APP_ENGINE_SERVICE_TYPE: string = "gae_app";
export const ECS_SERVICE_TYPE: string = "AWS::ECS::Service";
export const APP_RUNNER_SERVICE_TYPE: string = "AWS::AppRunner::Service";
// The slot every site has, which IS the site.
export const APP_SERVICE_PRODUCTION_SLOT: string = "production";

// A platform whose apps run as a Cloud Resource a connection reads.
export interface CloudAppPlatformResourceKind {
  platform: ManagedCloudPlatform;
  provider: CloudProvider;
  // Every type its apps run as, as CloudResourceCatalog spells it.
  types: ReadonlyArray<string>;
}

export const CLOUD_APP_PLATFORM_RESOURCE_KINDS: ReadonlyArray<CloudAppPlatformResourceKind> =
  [
    {
      platform: ManagedCloudPlatform.AzureAppService,
      provider: CloudProvider.Azure,
      types: [APP_SERVICE_SITE_TYPE, APP_SERVICE_SLOT_TYPE],
    },
    {
      platform: ManagedCloudPlatform.AzureContainerApps,
      provider: CloudProvider.Azure,
      types: [CONTAINER_APP_TYPE],
    },
    {
      platform: ManagedCloudPlatform.GcpCloudRun,
      provider: CloudProvider.GCP,
      types: [CLOUD_RUN_SERVICE_TYPE],
    },
    {
      platform: ManagedCloudPlatform.GcpAppEngine,
      provider: CloudProvider.GCP,
      types: [APP_ENGINE_SERVICE_TYPE],
    },
    {
      platform: ManagedCloudPlatform.AwsEcs,
      provider: CloudProvider.AWS,
      types: [ECS_SERVICE_TYPE],
    },
    {
      platform: ManagedCloudPlatform.AwsAppRunner,
      provider: CloudProvider.AWS,
      types: [APP_RUNNER_SERVICE_TYPE],
    },
  ];

// The platforms of CLOUD_APP_PLATFORM_RESOURCE_KINDS, as cloud.platform writes them.
export const CLOUD_APP_PLATFORMS_WITH_RESOURCE: ReadonlyArray<string> =
  CLOUD_APP_PLATFORM_RESOURCE_KINDS.map(
    (kind: CloudAppPlatformResourceKind): string => {
      return kind.platform;
    },
  );

export function getCloudAppPlatformResourceKind(
  cloudPlatform: string | null | undefined,
): CloudAppPlatformResourceKind | null {
  return (
    CLOUD_APP_PLATFORM_RESOURCE_KINDS.find(
      (kind: CloudAppPlatformResourceKind): boolean => {
        return kind.platform === cloudPlatform;
      },
    ) || null
  );
}

// Whether apps of the platform run as a Cloud Resource a connection reads.
export function isCloudAppPlatformWithResource(
  cloudPlatform: string | null | undefined,
): boolean {
  return getCloudAppPlatformResourceKind(cloudPlatform) !== null;
}

// The subset of CloudApp the look-up reads.
export interface CloudAppPlatformResourceSource {
  name?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
  groupName?: string | null | undefined;
  providerResourceId?: string | null | undefined;
}

// The subset of CloudResource the matching reads.
export interface CloudPlatformResourceCandidate {
  providerResourceId?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  // Where the row says the resource is: preferred, never required.
  cloudRegion?: string | null | undefined;
  // The account the row is in: an AWS account, a Google Cloud project.
  cloudAccountId?: string | null | undefined;
  // What the inventory lists of it: an ECS service's TaskDefinition.
  cloudProperties?: unknown;
}

// What the app's environment says of where it runs.
export interface CloudAppPlatformEnvironment {
  cloudAccountId?: string | null | undefined;
  cloudRegion?: string | null | undefined;
}

// Whether the app runs on Azure App Service, whatever its slot.
export function isAppServiceApp(app: CloudAppPlatformResourceSource): boolean {
  return app.cloudPlatform === ManagedCloudPlatform.AzureAppService;
}

// The name an ARM id of `type` gives its resource, or null for another id.
function getAzureNameOfType(
  providerResourceId: string | null | undefined,
  type: string,
): string | null {
  const parsed: ParsedAzureResourceId | null = providerResourceId
    ? parseAzureResourceId(providerResourceId)
    : null;

  return parsed && parsed.type.toLowerCase() === type.toLowerCase()
    ? parsed.name.trim()
    : null;
}

/*
 * The App Service site the app runs as, by name: from its
 * cloud.resource_id when it reports one (the id names the site), else its
 * own name.
 */
export function getCloudAppSiteName(
  app: CloudAppPlatformResourceSource,
): string {
  return (
    getAzureNameOfType(app.providerResourceId, APP_SERVICE_SITE_TYPE) ||
    (app.name || "").trim()
  );
}

// The non-production slot the app is kept apart by, if any.
export function getCloudAppSlotName(
  app: CloudAppPlatformResourceSource,
): string | null {
  const slot: string = (app.groupName || "").trim();

  if (!slot || slot.toLowerCase() === APP_SERVICE_PRODUCTION_SLOT) {
    return null;
  }

  return slot;
}

/*
 * The type of the resource the app runs as: an App Service app's site, or
 * its slot's (#6793); its platform's for the others. Null on a platform
 * whose apps run as none a connection reads.
 */
export function getCloudAppPlatformResourceType(
  app: CloudAppPlatformResourceSource,
): string | null {
  if (isAppServiceApp(app)) {
    return getCloudAppSlotName(app)
      ? APP_SERVICE_SLOT_TYPE
      : APP_SERVICE_SITE_TYPE;
  }

  const kind: CloudAppPlatformResourceKind | null =
    getCloudAppPlatformResourceKind(app.cloudPlatform);

  return kind ? kind.types[0]! : null;
}

/*
 * The name the resource the app runs as goes by: an App Service site's
 * (getCloudAppSiteName), a Container App's from its cloud.resource_id when
 * it names one, else the app's own - a Cloud Run, App Engine or App Runner
 * service's, an ECS task definition family.
 */
export function getCloudAppPlatformResourceName(
  app: CloudAppPlatformResourceSource,
): string {
  if (isAppServiceApp(app)) {
    return getCloudAppSiteName(app);
  }

  if (app.cloudPlatform === ManagedCloudPlatform.AzureContainerApps) {
    return (
      getAzureNameOfType(app.providerResourceId, CONTAINER_APP_TYPE) ||
      (app.name || "").trim()
    );
  }

  return (app.name || "").trim();
}

/*
 * Whether the app has a resource to look up: an app of a platform with one
 * (CLOUD_APP_PLATFORM_RESOURCE_KINDS), with a name to go by - and, on ECS,
 * the cluster that keeps its family apart.
 */
export function hasCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
): boolean {
  if (!isCloudAppPlatformWithResource(app.cloudPlatform)) {
    return false;
  }

  if (
    app.cloudPlatform === ManagedCloudPlatform.AwsEcs &&
    !(app.groupName || "").trim()
  ) {
    return false;
  }

  return Boolean(getCloudAppPlatformResourceName(app));
}

/*
 * An Azure region as Resource Manager writes a location: "northcentralus".
 * App Service's REGION_NAME, which the SDK detectors put in cloud.region,
 * is the display name - "North Central US" - so both are written the same
 * way before they are compared.
 */
export function normalizeAzureRegion(
  region: string | null | undefined,
): string {
  return (region || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A subscription id as compared: GUIDs are matched without regard to case.
export function normalizeAzureSubscription(
  subscriptionId: string | null | undefined,
): string {
  return (subscriptionId || "").trim().toLowerCase();
}

// Where the subscription an app runs in was read from.
export enum CloudAppSubscriptionSource {
  // The app's own cloud.resource_id names it.
  ResourceId = "resource-id",
  // Its environment's cloud.account.id.
  Environment = "environment",
  // Neither: the site found by the app's name says it.
  Site = "site",
}

export interface CloudAppSubscription {
  // As its source writes it.
  id: string;
  source: CloudAppSubscriptionSource;
}

/*
 * The Azure subscription the app runs in, as its telemetry says it: its
 * cloud.resource_id's - the site's own ARM id, which the App Service
 * detectors write from WEBSITE_OWNER_NAME - else its environment's
 * cloud.account.id, which the SDK detectors do not set (it is added by
 * hand, or by the Collector's azureappservice detector). Null when neither
 * names one.
 */
export function getCloudAppSubscription(data: {
  app: CloudAppPlatformResourceSource;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSubscription | null {
  const parsed: ParsedAzureResourceId | null = data.app.providerResourceId
    ? parseAzureResourceId(data.app.providerResourceId)
    : null;

  if (parsed && parsed.subscriptionId.trim()) {
    return {
      id: parsed.subscriptionId.trim(),
      source: CloudAppSubscriptionSource.ResourceId,
    };
  }

  const accountId: string = (data.environment?.cloudAccountId || "").trim();

  return accountId
    ? { id: accountId, source: CloudAppSubscriptionSource.Environment }
    : null;
}

// How the app's resource was found.
export enum CloudAppSiteMatch {
  // Its cloud.resource_id is the resource's id (or, for a slot, its site's).
  ResourceId = "resource-id",
  // The resource is named as the app is, where the app runs.
  Name = "name",
  // An ECS service of the app's cluster runs the app's task definition family.
  TaskDefinition = "task-definition",
}

export interface CloudAppSiteResolution<T> {
  site: T | null;
  matchedBy: CloudAppSiteMatch | null;
  /*
   * App Service sites (or slots) named as the app is in another
   * subscription than the one its telemetry names, the one seen last
   * first: not the app's, though one may be what a cloud.account.id typed
   * by hand meant. Empty on every other platform.
   */
  elsewhere: Array<T>;
}

const NO_RESOLUTION: CloudAppSiteResolution<never> = {
  site: null,
  matchedBy: null,
  elsewhere: [],
};

function timeOf(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : 0;
}

// The rows, the one seen last first.
function byLastSeen<T extends CloudPlatformResourceCandidate>(
  rows: ReadonlyArray<T>,
): Array<T> {
  return [...rows].sort((a: T, b: T): number => {
    return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt);
  });
}

function latestOf<T extends CloudPlatformResourceCandidate>(
  rows: ReadonlyArray<T>,
): T | null {
  return byLastSeen(rows)[0] || null;
}

function normalized(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

interface ParsedCandidate<T> {
  row: T;
  parsed: ParsedAzureResourceId;
}

/*
 * An Azure resource of `type` named `name` (lower case) among the
 * candidates (see the top of this file): the one whose id is `ownId`, else
 * one of that name in the app's subscription, in its environment's region
 * first, the one seen last.
 */
function resolveAzureResource<T extends CloudPlatformResourceCandidate>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
  type: string;
  name: string;
  // The id the app's telemetry names its resource by, in lower case.
  ownId: string;
}): CloudAppSiteResolution<T> {
  const type: string = data.type.toLowerCase();
  const parsedCandidates: Array<ParsedCandidate<T>> = [];

  for (const row of data.candidates) {
    const parsed: ParsedAzureResourceId | null = row.providerResourceId
      ? parseAzureResourceId(row.providerResourceId)
      : null;

    if (parsed && parsed.type.toLowerCase() === type) {
      parsedCandidates.push({ row, parsed });
    }
  }

  if (data.ownId) {
    const byId: T | null = latestOf(
      parsedCandidates
        .filter((candidate: ParsedCandidate<T>): boolean => {
          return normalized(candidate.row.providerResourceId) === data.ownId;
        })
        .map((candidate: ParsedCandidate<T>): T => {
          return candidate.row;
        }),
    );

    if (byId) {
      return {
        site: byId,
        matchedBy: CloudAppSiteMatch.ResourceId,
        elsewhere: [],
      };
    }
  }

  const subscription: string = normalizeAzureSubscription(
    getCloudAppSubscription({ app: data.app, environment: data.environment })
      ?.id,
  );
  const inSubscription: Array<T> = [];
  const elsewhere: Array<T> = [];

  for (const candidate of parsedCandidates) {
    if (candidate.parsed.name.toLowerCase() !== data.name) {
      continue;
    }

    if (
      !subscription ||
      normalizeAzureSubscription(candidate.parsed.subscriptionId) ===
        subscription
    ) {
      inSubscription.push(candidate.row);
    } else {
      elsewhere.push(candidate.row);
    }
  }

  const region: string = normalizeAzureRegion(data.environment?.cloudRegion);
  const inRegion: Array<T> = region
    ? inSubscription.filter((row: T): boolean => {
        return normalizeAzureRegion(row.cloudRegion) === region;
      })
    : [];
  const site: T | null = latestOf(inRegion) || latestOf(inSubscription);

  return {
    site,
    matchedBy: site ? CloudAppSiteMatch.Name : null,
    elsewhere: site ? [] : byLastSeen(elsewhere),
  };
}

/*
 * The app's App Service site among `candidates`, or its slot's for an app
 * of another slot than production, and how it was found (see the top of
 * this file): its id's, else one named as the app is - in the app's
 * subscription when its telemetry names one, in its environment's region
 * first - and, when two rows name it (a listing and a metrics row of one
 * site in two spellings), the one seen last.
 */
export function resolveCloudAppSite<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSiteResolution<T> {
  const siteName: string = getCloudAppSiteName(data.app).toLowerCase();

  if (!siteName) {
    return NO_RESOLUTION;
  }

  const slot: string | null = getCloudAppSlotName(data.app);
  const ownId: string = normalized(data.app.providerResourceId);

  if (!slot) {
    return resolveAzureResource({
      ...data,
      type: APP_SERVICE_SITE_TYPE,
      name: siteName,
      ownId,
    });
  }

  /*
   * A slot's own id is its site's and "/slots/<slot>": the detectors write
   * the site's for every slot, which names the slot's too, and is never the
   * slot's match itself. One set by hand to the slot's own id names it as
   * well.
   */
  const slotName: string = `${siteName}/${slot.toLowerCase()}`;
  const ownSiteName: string | null = getAzureNameOfType(
    data.app.providerResourceId,
    APP_SERVICE_SITE_TYPE,
  );
  const ownSlotName: string | null = getAzureNameOfType(
    data.app.providerResourceId,
    APP_SERVICE_SLOT_TYPE,
  );

  return resolveAzureResource({
    ...data,
    type: APP_SERVICE_SLOT_TYPE,
    name: slotName,
    ownId: ownSiteName
      ? `${ownId}/slots/${slot.toLowerCase()}`
      : ownSlotName && ownSlotName.toLowerCase() === slotName
        ? ownId
        : "",
  });
}

/* --------------------------- Google Cloud and AWS services, by identity */

/*
 * What tells a Cloud Run, App Engine, App Runner or ECS service from the
 * others, read from its id: the service's name, the account (a project or
 * an AWS account) and the region it is in, and an ECS service's cluster and
 * the task definition family it runs. Each in lower case, empty when its
 * id does not say it.
 */
export interface CloudAppServiceIdentity {
  name: string;
  account: string;
  region: string;
  cluster: string;
  taskFamily: string;
}

const CLOUD_RUN_SERVICE_ID: RegExp =
  /^\/\/run\.googleapis\.com\/projects\/([^/]+)\/locations\/([^/]+)\/services\/([^/]+)$/i;
const APP_ENGINE_SERVICE_ID: RegExp =
  /^\/\/appengine\.googleapis\.com\/apps\/([^/]+)\/services\/([^/]+)$/i;
const ECS_SERVICE_ARN: RegExp =
  /^arn:[^:]+:ecs:([^:]*):([^:]*):service\/([^/]+)\/([^/]+)$/i;
const APP_RUNNER_SERVICE_ARN: RegExp =
  /^arn:[^:]+:apprunner:([^:]*):([^:]*):service\/([^/]+)\/[^/]+$/i;
/*
 * The id a CloudWatch row gets when its metrics do not name the account or
 * the Region its ARN needs (CloudMonitoredResource): "AWS/ECS
 * ClusterName=prod ServiceName=checkout".
 */
const ECS_SERVICE_COMPOSITE: RegExp =
  /^AWS\/ECS ClusterName=(\S+) ServiceName=(\S+)$/i;
const APP_RUNNER_SERVICE_COMPOSITE: RegExp =
  /^AWS\/AppRunner ServiceName=(\S+)$/i;

/*
 * The family of an ECS task definition, as a service lists the one it
 * runs: "arn:aws:ecs:us-east-1:123:task-definition/checkout:42", or
 * "checkout:42" -> "checkout".
 */
export function getEcsTaskDefinitionFamily(
  taskDefinition: unknown,
): string {
  if (typeof taskDefinition !== "string") {
    return "";
  }

  const text: string = taskDefinition.trim();
  const afterSlash: string = text.includes("/")
    ? text.slice(text.lastIndexOf("/") + 1)
    : text.startsWith("arn:")
      ? ""
      : text;
  const colon: number = afterSlash.lastIndexOf(":");

  return (
    colon > 0 && /^\d+$/.test(afterSlash.slice(colon + 1))
      ? afterSlash.slice(0, colon)
      : afterSlash
  ).trim();
}

function readTaskDefinition(properties: unknown): unknown {
  return properties && typeof properties === "object"
    ? (properties as Record<string, unknown>)["TaskDefinition"]
    : undefined;
}

/*
 * A Cloud Run, App Engine, App Runner or ECS row's identity, by its type
 * (`platform`'s), or null for a row whose id is not one: a row of another
 * type, or none at all.
 */
export function getCloudAppServiceIdentity(
  platform: string | null | undefined,
  row: CloudPlatformResourceCandidate,
): CloudAppServiceIdentity | null {
  const id: string = (row.providerResourceId || "").trim();
  const account: string = normalized(row.cloudAccountId);
  const region: string = normalized(row.cloudRegion);
  let match: RegExpMatchArray | null = null;

  switch (platform) {
    case ManagedCloudPlatform.GcpCloudRun:
      match = id.match(CLOUD_RUN_SERVICE_ID);

      return match
        ? {
            account: normalized(match[1]),
            region: normalized(match[2]),
            name: normalized(match[3]),
            cluster: "",
            taskFamily: "",
          }
        : null;
    case ManagedCloudPlatform.GcpAppEngine:
      match = id.match(APP_ENGINE_SERVICE_ID);

      // An App Engine app lives in one region of its project.
      return match
        ? {
            account: normalized(match[1]),
            region: "",
            name: normalized(match[2]),
            cluster: "",
            taskFamily: "",
          }
        : null;
    case ManagedCloudPlatform.AwsAppRunner:
      match = id.match(APP_RUNNER_SERVICE_ARN);

      if (match) {
        return {
          region: normalized(match[1]) || region,
          account: normalized(match[2]) || account,
          name: normalized(match[3]),
          cluster: "",
          taskFamily: "",
        };
      }

      match = id.match(APP_RUNNER_SERVICE_COMPOSITE);

      return match
        ? {
            region,
            account,
            name: normalized(match[1]),
            cluster: "",
            taskFamily: "",
          }
        : null;
    case ManagedCloudPlatform.AwsEcs: {
      const taskFamily: string = getEcsTaskDefinitionFamily(
        readTaskDefinition(row.cloudProperties),
      ).toLowerCase();

      match = id.match(ECS_SERVICE_ARN);

      if (match) {
        return {
          region: normalized(match[1]) || region,
          account: normalized(match[2]) || account,
          cluster: normalized(match[3]),
          name: normalized(match[4]),
          taskFamily,
        };
      }

      match = id.match(ECS_SERVICE_COMPOSITE);

      return match
        ? {
            region,
            account,
            cluster: normalized(match[1]),
            name: normalized(match[2]),
            taskFamily,
          }
        : null;
    }
    default:
      return null;
  }
}

function identityKeyOf(identity: CloudAppServiceIdentity): string {
  return [
    identity.account,
    identity.region,
    identity.cluster,
    identity.name,
  ].join("|");
}

interface IdentifiedCandidate<T> {
  row: T;
  identity: CloudAppServiceIdentity;
}

/*
 * The one resource `rows` name - each row of it, the one seen last - or
 * null when they name none, or more than one.
 */
function theOneOf<T extends CloudPlatformResourceCandidate>(
  rows: ReadonlyArray<IdentifiedCandidate<T>>,
): T | null {
  const keys: Set<string> = new Set<string>(
    rows.map((candidate: IdentifiedCandidate<T>): string => {
      return identityKeyOf(candidate.identity);
    }),
  );

  if (keys.size !== 1) {
    return null;
  }

  return latestOf(
    rows.map((candidate: IdentifiedCandidate<T>): T => {
      return candidate.row;
    }),
  );
}

/*
 * The app's Cloud Run, App Engine, App Runner or ECS service among the
 * candidates (see the top of this file).
 */
function resolveCloudAppService<T extends CloudPlatformResourceCandidate>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSiteResolution<T> {
  const platform: string = data.app.cloudPlatform || "";
  const name: string = normalized(getCloudAppPlatformResourceName(data.app));
  const identified: Array<IdentifiedCandidate<T>> = [];

  for (const row of data.candidates) {
    const identity: CloudAppServiceIdentity | null =
      getCloudAppServiceIdentity(platform, row);

    if (identity) {
      identified.push({ row, identity });
    }
  }

  const ownId: string = normalized(data.app.providerResourceId);

  if (ownId) {
    const byId: T | null = latestOf(
      identified
        .filter((candidate: IdentifiedCandidate<T>): boolean => {
          return normalized(candidate.row.providerResourceId) === ownId;
        })
        .map((candidate: IdentifiedCandidate<T>): T => {
          return candidate.row;
        }),
    );

    if (byId) {
      return {
        site: byId,
        matchedBy: CloudAppSiteMatch.ResourceId,
        elsewhere: [],
      };
    }
  }

  if (!name) {
    return NO_RESOLUTION;
  }

  const account: string = normalized(data.environment?.cloudAccountId);
  const region: string = normalized(data.environment?.cloudRegion);
  const where: Array<IdentifiedCandidate<T>> = identified.filter(
    (candidate: IdentifiedCandidate<T>): boolean => {
      return (
        (!account || candidate.identity.account === account) &&
        (!region ||
          !candidate.identity.region ||
          candidate.identity.region === region)
      );
    },
  );

  if (platform === ManagedCloudPlatform.AwsEcs) {
    const cluster: string = normalized(data.app.groupName);

    if (!cluster) {
      return NO_RESOLUTION;
    }

    const inCluster: Array<IdentifiedCandidate<T>> = where.filter(
      (candidate: IdentifiedCandidate<T>): boolean => {
        return candidate.identity.cluster === cluster;
      },
    );
    const runningFamily: Array<IdentifiedCandidate<T>> = inCluster.filter(
      (candidate: IdentifiedCandidate<T>): boolean => {
        return candidate.identity.taskFamily === name;
      },
    );

    if (runningFamily.length > 0) {
      const service: T | null = theOneOf(runningFamily);

      return service
        ? {
            site: service,
            matchedBy: CloudAppSiteMatch.TaskDefinition,
            elsewhere: [],
          }
        : NO_RESOLUTION;
    }

    // A service whose task definition was never listed, named as the family.
    const service: T | null = theOneOf(
      inCluster.filter((candidate: IdentifiedCandidate<T>): boolean => {
        return (
          !candidate.identity.taskFamily && candidate.identity.name === name
        );
      }),
    );

    return service
      ? { site: service, matchedBy: CloudAppSiteMatch.Name, elsewhere: [] }
      : NO_RESOLUTION;
  }

  const service: T | null = theOneOf(
    where.filter((candidate: IdentifiedCandidate<T>): boolean => {
      return candidate.identity.name === name;
    }),
  );

  return service
    ? { site: service, matchedBy: CloudAppSiteMatch.Name, elsewhere: [] }
    : NO_RESOLUTION;
}

/*
 * The resource the app runs as among `candidates`, and how it was found -
 * by its platform's rules (see the top of this file). None for an app of a
 * platform whose apps run as none a connection reads.
 */
export function resolveCloudAppPlatformResource<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSiteResolution<T> {
  if (!hasCloudAppPlatformResource(data.app)) {
    return NO_RESOLUTION;
  }

  if (isAppServiceApp(data.app)) {
    return resolveCloudAppSite(data);
  }

  if (data.app.cloudPlatform === ManagedCloudPlatform.AzureContainerApps) {
    return resolveAzureResource({
      ...data,
      type: CONTAINER_APP_TYPE,
      name: normalized(getCloudAppPlatformResourceName(data.app)),
      ownId: normalized(data.app.providerResourceId),
    });
  }

  return resolveCloudAppService(data);
}

/*
 * The app's resource among `candidates` (resolveCloudAppPlatformResource),
 * or null when none is.
 */
export function matchCloudAppPlatformResource<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): T | null {
  return resolveCloudAppPlatformResource(data).site;
}

/*
 * How a resource the server kept for an app was found, said again from the
 * two ids: by the app's own cloud.resource_id when it names the resource
 * (for a slot, the slot's site), else by name (the only other way an App
 * Service app is tied to its site).
 */
export function getCloudAppSiteMatchOf(data: {
  app: CloudAppPlatformResourceSource;
  site: CloudPlatformResourceCandidate;
}): CloudAppSiteMatch {
  const ownId: string = normalized(data.app.providerResourceId);
  const siteId: string = normalized(data.site.providerResourceId);
  const slot: string | null = isAppServiceApp(data.app)
    ? getCloudAppSlotName(data.app)
    : null;

  return ownId &&
    (ownId === siteId ||
      (slot !== null && `${ownId}/slots/${slot.toLowerCase()}` === siteId))
    ? CloudAppSiteMatch.ResourceId
    : CloudAppSiteMatch.Name;
}

/*
 * The end every ARM id of a site named `siteName` has, in lower case:
 * ".../providers/microsoft.web/sites/checkout-api". A slot's id ends in
 * ".../slots/<slot>" and a plan's in ".../serverfarms/<plan>", so neither
 * ends so, and nor does another site's whose name only ends alike: the
 * slash before the name is part of it.
 */
export function getAppServiceSiteIdSuffix(siteName: string): string {
  return `/providers/${APP_SERVICE_SITE_TYPE}/${siteName.trim()}`.toLowerCase();
}

/*
 * The end every ARM id of a slot `slot` of a site named `siteName` has, in
 * lower case: ".../providers/microsoft.web/sites/checkout-api/slots/staging"
 * (#6793) - never the site's, nor another slot's, nor a slot of another site.
 */
export function getAppServiceSlotIdSuffix(
  siteName: string,
  slot: string,
): string {
  return `${getAppServiceSiteIdSuffix(siteName)}/slots/${slot.trim()}`.toLowerCase();
}

// The end every ARM id of a Container App named `name` has, in lower case.
export function getContainerAppIdSuffix(name: string): string {
  return `/providers/${CONTAINER_APP_TYPE}/${name.trim()}`.toLowerCase();
}

/*
 * The end a Cloud Run or App Engine service's full resource name has
 * ("//run.googleapis.com/projects/p/locations/r/services/checkout"): the
 * slash before the name is part of it, so another service whose name only
 * ends alike does not end so.
 */
export function getGcpServiceIdSuffix(name: string): string {
  return `/services/${name.trim()}`;
}
