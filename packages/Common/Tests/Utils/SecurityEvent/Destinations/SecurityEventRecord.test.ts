import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import {
  SECURITY_EVENT_RECORD_COLUMNS,
  SecurityEventRecord,
  readClickhouseDate,
  readSecurityEventRecord,
} from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";

/*
 * A destination reads stored events as ClickHouse answers them: DateTime64
 * as "YYYY-MM-DD hh:mm:ss.sss" in UTC, numbers sometimes as text, maps as
 * objects. The reader turns that into one plain record, and every column it
 * asks for is a real column of the table.
 */
describe("readSecurityEventRecord", () => {
  test("reads a row as ClickHouse answers it", () => {
    const record: SecurityEventRecord = readSecurityEventRecord({
      _id: "0192f1a0-0000-7000-8000-000000000301",
      time: "2026-10-19 10:00:00.123",
      createdAt: "2026-10-19 10:00:05",
      eventUid: "evt",
      categoryUid: "2",
      categoryName: "Findings",
      classUid: 2004,
      className: "Detection Finding",
      activityName: "Create",
      severityId: "4",
      severityName: "High",
      statusName: "",
      message: "found",
      vendorName: "OneUptime",
      productName: "OneUptime Detections",
      ruleId: "r1",
      ruleName: "Rule",
      mitreTactics: ["TA0006", ""],
      mitreTechniques: ["T1110"],
      principalUser: "admin",
      principalHost: "",
      principalIp: "203.0.113.7",
      principalProcess: "",
      targetUser: "",
      targetHost: "web-03",
      targetIp: "",
      targetPort: "22",
      targetResource: "",
      observables: ["admin", "203.0.113.7"],
      attributes: { "a.b": "c", n: 5 },
    });

    expect(record.id).toBe("0192f1a0-0000-7000-8000-000000000301");
    expect(record.time.toISOString()).toBe("2026-10-19T10:00:00.123Z");
    expect(record.createdAt?.toISOString()).toBe("2026-10-19T10:00:05.000Z");
    expect(record.categoryUid).toBe(2);
    expect(record.severityId).toBe(4);
    expect(record.targetPort).toBe(22);
    expect(record.mitreTactics).toEqual(["TA0006"]);
    expect(record.attributes).toEqual({ "a.b": "c", n: "5" });
  });

  test("missing or broken values read as empty, never as a crash", () => {
    const record: SecurityEventRecord = readSecurityEventRecord({
      time: "not a date",
      categoryUid: "x",
      mitreTactics: "not an array",
      attributes: ["not", "a", "map"],
    });

    expect(record.id).toBe("");
    expect(record.time.getTime()).toBe(0);
    expect(record.createdAt).toBeNull();
    expect(record.categoryUid).toBe(0);
    expect(record.mitreTactics).toEqual([]);
    expect(record.attributes).toEqual({});
    expect(record.message).toBe("");
  });

  test("dates in every shape a reader may hand over", () => {
    expect(readClickhouseDate("2026-10-19 10:00:00")?.toISOString()).toBe(
      "2026-10-19T10:00:00.000Z",
    );
    expect(readClickhouseDate("2026-10-19T10:00:00.000Z")?.toISOString()).toBe(
      "2026-10-19T10:00:00.000Z",
    );
    expect(
      readClickhouseDate(new Date("2026-10-19T10:00:00.000Z"))?.toISOString(),
    ).toBe("2026-10-19T10:00:00.000Z");
    expect(readClickhouseDate("")).toBeNull();
    expect(readClickhouseDate(null)).toBeNull();
    expect(readClickhouseDate(new Date("nope"))).toBeNull();
  });

  test("every column a destination reads is a column of the SecurityEvent table", () => {
    const columns: Array<string> = new SecurityEvent()
      .getTableColumns()
      .map((column: { key: string }): string => {
        return column.key;
      });

    for (const column of SECURITY_EVENT_RECORD_COLUMNS) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }
  });
});
