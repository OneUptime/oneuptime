import ArchivableValueUsage, {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * What the `<value route>/:id/usage` endpoint answers, as the dashboard reads
 * it back: only well-formed items, and the two questions the archive and
 * delete dialogs ask of them.
 */

const incidents: ArchivableValueUsageItem = {
  tableName: "Incident",
  title: "Incidents",
  singularTitle: "Incident",
  count: 12,
  isCountCapped: false,
  effect: ArchivableValueDeleteEffect.Refused,
  kind: ArchivableValueUsageKind.Records,
};

const rules: ArchivableValueUsageItem = {
  tableName: "IncidentOnCallRule",
  title: "Incident On-Call Rules",
  singularTitle: "Incident On-Call Rule",
  count: 10000,
  isCountCapped: true,
  effect: ArchivableValueDeleteEffect.RemovedFromList,
  kind: ArchivableValueUsageKind.Settings,
};

describe("the usage answer, there and back", () => {
  test("round-trips every field", () => {
    const json: JSONArray = ArchivableValueUsage.toJSONArray([
      incidents,
      rules,
    ]);

    expect(json).toEqual([{ ...incidents }, { ...rules }]);
    expect(
      ArchivableValueUsage.fromJSONArray(JSON.parse(JSON.stringify(json))),
    ).toEqual([incidents, rules]);
  });

  test("anything but a list reads as no uses", () => {
    for (const value of [undefined, null, "", 3, {}, { data: [] }]) {
      expect(ArchivableValueUsage.fromJSONArray(value)).toEqual([]);
    }
  });

  test("leaves out items it cannot trust", () => {
    expect(
      ArchivableValueUsage.fromJSONArray([
        null,
        "Incident",
        { ...incidents, tableName: 3 },
        { ...incidents, title: undefined },
        { ...incidents, count: 0 },
        { ...incidents, count: -1 },
        { ...incidents, count: "many" },
        { ...incidents, effect: "Vanished" },
        { ...incidents, kind: "Other" },
        incidents,
      ]),
    ).toEqual([incidents]);
  });

  test("a count sent as text is read as a number", () => {
    expect(
      ArchivableValueUsage.fromJSONArray([{ ...incidents, count: "12" }]),
    ).toEqual([incidents]);
  });

  test("a missing singular title falls back to the title, and capped only when it says so", () => {
    expect(
      ArchivableValueUsage.fromJSONArray([
        {
          tableName: "Monitor",
          title: "Monitors",
          count: 1,
          isCountCapped: "yes",
          effect: ArchivableValueDeleteEffect.LeftDangling,
          kind: ArchivableValueUsageKind.Settings,
        },
      ]),
    ).toEqual([
      {
        tableName: "Monitor",
        title: "Monitors",
        singularTitle: "Monitors",
        count: 1,
        isCountCapped: false,
        effect: ArchivableValueDeleteEffect.LeftDangling,
        kind: ArchivableValueUsageKind.Settings,
      },
    ]);
  });
});

describe("what the dialogs ask of it", () => {
  test("a delete is refused while records point at the value", () => {
    expect(ArchivableValueUsage.isDeleteRefused([incidents, rules])).toBe(true);
    expect(ArchivableValueUsage.isDeleteRefused([rules])).toBe(false);
    expect(ArchivableValueUsage.isDeleteRefused([])).toBe(false);
  });

  test("the settings that keep using an archived value", () => {
    expect(ArchivableValueUsage.getSettings([incidents, rules])).toEqual([
      rules,
    ]);
    expect(ArchivableValueUsage.getSettings([incidents])).toEqual([]);
  });

  test("every effect and kind is a value the server sends", () => {
    expect(Object.values(ArchivableValueDeleteEffect).sort()).toEqual([
      "Cleared",
      "Deleted",
      "LeftDangling",
      "Refused",
      "RemovedFromList",
    ]);
    expect(Object.values(ArchivableValueUsageKind).sort()).toEqual([
      "Personal",
      "Records",
      "Settings",
    ]);
    expect(Object.values(ArchivableValuesUsagePurpose).sort()).toEqual([
      "Archive",
      "Delete",
    ]);
  });
});

/*
 * "Notification Rules (22)" in a project whose owners set up two rules: the
 * rows of every member's own on-call rules, counted as the project's
 * settings. People's own settings are a kind of their own, counted by
 * person, and a table reached more than one way carries its total.
 */
const people: ArchivableValueUsageItem = {
  tableName: "UserNotificationRule",
  title: "Notification Rules",
  singularTitle: "Notification Rule",
  count: 2,
  isCountCapped: false,
  effect: ArchivableValueDeleteEffect.Deleted,
  kind: ArchivableValueUsageKind.Personal,
};

const monitorsCriteria: ArchivableValueUsageItem = {
  tableName: "Monitor",
  title: "Monitors",
  singularTitle: "Monitor",
  count: 3,
  isCountCapped: false,
  totalCount: 4,
  isTotalCountCapped: false,
  effect: ArchivableValueDeleteEffect.LeftDangling,
  kind: ArchivableValueUsageKind.Settings,
};

describe("people's own settings, and a table's total", () => {
  test("a person's own settings round-trip as their own kind", () => {
    const json: JSONArray = ArchivableValueUsage.toJSONArray([people]);

    expect(json).toEqual([{ ...people }]);
    expect(
      ArchivableValueUsage.fromJSONArray(JSON.parse(JSON.stringify(json))),
    ).toEqual([people]);
  });

  test("they are neither the settings that keep using a value nor records", () => {
    expect(
      ArchivableValueUsage.getSettings([incidents, rules, people]),
    ).toEqual([rules]);
    expect(
      ArchivableValueUsage.getPersonal([incidents, rules, people]),
    ).toEqual([people]);
    expect(ArchivableValueUsage.getPersonal([incidents, rules])).toEqual([]);
  });

  test("a total round-trips, and an item without one sends none", () => {
    const json: JSONArray = ArchivableValueUsage.toJSONArray([
      monitorsCriteria,
      incidents,
    ]);

    expect(json[0]).toEqual({ ...monitorsCriteria });
    expect(json[1]).not.toHaveProperty("totalCount");
    expect(
      ArchivableValueUsage.fromJSONArray(JSON.parse(JSON.stringify(json))),
    ).toEqual([monitorsCriteria, incidents]);
  });

  test("a total below its own count, or not a number, is left out", () => {
    for (const totalCount of [2, 0, -4, "lots", null]) {
      const read: Array<ArchivableValueUsageItem> =
        ArchivableValueUsage.fromJSONArray([
          { ...monitorsCriteria, totalCount: totalCount },
        ]);

      expect(read).toHaveLength(1);
      expect(read[0]!.totalCount).toBeUndefined();
      expect(read[0]!.isTotalCountCapped).toBeUndefined();
    }
  });

  test("the line's number is the total when there is one, the count otherwise", () => {
    expect(ArchivableValueUsage.getTotalCount(monitorsCriteria)).toEqual({
      count: 4,
      isCountCapped: false,
    });
    expect(
      ArchivableValueUsage.getTotalCount({
        ...monitorsCriteria,
        totalCount: 10000,
        isTotalCountCapped: true,
      }),
    ).toEqual({ count: 10000, isCountCapped: true });
    expect(ArchivableValueUsage.getTotalCount(rules)).toEqual({
      count: 10000,
      isCountCapped: true,
    });
  });
});

describe("the answer for several values at once", () => {
  const answer: ArchivableValuesUsage = {
    usage: [people, rules],
    refusedValueIds: ["0193c0de-aaaa-4aaa-8aaa-000000000001"],
    refusedUsage: [incidents],
  };

  test("round-trips", () => {
    const json: JSONObject = ArchivableValueUsage.valuesUsageToJSON(answer);

    expect(
      ArchivableValueUsage.valuesUsageFromJSON(
        JSON.parse(JSON.stringify(json)),
      ),
    ).toEqual(answer);
  });

  test("an answer it cannot read is nothing in use and nothing refused", () => {
    for (const value of [undefined, null, "", 4, [], { usage: "all" }]) {
      expect(ArchivableValueUsage.valuesUsageFromJSON(value)).toEqual({
        usage: [],
        refusedValueIds: [],
        refusedUsage: [],
      });
    }
  });

  test("keeps only the refused ids that are text", () => {
    expect(
      ArchivableValueUsage.valuesUsageFromJSON({
        usage: [],
        refusedValueIds: ["a1", 3, null, "", { id: "b2" }, "c3"],
        refusedUsage: [],
      }).refusedValueIds,
    ).toEqual(["a1", "c3"]);
  });
});
