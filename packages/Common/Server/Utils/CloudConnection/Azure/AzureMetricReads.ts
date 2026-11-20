import { AZURE_MAX_METRICS_PER_RESOURCE } from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudMetricNotReadKind } from "../../../../Types/Cloud/CloudResourceMetricCollection";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  CloudKeyedLimiter,
  Settled,
  mapWithConcurrency,
} from "../CloudConcurrency";
import {
  CLOUD_DEFAULT_SLEEP,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import { MetricWindow } from "../CloudMetricWindows";
import AzureArm, {
  AZURE_METRICS_BATCH_MAX_RESOURCES,
  AZURE_METRICS_DATA_PLANE_RESOURCE,
  AzureArmError,
  AzureMetricFailure,
  AzureMetricSeries,
  AzureMetricsAnswer,
} from "./AzureArm";

/*
 * HOW AN AZURE READ ASKS AZURE MONITOR FOR METRICS (#10291).
 *
 * A read hands this the metrics each resource is read with, per read group
 * (a grain's window, AzureReadGroup), and gets back each resource's series
 * and what Azure Monitor would not answer. Four things decide the calls:
 *
 *   1. Aggregations. Azure Monitor reads every aggregation a call names
 *      for every metric in it, and answers a metric that is not served
 *      with one of them with an error of its own: Front Door's
 *      ByteHitRatio asked in a call that also asks RequestCount's Total is
 *      "Sampling type is not found ... Sum", and Cosmos DB's
 *      ThrottledRequestPercentage asked with TotalRequests' Count is "Bad
 *      request". So a call only holds metrics that are each served with
 *      every aggregation the call names, by their definitions'
 *      supportedAggregationTypes (partitionAzureMetricCalls) - one whose
 *      supported aggregations are unknown is asked with its own alone.
 *   2. Batches. Microsoft recommends metrics:getBatch over a call per
 *      resource for a heavy reader: up to 50 resources of one
 *      subscription, Region and type in one request, on Azure Monitor's
 *      regional data plane instead of Resource Manager's limits. Resources
 *      read with the same metrics in the same window share batches; a
 *      resource alone, a split read, a global resource and Azure
 *      Government are asked a resource at a time. A batch Azure refuses is
 *      asked a resource at a time instead, and the caller stops asking for
 *      such batches for a day (batchRefusals).
 *   3. How many at once. AZURE_METRIC_CONCURRENCY calls at once in all,
 *      and AZURE_METRIC_CALLS_PER_PLACE per subscription and Region - half
 *      as many there each time Azure says it is busy ("ServerBusy: Too many
 *      queries are in flight"), for the rest of the read.
 *   4. Asking again. A call Azure throttles (429, 529, 503, ServerBusy) is
 *      asked again after an exponential wait with jitter, or as long as its
 *      Retry-After or x-ms-ratelimit-*-retry-after header asks when that is
 *      longer, AZURE_METRIC_CALL_TRIES times in all, while the read has the
 *      time. A metric Azure answers as busy inside an answer is asked again
 *      in a later round (AZURE_METRIC_ROUNDS), alone with the others that
 *      were. A metric Azure says it does not serve is not: the caller
 *      remembers it (CloudMetricNotReadKind.Unsupported) - unless it was
 *      asked with other aggregations than its own, when it is asked again
 *      with its own alone first.
 *
 * Each call is a request of the read's budget; a spent budget stops the
 * calls not made yet (isCutShort).
 */

export const AZURE_METRIC_CONCURRENCY: number = 8;
export const AZURE_METRIC_CALLS_PER_PLACE: number = 4;
// Tries of one call Azure throttles, the first included.
export const AZURE_METRIC_CALL_TRIES: number = 4;
// Rounds of a read: the first, and the ones that ask again for what was busy.
export const AZURE_METRIC_ROUNDS: number = 3;
export const AZURE_METRIC_FIRST_RETRY_WAIT_MS: number = 2000;
export const AZURE_METRIC_MAX_RETRY_WAIT_MS: number = 30 * 1000;
// At most this much more than a Retry-After asked for, at random.
export const AZURE_METRIC_RETRY_JITTER_MS: number = 1000;
// A wait leaves the read this much of its time at least, or is not waited.
export const AZURE_METRIC_RETRY_MARGIN_MS: number = 10 * 1000;

// A metric as a read asks for it.
export interface AzureMetricToRead {
  name: string;
  // The aggregation it is read, and stored, with.
  aggregation: string;
  /*
   * Every aggregation its definition says Azure Monitor serves it with
   * (supportedAggregationTypes). Unknown: it is asked with its own alone.
   */
  supportedAggregations?: Array<string> | undefined;
}

// The resource a read asks about.
export interface AzureMetricPlace {
  armId: string;
  subscriptionId: string;
  // Its Region, as Resource Manager lists it: "southcentralus".
  region: string;
  // Its type, which is the namespace of its metrics.
  type: string;
}

// Some of a resource's metrics, read in one read group's window.
export interface AzureMetricCallGroup<T extends AzureMetricToRead> {
  // The read group (AzureReadGroup.cursorKey's group): it was read once a call of it is answered.
  groupKey: string;
  grain: string;
  window: MetricWindow;
  metrics: Array<T>;
  // A read split by a dimension: a resource a call, never a batch.
  splitBy?: string | undefined;
  top?: number | undefined;
  orderBy?: string | undefined;
  // Whether a split answered at its `top` says the resource has more than were read.
  reportsCapped?: boolean | undefined;
}

export interface AzureMetricRequest<T extends AzureMetricToRead> {
  place: AzureMetricPlace;
  groups: Array<AzureMetricCallGroup<T>>;
}

// A metric of a resource the read did not get, and why.
export interface AzureMetricNotRead<T extends AzureMetricToRead> {
  metric: T;
  kind: CloudMetricNotReadKind;
  code: string;
  message: string;
}

// What a read got of one resource.
export interface AzureMetricResourceRead<T extends AzureMetricToRead> {
  place: AzureMetricPlace;
  series: Array<AzureMetricSeries & { grain: string }>;
  // The metrics Azure Monitor answered without an error, with points or without.
  read: Array<T>;
  notRead: Array<AzureMetricNotRead<T>>;
  // The metrics of a split that came back with as many series as were asked for.
  capped: Array<string>;
  // Calls of it Azure answered: none, and `failure` says why.
  answeredCalls: number;
  failure?: unknown;
  /*
   * Azure refused a call for naming a metric the resource does not publish
   * (isAzureUnsupportedMetricsRefusal): read it with its own definitions.
   */
  refusal?: unknown;
  // The read reached its limit before some of its calls.
  isCutShort: boolean;
}

// A batch Azure refused: its resources were read a resource at a time.
export interface AzureMetricBatchRefusal {
  place: AzureMetricPlace;
  error: unknown;
}

export interface AzureMetricReadResult<T extends AzureMetricToRead> {
  // Each request's, in the requests' order.
  reads: Array<AzureMetricResourceRead<T>>;
  // The read groups a call of was answered: their windows move on.
  groupsRead: Set<string>;
  batchRefusals: Array<AzureMetricBatchRefusal>;
  // The batch API's sign-in failed: every batch was read a resource at a time.
  batchSignInFailure?: unknown;
  // Calls made, and how many of them were batches.
  calls: number;
  batchCalls: number;
}

/*
 * Azure Monitor refuses a whole metrics call that names a metric the
 * resource does not publish - 400, "Failed to find metric configuration
 * for provider: Microsoft.Sql, resource Type: servers/databases, metric:
 * dtu_consumption_percent, Valid metrics: ..." - rather than answering the
 * others. A type's selection is read from a few of its resources, and
 * another of the type can publish fewer: a vCore database has no DTUs, a
 * Basic load balancer no metrics at all, a Language account none of an
 * Azure OpenAI account's. Such a resource is read with its own definitions
 * instead (AzureCloudConnector).
 */
export function isAzureUnsupportedMetricsRefusal(error: unknown): boolean {
  if (!(error instanceof LlmProviderError) || error.statusCode !== 400) {
    return false;
  }

  const text: string =
    `${error.responseBody || ""} ${error.message}`.toLowerCase();

  return (
    text.includes("failed to find metric configuration") ||
    text.includes("valid metrics:")
  );
}

/*
 * Azure Monitor's words for being too busy to answer: a call's 529 or 429,
 * and a metric's own errorCode in an answer ("Throttled", "Query was
 * throttled with reason: ServerBusy ... QueryThrottledException: Too many
 * queries are in flight"). A whole word: Cosmos DB's metric
 * ThrottledRequestPercentage, named in a refusal's list of valid metrics,
 * is none of them.
 */
const THROTTLE_PATTERN: RegExp =
  /\bthrottled\b|querythrottledexception|serverbusy|server busy|too many (?:requests|queries)|toomanyrequests|queries are in flight/i;
// A metric's error that the next try may not get: a timeout, a server's.
const TRANSIENT_PATTERN: RegExp =
  /timeout|timed out|serviceunavailable|service unavailable|internalservererror|internal server error/i;
/*
 * A metric's error that says Azure Monitor does not serve it so: an
 * aggregation it does not have ("Sampling type is not found"), a query it
 * cannot answer ("Bad request").
 */
const UNSUPPORTED_PATTERN: RegExp =
  /sampling type|badrequest|bad request|not supported|does not support|invalid aggregation|failed to find metric configuration|metricnotfound|metric not found/i;

// What kind of failure a metric's own error in an answer is.
export function classifyAzureMetricFailure(
  failure: Pick<AzureMetricFailure, "code" | "message">,
): CloudMetricNotReadKind {
  const text: string = `${failure.code} ${failure.message}`;

  if (THROTTLE_PATTERN.test(text)) {
    return CloudMetricNotReadKind.Throttled;
  }

  return UNSUPPORTED_PATTERN.test(text)
    ? CloudMetricNotReadKind.Unsupported
    : CloudMetricNotReadKind.Failed;
}

// Whether a metric's own error is worth asking again in this read.
function isRetryableMetricFailure(failure: AzureMetricFailure): boolean {
  return (
    classifyAzureMetricFailure(failure) === CloudMetricNotReadKind.Throttled ||
    TRANSIENT_PATTERN.test(`${failure.code} ${failure.message}`)
  );
}

/*
 * Whether a call's failure is Azure being too busy (or a gateway that did
 * not get through): 429, 502, 503, 504, Azure Monitor's 529, or its words
 * for it. Asked again after a wait.
 */
export function isAzureMetricThrottle(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }

  if (
    error.kind === CloudConnectionFailureKind.RateLimited ||
    [429, 502, 503, 504, 529].includes(error.statusCode || 0)
  ) {
    return true;
  }

  return THROTTLE_PATTERN.test(`${error.responseBody || ""} ${error.message}`);
}

