import NextNumberUtil, {
  NUMBERED_RECORD_KINDS,
  NextNumberProblem,
  NumberedRecordKind,
  NumberedRecordKindInfo,
} from "../../../Utils/Project/NextNumber";
import {
  NUMBER_PREFIX_COLUMNS,
  NumberPrefixColumnInfo,
} from "../../../Utils/Project/NumberPrefix";
import Project from "../../../Models/DatabaseModels/Project";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * NextNumberUtil is the one definition of a next number: the number a
 * project's next incident, alert, episode or scheduled maintenance event
 * gets, and what may be chosen for it. ProjectService takes numbers by
 * getNextNumber's rule (in SQL) and stores what normalize() returns; the
 * dashboard's Next Number card shows getNextNumber() and refuses what
 * getProblem() refuses. If they drifted, the card would promise a number
 * the server never gives, or accept one the server then refuses.
 */

const KINDS: Array<NumberedRecordKindInfo> = [...NUMBERED_RECORD_KINDS];

// The TypeORM @Column options of a Project column: what the database holds.
function databaseColumnOf(propertyName: string): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs): boolean => {
      return candidate.target === Project;
    })
    .find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === propertyName;
    });

  if (!args) {
    throw new Error(`Project.${propertyName} has no TypeORM @Column metadata`);
  }

  return args;
}

