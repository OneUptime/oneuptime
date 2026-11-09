import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorEvaluationDetailsUtil from "../../../Utils/Monitor/MonitorEvaluationDetailsUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The stored evaluation details, written by the server and read by the
 * Dashboard through the same encoding. What this build cannot read shows
 * nothing, never a half-read section.
 */

const EVALUATED_AT: Date = new Date("2026-11-08T10:04:12.000Z");

function details(): MonitorEvaluationDetails {
  return {
    version: MonitorEvaluationDetailsVersion,
    monitorType: MonitorType.API,
    evaluatedAt: EVALUATED_AT,
    criteriaId: "criteria-1",
    criteriaName: "Payments degraded",
    filterCondition: FilterCondition.Any,
    probeName: "US West",
    filters: [
      {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.Contains,
        value: "error",
        met: true,
        message: "Response body contains error.",
        field: "checks[1].status",
        excerpt: {
          before: '"status":"',
          match: "error",
          after: ': connection refused"',
          isCutAtStart: true,
          isCutAtEnd: true,
        },
      },
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 5000,
        met: false,
        message: "Response Time (in ms) was 120 ms.",
      },
    ],
    request: { method: "GET", url: "https://api.acme.example/health" },
    response: { statusCode: 503, responseTimeInMs: 120, isOnline: true },
  };
}

// What a jsonb column hands back: plain JSON.
function throughJsonb(value: JSONObject | null): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

describe("a stored record reads back as it was written", () => {
  test("every field, the evaluation time as a Date", () => {
    const readBack: MonitorEvaluationDetails | null =
      MonitorEvaluationDetailsUtil.deserialize(
        throughJsonb(MonitorEvaluationDetailsUtil.serialize(details())),
      );

    expect(readBack).toEqual(details());
    expect(readBack!.evaluatedAt).toBeInstanceOf(Date);
  });

  test("a time stored as plain text is read too", () => {
    const stored: JSONObject = throughJsonb(details() as unknown as JSONObject);

    expect(
      MonitorEvaluationDetailsUtil.deserialize(stored)!.evaluatedAt,
    ).toEqual(EVALUATED_AT);
  });

  test("nothing to write is nothing stored", () => {
    expect(MonitorEvaluationDetailsUtil.serialize(null)).toBeNull();
    expect(MonitorEvaluationDetailsUtil.serialize(undefined)).toBeNull();
  });
});

describe("what this build cannot read shows nothing", () => {
  test("no record", () => {
    expect(MonitorEvaluationDetailsUtil.deserialize(null)).toBeNull();
    expect(MonitorEvaluationDetailsUtil.deserialize(undefined)).toBeNull();
  });

  test("a record of another version", () => {
    const stored: JSONObject = throughJsonb(
      MonitorEvaluationDetailsUtil.serialize({ ...details(), version: 2 }),
    );

    expect(MonitorEvaluationDetailsUtil.deserialize(stored)).toBeNull();
  });

  test("a record with no filters", () => {
    const stored: JSONObject = throughJsonb(
      MonitorEvaluationDetailsUtil.serialize({ ...details(), filters: [] }),
    );

    expect(MonitorEvaluationDetailsUtil.deserialize(stored)).toBeNull();
  });

  test("a record whose time cannot be read", () => {
    const stored: JSONObject = {
      ...throughJsonb(details() as unknown as JSONObject),
      evaluatedAt: "not a time",
    };

    expect(MonitorEvaluationDetailsUtil.deserialize(stored)).toBeNull();
  });

  test("an array, or text", () => {
    expect(
      MonitorEvaluationDetailsUtil.deserialize([] as unknown as JSONObject),
    ).toBeNull();
    expect(
      MonitorEvaluationDetailsUtil.deserialize("x" as unknown as JSONObject),
    ).toBeNull();
  });

  test("a filter that is not one is left out; the rest still read", () => {
    const stored: JSONObject = throughJsonb(
      MonitorEvaluationDetailsUtil.serialize(details()),
    );
    (stored["filters"] as Array<unknown>).push(null, 7, { met: true });

    expect(
      MonitorEvaluationDetailsUtil.deserialize(stored)!.filters,
    ).toHaveLength(2);
  });
});

describe("the filters that matched", () => {
  test("in the criteria's order", () => {
    expect(
      MonitorEvaluationDetailsUtil.getMatchedFilters(details()).map(
        (filter: MonitorEvaluationDetails["filters"][number]) => {
          return filter.checkOn;
        },
      ),
    ).toEqual([CheckOn.ResponseBody]);
  });
});
