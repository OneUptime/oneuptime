import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPolicyRunFailures } from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import logger from "../Logger";

/*
 * WHERE THE FAILED TRIES OF AN ON-CALL RUN OR A PERSON'S PAGE ARE KEPT,
 * BETWEEN TICKS (issues #8167, #8408).
 *
 * The workers that move policy runs on (OnCallDutyPolicyExecutionLog:
 * ExecutePendingExecutions) and run a person's On-Call Rules
 * (UserOnCallLog:ExecutePendingExecutions) try a failed step again, waiting
 * longer each time, and end the run or the person's log in Error once its
 * tries run out (OnCallPolicyRunRetry). Their ticks run on any worker
 * replica, one at a time (CronLock), and a replica may restart between
 * them: what a worker knows of the failures is kept in Redis, as
 * OnCallSendLag keeps what it knows of a person's page, so the next tick
 * knows it wherever it runs. Each worker keeps its own, under a namespace
 * of its own.
 *
 * Kept well past the last try, and forgotten as soon as a try goes
 * through. Nothing here throws: failures that cannot be read are read as
 * none - tried at once, as before any failed - and ones that cannot be kept
 * are not kept, so the worst a Redis that is down does is try every minute,
 * as the workers always did.
 */

// A moment kept in Redis: milliseconds since the epoch.
type KeptFailures = {
  failedTries: number;
  firstFailedAt: number;
  lastFailedAt: number;
  retryAt: number;
  lastError: string;
};

export class OnCallRetries {
  public readonly CACHE_NAMESPACE: string;

  // Six hours: far past the last try, about 37 minutes after the first.
  public readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  // What is tried, for the log: "on-call run", "person's on-call log".
  private readonly what: string;

  public constructor(data: { namespace: string; what: string }) {
    this.CACHE_NAMESPACE = data.namespace;
    this.what = data.what;
  }

  /*
   * The failures of each of `ids` that has some, by its id: one round trip
   * for a page of them.
   */
  public async read(
    ids: Array<ObjectID | null | undefined>,
  ): Promise<Map<string, OnCallPolicyRunFailures>> {
    const failures: Map<string, OnCallPolicyRunFailures> = new Map();
    const keys: Array<string> = ids
      .filter((id: ObjectID | null | undefined): id is ObjectID => {
        return Boolean(id);
      })
      .map((id: ObjectID): string => {
        return id.toString();
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
        `Could not read the failed tries of a page of each ${this.what}; trying them as ones with none: ${err}`,
      );
    }

    return failures;
  }

  // Keeps the failures for the next try.
  public async remember(
    id: ObjectID | null | undefined,
    failures: OnCallPolicyRunFailures,
  ): Promise<void> {
    if (!id) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        id.toString(),
        this.toCacheValue(failures),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the failed tries of ${this.what} ${id.toString()}: ${err}`,
      );
    }
  }

  // Forgets the failures: a try went through, or it ended.
  public async forget(id: ObjectID | null | undefined): Promise<void> {
    if (!id) {
      return;
    }

    try {
      await GlobalCache.deleteKey(this.CACHE_NAMESPACE, id.toString());
    } catch (err) {
      logger.debug(
        `Could not forget the failed tries of ${this.what} ${id.toString()}: ${err}`,
      );
    }
  }

  public toCacheValue(failures: OnCallPolicyRunFailures): string {
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
  public fromCacheValue(
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

  private isMoment(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}

// A policy run's failed tries (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions).
const OnCallPolicyRunRetries: OnCallRetries = new OnCallRetries({
  namespace: "on-call-policy-run-failures",
  what: "on-call run",
});

// A person's on-call log's failed tries (UserOnCallLog:ExecutePendingExecutions).
export const UserOnCallLogRetries: OnCallRetries = new OnCallRetries({
  namespace: "on-call-user-log-failures",
  what: "person's on-call log",
});

export default OnCallPolicyRunRetries;
