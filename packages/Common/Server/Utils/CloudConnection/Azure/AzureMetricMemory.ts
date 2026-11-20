import {
  CloudMetricNotRead,
  CloudMetricNotReadKind,
  CloudResourceMetricStatus,
  readCloudResourceMetricStatus,
  trimCloudMetricError,
} from "../../../../Types/Cloud/CloudResourceMetricCollection";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  AzureMetricBatchRefusal,
  AzureMetricNotRead,
  AzureMetricPlace,
  AzureMetricResourceRead,
  AzureMetricToRead,
  isAzureMetricThrottle,
  isAzureUnsupportedMetricsRefusal,
} from "./AzureMetricReads";

/*
 * WHAT AN AZURE CONNECTION REMEMBERS OF ITS METRIC READS (#10291), in its
 * pull state, from one read to the next:
 *
 *   - azureMetricStatus: per resource, what the last reads could not read
 *     of its metrics (CloudResourceMetricStatus). A metric Azure Monitor
 *     does not serve for it is left out of the reads until its `until`, a
 *     day on; one it was busy for, or failed, is asked again at the next
 *     read, which clears it once answered. The resource's pages say so.
 *   - azureMetricBatchesOff: who Azure refused to read in batches, and
 *     until when: a subscription (401, 403 - the app has Monitoring Reader
 *     on some of its resources, not on the subscription, as getBatch
 *     needs), a type in a Region (400, 404), or every batch of the
 *     connection ("*", the batch API's sign-in was refused). Their
 *     resources are read one at a time until then.
 *
 * And the read's warnings about them, in the words the connection's
 * status shows.
 */

export const AZURE_UNSUPPORTED_METRIC_RECHECK_MS: number = 24 * 60 * 60 * 1000;
export const AZURE_METRIC_BATCH_OFF_MS: number = 24 * 60 * 60 * 1000;
export const AZURE_METRIC_STATUS_MAX_AGE_MS: number = 7 * 24 * 60 * 60 * 1000;
export const AZURE_MAX_METRIC_STATUSES: number = 2000;
// The key of a refusal of every batch of the connection.
export const AZURE_ALL_BATCHES_KEY: string = "*";

const CUT_SHORT_ERROR: string =
  "The read reached its limit before this resource. The next read reads it.";
const SENTENCE_END: RegExp = /[.!?]$/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A cloud's words as a sentence of a warning: with its full stop.
function asSentence(text: string): string {
  const trimmed: string = text.trim();

  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

// What a connection keeps, read defensively: unknown entries are dropped.
export function readAzureMetricStatuses(
  value: unknown,
): Record<string, CloudResourceMetricStatus> {
  const statuses: Record<string, CloudResourceMetricStatus> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return statuses;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const status: CloudResourceMetricStatus =
      readCloudResourceMetricStatus(item);

    if (status.failed || status.metrics) {
      statuses[key.toLowerCase()] = status;
    }
  }

  return statuses;
}

// Whether a read leaves a metric out: Azure does not serve it for the resource, until then.
export function isAzureMetricUnsupportedNow(data: {
  status: CloudResourceMetricStatus | undefined;
  metricName: string;
  now: Date;
}): boolean {
  const known: CloudMetricNotRead | undefined =
    data.status?.metrics?.[data.metricName.toLowerCase()];
  const until: number = known?.until ? Date.parse(known.until) : NaN;

  return (
    known?.kind === CloudMetricNotReadKind.Unsupported &&
    Number.isFinite(until) &&
    until > data.now.getTime()
  );
}

/*
 * What a resource's status is after a read: each metric Azure would not
 * answer, since when (kept from the reads before), and - for one it does
 * not serve - until when it is left out; nothing of a metric it answered.
 * What the read did not ask about (a grain not due, a metric left out)
 * stays as it was. When no call for the resource was answered, the
 * resource as a whole, and only the metrics it does not serve. Null when
 * nothing is left to say.
 */
