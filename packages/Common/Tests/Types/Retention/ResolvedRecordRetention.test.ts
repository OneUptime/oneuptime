import {
  DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
  DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
  KEEP_EVERY_RESOLVED_RECORD,
  MIN_RESOLVED_RECORD_RETENTION_IN_DAYS,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
  doesResolvedRecordRetentionDeleteMore,
  getResolvedRecordRetentionProblem,
  getResolvedRecordRetentionRefusal,
  isResolvedRecordRetentionInDays,
  isResolvedRecordRetentionOn,
  readResolvedRecordRetentionInDays,
  toResolvedRecordRetentionInDays,
} from "../../../Types/Retention/ResolvedRecordRetention";
import { describe, expect, test } from "@jest/globals";

/*
 * How long a resolved incident or alert stays (issue #6903): the values
 * Project.incidentRetentionInDays and Project.alertRetentionInDays take.
 * ProjectService refuses anything else, the Workers jobs read the setting
 * with these, and the Dashboard offers exactly these choices - so a value
 * one of them takes, the others take too. Every project starts at 0, which
 * deletes nothing: an upgrade must never delete what a project kept.
 */

const KINDS: Array<ResolvedRecordKind> = [
  ResolvedRecordKind.Incident,
  ResolvedRecordKind.Alert,
];

const NOT_A_CHOICE: Array<number> = [
  1, 7, 14, 29, 31, 45, 59, 61, 100, 364, 366, 729, 731, 1094, 1096, 3650, -30,
  -1, 30.5, 90.0001, 1e9,
];

describe("the choices", () => {
  test("run from a month to three years, shortest first", () => {
    expect(RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS).toEqual([
      30, 60, 90, 180, 365, 730, 1095,
    ]);
    expect(MIN_RESOLVED_RECORD_RETENTION_IN_DAYS).toBe(30);
    expect(
      [...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS].sort(
        (a: number, b: number): number => {
          return a - b;
        },
      ),
    ).toEqual([...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS]);
  });

  test("the shortest is longer than the two weeks a status page shows by default", () => {
    expect(MIN_RESOLVED_RECORD_RETENTION_IN_DAYS).toBeGreaterThan(14);
  });

  test("0 is Never, where every project starts, and no choice is 0", () => {
    expect(KEEP_EVERY_RESOLVED_RECORD).toBe(0);
    expect(DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS).toBe(0);
    expect(RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS).not.toContain(0);
    expect(
      isResolvedRecordRetentionOn(DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS),
    ).toBe(false);
  });

  test("incidents with a completed postmortem are kept unless a project says otherwise", () => {
    expect(DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM).toBe(true);
  });

  test("the refusal names every choice and how to keep everything, for incidents and for alerts", () => {
    expect(getResolvedRecordRetentionRefusal(ResolvedRecordKind.Incident)).toBe(
      "Pick how long a resolved incident is kept: 30, 60, 90, 180, 365, 730 or 1095 days, or 0 to keep every incident.",
    );
    expect(getResolvedRecordRetentionRefusal(ResolvedRecordKind.Alert)).toBe(
      "Pick how long a resolved alert is kept: 30, 60, 90, 180, 365, 730 or 1095 days, or 0 to keep every alert.",
    );
  });
});

describe("isResolvedRecordRetentionInDays", () => {
  test.each([...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS, 0])(
    "takes %p",
    (days: number) => {
      expect(isResolvedRecordRetentionInDays(days)).toBe(true);
    },
  );

  test.each(NOT_A_CHOICE)(
    "refuses %p, which is not a choice",
    (days: number) => {
      expect(isResolvedRecordRetentionInDays(days)).toBe(false);
    },
  );

  test.each([
    ["90"],
    [null],
    [undefined],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [true],
    [{}],
    [[90]],
  ])("refuses %p, which is not a number of days", (value: unknown) => {
    expect(isResolvedRecordRetentionInDays(value)).toBe(false);
  });
});

