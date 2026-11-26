import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import {
  AuditLogRelatedRecord,
  AuditLogRelatedRecordState,
  AuditLogRelatedRecords,
  MAX_AUDIT_LOG_RELATED_NAME_LENGTH,
  readAuditLogRecordId,
  readAuditLogRecordIds,
  readAuditLogRecordedName,
  readAuditLogRelatedRecords,
  toAuditLogRelatedRecordsJSON,
} from "../../../Utils/AuditLog/AuditLogRelatedRecords";

/*
 * What a change's value says of the records it names, and the answer the
 * changes dialog reads their names from (#10470): the server and the
 * dashboard read both alike.
 */

const A: string = "10470000-0000-4000-8000-0000000000a1";
const B: string = "10470000-0000-4000-8000-0000000000b1";

describe("the records a change's value names", () => {
  test("an id, a { _id, name } and a list of either, each once, in lower case and in order", () => {
    expect(readAuditLogRecordIds(A)).toEqual([A]);
    expect(readAuditLogRecordIds(A.toUpperCase())).toEqual([A]);
    expect(readAuditLogRecordIds(new ObjectID(A))).toEqual([A]);
    expect(readAuditLogRecordIds({ _id: B, name: "EU" })).toEqual([B]);
    expect(
      readAuditLogRecordIds([{ _id: B }, A, { _id: B, name: "EU" }]),
    ).toEqual([B, A]);
  });

  test("anything else names nothing: text, numbers, an empty value, a hidden one", () => {
    expect(readAuditLogRecordIds("Operational")).toEqual([]);
    expect(readAuditLogRecordIds(42)).toEqual([]);
    expect(readAuditLogRecordIds(null)).toEqual([]);
    expect(readAuditLogRecordIds("[HIDDEN]")).toEqual([]);
    expect(readAuditLogRecordIds({ name: "no id" })).toEqual([]);
    expect(readAuditLogRecordId({ _id: 7 })).toBeNull();
  });

  test("the name a value recorded for one of its records", () => {
    expect(
      readAuditLogRecordedName([{ _id: A, name: " Prod " }, { _id: B }], A),
    ).toBe("Prod");
    expect(readAuditLogRecordedName([{ _id: B }], B)).toBeNull();
    expect(readAuditLogRecordedName(A, A)).toBeNull();
  });
});

describe("the answer the dialog reads", () => {
  test("is sent and read back as it was", () => {
    const records: AuditLogRelatedRecords = new Map<
      string,
      Map<string, AuditLogRelatedRecord>
    >([
      [
        "labels",
        new Map<string, AuditLogRelatedRecord>([
          [A, { state: AuditLogRelatedRecordState.Named, name: "Production" }],
          [B, { state: AuditLogRelatedRecordState.Deleted, name: "Legacy" }],
        ]),
      ],
      [
        "securityCaseId",
        new Map<string, AuditLogRelatedRecord>([
          [A, { state: AuditLogRelatedRecordState.Hidden }],
        ]),
      ],
    ]);

    const json: ReturnType<typeof toAuditLogRelatedRecordsJSON> =
      toAuditLogRelatedRecordsJSON(records);

    expect(json).toEqual({
      fields: {
        labels: {
          [A]: { state: "Named", name: "Production" },
          [B]: { state: "Deleted", name: "Legacy" },
        },
        securityCaseId: { [A]: { state: "Hidden" } },
      },
    });
    expect(
      readAuditLogRelatedRecords(JSON.parse(JSON.stringify(json))),
    ).toEqual(records);
  });

  test("anything that is not an answer is left out: a hidden record never carries a name, a named one always does", () => {
    const records: AuditLogRelatedRecords = readAuditLogRelatedRecords({
      fields: {
        labels: {
          [A]: { state: "Hidden", name: "Should not show" },
          [B]: { state: "Named" },
          "not-an-id": { state: "Named", name: "x" },
        },
        status: { [A]: { state: "Somehow", name: "x" } },
        bad: "nope",
      },
    });

    expect(records.get("labels")?.get(A)).toEqual({
      state: AuditLogRelatedRecordState.Hidden,
    });
    expect(records.get("labels")?.has(B)).toBe(false);
    expect(records.get("labels")?.size).toBe(1);
    expect(records.has("status")).toBe(false);
    expect(records.has("bad")).toBe(false);
    expect(readAuditLogRelatedRecords(null).size).toBe(0);
    expect(readAuditLogRelatedRecords({ fields: [] }).size).toBe(0);
  });

  test("a name is read back to a bound", () => {
    const records: AuditLogRelatedRecords = readAuditLogRelatedRecords({
      fields: {
        labels: { [A]: { state: "Named", name: "x".repeat(1000) } },
      },
    });

    expect(records.get("labels")?.get(A)?.name?.length).toBe(
      MAX_AUDIT_LOG_RELATED_NAME_LENGTH,
    );
  });
});