export function getNextAzureMetricStatus<T extends AzureMetricToRead>(data: {
  previous: CloudResourceMetricStatus | undefined;
  read: AzureMetricResourceRead<T>;
  now: Date;
}): CloudResourceMetricStatus | null {
  const nowIso: string = data.now.toISOString();
  const previous: CloudResourceMetricStatus = data.previous || {};
  const failure: unknown = data.read.failure ?? data.read.refusal;
  const isFailed: boolean =
    data.read.answeredCalls === 0 &&
    (failure !== undefined || data.read.isCutShort);
  const metrics: Record<string, CloudMetricNotRead> = {};
  const settled: Set<string> = new Set<string>();

  for (const metric of data.read.read) {
    settled.add(metric.name.toLowerCase());
  }

  if (!isFailed) {
    for (const notRead of data.read.notRead) {
      const key: string = notRead.metric.name.toLowerCase();
      const known: CloudMetricNotRead | undefined = previous.metrics?.[key];

      settled.add(key);
      metrics[key] = {
        name: notRead.metric.name,
        kind: notRead.kind,
        error: trimCloudMetricError(notRead.message || notRead.code),
        since: known?.since || nowIso,
        at: nowIso,
        ...(notRead.kind === CloudMetricNotReadKind.Unsupported
          ? {
              until: new Date(
                data.now.getTime() + AZURE_UNSUPPORTED_METRIC_RECHECK_MS,
              ).toISOString(),
            }
          : {}),
      };
    }
  }

  for (const [key, known] of Object.entries(previous.metrics || {})) {
    if (
      !settled.has(key) &&
      !metrics[key] &&
      (!isFailed || known.kind === CloudMetricNotReadKind.Unsupported)
    ) {
      metrics[key] = known;
    }
  }

  let failed: CloudResourceMetricStatus["failed"] = previous.failed;

  if (data.read.answeredCalls > 0) {
    failed = undefined;
  } else if (isFailed) {
    failed = {
      error: trimCloudMetricError(
        failure !== undefined ? messageOf(failure) : CUT_SHORT_ERROR,
      ),
      since: previous.failed?.since || nowIso,
      at: nowIso,
    };
  }

  const status: CloudResourceMetricStatus = {
    ...(failed ? { failed } : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
  };

  return status.failed || status.metrics ? status : null;
}

// When a status last said something new.
function getStatusAt(status: CloudResourceMetricStatus): number {
  let newest: number = status.failed ? Date.parse(status.failed.at) : 0;

  for (const metric of Object.values(status.metrics || {})) {
    newest = Math.max(newest, Date.parse(metric.at) || 0);
  }

  return newest;
}

/*
 * The statuses a connection keeps: none older than
 * AZURE_METRIC_STATUS_MAX_AGE_MS - of a resource no read reaches any more -
 * and the newest AZURE_MAX_METRIC_STATUSES.
 */
export function pruneAzureMetricStatuses(data: {
  statuses: Record<string, CloudResourceMetricStatus>;
  now: Date;
}): Record<string, CloudResourceMetricStatus> {
  const oldest: number = data.now.getTime() - AZURE_METRIC_STATUS_MAX_AGE_MS;
  const kept: Array<[string, CloudResourceMetricStatus, number]> = [];

  for (const [key, status] of Object.entries(data.statuses)) {
    const at: number = getStatusAt(status);

    if (at >= oldest) {
      kept.push([key, status, at]);
    }
  }

  kept.sort(
    (
      a: [string, CloudResourceMetricStatus, number],
      b: [string, CloudResourceMetricStatus, number],
    ): number => {
      return b[2] - a[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    },
  );

  const statuses: Record<string, CloudResourceMetricStatus> = {};

  for (const [key, status] of kept.slice(0, AZURE_MAX_METRIC_STATUSES)) {
    statuses[key] = status;
  }

  return statuses;
}

// The refused batches still in force: each key with its ISO end.
export function readAzureMetricBatchesOff(data: {
  kept: unknown;
  now: Date;
}): Record<string, string> {
  const batchesOff: Record<string, string> = {};

  if (!data.kept || typeof data.kept !== "object" || Array.isArray(data.kept)) {
    return batchesOff;
  }

  for (const [key, until] of Object.entries(
    data.kept as Record<string, unknown>,
  )) {
    const time: number = typeof until === "string" ? Date.parse(until) : NaN;

    if (Number.isFinite(time) && time > data.now.getTime()) {
      batchesOff[key] = new Date(time).toISOString();
    }
  }

  return batchesOff;
}

// A subscription's key, and a type's in a Region.
export function getAzureMetricBatchOffKeys(place: AzureMetricPlace): {
  subscription: string;
  type: string;
} {
  const subscription: string = place.subscriptionId.trim().toLowerCase();

  return {
    subscription,
    type: [
      subscription,
      place.region.trim().toLowerCase(),
      place.type.trim().toLowerCase(),
    ].join("|"),
  };
}

export function isAzureMetricBatchOff(data: {
  batchesOff: Record<string, string>;
  place: AzureMetricPlace;
}): boolean {
  const keys: { subscription: string; type: string } =
    getAzureMetricBatchOffKeys(data.place);

  return Boolean(
    data.batchesOff[AZURE_ALL_BATCHES_KEY] ||
      data.batchesOff[keys.subscription] ||
      data.batchesOff[keys.type],
  );
}

/*
 * What the read's refused batches leave the connection with: who is read
 * a resource at a time, until when - and the warnings that say so, one
 * each. A batch refused because a resource does not publish a metric of
 * its type's is none: that resource is read with its own definitions,
 * and its type's batches go on. One that did not get through (no status)
 * is read a resource at a time this read only.
 */
export function rememberAzureMetricBatchRefusals(data: {
  batchesOff: Record<string, string>;
  refusals: Array<AzureMetricBatchRefusal>;
  signInFailure?: unknown;
  now: Date;
}): Array<string> {
  const warnings: Array<string> = [];
  const until: string = new Date(
    data.now.getTime() + AZURE_METRIC_BATCH_OFF_MS,
  ).toISOString();
  const day: string = until.slice(0, 10);
  const said: Set<string> = new Set<string>();

  if (data.signInFailure !== undefined) {
    const isRefused: boolean =
      data.signInFailure instanceof LlmProviderError &&
      data.signInFailure.kind === CloudConnectionFailureKind.Authentication;

    if (isRefused) {
      data.batchesOff[AZURE_ALL_BATCHES_KEY] = until;
    }

    warnings.push(
      `Could not sign in to Azure Monitor's metrics API, which reads the metrics of many resources at once: ${asSentence(
        messageOf(data.signInFailure),
      )} Metrics are read a resource at a time${isRefused ? ` until ${day}` : " this time"}.`,
    );
  }

  for (const refusal of data.refusals) {
    if (isAzureUnsupportedMetricsRefusal(refusal.error)) {
      continue;
    }

    const status: number | undefined =
      refusal.error instanceof LlmProviderError
        ? refusal.error.statusCode
        : undefined;
    const keys: { subscription: string; type: string } =
      getAzureMetricBatchOffKeys(refusal.place);
    const isSubscription: boolean = status === 401 || status === 403;
    const key: string = isSubscription ? keys.subscription : keys.type;

    if (said.has(key)) {
      continue;
    }

    said.add(key);

    const who: string = isSubscription
      ? `subscription ${refusal.place.subscriptionId}`
      : `${refusal.place.type} in ${refusal.place.region} of subscription ${refusal.place.subscriptionId}`;

    if (status === undefined || isAzureMetricThrottle(refusal.error)) {
      warnings.push(
        `Azure Monitor could not read the metrics of ${who} in batches: ${asSentence(
          messageOf(refusal.error),
        )} They are read a resource at a time this time.`,
      );
      continue;
    }

    data.batchesOff[key] = until;
    warnings.push(
      `Azure Monitor refused to read the metrics of ${who} in batches: ${asSentence(
        messageOf(refusal.error),
      )} They are read a resource at a time until ${day}.${
        status === 401
          ? " Reading them in batches takes the Monitoring Reader role on the subscription itself."
          : ""
      }`,
    );
  }

  return warnings;
}

/*
 * A read's warning about a metric it could not read of some resources:
 * "Azure Monitor could not read <metric> of <n> resources" - the words
 * CloudUnreportedKeyMetrics matches a resource's metric by - then why, and
 * what happens next: a busy Azure is asked again at the next read, a
 * metric it does not serve not until a day has passed.
 */
export function describeAzureMetricNotRead<T extends AzureMetricToRead>(data: {
  notRead: AzureMetricNotRead<T>;
  resources: number;
  now: Date;
}): string {
  const noun: string = data.resources === 1 ? "resource" : "resources";
  const said: string = data.notRead.message || data.notRead.code;
  const lead: string = `Azure Monitor could not read ${data.notRead.metric.name} of ${data.resources} ${noun}`;

  if (data.notRead.kind === CloudMetricNotReadKind.Throttled) {
    return `${lead}: it was busy (${said}). The next read asks again.`;
  }

  if (data.notRead.kind === CloudMetricNotReadKind.Unsupported) {
    const day: string = new Date(
      data.now.getTime() + AZURE_UNSUPPORTED_METRIC_RECHECK_MS,
    )
      .toISOString()
      .slice(0, 10);

    return `${lead}: it does not serve it for ${
      data.resources === 1 ? "it" : "them"
    } (${said}). It is not asked for again until ${day}.`;
  }

  return `${lead}: ${said}`;
}

// Why a resource could not be read at all, for the read's warning.
export function describeAzureMetricReadFailure(error: unknown): string {
  return isAzureMetricThrottle(error)
    ? `Azure Monitor was busy (${messageOf(error)}). The next read asks again.`
    : messageOf(error);
}
