import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import logger from "../Logger";
import TelemetryIngestAttributionCounter, {
  TelemetryIngestAttributionScopeCharge,
  TelemetryIngestAttributionUsage,
} from "./TelemetryIngestAttributionCounter";
import TelemetryIngestAttributionSettings, {
  getTelemetryIngestResourceKey,
  TelemetryIngestAttributionConfig,
  TelemetryIngestTeamLabelBudget,
} from "./TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetDayCounters,
} from "./TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "./TelemetryIngestionBudgetSettings";
import type { TelemetryIngestionBudgetJobCharge } from "./TelemetryIngestionBudget";
import ObjectID from "../../../Types/ObjectID";
import {
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetSignalSlug,
  getTelemetryIngestionBudgetSignalWords,
  getTelemetryIngestionBudgetWarningBytes,
  isTelemetryIngestionTeamLabelBudgetSignal,
  resolveTelemetryIngestionBudget,
  resolveTelemetryIngestionTeamLabelBudget,
  TelemetryIngestionBudgetDay,
  TelemetryIngestionBudgetLimit,
  TelemetryIngestionBudgetResolved,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * WHOSE A BATCH OF TELEMETRY WAS, once the telemetry worker has decoded it
 * and filed each of its resources under a service, a host, a cluster or
 * another resource (issues #6355, #6386, #10101).
 *
 * The request path counts a batch against its project's and its ingestion
 * key's budgets without decoding it (TelemetryIngestionBudget), so it
 * cannot tell whose telemetry the batch carries. This splits that same
 * count across the batch's resources, and with it:
 *
 *   - checks and charges the budgets of the teams that own those resources,
 *     and of the labels on them (#6386, #10101). A resource whose team's or
 *     label's budget is used up is dropped (admitResource answers false,
 *     and the ingest service skips its records), and what it would have
 *     counted is taken back off the project's and the key's day, so one
 *     team's runaway service or host cannot use up the budget of every
 *     other team;
 *   - adds each resource's share to the five-minute counters behind the
 *     oneuptime.telemetry.usage.bytes metrics (#6355), when the project
 *     publishes them.
 *
 * Every ingest path that files telemetry under resources is attributed: the
 * OTLP logs, traces, metrics and profiles (and the compatible endpoints,
 * queued as OTLP), and the logs of Fluent Bit, Fluentd and syslog (#10102),
 * whose batches the request path reshapes before queueing them, and so
 * carry their counted size (getRequestBytesToShare).
 *
 * ONE COUNT. A batch's bytes are the size the request path counts it at -
 * its body decompressed, or an OTLP/gRPC export's protobuf size - and they
 * are shared out over its resources by how many records (log records,
 * spans, metric points, profiles, syslog lines) each sent. The shares add
 * up to the batch exactly, so a team's, a label's and the project's budgets
 * count the same bytes, and the usage metrics add up to what the project's
 * budget counted.
 *
 * WHAT IT COSTS. A project with no team or label budget and no usage
 * metrics: two in-process set lookups per batch, then nothing
 * (forBatch answers null). Otherwise, per batch: a map lookup and an array
 * push per resource - independent of how many resources the project's
 * budgets count - and ONE Valkey round trip when the batch is done
 * (settle) - plus one read of the project's budgets' day counters when this
 * server has not read them in the last few seconds (the budgets' state is
 * cached per project, signal and budget day, and every settle refreshes
 * it). Never a database round trip per record or per resource: the
 * resources each budget counts are cached per project
 * (TelemetryIngestAttributionSettings). Memory: one small entry per
 * resource of the batch, released with it.
 *
 * A budget is checked against the counts this server last read, so
 * batches in flight on several servers at the moment a budget is used up
 * can take it a little past its line, as the last request the request path
 * admits is stored whole. Never throws: a failure is logged and the batch
 * is stored, uncounted.
 */

// How long this server trusts the budgets' counts it last read.
export const TELEMETRY_INGEST_ATTRIBUTION_STATE_TTL_MS: number = 5 * 1000;
const STATE_CACHE_MAX_ENTRIES: number = 10_000;

// A day's counters outlive the day by this long, as the request path keeps them.
const DAY_COUNTERS_KEPT_AFTER_RESET_SECONDS: number = 24 * 60 * 60;

// A resource of the batch, as an ingest service filed it.
export interface TelemetryIngestAttributionResource {
  primaryEntityId: ObjectID | string;
  primaryEntityType: string;
  // What it is called: a service's name, or "host/<name>" and the like.
  name: string;
  // How many records it sent in the batch: what its share is by.
  records: number;
}

// A team's or a label's budget of this batch's signal, resolved.
interface BatchBudget {
  budget: TelemetryIngestTeamLabelBudget;
  dailyBudgetBytes: number;
  warningBytes: number;
}

interface AttributedResource {
  // The resource, with every record the batch offered it with.
  resource: TelemetryIngestAttributionResource;
  // The batch's budgets it counts in, as indexes into `budgets`.
  budgets: Array<number>;
  isAdmitted: boolean;
}

// A record count as a share is weighed by: a whole number, never below 0.
const toRecords: (records: number) => number = (records: number): number => {
  return Number.isFinite(records) && records > 0 ? Math.floor(records) : 0;
};

// Shares of a whole that add up to it exactly (largest remainder first).
export const shareTelemetryIngestBytes: (
  totalBytes: number,
  weights: Array<number>,
) => Array<number> = (
  totalBytes: number,
  weights: Array<number>,
): Array<number> => {
  const total: number = Math.max(0, Math.floor(totalBytes));
  const cleanWeights: Array<number> = weights.map((weight: number): number => {
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });
  const weightSum: number = cleanWeights.reduce(
    (sum: number, weight: number): number => {
      return sum + weight;
    },
    0,
  );

  if (total === 0 || weightSum === 0) {
    return cleanWeights.map((): number => {
      return 0;
    });
  }

  const exact: Array<number> = cleanWeights.map((weight: number): number => {
    return (total * weight) / weightSum;
  });
  const shares: Array<number> = exact.map((value: number): number => {
    return Math.floor(value);
  });
  let left: number =
    total -
    shares.reduce((sum: number, share: number): number => {
      return sum + share;
    }, 0);

  const order: Array<number> = exact
    .map((_value: number, index: number): number => {
      return index;
    })
    .sort((a: number, b: number): number => {
      return exact[b]! - shares[b]! - (exact[a]! - shares[a]!) || a - b;
    });

  for (const index of order) {
    if (left <= 0) {
      break;
    }

    if (cleanWeights[index]! > 0) {
      shares[index]!++;
      left--;
    }
  }

  return shares;
};

export default class TelemetryIngestAttribution {
  /*
   * Each project's budgets' used bytes on a day, as this server last read
   * or charged them: `${projectId}|${dayId}|${signal}` -> scope key -> bytes.
   */
  private static state: InMemoryTTLCache<Map<string, number>> =
    new InMemoryTTLCache(STATE_CACHE_MAX_ENTRIES);

  /*
   * The batch's resources, in the order they were first offered, each once:
   * a resource offered again (the next syslog line of a service already
   * seen) adds its records to the first offer.
   */
  private entries: Map<string, AttributedResource> = new Map();
  private used: Map<string, number> | null = null;
  private isSettled: boolean = false;

  private constructor(
    private readonly data: {
      projectId: string;
      signal: TelemetryIngestionBudgetSignal;
      bytes: number;
      day: TelemetryIngestionBudgetDay;
      dayId: string;
      nowMs: number;
      // A job's retry: its first attempt counted the batch.
      isRetry: boolean;
      publishesUsageMetrics: boolean;
      budgets: Array<BatchBudget>;
      /*
       * The project's resources and the budgets each counts in, as indexes
       * into the project's budgets - shared with the settings, never copied
       * per batch - and those indexes as the batch's own (`budgets`): only
       * the budgets of the batch's signal.
       */
      budgetsByResourceId: Map<string, Array<number>>;
      batchIndexOf: Map<number, number>;
      refundScopes: Array<{
        scope: TelemetryIngestionBudgetScope;
        scopeId: string;
      }>;
    },
  ) {}

  /*
   * Whether a project's batches are attributed at all: it publishes its
   * usage as metrics, or has a team or label budget. Two lookups in
   * in-process sets; false when they cannot be read.
   */
  public static async isNeededFor(projectId: string): Promise<boolean> {
    try {
      return (
        (await TelemetryIngestAttributionSettings.getProjectConfig(
          projectId,
        )) !== null
      );
    } catch {
      return false;
    }
  }

  /*
   * The size the worker is to share a batch out at, for an ingest path that
   * reshapes the body before it is queued - Fluent Bit's and Fluentd's
   * entries, syslog's lines (#10102) - so the worker cannot measure what the
   * request path counted: the size the request path counted it at, or, when
   * no budget was in force and nothing was counted, the same measure of the
   * body as it arrived. Asked before the body is reshaped, and only answered
   * for a project whose batches are attributed: every other project costs
   * two lookups in in-process sets, and nothing is measured. Never throws.
   */
  public static async getRequestBytesToShare(data: {
    projectId: ObjectID | string | null | undefined;
    // What the request path counted, when it counted anything.
    charge: { countedBytes: number; isPending: boolean } | null | undefined;
    // The body's size, as the request path measures one.
    measure: () => { bytes: number };
  }): Promise<number | undefined> {
    try {
      if (
        !data.projectId ||
        !(await TelemetryIngestAttributionSettings.isAttributedProject(
          data.projectId,
        ))
      ) {
        return undefined;
      }

      const counted: number | null =
        data.charge && !data.charge.isPending ? data.charge.countedBytes : null;
      const bytes: number =
        counted !== null && Number.isFinite(counted) && counted >= 0
          ? counted
          : data.measure().bytes;

      return Number.isFinite(bytes) && bytes >= 0
        ? Math.floor(bytes)
        : undefined;
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttribution: could not size a batch of project ${String(data.projectId)} for its team and label budgets and usage; it is attributed at its stored size`,
      );
      logger.warn(err);
      return undefined;
    }
  }

  /*
   * A batch's attribution, or null when its project needs none: no team or
   * label budget of its signal and no usage metrics. Never throws.
   */
  public static async forBatch(data: {
    projectId: ObjectID | string;
    signal: TelemetryIngestionBudgetSignal;
    // What the batch is counted at (see the top of the file).
    bytes: number | null;
    // When it arrived: the budget day it counts in.
    receivedAt?: Date | undefined;
    // What the request path counted it as, if anything.
    gateCharge?: TelemetryIngestionBudgetJobCharge | null | undefined;
    /*
     * A job's retry: what a used-up budget drops is dropped again, but
     * nothing is counted - its first attempt counted the batch.
     */
    isRetry?: boolean | undefined;
    now?: Date | undefined;
  }): Promise<TelemetryIngestAttribution | null> {
    try {
      if (
        !isTelemetryIngestionTeamLabelBudgetSignal(data.signal) ||
        data.bytes === null ||
        !Number.isFinite(data.bytes) ||
        data.bytes <= 0
      ) {
        return null;
      }

      const projectId: string = data.projectId.toString();
      const config: TelemetryIngestAttributionConfig | null =
        await TelemetryIngestAttributionSettings.getProjectConfig(projectId);

      if (!config) {
        return null;
      }

      const instance: TelemetryIngestionBudgetInstanceSettings =
        await TelemetryIngestionBudgetSettings.getInstanceSettings();

      const budgets: Array<BatchBudget> = await this.resolveBudgets({
        projectId: projectId,
        signal: data.signal,
        budgets: config.budgets,
        instance: instance,
      });

      if (budgets.length === 0 && !config.publishesUsageMetrics) {
        return null;
      }

      const now: Date = data.now || new Date();
      const day: TelemetryIngestionBudgetDay = getTelemetryIngestionBudgetDay({
        now: data.receivedAt || now,
        resetTime: instance.resetTime,
        timezone: instance.timezone,
      });

      /*
       * The budget indexes of `config.budgets` -> of `budgets`: one entry a
       * budget of the signal. A resource's own are translated when it is
       * offered, so a batch costs the same however many resources the
       * project's budgets count.
       */
      const batchIndexOf: Map<number, number> = new Map();

      budgets.forEach((budget: BatchBudget, index: number): void => {
        batchIndexOf.set(config.budgets.indexOf(budget.budget), index);
      });

      return new TelemetryIngestAttribution({
        projectId: projectId,
        signal: data.signal,
        bytes: Math.floor(data.bytes),
        day: day,
        dayId: data.gateCharge?.dayId || day.id,
        nowMs: now.getTime(),
        isRetry: data.isRetry === true,
        publishesUsageMetrics: config.publishesUsageMetrics,
        budgets: budgets,
        budgetsByResourceId: config.budgetsByResourceId,
        batchIndexOf: batchIndexOf,
        refundScopes: (data.gateCharge?.scopes || []).map(
          (scope: {
            scope: TelemetryIngestionBudgetScope;
            scopeId: string;
          }): { scope: TelemetryIngestionBudgetScope; scopeId: string } => {
            return { scope: scope.scope, scopeId: scope.scopeId };
          },
        ),
      });
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttribution: could not attribute a ${getTelemetryIngestionBudgetSignalWords(
          data.signal,
        )} batch of project ${data.projectId.toString()}; storing it unattributed`,
      );
      logger.warn(err);
      return null;
    }
  }

  // Forget what this server last read of the budgets: for tests.
  public static clearState(): void {
    this.state.clear();
  }

  /*
   * One resource of the batch, once filed under its service, host, cluster
   * or other resource: whether its records may be stored. false when a
   * budget of its team or label is used up - its records are dropped, and
   * counted as dropped. A resource offered again in the same batch adds its
   * records to its first offer and is answered the same: an ingest path
   * that files its records one by one (syslog) offers each. Never throws: a
   * failure admits the resource.
   */
  public async admitResource(
    resource: TelemetryIngestAttributionResource,
  ): Promise<boolean> {
    const key: string = this.entryKey(resource);
    const known: AttributedResource | undefined = this.entries.get(key);

    if (known) {
      known.resource.records += toRecords(resource.records);
      return known.isAdmitted;
    }

    let budgets: Array<number> = [];
    let isAdmitted: boolean = true;

    try {
      budgets = this.getBudgetsOf(resource);

      if (budgets.length > 0) {
        const used: Map<string, number> = await this.readUsed();

        isAdmitted = !budgets.some((index: number): boolean => {
          const budget: BatchBudget = this.data.budgets[index]!;

          return (
            (used.get(this.scopeKey(budget.budget)) || 0) >=
            budget.dailyBudgetBytes
          );
        });
      }
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttribution: could not check a resource of project ${this.data.projectId} against its team and label budgets; storing it`,
      );
      logger.warn(err);
      budgets = [];
      isAdmitted = true;
    }

    // Offered again while its budgets were read: one entry, one answer.
    const offeredMeanwhile: AttributedResource | undefined =
      this.entries.get(key);

    if (offeredMeanwhile) {
      offeredMeanwhile.resource.records += toRecords(resource.records);
      return offeredMeanwhile.isAdmitted;
    }

    this.entries.set(key, {
      resource: { ...resource, records: toRecords(resource.records) },
      budgets: budgets,
      isAdmitted: isAdmitted,
    });

    return isAdmitted;
  }

  // How many resources were dropped: for the ingest service's log line.
  public getDroppedResourceCount(): number {
    let dropped: number = 0;

    for (const entry of this.entries.values()) {
      if (!entry.isAdmitted) {
        dropped++;
      }
    }

    return dropped;
  }

  /*
   * Count the batch, once its records are processed: in one round trip.
   * Once only; never throws.
   */
  public async settle(): Promise<void> {
    if (this.isSettled) {
      return;
    }

    this.isSettled = true;

    // Its first attempt counted the batch: a retry counts nothing again.
    if (this.data.isRetry) {
      return;
    }

    try {
      // What was stored, then what was dropped, each in the order offered.
      const admitted: Array<AttributedResource> = [];
      const dropped: Array<AttributedResource> = [];

      for (const entry of this.entries.values()) {
        (entry.isAdmitted ? admitted : dropped).push(entry);
      }

      const entries: Array<AttributedResource> = [...admitted, ...dropped];

      if (entries.length === 0) {
        return;
      }

      const shares: Array<number> = shareTelemetryIngestBytes(
        this.data.bytes,
        entries.map((entry: AttributedResource): number => {
          return entry.resource.records;
        }),
      );
      const admittedCount: number = admitted.length;

      const scopes: Array<TelemetryIngestAttributionScopeCharge> = [];

      this.data.budgets.forEach((budget: BatchBudget, index: number): void => {
        let admittedBytes: number = 0;
        let droppedBytes: number = 0;
        let droppedAny: boolean = false;

        entries.forEach((entry: AttributedResource, at: number): void => {
          if (!entry.budgets.includes(index)) {
            return;
          }

          if (at < admittedCount) {
            admittedBytes += shares[at]!;
          } else {
            droppedBytes += shares[at]!;
            droppedAny = true;
          }
        });

        if (admittedBytes > 0 || droppedAny) {
          scopes.push({
            scope: budget.budget.scope,
            scopeId: budget.budget.scopeId,
            admittedBytes: admittedBytes,
            droppedBytes: droppedBytes,
            droppedRequests: droppedAny ? 1 : 0,
            dailyBudgetBytes: budget.dailyBudgetBytes,
            warningBytes: budget.warningBytes,
          });
        }
      });

      const refundBytes: number = shares
        .slice(admittedCount)
        .reduce((sum: number, share: number): number => {
          return sum + share;
        }, 0);

      const usage: Array<TelemetryIngestAttributionUsage> = [];

      if (this.data.publishesUsageMetrics) {
        const byField: Map<string, number> = new Map();
        const signalSlug: string = getTelemetryIngestionBudgetSignalSlug(
          this.data.signal,
        );

        admitted.forEach((entry: AttributedResource, at: number): void => {
          const field: string = TelemetryIngestAttributionCounter.getUsageField(
            {
              signalSlug: signalSlug,
              resourceType: entry.resource.primaryEntityType,
              resourceId: entry.resource.primaryEntityId.toString(),
              resourceName: entry.resource.name,
            },
          );

          byField.set(field, (byField.get(field) || 0) + shares[at]!);
        });

        for (const [field, bytes] of byField) {
          if (bytes > 0) {
            usage.push({ field: field, bytes: bytes });
          }
        }
      }

      const usedAfter: Array<number> | null =
        await TelemetryIngestAttributionCounter.settle({
          projectId: this.data.projectId,
          signalSlug: getTelemetryIngestionBudgetSignalSlug(this.data.signal),
          dayId: this.data.dayId,
          dayTtlSeconds:
            Math.ceil(
              (this.data.day.resetsAt.getTime() - this.data.nowMs) / 1000,
            ) + DAY_COUNTERS_KEPT_AFTER_RESET_SECONDS,
          nowMs: this.data.nowMs,
          scopes: scopes,
          refund:
            refundBytes > 0 && this.data.refundScopes.length > 0
              ? { bytes: refundBytes, scopes: this.data.refundScopes }
              : null,
          usage: usage,
        });

      // What was charged is what this server knows of the budgets now.
      if (usedAfter && scopes.length > 0) {
        const used: Map<string, number> = new Map(
          TelemetryIngestAttribution.state.get(this.stateKey()) || [],
        );

        scopes.forEach(
          (scope: TelemetryIngestAttributionScopeCharge, index: number) => {
            used.set(`${scope.scope}:${scope.scopeId}`, usedAfter[index] || 0);
          },
        );

        TelemetryIngestAttribution.state.set(
          this.stateKey(),
          used,
          TELEMETRY_INGEST_ATTRIBUTION_STATE_TTL_MS,
        );
      }

      if (dropped.length > 0) {
        logger.debug(
          `TelemetryIngestAttribution: dropped ${dropped.length} resource(s) of a ${getTelemetryIngestionBudgetSignalWords(
            this.data.signal,
          )} batch of project ${this.data.projectId}: a team or label budget is used up.`,
        );
      }
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttribution: could not count a batch of project ${this.data.projectId} against its team and label budgets and usage`,
      );
      logger.warn(err);
    }
  }

  /*
   * The budgets of this signal the batch is checked against, each held to
   * the project's own: its daily budget and warning line in bytes.
   */
  private static async resolveBudgets(data: {
    projectId: string;
    signal: TelemetryIngestionBudgetSignal;
    budgets: Array<TelemetryIngestTeamLabelBudget>;
    instance: TelemetryIngestionBudgetInstanceSettings;
  }): Promise<Array<BatchBudget>> {
    const withBudget: Array<TelemetryIngestTeamLabelBudget> =
      data.budgets.filter((budget: TelemetryIngestTeamLabelBudget): boolean => {
        return budget.dailyBudgetsInGB[data.signal].dailyBudgetInGB !== null;
      });

    if (withBudget.length === 0) {
      return [];
    }

    const project: TelemetryIngestionBudgetStoredSettings | null =
      await TelemetryIngestionBudgetSettings.getProjectOverrides(
        new ObjectID(data.projectId),
      );
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: data.signal,
        instance: data.instance.budgets,
        project: project,
        ingestionKey: null,
      });

    const budgets: Array<BatchBudget> = [];

    for (const budget of withBudget) {
      const limit: TelemetryIngestionBudgetLimit =
        resolveTelemetryIngestionTeamLabelBudget({
          scope: budget.scope,
          ownDailyBudgetInGB:
            budget.dailyBudgetsInGB[data.signal].dailyBudgetInGB,
          projectDailyBudget: resolved.project.dailyBudget,
        });

      if (limit.bytes === null) {
        continue;
      }

      budgets.push({
        budget: budget,
        dailyBudgetBytes: limit.bytes,
        warningBytes: getTelemetryIngestionBudgetWarningBytes({
          dailyBudgetBytes: limit.bytes,
          warningPercent: data.instance.warningPercent,
        }),
      });
    }

    return budgets;
  }

  /*
   * The batch's budgets' used bytes: as this server last knew them, or read
   * from Valkey (one round trip) when that is older than a few seconds. A
   * count that cannot be read is 0: the budget is not enforced on it, as
   * the request path does not enforce one it cannot count.
   */
  private async readUsed(): Promise<Map<string, number>> {
    if (this.used) {
      return this.used;
    }

    const cached: Map<string, number> | undefined =
      TelemetryIngestAttribution.state.get(this.stateKey());
    const missing: Array<BatchBudget> = this.data.budgets.filter(
      (budget: BatchBudget): boolean => {
        return !cached || !cached.has(this.scopeKey(budget.budget));
      },
    );

    if (cached && missing.length === 0) {
      this.used = cached;
      return cached;
    }

    const signalSlug: string = getTelemetryIngestionBudgetSignalSlug(
      this.data.signal,
    );
    const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
      await TelemetryIngestionBudgetCounter.readDayCounters(
        this.data.budgets.map((budget: BatchBudget) => {
          return {
            dayId: this.data.dayId,
            scope: budget.budget.scope,
            scopeId: budget.budget.scopeId,
            signalSlug: signalSlug,
          };
        }),
      );

    const used: Map<string, number> = new Map();

    this.data.budgets.forEach((budget: BatchBudget, index: number): void => {
      used.set(
        this.scopeKey(budget.budget),
        counters ? counters[index]!.usedBytes : 0,
      );
    });

    if (counters) {
      TelemetryIngestAttribution.state.set(
        this.stateKey(),
        used,
        TELEMETRY_INGEST_ATTRIBUTION_STATE_TTL_MS,
      );
    }

    this.used = used;
    return used;
  }

  /*
   * The batch's budgets a resource counts in, as indexes into `budgets`: its
   * team's and its labels' of the batch's signal. One map lookup.
   */
  private getBudgetsOf(
    resource: TelemetryIngestAttributionResource,
  ): Array<number> {
    if (this.data.budgets.length === 0) {
      return [];
    }

    const indexes: Array<number> | undefined =
      this.data.budgetsByResourceId.get(
        getTelemetryIngestResourceKey(resource.primaryEntityId),
      );

    if (!indexes) {
      return [];
    }

    const budgets: Array<number> = [];

    for (const index of indexes) {
      const batchIndex: number | undefined = this.data.batchIndexOf.get(index);

      if (batchIndex !== undefined) {
        budgets.push(batchIndex);
      }
    }

    return budgets;
  }

  /*
   * A resource of the batch, as its usage is kept: its kind, id and name. A
   * service renamed within a batch is two names, as its usage fields are.
   */
  private entryKey(resource: TelemetryIngestAttributionResource): string {
    return `${resource.primaryEntityId.toString()}\u0000${resource.primaryEntityType}\u0000${resource.name}`;
  }

  private stateKey(): string {
    return `${this.data.projectId}|${this.data.dayId}|${this.data.signal}`;
  }

  private scopeKey(budget: TelemetryIngestTeamLabelBudget): string {
    return `${budget.scope}:${budget.scopeId}`;
  }
}
