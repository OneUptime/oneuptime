import { describe, expect, test } from "@jest/globals";
import {
  ExceptionCounts,
  ExceptionTakeIn,
  ExceptionTakeInStatement,
  NOTHING_TAKEN_IN,
  getTakeBackStatement,
  getTakeInStatement,
  takeIn,
} from "../../../../Server/Utils/Telemetry/ExceptionTakeIn";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * What an exception takes in when another becomes part of it - a person's
 * merge (TelemetryExceptionMerge) and two copies of one exception when the
 * copies of their host merge (ExceptionTwinMerge) add up the same way:
 * counts summed, the first and last seen the earliest and the latest with
 * the release each was seen in, and unhandled if any was. The statements
 * are run on Postgres by App's ExceptionMergePostgres and Common's
 * MergeDuplicateHostsAndAddUniqueHostIdentifierPostgres.
 */

const ID: string = "30000000-0000-4000-8000-00000000000a";

function day(n: number): Date {
  return new Date(Date.UTC(2026, 9, n));
}

function counts(overrides: Partial<ExceptionCounts> = {}): ExceptionCounts {
  return {
    occuranceCount: 10,
    firstSeenAt: day(5),
    lastSeenAt: day(20),
    firstSeenInRelease: "1.0.0",
    lastSeenInRelease: "1.2.0",
    unhandled: false,
    ...overrides,
  };
}

