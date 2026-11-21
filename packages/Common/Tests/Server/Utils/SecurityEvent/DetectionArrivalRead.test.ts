import * as DetectionArrivalRead from "../../../../Server/Utils/SecurityEvent/DetectionArrivalRead";
import {
  DETECTION_RUN_LATE_EVENT_SECONDS,
  DetectionRunArrival,
  DetectionWriteArrival,
  detectionArrivedBefore,
  detectionArrivedBy,
  isDetectionArrivalCandidate,
} from "../../../../Server/Utils/SecurityEvent/DetectionArrivalRead";
import * as SecurityEventServiceModule from "../../../../Server/Services/SecurityEventService";
import {
  QualifiedColumn,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import OneUptimeDate from "../../../../Types/Date";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import { describe, expect, test } from "@jest/globals";

/*
 * THE CONDITION BOTH READ BY (#10337, #10488).
 *
 * A scheduled detection rule judges what arrived since its last run, and a
 * scheduled hunt counts what arrived since its own, by one condition:
 * arrived in the range, within a day of when it happened. It is kept apart
 * from SecurityEventService so the statement generator compiles a hunt's
 * read with it, and the service re-exports every piece, so nothing that
 * imported them from there changed. A rule's own reads write it as they
 * always did; the generator names its columns through its own reference.
 */

const RUN: DetectionRunArrival = {
  kind: "run",
  arrivedAfter: new Date("2026-10-29T10:58:00.000Z"),
  arrivedUntil: new Date("2026-10-29T11:58:00.000Z"),
  candidateStartTime: new Date("2026-10-28T10:58:00.000Z"),
  candidateEndTime: new Date("2026-10-29T12:59:00.000Z"),
};

const WRITE: DetectionWriteArrival = {
  candidateIds: ["0192f1a0-0000-7000-8000-000000000001"],
  firstId: "0192f1a0-0000-7000-8000-000000000001",
  lastId: "0192f1a0-0000-7000-8000-000000000001",
  candidateStartTime: new Date("2026-10-29T11:00:00.000Z"),
  candidateEndTime: new Date("2026-10-29T11:00:02.000Z"),
};

describe("a run's arrivals", () => {
  test("a rule's own read writes the columns as it always did", () => {
    const statement: Statement = isDetectionArrivalCandidate(RUN);

    expect(statement.query).toBe(
      "(createdAt > {p0:DateTime} AND createdAt <= {p1:DateTime} AND time >= createdAt - toIntervalSecond({p2:Int32}))",
    );
    expect(statement.query_params).toStrictEqual({
      p0: OneUptimeDate.toClickhouseDateTime(RUN.arrivedAfter),
      p1: OneUptimeDate.toClickhouseDateTime(RUN.arrivedUntil),
      p2: DETECTION_RUN_LATE_EVENT_SECONDS,
    });
  });

  test("within a day of when it happened", () => {
    expect(DETECTION_RUN_LATE_EVENT_SECONDS).toBe(
      DETECTION_LATE_EVENT_WINDOW_IN_MINUTES * 60,
    );
  });

  test("the generator's reference names each column, the same condition", () => {
    const statement: Statement = isDetectionArrivalCandidate(
      RUN,
      (name: string): string => {
        return name;
      },
    );

    expect(statement.query).toBe(
      "({p0:Identifier} > {p1:DateTime} AND {p2:Identifier} <= {p3:DateTime} AND {p4:Identifier} >= {p5:Identifier} - toIntervalSecond({p6:Int32}))",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "createdAt",
      p1: OneUptimeDate.toClickhouseDateTime(RUN.arrivedAfter),
      p2: "createdAt",
      p3: OneUptimeDate.toClickhouseDateTime(RUN.arrivedUntil),
      p4: "time",
      p5: "createdAt",
      p6: DETECTION_RUN_LATE_EVENT_SECONDS,
    });
  });

  test("under a table alias, each column is the table's", () => {
    const statement: Statement = isDetectionArrivalCandidate(
      RUN,
      (name: string): QualifiedColumn => {
        return new QualifiedColumn("e", name);
      },
    );

    expect(statement.query).toBe(
      "({p0_t:Identifier}.{p0_c:Identifier} > {p1:DateTime} AND {p2_t:Identifier}.{p2_c:Identifier} <= {p3:DateTime} AND {p4_t:Identifier}.{p4_c:Identifier} >= {p5_t:Identifier}.{p5_c:Identifier} - toIntervalSecond({p6:Int32}))",
    );
  });

  test("what arrived by the end, and before the start", () => {
    expect(detectionArrivedBy(RUN).query).toBe("createdAt <= {p0:DateTime}");
    expect(detectionArrivedBefore(RUN).query).toBe(
      "createdAt <= {p0:DateTime}",
    );
    expect(detectionArrivedBefore(RUN).query_params["p0"]).toBe(
      OneUptimeDate.toClickhouseDateTime(RUN.arrivedAfter),
    );
  });
});

describe("a write's events", () => {
  test("by id, as written, and through the generator's reference", () => {
    expect(isDetectionArrivalCandidate(WRITE).query).toBe(
      "has({p0:Array(String)}, _id)",
    );
    expect(
      isDetectionArrivalCandidate(WRITE, (name: string): string => {
        return name;
      }).query,
    ).toBe("has({p0:Array(String)}, {p1:Identifier})");
    expect(detectionArrivedBy(WRITE).query).toBe("_id <= {p0:String}");
    expect(detectionArrivedBefore(WRITE).query).toBe("_id < {p0:String}");
  });
});

describe("where it is read from", () => {
  test("the service re-exports every piece, so every import of it still reads the same", () => {
    expect(SecurityEventServiceModule.isDetectionArrivalCandidate).toBe(
      DetectionArrivalRead.isDetectionArrivalCandidate,
    );
    expect(SecurityEventServiceModule.detectionArrivedBy).toBe(
      DetectionArrivalRead.detectionArrivedBy,
    );
    expect(SecurityEventServiceModule.detectionArrivedBefore).toBe(
      DetectionArrivalRead.detectionArrivedBefore,
    );
  });
});
