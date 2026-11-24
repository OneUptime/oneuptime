import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { readObject, readText } from "../../LlmObservability/LlmProviderHttp";
import {
  CLOUD_DEFAULT_SLEEP,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import AzureArm, { AzureArmAnswer, AzureArmError } from "./AzureArm";
import { AzureRateLimit } from "./AzureRateLimit";

/*
 * AZURE COST MANAGEMENT, ASKED AT THE PACE A TENANT ALLOWS (#10295).
 *
 * Cost Management's Query API limits a tenant by the query processing units
 * (QPU) its queries cost, one for each month of data a query reads: 12 in
 * 10 seconds, 60 in a minute and 600 in an hour, and a query past any of
 * them is answered 429 until the time its qpu-retry-after header says
 * ("Manage Azure costs with automation", Query API query processing units).
 * Beside them are limits on the requests of one scope (entity), of the
 * tenant and of the client type, each with a retry-after header of its own
 * (AzureRateLimit). Every caller of the tenant shares them: its people's
 * cost analysis in the Azure portal, its other tools, every OneUptime
 * connection to it.
 *
 * A read of a tenant's fifty subscriptions asked their queries two at a
 * time, as fast as Azure answered, each three QPU on a first read: past the
 * ten-second quota by the fifth query. Each 429 was asked again one, two
 * and four seconds later, as if Azure had named no wait - the transport
 * threw the headers away - and every try spent the read's budget of 60
 * requests, so the read stopped a third of the way through, and the next
 * one, twelve hours later, did the same in the same order.
 *
 * So, per tenant:
 *
 *   - one query at a time, sent once it fits in two thirds of every QPU
 *     quota (the third left to the tenant's other callers), charged a QPU
 *     for each calendar month its days touch - the most it can cost - and
 *     then what Azure says it consumed (qpu-consumed). Each page of an
 *     answer is a query of its own;
 *   - a throttled answer (429, or a 502, 503 or 504 that will pass) holds
 *     the tenant - or only its scope, when the scope's limit alone asked -
 *     for the longest wait its headers name, else a backoff doubling from
 *     five seconds, with up to a second of jitter so the tenant's callers do
 *     not all ask again at once. A request quota said spent holds it a
 *     minute, a QPU quota said spent ten seconds;
 *   - a wait that would end after the read's time is up is not waited: the
 *     query is put off to that time (AzureCostThrottled), and the read
 *     carries on from there at the first read after it.
 *
 * The pacer is the tenant's, kept between reads in this process, since the
 * hour's quota spans reads. Another process sharing the tenant is heard
 * through the headers.
 */

// The Query API's QPU quotas, each a tenant's, as Microsoft documents them.
export const AZURE_COST_QPU_QUOTAS: ReadonlyArray<{
  spanMs: number;
  limit: number;
}> = [
  { spanMs: 10 * 1000, limit: 12 },
  { spanMs: 60 * 1000, limit: 60 },
  { spanMs: 60 * 60 * 1000, limit: 600 },
];

// The share of each quota OneUptime's queries take: the rest is the tenant's other callers'.
export const AZURE_COST_QPU_SHARE: number = 2 / 3;

// A request quota said spent ("DefaultQuota:0"): none of its requests until this long after.
export const AZURE_COST_SPENT_REQUESTS_HOLD_MS: number = 60 * 1000;

// A QPU quota said spent: held for the shortest QPU window.
export const AZURE_COST_SPENT_QPU_HOLD_MS: number = 10 * 1000;

// How many times one page is asked while it is throttled, each after its wait.
export const AZURE_COST_PAGE_TRIES: number = 3;

// The wait when a throttle names none, doubled at each try after it.
export const AZURE_COST_FIRST_BACKOFF_MS: number = 5 * 1000;

// At most this much more than a throttle asked for, at random.
export const AZURE_COST_MAX_JITTER_MS: number = 1000;

// How long the pacer remembers what was asked: the longest quota's span.
const AZURE_COST_MEMORY_MS: number = 60 * 60 * 1000;

// The QPU of each quota OneUptime keeps within.
export function getAzureCostQpuCaps(): Array<{ spanMs: number; cap: number }> {
  return AZURE_COST_QPU_QUOTAS.map(
    (quota: { spanMs: number; limit: number }) => {
      return {
        spanMs: quota.spanMs,
        cap: Math.floor(quota.limit * AZURE_COST_QPU_SHARE),
      };
    },
  );
}

/*
 * The QPU a query may cost: one for each calendar month its days touch
 * (Microsoft deducts one QPU "for one month of data queried"), at least one.
 * September 1 to November 20 is three; a week across a month's end two.
 */
export function getAzureCostQueryQpu(body: JSONObject): number {
  const period: JSONObject = readObject(body["timePeriod"]);
  const from: number = Date.parse(readText(period["from"]));
  const to: number = Date.parse(readText(period["to"]));

  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return 1;
  }

  const start: Date = new Date(from);
  const end: Date = new Date(to);

  return Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      1,
  );
}

