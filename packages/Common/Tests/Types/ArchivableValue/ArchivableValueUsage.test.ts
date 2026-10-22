import ArchivableValueUsage, {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import { JSONArray } from "../../../Types/JSON";
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
      "Records",
      "Settings",
    ]);
  });
});
