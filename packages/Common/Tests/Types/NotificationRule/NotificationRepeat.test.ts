import {
  getDueRepeatNumber,
  getDueRuleExecution,
  getFirstOwedRuleExecution,
  getRepeatClaimKey,
  getRepeatEveryMinutes,
  getRuleExecutionDueAfterMinutes,
  isRepeatEveryMinutes,
  isRuleFullyExecuted,
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "../../../Types/NotificationRule/NotificationRepeat";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * "Repeat until acknowledged": a push rule can send its page again every few
 * minutes, so a responder who slept through the first critical alert hears
 * another rather than a phone that went quiet after one sound.
 *
 * Every decision about WHEN a push goes out is made by the functions in this
 * module, once a minute, by the on-call worker. Both ways of getting them
 * wrong are silent:
 *
 *   - too few pushes: the second alarm that would have woken somebody never
 *     comes, and nothing errors - the first push was "delivered".
 *   - too many: a phone that pages every minute all night, or the same repeat
 *     twice, is how an on-call app ends up muted.
 *
 * So the schedule is pinned here minute by minute - for every interval the
 * page offers and several first-push delays - including a worker that missed
 * minutes, and the values a rule can arrive with that are not intervals.
 */

const RULE_ID: string = "6f1c2b8e-3a4d-4c5e-9f60-718293a4b5c6";
const OTHER_RULE_ID: string = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

// The first-push delays the schedule is checked against.
const NOTIFY_AFTER_MINUTES: Array<number> = [0, 1, 5, 30];

// A rule id as Postgres renders a uuid.
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Values a rule's interval can arrive with that are not one the On-Call Rules
 * page offers: from an API caller, a newer build, or a row read without the
 * column.
 */
const NOT_AN_INTERVAL: Array<[string, unknown]> = [
  ["a number as text", "5"],
  ["0 as text", "0"],
  ["an empty string", ""],
  ["an interval the page does not offer", 4],
  ["20 minutes", 20],
  ["an hour", 60],
  ["a negative interval", -1],
  ["a fraction of a minute", 2.5],
  ["half a minute", 0.5],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["null", null],
  ["undefined", undefined],
  ["true", true],
  ["false", false],
  ["an object", { minutes: 5 }],
  ["an array holding an interval", [5]],
  ["a boxed number", Object(5)],
];

describe("the repeat settings", () => {
  test("offers exactly the intervals the On-Call Rules page lists, shortest first", () => {
    /*
     * Stored on rules and offered by the page; the service refuses anything
     * else. Removing one strands every rule that chose it.
     */
    expect(REPEAT_EVERY_MINUTES_OPTIONS).toEqual([1, 2, 3, 5, 10, 15, 30]);
  });

  test("0 is 'do not repeat', and is not one of the intervals", () => {
    expect(NO_NOTIFICATION_REPEAT).toBe(0);
    expect(REPEAT_EVERY_MINUTES_OPTIONS).not.toContain(NO_NOTIFICATION_REPEAT);
  });

  test("every interval is a whole, positive number of minutes, listed once", () => {
    /*
     * The worker counts whole minutes since the page started, so an interval
     * of a fraction of a minute would never line up with a tick.
     */
    for (const minutes of REPEAT_EVERY_MINUTES_OPTIONS) {
      expect(Number.isInteger(minutes)).toBe(true);
      expect(minutes).toBeGreaterThan(0);
    }

    expect(new Set(REPEAT_EVERY_MINUTES_OPTIONS).size).toBe(
      REPEAT_EVERY_MINUTES_OPTIONS.length,
    );
  });

  test("a page repeats ten times at most, so one nobody acknowledges does not page all night", () => {
    expect(MAX_NOTIFICATION_REPEATS).toBe(10);
  });
});

describe("isRepeatEveryMinutes", () => {
  test.each([[0], [1], [2], [3], [5], [10], [15], [30]])(
    "accepts %s",
    (value: number) => {
      expect(isRepeatEveryMinutes(value)).toBe(true);
    },
  );

  test.each(NOT_AN_INTERVAL)("refuses %s", (_label: string, value: unknown) => {
    /*
     * The write path refuses whatever this refuses, so it has to be exact: a
     * "5" let through would be stored as text the worker reads as "do not
     * repeat", and the responder who asked for a phone that keeps ringing
     * would get one push.
     */
    expect(isRepeatEveryMinutes(value)).toBe(false);
  });
});

describe("getRepeatEveryMinutes", () => {
  test("keeps 'do not repeat' and every offered interval as they are", () => {
    for (const minutes of [
      NO_NOTIFICATION_REPEAT,
      ...REPEAT_EVERY_MINUTES_OPTIONS,
    ]) {
      expect(getRepeatEveryMinutes(minutes)).toBe(minutes);
    }
  });

  test.each(NOT_AN_INTERVAL)(
    "reads %s as 'do not repeat'",
    (_label: string, value: unknown) => {
      /*
       * Repeating is opted into. A value this build does not know must never
       * start paging somebody - least of all every minute.
       */
      expect(getRepeatEveryMinutes(value)).toBe(NO_NOTIFICATION_REPEAT);
    },
  );
});

describe("getDueRepeatNumber", () => {
  for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
    for (const notifyAfterMinutes of NOTIFY_AFTER_MINUTES) {
      describe(`every ${repeatEveryMinutes} min, first push after ${notifyAfterMinutes} min`, () => {
        const due: (minutesSinceStart: number) => number = (
          minutesSinceStart: number,
        ): number => {
          return getDueRepeatNumber({
            minutesSinceStart: minutesSinceStart,
            notifyAfterMinutes: notifyAfterMinutes,
            repeatEveryMinutes: repeatEveryMinutes,
          });
        };

        test("no repeat is due before the first push, nor at it", () => {
          for (let minute: number = 0; minute <= notifyAfterMinutes; minute++) {
            expect(due(minute)).toBe(0);
          }
        });

        test("the first repeat waits one whole interval after the first push", () => {
          expect(due(notifyAfterMinutes + repeatEveryMinutes - 1)).toBe(0);
          expect(due(notifyAfterMinutes + repeatEveryMinutes)).toBe(1);
        });

        test("repeat n is due exactly n intervals after the first push, and stays the latest until n + 1 is", () => {
          for (
            let repeatNumber: number = 1;
            repeatNumber <= MAX_NOTIFICATION_REPEATS;
            repeatNumber++
          ) {
            const dueAt: number =
              notifyAfterMinutes + repeatNumber * repeatEveryMinutes;

            expect(due(dueAt - 1)).toBe(repeatNumber - 1);
            expect(due(dueAt)).toBe(repeatNumber);

            if (repeatNumber < MAX_NOTIFICATION_REPEATS) {
              expect(due(dueAt + repeatEveryMinutes - 1)).toBe(repeatNumber);
            }
          }
        });

        test("never more than the tenth, however long the page runs", () => {
          const tenthDueAt: number =
            notifyAfterMinutes + MAX_NOTIFICATION_REPEATS * repeatEveryMinutes;

          expect(due(tenthDueAt)).toBe(MAX_NOTIFICATION_REPEATS);
          expect(due(tenthDueAt + 1)).toBe(MAX_NOTIFICATION_REPEATS);
          expect(due(tenthDueAt + repeatEveryMinutes)).toBe(
            MAX_NOTIFICATION_REPEATS,
          );
          expect(due(tenthDueAt * 100)).toBe(MAX_NOTIFICATION_REPEATS);
          // A page that has been running for a week.
          expect(due(7 * 24 * 60)).toBe(MAX_NOTIFICATION_REPEATS);
        });

        test("the due repeat never goes back as the minutes go on, and climbs one at a time", () => {
          let previous: number = 0;

          for (
            let minute: number = 0;
            minute <=
            notifyAfterMinutes +
              (MAX_NOTIFICATION_REPEATS + 2) * repeatEveryMinutes;
            minute++
          ) {
            const current: number = due(minute);

            expect(current).toBeGreaterThanOrEqual(previous);
            expect(current - previous).toBeLessThanOrEqual(1);

            previous = current;
          }

          expect(previous).toBe(MAX_NOTIFICATION_REPEATS);
        });
      });
    }
  }

  test.each(NOT_AN_INTERVAL)(
    "a rule whose interval is %s never has a repeat due",
    (_label: string, repeatEveryMinutes: unknown) => {
      for (const minutesSinceStart of [0, 1, 5, 30, 300, 100000]) {
        expect(
          getDueRepeatNumber({
            minutesSinceStart: minutesSinceStart,
            notifyAfterMinutes: 0,
            repeatEveryMinutes: repeatEveryMinutes,
          }),
        ).toBe(0);
      }
    },
  );

  test("a rule that does not repeat never has a repeat due", () => {
    for (const minutesSinceStart of [0, 1, 5, 30, 300, 100000]) {
      expect(
        getDueRepeatNumber({
          minutesSinceStart: minutesSinceStart,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
        }),
      ).toBe(0);
    }
  });

  test.each([
    ["a negative age - a page whose start is in this worker's future", -1],
    ["a large negative age", -100000],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])(
    "an age of %s has no repeat due, rather than some arbitrary one",
    (_label: string, minutesSinceStart: number) => {
      /*
       * Clocks between workers and the database drift. A page read as not
       * started yet, or an age that is not a number at all, must not send
       * anything - least of all the tenth repeat.
       */
      for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
        expect(
          getDueRepeatNumber({
            minutesSinceStart: minutesSinceStart,
            notifyAfterMinutes: 0,
            repeatEveryMinutes: repeatEveryMinutes,
          }),
        ).toBe(0);
      }
    },
  );

  test("a part of a minute counts only once it is whole", () => {
    expect(
      getDueRepeatNumber({
        minutesSinceStart: 4.99,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ).toBe(0);
    expect(
      getDueRepeatNumber({
        minutesSinceStart: 5.5,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ).toBe(1);
  });

  test("a delay that is not a number counts from the page's start", () => {
    // A rule read without its delay pages at once, as the worker treats it.
    expect(
      getDueRepeatNumber({
        minutesSinceStart: 10,
        notifyAfterMinutes: NaN,
        repeatEveryMinutes: 5,
      }),
    ).toBe(2);
  });
});

describe("getRepeatClaimKey", () => {
  test("is the rule id, ':repeat:' and the repeat's number", () => {
    /*
     * The format is persisted: on-call logs in flight hold these keys in
     * executedNotificationRules. A changed format would read every repeat
     * already sent as not sent, and send it again.
     */
    expect(getRepeatClaimKey(RULE_ID, 1)).toBe(`${RULE_ID}:repeat:1`);
    expect(getRepeatClaimKey(RULE_ID, 10)).toBe(`${RULE_ID}:repeat:10`);
  });

  test("is never a rule id, so a repeat can never be read as some rule's first push", () => {
    for (
      let repeatNumber: number = 1;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      const key: string = getRepeatClaimKey(RULE_ID, repeatNumber);

      expect(key).not.toBe(RULE_ID);
      expect(UUID_PATTERN.test(key)).toBe(false);
    }

    // The ids themselves are uuids, which is what makes the two disjoint.
    expect(UUID_PATTERN.test(RULE_ID)).toBe(true);
  });

  test("is different for every repeat of a rule", () => {
    const keys: Array<string> = [];

    for (
      let repeatNumber: number = 1;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      keys.push(getRepeatClaimKey(RULE_ID, repeatNumber));
    }

    expect(new Set(keys).size).toBe(MAX_NOTIFICATION_REPEATS);
  });

  test("never collides with another rule's repeats on the same log", () => {
    const keys: Set<string> = new Set<string>();

    for (const ruleId of [RULE_ID, OTHER_RULE_ID]) {
      keys.add(ruleId);

      for (
        let repeatNumber: number = 1;
        repeatNumber <= MAX_NOTIFICATION_REPEATS;
        repeatNumber++
      ) {
        keys.add(getRepeatClaimKey(ruleId, repeatNumber));
      }
    }

    // Two first pushes and twenty repeats, all distinct.
    expect(keys.size).toBe(2 * (MAX_NOTIFICATION_REPEATS + 1));
  });
});

describe("isRuleFullyExecuted", () => {
  const ALL_REPEATS: Array<string> = [];

  for (
    let repeatNumber: number = 1;
    repeatNumber <= MAX_NOTIFICATION_REPEATS;
    repeatNumber++
  ) {
    ALL_REPEATS.push(getRepeatClaimKey(RULE_ID, repeatNumber));
  }

  const table: Array<[string, Array<string>, unknown, boolean]> = [
    ["nothing sent, no repeat", [], NO_NOTIFICATION_REPEAT, false],
    ["nothing sent, repeating", [], 5, false],
    ["first push sent, no repeat", [RULE_ID], NO_NOTIFICATION_REPEAT, true],
    ["first push sent, read without the column", [RULE_ID], undefined, true],
    [
      "first push sent, an interval this build does not know",
      [RULE_ID],
      7,
      true,
    ],
    ["first push sent, repeating", [RULE_ID], 5, false],
    [
      "first push and nine repeats sent",
      [RULE_ID, ...ALL_REPEATS.slice(0, 9)],
      5,
      false,
    ],
    ["first push and all ten repeats sent", [RULE_ID, ...ALL_REPEATS], 5, true],
    [
      "first push and the tenth repeat only - a worker that was down",
      [RULE_ID, getRepeatClaimKey(RULE_ID, MAX_NOTIFICATION_REPEATS)],
      1,
      true,
    ],
    ["every repeat but not the first push", [...ALL_REPEATS], 5, false],
    [
      "another rule's first push and repeats",
      [
        OTHER_RULE_ID,
        getRepeatClaimKey(OTHER_RULE_ID, MAX_NOTIFICATION_REPEATS),
      ],
      5,
      false,
    ],
  ];

  test.each(table)(
    "%s",
    (
      _label: string,
      executedClaimKeys: Array<string>,
      repeatEveryMinutes: unknown,
      expected: boolean,
    ) => {
      expect(
        isRuleFullyExecuted({
          executedClaimKeys: executedClaimKeys,
          ruleId: RULE_ID,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      ).toBe(expected);
    },
  );

  test("a rule that does not repeat is done with its first push, as every rule was before", () => {
    /*
     * The regression that matters most: a rule that never asked to repeat
     * must leave the log exactly when it did before the option existed.
     */
    for (const repeatEveryMinutes of [
      NO_NOTIFICATION_REPEAT,
      undefined,
      null,
    ]) {
      expect(
        isRuleFullyExecuted({
          executedClaimKeys: [RULE_ID],
          ruleId: RULE_ID,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      ).toBe(true);
    }
  });

  test("a repeating rule is not done until its tenth repeat, whatever the interval", () => {
    for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
      expect(
        isRuleFullyExecuted({
          executedClaimKeys: [RULE_ID, ...ALL_REPEATS.slice(0, 9)],
          ruleId: RULE_ID,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      ).toBe(false);
      expect(
        isRuleFullyExecuted({
          executedClaimKeys: [RULE_ID, ...ALL_REPEATS],
          ruleId: RULE_ID,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      ).toBe(true);
    }
  });
});

describe("getDueRuleExecution", () => {
  function dueAt(data: {
    executedClaimKeys: Array<string>;
    notifyAfterMinutes: number;
    repeatEveryMinutes: unknown;
    minutesSinceStart: number;
  }): number | null {
    return getDueRuleExecution({
      executedClaimKeys: data.executedClaimKeys,
      ruleId: RULE_ID,
      notifyAfterMinutes: data.notifyAfterMinutes,
      repeatEveryMinutes: data.repeatEveryMinutes,
      minutesSinceStart: data.minutesSinceStart,
    });
  }

  test("the first push waits for the rule's delay, then is due (0) until it is claimed", () => {
    for (const repeatEveryMinutes of [NO_NOTIFICATION_REPEAT, 1, 5, 30]) {
      expect(
        dueAt({
          executedClaimKeys: [],
          notifyAfterMinutes: 10,
          repeatEveryMinutes: repeatEveryMinutes,
          minutesSinceStart: 9,
        }),
      ).toBeNull();

      for (const minutesSinceStart of [10, 11, 60, 600]) {
        expect(
          dueAt({
            executedClaimKeys: [],
            notifyAfterMinutes: 10,
            repeatEveryMinutes: repeatEveryMinutes,
            minutesSinceStart: minutesSinceStart,
          }),
        ).toBe(0);
      }
    }
  });

  test("a repeat never goes out before the first push, however many are due", () => {
    /*
     * A worker that starts late on a page, or a first push whose claim was
     * lost to an error: by the clock the fourth repeat is due, but the
     * responder has not had the first push yet - so the first push it is.
     */
    expect(
      dueAt({
        executedClaimKeys: [],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: 20,
      }),
    ).toBe(0);

    // Even when (somehow) repeats are already on the log.
    expect(
      dueAt({
        executedClaimKeys: [getRepeatClaimKey(RULE_ID, 1)],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: 20,
      }),
    ).toBe(0);
  });

  test("once the first push is claimed a rule that does not repeat has nothing more to send", () => {
    for (const repeatEveryMinutes of [NO_NOTIFICATION_REPEAT, undefined, 7]) {
      for (const minutesSinceStart of [0, 5, 60, 6000]) {
        expect(
          dueAt({
            executedClaimKeys: [RULE_ID],
            notifyAfterMinutes: 0,
            repeatEveryMinutes: repeatEveryMinutes,
            minutesSinceStart: minutesSinceStart,
          }),
        ).toBeNull();
      }
    }
  });

  test("after the first push: nothing until an interval passes, then repeat 1 until it is claimed", () => {
    const sentFirst: Array<string> = [RULE_ID];

    expect(
      dueAt({
        executedClaimKeys: sentFirst,
        notifyAfterMinutes: 3,
        repeatEveryMinutes: 5,
        minutesSinceStart: 7,
      }),
    ).toBeNull();
    expect(
      dueAt({
        executedClaimKeys: sentFirst,
        notifyAfterMinutes: 3,
        repeatEveryMinutes: 5,
        minutesSinceStart: 8,
      }),
    ).toBe(1);
    expect(
      dueAt({
        executedClaimKeys: [...sentFirst, getRepeatClaimKey(RULE_ID, 1)],
        notifyAfterMinutes: 3,
        repeatEveryMinutes: 5,
        minutesSinceStart: 8,
      }),
    ).toBeNull();
    expect(
      dueAt({
        executedClaimKeys: [...sentFirst, getRepeatClaimKey(RULE_ID, 1)],
        notifyAfterMinutes: 3,
        repeatEveryMinutes: 5,
        minutesSinceStart: 12,
      }),
    ).toBeNull();
    expect(
      dueAt({
        executedClaimKeys: [...sentFirst, getRepeatClaimKey(RULE_ID, 1)],
        notifyAfterMinutes: 3,
        repeatEveryMinutes: 5,
        minutesSinceStart: 13,
      }),
    ).toBe(2);
  });

  test("a repeat already claimed - by this worker or another - is not due again", () => {
    expect(
      dueAt({
        executedClaimKeys: [RULE_ID, getRepeatClaimKey(RULE_ID, 4)],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: 22,
      }),
    ).toBeNull();
  });

  test("a worker that missed minutes is due the latest repeat, not the earliest one it missed", () => {
    expect(
      dueAt({
        executedClaimKeys: [RULE_ID, getRepeatClaimKey(RULE_ID, 1)],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: 31,
      }),
    ).toBe(6);
  });

  test("after the tenth repeat nothing is ever due again", () => {
    const allSent: Array<string> = [RULE_ID];

    for (
      let repeatNumber: number = 1;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      allSent.push(getRepeatClaimKey(RULE_ID, repeatNumber));
    }

    for (const minutesSinceStart of [50, 51, 55, 500, 50000]) {
      expect(
        dueAt({
          executedClaimKeys: allSent,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 5,
          minutesSinceStart: minutesSinceStart,
        }),
      ).toBeNull();
    }
  });

  test("an age that is not a number sends nothing at all", () => {
    expect(
      dueAt({
        executedClaimKeys: [],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: NaN,
      }),
    ).toBeNull();
    expect(
      dueAt({
        executedClaimKeys: [RULE_ID],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: NaN,
      }),
    ).toBeNull();
  });

  test("a delay that is not a number pages at once, as a rule with no delay", () => {
    expect(
      dueAt({
        executedClaimKeys: [],
        notifyAfterMinutes: NaN,
        repeatEveryMinutes: 5,
        minutesSinceStart: 0,
      }),
    ).toBe(0);
  });

  test("another rule's claims say nothing about this rule", () => {
    expect(
      dueAt({
        executedClaimKeys: [
          OTHER_RULE_ID,
          getRepeatClaimKey(OTHER_RULE_ID, 1),
          getRepeatClaimKey(OTHER_RULE_ID, 2),
        ],
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
        minutesSinceStart: 10,
      }),
    ).toBe(0);
  });
});

/*
 * The on-call worker, played minute by minute against one rule on one log.
 * Each tick does what ExecutePendingExecutions does: skip a rule with nothing
 * left to send, ask what is due, and claim it on the log - a key already
 * there sends nothing, as the log's atomic claim refuses it.
 */
interface Delivery {
  minute: number;
  // 0 for the first push, n for repeat n.
  repeatNumber: number;
  claimKey: string;
}

interface Walk {
  deliveries: Array<Delivery>;
  // Keys the schedule proposed that the log had already claimed.
  refusedClaims: Array<string>;
  // The first minute the worker found the rule with nothing left to send.
  fullyExecutedAt: number | null;
  claimedKeys: Array<string>;
}

function walk(data: {
  notifyAfterMinutes: number;
  repeatEveryMinutes: unknown;
  // The minutes at which the worker ran, in order.
  minutes: Array<number>;
}): Walk {
  const claimedKeys: Array<string> = [];
  const deliveries: Array<Delivery> = [];
  const refusedClaims: Array<string> = [];
  let fullyExecutedAt: number | null = null;

  for (const minute of data.minutes) {
    const isFullyExecuted: boolean = isRuleFullyExecuted({
      executedClaimKeys: claimedKeys,
      ruleId: RULE_ID,
      repeatEveryMinutes: data.repeatEveryMinutes,
    });

    if (isFullyExecuted) {
      if (fullyExecutedAt === null) {
        fullyExecutedAt = minute;
      }

      continue;
    }

    const due: number | null = getDueRuleExecution({
      executedClaimKeys: claimedKeys,
      ruleId: RULE_ID,
      notifyAfterMinutes: data.notifyAfterMinutes,
      repeatEveryMinutes: data.repeatEveryMinutes,
      minutesSinceStart: minute,
    });

    if (due === null) {
      continue;
    }

    const claimKey: string =
      due === 0 ? RULE_ID : getRepeatClaimKey(RULE_ID, due);

    if (claimedKeys.includes(claimKey)) {
      refusedClaims.push(claimKey);
      continue;
    }

    claimedKeys.push(claimKey);
    deliveries.push({
      minute: minute,
      repeatNumber: due,
      claimKey: claimKey,
    });
  }

  return {
    deliveries: deliveries,
    refusedClaims: refusedClaims,
    fullyExecutedAt: fullyExecutedAt,
    claimedKeys: claimedKeys,
  };
}

function minutesFrom(first: number, last: number): Array<number> {
  const minutes: Array<number> = [];

  for (let minute: number = first; minute <= last; minute++) {
    minutes.push(minute);
  }

  return minutes;
}

// [minute, repeatNumber] of each delivery, the way the expectations are written.
function schedule(deliveries: Array<Delivery>): Array<[number, number]> {
  return deliveries.map((delivery: Delivery): [number, number] => {
    return [delivery.minute, delivery.repeatNumber];
  });
}

describe("a page walked minute by minute, with the worker running every minute", () => {
  for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
    for (const notifyAfterMinutes of NOTIFY_AFTER_MINUTES) {
      test(`every ${repeatEveryMinutes} min, first push after ${notifyAfterMinutes} min`, () => {
        const result: Walk = walk({
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
          minutes: minutesFrom(0, 400),
        });

        // The first push at its delay, then repeat n at n intervals after it.
        const expected: Array<[number, number]> = [[notifyAfterMinutes, 0]];

        for (
          let repeatNumber: number = 1;
          repeatNumber <= MAX_NOTIFICATION_REPEATS;
          repeatNumber++
        ) {
          expected.push([
            notifyAfterMinutes + repeatNumber * repeatEveryMinutes,
            repeatNumber,
          ]);
        }

        expect(schedule(result.deliveries)).toEqual(expected);

        // One first push and ten repeats - never more.
        expect(result.deliveries).toHaveLength(MAX_NOTIFICATION_REPEATS + 1);

        // Every delivery under a key of its own, and none ever proposed twice.
        expect(new Set(result.claimedKeys).size).toBe(
          result.claimedKeys.length,
        );
        expect(result.refusedClaims).toEqual([]);

        // Done the first tick after the tenth repeat, and for good.
        const tenthAt: number =
          notifyAfterMinutes + MAX_NOTIFICATION_REPEATS * repeatEveryMinutes;

        expect(result.fullyExecutedAt).toBe(tenthAt + 1);

        for (const minute of [tenthAt + 1, tenthAt + 60, 400, 100000]) {
          expect(
            getDueRuleExecution({
              executedClaimKeys: result.claimedKeys,
              ruleId: RULE_ID,
              notifyAfterMinutes: notifyAfterMinutes,
              repeatEveryMinutes: repeatEveryMinutes,
              minutesSinceStart: minute,
            }),
          ).toBeNull();
        }
      });
    }
  }

  test.each([
    ["does not repeat", NO_NOTIFICATION_REPEAT],
    ["was read without the column", undefined],
    ["has an interval this build does not know", 7],
  ])(
    "a rule that %s sends its first push once, and is then done",
    (_label: string, repeatEveryMinutes: unknown) => {
      const result: Walk = walk({
        notifyAfterMinutes: 5,
        repeatEveryMinutes: repeatEveryMinutes,
        minutes: minutesFrom(0, 400),
      });

      expect(schedule(result.deliveries)).toEqual([[5, 0]]);
      expect(result.fullyExecutedAt).toBe(6);
    },
  );

  test("however long the page runs, it never sends more than eleven pushes", () => {
    for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
      const result: Walk = walk({
        notifyAfterMinutes: 0,
        repeatEveryMinutes: repeatEveryMinutes,
        // A week.
        minutes: minutesFrom(0, 7 * 24 * 60),
      });

      expect(result.deliveries).toHaveLength(MAX_NOTIFICATION_REPEATS + 1);
      expect(result.refusedClaims).toEqual([]);
    }
  });
});

describe("a page walked while the worker was down for a while", () => {
  // Up for minutes 0 to 2, down until 37, up from then on.
  const OUTAGE: Array<number> = [...minutesFrom(0, 2), ...minutesFrom(37, 400)];

  test("every 5 min from the start: the latest repeat due when it is back, never the ones it missed", () => {
    const result: Walk = walk({
      notifyAfterMinutes: 0,
      repeatEveryMinutes: 5,
      minutes: OUTAGE,
    });

    /*
     * Repeats 1 to 6 fell due while the worker was down. Back at minute 37 it
     * sends repeat 7 - the one due now - and carries on with the schedule. It
     * never goes back for the six it missed: six pushes in one minute would
     * be one alarm with a stutter, not six chances to wake up.
     */
    expect(schedule(result.deliveries)).toEqual([
      [0, 0],
      [37, 7],
      [40, 8],
      [45, 9],
      [50, 10],
    ]);
    expect(result.fullyExecutedAt).toBe(51);
  });

  test.each([
    // [interval, the schedule it sends]
    [
      1,
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [37, 10],
      ],
    ],
    [
      2,
      [
        [0, 0],
        [2, 1],
        [37, 10],
      ],
    ],
    [
      3,
      [
        [0, 0],
        [37, 10],
      ],
    ],
    [
      10,
      [
        [0, 0],
        [37, 3],
        [40, 4],
        [50, 5],
        [60, 6],
        [70, 7],
        [80, 8],
        [90, 9],
        [100, 10],
      ],
    ],
    [
      15,
      [
        [0, 0],
        [37, 2],
        [45, 3],
        [60, 4],
        [75, 5],
        [90, 6],
        [105, 7],
        [120, 8],
        [135, 9],
        [150, 10],
      ],
    ],
    [
      30,
      [
        [0, 0],
        [37, 1],
        [60, 2],
        [90, 3],
        [120, 4],
        [150, 5],
        [180, 6],
        [210, 7],
        [240, 8],
        [270, 9],
        [300, 10],
      ],
    ],
  ])(
    "every %s min: never back-fills, and the page still ends on time",
    (repeatEveryMinutes: number, expected: Array<Array<number>>) => {
      const result: Walk = walk({
        notifyAfterMinutes: 0,
        repeatEveryMinutes: repeatEveryMinutes,
        minutes: OUTAGE,
      });

      expect(schedule(result.deliveries)).toEqual(expected);

      // Each repeat number at most once, climbing.
      const numbers: Array<number> = result.deliveries.map(
        (delivery: Delivery): number => {
          return delivery.repeatNumber;
        },
      );

      expect(
        [...numbers].sort((a: number, b: number): number => {
          return a - b;
        }),
      ).toEqual(numbers);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(result.refusedClaims).toEqual([]);
    },
  );

  test("a first push that went out late is followed by the latest repeat due by the page's own clock", () => {
    /*
     * The schedule counts from when the page started, not from the first
     * push: the first push was due at minute 5 and went out at 37, when the
     * worker came back. By the page's clock repeat 6 is due at 38, so that is
     * what the next tick sends - and the page still ends at minute 55, when
     * the responder was told it would, rather than every repeat moving back
     * by the length of the outage.
     */
    const result: Walk = walk({
      notifyAfterMinutes: 5,
      repeatEveryMinutes: 5,
      minutes: OUTAGE,
    });

    expect(schedule(result.deliveries)).toEqual([
      [37, 0],
      [38, 6],
      [40, 7],
      [45, 8],
      [50, 9],
      [55, 10],
    ]);
  });

  test("a worker down past the tenth repeat sends the first push, then only the tenth", () => {
    const result: Walk = walk({
      notifyAfterMinutes: 0,
      repeatEveryMinutes: 2,
      minutes: [...minutesFrom(100, 110)],
    });

    expect(schedule(result.deliveries)).toEqual([
      [100, 0],
      [101, 10],
    ]);
    expect(result.fullyExecutedAt).toBe(102);
  });
});

describe("a page walked with a worker that keeps missing minutes", () => {
  /*
   * A sweep over pages and outage patterns drawn from a seeded stream (the
   * same on every run): whatever minutes the worker happens to run at, what
   * reaches the responder keeps the rules below.
   */
  const random: SeededRandom = seededRandom(5309);

  for (let scenario: number = 0; scenario < 200; scenario++) {
    const repeatEveryMinutes: number = REPEAT_EVERY_MINUTES_OPTIONS[
      random(REPEAT_EVERY_MINUTES_OPTIONS.length)
    ] as number;
    const notifyAfterMinutes: number = random(40);
    // How often the worker misses a minute: never, now and then, or mostly.
    const missChance: number = [0, 0.2, 0.8][random(3)] as number;
    const minutes: Array<number> = [];

    for (let minute: number = 0; minute <= 400; minute++) {
      // Now and then a long outage, on top of the odd missed minute.
      if (random() < 0.01) {
        minute += random(60);
        continue;
      }

      if (random() >= missChance) {
        minutes.push(minute);
      }
    }

    test(`scenario ${scenario}: every ${repeatEveryMinutes} min after ${notifyAfterMinutes} min, ${minutes.length} ticks`, () => {
      const result: Walk = walk({
        notifyAfterMinutes: notifyAfterMinutes,
        repeatEveryMinutes: repeatEveryMinutes,
        minutes: minutes,
      });

      // Never more than eleven pushes, each claimed once.
      expect(result.deliveries.length).toBeLessThanOrEqual(
        MAX_NOTIFICATION_REPEATS + 1,
      );
      expect(new Set(result.claimedKeys).size).toBe(result.claimedKeys.length);
      expect(result.refusedClaims).toEqual([]);

      const firstTickAtOrAfterDelay: number | undefined = minutes.find(
        (minute: number): boolean => {
          return minute >= notifyAfterMinutes;
        },
      );

      if (firstTickAtOrAfterDelay === undefined) {
        // The worker never ran once the push was due: nothing was sent.
        expect(result.deliveries).toEqual([]);
        return;
      }

      // The first push first, at the first tick it was due.
      expect(result.deliveries[0]).toEqual({
        minute: firstTickAtOrAfterDelay,
        repeatNumber: 0,
        claimKey: RULE_ID,
      });

      let previousRepeat: number = 0;

      for (const delivery of result.deliveries.slice(1)) {
        // Never early, and always the latest due by the page's clock.
        expect(delivery.minute).toBeGreaterThanOrEqual(
          notifyAfterMinutes + delivery.repeatNumber * repeatEveryMinutes,
        );
        expect(delivery.repeatNumber).toBe(
          getDueRepeatNumber({
            minutesSinceStart: delivery.minute,
            notifyAfterMinutes: notifyAfterMinutes,
            repeatEveryMinutes: repeatEveryMinutes,
          }),
        );
        // Climbing: never a repeat older than one already sent.
        expect(delivery.repeatNumber).toBeGreaterThan(previousRepeat);

        previousRepeat = delivery.repeatNumber;
      }

      /*
       * Never behind after a tick: once the first push is out, every tick
       * leaves the responder with the latest repeat due by then.
       */
      for (const minute of minutes) {
        if (minute <= firstTickAtOrAfterDelay) {
          continue;
        }

        const sentByThen: Array<Delivery> = result.deliveries.filter(
          (delivery: Delivery): boolean => {
            return delivery.minute <= minute;
          },
        );
        const latestSent: number =
          sentByThen[sentByThen.length - 1]?.repeatNumber || 0;

        expect(latestSent).toBe(
          getDueRepeatNumber({
            minutesSinceStart: minute,
            notifyAfterMinutes: notifyAfterMinutes,
            repeatEveryMinutes: repeatEveryMinutes,
          }),
        );
      }

      // A worker that ran after the tenth repeat was due has sent it, and is done.
      const lastTick: number = minutes[minutes.length - 1] as number;
      const tenthDueAt: number =
        notifyAfterMinutes + MAX_NOTIFICATION_REPEATS * repeatEveryMinutes;

      if (lastTick > tenthDueAt && lastTick > firstTickAtOrAfterDelay) {
        expect(previousRepeat).toBe(MAX_NOTIFICATION_REPEATS);
        expect(
          isRuleFullyExecuted({
            executedClaimKeys: result.claimedKeys,
            ruleId: RULE_ID,
            repeatEveryMinutes: repeatEveryMinutes,
          }),
        ).toBe(true);
      }
    });
  }
});

/*
 * WHEN EACH DELIVERY WAS DUE, for how late it went out
 * (notification.send.lag, OnCallSendLag, issue #6646).
 *
 * A delivery is timed from the first whole minute its rule's schedule made
 * it due - and a repeat a worker that fell behind sends in place of those
 * it skipped, from the first one it skipped: the person went without a
 * push from then. Both ways of getting it wrong are silent as well: a
 * moment too early charges the platform with the rule's own wait, one too
 * late hides a worker that fell behind.
 */
const PART_MINUTE_DELAYS: Array<number> = [0, 0.5, 1, 2.5, 5, 7.25, 30, 59.9];

function repeatClaimsBelow(executionNumber: number): Array<string> {
  if (executionNumber === 0) {
    return [];
  }

  const claims: Array<string> = [RULE_ID];

  for (let repeat: number = 1; repeat < executionNumber; repeat++) {
    claims.push(getRepeatClaimKey(RULE_ID, repeat));
  }

  return claims;
}

describe("getRuleExecutionDueAfterMinutes", () => {
  test("the first push is due after the rule's delay, whatever its interval", () => {
    const intervals: Array<unknown> = [
      NO_NOTIFICATION_REPEAT,
      ...REPEAT_EVERY_MINUTES_OPTIONS,
      ...NOT_AN_INTERVAL.map((entry: [string, unknown]): unknown => {
        return entry[1];
      }),
    ];

    for (const notifyAfterMinutes of NOTIFY_AFTER_MINUTES) {
      for (const repeatEveryMinutes of intervals) {
        expect(
          getRuleExecutionDueAfterMinutes({
            notifyAfterMinutes: notifyAfterMinutes,
            repeatEveryMinutes: repeatEveryMinutes,
            executionNumber: 0,
          }),
        ).toBe(notifyAfterMinutes);
      }
    }
  });

  test("repeat n is due n whole intervals after the first push, up to the tenth", () => {
    for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
      for (const notifyAfterMinutes of NOTIFY_AFTER_MINUTES) {
        for (
          let repeat: number = 1;
          repeat <= MAX_NOTIFICATION_REPEATS;
          repeat++
        ) {
          expect(
            getRuleExecutionDueAfterMinutes({
              notifyAfterMinutes: notifyAfterMinutes,
              repeatEveryMinutes: repeatEveryMinutes,
              executionNumber: repeat,
            }),
          ).toBe(notifyAfterMinutes + repeat * repeatEveryMinutes);
        }
      }
    }
  });

  test.each(NOT_AN_INTERVAL)(
    "an interval that is not one (%s) repeats nothing: every number is due with the first push",
    (_name: string, repeatEveryMinutes: unknown) => {
      for (
        let executionNumber: number = 0;
        executionNumber <= MAX_NOTIFICATION_REPEATS;
        executionNumber++
      ) {
        expect(
          getRuleExecutionDueAfterMinutes({
            notifyAfterMinutes: 5,
            repeatEveryMinutes: repeatEveryMinutes,
            executionNumber: executionNumber,
          }),
        ).toBe(5);
      }
    },
  );

  test("the first whole minute the worker finds it due, and not the minute before - for whole and part-minute delays", () => {
    for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
      for (const notifyAfterMinutes of PART_MINUTE_DELAYS) {
        for (
          let executionNumber: number = 0;
          executionNumber <= MAX_NOTIFICATION_REPEATS;
          executionNumber++
        ) {
          const dueAfterMinutes: number = getRuleExecutionDueAfterMinutes({
            notifyAfterMinutes: notifyAfterMinutes,
            repeatEveryMinutes: repeatEveryMinutes,
            executionNumber: executionNumber,
          });
          const asTheWorkerAsks: (
            minutesSinceStart: number,
          ) => number | null = (minutesSinceStart: number): number | null => {
            return getDueRuleExecution({
              executedClaimKeys: repeatClaimsBelow(executionNumber),
              ruleId: RULE_ID,
              notifyAfterMinutes: notifyAfterMinutes,
              repeatEveryMinutes: repeatEveryMinutes,
              minutesSinceStart: minutesSinceStart,
            });
          };

          expect(Number.isInteger(dueAfterMinutes)).toBe(true);
          expect(asTheWorkerAsks(dueAfterMinutes)).toBe(executionNumber);

          if (dueAfterMinutes > 0) {
            expect(asTheWorkerAsks(dueAfterMinutes - 1)).toBeNull();
          }
        }
      }
    }
  });

  test("a part of a minute rounds up: a delay of 2.5 minutes is due at the third", () => {
    expect(
      getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: 2.5,
        repeatEveryMinutes: 5,
        executionNumber: 0,
      }),
    ).toBe(3);
    expect(
      getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: 2.5,
        repeatEveryMinutes: 5,
        executionNumber: 1,
      }),
    ).toBe(8);
  });

  test("a delay below 0 counts from the log's start: due at once, never before it", () => {
    expect(
      getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: -5,
        repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
        executionNumber: 0,
      }),
    ).toBe(0);
    expect(
      getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: -5,
        repeatEveryMinutes: 5,
        executionNumber: 1,
      }),
    ).toBe(0);
    expect(
      getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: -5,
        repeatEveryMinutes: 5,
        executionNumber: 2,
      }),
    ).toBe(5);

    // As the worker: the first push goes at the log's first minute.
    expect(
      getDueRuleExecution({
        executedClaimKeys: [],
        ruleId: RULE_ID,
        notifyAfterMinutes: -5,
        repeatEveryMinutes: 5,
        minutesSinceStart: 0,
      }),
    ).toBe(0);
  });

  test.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])(
    "a delay of %s counts as none: never a moment that is not one",
    (_name: string, notifyAfterMinutes: number) => {
      for (
        let executionNumber: number = 0;
        executionNumber <= MAX_NOTIFICATION_REPEATS;
        executionNumber++
      ) {
        expect(
          getRuleExecutionDueAfterMinutes({
            notifyAfterMinutes: notifyAfterMinutes,
            repeatEveryMinutes: 5,
            executionNumber: executionNumber,
          }),
        ).toBe(executionNumber * 5);
      }
    },
  );

  test.each([
    ["a negative number", -1, 0],
    ["NaN", NaN, 0],
    ["Infinity", Infinity, 0],
    ["-Infinity", -Infinity, 0],
    ["half a repeat", 0.5, 0],
    ["a part repeat", 2.7, 2],
    [
      "one past the tenth",
      MAX_NOTIFICATION_REPEATS + 1,
      MAX_NOTIFICATION_REPEATS,
    ],
    ["far past the tenth", 1000000, MAX_NOTIFICATION_REPEATS],
  ])(
    "an execution number of %s (%d) counts as repeat %d: a whole repeat, never past the tenth",
    (_name: string, executionNumber: number, asRepeat: number) => {
      expect(
        getRuleExecutionDueAfterMinutes({
          notifyAfterMinutes: 5,
          repeatEveryMinutes: 5,
          executionNumber: executionNumber,
        }),
      ).toBe(5 + asRepeat * 5);
    },
  );
});

