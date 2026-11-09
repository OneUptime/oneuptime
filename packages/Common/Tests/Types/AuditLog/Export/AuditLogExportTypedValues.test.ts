import { describe, expect, test } from "@jest/globals";
import { AUDIT_LOG_REDACTED_VALUE } from "../../../../Types/AuditLog/AuditLogRedaction";
import {
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AuditLogExportChange,
  AuditLogExportRecord,
  AuditLogExportSchemaVersion,
  readAuditLogExportTypedValues,
  serializeAuditLogExportRecord,
  toAuditLogExportRecord,
} from "../../../../Types/AuditLog/Export/AuditLogExportRecord";
import Email from "../../../../Types/Email";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import Phone from "../../../../Types/Phone";
import Port from "../../../../Types/Port";
import { readAuditLogTypedValue } from "../../../../Utils/AuditLog/AuditLogTypedValues";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * AN EXPORTED ENTRY CARRIES A PHONE NUMBER AS THE NUMBER, whenever it was
 * recorded (issue #6325).
 *
 * The recorder now records a typed value as what it holds. An entry
 * recorded before it did holds { "_type": "Phone", "value": ... } until its
 * retention ends, and the export reads it as the recorder writes entries
 * now (readAuditLogExportTypedValues): the number, in every version, with no
 * summary lines when that leaves both values plain. No key changes, so the
 * schema's versions stay as they are.
 */

const ENTRY_ID: string = "0192f5a1-7c2e-7b1a-9c3d-4e5f60718293";

// A row as the audit table answers it, holding these changes.
function rowWith(changes: Array<JSONValue>): JSONObject {
  return {
    _id: ENTRY_ID,
    createdAt: "2026-10-24 09:15:03",
    projectId: "6d2c3b4a-5e6f-4a1b-8c9d-0e1f2a3b4c5d",
    action: "Update",
    resourceType: "Incoming Call Policy",
    resourceId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    resourceName: "Support line",
    rootResourceType: "Incoming Call Policy",
    rootResourceId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    userId: "11111111-2222-4333-8444-555555555555",
    userName: "Jane Doe",
    userEmail: "jane@example.com",
    userType: "User",
    apiKeyId: null,
    apiKeyName: null,
    mcpOAuthGrantId: null,
    mcpClientName: null,
    workflowId: null,
    workflowName: null,
    changes: JSON.stringify(changes),
  };
}

function exported(
  changes: Array<JSONValue>,
  schemaVersion: AuditLogExportSchemaVersion,
): AuditLogExportRecord {
  return readAuditLogExportTypedValues(
    toAuditLogExportRecord(rowWith(changes), schemaVersion)!,
  );
}

// The issue's entry: releasing a number a call policy kept in its own columns.
const RELEASED_NUMBER: JSONObject = {
  field: "routingPhoneNumber",
  oldValue: { _type: "Phone", value: "+14155550100" },
  newValue: null,
  summary: ["Changed the value"],
};

describe("an old entry's typed value goes out as what it holds", () => {
  test("version 2: the number, and no 'Changed the value'", () => {
    expect(exported([RELEASED_NUMBER], 2).changes).toEqual([
      {
        field: "routingPhoneNumber",
        oldValue: "+14155550100",
        newValue: null,
        summary: null,
      },
    ]);
  });

  test("version 1: the number, and still no summary key", () => {
    const changes: Array<AuditLogExportChange> = exported(
      [RELEASED_NUMBER],
      1,
    ).changes;

    expect(changes).toEqual([
      {
        field: "routingPhoneNumber",
        oldValue: "+14155550100",
        newValue: null,
      },
    ]);
    expect(Object.keys(changes[0]!)).toEqual(["field", "oldValue", "newValue"]);
  });

  test("a changed email address and port, before and after", () => {
    expect(
      exported(
        [
          {
            field: "fromEmail",
            oldValue: { _type: "Email", value: "alerts@example.com" },
            newValue: { _type: "Email", value: "status@example.com" },
            summary: ["Changed value"],
          },
          {
            field: "port",
            oldValue: { _type: "Port", value: 587 },
            newValue: { _type: "Port", value: 2525 },
            summary: ["Changed value"],
          },
        ],
        2,
      ).changes,
    ).toEqual([
      {
        field: "fromEmail",
        oldValue: "alerts@example.com",
        newValue: "status@example.com",
        summary: null,
      },
      { field: "port", oldValue: 587, newValue: 2525, summary: null },
    ]);
  });

  test("a created or deleted record's typed value: the side it has", () => {
    expect(
      exported(
        [
          {
            field: "subscriberEmail",
            newValue: { _type: "Email", value: "ada@example.com" },
          },
        ],
        2,
      ).changes,
    ).toEqual([
      { field: "subscriberEmail", newValue: "ada@example.com", summary: null },
    ]);
  });

  test("a hash goes out as [REDACTED], whatever field it is in", () => {
    const record: AuditLogExportRecord = exported(
      [
        {
          field: "anything",
          oldValue: { _type: "HashedString", value: "old-hash-1234" },
          newValue: { _type: "HashedString", value: "new-hash-5678" },
          summary: ["Changed value"],
        },
      ],
      2,
    );

    expect(record.changes).toEqual([
      {
        field: "anything",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
        summary: null,
      },
    ]);
    expect(serializeAuditLogExportRecord(record)).not.toContain("hash-");
  });

  test("the line keeps its keys in the schema's order, and holds no _type", () => {
    const line: string = serializeAuditLogExportRecord(
      exported([RELEASED_NUMBER], 2),
    );

    expect(Object.keys(JSON.parse(line))).toEqual([
      ...AUDIT_LOG_EXPORT_RECORD_KEYS,
    ]);
    expect(line).not.toContain("_type");
    expect(line).toContain('"oldValue":"+14155550100"');
  });
});

describe("what is not a typed value goes out as recorded", () => {
  test("an entry with none is the same record", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith([
        { field: "name", oldValue: "Support", newValue: "Support line" },
        { field: "isEnabled", oldValue: true, newValue: false },
      ]),
      2,
    )!;

    expect(readAuditLogExportTypedValues(record)).toBe(record);
  });

  test("an entry recorded today, with the number as text, is the same record", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith([
        {
          field: "routingPhoneNumber",
          oldValue: "+14155550100",
          newValue: null,
        },
      ]),
      2,
    )!;

    expect(readAuditLogExportTypedValues(record)).toBe(record);
  });

  test("in an entry with both, only the typed change is read, and the others are the same objects", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith([
        { field: "name", oldValue: "Support", newValue: "Support line" },
        RELEASED_NUMBER,
        {
          field: "settings",
          oldValue: { to: { _type: "Email", value: "a@example.com" } },
          newValue: { to: { _type: "Email", value: "b@example.com" } },
          summary: ["Changed to › value"],
        },
      ]),
      2,
    )!;
    const read: AuditLogExportRecord = readAuditLogExportTypedValues(record);

    expect(read).not.toBe(record);
    expect(read.changes[0]).toBe(record.changes[0]);
    expect(read.changes[1]).toEqual({
      field: "routingPhoneNumber",
      oldValue: "+14155550100",
      newValue: null,
      summary: null,
    });
    // A typed value inside a setting stays part of that setting.
    expect(read.changes[2]).toBe(record.changes[2]);
    // The record read is not changed.
    expect(record.changes[1]!.oldValue).toEqual({
      _type: "Phone",
      value: "+14155550100",
    });
  });

  test("a filter and a structure stay JSON", () => {
    const changes: Array<JSONValue> = [
      {
        field: "query",
        oldValue: { _type: "EqualTo", value: "checkout" },
        newValue: { _type: "EqualTo", value: "payments" },
        summary: ["Changed value"],
      },
      {
        field: "monitorSteps",
        oldValue: { _type: "MonitorSteps", value: { steps: [] } },
        newValue: null,
        summary: ["Changed the value"],
      },
    ];
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith(changes),
      2,
    )!;

    expect(readAuditLogExportTypedValues(record)).toBe(record);
  });
});

