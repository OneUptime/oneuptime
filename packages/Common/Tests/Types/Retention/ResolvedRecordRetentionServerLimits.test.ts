import {
  KEEP_EVERY_RESOLVED_RECORD,
  MAX_KEPT_POSTMORTEM_STATUSES,
  NO_RESOLVED_RECORD_RETENTION_SERVER_LIMITS,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
  doesResolvedRecordRetentionDeleteMore,
  doesResolvedRecordRetentionMaximumDeleteMore,
  getEffectiveResolvedRecordRetentionInDays,
  getKeptPostmortemStatusIdsProblem,
  getResolvedRecordRetentionDefaultProblem,
  getResolvedRecordRetentionMaximumProblem,
  isResolvedRecordRetentionWithinMaximum,
  readKeptPostmortemStatusIds,
  readResolvedRecordRetentionDefaultInDays,
  readResolvedRecordRetentionMaximumInDays,
  readResolvedRecordRetentionServerLimits,
  toResolvedRecordRetentionServerValue,
} from "../../../Types/Retention/ResolvedRecordRetention";
import { describe, expect, test } from "@jest/globals";

/*
 * The server's limits on how long projects keep resolved incidents and
 * alerts (issue #6941), and the postmortem statuses that keep an incident
 * (issue #6945), as every reader takes them: the purge, the routes, the
 * Data Retention cards and the Admin Dashboard. What is pinned is what keeps
 * an upgrade, a typo or an unreadable value from deleting what a project
 * kept: every server starts with no maximum and new projects at Never, a
 * value that cannot be read is no maximum, and a project's Never under a
 * maximum is the maximum - never longer, never shorter.
 */

const SETTINGS: Array<number> = [
  KEEP_EVERY_RESOLVED_RECORD,
  ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
];

const MAXIMA: Array<number | undefined> = [
  undefined,
  ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
];

const KINDS: Array<ResolvedRecordKind> = [
  ResolvedRecordKind.Incident,
  ResolvedRecordKind.Alert,
];

const NOT_A_CHOICE: Array<unknown> = [
  1,
  7,
  29,
  31,
  45,
  364,
  366,
  1096,
  -30,
  30.5,
  "45",
  "ninety",
  true,
  {},
  [],
  Number.NaN,
  Number.POSITIVE_INFINITY,
];

const STATUS_A: string = "6945a000-0000-4000-8000-000000000001";
const STATUS_B: string = "6945b000-0000-4000-8000-000000000002";

describe("where every server starts", () => {
  test("no maximum, and new projects at Never - an upgrade deletes nothing", () => {
    expect(NO_RESOLVED_RECORD_RETENTION_SERVER_LIMITS).toEqual({
      maximumInDays: undefined,
      defaultInDays: KEEP_EVERY_RESOLVED_RECORD,
    });
    expect(
      readResolvedRecordRetentionServerLimits({
        maximumInDays: null,
        defaultInDays: null,
      }),
    ).toEqual(NO_RESOLVED_RECORD_RETENTION_SERVER_LIMITS);
  });
});

describe("readResolvedRecordRetentionMaximumInDays", () => {
  test("reads each choice, as a number or as text", () => {
    for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(readResolvedRecordRetentionMaximumInDays(days)).toBe(days);
      expect(readResolvedRecordRetentionMaximumInDays(String(days))).toBe(days);
    }
  });

  test("empty, 0 and anything that is not a choice is no maximum - never a shorter one", () => {
    for (const value of [null, undefined, 0, "0", "", ...NOT_A_CHOICE]) {
      expect(readResolvedRecordRetentionMaximumInDays(value)).toBeUndefined();
    }
  });
});

describe("readResolvedRecordRetentionDefaultInDays", () => {
  test("reads each choice, and anything else as Never", () => {
    for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(readResolvedRecordRetentionDefaultInDays(days)).toBe(days);
    }

    for (const value of [null, undefined, 0, ...NOT_A_CHOICE]) {
      expect(readResolvedRecordRetentionDefaultInDays(value)).toBe(
        KEEP_EVERY_RESOLVED_RECORD,
      );
    }
  });
});