describe("getResolvedRecordRetentionProblem", () => {
  test.each(KINDS)(
    "%s: every choice and 0 have no problem",
    (kind: ResolvedRecordKind) => {
      for (const days of [...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS, 0]) {
        expect(getResolvedRecordRetentionProblem(days, kind)).toBeNull();
      }
    },
  );

  test.each(KINDS)(
    "%s: a choice written as text, as a form or Terraform may send it, has no problem",
    (kind: ResolvedRecordKind) => {
      for (const text of ["90", " 60 ", "0", "1095", "030"]) {
        expect(getResolvedRecordRetentionProblem(text, kind)).toBeNull();
      }
    },
  );

  test.each(KINDS)(
    "%s: anything else is refused with the kind's choices",
    (kind: ResolvedRecordKind) => {
      const refusal: string = getResolvedRecordRetentionRefusal(kind);

      for (const value of [
        ...NOT_A_CHOICE,
        null,
        undefined,
        "",
        " ",
        "never",
        "90 days",
        "1e2",
        "-30",
        "30.0",
        "00030000",
        Number.NaN,
        Number.NEGATIVE_INFINITY,
        true,
        false,
        { days: 90 },
        [90],
      ]) {
        expect({
          value,
          problem: getResolvedRecordRetentionProblem(value, kind),
        }).toEqual({
          value,
          problem: refusal,
        });
      }
    },
  );
});

describe("toResolvedRecordRetentionInDays", () => {
  test("a choice stays itself, and text is read as the number", () => {
    expect(toResolvedRecordRetentionInDays(365)).toBe(365);
    expect(toResolvedRecordRetentionInDays(0)).toBe(0);
    expect(toResolvedRecordRetentionInDays(" 730 ")).toBe(730);
    expect(toResolvedRecordRetentionInDays("30")).toBe(30);
  });

  test("anything else reads as the default, which deletes nothing - never as a shorter length", () => {
    for (const value of [45, -30, "45", "soon", null, undefined, 1.5, {}]) {
      expect(toResolvedRecordRetentionInDays(value)).toBe(
        DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
      );
      expect(
        isResolvedRecordRetentionOn(toResolvedRecordRetentionInDays(value)),
      ).toBe(false);
    }
  });
});

describe("readResolvedRecordRetentionInDays", () => {
  test("reads a choice, 0, or a choice as text - as a response or a row may hold it", () => {
    expect(readResolvedRecordRetentionInDays(90)).toBe(90);
    expect(readResolvedRecordRetentionInDays(0)).toBe(0);
    expect(readResolvedRecordRetentionInDays("180")).toBe(180);
  });

  test("says nothing of a value that is missing or not a choice", () => {
    for (const value of [
      undefined,
      null,
      "",
      45,
      "45",
      -1,
      "abc",
      Number.NaN,
    ]) {
      expect(readResolvedRecordRetentionInDays(value)).toBeUndefined();
    }
  });
});

describe("doesResolvedRecordRetentionDeleteMore: what asks before it is saved", () => {
  const SETTINGS: Array<number> = [
    0,
    ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ];

  test("turning it on from Never deletes more, whatever the length", () => {
    for (const to of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(doesResolvedRecordRetentionDeleteMore({ from: 0, to })).toBe(true);
    }
  });

  test("turning it off deletes nothing", () => {
    for (const from of SETTINGS) {
      expect(doesResolvedRecordRetentionDeleteMore({ from, to: 0 })).toBe(
        false,
      );
    }
  });

  test("a shorter length deletes more, a longer one or the same one does not", () => {
    expect(doesResolvedRecordRetentionDeleteMore({ from: 365, to: 90 })).toBe(
      true,
    );
    expect(doesResolvedRecordRetentionDeleteMore({ from: 60, to: 30 })).toBe(
      true,
    );
    expect(doesResolvedRecordRetentionDeleteMore({ from: 90, to: 365 })).toBe(
      false,
    );
    expect(
      doesResolvedRecordRetentionDeleteMore({ from: 1095, to: 1095 }),
    ).toBe(false);
  });

  test("every move between two settings asks exactly when it deletes something the first kept", () => {
    /*
     * A record resolved d days ago stays under a setting when the setting is
     * Never or d is within it. A move deletes more when some record the
     * first setting keeps, the second does not.
     */
    const keeps: (setting: number, ageInDays: number) => boolean = (
      setting: number,
      ageInDays: number,
    ): boolean => {
      return setting === 0 || ageInDays <= setting;
    };

    for (const from of SETTINGS) {
      for (const to of SETTINGS) {
        let deletesMore: boolean = false;

        for (let age: number = 0; age <= 2000; age++) {
          if (keeps(from, age) && !keeps(to, age)) {
            deletesMore = true;
            break;
          }
        }

        expect({
          from,
          to,
          asks: doesResolvedRecordRetentionDeleteMore({ from, to }),
        }).toEqual({
          from,
          to,
          asks: deletesMore,
        });
      }
    }
  });
});