/*
 * Over generated rows - typed values of every kind as an old entry holds
 * them, beside text, numbers, switches, JSON and summaries - in both
 * versions: no value goes out as a typed value's JSON, everything else
 * goes out as it was read, keys and their order stay, and reading twice
 * reads nothing more.
 */
describe("a seeded sweep of old entries", () => {
  const TEXTS: Array<string> = generatedTexts(300, 63250, [
    "a",
    " ",
    "+",
    "1",
    "@",
    "é",
    "🔑",
    '"',
    "{",
    "_type",
    "value",
  ]);

  function pick<T>(random: SeededRandom, items: ReadonlyArray<T>): T {
    return items[random(items.length)]!;
  }

  function typedValue(random: SeededRandom): JSONObject {
    switch (random(6)) {
      case 0:
        return {
          _type: "Phone",
          value: `+1415555${String(1000 + random(9000))}`,
        };
      case 1:
        return { _type: "Email", value: `${pick(random, TEXTS)}@example.com` };
      case 2:
        return { _type: "Port", value: 1 + random(65535) };
      case 3:
        return { _type: "URL", value: `https://example.com/${random(999)}` };
      case 4:
        return { _type: "Name", value: pick(random, TEXTS) };
      default:
        return { _type: "HashedString", value: `hash-${random(1000000)}` };
    }
  }

  function value(random: SeededRandom): JSONValue {
    switch (random(7)) {
      case 0:
        return null;
      case 1:
      case 2:
        return typedValue(random);
      case 3:
        return pick(random, TEXTS);
      case 4:
        return random(1000);
      case 5:
        return random() < 0.5;
      default:
        return { [pick(random, TEXTS)]: typedValue(random) };
    }
  }

  function change(random: SeededRandom): JSONObject {
    const entry: JSONObject = { field: `field${random(20)}` };

    if (random() < 0.8) {
      entry["oldValue"] = value(random);
    }

    if (random() < 0.8) {
      entry["newValue"] = value(random);
    }

    if (random() < 0.6) {
      entry["summary"] = pick(random, [
        ["Changed value"],
        ["Changed the value"],
        [pick(random, TEXTS)],
        null,
      ] as Array<JSONValue>);
    }

    return entry;
  }

  test("1,500 rows, both versions", () => {
    const random: SeededRandom = seededRandom(6325);
    const problems: Array<string> = [];

    for (let index: number = 0; index < 1500; index++) {
      const changes: Array<JSONValue> = [];

      for (let count: number = random(5); count > 0; count--) {
        changes.push(change(random));
      }

      for (const version of [1, 2] as Array<AuditLogExportSchemaVersion>) {
        const record: AuditLogExportRecord = toAuditLogExportRecord(
          rowWith(changes),
          version,
        )!;
        const read: AuditLogExportRecord =
          readAuditLogExportTypedValues(record);
        const line: string = serializeAuditLogExportRecord(read);

        if (readAuditLogExportTypedValues(read) !== read) {
          problems.push(`${index} v${version}: read twice reads more`);
        }

        if (
          JSON.stringify(Object.keys(JSON.parse(line))) !==
          JSON.stringify(AUDIT_LOG_EXPORT_RECORD_KEYS)
        ) {
          problems.push(`${index} v${version}: keys moved`);
        }

        if (line.includes('"_type":"HashedString"') || line.includes("hash-")) {
          problems.push(`${index} v${version}: a hash left`);
        }

        read.changes.forEach(
          (readChange: AuditLogExportChange, position: number): void => {
            const original: AuditLogExportChange = record.changes[position]!;
            const wasTyped: boolean =
              readAuditLogTypedValue(original.oldValue) !== null ||
              readAuditLogTypedValue(original.newValue) !== null;
            // A hash inside JSON is a secret too, read as the marker.
            const holdsHash: boolean = JSON.stringify(original).includes(
              '"_type":"HashedString"',
            );

            if (
              readAuditLogTypedValue(readChange.oldValue) !== null ||
              readAuditLogTypedValue(readChange.newValue) !== null
            ) {
              problems.push(`${index} v${version}: a typed value left`);
            }

            if (!wasTyped && !holdsHash && readChange !== original) {
              problems.push(`${index} v${version}: an untyped change read`);
            }

            // A summary goes only with a whole typed value made plain.
            if (
              !wasTyped &&
              JSON.stringify(readChange.summary) !==
                JSON.stringify(original.summary)
            ) {
              problems.push(`${index} v${version}: a summary dropped`);
            }

            if (
              JSON.stringify(Object.keys(readChange)) !==
              JSON.stringify(Object.keys(original))
            ) {
              problems.push(`${index} v${version}: a change's keys changed`);
            }

            if (version === 1 && "summary" in readChange) {
              problems.push(`${index} v1: a summary`);
            }
          },
        );
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("what the recorder writes now goes out the same", () => {
  test("a Phone, an Email and a Port recorded today are what an old entry reads as", () => {
    const today: Array<JSONValue> = [
      {
        field: "routingPhoneNumber",
        oldValue: new Phone("+14155550100").toString(),
        newValue: null,
      },
      {
        field: "fromEmail",
        oldValue: new Email("alerts@example.com").toString(),
        newValue: new Email("status@example.com").toString(),
      },
      { field: "port", oldValue: new Port(587).toNumber(), newValue: 2525 },
    ];
    const before: Array<JSONValue> = [
      {
        field: "routingPhoneNumber",
        oldValue: JSON.parse(JSON.stringify(new Phone("+14155550100"))),
        newValue: null,
      },
      {
        field: "fromEmail",
        oldValue: JSON.parse(JSON.stringify(new Email("alerts@example.com"))),
        newValue: JSON.parse(JSON.stringify(new Email("status@example.com"))),
      },
      {
        field: "port",
        oldValue: JSON.parse(JSON.stringify(new Port(587))),
        newValue: JSON.parse(JSON.stringify(new Port(2525))),
      },
    ];

    for (const version of [1, 2] as Array<AuditLogExportSchemaVersion>) {
      expect(serializeAuditLogExportRecord(exported(before, version))).toBe(
        serializeAuditLogExportRecord(exported(today, version)),
      );
    }
  });
});
