import { createHash } from "crypto";
import { KubernetesCostAllocationIngestRow } from "./Types";

/*
 * BRINGING IN WHAT A KUBECOST RECONCILES WITH THE CLOUD BILL (#9969).
 *
 * A Kubecost that reads the cloud's bill (a cloud integration: EnginePricing
 * says billing-integration) reconciles its prices with what was paid:
 * savings plans, reserved instances, committed use, negotiated discounts.
 * Its docs say the same of Kubecost 2 and 3 ("Cloud Billing Integrations"):
 *
 *   - The clouds release billing data 6 to 24 hours late, and reconciliation
 *     needs a whole day of it, so it comes about 48 hours after the usage.
 *     Kubecost's UI marks the most recent 36 hours as not reconciled yet.
 *   - It runs every 6 hours (refreshRateHours), each run going 3 days back
 *     (runWindowDays), so an hour can change until about 3 days on.
 *   - The Allocation API reconciles by default (reconcile=true) and puts the
 *     change in each cost's *CostAdjustment field, which AllocationMapper
 *     adds to the cost. There is no flag that says an hour is reconciled.
 *   - Kubecost keeps hourly figures for 49 hours by default (Kubecost 2's
 *     kubecostAggregator.etlHourlyStoreDurationHours, Kubecost 3's
 *     aggregator.retention1h) and daily ones for 91 days. An hour asked for
 *     after that has nothing to give.
 *
 * The agent ships each hour once it is collected, at the prices of the
 * moment: list prices. So it reads each hour a Kubecost with a billing
 * integration priced again, at three ages (CORRECTION_READ_AGES_MS):
 *
 *   - 36 hours after it closed, where Kubecost's UI starts calling it
 *     reconciled;
 *   - 47 hours after, the last hour Kubecost holds it hourly by default,
 *     past the 48 hours its docs give reconciliation from the usage;
 *   - 4 days after, past the 3 days reconciliation goes back: only a
 *     Kubecost that keeps hourly figures that long answers, and an answer
 *     with nothing in it changes nothing.
 *
 * A reading that differs from the last one shipped goes out as a correction
 * (Shipper, correction: true). The server writes the difference from what
 * it holds as rows of their own, so a reading shipped twice changes nothing
 * the second time; one that matches what was shipped is not sent. A reading
 * the engine cannot give whole leaves the hour as it is (CostEngineResolver
 * .rereadAllocations).
 *
 * Only window starts and a fingerprint each are kept, not rows: at most the
 * hundred or so hours of the last 4 days. A restart forgets them, so the
 * poller hands the schedule the hours a previous process may have shipped
 * (seed): each is read once more at the age it last passed, in case that
 * reading was missed, and then at the ages after. Without its fingerprint,
 * every such reading is sent, and the server leaves what has not changed.
 */

const HOUR_MS: number = 60 * 60 * 1000;

// How long after a window closed it is read again, in order.
export const CORRECTION_READ_AGES_MS: ReadonlyArray<number> = [
  36 * HOUR_MS,
  47 * HOUR_MS,
  96 * HOUR_MS,
];

/*
 * How long Kubecost keeps hourly figures by default: the windows read before
 * this age goes by are read first.
 */
export const KUBECOST_HOURLY_RETENTION_MS: number = 49 * HOUR_MS;

/*
 * How long past its last age a window whose engine could not be read is
 * still tried: a Kubecost that is down for a while is read once it is back.
 */
export const CORRECTION_GRACE_MS: number = 6 * HOUR_MS;

/*
 * Readings a tick makes at most. One window reaches an age each hour, so
 * this matters only after a restart, when the hours of the last 4 days are
 * all owed a reading.
 */
export const CORRECTION_READS_PER_TICK: number = 12;

// A window waiting to be read again.
export interface CorrectionWindow {
  windowStartMs: number;
  windowEndMs: number;
  // The engine that priced it, by its address: only that one is asked again.
  engineUrl: string;
  /*
   * The costs last shipped for it (correctionFingerprint), or null when this
   * process never shipped it: then every reading is sent.
   */
  fingerprint: string | null;
  // Which of the read ages it waits for.
  nextAge: number;
}

/*
 * The parts of a row that make it one workload's, pod's and container's in
 * one window, as the server tells rows apart (Shipment.ts's rowIdentity).
 */
const identityOf: (row: KubernetesCostAllocationIngestRow) => string = (
  row: KubernetesCostAllocationIngestRow,
): string => {
  return [
    row.windowStart,
    row.windowEnd,
    row.namespace || "",
    row.controllerKind || "",
    row.controllerName || "",
    row.podName || "",
    row.containerName || "",
  ].join("\u0000");
};

// The costs a correction carries: what reconciliation changes.
export const CORRECTION_COST_FIELDS: ReadonlyArray<
  keyof KubernetesCostAllocationIngestRow
