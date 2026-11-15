import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPolicyRunFailures } from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import logger from "../Logger";

/*
 * WHERE A POLICY RUN'S FAILED TRIES ARE KEPT, BETWEEN TICKS (issue #8167).
 *
 * The worker that moves runs on (OnCallDutyPolicyExecutionLog:
 * ExecutePendingExecutions) tries a run's failed step again, waiting longer
 * each time, and ends the run in Error once its tries run out
 * (OnCallPolicyRunRetry). Its ticks run on any worker replica, one at a
 * time (CronLock), and a replica may restart between them: what it knows
 * of a run's failures is kept in Redis, as OnCallSendLag keeps what it
 * knows of a person's page, so the next tick knows it wherever it runs.
 *
 * Kept well past a run's last try, and forgotten as soon as a try goes
 * through. Nothing here throws: failures that cannot be read are read as
 * none - the run is tried at once, as it was before it had any - and ones
 * that cannot be kept are not kept, so the worst a Redis that is down does
 * is try a run every minute, as the worker always did.
 */

// A moment kept in Redis: milliseconds since the epoch.
type KeptFailures = {
  failedTries: number;
  firstFailedAt: number;
  lastFailedAt: number;
  retryAt: number;
  lastError: string;
};

export default class OnCallPolicyRunRetries {
  public static readonly CACHE_NAMESPACE: string =
    "on-call-policy-run-failures";

  // Six hours: far past a run's last try, about 37 minutes after its first.
  public static readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * The failures of each of `runIds` that has some, by the run's id: one
   * round trip for a page of runs.
   */
  public static async read(
    runIds: Array<ObjectID | null | undefined>,
  ): Promise<Map<string, OnCallPolicyRunFailures>> {
    const failures: Map<string, OnCallPolicyRunFailures> = new Map();
    const keys: Array<string> = runIds
      .filter((runId: ObjectID | null | undefined): runId is ObjectID => {
        return Boolean(runId);
      })
      .map((runId: ObjectID): string => {
        return runId.toString();
      });

    if (keys.length === 0) {
      return failures;
    }

    try {
      const values: Array<string | null> = await GlobalCache.getStrings(
        this.CACHE_NAMESPACE,
        keys,
      );

      keys.forEach((key: string, index: number) => {
        const kept: OnCallPolicyRunFailures | null = this.fromCacheValue(
          values[index] || null,
        );

        if (kept) {
          failures.set(key, kept);
        }
      });
    } catch (err) {
      logger.debug(
        `Could not read the failed tries of a page of on-call runs; trying them as runs with none: ${err}`,
      );
    }

    return failures;
  }

  // Keeps a run's failures for its next try.
  public static async remember(
    runId: ObjectID | null | undefined,
    failures: OnCallPolicyRunFailures,
  ): Promise<void> {
    if (!runId) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        runId.toString(),
        this.toCacheValue(failures),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the failed tries of on-call run ${runId.toString()}: ${err}`,
      );
    }
  }

  // Forgets a run's failures: a try went through, or the run ended.
  public static async forget(
    runId: ObjectID | null | undefined,
  ): Promise<void> {
    if (!runId) {
      return;
    }

    try {
      await GlobalCache.deleteKey(this.CACHE_NAMESPACE, runId.toString());
    } catch (err) {
      logger.debug(
        `Could not forget the failed tries of on-call run ${runId.toString()}: ${err}`,
      );
    }
  }

  public static toCacheValue(failures: OnCallPolicyRunFailures): string {
    const kept: KeptFailures = {
      failedTries: failures.failedTries,
      firstFailedAt: new Date(failures.firstFailedAt).getTime(),
      lastFailedAt: new Date(failures.lastFailedAt).getTime(),
      retryAt: new Date(failures.retryAt).getTime(),
      lastError: failures.lastError,
    };

    return JSON.stringify(kept);
  }

  // What was kept, or null for nothing, or for something that is not failures.
  public static fromCacheValue(
    value: string | null | undefined,
  ): OnCallPolicyRunFailures | null {
    if (!value) {
      return null;
    }

    try {
      const kept: Partial<KeptFailures> = JSON.parse(
        value,
      ) as Partial<KeptFailures>;

      if (
        !kept ||
        typeof kept !== "object" ||
        !Number.isInteger(kept.failedTries) ||
        (kept.failedTries as number) < 1 ||
        !this.isMoment(kept.firstFailedAt) ||
        !this.isMoment(kept.lastFailedAt) ||
        !this.isMoment(kept.retryAt)
      ) {
        return null;
      }

      return {
        failedTries: kept.failedTries as number,
        firstFailedAt: new Date(kept.firstFailedAt as number),
        lastFailedAt: new Date(kept.lastFailedAt as number),
        retryAt: new Date(kept.retryAt as number),
        lastError: typeof kept.lastError === "string" ? kept.lastError : "",
      };
    } catch {
      return null;
    }
  }

  private static isMoment(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}
