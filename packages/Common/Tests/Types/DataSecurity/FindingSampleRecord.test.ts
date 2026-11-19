import { describe, expect, test } from "@jest/globals";
import {
  FindingSampleRecord,
  getFindingSampleRecordKey,
  MAX_FINDING_SAMPLE_RECORDS,
  MAX_SAMPLE_RECORD_ID_LENGTH,
  MAX_SAMPLE_RECORD_METRIC_NAME_LENGTH,
  readFindingSampleRecords,
  toFindingSampleRecord,
} from "../../../Types/DataSecurity/FindingSampleRecord";

/*
 * THE RECORDS A TELEMETRY SCAN FOUND A FINDING'S DATA IN (issue #9549).
 *
 * A reference is a record's time, to the millisecond, and the ids that
 * tell it from its neighbours - never a value. What a finding keeps is
 * read defensively: anything else in the column reads as none.
 */

const TIME: number = Date.UTC(2026, 9, 27, 11, 59, 58, 123);

describe("a record as a reference", () => {
  test("its time to the millisecond, from a Date, a number or ISO text, and the ids it has", () => {
    const expected: FindingSampleRecord = {
      time: "2026-10-27T11:59:58.123Z",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    };

    for (const time of [
      new Date(TIME),
      TIME,
      "2026-10-27T11:59:58.123Z",
    ] as Array<unknown>) {
      expect(
        toFindingSampleRecord({
          time,
          traceId: " 4bf92f3577b34da6a3ce929d0e0e4736 ",
          spanId: "00f067aa0ba902b7",
          sessionId: "",
        }),
      ).toEqual(expected);
    }
  });

  test("no time it was written, no reference", () => {
    for (const time of [undefined, null, "", "nope", 0, -5, NaN, {}]) {
      expect(toFindingSampleRecord({ time })).toBe(null);
    }
  });

  test("an id that is not text, or too long to be one, is left out", () => {
    expect(
      toFindingSampleRecord({
        time: TIME,
        traceId: 42,
        spanId: "x".repeat(MAX_SAMPLE_RECORD_ID_LENGTH + 1),
        sessionId: "session-1",
      }),
    ).toEqual({ time: "2026-10-27T11:59:58.123Z", sessionId: "session-1" });
  });

  test("two references to one record have one key; any difference tells them apart", () => {
    const record: FindingSampleRecord = {
      time: "2026-10-27T11:59:58.123Z",
      spanId: "a",
    };

    expect(getFindingSampleRecordKey(record)).toBe(
      getFindingSampleRecordKey({ ...record }),
    );
    expect(getFindingSampleRecordKey(record)).not.toBe(
      getFindingSampleRecordKey({ ...record, spanId: "b" }),
    );
    expect(getFindingSampleRecordKey(record)).not.toBe(
      getFindingSampleRecordKey({ ...record, sessionId: "a", spanId: "" }),
    );
  });
});

describe("what a finding keeps, read back", () => {
  test("records in the order kept, each once, ten at most", () => {
    const kept: Array<unknown> = [];

    for (let index: number = 0; index < 14; index++) {
      kept.push({ time: new Date(TIME - index * 1000).toISOString() });
    }

    kept.splice(1, 0, kept[0]);

    const read: Array<FindingSampleRecord> = readFindingSampleRecords(kept);

    expect(read.length).toBe(MAX_FINDING_SAMPLE_RECORDS);
    expect(read[0]).toEqual({ time: new Date(TIME).toISOString() });
    expect(read[1]).toEqual({ time: new Date(TIME - 1000).toISOString() });
  });

  test("anything that is no record reads as none, and nothing but a record's keys is read", () => {
    expect(readFindingSampleRecords(null)).toEqual([]);
    expect(readFindingSampleRecords("records")).toEqual([]);
    expect(readFindingSampleRecords({ time: TIME })).toEqual([]);
    expect(
      readFindingSampleRecords([
        null,
        "x",
        [TIME],
        { time: "never" },
        {
          time: TIME,
          traceId: "t",
          value: "jane.doe@acme-corp.com",
          body: "Signed up jane.doe@acme-corp.com",
        },
      ]),
    ).toEqual([{ time: "2026-10-27T11:59:58.123Z", traceId: "t" }]);
  });
});

/*
 * A METRIC'S DATA POINT (issue #9604): every series of a metric is written
 * in the same millisecond, so a point is kept with the metric it is a
 * point of - which the metrics table is keyed by before the time.
 */
describe("a metric's data point as a reference", () => {
  test("keeps its metric's name as written, spaces and case and all", () => {
    expect(
      toFindingSampleRecord({ time: TIME, metricName: "http.server.Duration" }),
    ).toEqual({
      time: "2026-10-27T11:59:58.123Z",
      metricName: "http.server.Duration",
    });
    // Matched exactly by the read: never trimmed.
    expect(
      toFindingSampleRecord({ time: TIME, metricName: " padded " })?.metricName,
    ).toBe(" padded ");
  });

  test("a blank name, a name too long to be a key, or not a name, is none", () => {
    for (const metricName of [
      "",
      "   ",
      "m".repeat(MAX_SAMPLE_RECORD_METRIC_NAME_LENGTH + 1),
      42,
      null,
      ["user.logins"],
    ] as Array<unknown>) {
      expect(toFindingSampleRecord({ time: TIME, metricName })).toEqual({
        time: "2026-10-27T11:59:58.123Z",
      });
    }

    expect(
      toFindingSampleRecord({
        time: TIME,
        metricName: "m".repeat(MAX_SAMPLE_RECORD_METRIC_NAME_LENGTH),
      })?.metricName?.length,
    ).toBe(MAX_SAMPLE_RECORD_METRIC_NAME_LENGTH);
  });

  test("two metrics' points of the same millisecond are two records; the same point is kept once", () => {
    const logins: FindingSampleRecord = {
      time: "2026-10-27T11:59:58.123Z",
      metricName: "user.logins",
    };
    const signups: FindingSampleRecord = {
      ...logins,
      metricName: "user.signups",
    };

    expect(getFindingSampleRecordKey(logins)).not.toBe(
      getFindingSampleRecordKey(signups),
    );
    expect(readFindingSampleRecords([logins, signups, { ...logins }])).toEqual([
      logins,
      signups,
    ]);
  });
});
