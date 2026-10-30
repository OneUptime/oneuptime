import {
  EXCEPTION_LIST_STATS_ROUTE,
  ExceptionListStatsById,
  buildExceptionListStatsRequest,
  getExceptionRowStats,
  readExceptionListStatsById,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionListStats";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MAX_EXCEPTION_LIST_STATS_IDS } from "Common/Types/Telemetry/ExceptionListStats";
import { describe, expect, test } from "@jest/globals";

/*
 * The exceptions list's request for its rows' numbers, and the answer by
 * exception: what a page sends is exactly its rows' ids, once each, and the
 * range the rows were read for.
 */

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-29T12:00:00.000Z"),
  new Date("2026-10-30T12:00:00.000Z"),
);

function exception(
  id: string,
  useModelId: boolean = false,
): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  if (useModelId) {
    row.id = new ObjectID(id);
  } else {
    row._id = id;
  }
  return row;
}

const E1: string = "50000000-0000-4000-8000-000000000001";
const E2: string = "50000000-0000-4000-8000-000000000002";

describe("the request", () => {
  test("goes to the exceptions' list-stats route", () => {
    expect(EXCEPTION_LIST_STATS_ROUTE).toBe("/telemetry-exception/list-stats");
  });

  test("carries the page's ids, once each, and the range", () => {
    expect(
      buildExceptionListStatsRequest({
        exceptions: [exception(E1), exception(E2), exception(E1.toUpperCase())],
        window: WINDOW,
      }),
    ).toEqual({
      telemetryExceptionIds: [E1, E2],
      startTime: "2026-10-29T12:00:00.000Z",
      endTime: "2026-10-30T12:00:00.000Z",
    });
  });

  test("reads an id from either of a row's id fields", () => {
    const request: JSONObject | null = buildExceptionListStatsRequest({
      exceptions: [exception(E1, true)],
      window: WINDOW,
    });

    expect(request!["telemetryExceptionIds"]).toEqual([E1]);
  });

  test("a page larger than one request takes asks about its first rows", () => {
    const ids: Array<string> = new Array(MAX_EXCEPTION_LIST_STATS_IDS + 20)
      .fill(0)
      .map((_value: number, index: number): string => {
        return `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      });

    const request: JSONObject | null = buildExceptionListStatsRequest({
      exceptions: ids.map((id: string): TelemetryException => {
        return exception(id);
      }),
      window: WINDOW,
    });

    expect(request!["telemetryExceptionIds"]).toEqual(
      ids.slice(0, MAX_EXCEPTION_LIST_STATS_IDS),
    );
  });

  test("no row with an id: no request", () => {
    expect(
      buildExceptionListStatsRequest({ exceptions: [], window: WINDOW }),
    ).toBeNull();
    expect(
      buildExceptionListStatsRequest({
        exceptions: [new TelemetryException()],
        window: WINDOW,
      }),
    ).toBeNull();
  });
});

describe("the answer by exception", () => {
  test("each row finds its numbers, whatever the case of its id", () => {
    const byId: ExceptionListStatsById | null = readExceptionListStatsById({
      stats: [
        { telemetryExceptionId: E1.toUpperCase(), affectedUsers: 2, trend: [] },
      ],
    });

    expect(getExceptionRowStats(byId, exception(E1))?.affectedUsers).toBe(2);
    expect(getExceptionRowStats(byId, exception(E2))).toBeUndefined();
  });

  test("no answer: no row has numbers", () => {
    expect(readExceptionListStatsById("nope")).toBeNull();
    expect(getExceptionRowStats(null, exception(E1))).toBeUndefined();
    expect(
      getExceptionRowStats(
        readExceptionListStatsById({ stats: [] }),
        new TelemetryException(),
      ),
    ).toBeUndefined();
  });
});
