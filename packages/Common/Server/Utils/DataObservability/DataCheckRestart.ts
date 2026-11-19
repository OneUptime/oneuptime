import {
  asSentence,
  DataSourceBusy,
  DataSourceBusyError,
  DataSourceRequestError,
  readDataSourceBusy,
} from "../DataSource/HttpFailure";

/*
 * A DATA CHECK THE WAREHOUSE FAILED FOR A MOMENT, STARTED AGAIN ONCE (#9679).
 *
 * The shared retry (DataSourceHttpRetry, #9540) asks a request again while
 * the warehouse turns it away for a moment. It cannot help a statement the
 * warehouse took and then failed for a moment - a Databricks statement
 * FAILED with TEMPORARILY_UNAVAILABLE, a BigQuery job's jobBackendError, an
 * Athena query whose error is Retryable - nor a request whose few tries ran
 * out inside the seconds a warehouse in maintenance stays away. A check
 * that met one was "could not run" until the store's next collection, so a
 * warehouse away for a minute showed every check due in it as broken.
 *
 * Such a check is started again, once, after a short wait:
 *
 *  - Only for a failure its warehouse's own docs call passing
 *    (readDataSourceBusy): each client marks the statement failures and the
 *    answers its provider's error reference says to try again. Never a
 *    refusal, a query the warehouse rejects, a table that is gone, nor a
 *    statement that ran past its timeout, which would again.
 *  - Only a check's statement, which is a single read-only aggregate
 *    (DataCheckSql), so running it twice changes nothing. Each sending is a
 *    new statement: a new Snowflake request ID, BigQuery requestId and
 *    Athena ClientRequestToken, as the old one would answer the failed run.
 *  - Never because of what a check read: a check that ran, whatever its
 *    value, is the check's result, and its condition is judged as ever.
 *  - After DATA_CHECK_RESTART_WAIT_IN_MS, or the longer wait the warehouse
 *    asked for, up to MAX_DATA_CHECK_RESTART_WAIT_IN_MS; a warehouse that
 *    asks for longer is left to the next collection.
 *  - Within a collection's budget of waits (DATA_CHECK_RESTART_BUDGET_IN_MS),
 *    and once a check started again fails for a moment again, the warehouse
 *    is down rather than blipping: the collection's other checks are not
 *    started again, as the shared retry's outage rule does for requests.
 *
 * The check's result says it: one that ran at its second try names why
 * the first failed (restartedAfter), and one that failed again says it was
 * started again.
 */

// How long a check waits before it is started again.
export const DATA_CHECK_RESTART_WAIT_IN_MS: number = 10_000;

// The longest wait a warehouse may ask for: a longer one is left to the next collection.
export const MAX_DATA_CHECK_RESTART_WAIT_IN_MS: number = 30_000;

// The most a collection waits in all to start checks again.
export const DATA_CHECK_RESTART_BUDGET_IN_MS: number = 60_000;

// The most of the first try's failure a result keeps.
export const MAX_RESTARTED_AFTER_LENGTH: number = 300;

export interface DataCheckRun<T> {
  value: T;
  // Why its first try failed for a moment, when it ran at its second.
  restartedAfter: string | null;
}

// A check started again that failed again: its second failure, said with the restart.
export class DataCheckRestartFailedError extends Error {
  // How the second try failed, as it came.
  public readonly secondFailure: unknown;
  // That the check was started again: what its result says after the failure.
  public readonly note: string;

  public constructor(error: unknown, waitedInMs: number) {
    const note: string = `The check was started again ${Math.round(waitedInMs / 1000)} seconds after its first try failed for a moment, and failed again.`;

    super(
      `${asSentence(error instanceof Error ? error.message : String(error))} ${note}`,
    );
    this.name = "DataCheckRestartFailedError";
    this.secondFailure = error;
    this.note = note;
  }
}

/*
 * A check's failure as its result keeps it, cut to fit and never holding a
 * secret (sanitize): one started again keeps its note whole, after as much
 * of the failure as fits.
 */
export function describeCheckFailure(data: {
  error: unknown;
  sanitize: (error: unknown) => string;
  maxLength: number;
}): string {
  if (!(data.error instanceof DataCheckRestartFailedError)) {
    return data.sanitize(data.error).slice(0, data.maxLength);
  }

  const note: string = data.error.note;
  const failure: string = asSentence(
    data.sanitize(data.error.secondFailure),
  ).slice(0, Math.max(0, data.maxLength - note.length - 1));

  return `${failure} ${note}`.trim();
}

// The first try's failure, in a few words: the provider's answer, or the statement's failure.
export function describeRestartedAfter(error: unknown): string {
  const words: string =
    error instanceof DataSourceRequestError
      ? error.reason
      : error instanceof DataSourceBusyError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

  return asSentence(words.trim()).slice(0, MAX_RESTARTED_AFTER_LENGTH);
}

export default class DataCheckRestarts {
  private readonly wait: (ms: number) => Promise<void>;
  // How long this collection has waited to start checks again.
  private waitedInMs: number = 0;
  // A check started again failed for a moment again: the warehouse is down.
  private isWarehouseDown: boolean = false;

  // Waits as long as asked; replaced in tests.
  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }

  public constructor(
    wait: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
      return DataCheckRestarts.sleep(ms);
    },
  ) {
    this.wait = wait;
  }

  // How long this collection has waited to start checks again.
  public get totalWaitInMs(): number {
    return this.waitedInMs;
  }

  /*
   * A check's read, started again once when its first try failed for a
   * moment, as its warehouse's docs call it. Throws the failure as it
   * came when it is not started again, and DataCheckRestartFailedError
   * when its second try fails too.
   */
  public async run<T>(read: () => Promise<T>): Promise<DataCheckRun<T>> {
    let first: unknown;

    try {
      return { value: await read(), restartedAfter: null };
    } catch (error) {
      first = error;
    }

    const waitInMs: number | null = this.reserveWait(readDataSourceBusy(first));

    if (waitInMs === null) {
      throw first;
    }

    await this.wait(waitInMs);

    try {
      return {
        value: await read(),
        restartedAfter: describeRestartedAfter(first),
      };
    } catch (again) {
      if (readDataSourceBusy(again)) {
        this.isWarehouseDown = true;
      }

      throw new DataCheckRestartFailedError(again, waitInMs);
    }
  }

  // How long to wait before the second try, taken from the budget; null when there is none.
  private reserveWait(busy: DataSourceBusy | null): number | null {
    if (!busy || this.isWarehouseDown) {
      return null;
    }

    const waitInMs: number = Math.max(
      DATA_CHECK_RESTART_WAIT_IN_MS,
      busy.waitInMs || 0,
    );

    if (
      waitInMs > MAX_DATA_CHECK_RESTART_WAIT_IN_MS ||
      this.waitedInMs + waitInMs > DATA_CHECK_RESTART_BUDGET_IN_MS
    ) {
      return null;
    }

    this.waitedInMs += waitInMs;

    return waitInMs;
  }
}