describe("getEffectiveResolvedRecordRetentionInDays: how long a project keeps them", () => {
  test("with no maximum, a project keeps what it picked", () => {
    for (const days of SETTINGS) {
      expect(
        getEffectiveResolvedRecordRetentionInDays({
          projectRetentionInDays: days,
        }),
      ).toBe(days);
    }
  });

  test("Never under a maximum is the maximum", () => {
    for (const maximum of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(
        getEffectiveResolvedRecordRetentionInDays({
          projectRetentionInDays: KEEP_EVERY_RESOLVED_RECORD,
          maximumInDays: maximum,
        }),
      ).toBe(maximum);
    }
  });

  test("a longer length is held to the maximum, a shorter one stays its own", () => {
    expect(
      getEffectiveResolvedRecordRetentionInDays({
        projectRetentionInDays: 1095,
        maximumInDays: 365,
      }),
    ).toBe(365);
    expect(
      getEffectiveResolvedRecordRetentionInDays({
        projectRetentionInDays: 90,
        maximumInDays: 365,
      }),
    ).toBe(90);
    expect(
      getEffectiveResolvedRecordRetentionInDays({
        projectRetentionInDays: 365,
        maximumInDays: 365,
      }),
    ).toBe(365);
  });

  test("never longer than the maximum nor than the project's own length, for every pair", () => {
    for (const days of SETTINGS) {
      for (const maximum of MAXIMA) {
        const effective: number = getEffectiveResolvedRecordRetentionInDays({
          projectRetentionInDays: days,
          maximumInDays: maximum,
        });

        if (maximum !== undefined) {
          expect(effective).toBeLessThanOrEqual(maximum);
          expect(effective).not.toBe(KEEP_EVERY_RESOLVED_RECORD);
        }

        if (days !== KEEP_EVERY_RESOLVED_RECORD) {
          expect(effective).toBeLessThanOrEqual(days);
        }
      }
    }
  });
});

describe("isResolvedRecordRetentionWithinMaximum: what the card leaves open", () => {
  test("every pick is open with no maximum", () => {
    for (const days of SETTINGS) {
      expect(
        isResolvedRecordRetentionWithinMaximum({ retentionInDays: days }),
      ).toBe(true);
    }
  });

  test("under a maximum, the lengths up to it are open, and Never and longer are locked", () => {
    expect(
      isResolvedRecordRetentionWithinMaximum({
        retentionInDays: KEEP_EVERY_RESOLVED_RECORD,
        maximumInDays: 365,
      }),
    ).toBe(false);
    expect(
      isResolvedRecordRetentionWithinMaximum({
        retentionInDays: 730,
        maximumInDays: 365,
      }),
    ).toBe(false);
    expect(
      isResolvedRecordRetentionWithinMaximum({
        retentionInDays: 365,
        maximumInDays: 365,
      }),
    ).toBe(true);
    expect(
      isResolvedRecordRetentionWithinMaximum({
        retentionInDays: 30,
        maximumInDays: 365,
      }),
    ).toBe(true);
  });

  test("an open pick is always kept for exactly as long as it says", () => {
    for (const days of SETTINGS) {
      for (const maximum of MAXIMA) {
        if (
          isResolvedRecordRetentionWithinMaximum({
            retentionInDays: days,
            maximumInDays: maximum,
          })
        ) {
          expect(
            getEffectiveResolvedRecordRetentionInDays({
              projectRetentionInDays: days,
              maximumInDays: maximum,
            }),
          ).toBe(days);
        }
      }
    }
  });
});

describe("getResolvedRecordRetentionMaximumProblem", () => {
  test.each(KINDS)("%s: each choice, and empty, is a maximum", (kind) => {
    for (const value of [
      null,
      undefined,
      0,
      "0",
      "",
      "  ",
      ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
    ]) {
      expect(getResolvedRecordRetentionMaximumProblem(value, kind)).toBeNull();
    }
  });

  test.each(KINDS)(
    "%s: anything else is refused with the choices and how to say none",
    (kind) => {
      for (const value of NOT_A_CHOICE) {
        const problem: string | null = getResolvedRecordRetentionMaximumProblem(
          value,
          kind,
        );

        expect(problem).toBe(
          `Pick the longest a project keeps a resolved ${kind === ResolvedRecordKind.Incident ? "incident" : "alert"}: 30, 60, 90, 180, 365, 730 or 1095 days, or leave it empty for no maximum.`,
        );
      }
    },
  );
});

describe("getResolvedRecordRetentionDefaultProblem", () => {
  test.each(KINDS)("%s: each choice, and empty, is a default", (kind) => {
    for (const value of [
      null,
      undefined,
      0,
      "",
      ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
    ]) {
      expect(
        getResolvedRecordRetentionDefaultProblem({ value, kind }),
      ).toBeNull();
    }
  });

  test("anything that is not a choice is refused", () => {
    for (const value of NOT_A_CHOICE) {
      expect(
        getResolvedRecordRetentionDefaultProblem({
          value,
          kind: ResolvedRecordKind.Alert,
        }),
      ).toBe(
        "Pick how long a new project keeps a resolved alert: 30, 60, 90, 180, 365, 730 or 1095 days, or leave it empty for Never.",
      );
    }
  });

  test("a default longer than the maximum is refused; up to it, and Never, are not", () => {
    expect(
      getResolvedRecordRetentionDefaultProblem({
        value: 730,
        kind: ResolvedRecordKind.Incident,
        maximumInDays: 365,
      }),
    ).toBe(
      "A new project can keep a resolved incident for at most 365 days, the server's maximum. Pick that or less.",
    );

    for (const value of [null, 0, 30, 365]) {
      expect(
        getResolvedRecordRetentionDefaultProblem({
          value,
          kind: ResolvedRecordKind.Incident,
          maximumInDays: 365,
        }),
      ).toBeNull();
    }
  });
});

