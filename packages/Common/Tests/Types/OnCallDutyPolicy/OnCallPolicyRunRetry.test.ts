import ColumnLength from "../../../Types/Database/ColumnLength";
import { isErrorSentence } from "../../../Types/Exception/ErrorMessageRule";
import {
  addOnCallPolicyRunFailure,
  getOnCallPolicyRunOutOfTriesMessage,
  getOnCallPolicyRunRetryWaitInMinutes,
  getUserOnCallLogOutOfTriesMessage,
  hasOnCallPolicyRunRunOutOfTries,
  isOnCallPolicyRunRetryDue,
  ON_CALL_POLICY_RUN_MAX_TRIES,
  ON_CALL_POLICY_RUN_RETRY_LONGEST_WAIT_IN_MINUTES,
  ON_CALL_POLICY_RUN_RETRY_SLACK_IN_MS,
  OnCallPolicyRunFailures,
  toOnCallPolicyRunStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A POLICY RUN'S FAILED STEP IS TRIED AGAIN, AND WHEN IT STOPS
 * (issue #8167): a minute, two, four, then every five, ten tries in a row,
 * and then the run ends in Error, saying what happened and what to do.
 */

const MINUTE: number = 60 * 1000;
const T0: Date = new Date("2026-11-15T03:00:00.000Z");

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * MINUTE);
}

// A run's failures after a try failed at each of `minutes`.
function failedAt(
  minutes: Array<number>,
  error: string = "x",
): OnCallPolicyRunFailures {
  let failures: OnCallPolicyRunFailures | null = null;

  for (const minute of minutes) {
    failures = addOnCallPolicyRunFailure({
      previous: failures,
      failedAt: at(minute),
      error: error,
    });
  }

  return failures!;
}

describe("the wait before the next try", () => {
  test("doubles from a minute, and is five minutes at most", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 9, 10, 50].map(getOnCallPolicyRunRetryWaitInMinutes),
    ).toEqual([1, 2, 4, 5, 5, 5, 5, 5, 5]);
    expect(ON_CALL_POLICY_RUN_RETRY_LONGEST_WAIT_IN_MINUTES).toBe(5);
  });

  test("a count that is not a count waits a minute", () => {
    for (const odd of [0, -3, NaN, Infinity, 1.7]) {
      expect(getOnCallPolicyRunRetryWaitInMinutes(odd)).toBe(1);
    }
  });
});

describe("a run's failures", () => {
  test("the first failed try: counted from now, the next try a minute later", () => {
    const failures: OnCallPolicyRunFailures = failedAt([0], "Connection reset");

    expect(failures).toEqual({
      failedTries: 1,
      firstFailedAt: at(0),
      lastFailedAt: at(0),
      retryAt: at(1),
      lastError: "Connection reset",
    });
  });

  test("each try that fails again counts, keeps when they began, and waits longer", () => {
    const failures: OnCallPolicyRunFailures = failedAt([0, 1, 3, 7]);

    expect(failures.failedTries).toBe(4);
    expect(failures.firstFailedAt).toEqual(at(0));
    expect(failures.lastFailedAt).toEqual(at(7));
    expect(failures.retryAt).toEqual(at(12));
  });

  test("keeps the last try's error", () => {
    const failures: OnCallPolicyRunFailures = addOnCallPolicyRunFailure({
      previous: failedAt([0], "first"),
      failedAt: at(1),
      error: "second",
    });

    expect(failures.lastError).toBe("second");
  });

  test("does not change the failures it was given", () => {
    const previous: OnCallPolicyRunFailures = failedAt([0]);
    const copy: string = JSON.stringify(previous);

    addOnCallPolicyRunFailure({ previous, failedAt: at(1), error: "y" });

    expect(JSON.stringify(previous)).toBe(copy);
  });
});