describe("getFirstOwedRuleExecution", () => {
  function owed(
    executedClaimKeys: Array<string>,
    executionNumber: number,
  ): number {
    return getFirstOwedRuleExecution({
      executedClaimKeys: executedClaimKeys,
      ruleId: RULE_ID,
      executionNumber: executionNumber,
    });
  }

  test("a first push stands for itself, claimed or not", () => {
    expect(owed([], 0)).toBe(0);
    expect(owed([RULE_ID], 0)).toBe(0);
  });

  test("repeat 1 stands for itself", () => {
    expect(owed([RULE_ID], 1)).toBe(1);
    expect(owed([], 1)).toBe(1);
  });

  test("a repeat right after the last one sent stands for itself, for every repeat", () => {
    for (let repeat: number = 1; repeat <= MAX_NOTIFICATION_REPEATS; repeat++) {
      expect(owed(repeatClaimsBelow(repeat), repeat)).toBe(repeat);
    }
  });

  test("a repeat sent after the worker skipped some is owed since the first it skipped", () => {
    expect(
      owed(
        [RULE_ID, getRepeatClaimKey(RULE_ID, 1), getRepeatClaimKey(RULE_ID, 2)],
        8,
      ),
    ).toBe(3);
  });

  test("with no repeat sent yet, any repeat is owed since repeat 1", () => {
    for (let repeat: number = 1; repeat <= MAX_NOTIFICATION_REPEATS; repeat++) {
      expect(owed([RULE_ID], repeat)).toBe(1);
    }
  });

  test("only the latest repeat sent below it counts, wherever the gaps", () => {
    expect(
      owed(
        [RULE_ID, getRepeatClaimKey(RULE_ID, 1), getRepeatClaimKey(RULE_ID, 4)],
        7,
      ),
    ).toBe(5);
  });

  test("another rule's claims say nothing about this rule", () => {
    expect(
      owed(
        [
          RULE_ID,
          OTHER_RULE_ID,
          getRepeatClaimKey(OTHER_RULE_ID, 1),
          getRepeatClaimKey(OTHER_RULE_ID, 5),
        ],
        6,
      ),
    ).toBe(1);
  });

  test("claims at or above the repeat say nothing about when it was owed", () => {
    expect(owed([RULE_ID, getRepeatClaimKey(RULE_ID, 5)], 5)).toBe(1);
    expect(owed([RULE_ID, getRepeatClaimKey(RULE_ID, 9)], 5)).toBe(1);
  });

  test.each([
    ["a negative number", -3],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["half a repeat", 0.5],
  ])(
    "an execution number of %s is a first push - and answers at once",
    (_name: string, executionNumber: number) => {
      expect(owed([RULE_ID], executionNumber)).toBe(0);
    },
  );

  test("an execution number past the tenth counts as the tenth", () => {
    expect(owed(repeatClaimsBelow(MAX_NOTIFICATION_REPEATS), 1000000)).toBe(
      MAX_NOTIFICATION_REPEATS,
    );
  });
});