// How long Azure asked to wait before asking again, when it said.
export function readAzureRetryAfterMs(error: unknown): number | undefined {
  if (
    error instanceof AzureArmError &&
    error.rateLimit.retryAfterMs !== undefined
  ) {
    return error.rateLimit.retryAfterMs;
  }

  if (
    error instanceof LlmProviderError &&
    error.retryAfterSeconds !== undefined &&
    Number.isFinite(error.retryAfterSeconds) &&
    error.retryAfterSeconds > 0
  ) {
    return error.retryAfterSeconds * 1000;
  }

  return undefined;
}

/*
 * The wait before try `attempt + 1`: AZURE_METRIC_FIRST_RETRY_WAIT_MS,
 * doubling each try up to AZURE_METRIC_MAX_RETRY_WAIT_MS, of which half is
 * drawn at random - so the calls a throttle stopped together do not all
 * come back together - or what Azure asked for, when that is longer, and up
 * to a second more.
 */
export function getAzureMetricRetryWaitMs(data: {
  attempt: number;
  retryAfterMs?: number | undefined;
  random: () => number;
}): number {
  const exponential: number = Math.min(
    AZURE_METRIC_MAX_RETRY_WAIT_MS,
    AZURE_METRIC_FIRST_RETRY_WAIT_MS * Math.pow(2, Math.max(0, data.attempt)),
  );
  const fraction: number = Math.min(Math.max(data.random(), 0), 1);
  const jittered: number = Math.round(
    exponential / 2 + (fraction * exponential) / 2,
  );

  if (
    data.retryAfterMs !== undefined &&
    Number.isFinite(data.retryAfterMs) &&
    data.retryAfterMs > jittered
  ) {
    return Math.round(
      data.retryAfterMs + fraction * AZURE_METRIC_RETRY_JITTER_MS,
    );
  }

  return jittered;
}