/*
 * A query Cost Management's limits put off: it may be asked from retryAt -
 * after the read's time is up, or its tries ran out.
 */
export class AzureCostThrottled extends Error {
  public readonly retryAt: Date;
  // What Azure answered last, when it answered.
  public readonly answer: unknown;

  public constructor(retryAt: Date, answer?: unknown) {
    super(
      `Azure Cost Management's limits put this query off until ${retryAt.toISOString()}.`,
    );
    this.name = "AzureCostThrottled";
    this.retryAt = retryAt;
    this.answer = answer;
  }
}

/*
 * The time a read of costs goes by: the read's clock, moved on by the read's
 * own waits - so a clock that stands still (a test's, a lane's frozen "now")
 * still sees the time a wait took - and never read going back.
 */
export class AzureCostClock {
  private floorMs: number;
  private readonly read: () => number;
  private readonly sleeper: (milliseconds: number) => Promise<void>;

  public constructor(data: {
    now?: (() => Date) | undefined;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  }) {
    const now: (() => Date) | undefined = data.now;

    this.read = now
      ? (): number => {
          return now().getTime();
        }
      : (): number => {
          return Date.now();
        };
    this.sleeper = data.sleep || CLOUD_DEFAULT_SLEEP;
    this.floorMs = this.read();
  }

  public nowMs(): number {
    this.floorMs = Math.max(this.floorMs, this.read());
    return this.floorMs;
  }

  public async sleep(milliseconds: number): Promise<void> {
    if (!(milliseconds > 0)) {
      return;
    }

    const untilMs: number = this.nowMs() + milliseconds;
    await this.sleeper(milliseconds);
    this.floorMs = Math.max(this.floorMs, untilMs);
  }
}

// One query's charge against the quotas: settled once Azure says what it cost.
export interface AzureCostCharge {
  atMs: number;
  qpu: number;
}

/*
 * A tenant's Cost Management quotas as OneUptime has used them: what it
 * asked in the last hour, and until when a throttle holds the tenant or a
 * scope of it.
 */
export class AzureCostPacer {
  private charges: Array<AzureCostCharge> = [];
  private tenantHeldUntilMs: number = 0;
  private scopesHeldUntilMs: Map<string, number> = new Map();
  private turn: Promise<void> = Promise.resolve();

  /*
   * One query of the tenant at a time, in the order they came: the next
   * waits until the one before has its answer.
   */
  public async inTurn<T>(work: () => Promise<T>): Promise<T> {
    const previous: Promise<void> = this.turn;
    let release: () => void = (): void => {};

    this.turn = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    try {
      await previous;
      return await work();
    } finally {
      release();
    }
  }

  /*
   * The earliest time from nowMs a query of `qpu` on `scope` may be sent:
   * once no throttle holds it, and every quota's window has room for it
   * within OneUptime's share. A query larger than a share goes when its
   * window is empty.
   */
  public whenFits(data: { nowMs: number; qpu: number; scope: string }): number {
    this.forget(data.nowMs);

    let atMs: number = Math.max(
      data.nowMs,
      this.tenantHeldUntilMs,
      this.scopesHeldUntilMs.get(data.scope) || 0,
    );

    for (const quota of getAzureCostQpuCaps()) {
      const cap: number = Math.max(quota.cap, data.qpu);
      const windowStartMs: number = atMs - quota.spanMs;
      const inWindow: Array<AzureCostCharge> = this.charges
        .filter((charge: AzureCostCharge): boolean => {
          return charge.atMs > windowStartMs;
        })
        .sort((a: AzureCostCharge, b: AzureCostCharge): number => {
          return a.atMs - b.atMs;
        });
      let used: number = inWindow.reduce(
        (sum: number, charge: AzureCostCharge): number => {
          return sum + charge.qpu;
        },
        0,
      );

      // Wait for the oldest charges to leave the window until the query fits.
      for (const charge of inWindow) {
        if (used + data.qpu <= cap) {
          break;
        }

        used -= charge.qpu;
        atMs = Math.max(atMs, charge.atMs + quota.spanMs);
      }
    }

    /*
     * Moving later only lets charges leave the other windows (none is in the
     * future), so every quota still has room at atMs.
     */
    return atMs;
  }

  // A query sent at atMs, charged what it may cost.
  public charge(atMs: number, qpu: number): AzureCostCharge {
    const charge: AzureCostCharge = { atMs, qpu: Math.max(0, qpu) };
    this.charges.push(charge);
    return charge;
  }

