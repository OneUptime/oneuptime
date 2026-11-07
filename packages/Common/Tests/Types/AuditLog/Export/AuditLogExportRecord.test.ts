import { describe, expect, test } from "@jest/globals";
import AuditLog from "../../../../Models/AnalyticsModels/AuditLog";
import {
  AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AUDIT_LOG_EXPORT_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_SCHEMA_VERSIONS,
  AUDIT_LOG_EXPORT_SOURCE_COLUMNS,
  AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_TEST_ACTION,
  AuditLogExportChange,
  AuditLogExportRecord,
  buildAuditLogExportTestRecord,
  isAuditLogExportSchemaVersion,
  readAuditLogExportChanges,
  readAuditLogExportDate,
  readAuditLogExportSchemaVersion,
  readAuditLogExportSummary,
  serializeAuditLogExportRecord,
  toAuditLogExportRecord,
} from "../../../../Types/AuditLog/Export/AuditLogExportRecord";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";

/*
 * The JSON object every destination receives for one audit log entry. Its
 * schema is a contract with whatever reads the export - an Athena table, a
 * SIEM's parser - so these pin it: every key, in order, always present.
 */

const ENTRY_ID: string = "0192f5a1-7c2e-7b1a-9c3d-4e5f60718293";
const PROJECT_ID: string = "6d2c3b4a-5e6f-4a1b-8c9d-0e1f2a3b4c5d";

// A row as the audit table answers it in JSON (ClickHouse's JSON format).
const clickhouseRow: () => JSONObject = (): JSONObject => {
  return {
    _id: ENTRY_ID,
    createdAt: "2026-10-24 09:15:03",
    projectId: PROJECT_ID,
    action: "Update",
    resourceType: "Monitor",
    resourceId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    resourceName: "API health",
    rootResourceType: "Monitor",
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
    changes: JSON.stringify([
      { field: "name", oldValue: "API", newValue: "API health" },
      { field: "isEnabled", oldValue: true, newValue: false },
    ]),
  };
};

describe("the export record schema", () => {
  test("its newest version is 2, and every version has these keys in this order", () => {
    expect(AUDIT_LOG_EXPORT_SCHEMA_VERSION).toBe(2);
    expect([...AUDIT_LOG_EXPORT_RECORD_KEYS]).toEqual([
      "schemaVersion",
      "id",
      "createdAt",
      "projectId",
      "action",
      "resourceType",
      "resourceId",
      "resourceName",
      "rootResourceType",
      "rootResourceId",
      "userId",
      "userName",
      "userEmail",
      "userType",
      "apiKeyId",
      "apiKeyName",
      "mcpOAuthGrantId",
      "mcpClientName",
      "workflowId",
      "workflowName",
      "changes",
    ]);
  });

  test("reads only columns the audit log has, under the API reference's names", () => {
    const model: AuditLog = new AuditLog();
    const columns: Array<string> = model
      .getTableColumns()
      .map((column: { key: string }): string => {
        return column.key;
      });

    for (const column of AUDIT_LOG_EXPORT_SOURCE_COLUMNS) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }
  });

  test("every record key but schemaVersion and id is a column of the same name", () => {
    for (const key of AUDIT_LOG_EXPORT_RECORD_KEYS) {
      if (key === "schemaVersion") {
        continue;
      }

      expect(AUDIT_LOG_EXPORT_SOURCE_COLUMNS).toContain(
        key === "id" ? "_id" : key,
      );
    }
  });

  test("leaves out the retention date, which is the store's and no reader's", () => {
    expect(AUDIT_LOG_EXPORT_SOURCE_COLUMNS).not.toContain("retentionDate");
    expect(AUDIT_LOG_EXPORT_RECORD_KEYS).not.toContain(
      "retentionDate" as keyof AuditLogExportRecord,
    );
  });
});