interface PartitionItem<T extends AzureMetricToRead> {
  metric: T;
  index: number;
  own: string;
  allowed: Set<string>;
}

/*
 * A read group's metrics in calls, AZURE_MAX_METRICS_PER_RESOURCE at most
 * each, so every metric of a call is served with every aggregation the
 * call names (its own and the others'). A metric's served aggregations are
 * its definition's (supportedAggregations), or its own alone where they
 * are unknown or it is named in `ownAggregationOnly`. The metrics served
 * with fewest aggregations are placed first, so they are not left without
 * a call the others filled; each call keeps the metrics in their order.
 */
export function partitionAzureMetricCalls<T extends AzureMetricToRead>(
  metrics: Array<T>,
  options: {
    max?: number | undefined;
    // Lowercased names of the metrics asked with their own aggregation alone.
    ownAggregationOnly?: ReadonlySet<string> | undefined;
  } = {},
): Array<Array<T>> {
  const max: number = Math.max(
    1,
    options.max ?? AZURE_MAX_METRICS_PER_RESOURCE,
  );
  const items: Array<PartitionItem<T>> = metrics.map(
    (metric: T, index: number): PartitionItem<T> => {
      const own: string = metric.aggregation.trim().toLowerCase();
      const allowed: Set<string> = new Set<string>([own]);

      if (!options.ownAggregationOnly?.has(metric.name.toLowerCase())) {
        for (const aggregation of metric.supportedAggregations || []) {
          allowed.add(aggregation.trim().toLowerCase());
        }
      }

      return { metric, index, own, allowed };
    },
  );
  const calls: Array<{
    items: Array<PartitionItem<T>>;
    aggregations: Set<string>;
  }> = [];
  const byParticularity: Array<PartitionItem<T>> = [...items].sort(
    (a: PartitionItem<T>, b: PartitionItem<T>): number => {
      return a.allowed.size - b.allowed.size || a.index - b.index;
    },
  );

  for (const item of byParticularity) {
    const call:
      | { items: Array<PartitionItem<T>>; aggregations: Set<string> }
      | undefined = calls.find(
      (candidate: {
        items: Array<PartitionItem<T>>;
        aggregations: Set<string>;
      }): boolean => {
        if (candidate.items.length >= max) {
          return false;
        }

        const named: Array<string> = Array.from(
          new Set<string>([...candidate.aggregations, item.own]),
        );

        return [item, ...candidate.items].every(
          (member: PartitionItem<T>): boolean => {
            return named.every((aggregation: string): boolean => {
              return member.allowed.has(aggregation);
            });
          },
        );
      },
    );

    if (call) {
      call.items.push(item);
      call.aggregations.add(item.own);
    } else {
      calls.push({ items: [item], aggregations: new Set<string>([item.own]) });
    }
  }

  return calls
    .map(
      (call: { items: Array<PartitionItem<T>> }): Array<PartitionItem<T>> => {
        return [...call.items].sort(
          (a: PartitionItem<T>, b: PartitionItem<T>): number => {
            return a.index - b.index;
          },
        );
      },
    )
    .sort((a: Array<PartitionItem<T>>, b: Array<PartitionItem<T>>): number => {
      return a[0]!.index - b[0]!.index;
    })
    .map((call: Array<PartitionItem<T>>): Array<T> => {
      return call.map((item: PartitionItem<T>): T => {
        return item.metric;
      });
    });
}

