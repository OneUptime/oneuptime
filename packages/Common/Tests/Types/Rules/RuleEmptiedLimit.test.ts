import {
  addRuleEmptiedLimits,
  buildRuleEmptiedLimit,
  describeRuleEmptiedLimitNames,
  isRuleEmptiedLimit,
  readRuleEmptiedLimits,
  RULE_EMPTIED_LIMIT_MAX_NAME_LENGTH,
  RULE_EMPTIED_LIMIT_MAX_NAMES,
  RuleEmptiedLimit,
  toRuleEmptiedLimitName,
} from "../../../Types/Rules/RuleEmptiedLimit";
import { describe, expect, test } from "@jest/globals";

/*
 * The note a rule keeps of why OneUptime switched it off (#9066): the
 * server writes it on a delete, the dashboard reads it. Read defensively,
 * since it is JSON from the database.
 */

const entry: (data?: Partial<RuleEmptiedLimit>) => RuleEmptiedLimit = (
  data: Partial<RuleEmptiedLimit> = {},
): RuleEmptiedLimit => {
  return {
    list: "monitors",
    names: ["Checkout"],
    count: 1,
    deletedAt: "2026-11-16T10:00:00.000Z",
    switchedOff: true,
    ...data,
  };
};

describe("RuleEmptiedLimit", () => {
  describe("reading the note from the database", () => {
    test("an entry as written is an entry", () => {
      expect(isRuleEmptiedLimit(entry())).toBe(true);
    });

    test.each([
      ["null", null],
      ["a string", "monitors"],
      ["an array", [entry()]],
      ["no list", { ...entry(), list: "" }],
      ["a list that is not text", { ...entry(), list: 3 }],
      ["names that are not text", { ...entry(), names: [1] }],
      ["names that are not a list", { ...entry(), names: "Checkout" }],
      ["no count", { ...entry(), count: undefined }],
      ["a count that is not a number", { ...entry(), count: Infinity }],
      ["no date", { ...entry(), deletedAt: undefined }],
      ["no switch", { ...entry(), switchedOff: "yes" }],
    ])("%s is not an entry", (_name: string, value: unknown) => {
      expect(isRuleEmptiedLimit(value)).toBe(false);
    });

    test("a note is its entries, and anything else in it is left out", () => {
      expect(
        readRuleEmptiedLimits([entry(), { list: "broken" }, "text", null]),
      ).toEqual([entry()]);
    });

    test.each([
      ["null", null],
      ["undefined", undefined],
      ["an object", { list: "monitors" }],
      ["a string", "[]"],
    ])("%s reads as no note", (_name: string, value: unknown) => {
      expect(readRuleEmptiedLimits(value)).toEqual([]);
    });
  });

  describe("the names an entry keeps", () => {
    test("are trimmed", () => {
      expect(toRuleEmptiedLimitName("  Checkout  ")).toBe("Checkout");
    });

    test("are cut to their length, with an ellipsis", () => {
      const name: string = toRuleEmptiedLimitName(
        "x".repeat(RULE_EMPTIED_LIMIT_MAX_NAME_LENGTH + 20),
      );

      expect(name).toHaveLength(RULE_EMPTIED_LIMIT_MAX_NAME_LENGTH);
      expect(name.endsWith("…")).toBe(true);
    });

    test.each([null, undefined, 3, {}])(
      "a name that is not text (%s) is no name",
      (value: unknown) => {
        expect(toRuleEmptiedLimitName(value)).toBe("");
      },
    );
  });

  describe("the entry a delete writes", () => {
    test("names the deleted records in name order, the first ones, and counts them all", () => {
      const built: RuleEmptiedLimit = buildRuleEmptiedLimit({
        list: "monitorLabels",
        names: ["Zeta", "Alpha", "Mu", "Beta", "Kappa", "Eta", "Iota"],
        deletedAt: new Date("2026-11-16T10:00:00.000Z"),
        switchedOff: true,
      });

      expect(built).toEqual({
        list: "monitorLabels",
        names: ["Alpha", "Beta", "Eta", "Iota", "Kappa"],
        count: 7,
        deletedAt: "2026-11-16T10:00:00.000Z",
        switchedOff: true,
      });
      expect(built.names).toHaveLength(RULE_EMPTIED_LIMIT_MAX_NAMES);
    });

    test("counts a record that had no name, without naming it", () => {
      expect(
        buildRuleEmptiedLimit({
          list: "runbooks",
          names: ["", "Restart the database"],
          deletedAt: new Date("2026-11-16T10:00:00.000Z"),
          switchedOff: false,
        }),
      ).toEqual(
        expect.objectContaining({
          names: ["Restart the database"],
          count: 2,
          switchedOff: false,
        }),
      );
    });

    test("counts one record at least", () => {
      expect(
        buildRuleEmptiedLimit({
          list: "sites",
          names: [],
          deletedAt: new Date(),
          switchedOff: true,
        }).count,
      ).toBe(1);
    });
  });

  describe("adding entries to a note", () => {
    test("adds a list the note does not name", () => {
      expect(
        addRuleEmptiedLimits(
          [entry()],
          [entry({ list: "incidentSeverities", names: ["Critical"] })],
        ),
      ).toEqual([
        entry(),
        entry({ list: "incidentSeverities", names: ["Critical"] }),
      ]);
    });

    test("says a list once, by its newest entry", () => {
      expect(
        addRuleEmptiedLimits(
          [entry({ names: ["Checkout"] })],
          [
            entry({
              names: ["Billing"],
              deletedAt: "2026-11-17T10:00:00.000Z",
            }),
          ],
        ),
      ).toEqual([
        entry({ names: ["Billing"], deletedAt: "2026-11-17T10:00:00.000Z" }),
      ]);
    });

    test("keeps that the rule was switched off, if either entry says so", () => {
      expect(
        addRuleEmptiedLimits(
          [entry({ switchedOff: true })],
          [entry({ switchedOff: false })],
        ),
      ).toEqual([entry({ switchedOff: true })]);
    });

    test("reads a note that is not one as none", () => {
      expect(addRuleEmptiedLimits("broken", [entry()])).toEqual([entry()]);
      expect(addRuleEmptiedLimits(null, [entry()])).toEqual([entry()]);
    });
  });

  describe("the names in a sentence", () => {
    test.each([
      [["Checkout"], 1, "Checkout"],
      [["Billing", "Checkout"], 2, "Billing and Checkout"],
      [["A", "B", "C"], 3, "A, B and C"],
      [["A", "B", "C", "D", "E"], 8, "A, B, C, D, E and 3 more"],
      [[], 1, "1 record"],
      [[], 4, "4 records"],
    ])(
      "%j of %d read %s",
      (names: Array<string>, count: number, expected: string) => {
        expect(
          describeRuleEmptiedLimitNames(entry({ names: names, count: count })),
        ).toBe(expected);
      },
    );
  });
});
