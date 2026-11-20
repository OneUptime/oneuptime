import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "./CloudMonitoredResource";
import { ManagedCloudPlatform } from "./CloudPlatform";

/*
 * THE CLOUD RESOURCE AN APP RUNS AS, IN ITS PROVIDER'S MONITORING (issues
 * #6770, #10294, #10407).
 *
 * An Azure App Service app's own telemetry says nothing of its requests
 * unless it sends traces, and nothing of its CPU or memory at all: App
 * Service gives an app no container stats. Azure Monitor measures every
 * site whatever it sends - requests, server errors, response time, CPU
 * time, memory - and once the subscription is connected (Cloud > Connect)
 * each site reaches OneUptime as a Cloud Resource of type
 * Microsoft.Web/sites, its ARM id as providerResourceId. This finds the
 * one an app runs as, so the app's page and its lists can show those
 * numbers beside its own.
 *
 * Which site is the app's:
 *
 *   1. the one whose id is the app's cloud.resource_id (providerResourceId),
 *      which the App Service detectors set (the Collector's too) - ARM ids
 *      are matched without regard to case, as ARM does;
 *   2. else a site named as the app is: an App Service app's name is its
 *      service.name, which the detectors read from WEBSITE_SITE_NAME - in
 *      the subscription the app runs in when its telemetry names one (its
 *      cloud.resource_id's, else its environment's cloud.account.id), and
 *      in its environment's region before any other. A site of that name in
 *      another subscription is not the app's (#10294): with unique default
 *      host names, two subscriptions can each hold one.
 *
 * An app kept apart by a deployment slot other than production (its group,
 * from WEBSITE_SLOT_NAME) has none: Azure Monitor measures each slot as a
 * resource of its own (Microsoft.Web/sites/slots), whose metrics a
 * connection does not read, and the site's are the production slot's alone
 * - never another slot's, though the detectors write the site's id for
 * every slot.
 *
 * Read by the end of each row's ARM id (".../providers/Microsoft.Web/sites/
 * <name>", without regard to case), never by the row's name: a person may
 * rename a resource, and a short name such as "api" starts the names of
 * more sites than one read holds (#10294 - both left a connected site
 * "not connected").
 *
 * One answer, wherever it is asked (#10407): the server ties each app to
 * its site with it and keeps the answer on the app
 * (CloudApp.platformCloudResourceId, CloudAppService
 * .linkPlatformResources), and the app's page, which reads the kept site
 * first, looks it up with the same rules while none is kept. Pure, so the
 * matching is tested alone.
 */

export const APP_SERVICE_SITE_TYPE: string = "Microsoft.Web/sites";
// The slot every site has, which IS the site.
export const APP_SERVICE_PRODUCTION_SLOT: string = "production";

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
  // Where the row says the site is: preferred, never required.
  cloudRegion?: string | null | undefined;
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

/*
 * The App Service site the app runs as, by name: from its
 * cloud.resource_id when it reports one (the id names the site), else its
 * own name.
 */
export function getCloudAppSiteName(
  app: CloudAppPlatformResourceSource,
): string {
  const parsed: ParsedAzureResourceId | null = app.providerResourceId
    ? parseAzureResourceId(app.providerResourceId)
    : null;

  if (
    parsed &&
    parsed.type.toLowerCase() === APP_SERVICE_SITE_TYPE.toLowerCase()
  ) {
    return parsed.name.trim();
  }

  return (app.name || "").trim();
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
 * Whether the app has a resource to look up: an App Service app's site, for
 * its production slot (see the top of this file). App Service only, for now.
 */
export function hasCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
): boolean {
  return (
    isAppServiceApp(app) &&
    Boolean(getCloudAppSiteName(app)) &&
    getCloudAppSlotName(app) === null
  );
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

// How the app's site was found.
export enum CloudAppSiteMatch {
  // Its cloud.resource_id is the site's id.
  ResourceId = "resource-id",
  // The site is named as the app is, in the app's subscription.
  Name = "name",
}

export interface CloudAppSiteResolution<T> {
  site: T | null;
  matchedBy: CloudAppSiteMatch | null;
  /*
   * Sites named as the app is in another subscription than the one its
   * telemetry names, the one seen last first: not the app's, though one
   * may be what a cloud.account.id typed by hand meant.
   */
  elsewhere: Array<T>;
}

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

interface ParsedCandidate<T> {
  row: T;
  parsed: ParsedAzureResourceId;
}

/*
 * The app's site among `candidates`, and how it was found (see the top of
 * this file): its id's, else one named as the app is - in the app's
 * subscription when its telemetry names one, in its environment's region
 * first - and, when two rows name it (a listing and a metrics row of one
 * site in two spellings), the one seen last. None for an app of another
 * slot than production.
 */
export function resolveCloudAppSite<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSiteResolution<T> {
  const siteName: string = getCloudAppSiteName(data.app).toLowerCase();

  if (!siteName || getCloudAppSlotName(data.app) !== null) {
    return { site: null, matchedBy: null, elsewhere: [] };
  }

  const parsedCandidates: Array<ParsedCandidate<T>> = [];

  for (const row of data.candidates) {
    const parsed: ParsedAzureResourceId | null = row.providerResourceId
      ? parseAzureResourceId(row.providerResourceId)
      : null;

    if (parsed) {
      parsedCandidates.push({ row, parsed });
    }
  }

  const ownId: string = (data.app.providerResourceId || "")
    .trim()
    .toLowerCase();

  if (ownId) {
    const byId: T | null = latestOf(
      parsedCandidates
        .filter((candidate: ParsedCandidate<T>): boolean => {
          return (
            (candidate.row.providerResourceId || "").trim().toLowerCase() ===
            ownId
          );
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
    if (
      candidate.parsed.type.toLowerCase() !==
        APP_SERVICE_SITE_TYPE.toLowerCase() ||
      candidate.parsed.name.toLowerCase() !== siteName
    ) {
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
 * The app's site among `candidates` (resolveCloudAppSite), or null when
 * none is.
 */
export function matchCloudAppPlatformResource<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): T | null {
  return resolveCloudAppSite(data).site;
}

/*
 * How a site the server kept for an app was found, said again from the two
 * ids: by the app's own cloud.resource_id when it is the site's, else by
 * name (the only other way resolveCloudAppSite ties the two).
 */
export function getCloudAppSiteMatchOf(data: {
  app: CloudAppPlatformResourceSource;
  site: CloudPlatformResourceCandidate;
}): CloudAppSiteMatch {
  const ownId: string = (data.app.providerResourceId || "")
    .trim()
    .toLowerCase();

  return ownId &&
    ownId === (data.site.providerResourceId || "").trim().toLowerCase()
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