// The aggregations a call names: each of its metrics' own, once.
function getCallAggregations(metrics: Array<AzureMetricToRead>): Array<string> {
  const seen: Map<string, string> = new Map();

  for (const metric of metrics) {
    const key: string = metric.aggregation.trim().toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, metric.aggregation);
    }
  }

  return Array.from(seen.values());
}

// Where a resource's calls are counted: its subscription and Region.
export function getAzureMetricPlaceKey(place: AzureMetricPlace): string {
  return `${place.subscriptionId.trim().toLowerCase()}|${place.region
    .trim()
    .toLowerCase()}`;
}

// Calls of different places taken in turn, so no place holds every worker.
export function interleaveAzureMetricCalls<T extends { placeKey: string }>(
  calls: Array<T>,
): Array<T> {
  const queues: Map<string, Array<T>> = new Map();

  for (const call of calls) {
    const queue: Array<T> = queues.get(call.placeKey) || [];
    queue.push(call);
    queues.set(call.placeKey, queue);
  }

  const ordered: Array<T> = [];

  while (ordered.length < calls.length) {
    for (const queue of queues.values()) {
      const next: T | undefined = queue.shift();

      if (next) {
        ordered.push(next);
      }
    }
  }

  return ordered;
}

// Some metrics of one resource's read group, as a round asks for them.
interface AzureMetricPiece<T extends AzureMetricToRead> {
  index: number;
  group: AzureMetricCallGroup<T>;
  ownAggregationOnly: Set<string>;
  // Never in a batch: a batch was refused, or left the resource out.
  isSingle: boolean;
  // Asked again because Azure was busy: the round waits before it.
  isBusy: boolean;
  // What each metric's last failure was, should no round get it.
  lastFailure: Map<string, AzureMetricFailure>;
}

interface AzureMetricCall<T extends AzureMetricToRead> {
  placeKey: string;
  // The requests it reads, by index: one, or a batch's.
  indexes: Array<number>;
  isBatch: boolean;
  group: AzureMetricCallGroup<T>;
  metrics: Array<T>;
  pieces: Array<AzureMetricPiece<T>>;
}

type AzureMetricCallOutcome =
  | { kind: "answered"; answers: Map<string, AzureMetricsAnswer> }
  | { kind: "cut-short" }
  | { kind: "failed"; error: unknown; isThrottle: boolean };

export interface AzureMetricReaderOptions {
  arm: AzureArm;
  budget: CloudReadBudget;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // What jitter is drawn from: Math.random unless a test's.
  random?: (() => number) | undefined;
  // Whether a resource may be read in a batch: not where Azure refused its batches lately.
  canBatch?: ((place: AzureMetricPlace) => boolean) | undefined;
  concurrency?: number | undefined;
  callsPerPlace?: number | undefined;
}