  // What a query cost, as Azure said it: nothing, for one refused before it ran.
  public settle(charge: AzureCostCharge, qpu: number): void {
    if (Number.isFinite(qpu) && qpu >= 0) {
      charge.qpu = qpu;
    }
  }

  public holdTenant(untilMs: number): void {
    this.tenantHeldUntilMs = Math.max(this.tenantHeldUntilMs, untilMs);
  }

  public holdScope(scope: string, untilMs: number): void {
    this.scopesHeldUntilMs.set(
      scope,
      Math.max(this.scopesHeldUntilMs.get(scope) || 0, untilMs),
    );
  }

  // The QPU charged in the span before atMs: what a quota's window holds.
  public getUsedQpu(data: { atMs: number; spanMs: number }): number {
    return this.charges
      .filter((charge: AzureCostCharge): boolean => {
        return (
          charge.atMs > data.atMs - data.spanMs && charge.atMs <= data.atMs
        );
      })
      .reduce((sum: number, charge: AzureCostCharge): number => {
        return sum + charge.qpu;
      }, 0);
  }

  // What happened more than an hour ago no quota holds any more.
  private forget(nowMs: number): void {
    this.charges = this.charges.filter((charge: AzureCostCharge): boolean => {
      return charge.atMs > nowMs - AZURE_COST_MEMORY_MS;
    });

    for (const [scope, untilMs] of Array.from(this.scopesHeldUntilMs)) {
      if (untilMs <= nowMs) {
        this.scopesHeldUntilMs.delete(scope);
      }
    }
  }
}

// Each tenant's pacer, by AzureArm.getRateLimitKey: shared by its connections.
const PACERS: Map<string, AzureCostPacer> = new Map();

export function getAzureCostPacer(key: string): AzureCostPacer {
  let pacer: AzureCostPacer | undefined = PACERS.get(key);

  if (!pacer) {
    pacer = new AzureCostPacer();
    PACERS.set(key, pacer);
  }

  return pacer;
}

// Tests start from a tenant that has asked nothing.
export function forgetAzureCostPacers(): void {
  PACERS.clear();
}

/*
 * An answer Cost Management will give later: a rate limit, or a gateway or
 * a service that is busy for now.
 */
export function isThrottledCostAnswer(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }

  return (
    error.statusCode === 429 ||
    error.statusCode === 502 ||
    error.statusCode === 503 ||
    error.statusCode === 504
  );
}

/*
 * A request refused before its query ran - not sent at all (the read's
 * budget was spent), or turned away for what it asked (a 400, 401, 403 or
 * 404) - costs no QPU.
 */
function isRefusedBeforeRunning(error: unknown): boolean {
  if (error instanceof CloudReadBudgetSpent) {
    return true;
  }

  return (
    error instanceof LlmProviderError &&
    (error.statusCode === 400 ||
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.statusCode === 404)
  );
}

export interface AzureCostReaderOptions {
  arm: AzureArm;
  // The read's budget: its requests, and how long it may wait at most.
  budget?: CloudReadBudget | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // What jitter is drawn from: Math.random unless a test's.
  random?: (() => number) | undefined;
  // The tenant's pacer, unless a test's.
  pacer?: AzureCostPacer | undefined;
}

/*
 * The queries of one read of costs (or of commitments), each paced against
 * its tenant's quotas and held to the read's time.
 */
export class AzureCostReader {
  public readonly arm: AzureArm;
  public readonly clock: AzureCostClock;
  public readonly pacer: AzureCostPacer;
  private readonly deadlineMs: number;
  private readonly random: () => number;

  public constructor(options: AzureCostReaderOptions) {
    this.arm = options.arm;
    this.clock = new AzureCostClock({
      now: options.now,
      sleep: options.sleep,
    });
    this.pacer =
      options.pacer || getAzureCostPacer(options.arm.getRateLimitKey());
    this.deadlineMs =
      this.clock.nowMs() +
      (options.budget
        ? options.budget.getRemainingMs()
        : Number.POSITIVE_INFINITY);
    this.random =
      options.random ||
      ((): number => {
        return Math.random();
      });
  }

  // When the read's time is up, on its clock.
  public getDeadlineMs(): number {
    return this.deadlineMs;
  }