describe("taking another exception in", () => {
  test("from nothing, it is what the other counted", () => {
    expect(takeIn(NOTHING_TAKEN_IN, counts())).toEqual({
      occuranceCount: 10,
      firstSeenAt: day(5),
      firstSeenInRelease: "1.0.0",
      lastSeenAt: day(20),
      lastSeenInRelease: "1.2.0",
      unhandled: false,
    });
  });

  test("counts add up, the seen times widen, each with its own release", () => {
    const total: ExceptionTakeIn = takeIn(
      takeIn(NOTHING_TAKEN_IN, counts()),
      counts({
        occuranceCount: 7,
        firstSeenAt: day(1),
        firstSeenInRelease: "0.9.0",
        lastSeenAt: day(25),
        lastSeenInRelease: "1.3.0",
      }),
    );

    expect(total).toEqual({
      occuranceCount: 17,
      firstSeenAt: day(1),
      firstSeenInRelease: "0.9.0",
      lastSeenAt: day(25),
      lastSeenInRelease: "1.3.0",
      unhandled: false,
    });
  });

  test("seen inside what is taken in already, it moves neither seen time nor release", () => {
    const total: ExceptionTakeIn = takeIn(
      takeIn(NOTHING_TAKEN_IN, counts()),
      counts({
        occuranceCount: 2,
        firstSeenAt: day(8),
        firstSeenInRelease: "1.1.0",
        lastSeenAt: day(12),
        lastSeenInRelease: "1.1.5",
      }),
    );

    expect(total.firstSeenAt).toEqual(day(5));
    expect(total.firstSeenInRelease).toBe("1.0.0");
    expect(total.lastSeenAt).toEqual(day(20));
    expect(total.lastSeenInRelease).toBe("1.2.0");
    expect(total.occuranceCount).toBe(12);
  });

  test("a release that is not known never replaces one that is", () => {
    const total: ExceptionTakeIn = takeIn(
      takeIn(NOTHING_TAKEN_IN, counts()),
      counts({
        firstSeenAt: day(1),
        firstSeenInRelease: null,
        lastSeenAt: day(25),
        lastSeenInRelease: "",
      }),
    );

    expect(total.firstSeenAt).toEqual(day(1));
    expect(total.firstSeenInRelease).toBe("1.0.0");
    expect(total.lastSeenAt).toEqual(day(25));
    expect(total.lastSeenInRelease).toBe("1.2.0");
  });

  test("never seen, it adds its count and leaves the seen times", () => {
    const total: ExceptionTakeIn = takeIn(
      takeIn(NOTHING_TAKEN_IN, counts()),
      counts({
        occuranceCount: 3,
        firstSeenAt: null,
        lastSeenAt: null,
        firstSeenInRelease: null,
        lastSeenInRelease: null,
      }),
    );

    expect(total.occuranceCount).toBe(13);
    expect(total.firstSeenAt).toEqual(day(5));
    expect(total.lastSeenAt).toEqual(day(20));
  });

  test("unhandled if any occurrence of either escaped uncaught", () => {
    expect(
      takeIn(
        takeIn(NOTHING_TAKEN_IN, counts({ unhandled: true })),
        counts({ unhandled: false }),
      ).unhandled,
    ).toBe(true);
    expect(
      takeIn(
        takeIn(NOTHING_TAKEN_IN, counts({ unhandled: false })),
        counts({ unhandled: false }),
      ).unhandled,
    ).toBe(false);
  });

  test("only part of its count, when only part of what it counted joins", () => {
    const total: ExceptionTakeIn = takeIn(NOTHING_TAKEN_IN, counts(), 4);

    expect(total.occuranceCount).toBe(4);
    // Its seen times all the same.
    expect(total.firstSeenAt).toEqual(day(5));
    expect(total.lastSeenAt).toEqual(day(20));
  });

  test("a count that is not a count adds nothing", () => {
    expect(takeIn(NOTHING_TAKEN_IN, counts(), -5).occuranceCount).toBe(0);
    expect(takeIn(NOTHING_TAKEN_IN, counts(), Number.NaN).occuranceCount).toBe(
      0,
    );
  });

  test("it never changes what it adds to", () => {
    const before: ExceptionTakeIn = takeIn(NOTHING_TAKEN_IN, counts());
    const copy: ExceptionTakeIn = { ...before };

    takeIn(before, counts({ occuranceCount: 99, firstSeenAt: day(1) }));

    expect(before).toEqual(copy);
    expect(NOTHING_TAKEN_IN).toEqual({
      occuranceCount: 0,
      firstSeenAt: null,
      firstSeenInRelease: "",
      lastSeenAt: null,
      lastSeenInRelease: "",
      unhandled: false,
    });
  });

  test("a seeded sweep: in any order, the total is the sum, the earliest and the latest", () => {
    const random: SeededRandom = seededRandom(5180);

    for (let round: number = 0; round < 200; round++) {
      const others: Array<ExceptionCounts> = [];
      const size: number = 1 + random(6);

      for (let index: number = 0; index < size; index++) {
        const first: number = 1 + random(20);
        const seen: boolean = random() > 0.1;
        others.push(
          counts({
            occuranceCount: random(50),
            firstSeenAt: seen ? day(first) : null,
            lastSeenAt: seen ? day(first + random(8)) : null,
            firstSeenInRelease: `first-${index}`,
            lastSeenInRelease: `last-${index}`,
            unhandled: random() > 0.8,
          }),
        );
      }

      const forward: ExceptionTakeIn = others.reduce(
        (total: ExceptionTakeIn, other: ExceptionCounts): ExceptionTakeIn => {
          return takeIn(total, other);
        },
        NOTHING_TAKEN_IN,
      );
      const backward: ExceptionTakeIn = [...others]
        .reverse()
        .reduce(
          (total: ExceptionTakeIn, other: ExceptionCounts): ExceptionTakeIn => {
            return takeIn(total, other);
          },
          NOTHING_TAKEN_IN,
        );

      const seenTimes: Array<number> = others.flatMap(
        (other: ExceptionCounts): Array<number> => {
          return other.firstSeenAt
            ? [other.firstSeenAt.getTime(), other.lastSeenAt!.getTime()]
            : [];
        },
      );

      for (const total of [forward, backward]) {
        expect(total.occuranceCount).toBe(
          others.reduce((sum: number, other: ExceptionCounts): number => {
            return sum + other.occuranceCount;
          }, 0),
        );
        expect(total.firstSeenAt?.getTime() ?? null).toBe(
          seenTimes.length > 0 ? Math.min(...seenTimes) : null,
        );
        expect(total.lastSeenAt?.getTime() ?? null).toBe(
          seenTimes.length > 0 ? Math.max(...seenTimes) : null,
        );
        expect(total.unhandled).toBe(
          others.some((other: ExceptionCounts): boolean => {
            return other.unhandled;
          }),
        );

        // Each release is one seen at that time.
        if (total.firstSeenAt) {
          expect(
            others.some((other: ExceptionCounts): boolean => {
              return (
                other.firstSeenAt?.getTime() === total.firstSeenAt!.getTime() &&
                other.firstSeenInRelease === total.firstSeenInRelease
              );
            }),
          ).toBe(true);
        }
        if (total.lastSeenAt) {
          expect(
            others.some((other: ExceptionCounts): boolean => {
              return (
                other.lastSeenAt?.getTime() === total.lastSeenAt!.getTime() &&
                other.lastSeenInRelease === total.lastSeenInRelease
              );
            }),
          ).toBe(true);
        }
      }
    }
  });
});

