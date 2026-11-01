import { ManagedCloudPlatform } from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  CloudResourceScopeSource,
  getCloudResourceAttributeFilters,
  isCloudInstanceLive,
} from "./CloudResourceTelemetryScope";

/*
 * App Platforms' apps (CloudApp) - what a row, a list and an app's page read
 * off them, and how they are scoped onto telemetry. React-free, so all of it
 * is tested without a renderer.
 *
 * An app is one service of an environment, named as its platform names it:
 * an ECS task definition family, a Cloud Run service, a Container App. The
 * ingest stores the exact resource attributes its telemetry carries
 * (telemetryAttributes, unprefixed); a span, log or metric is the app's when
 * it carries those AND its environment's cloud.* attributes.
 */

// The prefix ingest gives resource attributes on spans, logs and metrics.
export const RESOURCE_ATTRIBUTE_PREFIX: string = "resource.";

/*
 * An app is Running while its telemetry arrives: seen inside the window an
 * instance counts as live in. One that went quiet is Not reporting.
 */
export const CLOUD_APP_LIVE_WINDOW_MINUTES: number =
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES;

export enum CloudAppState {
  Running = "running",
  NotReporting = "not-reporting",
}

export const CLOUD_APP_STATE_LABELS: Readonly<Record<CloudAppState, string>> = {
  [CloudAppState.Running]: translationKey("Running"),
  [CloudAppState.NotReporting]: translationKey("Not reporting"),
};

export function getCloudAppState(
  lastSeenAt: Date | string | null | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): CloudAppState {
  return isCloudInstanceLive(lastSeenAt, now)
    ? CloudAppState.Running
    : CloudAppState.NotReporting;
}

/*
 * What keeps two apps of one name apart, as the platform calls it: an ECS
 * cluster, an Elastic Beanstalk environment, an App Service slot. Null on
 * the platforms whose app names are unique in an account and region.
 */
export function getCloudAppGroupNoun(
  cloudPlatform: string | null | undefined,
): string | null {
  switch (cloudPlatform) {
    case ManagedCloudPlatform.AwsEcs:
      return translationKey("Cluster");
    case ManagedCloudPlatform.AwsElasticBeanstalk:
      return translationKey("Environment");
    case ManagedCloudPlatform.AzureAppService:
      return translationKey("Slot");
    default:
      return null;
  }
}

/*
 * The revision an app runs, as its platform calls it: a task definition
 * revision on ECS, a version on App Engine and Elastic Beanstalk, a
 * revision everywhere else.
 */
export function getCloudAppRevisionNoun(
  cloudPlatform: string | null | undefined,
): string {
  switch (cloudPlatform) {
    case ManagedCloudPlatform.AwsEcs:
      return translationKey("Task definition revision");
    case ManagedCloudPlatform.GcpAppEngine:
    case ManagedCloudPlatform.AwsElasticBeanstalk:
      return translationKey("Version");
    default:
      return translationKey("Revision");
  }
}

// The subset of CloudApp the telemetry scope reads.
export interface CloudAppScopeSource {
  telemetryAttributes?: Record<string, unknown> | null | undefined;
}

// The app's own attributes, as sent: { "aws.ecs.task.family": "checkout" }.
export function getCloudAppAttributes(
  app: CloudAppScopeSource | null | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  const stored: Record<string, unknown> =
    (app?.telemetryAttributes as Record<string, unknown> | undefined) || {};

  for (const key of Object.keys(stored).sort()) {
    const value: unknown = stored[key];

    if (typeof value === "string" && value.trim() && key.trim()) {
      attributes[key.trim()] = value;
    }
  }

  return attributes;
}

/*
 * Whether an app can be told apart in telemetry: ingest stored at least one
 * attribute for it. One whose name was too long to filter by has none, and
 * its telemetry tabs say so instead of showing its whole environment's.
 */
export function isCloudAppScoped(
  app: CloudAppScopeSource | null | undefined,
): boolean {
  return Object.keys(getCloudAppAttributes(app)).length > 0;
}

/*
 * The attribute filter for an app's spans, logs and metrics: its
 * environment's cloud.* attributes and its own, under the resource. prefix
 * the stored telemetry carries them by.
 */
export function getCloudAppTelemetryFilters(data: {
  environment: CloudResourceScopeSource | null | undefined;
  app: CloudAppScopeSource | null | undefined;
}): Record<string, string> {
  const filters: Record<string, string> = getCloudResourceAttributeFilters(
    data.environment,
  );
  const own: Record<string, string> = getCloudAppAttributes(data.app);

  for (const key of Object.keys(own)) {
    filters[`${RESOURCE_ATTRIBUTE_PREFIX}${key}`] = own[key] as string;
  }

  return filters;
}