  /*
   * Every page of one query over a scope ("/subscriptions/<id>"), each
   * handed to onPage as Cost Management answers it (its properties), to the
   * last page or maxPages - complete is false when maxPages stopped it. A
   * next page is followed only on the management host, where the token may
   * go. Throws AzureCostThrottled when Cost Management's limits put a page
   * off past the read's time.
   */
  public async query(data: {
    scope: string;
    apiVersion: string;
    body: JSONObject;
    step: string;
    maxPages: number;
    onPage: (properties: JSONObject) => void;
  }): Promise<{ complete: boolean }> {
    const qpu: number = getAzureCostQueryQpu(data.body);
    let url: string = `${this.arm.getManagementBaseUrl()}${data.scope}/providers/Microsoft.CostManagement/query?api-version=${data.apiVersion}`;

    for (let page: number = 0; page < data.maxPages; page++) {
      const answer: JSONObject = await this.ask({
        url,
        body: data.body,
        step: data.step,
        scope: data.scope,
        qpu,
      });
      const properties: JSONObject = readObject(answer["properties"]);

      data.onPage(properties);

      const next: string = readText(properties["nextLink"]);

      if (!next || next === url) {
        return { complete: true };
      }

      /*
       * A next page elsewhere is never asked with the token - and what was
       * read is not all there is, so it is not written as if it were.
       */
      if (!this.arm.isManagementUrl(next)) {
        return { complete: false };
      }

      url = next;
    }

    return { complete: false };
  }

  /*
   * One page, asked when the tenant has room, and again after a throttle's
   * wait while the read has time and tries left.
   */
  private async ask(data: {
    url: string;
    body: JSONObject;
    step: string;
    scope: string;
    qpu: number;
  }): Promise<JSONObject> {
    for (let tries: number = 1; ; tries++) {
      const outcome:
        | { answer: JSONObject }
        | { throttledUntilMs: number; error: unknown } =
        await this.pacer.inTurn(async () => {
          const atMs: number = this.pacer.whenFits({
            nowMs: this.clock.nowMs(),
            qpu: data.qpu,
            scope: data.scope,
          });

          if (atMs > this.deadlineMs) {
            throw new AzureCostThrottled(new Date(atMs));
          }

          await this.clock.sleep(atMs - this.clock.nowMs());

          const charge: AzureCostCharge = this.pacer.charge(
            this.clock.nowMs(),
            data.qpu,
          );

          try {
            const answer: AzureArmAnswer = await this.arm.queryCostManagement(
              data.url,
              data.body,
              data.step,
            );

            this.learn(answer.rateLimit, charge, data.scope);

            return { answer: answer.body };
          } catch (error) {
            if (!isThrottledCostAnswer(error)) {
              if (isRefusedBeforeRunning(error)) {
                this.pacer.settle(charge, 0);
              }

              throw error;
            }

            const rateLimit: AzureRateLimit =
              error instanceof AzureArmError ? error.rateLimit : {};

            this.learn(rateLimit, charge, data.scope);

            const waitMs: number =
              rateLimit.retryAfterMs ??
              AZURE_COST_FIRST_BACKOFF_MS * Math.pow(2, tries - 1);
            const untilMs: number =
              this.clock.nowMs() + waitMs + this.getJitterMs(waitMs);

            if (rateLimit.isScopeOnly) {
              this.pacer.holdScope(data.scope, untilMs);
            } else {
              this.pacer.holdTenant(untilMs);
            }

            return { throttledUntilMs: untilMs, error };
          }
        });

      if ("answer" in outcome) {
        return outcome.answer;
      }

      if (
        tries >= AZURE_COST_PAGE_TRIES ||
        outcome.throttledUntilMs > this.deadlineMs
      ) {
        throw new AzureCostThrottled(
          new Date(outcome.throttledUntilMs),
          outcome.error,
        );
      }
    }
  }

  /*
   * What an answer's headers said: what the query cost, and a quota said
   * spent, which holds what it limits so the next request is not refused.
   */
  private learn(
    rateLimit: AzureRateLimit,
    charge: AzureCostCharge,
    scope: string,
  ): void {
    if (rateLimit.qpuConsumed !== undefined) {
      this.pacer.settle(charge, rateLimit.qpuConsumed);
    }

    const nowMs: number = this.clock.nowMs();

    if (
      rateLimit.tenantRequestsRemaining === 0 ||
      rateLimit.clientTypeRequestsRemaining === 0
    ) {
      this.pacer.holdTenant(nowMs + AZURE_COST_SPENT_REQUESTS_HOLD_MS);
    }

    if (rateLimit.entityRequestsRemaining === 0) {
      this.pacer.holdScope(scope, nowMs + AZURE_COST_SPENT_REQUESTS_HOLD_MS);
    }

    if (rateLimit.qpuRemaining === 0) {
      this.pacer.holdTenant(nowMs + AZURE_COST_SPENT_QPU_HOLD_MS);
    }
  }

  // A tenth of the wait, a second at most, at random.
  private getJitterMs(waitMs: number): number {
    const fraction: number = Math.min(Math.max(this.random(), 0), 1);

    return Math.round(
      Math.min(AZURE_COST_MAX_JITTER_MS, waitMs / 10) * fraction,
    );
  }
}