describe("toAuditLogExportRecord", () => {
  test("maps a row column by column, the time as ISO 8601 in UTC", () => {
    expect(toAuditLogExportRecord(clickhouseRow())).toEqual({
      schemaVersion: 1,
      id: ENTRY_ID,
      createdAt: "2026-10-24T09:15:03.000Z",
      projectId: PROJECT_ID,
      action: "Update",
      resourceType: "Monitor",
      resourceId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      resourceName: "API health",
      rootResourceType: "Monitor",
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
      changes: [
        { field: "name", oldValue: "API", newValue: "API health" },
        { field: "isEnabled", oldValue: true, newValue: false },
      ],
    });
  });

  test("every key is present, null when the entry has no value", () => {
    const record: AuditLogExportRecord | null = toAuditLogExportRecord({
      _id: ENTRY_ID,
      createdAt: "2026-10-24 09:15:03",
    });

    expect(record).not.toBeNull();
    expect(Object.keys(record!)).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);

    for (const key of AUDIT_LOG_EXPORT_RECORD_KEYS) {
      if (
        key === "schemaVersion" ||
        key === "id" ||
        key === "createdAt" ||
        key === "changes"
      ) {
        continue;
      }

      expect([key, record![key]]).toEqual([key, null]);
    }

    expect(record!.changes).toEqual([]);
  });

  test("an empty string reads as null, not as a value", () => {
    const row: JSONObject = { ...clickhouseRow(), resourceName: "" };

    expect(toAuditLogExportRecord(row)?.resourceName).toBeNull();
  });

  test("a row with no id or no time is left out", () => {
    expect(toAuditLogExportRecord({ createdAt: "2026-10-24 09:15:03" })).toBe(
      null,
    );
    expect(toAuditLogExportRecord({ _id: ENTRY_ID })).toBeNull();
    expect(
      toAuditLogExportRecord({ _id: ENTRY_ID, createdAt: "not a date" }),
    ).toBeNull();
  });

  test("a Download keeps only the values after", () => {
    const record: AuditLogExportRecord | null = toAuditLogExportRecord({
      ...clickhouseRow(),
      action: "Download",
      changes: [{ field: "interfaceName", newValue: "eth0" }],
    });

    expect(record?.changes).toEqual([
      { field: "interfaceName", newValue: "eth0" },
    ]);
    expect(Object.keys(record!.changes[0]!)).toEqual(["field", "newValue"]);
  });
});

describe("readAuditLogExportChanges", () => {
  test("reads the JSON text the column stores, or an already parsed array", () => {
    const changes: Array<JSONObject> = [
      { field: "name", oldValue: "a", newValue: "b" },
    ];

    expect(readAuditLogExportChanges(JSON.stringify(changes))).toEqual(changes);
    expect(readAuditLogExportChanges(changes)).toEqual(changes);
  });

  test("anything that is not an array of { field } is left out", () => {
    expect(readAuditLogExportChanges("not json")).toEqual([]);
    expect(readAuditLogExportChanges("")).toEqual([]);
    expect(readAuditLogExportChanges('{"field":"x"}')).toEqual([]);
    expect(readAuditLogExportChanges(undefined)).toEqual([]);
    expect(
      readAuditLogExportChanges(
        JSON.stringify([
          null,
          7,
          "x",
          [],
          { oldValue: 1 },
          { field: "" },
          { field: "kept", newValue: { nested: [1, 2] } },
        ]),
      ),
    ).toEqual([{ field: "kept", newValue: { nested: [1, 2] } }]);
  });

  test("a value recorded as undefined is written as null, never dropped", () => {
    expect(
      readAuditLogExportChanges([
        { field: "description", oldValue: null, newValue: "set" },
      ]),
    ).toEqual([{ field: "description", oldValue: null, newValue: "set" }]);
  });
});