export class AzureMetricReader {
  private readonly arm: AzureArm;
  private readonly budget: CloudReadBudget;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly canBatch: (place: AzureMetricPlace) => boolean;
  private readonly concurrency: number;
  private readonly limiter: CloudKeyedLimiter;
  // The batch API's token was refused this read: no more batches.
  private batchSignInFailure: unknown = undefined;

  public constructor(options: AzureMetricReaderOptions) {
    this.arm = options.arm;
    this.budget = options.budget;
    this.sleep = options.sleep || CLOUD_DEFAULT_SLEEP;
    this.random =
      options.random ||
      ((): number => {
        return Math.random();
      });
    this.canBatch =
      options.canBatch ||
      ((): boolean => {
        return true;
      });
    this.concurrency = options.concurrency || AZURE_METRIC_CONCURRENCY;
    this.limiter = new CloudKeyedLimiter(
      options.callsPerPlace || AZURE_METRIC_CALLS_PER_PLACE,
    );
  }

  // How many calls a place may make at once now (CloudKeyedLimiter).
  public getCallsPerPlace(place: AzureMetricPlace): number {
    return this.limiter.getLimit(getAzureMetricPlaceKey(place));
  }

  /*
   * Every request's metrics, in rounds: the first asks for all of them,
   * each later one for what Azure was busy for, or asked with other
   * aggregations than its own, in the round before. `batch: false` asks
   * a resource at a time.
   */
  public async read<T extends AzureMetricToRead>(
    requests: Array<AzureMetricRequest<T>>,
    options: { batch?: boolean | undefined } = {},
  ): Promise<AzureMetricReadResult<T>> {
    const result: AzureMetricReadResult<T> = {
      reads: requests.map(
        (request: AzureMetricRequest<T>): AzureMetricResourceRead<T> => {
          return {
            place: request.place,
            series: [],
            read: [],
            notRead: [],
            capped: [],
            answeredCalls: 0,
            isCutShort: false,
          };
        },
      ),
      groupsRead: new Set<string>(),
      batchRefusals: [],
      calls: 0,
      batchCalls: 0,
    };
    let pieces: Array<AzureMetricPiece<T>> = [];

    requests.forEach((request: AzureMetricRequest<T>, index: number) => {
      for (const group of request.groups) {
        if (group.metrics.length > 0) {
          pieces.push({
            index,
            group,
            ownAggregationOnly: new Set<string>(),
            isSingle: options.batch === false,
            isBusy: false,
            lastFailure: new Map(),
          });
        }
      }
    });

    for (
      let round: number = 0;
      round < AZURE_METRIC_ROUNDS && pieces.length > 0;
      round++
    ) {
      const busy: Array<AzureMetricPiece<T>> = pieces.filter(
        (piece: AzureMetricPiece<T>): boolean => {
          return piece.isBusy;
        },
      );

      if (round > 0 && busy.length > 0) {
        const waitMs: number = getAzureMetricRetryWaitMs({
          attempt: round - 1,
          random: this.random,
        });

        if (this.canWait(waitMs)) {
          await this.sleep(waitMs);
        } else {
          // No time left to wait for what was busy: the rest is asked now.
          this.giveUp(result, busy);
          pieces = pieces.filter((piece: AzureMetricPiece<T>): boolean => {
            return !piece.isBusy;
          });

          if (pieces.length === 0) {
            break;
          }
        }
      }

      let calls: Array<AzureMetricCall<T>> = this.plan(requests, pieces);

      if (
        calls.some((call: AzureMetricCall<T>): boolean => {
          return call.isBatch;
        }) &&
        !(await this.canSignInForBatches(result))
      ) {
        calls = this.plan(requests, pieces);
      }

      const outcomes: Array<Settled<AzureMetricCallOutcome>> =
        await mapWithConcurrency(
          calls,
          this.concurrency,
          async (call: AzureMetricCall<T>): Promise<AzureMetricCallOutcome> => {
            return await this.limiter.run(
              call.placeKey,
              async (): Promise<AzureMetricCallOutcome> => {
                return await this.ask(requests, call);
              },
            );
          },
        );

      result.calls += calls.length;
      result.batchCalls += calls.filter((call: AzureMetricCall<T>) => {
        return call.isBatch;
      }).length;
      pieces = this.settle({
        requests,
        result,
        calls,
        outcomes,
        isLastRound: round + 1 >= AZURE_METRIC_ROUNDS,
      });
    }

    // What the last round left to ask - a batch it refused - is not read.
    this.giveUp(result, pieces);

    return result;
  }

  // A wait leaves the read AZURE_METRIC_RETRY_MARGIN_MS of its time at least.
  private canWait(waitMs: number): boolean {
    return (
      this.budget.getRemainingMs() - waitMs >= AZURE_METRIC_RETRY_MARGIN_MS
    );
  }