describe("whether a run is tried", () => {
  test("a run with no failures always is", () => {
    expect(isOnCallPolicyRunRetryDue({ failures: null, now: T0 })).toBe(true);
    expect(isOnCallPolicyRunRetryDue({ failures: undefined, now: T0 })).toBe(
      true,
    );
  });

  test("a run whose try failed waits until its next try, give or take a tick's slack", () => {
    const failures: OnCallPolicyRunFailures = failedAt([0, 1]); // next at 3

    expect(isOnCallPolicyRunRetryDue({ failures, now: at(1) })).toBe(false);
    expect(isOnCallPolicyRunRetryDue({ failures, now: at(2) })).toBe(false);
    // A tick a few seconds early is not made to wait a minute more.
    expect(
      isOnCallPolicyRunRetryDue({
        failures,
        now: new Date(at(3).getTime() - ON_CALL_POLICY_RUN_RETRY_SLACK_IN_MS),
      }),
    ).toBe(true);
    expect(
      isOnCallPolicyRunRetryDue({
        failures,
        now: new Date(
          at(3).getTime() - ON_CALL_POLICY_RUN_RETRY_SLACK_IN_MS - 1,
        ),
      }),
    ).toBe(false);
    expect(isOnCallPolicyRunRetryDue({ failures, now: at(3) })).toBe(true);
    expect(isOnCallPolicyRunRetryDue({ failures, now: at(60) })).toBe(true);
  });

  test("a failure with no time to wait until is tried", () => {
    const failures: OnCallPolicyRunFailures = {
      ...failedAt([0]),
      retryAt: new Date(NaN),
    };

    expect(isOnCallPolicyRunRetryDue({ failures, now: T0 })).toBe(true);
  });
});

describe("when a run runs out of tries", () => {
  test("after ten tries in a row, about 37 minutes from the first", () => {
    expect(ON_CALL_POLICY_RUN_MAX_TRIES).toBe(10);

    // Each try at the first tick it is due: the schedule a run follows.
    const minutes: Array<number> = [];
    let failures: OnCallPolicyRunFailures | null = null;
    let minute: number = 0;

    while (!failures || !hasOnCallPolicyRunRunOutOfTries(failures)) {
      if (isOnCallPolicyRunRetryDue({ failures, now: at(minute) })) {
        minutes.push(minute);
        failures = addOnCallPolicyRunFailure({
          previous: failures,
          failedAt: at(minute),
          error: "x",
        });
      }

      minute++;
    }

    expect(minutes).toEqual([0, 1, 3, 7, 12, 17, 22, 27, 32, 37]);
  });

  test("not a try before", () => {
    expect(hasOnCallPolicyRunRunOutOfTries(failedAt([0, 1, 3, 7, 12]))).toBe(
      false,
    );
    expect(
      hasOnCallPolicyRunRunOutOfTries(
        failedAt([0, 1, 3, 7, 12, 17, 22, 27, 32]),
      ),
    ).toBe(false);
  });
});

describe("what a run that ran out of tries says", () => {
  const OUT: OnCallPolicyRunFailures = failedAt(
    [0, 1, 3, 7, 12, 17, 22, 27, 32, 37],
    "Connection terminated unexpectedly",
  );

  test("a run that was paging: how long it was tried, the last error, and what to do", () => {
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: OUT,
        wasWaiting: false,
        recordKind: "incident",
      }),
    ).toBe(
      "OneUptime tried 10 times in 37 minutes to move this run on, and every try failed, so it stopped paging. The last try failed with: Connection terminated unexpectedly. If the incident still needs somebody, page them again.",
    );
  });

  test("a run that waited to page paged nobody", () => {
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: OUT,
        wasWaiting: true,
        recordKind: "alert episode",
      }),
    ).toBe(
      "OneUptime tried 10 times in 37 minutes to start this run, and every try failed, so nobody was paged. The last try failed with: Connection terminated unexpectedly. If the alert episode still needs somebody, page them again.",
    );
  });

  test("a run about no record - a test page - has no one to page again", () => {
    const message: string = getOnCallPolicyRunOutOfTriesMessage({
      failures: OUT,
      wasWaiting: false,
      recordKind: null,
    });

    expect(message).not.toContain("still needs somebody");
    expect(message.endsWith("Connection terminated unexpectedly.")).toBe(true);
  });

  test("an error that ends its own sentence is not given a second full stop", () => {
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: { ...OUT, lastError: "The database is down." },
        wasWaiting: false,
      }),
    ).toContain("The last try failed with: The database is down.");
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: { ...OUT, lastError: "The database is down." },
        wasWaiting: false,
      }),
    ).not.toContain("down..");
  });

  test("an error with no words still makes a sentence", () => {
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: { ...OUT, lastError: "  " },
        wasWaiting: false,
      }),
    ).toContain("The last try failed with: an error with no message.");
  });

  test("tries over less than a minute, or one, say so", () => {
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: { ...OUT, lastFailedAt: OUT.firstFailedAt },
        wasWaiting: false,
      }),
    ).toContain("in less than a minute");
    expect(
      getOnCallPolicyRunOutOfTriesMessage({
        failures: { ...OUT, lastFailedAt: at(1) },
        wasWaiting: false,
      }),
    ).toContain("in 1 minute");
  });

  test("a long error is cut, and the message still fits the run's status message and ends with what to do", () => {
    const message: string = getOnCallPolicyRunOutOfTriesMessage({
      failures: { ...OUT, lastError: "x".repeat(2000) },
      wasWaiting: false,
      recordKind: "incident",
    });

    expect(message.length).toBeLessThanOrEqual(ColumnLength.LongText);
    expect(message).toContain("...");
    expect(
      message.endsWith(
        " If the incident still needs somebody, page them again.",
      ),
    ).toBe(true);
  });

  test("is sentences: a capital first, a full stop last", () => {
    for (const wasWaiting of [false, true]) {
      for (const recordKind of ["incident", null]) {
        expect(
          isErrorSentence(
            getOnCallPolicyRunOutOfTriesMessage({
              failures: OUT,
              wasWaiting,
              recordKind,
            }),
          ),
        ).toBe(true);
      }
    }
  });
});