describe("the kinds of numbered record", () => {
  test("are the five kinds a project numbers, each once", () => {
    expect(
      KINDS.map((info: NumberedRecordKindInfo): NumberedRecordKind => {
        return info.kind;
      }),
    ).toEqual([
      NumberedRecordKind.Incident,
      NumberedRecordKind.IncidentEpisode,
      NumberedRecordKind.Alert,
      NumberedRecordKind.AlertEpisode,
      NumberedRecordKind.ScheduledMaintenance,
    ]);
    expect(Object.values(NumberedRecordKind).sort()).toEqual(
      KINDS.map((info: NumberedRecordKindInfo): string => {
        return info.kind;
      }).sort(),
    );
  });

  test("each kind's prefix is one of the number prefixes, and every prefix has its kind", () => {
    expect(
      KINDS.map((info: NumberedRecordKindInfo): string => {
        return info.prefixColumn;
      }).sort(),
    ).toEqual(
      NUMBER_PREFIX_COLUMNS.map((info: NumberPrefixColumnInfo): string => {
        return info.column;
      }).sort(),
    );
  });

  test.each(KINDS)(
    "$kind: its counter, start and prefix are Project columns",
    (info: NumberedRecordKindInfo) => {
      const project: Project = new Project();

      for (const column of [
        info.counterColumn,
        info.startsAtColumn,
        info.prefixColumn,
      ]) {
        expect([column, project.isTableColumn(column)]).toEqual([column, true]);
      }
    },
  );

  test.each(KINDS)(
    "$kind: the start is an integer column, empty unless chosen, titled as the API names it",
    (info: NumberedRecordKindInfo) => {
      const project: Project = new Project();

      expect(project.getTableColumnMetadata(info.startsAtColumn).type).toBe(
        TableColumnType.Number,
      );
      expect(project.getTableColumnMetadata(info.startsAtColumn).title).toBe(
        info.title,
      );
      expect(
        project.getTableColumnMetadata(info.startsAtColumn).required,
      ).toBeFalsy();

      const column: ColumnMetadataArgs = databaseColumnOf(info.startsAtColumn);

      expect(column.options.type).toBe(ColumnType.Number);
      expect(column.options.nullable).toBe(true);
      expect(column.options.default).toBeUndefined();
    },
  );

  /*
   * Where numbers start is a setting beside the prefix, in the same place:
   * whoever may read or change a prefix may read or change it, and no one
   * else. Its counter stays no caller's to read or write.
   */
  test.each(KINDS)(
    "$kind: who may read, set and change the start is who may for the prefix",
    (info: NumberedRecordKindInfo) => {
      const project: Project = new Project();

      expect(project.getColumnAccessControlFor(info.startsAtColumn)).toEqual(
        project.getColumnAccessControlFor(info.prefixColumn),
      );
      expect(project.getColumnAccessControlFor(info.counterColumn)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    },
  );

  test("the API's titles say what each start is for", () => {
    expect(
      KINDS.map((info: NumberedRecordKindInfo): [string, string] => {
        return [info.title, info.recordName];
      }),
    ).toEqual([
      ["Incident Numbers Start At", "incident"],
      ["Incident Episode Numbers Start At", "incident episode"],
      ["Alert Numbers Start At", "alert"],
      ["Alert Episode Numbers Start At", "alert episode"],
      ["Scheduled Maintenance Numbers Start At", "scheduled maintenance event"],
    ]);
  });

  test("getKindInfo finds each kind, and refuses one that is not a kind", () => {
    for (const info of KINDS) {
      expect(NextNumberUtil.getKindInfo(info.kind)).toBe(info);
    }

    expect(() => {
      NextNumberUtil.getKindInfo("Monitor" as NumberedRecordKind);
    }).toThrow(BadDataException);
  });
});

describe("NextNumberUtil.getNextNumber - the number the next record gets", () => {
  test("is the one after the highest given out", () => {
    expect(
      NextNumberUtil.getNextNumber({ highestNumber: 41, numbersStartAt: null }),
    ).toBe(42);
    expect(
      NextNumberUtil.getNextNumber({
        highestNumber: 2345,
        numbersStartAt: undefined,
      }),
    ).toBe(2346);
  });

  test("is 1 in a project that has given out none", () => {
    expect(
      NextNumberUtil.getNextNumber({ highestNumber: 0, numbersStartAt: null }),
    ).toBe(1);
    expect(
      NextNumberUtil.getNextNumber({
        highestNumber: null,
        numbersStartAt: null,
      }),
    ).toBe(1);
  });

  test("is the start the project chose while no record has reached it", () => {
    expect(
      NextNumberUtil.getNextNumber({
        highestNumber: 2345,
        numbersStartAt: 10000,
      }),
    ).toBe(10000);
    expect(
      NextNumberUtil.getNextNumber({ highestNumber: 0, numbersStartAt: 1000 }),
    ).toBe(1000);
  });

  test("a start the records have reached changes nothing", () => {
    // INC-10000 was given out, so the next is INC-10001.
    expect(
      NextNumberUtil.getNextNumber({
        highestNumber: 10000,
        numbersStartAt: 10000,
      }),
    ).toBe(10001);
    expect(
      NextNumberUtil.getNextNumber({
        highestNumber: 10050,
        numbersStartAt: 10000,
      }),
    ).toBe(10051);
  });

  test("the start right after the highest is the same as none", () => {
    expect(
      NextNumberUtil.getNextNumber({
        highestNumber: 2345,
        numbersStartAt: 2346,
      }),
    ).toBe(2346);
  });
});

describe("NextNumberUtil.getProblem - what a next number may be", () => {
  test.each([1, 2, 42, 1000, 2346, 999_999_999, 1_000_000_000])(
    "accepts %p",
    (value: number) => {
      expect(NextNumberUtil.getProblem(value)).toBeNull();
    },
  );

  test.each(["1", "1000", " 2346 ", "0010", "1000000000"])(
    "accepts %j typed as text",
    (value: string) => {
      expect(NextNumberUtil.getProblem(value)).toBeNull();
    },
  );

  test.each([
    1.5,
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1.5",
    "1e3",
    "abc",
    "12abc",
    "",
    "   ",
    "+5",
    "1,000",
    "1 000",
    "٣",
    null,
    undefined,
    true,
    {},
    [],
  ])("refuses %p: not a whole number", (value: unknown) => {
    expect(NextNumberUtil.getProblem(value)).toBe(
      NextNumberProblem.NotWholeNumber,
    );
  });

  test.each([0, -1, -2346, "0", "-1", " -40 "])(
    "refuses %p: numbers start at 1",
    (value: unknown) => {
      expect(NextNumberUtil.getProblem(value)).toBe(NextNumberProblem.BelowOne);
    },
  );

  test.each([1_000_000_001, 2_147_483_647, 1e20, "1000000001", "99999999999"])(
    "refuses %p: higher than 1,000,000,000",
    (value: unknown) => {
      expect(NextNumberUtil.MAX).toBe(1_000_000_000);
      expect(NextNumberUtil.getProblem(value)).toBe(NextNumberProblem.TooLarge);
    },
  );

  test("the most a project may choose leaves room in the integer columns", () => {
    // Postgres integer: 2,147,483,647.
    expect(NextNumberUtil.MAX * 2).toBeLessThan(2_147_483_647);
  });

  test("refuses a number at or below the highest given out", () => {
    expect(NextNumberUtil.getProblem(2345, 2345)).toBe(
      NextNumberProblem.NotAboveHighest,
    );
    expect(NextNumberUtil.getProblem(100, 2345)).toBe(
      NextNumberProblem.NotAboveHighest,
    );
    expect(NextNumberUtil.getProblem("2345", 2345)).toBe(
      NextNumberProblem.NotAboveHighest,
    );
  });

  test("accepts a number above the highest given out", () => {
    expect(NextNumberUtil.getProblem(2346, 2345)).toBeNull();
    expect(NextNumberUtil.getProblem(10000, 2345)).toBeNull();
    expect(NextNumberUtil.getProblem("10000", 2345)).toBeNull();
  });

  test("with nothing given out, any number from 1 will do", () => {
    expect(NextNumberUtil.getProblem(1, 0)).toBeNull();
    expect(NextNumberUtil.getProblem(1, null)).toBeNull();
    expect(NextNumberUtil.getProblem(1, undefined)).toBeNull();
  });

  test("checks the number itself before the highest given out", () => {
    expect(NextNumberUtil.getProblem("abc", 10)).toBe(
      NextNumberProblem.NotWholeNumber,
    );
    expect(NextNumberUtil.getProblem(0, 10)).toBe(NextNumberProblem.BelowOne);
    expect(NextNumberUtil.getProblem(2_000_000_000, 10)).toBe(
      NextNumberProblem.TooLarge,
    );
  });

  test("reads a long typed text in time that grows with it", () => {
    const longText: string = "1".repeat(400_000) + "x";
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(NextNumberUtil.getProblem(longText)).toBe(
          NextNumberProblem.NotWholeNumber,
        );
        expect(NextNumberUtil.getProblem("-".repeat(400_000))).toBe(
          NextNumberProblem.NotWholeNumber,
        );
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("NextNumberUtil.getProblemMessage", () => {
  test("says what to type, in words a person reads", () => {
    expect(
      NextNumberUtil.getProblemMessage(NextNumberProblem.NotWholeNumber),
    ).toBe("Use a whole number, like 1000.");
    expect(NextNumberUtil.getProblemMessage(NextNumberProblem.BelowOne)).toBe(
      "Use a number of 1 or more.",
    );
    expect(NextNumberUtil.getProblemMessage(NextNumberProblem.TooLarge)).toBe(
      "Use a number no higher than 1,000,000,000.",
    );
    expect(
      NextNumberUtil.getProblemMessage(NextNumberProblem.NotAboveHighest),
    ).toBe("Use a number higher than {{highestNumber}}.");
  });

  test("every problem has its message", () => {
    for (const problem of Object.values(NextNumberProblem)) {
      expect(NextNumberUtil.getProblemMessage(problem).length).toBeGreaterThan(
        0,
      );
    }
  });

  test("the highest number fills the template as a plain number, as numbers are shown", () => {
    expect(NextNumberUtil.getProblemValues(2345)).toEqual({
      highestNumber: "2345",
    });
    expect(NextNumberUtil.getProblemValues(null)).toEqual({
      highestNumber: "0",
    });
  });
});

describe("NextNumberUtil.parse", () => {
  test("reads a number as it is, and text that is a whole number", () => {
    expect(NextNumberUtil.parse(1000)).toBe(1000);
    expect(NextNumberUtil.parse("1000")).toBe(1000);
    expect(NextNumberUtil.parse(" 42 ")).toBe(42);
    expect(NextNumberUtil.parse("-3")).toBe(-3);
  });

  test("reads anything else as NaN", () => {
    for (const value of ["1e3", "1.5", "", "x", null, undefined, true]) {
      expect(NextNumberUtil.parse(value)).toBeNaN();
    }
  });
});

describe("NextNumberUtil.toStoredNumber - a counter or start as a row holds it", () => {
  test("reads an integer, or an integer as text", () => {
    expect(NextNumberUtil.toStoredNumber(2345)).toBe(2345);
    expect(NextNumberUtil.toStoredNumber("2345")).toBe(2345);
    expect(NextNumberUtil.toStoredNumber(0)).toBe(0);
  });

  test("reads nothing, or anything that is not an integer, as null", () => {
    for (const value of [null, undefined, "", "abc", 1.5, Number.NaN, {}]) {
      expect(NextNumberUtil.toStoredNumber(value)).toBeNull();
    }
  });
});

describe("NextNumberUtil.normalize - the start the API stores", () => {
  const title: string = "Incident Numbers Start At";

  test("stores a whole number from 1 to 1,000,000,000 as a number", () => {
    expect(NextNumberUtil.normalize(10000, title)).toBe(10000);
    expect(NextNumberUtil.normalize("10000", title)).toBe(10000);
    expect(NextNumberUtil.normalize(" 2346 ", title)).toBe(2346);
    expect(NextNumberUtil.normalize(1, title)).toBe(1);
    expect(NextNumberUtil.normalize(1_000_000_000, title)).toBe(1_000_000_000);
  });

  test("stores null for nothing chosen: null, or blank text", () => {
    expect(NextNumberUtil.normalize(null, title)).toBeNull();
    expect(NextNumberUtil.normalize(undefined, title)).toBeNull();
    expect(NextNumberUtil.normalize("", title)).toBeNull();
    expect(NextNumberUtil.normalize("   ", title)).toBeNull();
  });

  test.each([
    [1.5, "Incident Numbers Start At must be a whole number, like 1000."],
    ["1e3", "Incident Numbers Start At must be a whole number, like 1000."],
    ["abc", "Incident Numbers Start At must be a whole number, like 1000."],
    [0, "Incident Numbers Start At must be 1 or more."],
    [-5, "Incident Numbers Start At must be 1 or more."],
    ["-5", "Incident Numbers Start At must be 1 or more."],
    [
      1_000_000_001,
      "Incident Numbers Start At must be no higher than 1,000,000,000.",
    ],
    [true, "Incident Numbers Start At must be a whole number."],
    [{ value: 5 }, "Incident Numbers Start At must be a whole number."],
    [[5], "Incident Numbers Start At must be a whole number."],
  ])("refuses %p, naming the column", (value: unknown, message: string) => {
    let error: unknown = null;

    try {
      NextNumberUtil.normalize(value, title);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(message);
  });
});

describe("NextNumberUtil.getNotAboveHighestError - the API's refusal", () => {
  test.each([
    [
      NumberedRecordKind.Incident,
      2345,
      "Incident Numbers Start At must be higher than 2345, the highest incident number used so far. A number is never used twice.",
    ],
    [
      NumberedRecordKind.AlertEpisode,
      7,
      "Alert Episode Numbers Start At must be higher than 7, the highest alert episode number used so far. A number is never used twice.",
    ],
    [
      NumberedRecordKind.ScheduledMaintenance,
      12,
      "Scheduled Maintenance Numbers Start At must be higher than 12, the highest scheduled maintenance event number used so far. A number is never used twice.",
    ],
  ])(
    "%s: names the column, the highest number and why",
    (kind: NumberedRecordKind, highestNumber: number, message: string) => {
      expect(
        NextNumberUtil.getNotAboveHighestError({ kind, highestNumber }),
      ).toBe(message);
    },
  );
});