  /*
   * A token for Azure Monitor's data plane, asked once before the first
   * batch: false when it cannot be had, and every batch is then asked a
   * resource at a time (batchSignInFailure).
   */
  private async canSignInForBatches(
    result: AzureMetricReadResult<AzureMetricToRead>,
  ): Promise<boolean> {
    if (this.batchSignInFailure !== undefined) {
      return false;
    }

    try {
      await this.arm.getDataPlaneToken(AZURE_METRICS_DATA_PLANE_RESOURCE);
      return true;
    } catch (error) {
      this.batchSignInFailure = error;
      result.batchSignInFailure = error;
      return false;
    }
  }

  private isBatchable(
    place: AzureMetricPlace,
    piece: AzureMetricPiece<AzureMetricToRead>,
  ): boolean {
    return (
      this.batchSignInFailure === undefined &&
      !piece.isSingle &&
      !piece.group.splitBy &&
      this.arm.canBatchMetrics(place.region) &&
      this.canBatch(place)
    );
  }

  /*
   * A round's calls: each piece's metrics in calls of aggregations they are
   * all served with (partitionAzureMetricCalls); those of resources of one
   * subscription, Region and type read with the same metrics in the same
   * window in batches of AZURE_METRICS_BATCH_MAX_RESOURCES, the rest a
   * resource at a time - and a batch of one is a resource's own call.
   */
  private plan<T extends AzureMetricToRead>(
    requests: Array<AzureMetricRequest<T>>,
    pieces: Array<AzureMetricPiece<T>>,
  ): Array<AzureMetricCall<T>> {
    const singles: Array<AzureMetricCall<T>> = [];
    // Batches first: a read that reaches its limit has read the most resources.
    const calls: Array<AzureMetricCall<T>> = [];
    const batches: Map<
      string,
      {
        group: AzureMetricCallGroup<T>;
        metrics: Array<T>;
        members: Array<AzureMetricPiece<T>>;
      }
    > = new Map();

    for (const piece of pieces) {
      const place: AzureMetricPlace = requests[piece.index]!.place;

      for (const metrics of partitionAzureMetricCalls(piece.group.metrics, {
        ownAggregationOnly: piece.ownAggregationOnly,
      })) {
        if (!this.isBatchable(place, piece)) {
          singles.push({
            placeKey: getAzureMetricPlaceKey(place),
            indexes: [piece.index],
            isBatch: false,
            group: piece.group,
            metrics,
            pieces: [piece],
          });
          continue;
        }

        const key: string = [
          getAzureMetricPlaceKey(place),
          place.type.trim().toLowerCase(),
          piece.group.groupKey,
          piece.group.grain,
          piece.group.window.start.toISOString(),
          piece.group.window.end.toISOString(),
          metrics
            .map((metric: T): string => {
              return `${metric.name.toLowerCase()}:${metric.aggregation.toLowerCase()}`;
            })
            .join(","),
        ].join("\n");
        const batch: {
          group: AzureMetricCallGroup<T>;
          metrics: Array<T>;
          members: Array<AzureMetricPiece<T>>;
        } = batches.get(key) || { group: piece.group, metrics, members: [] };

        batch.members.push(piece);
        batches.set(key, batch);
      }
    }

    for (const batch of batches.values()) {
      for (
        let offset: number = 0;
        offset < batch.members.length;
        offset += AZURE_METRICS_BATCH_MAX_RESOURCES
      ) {
        const members: Array<AzureMetricPiece<T>> = batch.members.slice(
          offset,
          offset + AZURE_METRICS_BATCH_MAX_RESOURCES,
        );
        const first: AzureMetricPiece<T> = members[0]!;

        calls.push({
          placeKey: getAzureMetricPlaceKey(requests[first.index]!.place),
          indexes: members.map((member: AzureMetricPiece<T>): number => {
            return member.index;
          }),
          isBatch: members.length > 1,
          group: members.length > 1 ? batch.group : first.group,
          metrics: batch.metrics,
          pieces: members,
        });
      }
    }

    return interleaveAzureMetricCalls([...calls, ...singles]);
  }