/*
 * The walks above, each delivery timed from when it was due: the claims on
 * the log before it went out tell which delivery it stands in for.
 */
interface TimedDelivery {
  delivery: Delivery;
  dueAfterMinutes: number;
}

function timed(data: {
  notifyAfterMinutes: number;
  repeatEveryMinutes: unknown;
  deliveries: Array<Delivery>;
}): Array<TimedDelivery> {
  const claimedSoFar: Array<string> = [];

  return data.deliveries.map((delivery: Delivery): TimedDelivery => {
    const owedExecution: number = getFirstOwedRuleExecution({
      executedClaimKeys: claimedSoFar,
      ruleId: RULE_ID,
      executionNumber: delivery.repeatNumber,
    });

    claimedSoFar.push(delivery.claimKey);

    return {
      delivery: delivery,
      dueAfterMinutes: getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: data.notifyAfterMinutes,
        repeatEveryMinutes: data.repeatEveryMinutes,
        executionNumber: owedExecution,
      }),
    };
  });
}

// [minute sent, repeat number, minute due] of each delivery.
function sentAndDue(
  deliveries: Array<TimedDelivery>,
): Array<[number, number, number]> {
  return deliveries.map((entry: TimedDelivery): [number, number, number] => {
    return [
      entry.delivery.minute,
      entry.delivery.repeatNumber,
      entry.dueAfterMinutes,
    ];
  });
}

