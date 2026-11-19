import { describe, expect, test } from "@jest/globals";
import {
  FindingSampleRecord,
  getFindingSampleRecordKey,
  MAX_FINDING_SAMPLE_RECORDS,
  MAX_SAMPLE_RECORD_ID_LENGTH,
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