> = [
  "cpuCost",
  "gpuCost",
  "ramCost",
  "pvCost",
  "networkCost",
  "loadBalancerCost",
  "sharedCost",
  "externalCost",
  "totalCost",
];

// What adds up across two rows of one container: its costs and its hours.
const ADDITIVE_FIELDS: ReadonlyArray<keyof KubernetesCostAllocationIngestRow> =
  [
    ...CORRECTION_COST_FIELDS,
    "cpuCoreHours",
    "gpuHours",
    "ramByteHours",
    "pvByteHours",
  ];

const numberOf: (value: unknown) => number = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

/*
 * One row per workload, pod and container: a correction says what each one
 * costs now, and the server corrects each by what it holds for it, chunk by
 * chunk, so no container may straddle two chunks. An engine gives one row
 * each; should it give two, their costs and hours are added up.
 */
export const collapseByIdentity: (
  rows: Array<KubernetesCostAllocationIngestRow>,
) => Array<KubernetesCostAllocationIngestRow> = (
  rows: Array<KubernetesCostAllocationIngestRow>,
): Array<KubernetesCostAllocationIngestRow> => {
  const byIdentity: Map<string, KubernetesCostAllocationIngestRow> = new Map<
    string,
    KubernetesCostAllocationIngestRow
  >();

  for (const row of rows) {
    const key: string = identityOf(row);
    const existing: KubernetesCostAllocationIngestRow | undefined =
      byIdentity.get(key);

    if (!existing) {
      byIdentity.set(key, { ...row });
      continue;
    }

    const merged: Record<string, unknown> = existing as unknown as Record<
      string,
      unknown
    >;

    for (const field of ADDITIVE_FIELDS) {
      merged[field] = numberOf(existing[field]) + numberOf(row[field]);
    }
  }

  return Array.from(byIdentity.values());
};

/*
 * A cost as the fingerprint writes it: to a billionth, so the same figure
 * read twice writes the same, whatever float noise an engine adds.
 */
const writeCost: (value: unknown) => string = (value: unknown): string => {
  return String(Math.round(numberOf(value) * 1e9) / 1e9);
};

/*
 * What a window's rows cost, per workload, pod and container, as one hash:
 * equal for two readings that would correct nothing. Independent of the
 * rows' order.
 */
export const correctionFingerprint: (
  rows: Array<KubernetesCostAllocationIngestRow>,
) => string = (rows: Array<KubernetesCostAllocationIngestRow>): string => {
  const entries: Array<string> = collapseByIdentity(rows).map(
    (row: KubernetesCostAllocationIngestRow): string => {
      return [
        identityOf(row),
        ...CORRECTION_COST_FIELDS.map(
          (field: keyof KubernetesCostAllocationIngestRow): string => {
            return writeCost(row[field]);
          },
        ),
      ].join("\u0000");
    },
  );

  // Plain codepoint order, as Shipment.ts sorts: the same on every machine.
  entries.sort((a: string, b: string): number => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });

  const hash: ReturnType<typeof createHash> = createHash("sha256");

  for (const entry of entries) {
    hash.update(entry);
    hash.update("\n");
  }

  return hash.digest("hex").slice(0, 32);
};

export interface CorrectionScheduleOptions {
  readAgesMs?: ReadonlyArray<number> | undefined;
  hourlyRetentionMs?: number | undefined;
  graceMs?: number | undefined;
  readsPerTick?: number | undefined;
  now?: (() => number) | undefined;
}

/*
 * Which windows are read again, and when. Pure but for the clock it is
 * given, so every case is tested without an engine.
 */
export class CorrectionSchedule {
  private readonly windows: Map<number, CorrectionWindow> = new Map<
    number,
    CorrectionWindow
  >();
  private readonly ages: ReadonlyArray<number>;
  private readonly hourlyRetentionMs: number;
  private readonly graceMs: number;
  private readonly readsPerTick: number;
  private readonly now: () => number;

  public constructor(options?: CorrectionScheduleOptions) {
    this.ages = options?.readAgesMs || CORRECTION_READ_AGES_MS;
    this.hourlyRetentionMs =
      options?.hourlyRetentionMs ?? KUBECOST_HOURLY_RETENTION_MS;
    this.graceMs = options?.graceMs ?? CORRECTION_GRACE_MS;
    this.readsPerTick = options?.readsPerTick ?? CORRECTION_READS_PER_TICK;
    this.now =
      options?.now ||
      ((): number => {
        return Date.now();
      });
  }

  // How long after it closed a window is read for the last time.
  public lastAgeMs(): number {
    return this.ages[this.ages.length - 1] || 0;
  }

  // The first age at or after `ageMs`, as an index; past the last, none.
  private ageIndexFrom(ageMs: number): number {
    let index: number = 0;

    while (index < this.ages.length && this.ages[index]! < ageMs) {
      index++;
    }

    return index;
  }