describe("each delivery of a walk, timed from when it was due", () => {
  test("a worker that runs every minute sends each delivery the minute it is due: no lag at all", () => {
    for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
      for (const notifyAfterMinutes of [...NOTIFY_AFTER_MINUTES, 0.5, 2.5]) {
        const result: Walk = walk({
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
          minutes: minutesFrom(0, 400),
        });

        expect(result.deliveries).toHaveLength(MAX_NOTIFICATION_REPEATS + 1);

        for (const entry of timed({
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
          deliveries: result.deliveries,
        })) {
          expect(entry.delivery.minute).toBe(entry.dueAfterMinutes);
        }
      }
    }
  });

  test("a rule that does not repeat: its one push, timed from its delay", () => {
    const result: Walk = walk({
      notifyAfterMinutes: 10,
      repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
      minutes: [0, 5, 12, 13],
    });

    expect(
      sentAndDue(
        timed({
          notifyAfterMinutes: 10,
          repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
          deliveries: result.deliveries,
        }),
      ),
    ).toEqual([[12, 0, 10]]);
  });

  test("every 5 min from the start, the worker down from minute 12 to 40: the repeat it sends at 40 is owed since repeat 3, at 15", () => {
    const result: Walk = walk({
      notifyAfterMinutes: 0,
      repeatEveryMinutes: 5,
      minutes: [...minutesFrom(0, 12), ...minutesFrom(40, 100)],
    });

    expect(
      sentAndDue(
        timed({
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 5,
          deliveries: result.deliveries,
        }),
      ),
    ).toEqual([
      [0, 0, 0],
      [5, 1, 5],
      [10, 2, 10],
      [40, 8, 15],
      [45, 9, 45],
      [50, 10, 50],
    ]);
  });

  test("a first push that went out late: it is 100 minutes late, and the repeat after it is owed since repeat 1", () => {
    const result: Walk = walk({
      notifyAfterMinutes: 0,
      repeatEveryMinutes: 5,
      minutes: minutesFrom(100, 130),
    });

    expect(
      sentAndDue(
        timed({
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 5,
          deliveries: result.deliveries,
        }),
      ),
    ).toEqual([
      [100, 0, 0],
      [101, 10, 5],
    ]);
  });

  describe("a worker that keeps missing minutes", () => {
    const random: SeededRandom = seededRandom(6646);

    for (let scenario: number = 0; scenario < 150; scenario++) {
      const repeatEveryMinutes: number = REPEAT_EVERY_MINUTES_OPTIONS[
        random(REPEAT_EVERY_MINUTES_OPTIONS.length)
      ] as number;
      const notifyAfterMinutes: number = random(40);
      const missChance: number = [0, 0.2, 0.8][random(3)] as number;
      const minutes: Array<number> = [];

      for (let minute: number = 0; minute <= 400; minute++) {
        if (random() < 0.01) {
          minute += random(60);
          continue;
        }

        if (random() >= missChance) {
          minutes.push(minute);
        }
      }

      test(`scenario ${scenario}: every ${repeatEveryMinutes} min after ${notifyAfterMinutes} min, ${minutes.length} ticks`, () => {
        const result: Walk = walk({
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
          minutes: minutes,
        });
        const deliveryMinutes: Array<number> = result.deliveries.map(
          (delivery: Delivery): number => {
            return delivery.minute;
          },
        );
        let previousDueAfter: number = -1;
        // The latest repeat sent so far: 0 before any.
        let latestRepeatSent: number = 0;

        for (const entry of timed({
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
          deliveries: result.deliveries,
        })) {
          // Never sent before it was due: a lag is never below 0.
          expect(entry.dueAfterMinutes).toBeLessThanOrEqual(
            entry.delivery.minute,
          );

          /*
           * Due at the first minute the person was owed a push they did
           * not have, read off the worker's own clock: the first push once
           * its delay is up, a repeat once a repeat later than the latest
           * sent is due.
           */
          let firstOwedMinute: number = 0;

          while (
            entry.delivery.repeatNumber === 0
              ? firstOwedMinute < notifyAfterMinutes
              : getDueRepeatNumber({
                  minutesSinceStart: firstOwedMinute,
                  notifyAfterMinutes: notifyAfterMinutes,
                  repeatEveryMinutes: repeatEveryMinutes,
                }) <= latestRepeatSent
          ) {
            firstOwedMinute++;
          }

          expect(entry.dueAfterMinutes).toBe(firstOwedMinute);
          latestRepeatSent = Math.max(
            latestRepeatSent,
            entry.delivery.repeatNumber,
          );

          // Each owed later than the one before.
          expect(entry.dueAfterMinutes).toBeGreaterThan(previousDueAfter);
          previousDueAfter = entry.dueAfterMinutes;

          /*
           * The lag is the worker's alone: every tick from when it was due
           * until it went out sent another delivery of the rule (its first
           * push, before any repeat) - the worker never sat on one it owed.
           */
          for (const minute of minutes) {
            if (
              minute >= entry.dueAfterMinutes &&
              minute < entry.delivery.minute
            ) {
              expect(deliveryMinutes).toContain(minute);
            }
          }
        }
      });
    }
  });
});
