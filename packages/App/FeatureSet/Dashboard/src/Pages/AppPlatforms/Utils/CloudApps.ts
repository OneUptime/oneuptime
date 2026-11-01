import { ManagedCloudPlatform } from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import { shortenEcsClusterArn } from "Common/Utils/Telemetry/CloudInstanceIdentity";
import { getShortCloudAppRevision } from "Common/Utils/Telemetry/CloudAppRevisionName";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
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
 * "cluster production": what keeps an app apart from another of its name,
 * as a line about it says it - its platform's noun, cased as the middle of
 * a line is in the reader's language ("cluster" in English, "Cluster" in
 * German, whose nouns keep their capital - it was lower-cased in every
 * language), and the name. Empty when the app has none, or its platform
 * keeps no two apps of one name apart.
 */
export function getCloudAppGroupLabel(data: {
  groupName: string | null | undefined;
  cloudPlatform: string | null | undefined;
  translator: Pick<Translator, "translateTemplate">;
}): string {
  const name: string = (data.groupName || "").trim();
  const noun: string | null = getCloudAppGroupNoun(data.cloudPlatform);

  if (!name || !noun) {
    return "";
  }

  return data.translator.translateTemplate("{{noun}} {{name}}", {
    noun: translatableTerm(noun, { inSentence: true }),
    name,
  });
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

const ECS_CLUSTER_ATTRIBUTE: string = "aws.ecs.cluster.arn";
const ECS_CLUSTER_FILTER_KEY: string = `${RESOURCE_ATTRIBUTE_PREFIX}${ECS_CLUSTER_ATTRIBUTE}`;

/*
 * Whether one of an app's own attributes (unprefixed) is what keeps it apart
 * from another app of its name - an ECS cluster, an Elastic Beanstalk
 * environment, an App Service slot - rather than its name.
 */
export function isCloudAppGroupAttribute(key: string): boolean {
  return (
    key === ECS_CLUSTER_ATTRIBUTE || key.startsWith("deployment.environment")
  );
}

// Whether a filter key is the attribute an app is kept apart by.
function isGroupFilterKey(key: string): boolean {
  return (
    key.startsWith(RESOURCE_ATTRIBUTE_PREFIX) &&
    isCloudAppGroupAttribute(key.slice(RESOURCE_ATTRIBUTE_PREFIX.length))
  );
}

/*
 * What one of an app's own attributes is, as its platform calls it: "App"
 * for the one that names it, "Cluster", "Environment" or "Slot" for the one
 * that keeps it apart (getCloudAppGroupNoun) - the words its telemetry
 * chips use, so its Details card reads "Cluster (aws.ecs.cluster.arn)".
 */
export function getCloudAppAttributeNoun(data: {
  key: string;
  cloudPlatform: string | null | undefined;
}): string {
  return isCloudAppGroupAttribute(data.key)
    ? getCloudAppGroupNoun(data.cloudPlatform) || translationKey("Group")
    : translationKey("App");
}

/*
 * An app's own attributes in the order its Details card lists them: the
 * ones that name it first, then the one that keeps it apart, each by key.
 */
export function getCloudAppDetailAttributeKeys(
  app: CloudAppScopeSource | null | undefined,
): Array<string> {
  const keys: Array<string> = Object.keys(getCloudAppAttributes(app));

  return [
    ...keys.filter((key: string): boolean => {
      return !isCloudAppGroupAttribute(key);
    }),
    ...keys.filter((key: string): boolean => {
      return isCloudAppGroupAttribute(key);
    }),
  ];
}

/*
 * Labels for the chips the telemetry viewers draw above an app's results:
 * the environment's ("Platform", "Account", "Region") and the app's own -
 * "App", and what keeps it apart from another of its name, as its platform
 * calls it ("Cluster", "Slot") - so a chip reads "App: checkout", not the
 * raw key.
 */
export function getCloudAppTelemetryDisplayKeys(data: {
  filters: Record<string, string>;
  environmentDisplayKeys: Record<string, string>;
  cloudPlatform: string | null | undefined;
}): Record<string, string> {
  const displayKeys: Record<string, string> = {
    ...data.environmentDisplayKeys,
  };

  for (const key of Object.keys(data.filters)) {
    if (displayKeys[key] !== undefined) {
      continue;
    }

    displayKeys[key] = isGroupFilterKey(key)
      ? getCloudAppGroupNoun(data.cloudPlatform) || translationKey("Group")
      : translationKey("App");
  }

  return displayKeys;
}

/*
 * The values those chips show, where the filter's own is not how people
 * know it: an ECS cluster by its name, not its ARN. Display only.
 */
export function getCloudAppTelemetryDisplayValues(
  filters: Record<string, string>,
): Record<string, string> {
  const displayValues: Record<string, string> = {};
  const cluster: string | undefined = filters[ECS_CLUSTER_FILTER_KEY];

  if (cluster) {
    displayValues[ECS_CLUSTER_FILTER_KEY] = shortenEcsClusterArn(cluster);
  }

  return displayValues;
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
 * shown as it is - as the server's feed lines and change titles say it
 * (Common/Utils/Telemetry/CloudAppRevisionName).
 */
export function getShortRevision(data: {
  revision: string | null | undefined;
  appName: string | null | undefined;
}): string {
  return getShortCloudAppRevision(data);
}

// A deploy or a rollback, as an app's charts mark it.
export enum CloudAppChangeMarkerKind {
  Deployed = "deployed",
  RolledBack = "rolled-back",
}

export interface CloudAppChangeMarker {
  kind: CloudAppChangeMarkerKind;
  time: Date;
  revision: string;
  previousRevision: string;
}

export interface CloudAppRevisionMarkerSource {
  revision?: string | null | undefined;
  previousRevision?: string | null | undefined;
  firstSeenAt?: Date | string | null | undefined;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * The deploys and the rollback inside a chart's window. A revision the app
 * ran after another one is a deploy at the time it was first seen (the
 * first revision OneUptime saw is not: it names no revision before it). The
 * app going back to a revision it ran before is a rollback at the time it
 * did (currentRevisionSince), when that is after the revision was first
 * seen. Oldest first.
 */
export function getCloudAppChangeMarkers(data: {
  revisions: ReadonlyArray<CloudAppRevisionMarkerSource>;
  currentRevision?: string | null | undefined;
  currentRevisionSince?: Date | string | null | undefined;
  previousRevision?: string | null | undefined;
  start: Date;
  end: Date;
}): Array<CloudAppChangeMarker> {
  const markers: Array<CloudAppChangeMarker> = [];
  const isInWindow: (date: Date) => boolean = (date: Date): boolean => {
    return (
      date.getTime() >= data.start.getTime() &&
      date.getTime() <= data.end.getTime()
    );
  };

  let currentFirstSeenAt: Date | null = null;
  let wentBackFromFirstSeenAt: Date | null = null;

  for (const row of data.revisions) {
    const revision: string = (row.revision || "").trim();
    const previousRevision: string = (row.previousRevision || "").trim();
    const firstSeenAt: Date | null = toDate(row.firstSeenAt);

    if (revision && revision === (data.currentRevision || "").trim()) {
      currentFirstSeenAt = firstSeenAt;
    }

    if (revision && revision === (data.previousRevision || "").trim()) {
      wentBackFromFirstSeenAt = firstSeenAt;
    }

    if (!revision || !previousRevision || !firstSeenAt) {
      continue;
    }

    if (isInWindow(firstSeenAt)) {
      markers.push({
        kind: CloudAppChangeMarkerKind.Deployed,
        time: firstSeenAt,
        revision,
        previousRevision,
      });
    }
  }

  const since: Date | null = toDate(data.currentRevisionSince);
  const current: string = (data.currentRevision || "").trim();
  const wentBackFrom: string = (data.previousRevision || "").trim();

  /*
   * The app became current again on a revision it had run before: it went
   * back to it then - a rollback when it is older than the one it replaced,
   * a deploy of it again when it is newer. A minute's slack keeps a deploy's
   * own first sighting from reading as a second change.
   */
  if (
    since &&
    current &&
    wentBackFrom &&
    currentFirstSeenAt &&
    since.getTime() - currentFirstSeenAt.getTime() > 60 * 1000 &&
    isInWindow(since)
  ) {
    const isOlder: boolean =
      !wentBackFromFirstSeenAt ||
      currentFirstSeenAt.getTime() < wentBackFromFirstSeenAt.getTime();

    markers.push({
      kind: isOlder
        ? CloudAppChangeMarkerKind.RolledBack
        : CloudAppChangeMarkerKind.Deployed,
      time: since,
      revision: current,
      previousRevision: wentBackFrom,
    });
  }

  return markers.sort(
    (a: CloudAppChangeMarker, b: CloudAppChangeMarker): number => {
      return a.time.getTime() - b.time.getTime();
    },
  );
}

// Every change the revisions record, whenever it was.
const ALL_TIME: { start: Date; end: Date } = {
  start: new Date(0),
  end: new Date(8.64e15),
};

/*
 * Whether the revision an app runs is one it went back to: the last change
 * that made it current was a rollback (getCloudAppChangeMarkers' rule, over
 * all time). Its header then says "Rolled back 25 minutes ago", not
 * "Deployed": the app went back to a revision it had run before, older than
 * the one it replaced. False while the revisions do not say so - the first
 * revision OneUptime saw, or revisions not read yet.
 */
export function isCloudAppRolledBack(data: {
  revisions: ReadonlyArray<CloudAppRevisionMarkerSource>;
  currentRevision?: string | null | undefined;
  currentRevisionSince?: Date | string | null | undefined;
  previousRevision?: string | null | undefined;
}): boolean {
  const current: string = (data.currentRevision || "").trim();

  if (!current) {
    return false;
  }

  const ownChanges: Array<CloudAppChangeMarker> = getCloudAppChangeMarkers({
    ...data,
    ...ALL_TIME,
  }).filter((marker: CloudAppChangeMarker): boolean => {
    return marker.revision === current;
  });
  const latest: CloudAppChangeMarker | undefined =
    ownChanges[ownChanges.length - 1];

  return latest?.kind === CloudAppChangeMarkerKind.RolledBack;
}