describe("readAuditLogExportDate", () => {
  test("reads ClickHouse's UTC text, an ISO string and a Date", () => {
    expect(readAuditLogExportDate("2026-10-24 09:15:03")?.toISOString()).toBe(
      "2026-10-24T09:15:03.000Z",
    );
    expect(
      readAuditLogExportDate("2026-10-24T09:15:03.000Z")?.toISOString(),
    ).toBe("2026-10-24T09:15:03.000Z");
    expect(
      readAuditLogExportDate(new Date("2026-10-24T09:15:03Z"))?.toISOString(),
    ).toBe("2026-10-24T09:15:03.000Z");
  });

  test("anything else is no date", () => {
    expect(readAuditLogExportDate("")).toBeNull();
    expect(readAuditLogExportDate(undefined)).toBeNull();
    expect(readAuditLogExportDate("yesterday")).toBeNull();
    expect(readAuditLogExportDate(new Date("nope"))).toBeNull();
  });
});

describe("serializeAuditLogExportRecord", () => {
  test("writes the keys in schema order, whatever order the object holds them in", () => {
    const record: AuditLogExportRecord =
      toAuditLogExportRecord(clickhouseRow())!;
    // The same entry with its keys the other way round.
    const shuffled: AuditLogExportRecord = Object.fromEntries(
      Object.entries(record).reverse(),
    ) as unknown as AuditLogExportRecord;

    expect(Object.keys(shuffled)[0]).toBe("changes");

    expect(
      Object.keys(JSON.parse(serializeAuditLogExportRecord(shuffled))),
    ).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);
  });

  test("is one line even when a value holds line breaks", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord({
      ...clickhouseRow(),
      resourceName: "line one\nline two\r\nthree\u{2028}four",
      changes: [{ field: "description", newValue: "a\nb" }],
    })!;

    const line: string = serializeAuditLogExportRecord(record);

    expect(line.includes("\n")).toBe(false);
    expect(line.includes("\r")).toBe(false);
    // Python's splitlines() splits on the Unicode line separator too.
    expect(line.includes(String.fromCharCode(0x2028))).toBe(false);
    expect(line.includes(String.fromCharCode(0x2029))).toBe(false);
    expect(JSON.parse(line).resourceName).toBe(
      "line one\nline two\r\nthree\u{2028}four",
    );
  });
});

describe("the test record", () => {
  test("says it is a test, in the real shape, naming no project data", () => {
    const record: AuditLogExportRecord = buildAuditLogExportTestRecord({
      now: new Date("2026-10-24T09:15:03.123Z"),
      id: ENTRY_ID,
      projectId: PROJECT_ID,
    });

    expect(record.action).toBe(AUDIT_LOG_EXPORT_TEST_ACTION);
    expect(record.action).toBe("Test");
    expect(record.createdAt).toBe("2026-10-24T09:15:03.123Z");
    expect(record.projectId).toBe(PROJECT_ID);
    expect(record.changes).toEqual([]);
    expect(record.userId).toBeNull();
    expect(Object.keys(record)).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);
  });

  test("an instance export's test names no project", () => {
    expect(
      buildAuditLogExportTestRecord({
        now: new Date(),
        id: ENTRY_ID,
        projectId: null,
      }).projectId,
    ).toBeNull();
  });
});

/*
 * THE VERSIONS (issue #6247). An export says which version of the record it
 * sends: version 2 adds each change's summary lines; version 1 is the record
 * as it was first sent, byte for byte, so whatever reads an export saved
 * before version 2 existed keeps working without anyone doing anything.
 */