describe("the statements", () => {
  const takenIn: ExceptionTakeIn = takeIn(
    NOTHING_TAKEN_IN,
    counts({ occuranceCount: 7, unhandled: true }),
  );

  test("taking in: the count grows, the seen times widen with their releases, unhandled if either was", () => {
    const statement: ExceptionTakeInStatement = getTakeInStatement({
      exceptionId: ID,
      takenIn: takenIn,
    });

    expect(statement.query).toContain('UPDATE "TelemetryException" SET');
    expect(statement.query).toContain(
      '"occuranceCount" = COALESCE("occuranceCount", 0) + $1',
    );
    // Each release decided against the seen time before it moves.
    expect(statement.query).toContain(
      `WHEN $2::text <> '' AND ("firstSeenAt" IS NULL OR $3::timestamptz < "firstSeenAt") THEN $2::text`,
    );
    expect(statement.query).toContain(
      `WHEN $4::text <> '' AND ("lastSeenAt" IS NULL OR $5::timestamptz > "lastSeenAt") THEN $4::text`,
    );
    expect(statement.query).toContain(
      '"firstSeenAt" = LEAST("firstSeenAt", $3::timestamptz)',
    );
    expect(statement.query).toContain(
      '"lastSeenAt" = GREATEST("lastSeenAt", $5::timestamptz)',
    );
    expect(statement.query).toContain(
      '"unhandled" = COALESCE("unhandled", false) OR $6::boolean',
    );
    expect(statement.query).toContain('WHERE "_id" = $7');
    expect(statement.parameters).toEqual([
      7,
      "1.0.0",
      day(5),
      "1.2.0",
      day(20),
      true,
      ID,
    ]);
  });

  test("on the table it is given, as a schema-qualified name or the search path's", () => {
    expect(
      getTakeInStatement({
        exceptionId: ID,
        takenIn: takenIn,
        table: `"clone"."TelemetryException"`,
      }).query,
    ).toContain('UPDATE "clone"."TelemetryException" SET');
    expect(
      getTakeBackStatement({
        exceptionId: ID,
        occuranceCount: 3,
        table: `"clone"."TelemetryException"`,
      }).query,
    ).toContain('UPDATE "clone"."TelemetryException" SET');
  });

  test("taking back: never below zero, and the seen times stay", () => {
    const statement: ExceptionTakeInStatement = getTakeBackStatement({
      exceptionId: ID,
      occuranceCount: 7,
    });

    expect(statement.query).toBe(
      `UPDATE "TelemetryException" SET "occuranceCount" = GREATEST(0, COALESCE("occuranceCount", 0) - $1), "updatedAt" = now() WHERE "_id" = $2`,
    );
    expect(statement.parameters).toEqual([7, ID]);
    expect(statement.query).not.toContain("SeenAt");
  });

  test("taking back a count that is not one takes nothing", () => {
    expect(
      getTakeBackStatement({ exceptionId: ID, occuranceCount: -4 }).parameters,
    ).toEqual([0, ID]);
  });
});