/*
 * A person's on-call log is tried the same way by the person's-log worker
 * (issue #8408), and says so in its own words when its tries run out.
 */
describe("what a person's on-call log that ran out of tries says", () => {
  const OUT: OnCallPolicyRunFailures = failedAt(
    [0, 1, 3, 7, 12, 17, 22, 27, 32, 37],
    "Query read timeout",
  );

  test("how long it was tried, the last error, and what to do", () => {
    expect(
      getUserOnCallLogOutOfTriesMessage({
        failures: OUT,
        recordKind: "incident",
      }),
    ).toBe(
      "OneUptime tried 10 times in 37 minutes to send this page's notifications, and every try failed, so it stopped. The last try failed with: Query read timeout. If the incident still needs this person, page them again.",
    );
  });

  test("a log about no record - a test page - has no one to page again", () => {
    for (const recordKind of [null, undefined, "", "  "]) {
      const message: string = getUserOnCallLogOutOfTriesMessage({
        failures: OUT,
        recordKind,
      });

      expect(message).not.toContain("still needs this person");
      expect(message.endsWith("Query read timeout.")).toBe(true);
    }
  });

  test("an error that ends its own sentence is not given a second full stop, and one with no words still makes a sentence", () => {
    expect(
      getUserOnCallLogOutOfTriesMessage({
        failures: { ...OUT, lastError: "The database is down." },
      }),
    ).not.toContain("down..");
    expect(
      getUserOnCallLogOutOfTriesMessage({
        failures: { ...OUT, lastError: "" },
      }),
    ).toContain("The last try failed with: an error with no message.");
  });

  test("a long error is cut, and the message still fits the log's status message and ends with what to do", () => {
    const message: string = getUserOnCallLogOutOfTriesMessage({
      failures: { ...OUT, lastError: "y".repeat(5000) },
      recordKind: "alert episode",
    });

    expect(message.length).toBeLessThanOrEqual(ColumnLength.LongText);
    expect(message).toContain("...");
    expect(
      message.endsWith(
        " If the alert episode still needs this person, page them again.",
      ),
    ).toBe(true);
  });

  test("is sentences on one line: a capital first, a full stop last", () => {
    for (const recordKind of ["incident", "alert", null]) {
      const message: string = getUserOnCallLogOutOfTriesMessage({
        failures: { ...OUT, lastError: "Connection\nreset by peer" },
        recordKind,
      });

      expect(isErrorSentence(message)).toBe(true);
      expect(message).not.toContain("\n");
    }
  });
});

describe("a run's status message", () => {
  test("is kept on one line", () => {
    expect(toOnCallPolicyRunStatusMessage("  Connection\n  reset  ")).toBe(
      "Connection reset",
    );
  });

  test("is never longer than its column holds", () => {
    const message: string = toOnCallPolicyRunStatusMessage("y".repeat(900));

    expect(message.length).toBe(ColumnLength.LongText);
    expect(message.endsWith("...")).toBe(true);
    expect(toOnCallPolicyRunStatusMessage("Incident not found")).toBe(
      "Incident not found",
    );
  });
});