describe("the versions an export can send", () => {
  test("are 1 and 2: the first, the newest, and the first with summaries", () => {
    expect([...AUDIT_LOG_EXPORT_SCHEMA_VERSIONS]).toEqual([1, 2]);
    expect(AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION).toBe(1);
    expect(AUDIT_LOG_EXPORT_SCHEMA_VERSION).toBe(
      AUDIT_LOG_EXPORT_SCHEMA_VERSIONS[
        AUDIT_LOG_EXPORT_SCHEMA_VERSIONS.length - 1
      ],
    );
    expect(AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION).toBe(2);
  });

  test("a version is a whole number this release sends, nothing else", () => {
    expect(isAuditLogExportSchemaVersion(1)).toBe(true);
    expect(isAuditLogExportSchemaVersion(2)).toBe(true);

    for (const value of [0, 3, -1, 1.5, "1", "2", null, undefined, NaN, {}]) {
      expect([value, isAuditLogExportSchemaVersion(value)]).toEqual([
        value,
        false,
      ]);
    }
  });

  test("an export that holds none, or one this release does not know, sends version 1", () => {
    expect(readAuditLogExportSchemaVersion(2)).toBe(2);
    expect(readAuditLogExportSchemaVersion(1)).toBe(1);
    // A form's dropdown holds text.
    expect(readAuditLogExportSchemaVersion("2")).toBe(2);
    expect(readAuditLogExportSchemaVersion(" 2 ")).toBe(2);

    for (const value of [
      undefined,
      null,
      "",
      "  ",
      0,
      3,
      9,
      "3",
      "two",
      NaN,
      true,
      [2],
      { version: 2 },
    ]) {
      expect([value, readAuditLogExportSchemaVersion(value)]).toEqual([
        value,
        1,
      ]);
    }
  });

  test("with no version named, a row is read as version 1", () => {
    expect(toAuditLogExportRecord(clickhouseRow())).toEqual(
      toAuditLogExportRecord(clickhouseRow(), 1),
    );
    expect(readAuditLogExportChanges(clickhouseRow()["changes"])).toEqual(
      readAuditLogExportChanges(clickhouseRow()["changes"], 1),
    );
  });
});

describe("version 2: what changed, in plain lines", () => {
  const WORKFLOW_SAVE: JSONObject = {
    field: "graph",
    oldValue: "3 steps and 2 connections",
    newValue: "4 steps and 3 connections",
    summary: [
      'Added "Send Email" (send-email-1)',
      'Changed "To Email" in "Send Email" (send-email-1)',
    ],
  };

  function rowWith(changes: JSONArray | string): JSONObject {
    return {
      ...clickhouseRow(),
      changes: typeof changes === "string" ? changes : JSON.stringify(changes),
    };
  }

  test("a workflow save carries its summary lines, after its values", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith([WORKFLOW_SAVE]),
      2,
    )!;

    expect(record.schemaVersion).toBe(2);
    expect(record.changes).toEqual([WORKFLOW_SAVE]);
    expect(Object.keys(record.changes[0]!)).toEqual([
      "field",
      "oldValue",
      "newValue",
      "summary",
    ]);
  });

  test("a change without lines says so with null: the key is always there", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith([
        { field: "name", oldValue: "API", newValue: "API health" },
        { field: "headers", oldValue: null, newValue: {}, summary: [] },
      ]),
      2,
    )!;

    expect(record.changes).toEqual([
      { field: "name", oldValue: "API", newValue: "API health", summary: null },
      { field: "headers", oldValue: null, newValue: {}, summary: null },
    ]);
  });

  test("a create's and a download's changes keep only the values they had, and their lines", () => {
    expect(
      readAuditLogExportChanges(
        [
          { field: "graph", newValue: "1 step", summary: ['Added "Manual"'] },
          { field: "fileSizeInBytes", newValue: 120 },
        ],
        2,
      ),
    ).toEqual([
      { field: "graph", newValue: "1 step", summary: ['Added "Manual"'] },
      { field: "fileSizeInBytes", newValue: 120, summary: null },
    ]);
  });

  test("only text lines are read: a number, an object, a blank line or a non-list is left out", () => {
    expect(
      readAuditLogExportSummary([
        "Changed requestHeaders › Authorization",
        3,
        { line: "x" },
        "",
        "   ",
        null,
        ["nested"],
        "Removed requestHeaders › X-Old",
      ]),
    ).toEqual([
      "Changed requestHeaders › Authorization",
      "Removed requestHeaders › X-Old",
    ]);

    for (const value of [
      undefined,
      null,
      "a line",
      7,
      { 0: "a" },
      [],
      [1, 2],
    ]) {
      expect([value, readAuditLogExportSummary(value as JSONValue)]).toEqual([
        value,
        null,
      ]);
    }
  });

  test("a line is sent as it was recorded: never trimmed, never rewritten", () => {
    expect(readAuditLogExportSummary(['  Added "Log" (log-1)  '])).toEqual([
      '  Added "Log" (log-1)  ',
    ]);
  });

  test("a version 2 record is one line, a line separator in a summary escaped", () => {
    const line: string = serializeAuditLogExportRecord(
      toAuditLogExportRecord(
        rowWith([
          {
            field: "graph",
            summary: [`Added "a\nb\u{2028}c\u{2029}d" (step-1)`],
          },
        ]),
        2,
      )!,
    );

    expect(line.includes("\n")).toBe(false);
    expect(line.includes(String.fromCharCode(0x2028))).toBe(false);
    expect(line.includes(String.fromCharCode(0x2029))).toBe(false);
    expect(JSON.parse(line).changes[0].summary).toEqual([
      `Added "a\nb\u{2028}c\u{2029}d" (step-1)`,
    ]);
  });

  test("version 1 never sends the lines, though the entry recorded them", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      rowWith([WORKFLOW_SAVE]),
      1,
    )!;

    expect(record.schemaVersion).toBe(1);
    expect(record.changes).toEqual([
      {
        field: "graph",
        oldValue: "3 steps and 2 connections",
        newValue: "4 steps and 3 connections",
      },
    ]);
    expect(serializeAuditLogExportRecord(record)).not.toContain("summary");
  });

  test("each version's test entry says its version, with no changes", () => {
    for (const schemaVersion of AUDIT_LOG_EXPORT_SCHEMA_VERSIONS) {
      const record: AuditLogExportRecord = buildAuditLogExportTestRecord({
        now: new Date("2026-10-24T09:15:03.123Z"),
        id: ENTRY_ID,
        projectId: PROJECT_ID,
        schemaVersion,
      });

      expect(record.schemaVersion).toBe(schemaVersion);
      expect(record.changes).toEqual([]);
    }

    // A test that names no version is one of an export that never chose.
    expect(
      buildAuditLogExportTestRecord({
        now: new Date(),
        id: ENTRY_ID,
        projectId: null,
      }).schemaVersion,
    ).toBe(1);
  });
});