describe("toResolvedRecordRetentionServerValue", () => {
  test("a choice is stored as its number, and empty or 0 as null", () => {
    expect(toResolvedRecordRetentionServerValue(90)).toBe(90);
    expect(toResolvedRecordRetentionServerValue("365")).toBe(365);

    for (const value of [null, undefined, 0, "0", ...NOT_A_CHOICE]) {
      expect(toResolvedRecordRetentionServerValue(value)).toBeNull();
    }
  });
});

describe("doesResolvedRecordRetentionMaximumDeleteMore: what the Admin Dashboard asks before", () => {
  test("setting one deletes more, lowering it deletes more, raising or removing it does not", () => {
    expect(
      doesResolvedRecordRetentionMaximumDeleteMore({ to: 365 }),
    ).toBe(true);
    expect(
      doesResolvedRecordRetentionMaximumDeleteMore({ from: 365, to: 90 }),
    ).toBe(true);
    expect(
      doesResolvedRecordRetentionMaximumDeleteMore({ from: 90, to: 365 }),
    ).toBe(false);
    expect(
      doesResolvedRecordRetentionMaximumDeleteMore({ from: 365, to: 365 }),
    ).toBe(false);
    expect(doesResolvedRecordRetentionMaximumDeleteMore({ from: 365 })).toBe(
      false,
    );
    expect(doesResolvedRecordRetentionMaximumDeleteMore({})).toBe(false);
  });

  test("asks exactly when some project's effective length gets shorter", () => {
    for (const from of MAXIMA) {
      for (const to of MAXIMA) {
        const shortensSome: boolean = SETTINGS.some((days: number) => {
          return doesResolvedRecordRetentionDeleteMore({
            from: getEffectiveResolvedRecordRetentionInDays({
              projectRetentionInDays: days,
              maximumInDays: from,
            }),
            to: getEffectiveResolvedRecordRetentionInDays({
              projectRetentionInDays: days,
              maximumInDays: to,
            }),
          });
        });

        expect({
          from,
          to,
          asks: doesResolvedRecordRetentionMaximumDeleteMore({ from, to }),
        }).toEqual({ from, to, asks: shortensSome });
      }
    }
  });
});

describe("readKeptPostmortemStatusIds", () => {
  test("reads a list of ids lower case, each once, in the order given", () => {
    expect(
      readKeptPostmortemStatusIds([
        STATUS_B.toUpperCase(),
        ` ${STATUS_A} `,
        STATUS_B,
      ]),
    ).toEqual([STATUS_B, STATUS_A]);
  });

  test("an empty list, or anything that is not one, is none - the Completed status", () => {
    for (const value of [
      null,
      undefined,
      [],
      ["not-an-id"],
      [42],
      STATUS_A,
      { [STATUS_A]: true },
    ]) {
      expect(readKeptPostmortemStatusIds(value)).toBeUndefined();
    }
  });

  test("leaves out what is not an id, keeping the rest", () => {
    expect(readKeptPostmortemStatusIds([STATUS_A, "x", null, 3])).toEqual([
      STATUS_A,
    ]);
  });
});

describe("getKeptPostmortemStatusIdsProblem", () => {
  test("empty (null) is the Completed status, and a list of ids is a choice", () => {
    expect(getKeptPostmortemStatusIdsProblem(null)).toBeNull();
    expect(getKeptPostmortemStatusIdsProblem(undefined)).toBeNull();
    expect(getKeptPostmortemStatusIdsProblem([STATUS_A])).toBeNull();
    expect(
      getKeptPostmortemStatusIdsProblem([STATUS_A, STATUS_B.toUpperCase()]),
    ).toBeNull();
  });

  test("an empty list is refused: turn the switch off instead", () => {
    expect(getKeptPostmortemStatusIdsProblem([])).toBe(
      "Pick at least one postmortem status that keeps an incident, or turn off keeping incidents with a completed postmortem.",
    );
  });

  test("what is not a list of ids is refused", () => {
    expect(getKeptPostmortemStatusIdsProblem(STATUS_A)).toBe(
      "Pick the postmortem statuses that keep an incident as a list of their ids, or leave it empty for the Completed status.",
    );
    expect(getKeptPostmortemStatusIdsProblem([STATUS_A, "Completed"])).toBe(
      "Each postmortem status that keeps an incident is named by its id.",
    );
    expect(getKeptPostmortemStatusIdsProblem([7])).toBe(
      "Each postmortem status that keeps an incident is named by its id.",
    );
  });

  test(`at most ${MAX_KEPT_POSTMORTEM_STATUSES} statuses`, () => {
    const ids: Array<string> = Array.from(
      { length: MAX_KEPT_POSTMORTEM_STATUSES + 1 },
      (_: unknown, index: number): string => {
        return `6945c000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      },
    );

    expect(
      getKeptPostmortemStatusIdsProblem(
        ids.slice(0, MAX_KEPT_POSTMORTEM_STATUSES),
      ),
    ).toBeNull();
    expect(getKeptPostmortemStatusIdsProblem(ids)).toBe(
      `Pick at most ${MAX_KEPT_POSTMORTEM_STATUSES} postmortem statuses that keep an incident.`,
    );
  });
});