/*
 * Labels for the chips the telemetry viewers draw above an app's results:
 * the environment's ("Platform", "Account", "Region") and the app's own
 * attribute names, so a chip reads "App: checkout", not the raw key.
 */
export function getCloudAppTelemetryDisplayKeys(
  filters: Record<string, string>,
  environmentDisplayKeys: Record<string, string>,
): Record<string, string> {
  const displayKeys: Record<string, string> = { ...environmentDisplayKeys };

  for (const key of Object.keys(filters)) {
    if (displayKeys[key] !== undefined) {
      continue;
    }

    displayKeys[key] =
      key === `${RESOURCE_ATTRIBUTE_PREFIX}aws.ecs.cluster.arn` ||
      key.startsWith(`${RESOURCE_ATTRIBUTE_PREFIX}deployment.environment`)
        ? translationKey("Group")
        : translationKey("App");
  }

  return displayKeys;
}

/*
 * The requests, errors and p95 of each app, from its entry spans (where
 * work enters a service) over a window. Null numbers are unknown, not none.
 */
export interface CloudAppSignals {
  requests: number;
  errors: number;
  errorRatePercent: number | null;
  p95Ms: number | null;
}

export interface CloudAppSignalSource extends CloudAppScopeSource {
  _id?: unknown;
  id?: unknown;
  cloudResourceId?: unknown;
}

function idOf(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

/*
 * The reads one list of apps needs: the apps of one environment that are
 * named by the same attributes are read together, grouped by those
 * attributes (/telemetry/traces/analytics groups by at most two). Apps with
 * no attributes are not read.
 */
export interface CloudAppSignalRead {
  environmentId: string;
  // The grouping keys, prefixed: ["resource.aws.ecs.cluster.arn", ...].
  groupBy: Array<string>;
  appIds: Array<string>;
}

export const MAX_SIGNAL_GROUP_BY_KEYS: number = 2;

export function getCloudAppSignalReads(
  apps: ReadonlyArray<CloudAppSignalSource>,
): Array<CloudAppSignalRead> {
  const reads: Map<string, CloudAppSignalRead> = new Map<
    string,
    CloudAppSignalRead
  >();

  for (const app of apps) {
    const appId: string = idOf(app._id) || idOf(app.id);
    const environmentId: string = idOf(app.cloudResourceId);
    const keys: Array<string> = Object.keys(getCloudAppAttributes(app)).map(
      (key: string): string => {
        return `${RESOURCE_ATTRIBUTE_PREFIX}${key}`;
      },
    );

    if (
      !appId ||
      !environmentId ||
      keys.length === 0 ||
      keys.length > MAX_SIGNAL_GROUP_BY_KEYS
    ) {
      continue;
    }

    const readKey: string = JSON.stringify([environmentId, keys]);
    let read: CloudAppSignalRead | undefined = reads.get(readKey);

    if (!read) {
      read = { environmentId, groupBy: keys, appIds: [] };
      reads.set(readKey, read);
    }

    read.appIds.push(appId);
  }

  return Array.from(reads.values());
}

// One row of a /telemetry/traces/analytics table answer.
export interface CloudAppSignalRow {
  groupValues?: Record<string, unknown> | null | undefined;
  count?: unknown;
  errorCount?: unknown;
  p95DurationMs?: unknown;
}

function toNumber(value: unknown): number {
  const n: number = Number(value);

  return Number.isFinite(n) ? n : 0;
}

/*
 * The signals of a read's apps, from the rows its table returned: each app
 * takes the row whose group values are its own attributes. An app with no
 * row sent no request in the window - zero requests, its error rate and
 * p95 unknown.
 */
export function matchCloudAppSignals(data: {
  apps: ReadonlyArray<CloudAppSignalSource>;
  rows: ReadonlyArray<CloudAppSignalRow>;
}): Map<string, CloudAppSignals> {
  const byValues: Map<string, CloudAppSignalRow> = new Map<
    string,
    CloudAppSignalRow
  >();

  for (const row of data.rows) {
    const values: Record<string, unknown> = row.groupValues || {};
    const key: string = JSON.stringify(
      Object.keys(values)
        .sort()
        .map((name: string): [string, string] => {
          return [name, String(values[name] ?? "")];
        }),
    );
    byValues.set(key, row);
  }

  const signals: Map<string, CloudAppSignals> = new Map<
    string,
    CloudAppSignals
  >();

  for (const app of data.apps) {
    const appId: string = idOf(app._id) || idOf(app.id);
    const own: Record<string, string> = getCloudAppAttributes(app);
    const key: string = JSON.stringify(
      Object.keys(own)
        .map((name: string): string => {
          return `${RESOURCE_ATTRIBUTE_PREFIX}${name}`;
        })
        .sort()
        .map((name: string): [string, string] => {
          return [
            name,
            own[name.slice(RESOURCE_ATTRIBUTE_PREFIX.length)] as string,
          ];
        }),
    );

    if (!appId) {
      continue;
    }

    const row: CloudAppSignalRow | undefined = byValues.get(key);

    if (!row) {
      signals.set(appId, {
        requests: 0,
        errors: 0,
        errorRatePercent: null,
        p95Ms: null,
      });
      continue;
    }

    const requests: number = toNumber(row.count);
    const errors: number = toNumber(row.errorCount);

    signals.set(appId, {
      requests,
      errors,
      errorRatePercent: requests > 0 ? (errors / requests) * 100 : null,
      p95Ms: requests > 0 ? toNumber(row.p95DurationMs) : null,
    });
  }

  return signals;
}

/*
 * How an error rate reads: the thresholds the environment's Error rate tile
 * colours by - amber from 1%, red from 5%.
 */
export enum CloudAppErrorRateTone {
  Unknown = "unknown",
  Healthy = "healthy",
  Warning = "warning",
  Danger = "danger",
}

export const CLOUD_APP_ERROR_RATE_WARNING_PERCENT: number = 1;
export const CLOUD_APP_ERROR_RATE_DANGER_PERCENT: number = 5;

export function getCloudAppErrorRateTone(
  errorRatePercent: number | null | undefined,
): CloudAppErrorRateTone {
  if (
    errorRatePercent === null ||
    errorRatePercent === undefined ||
    !Number.isFinite(errorRatePercent)
  ) {
    return CloudAppErrorRateTone.Unknown;
  }

  if (errorRatePercent >= CLOUD_APP_ERROR_RATE_DANGER_PERCENT) {
    return CloudAppErrorRateTone.Danger;
  }

  if (errorRatePercent >= CLOUD_APP_ERROR_RATE_WARNING_PERCENT) {
    return CloudAppErrorRateTone.Warning;
  }

  return CloudAppErrorRateTone.Healthy;
}

// The live instances of each app, and of each of its revisions.
export interface CloudAppInstanceSource {
  cloudAppId?: unknown;
  revision?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
}

export function countLiveInstancesByApp(
  instances: ReadonlyArray<CloudAppInstanceSource>,
  now: Date = OneUptimeDate.getCurrentDate(),
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const instance of instances) {
    const appId: string = idOf(instance.cloudAppId);

    if (!appId || !isCloudInstanceLive(instance.lastSeenAt, now)) {
      continue;
    }

    counts.set(appId, (counts.get(appId) || 0) + 1);
  }

  return counts;
}

