import { describe, expect, test } from "@jest/globals";
import AuditLog from "../../../../Models/AnalyticsModels/AuditLog";
import {
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AUDIT_LOG_EXPORT_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_SOURCE_COLUMNS,
  AUDIT_LOG_EXPORT_TEST_ACTION,
  AuditLogExportRecord,
  buildAuditLogExportTestRecord,
  readAuditLogExportChanges,
  readAuditLogExportDate,
  serializeAuditLogExportRecord,
  toAuditLogExportRecord,
} from "../../../../Types/AuditLog/Export/AuditLogExportRecord";
import { JSONObject } from "../../../../Types/JSON";

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

describe("the export record schema (version 1)", () => {
  test("is version 1, with these keys in this order", () => {
    expect(AUDIT_LOG_EXPORT_SCHEMA_VERSION).toBe(1);
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
    const shuffled: AuditLogExportRecord = {
      changes: record.changes,
      ...record,
    };

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