/*
 * THE GUARD: version 1 is what it always was. Below is the record's code
 * as it stood before there were versions, copied unchanged (readText,
 * readAuditLogExportDate, readChange, readAuditLogExportChanges,
 * toAuditLogExportRecord, serializeAuditLogExportRecord), and a seeded
 * sweep of rows - every kind of change the column can hold, summaries
 * included, as text and parsed - that a version 1 record must serialize to
 * exactly the line it wrote. Version 2 is that same line's record with
 * schemaVersion 2 and each change's summary added, nothing else.
 */
describe("version 1 is the record as it was first sent", () => {
  const LEGACY_KEYS: ReadonlyArray<string> = [
    "schemaVersion",
    "id",
    "createdAt",
    "projectId",
    "action",
    "resourceType",
    "resourceId",
    "resourceName",
    "rootResourceType",
    "rootResourceId",
    "userId",
    "userName",
    "userEmail",
    "userType",
    "apiKeyId",
    "apiKeyName",
    "mcpOAuthGrantId",
    "mcpClientName",
    "workflowId",
    "workflowName",
    "changes",
  ];

  function legacyReadText(value: JSONValue | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const text: string = typeof value === "string" ? value : String(value);

    return text.length > 0 ? text : null;
  }

  function legacyReadDate(value: JSONValue | Date | undefined): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const text: string | null = legacyReadText(value as JSONValue | undefined);

    if (!text) {
      return null;
    }

    const trimmed: string = text.trim();
    const isoText: string = trimmed.includes("T")
      ? trimmed
      : `${trimmed.replace(" ", "T")}Z`;
    const date: Date = new Date(isoText);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  function legacyReadChange(value: JSONValue): JSONObject | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const entry: JSONObject = value as JSONObject;
    const field: string | null = legacyReadText(entry["field"]);

    if (!field) {
      return null;
    }

    const change: JSONObject = { field };

    if (Object.prototype.hasOwnProperty.call(entry, "oldValue")) {
      change["oldValue"] =
        entry["oldValue"] === undefined
          ? null
          : (entry["oldValue"] as JSONValue);
    }

    if (Object.prototype.hasOwnProperty.call(entry, "newValue")) {
      change["newValue"] =
        entry["newValue"] === undefined
          ? null
          : (entry["newValue"] as JSONValue);
    }

    return change;
  }

  function legacyReadChanges(value: JSONValue | undefined): Array<JSONObject> {
    let parsed: unknown = value;

    if (typeof value === "string") {
      if (!value.trim()) {
        return [];
      }

      try {
        parsed = JSON.parse(value);
      } catch {
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const changes: Array<JSONObject> = [];

    for (const item of parsed as JSONArray) {
      const change: JSONObject | null = legacyReadChange(item);

      if (change) {
        changes.push(change);
      }
    }

    return changes;
  }

  function legacyLine(row: JSONObject): string | null {
    const id: string | null = legacyReadText(row["_id"]);
    const createdAt: Date | null = legacyReadDate(row["createdAt"]);

    if (!id || !createdAt) {
      return null;
    }

    const record: Record<string, unknown> = {
      schemaVersion: 1,
      id,
      createdAt: createdAt.toISOString(),
      projectId: legacyReadText(row["projectId"]),
      action: legacyReadText(row["action"]),
      resourceType: legacyReadText(row["resourceType"]),
      resourceId: legacyReadText(row["resourceId"]),
      resourceName: legacyReadText(row["resourceName"]),
      rootResourceType: legacyReadText(row["rootResourceType"]),
      rootResourceId: legacyReadText(row["rootResourceId"]),
      userId: legacyReadText(row["userId"]),
      userName: legacyReadText(row["userName"]),
      userEmail: legacyReadText(row["userEmail"]),
      userType: legacyReadText(row["userType"]),
      apiKeyId: legacyReadText(row["apiKeyId"]),
      apiKeyName: legacyReadText(row["apiKeyName"]),
      mcpOAuthGrantId: legacyReadText(row["mcpOAuthGrantId"]),
      mcpClientName: legacyReadText(row["mcpClientName"]),
      workflowId: legacyReadText(row["workflowId"]),
      workflowName: legacyReadText(row["workflowName"]),
      changes: legacyReadChanges(row["changes"]),
    };

    const ordered: Record<string, unknown> = {};

    for (const key of LEGACY_KEYS) {
      ordered[key] = record[key];
    }

    return JSON.stringify(ordered)
      .split(String.fromCharCode(0x2028))
      .join("\\u2028")
      .split(String.fromCharCode(0x2029))
      .join("\\u2029");
  }

  const TEXTS: Array<string> = generatedTexts(400, 6247, [
    "a",
    "Z",
    " ",
    "\n",
    "\u{2028}",
    "\u{2029}",
    '"',
    "\\",
    "é",
    "›",
    "🔑",
    "{",
    "}",
    "0",
  ]);

  function pick<T>(random: SeededRandom, items: ReadonlyArray<T>): T {
    return items[random(items.length)]!;
  }

  function value(random: SeededRandom, depth: number = 0): JSONValue {
    switch (random(depth > 1 ? 5 : 7)) {
      case 0:
        return null;
      case 1:
        return pick(random, TEXTS);
      case 2:
        return random(1000) - 500;
      case 3:
        return random() < 0.5;
      case 4:
        return "";
      case 5:
        return [value(random, depth + 1), value(random, depth + 1)];
      default:
        return { [pick(random, TEXTS)]: value(random, depth + 1) };
    }
  }

  function change(random: SeededRandom): JSONValue {
    switch (random(10)) {
      // Not a change at all, or one with no field: left out.
      case 0:
        return pick(random, [
          null,
          "text",
          3,
          [],
          ["graph"],
        ] as Array<JSONValue>);
      case 1:
        return { oldValue: "a", newValue: "b" };
      default: {
        const entry: JSONObject = {
          field: pick(random, [
            "graph",
            "name",
            "requestHeaders",
            "",
            "isEnabled",
          ]),
        };

        if (random() < 0.7) {
          entry["oldValue"] = value(random);
        }

        if (random() < 0.7) {
          entry["newValue"] = value(random);
        }

        // What the recorder writes, and what it never does.
        if (random() < 0.6) {
          entry["summary"] = pick(random, [
            [pick(random, TEXTS), pick(random, TEXTS)],
            [],
            null,
            "one line",
            [3, { a: "b" }, pick(random, TEXTS)],
          ] as Array<JSONValue>);
        }

        return entry;
      }
    }
  }

  function row(random: SeededRandom): JSONObject {
    const changes: Array<JSONValue> = [];
    const count: number = random(5);

    for (let index: number = 0; index < count; index++) {
      changes.push(change(random));
    }

    const columns: JSONObject = {
      _id: random() < 0.95 ? ENTRY_ID : pick(random, ["", null]),
      createdAt: pick(random, [
        "2026-10-24 09:15:03",
        "2026-10-24T09:15:03.000Z",
        "not a date",
      ]),
      changes:
        random() < 0.5
          ? JSON.stringify(changes)
          : (pick(random, [changes, "", "[", "{}", changes]) as JSONValue),
    };

    for (const key of LEGACY_KEYS) {
      if (!["schemaVersion", "id", "createdAt", "changes"].includes(key)) {
        columns[key] = pick(random, [null, "", pick(random, TEXTS), 7]);
      }
    }

    return columns;
  }

  test("a seeded sweep of rows: version 1 writes exactly the line the original code wrote", () => {
    const random: SeededRandom = seededRandom(6247);
    let compared: number = 0;

    for (let index: number = 0; index < 3000; index++) {
      const source: JSONObject = row(random);
      const expected: string | null = legacyLine(source);

      for (const record of [
        toAuditLogExportRecord(source, 1),
        toAuditLogExportRecord(source),
      ]) {
        expect([
          index,
          record ? serializeAuditLogExportRecord(record) : null,
        ]).toEqual([index, expected]);
      }

      if (expected) {
        compared += 1;
      }
    }

    /*
     * Most rows were placed - a third have no time, and a few no id, on
     * purpose - so the sweep compared lines, not nulls.
     */
    expect(compared).toBeGreaterThan(1500);
  });

  test("version 2 is the same record, version 2, with each change's lines added", () => {
    const random: SeededRandom = seededRandom(26247);

    for (let index: number = 0; index < 1500; index++) {
      const source: JSONObject = row(random);
      const first: AuditLogExportRecord | null = toAuditLogExportRecord(
        source,
        1,
      );
      const second: AuditLogExportRecord | null = toAuditLogExportRecord(
        source,
        2,
      );

      if (!first || !second) {
        expect([index, first, second]).toEqual([index, null, null]);
        continue;
      }

      const withoutLines: AuditLogExportRecord = {
        ...second,
        schemaVersion: 1,
        changes: second.changes.map(
          (entry: AuditLogExportChange): AuditLogExportChange => {
            expect(Object.prototype.hasOwnProperty.call(entry, "summary")).toBe(
              true,
            );
            expect(
              entry.summary === null ||
                (Array.isArray(entry.summary) &&
                  entry.summary.length > 0 &&
                  entry.summary.every((line: unknown): boolean => {
                    return typeof line === "string" && line.trim() !== "";
                  })),
            ).toBe(true);

            const rest: AuditLogExportChange = { ...entry };
            delete rest.summary;
            return rest;
          },
        ),
      };

      expect([index, serializeAuditLogExportRecord(withoutLines)]).toEqual([
        index,
        serializeAuditLogExportRecord(first),
      ]);
    }
  });
});
