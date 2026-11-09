import { afterEach, describe, expect, test } from "@jest/globals";
import Project from "../../../Models/DatabaseModels/Project";
import {
  AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
  AUDIT_LOG_MAX_RETENTION_IN_DAYS,
  AUDIT_LOG_MIN_RETENTION_IN_DAYS,
  AUDIT_LOG_RETENTION_ERROR,
  getAuditLogRetentionDate,
  getAuditLogRetentionError,
  readAuditLogRetentionInDays,
} from "../../../Types/AuditLog/AuditLogRetention";
import OneUptimeDate from "../../../Types/Date";
import {
  resetMomentDefaultZone,
  setMomentDefaultZone,
} from "../../Helpers/MomentDefaultZone";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * HOW LONG THE AUDIT LOG KEEPS AN ENTRY, AS ONE RULE (#6383).
 *
 * The recorder stamped each entry with Math.max(1, Math.min(days || 7, 180))
 * days, and a failing export reckoned any value <= 0 as 7: for a retention
 * of -3, which the API took, entries were deleted after a day while the
 * export warned as if they lasted a week. Both now read the setting through
 * Common/Types/AuditLog/AuditLogRetention, and the server refuses a value
 * outside 7 to 180. This suite holds the rule itself:
 *
 *   - the range is 7 to 180 whole days, 7 by default, as the Project column
 *     says;
 *   - every value reads as a retention in that range: none or one that is
 *     not a number as 7, a number as the nearest whole number of days in
 *     the range;
 *   - exactly the values that read as themselves can be saved;
 *   - an entry is deleted that many calendar days after it is recorded.
 *
 * ee/Tests/Server/AuditLogExport/AuditLogExportClockChanges.test.ts holds
 * the recorder and a failing export to it, value by value and zone by zone.
 */

const HOUR: number = 60 * 60 * 1000;

afterEach(() => {
  resetMomentDefaultZone();
});

describe("the range", () => {
  test("7 to 180 whole days, 7 by default", () => {
    expect(AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS).toBe(7);
    expect(AUDIT_LOG_MIN_RETENTION_IN_DAYS).toBe(7);
    expect(AUDIT_LOG_MAX_RETENTION_IN_DAYS).toBe(180);
    expect(AUDIT_LOG_RETENTION_ERROR).toBe(
      "Audit log retention must be a whole number of days from 7 to 180.",
    );
  });

  test("the Project column's default and description are the rule's", () => {
    const project: Project = new Project();

    expect(
      project.getTableColumnMetadata("auditLogsRetentionInDays").defaultValue,
    ).toBe(AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS);
    expect(
      project.getTableColumnMetadata("auditLogsRetentionInDays").description,
    ).toContain(
      `Minimum ${AUDIT_LOG_MIN_RETENTION_IN_DAYS}, maximum ${AUDIT_LOG_MAX_RETENTION_IN_DAYS}.`,
    );
  });
});

describe("the retention an entry is recorded with", () => {
  test.each([
    // No value, or one that is not a number of days: the default.
    ["no value (null)", null, 7],
    ["no value (undefined)", undefined, 7],
    ["NaN", Number.NaN, 7],
    ["Infinity", Number.POSITIVE_INFINITY, 7],
    ["-Infinity", Number.NEGATIVE_INFINITY, 7],
    ["text", "a week", 7],
    ["blank text", "", 7],
    ["spaces", "   ", 7],
    ["a switch", true, 7],
    ["an object", {}, 7],
    ["a list", [], 7],
    // A number: the nearest whole number of days from 7 to 180.
    ["-3, which the recorder kept a day", -3, 7],
    ["-0", -0, 7],
    ["0", 0, 7],
    ["0.5, which both kept a day", 0.5, 7],
    ["1", 1, 7],
    ["3", 3, 7],
    ["6", 6, 7],
    ["6.6", 6.6, 7],
    ["7", 7, 7],
    ["7.4", 7.4, 7],
    ["7.5", 7.5, 8],
    ["8", 8, 8],
    ["30", 30, 30],
    ["90", 90, 90],
    ["179", 179, 179],
    ["179.5", 179.5, 180],
    ["180", 180, 180],
    ["181", 181, 180],
    ["500", 500, 180],
    ["5000", 5000, 180],
    ["the largest number", Number.MAX_VALUE, 180],
    // A number written as text, as a form sends it, is that number.
    ['"30"', "30", 30],
    ['" 90 "', " 90 ", 90],
    ['"-3"', "-3", 7],
    ['"500"', "500", 180],
    ['"7.5"', "7.5", 8],
  ])("%s reads as %p days", (_name: string, value: unknown, days: number) => {
    expect(readAuditLogRetentionInDays(value)).toBe(days);
  });
});

describe("what can be saved", () => {
  test.each([
    [7],
    [8],
    [30],
    [90],
    [179],
    [180],
    ["30"],
    [" 90 "],
    ["180"],
  ])("%p is a retention", (value: unknown) => {
    expect(getAuditLogRetentionError(value)).toBeNull();
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["a week"],
    ["7 days"],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    [-3],
    [-0.5],
    [0],
    [0.5],
    [1],
    [3],
    [6],
    [6.999],
    [7.5],
    [179.5],
    [180.5],
    [181],
    [500],
    ["-3"],
    ["500"],
    ["7.5"],
    [true],
    [{}],
    [[30]],
  ])("%p is refused with the range", (value: unknown) => {
    expect(getAuditLogRetentionError(value)).toBe(AUDIT_LOG_RETENTION_ERROR);
  });

  test("a number can be saved exactly when it reads as itself", () => {
    for (let days: number = -400; days <= 400; days += 0.25) {
      expect({
        days,
        saved: getAuditLogRetentionError(days) === null,
      }).toEqual({ days, saved: readAuditLogRetentionInDays(days) === days });
    }
  });
});

describe("when an entry is deleted", () => {
  const RECORDED_AT: Date = new Date("2026-06-01T09:30:00.000Z");

  test.each([
    [7, 7],
    [30, 30],
    [180, 180],
    [-3, 7],
    [0, 7],
    [500, 180],
    [null, 7],
    ["30", 30],
  ])(
    "a retention of %p: %p calendar days after it is recorded",
    (value: unknown, days: number) => {
      expect(
        getAuditLogRetentionDate({
          recordedAt: RECORDED_AT,
          retentionInDays: value,
        }).toISOString(),
      ).toBe(OneUptimeDate.addRemoveDays(RECORDED_AT, days).toISOString());
    },
  );

  test("without a change of the clocks, each day is 24 hours", () => {
    setMomentDefaultZone("UTC");

    expect(
      getAuditLogRetentionDate({
        recordedAt: RECORDED_AT,
        retentionInDays: 7,
      }).toISOString(),
    ).toBe("2026-06-08T09:30:00.000Z");
  });

  /*
   * By the server's clock: in London the week over 25 October 2026 is 169
   * hours long, 12:59 BST to 12:59 GMT. Only that zone gives this instant,
   * so the test fails in UTC too if the rule stops counting calendar days.
   */
  test("across a change of the clocks, the same time by the server's clock", () => {
    setMomentDefaultZone("Europe/London");

    const recordedAt: Date = new Date("2026-10-24T11:59:00.000Z");
    const deletedAt: Date = getAuditLogRetentionDate({
      recordedAt,
      retentionInDays: -3,
    });

    expect(deletedAt.toISOString()).toBe("2026-10-31T12:59:00.000Z");
    expect((deletedAt.getTime() - recordedAt.getTime()) / HOUR).toBe(169);
  });

  test("the moment it is handed is left as it was", () => {
    const recordedAt: Date = new Date(RECORDED_AT);

    getAuditLogRetentionDate({ recordedAt, retentionInDays: 30 });

    expect(recordedAt.toISOString()).toBe(RECORDED_AT.toISOString());
  });
});

/*
 * Values of every kind a project could hold or a client could write, drawn
 * from a seeded stream: whole numbers either side of the range, fractions,
 * huge numbers, numbers written as text, and what is not a number at all.
 */
const drawValue: (random: SeededRandom) => unknown = (
  random: SeededRandom,
): unknown => {
  const kind: number = random(8);

  if (kind === 0) {
    return random(1000) - 400;
  }

  if (kind === 1) {
    return random() * 400 - 100;
  }

  if (kind === 2) {
    return random() * 1e12 * (random(2) === 0 ? 1 : -1);
  }

  if (kind === 3) {
    return String(random(1000) - 400);
  }

  if (kind === 4) {
    return ` ${(random() * 400 - 100).toFixed(random(4))} `;
  }

  if (kind === 5) {
    return random(181);
  }

  if (kind === 6) {
    return [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "",
      "a week",
      true,
      {},
    ][random(9)];
  }

  return AUDIT_LOG_MIN_RETENTION_IN_DAYS + random(3) - 1;
};

describe("for every value, drawn at random", () => {
  test("it reads as a whole number of days in the range, the same when read again, and in the order of the numbers", () => {
    const random: SeededRandom = seededRandom(6383);
    let previous: { number: number; days: number } | null = null;

    for (let draw: number = 0; draw < 5000; draw++) {
      const value: unknown = drawValue(random);
      const days: number = readAuditLogRetentionInDays(value);

      expect({ value, whole: Number.isInteger(days) }).toEqual({
        value,
        whole: true,
      });
      expect(days).toBeGreaterThanOrEqual(AUDIT_LOG_MIN_RETENTION_IN_DAYS);
      expect(days).toBeLessThanOrEqual(AUDIT_LOG_MAX_RETENTION_IN_DAYS);
      expect(readAuditLogRetentionInDays(days)).toBe(days);
      // What can be saved is stored as is, and read as what was saved.
      expect(getAuditLogRetentionError(days)).toBeNull();

      if (getAuditLogRetentionError(value) === null) {
        expect({ value, days }).toEqual({ value, days: Number(value) });
      }

      // A smaller stored number never reads as a longer retention.
      if (typeof value === "number" && Number.isFinite(value)) {
        if (previous) {
          const [smaller, larger] =
            previous.number <= value
              ? [previous.days, days]
              : [days, previous.days];

          expect({
            numbers: [previous.number, value],
            ordered: smaller <= larger,
          }).toEqual({ numbers: [previous.number, value], ordered: true });
        }

        previous = { number: value, days };
      }
    }
  });
});