  /*
   * One call, asked again while Azure is too busy to answer it - after
   * getAzureMetricRetryWaitMs, and with fewer calls of its place at once
   * from then - AZURE_METRIC_CALL_TRIES times in all, while the read has
   * the time.
   */
  private async ask<T extends AzureMetricToRead>(
    requests: Array<AzureMetricRequest<T>>,
    call: AzureMetricCall<T>,
  ): Promise<AzureMetricCallOutcome> {
    const first: AzureMetricPlace = requests[call.indexes[0]!]!.place;

    for (let attempt: number = 0; ; attempt++) {
      try {
        if (call.isBatch) {
          return {
            kind: "answered",
            answers: await this.arm.getMetricsBatch({
              subscriptionId: first.subscriptionId,
              region: first.region,
              namespace: first.type,
              resourceIds: call.indexes.map((index: number): string => {
                return requests[index]!.place.armId;
              }),
              metrics: call.metrics,
              interval: call.group.grain,
              start: call.group.window.start,
              end: call.group.window.end,
            }),
          };
        }

        const answer: AzureMetricsAnswer = await this.arm.getMetrics({
          resourceId: first.armId,
          metrics: call.metrics,
          interval: call.group.grain,
          start: call.group.window.start,
          end: call.group.window.end,
          ...(call.group.splitBy
            ? {
                splitBy: call.group.splitBy,
                top: call.group.top,
                orderBy: call.group.orderBy,
              }
            : {}),
        });

        return {
          kind: "answered",
          answers: new Map([[first.armId.toLowerCase(), answer]]),
        };
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          return { kind: "cut-short" };
        }

        if (
          isAzureUnsupportedMetricsRefusal(error) ||
          !isAzureMetricThrottle(error)
        ) {
          return { kind: "failed", error, isThrottle: false };
        }

        this.limiter.slowDown(call.placeKey);

        const waitMs: number = getAzureMetricRetryWaitMs({
          attempt,
          retryAfterMs: readAzureRetryAfterMs(error),
          random: this.random,
        });

        if (attempt + 1 >= AZURE_METRIC_CALL_TRIES || !this.canWait(waitMs)) {
          return { kind: "failed", error, isThrottle: true };
        }

        await this.sleep(waitMs);
      }
    }
  }

  /*
   * What a round's calls brought: each resource's series and the metrics
   * Azure would not answer, and the pieces the next round asks again for -
   * what Azure was busy for, what a refused batch held, and what was asked
   * with other aggregations than its own and said it was not served.
   */
  private settle<T extends AzureMetricToRead>(data: {
    requests: Array<AzureMetricRequest<T>>;
    result: AzureMetricReadResult<T>;
    calls: Array<AzureMetricCall<T>>;
    outcomes: Array<Settled<AzureMetricCallOutcome>>;
    isLastRound: boolean;
  }): Array<AzureMetricPiece<T>> {
    const next: Map<string, AzureMetricPiece<T>> = new Map();
    let authenticationFailure: unknown = undefined;

    const askAgain: (again: {
      piece: AzureMetricPiece<T>;
      metric: T;
      isSingle?: boolean | undefined;
      isBusy?: boolean | undefined;
      isOwnAggregationOnly?: boolean | undefined;
      failure?: AzureMetricFailure | undefined;
    }) => void = (again: {
      piece: AzureMetricPiece<T>;
      metric: T;
      isSingle?: boolean | undefined;
      isBusy?: boolean | undefined;
      isOwnAggregationOnly?: boolean | undefined;
      failure?: AzureMetricFailure | undefined;
    }): void => {
      // What waits for Azure to be less busy is asked apart from what need not.
      const key: string = [
        again.piece.index,
        again.piece.group.groupKey,
        again.piece.group.splitBy || "",
        again.isBusy ? "busy" : "",
      ].join("\n");
      const piece: AzureMetricPiece<T> = next.get(key) || {
        index: again.piece.index,
        group: { ...again.piece.group, metrics: [] },
        ownAggregationOnly: new Set<string>(again.piece.ownAggregationOnly),
        isSingle: again.piece.isSingle,
        isBusy: false,
        lastFailure: new Map(again.piece.lastFailure),
      };
      const name: string = again.metric.name.toLowerCase();

      if (
        !piece.group.metrics.some((metric: T): boolean => {
          return metric.name.toLowerCase() === name;
        })
      ) {
        piece.group.metrics.push(again.metric);
      }

      piece.isSingle = piece.isSingle || Boolean(again.isSingle);
      piece.isBusy = piece.isBusy || Boolean(again.isBusy);

      if (again.isOwnAggregationOnly) {
        piece.ownAggregationOnly.add(name);
      }

      if (again.failure) {
        piece.lastFailure.set(name, again.failure);
      }

      next.set(key, piece);
    };

    data.calls.forEach((call: AzureMetricCall<T>, callIndex: number) => {
      const settled: Settled<AzureMetricCallOutcome> =
        data.outcomes[callIndex]!;
      const outcome: AzureMetricCallOutcome = settled.ok
        ? settled.value
        : { kind: "failed", error: settled.error, isThrottle: false };

      if (outcome.kind === "cut-short") {
        for (const index of call.indexes) {
          data.result.reads[index]!.isCutShort = true;
        }

        return;
      }

      if (outcome.kind === "failed") {
        if (call.isBatch && !outcome.isThrottle) {
          // Refused: its resources are asked one at a time, now.
          data.result.batchRefusals.push({
            place: data.requests[call.indexes[0]!]!.place,
            error: outcome.error,
          });

          for (const piece of call.pieces) {
            for (const metric of call.metrics) {
              askAgain({
                piece,
                metric,
                isSingle: true,
                failure: {
                  metricName: metric.name,
                  code:
                    outcome.error instanceof LlmProviderError &&
                    outcome.error.statusCode
                      ? String(outcome.error.statusCode)
                      : "",
                  message:
                    outcome.error instanceof Error
                      ? outcome.error.message
                      : String(outcome.error),
                },
              });
            }
          }

          return;
        }

        for (const index of call.indexes) {
          const read: AzureMetricResourceRead<T> = data.result.reads[index]!;

          if (
            !call.isBatch &&
            isAzureUnsupportedMetricsRefusal(outcome.error)
          ) {
            read.refusal = read.refusal || outcome.error;
            continue;
          }

          if (
            !call.isBatch &&
            outcome.error instanceof LlmProviderError &&
            outcome.error.kind === CloudConnectionFailureKind.Authentication
          ) {
            authenticationFailure = authenticationFailure || outcome.error;
          }

          read.failure = read.failure || outcome.error;

          for (const metric of call.metrics) {
            read.notRead.push({
              metric,
              kind: outcome.isThrottle
                ? CloudMetricNotReadKind.Throttled
                : CloudMetricNotReadKind.Failed,
              code:
                outcome.error instanceof LlmProviderError &&
                outcome.error.statusCode
                  ? String(outcome.error.statusCode)
                  : "",
              message:
                outcome.error instanceof Error
                  ? outcome.error.message
                  : String(outcome.error),
            });
          }
        }

        return;
      }

      data.result.groupsRead.add(call.group.groupKey);

      const aggregations: number = getCallAggregations(call.metrics).length;

      call.pieces.forEach((piece: AzureMetricPiece<T>) => {
        const read: AzureMetricResourceRead<T> =
          data.result.reads[piece.index]!;
        const answer: AzureMetricsAnswer | undefined = outcome.answers.get(
          read.place.armId.toLowerCase(),
        );

        if (!answer) {
          // A batch's answer that left it out: asked on its own, now.
          for (const metric of call.metrics) {
            askAgain({
              piece,
              metric,
              isSingle: true,
              failure: {
                metricName: metric.name,
                code: "",
                message: "Azure Monitor's batch answer left the resource out.",
              },
            });
          }

          return;
        }

        read.answeredCalls++;

        for (const series of answer.series) {
          read.series.push({ ...series, grain: call.group.grain });
        }

        if (call.group.reportsCapped) {
          read.capped.push(...answer.capped);
        }

        const failures: Map<string, AzureMetricFailure> = new Map();

        for (const failure of answer.failures) {
          failures.set(failure.metricName.toLowerCase(), failure);
        }

        for (const metric of call.metrics) {
          const failure: AzureMetricFailure | undefined = failures.get(
            metric.name.toLowerCase(),
          );

          if (!failure) {
            read.read.push(metric);
            continue;
          }

          const kind: CloudMetricNotReadKind =
            classifyAzureMetricFailure(failure);

          if (!data.isLastRound && isRetryableMetricFailure(failure)) {
            askAgain({ piece, metric, isBusy: true, failure });
            continue;
          }

          if (
            !data.isLastRound &&
            kind === CloudMetricNotReadKind.Unsupported &&
            aggregations > 1
          ) {
            askAgain({ piece, metric, isOwnAggregationOnly: true, failure });
            continue;
          }

          read.notRead.push({
            metric,
            kind,
            code: failure.code,
            message: failure.message,
          });
        }
      });
    });

    if (authenticationFailure) {
      throw authenticationFailure;
    }

    return Array.from(next.values());
  }

  /*
   * What the read cannot ask again - it has no time left to wait for Azure
   * to be less busy, or no round left - is not read, with the failure that
   * last said why.
   */
  private giveUp<T extends AzureMetricToRead>(
    result: AzureMetricReadResult<T>,
    pieces: Array<AzureMetricPiece<T>>,
  ): void {
    for (const piece of pieces) {
      const read: AzureMetricResourceRead<T> = result.reads[piece.index]!;

      for (const metric of piece.group.metrics) {
        const failure: AzureMetricFailure | undefined = piece.lastFailure.get(
          metric.name.toLowerCase(),
        );

        /*
         * Busy, as its last answer said; or a refused batch's, which says
         * nothing of whether the metric is served.
         */
        read.notRead.push({
          metric,
          kind: !piece.isBusy
            ? CloudMetricNotReadKind.Failed
            : failure
              ? classifyAzureMetricFailure(failure)
              : CloudMetricNotReadKind.Throttled,
          code: failure?.code || "",
          message: failure?.message || "Azure Monitor was busy.",
        });
      }
    }
  }
}
