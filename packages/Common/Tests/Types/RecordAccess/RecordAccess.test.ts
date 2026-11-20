import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import RecordAccess, {
  RECORD_ACCESS_TABLES,
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessRefusalReason,
  RecordAccessResult,
} from "../../../Types/RecordAccess/RecordAccess";

/*
 * What the reader may do on one record (#10272), as the server answers it
 * and the Dashboard reads it: each operation of each table allowed, or
 * refused with its reason and the names it is said with; read so that an
 * answer the Dashboard cannot understand locks nothing more than the
 * reader's own permissions do.
 */

const INCIDENT_ID: string = "10272000-0000-4000-8000-0000000000a1";

const ANSWER: RecordAccessResult = {
  kind: RecordAccessKind.Incident,
  recordId: INCIDENT_ID,
  tables: {
    Incident: {
      [RecordAccessOperation.Update]: RecordAccess.allowed(),
      [RecordAccessOperation.Delete]: RecordAccess.refused(
        RecordAccessRefusalReason.Permission,
      ),
    },
    IncidentMember: {
      [RecordAccessOperation.Create]: RecordAccess.refused(
        RecordAccessRefusalReason.Labels,
        { labelNames: ["Payments", "Checkout"] },
      ),
      [RecordAccessOperation.Update]: RecordAccess.refused(
        RecordAccessRefusalReason.Private,
        { teamNames: ["Payments SRE"] },
      ),
    },
    IncidentOwnerTeam: {},
  },
};

describe("an answer, as it travels", () => {
  test("goes over JSON and comes back as it was", () => {
    const json: JSONObject = RecordAccess.toJSON(ANSWER);

    expect(RecordAccess.fromJSON(JSON.parse(JSON.stringify(json)))).toEqual(
      ANSWER,
    );
  });

  test("says each operation as allowed or refused, a refusal with its reason and its names", () => {
    expect(RecordAccess.toJSON(ANSWER)).toEqual({
      kind: "Incident",
      recordId: INCIDENT_ID,
      tables: {
        Incident: {
          update: { isAllowed: true, refusal: null },
          delete: {
            isAllowed: false,
            refusal: { reason: "Permission", labelNames: [], teamNames: [] },
          },
        },
        IncidentMember: {
          create: {
            isAllowed: false,
            refusal: {
              reason: "Labels",
              labelNames: ["Payments", "Checkout"],
              teamNames: [],
            },
          },
          update: {
            isAllowed: false,
            refusal: {
              reason: "Private",
              labelNames: [],
              teamNames: ["Payments SRE"],
            },
          },
        },
        IncidentOwnerTeam: {},
      },
    });
  });

  test("an operation not asked - a part with no row yet - is no verdict at all", () => {
    expect(
      RecordAccess.getVerdict(
        ANSWER,
        "IncidentOwnerTeam",
        RecordAccessOperation.Delete,
      ),
    ).toBeNull();
    expect(
      RecordAccess.getVerdict(ANSWER, "Monitor", RecordAccessOperation.Update),
    ).toBeNull();
    expect(
      RecordAccess.getVerdict(null, "Incident", RecordAccessOperation.Update),
    ).toBeNull();
  });

  test("a verdict is read by table and operation", () => {
    expect(
      RecordAccess.getVerdict(ANSWER, "Incident", RecordAccessOperation.Update),
    ).toEqual({ isAllowed: true, refusal: null });
    expect(
      RecordAccess.getVerdict(
        ANSWER,
        "IncidentMember",
        RecordAccessOperation.Create,
      )?.refusal?.labelNames,
    ).toEqual(["Payments", "Checkout"]);
  });

  test("names that are blank are left out, so no sentence names nothing", () => {
    expect(
      RecordAccess.fromJSON({
        kind: "Alert",
        recordId: INCIDENT_ID,
        tables: {
          Alert: {
            update: {
              isAllowed: false,
              refusal: {
                reason: "BlockedLabels",
                labelNames: ["  ", "Payments"],
              },
            },
          },
        },
      })?.tables["Alert"]?.update?.refusal,
    ).toEqual({
      reason: RecordAccessRefusalReason.BlockedLabels,
      labelNames: ["Payments"],
      teamNames: [],
    });
  });
});

describe("an answer the Dashboard cannot read is no answer", () => {
  test.each([
    ["nothing", null],
    ["a list", []],
    [
      "a kind it does not know",
      { ...RecordAccess.toJSON(ANSWER), kind: "Monitor" },
    ],
    ["no record", { ...RecordAccess.toJSON(ANSWER), recordId: "" }],
    ["no tables", { kind: "Incident", recordId: INCIDENT_ID }],
    [
      "an operation it does not know",
      {
        kind: "Incident",
        recordId: INCIDENT_ID,
        tables: { Incident: { archive: { isAllowed: true } } },
      },
    ],
    [
      "a refusal without its reason",
      {
        kind: "Incident",
        recordId: INCIDENT_ID,
        tables: { Incident: { update: { isAllowed: false } } },
      },
    ],
    [
      "a reason it does not know",
      {
        kind: "Incident",
        recordId: INCIDENT_ID,
        tables: {
          Incident: {
            update: { isAllowed: false, refusal: { reason: "Because" } },
          },
        },
      },
    ],
    [
      "names that are not words",
      {
        kind: "Incident",
        recordId: INCIDENT_ID,
        tables: {
          Incident: {
            update: {
              isAllowed: false,
              refusal: { reason: "Labels", labelNames: [7] },
            },
          },
        },
      },
    ],
    [
      "a verdict that is neither allowed nor refused",
      {
        kind: "Incident",
        recordId: INCIDENT_ID,
        tables: { Incident: { update: { isAllowed: "yes" } } },
      },
    ],
  ])("%s", (_name: string, json: unknown) => {
    expect(RecordAccess.fromJSON(json)).toBeNull();
  });
});

describe("the tables each kind's answer is about", () => {
  test("each kind names its record's own table first, then its parts, each once", () => {
    for (const kind of Object.values(RecordAccessKind)) {
      const tables: ReadonlyArray<string> = RECORD_ACCESS_TABLES[kind];

      expect(tables[0]).toBe(kind);
      expect(new Set(tables).size).toBe(tables.length);

      for (const table of tables.slice(1)) {
        // A part of an incident is an Incident..., of a maintenance event a ScheduledMaintenance...
        expect(table.startsWith(kind)).toBe(true);
      }
    }
  });

  test("the route is under each record's own API", () => {
    expect(RecordAccess.routePath).toBe("/record-access");
  });
});