export function countLiveInstancesByRevision(
  instances: ReadonlyArray<CloudAppInstanceSource>,
  now: Date = OneUptimeDate.getCurrentDate(),
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const instance of instances) {
    const revision: string = (instance.revision || "").trim();

    if (!revision || !isCloudInstanceLive(instance.lastSeenAt, now)) {
      continue;
    }

    counts.set(revision, (counts.get(revision) || 0) + 1);
  }

  return counts;
}

/*
 * A revision's state on an app's Revisions tab: the one it runs now
 * (Current), an older or newer one some instances still run (Running - a
 * rollout draining, a traffic split), or one no live instance runs
 * (Retired).
 */
export enum CloudAppRevisionState {
  Current = "current",
  Running = "running",
  Retired = "retired",
}

export const CLOUD_APP_REVISION_STATE_LABELS: Readonly<
  Record<CloudAppRevisionState, string>
> = {
  [CloudAppRevisionState.Current]: translationKey("Current"),
  [CloudAppRevisionState.Running]: translationKey("Running"),
  [CloudAppRevisionState.Retired]: translationKey("Retired"),
};

export function getCloudAppRevisionState(data: {
  revision: string | null | undefined;
  currentRevision: string | null | undefined;
  liveInstances: number;
}): CloudAppRevisionState {
  const revision: string = (data.revision || "").trim();

  if (revision && revision === (data.currentRevision || "").trim()) {
    return CloudAppRevisionState.Current;
  }

  return data.liveInstances > 0
    ? CloudAppRevisionState.Running
    : CloudAppRevisionState.Retired;
}

/*
 * A revision as a row shows it. Cloud Run and Container Apps name a
 * revision after its service ("checkout-00042-xyz", "checkout--abc123"), so
 * a row under the app leaves the app's name off the front; anything else is
 * shown as it is.
 */
export function getShortRevision(data: {
  revision: string | null | undefined;
  appName: string | null | undefined;
}): string {
  const revision: string = (data.revision || "").trim();
  const appName: string = (data.appName || "").trim();

  if (!revision || !appName) {
    return revision;
  }

  for (const separator of ["--", "-"]) {
    const prefix: string = `${appName}${separator}`;

    if (revision.startsWith(prefix) && revision.length > prefix.length) {
      return revision.slice(prefix.length);
    }
  }

  return revision;
}
