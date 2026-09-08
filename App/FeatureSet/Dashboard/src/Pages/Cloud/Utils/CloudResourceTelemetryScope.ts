import OneUptimeDate from "Common/Types/Date";

/*
 * How a Cloud Environment is scoped onto raw telemetry.
 *
 * An environment is one row per cloud.platform + cloud.account.id +
 * cloud.region, so its logs, traces and metrics are whatever carries those
 * three resource attributes. The Logs, Traces, Metrics and Overview tabs all
 * used to build this filter inline, each with its own copy of the
 * "only include the parts that are set" spread — and each with the same hole:
 * an environment with no cloud.platform (created by hand, no telemetry yet)
 * produced an EMPTY filter, and an empty filter is "everything in the
 * project". A brand-new environment quietly showed every log in the project
 * as its own.
 *
 * This module is the one place that decides what the filter is and, just as
 * importantly, when there is no filter at all (isCloudResourceScoped). Pages
 * must not query telemetry for an unscoped environment.
 */

export const CLOUD_PLATFORM_ATTRIBUTE: string = "resource.cloud.platform";
export const CLOUD_ACCOUNT_ID_ATTRIBUTE: string = "resource.cloud.account.id";
export const CLOUD_REGION_ATTRIBUTE: string = "resource.cloud.region";

/*
 * An instance (running task / replica) counts as live when ingest has seen
 * it inside this window. It is a fixed wall-clock indicator that matches
 * the sweeper's DEFAULT (CLOUD_INSTANCE_STALE_MINUTES = 15): with the
 * default, a row past the window is on its way out and is labelled "Stale"
 * rather than "Running". An operator who raises the sweeper threshold keeps
 * rows around longer, and they read "Stale" until they are removed — the
 * dashboard has no view of that setting, and the docs say so. Do not make
 * the window longer than the sweeper's default: it would count instances
 * that no longer exist.
 */
export const CLOUD_INSTANCE_LIVE_WINDOW_MINUTES: number = 15;

/*
 * The subset of CloudResource the scope depends on. Kept structural so the
 * helpers work on a partially selected model, a plain object in a test, or
 * the full model — all three only ever read these three columns.
 */
export interface CloudResourceScopeSource {
  cloudPlatform?: string | undefined;
  cloudAccountId?: string | undefined;
  cloudRegion?: string | undefined;
}

function cleanAttributeValue(value: string | undefined): string {
  return (value || "").trim();
}

/*
 * True only when the environment carries a cloud.platform. Account id and
 * region alone are not a scope: ingest never creates an environment without
 * a platform, so a platform-less row is a hand-made one that has not been
 * matched to telemetry yet, and its tabs must show the "waiting for
 * telemetry" state instead of an unfiltered viewer.
 */
export function isCloudResourceScoped(
  resource: CloudResourceScopeSource | null | undefined,
): boolean {
  return Boolean(resource && cleanAttributeValue(resource.cloudPlatform));
}

/*
 * The attribute filter for this environment's telemetry — only the parts
 * that are present, so an environment ingest discovered without an account
 * id (some detectors do not report one) still matches its own telemetry.
 * Returns an empty object for an unscoped environment; callers must check
 * isCloudResourceScoped first rather than querying with the empty filter.
 */
export function getCloudResourceAttributeFilters(
  resource: CloudResourceScopeSource | null | undefined,
): Record<string, string> {
  const filters: Record<string, string> = {};

  if (!resource) {
    return filters;
  }

  const platform: string = cleanAttributeValue(resource.cloudPlatform);
  const accountId: string = cleanAttributeValue(resource.cloudAccountId);
  const region: string = cleanAttributeValue(resource.cloudRegion);

  if (platform) {
    filters[CLOUD_PLATFORM_ATTRIBUTE] = platform;
  }
  if (accountId) {
    filters[CLOUD_ACCOUNT_ID_ATTRIBUTE] = accountId;
  }
  if (region) {
    filters[CLOUD_REGION_ATTRIBUTE] = region;
  }

  return filters;
}

/*
 * Human labels for the filter chips the Traces / Metrics viewers render
 * above their results. Same keys as getCloudResourceAttributeFilters, so the
 * two can never disagree about which chips to show.
 */
export function getCloudResourceAttributeDisplayKeys(
  resource: CloudResourceScopeSource | null | undefined,
): Record<string, string> {
  const filters: Record<string, string> =
    getCloudResourceAttributeFilters(resource);
  const displayKeys: Record<string, string> = {};

  if (filters[CLOUD_PLATFORM_ATTRIBUTE] !== undefined) {
    displayKeys[CLOUD_PLATFORM_ATTRIBUTE] = "Platform";
  }
  if (filters[CLOUD_ACCOUNT_ID_ATTRIBUTE] !== undefined) {
    displayKeys[CLOUD_ACCOUNT_ID_ATTRIBUTE] = "Account";
  }
  if (filters[CLOUD_REGION_ATTRIBUTE] !== undefined) {
    displayKeys[CLOUD_REGION_ATTRIBUTE] = "Region";
  }

  return displayKeys;
}

/*
 * Whether an instance's lastSeenAt falls inside the live window. `now` is a
 * parameter so the Overview can evaluate a whole list against one clock
 * reading and tests can pin the boundary.
 */
export function isCloudInstanceLive(
  lastSeenAt: Date | string | null | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): boolean {
  if (!lastSeenAt) {
    return false;
  }

  const seenAt: Date =
    lastSeenAt instanceof Date
      ? lastSeenAt
      : OneUptimeDate.fromString(lastSeenAt);

  if (Number.isNaN(seenAt.getTime())) {
    return false;
  }

  const ageInMinutes: number = (now.getTime() - seenAt.getTime()) / (60 * 1000);

  return ageInMinutes <= CLOUD_INSTANCE_LIVE_WINDOW_MINUTES;
}
