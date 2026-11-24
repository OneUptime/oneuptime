/*
 * HOW MUCH MODEL TIME A SCAN MAY SPEND, AND WHAT IT SAYS WHEN IT RAN OUT.
 *
 * The names-and-addresses model reads free text one batch of word pieces at a
 * time, on one core of the worker or probe that runs the scan. Each batch's
 * time is charged to the scan and to the store it was for, and no batch
 * starts once either has spent its share, as no object is read once a scan
 * has read its bytes. A scan that ran out still finishes, with what the
 * model read; its warnings say how much that was - how many of the free-text
 * values it was to read - never what.
 *
 * The budgets are the server's, not a project's setting: model time is the
 * CPU of OneUptime's workers and of probes, shared by every project they
 * scan for.
 */

// A content scan of one store - a bucket, a database, a dataset - on a worker or a probe.
export const CONTENT_SCAN_MODEL_TIME_IN_MS: number = 2 * 60 * 1000;

/*
 * The hourly telemetry scan of a whole project, when the project turned the
 * model on for it, and each service's store of logs, exceptions, traces or
 * conversations within it.
 */
export const TELEMETRY_SCAN_MODEL_TIME_IN_MS: number = 60 * 1000;
export const TELEMETRY_STORE_MODEL_TIME_IN_MS: number = 6 * 1000;

/*
 * A finding's records read again after its scan, for a finding the model
 * made (ModelRereads.ts): Show the records it was seen in, a scrub rule's
 * proof - every rule a finding is planned with shares it - and the check
 * that a code fix stopped a leak. A few hundred values at most.
 */
export const REREAD_MODEL_TIME_IN_MS: number = 20 * 1000;

export type BudgetScope = "content" | "telemetry" | "reread";

// "2 minutes", "6 seconds": a budget as its warning says it.
export function describeDuration(milliseconds: number): string {
  const seconds: number = Math.max(1, Math.round(milliseconds / 1000));

  if (seconds % 60 === 0) {
    const minutes: number = seconds / 60;

    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

export class ModelStoreBudget {
  private readonly scan: ModelBudget;
  private readonly limitInMs: number;
  private spent: number = 0;
  // Free-text values the model was to read, and those it read whole.
  private toRead: number = 0;
  private read: number = 0;
  // Why the model could not run at all, when it could not.
  private unavailable: string | null = null;
  private runOutBy: "scan" | "store" | null = null;

  public constructor(scan: ModelBudget, limitInMs: number) {
    this.scan = scan;
    this.limitInMs = limitInMs;
  }

  // Model time this store may still spend in this scan.
  public get remainingInMs(): number {
    return Math.min(this.limitInMs - this.spent, this.scan.remainingInMs);
  }

  public get spentInMs(): number {
    return this.spent;
  }

  /*
   * Whether a batch may start. When it may not, remembers which budget ran
   * out, for the warning.
   */
  public canSpend(): boolean {
    if (this.scan.remainingInMs <= 0) {
      this.runOutBy = this.runOutBy || "scan";
      return false;
    }

    if (this.limitInMs - this.spent <= 0) {
      this.runOutBy = this.runOutBy || "store";
      return false;
    }

    return true;
  }

  public charge(milliseconds: number): void {
    const spent: number = Math.max(0, milliseconds);

    this.spent += spent;
    this.scan.charge(spent);
  }

  // How many of the values the model was given it read whole.
  public noteValues(data: { toRead: number; read: number }): void {
    this.toRead += Math.max(0, data.toRead);
    this.read += Math.max(0, Math.min(data.read, data.toRead));
  }

  public noteUnavailable(reason: string, values: number): void {
    this.unavailable = this.unavailable || reason;
    this.toRead += Math.max(0, values);
  }

  public get valuesToRead(): number {
    return this.toRead;
  }

  public get valuesRead(): number {
    return this.read;
  }

  public get ranOutBy(): "scan" | "store" | null {
    return this.read < this.toRead ? this.runOutBy : null;
  }

  // Why the model could not run at all, when it could not.
  public get unavailableReason(): string | null {
    return this.unavailable;
  }

  /*
   * What the scan's warnings say about the model for this store: nothing
   * when it read every free-text value it was given.
   */
  public getWarnings(): Array<string> {
    if (this.toRead === 0) {
      return [];
    }

    if (this.unavailable) {
      return [
        `Names and street addresses in free text were not looked for: ${this.unavailable}.`,
      ];
    }

    if (this.read >= this.toRead) {
      return [];
    }

    const limit: string =
      this.runOutBy === "store"
        ? `this store's ${describeDuration(this.limitInMs)} of model time`
        : `the scan's ${describeDuration(this.scan.limitInMs)} of model time`;

    return [
      `Names and street addresses were looked for in ${this.read} of ${this.toRead} free-text values: ${limit} ran out.`,
    ];
  }
}

export class ModelBudget {
  public readonly limitInMs: number;
  public readonly storeLimitInMs: number;
  private spent: number = 0;
  private readonly stores: Map<string, ModelStoreBudget> = new Map();

  public constructor(data: { scanLimitInMs: number; storeLimitInMs: number }) {
    this.limitInMs = Math.max(0, data.scanLimitInMs);
    this.storeLimitInMs = Math.max(0, data.storeLimitInMs);
  }

  public static forScope(scope: BudgetScope): ModelBudget {
    if (scope === "telemetry") {
      return new ModelBudget({
        scanLimitInMs: TELEMETRY_SCAN_MODEL_TIME_IN_MS,
        storeLimitInMs: TELEMETRY_STORE_MODEL_TIME_IN_MS,
      });
    }

    if (scope === "reread") {
      return new ModelBudget({
        scanLimitInMs: REREAD_MODEL_TIME_IN_MS,
        storeLimitInMs: REREAD_MODEL_TIME_IN_MS,
      });
    }

    return new ModelBudget({
      scanLimitInMs: CONTENT_SCAN_MODEL_TIME_IN_MS,
      storeLimitInMs: CONTENT_SCAN_MODEL_TIME_IN_MS,
    });
  }

  public get remainingInMs(): number {
    return this.limitInMs - this.spent;
  }

  public get spentInMs(): number {
    return this.spent;
  }

  public charge(milliseconds: number): void {
    this.spent += Math.max(0, milliseconds);
  }

  // One store's share: created on first use, the same object after.
  public forStore(key: string): ModelStoreBudget {
    let store: ModelStoreBudget | undefined = this.stores.get(key);

    if (!store) {
      store = new ModelStoreBudget(this, this.storeLimitInMs);
      this.stores.set(key, store);
    }

    return store;
  }
}