  /*
   * A window this process shipped from an engine that reconciles: it is
   * read again at each age still ahead of it.
   */
  public track(data: {
    windowStartMs: number;
    windowEndMs: number;
    engineUrl: string;
    fingerprint: string;
  }): void {
    const nextAge: number = this.ageIndexFrom(this.now() - data.windowEndMs);

    if (nextAge >= this.ages.length) {
      return;
    }

    this.windows.set(data.windowStartMs, {
      windowStartMs: data.windowStartMs,
      windowEndMs: data.windowEndMs,
      engineUrl: data.engineUrl,
      fingerprint: data.fingerprint,
      nextAge,
    });
  }

  /*
   * The windows a process before this one may have shipped, which this one
   * never saw: those of the window grid ending at `throughMs` and before,
   * back to the last age. Each is read once more at the age it last passed,
   * since that reading may have been missed (a reading is owed now), then
   * at the ages after; one younger than the first age waits for it. A
   * window already known is left as it is.
   */
  public seed(data: {
    throughMs: number;
    windowMs: number;
    engineUrl: string;
  }): void {
    if (data.windowMs <= 0) {
      return;
    }

    const now: number = this.now();
    const oldestEndMs: number = now - this.lastAgeMs();

    for (
      let windowEndMs: number = data.throughMs;
      windowEndMs >= oldestEndMs;
      windowEndMs -= data.windowMs
    ) {
      const windowStartMs: number = windowEndMs - data.windowMs;

      if (this.windows.has(windowStartMs)) {
        continue;
      }

      const ageMs: number = now - windowEndMs;
      let nextAge: number = this.ageIndexFrom(ageMs);

      // An age it has passed: read it now, as that age's reading.
      if (nextAge >= this.ages.length || this.ages[nextAge]! > ageMs) {
        nextAge = Math.max(0, nextAge - 1);
      }

      this.windows.set(windowStartMs, {
        windowStartMs,
        windowEndMs,
        engineUrl: data.engineUrl,
        fingerprint: null,
        nextAge,
      });
    }
  }

  /*
   * The windows owed a reading now. First those Kubecost still holds
   * hourly by default, the nearest to dropping out first, then the older
   * ones; at most a tick's worth. A window whose engine could not be read
   * past its last age and the grace is forgotten.
   */
  public due(): Array<CorrectionWindow> {
    const now: number = this.now();
    const due: Array<CorrectionWindow> = [];

    for (const window of Array.from(this.windows.values())) {
      const ageMs: number = now - window.windowEndMs;

      if (ageMs > this.lastAgeMs() + this.graceMs) {
        this.windows.delete(window.windowStartMs);
        continue;
      }

      if (ageMs >= this.ages[window.nextAge]!) {
        due.push({ ...window });
      }
    }

    const urgency: (window: CorrectionWindow) => [number, number] = (
      window: CorrectionWindow,
    ): [number, number] => {
      const ageMs: number = now - window.windowEndMs;
      const left: number = this.hourlyRetentionMs - ageMs;

      return left > 0 ? [0, left] : [1, ageMs];
    };

    due.sort((a: CorrectionWindow, b: CorrectionWindow): number => {
      const [aGroup, aRank] = urgency(a);
      const [bGroup, bRank] = urgency(b);

      return aGroup !== bGroup ? aGroup - bGroup : aRank - bRank;
    });

    return due.slice(0, this.readsPerTick);
  }

  /*
   * A window read at its age: shipped, unchanged, or nothing the engine
   * could give whole. It waits for its next age still ahead, keeping the
   * fingerprint of what was last shipped, or is forgotten after its last.
   */
  public read(window: CorrectionWindow, fingerprint: string | null): void {
    const known: CorrectionWindow | undefined = this.windows.get(
      window.windowStartMs,
    );

    if (!known) {
      return;
    }

    const ageMs: number = this.now() - window.windowEndMs;
    let nextAge: number = known.nextAge + 1;

    // Ages that went by while it waited are covered by this reading.
    while (nextAge < this.ages.length && this.ages[nextAge]! <= ageMs) {
      nextAge++;
    }

    if (nextAge >= this.ages.length) {
      this.windows.delete(window.windowStartMs);
      return;
    }

    this.windows.set(window.windowStartMs, {
      ...known,
      fingerprint: fingerprint ?? known.fingerprint,
      nextAge,
    });
  }

  // The windows waiting to be read again.
  public size(): number {
    return this.windows.size;
  }

  // One window, as the schedule holds it: for tests and /healthz.
  public get(windowStartMs: number): CorrectionWindow | undefined {
    const window: CorrectionWindow | undefined =
      this.windows.get(windowStartMs);

    return window ? { ...window } : undefined;
  }
}
