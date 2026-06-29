import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  TraceTableArguments,
  buildTraceTableRequest,
  dimensionLabel,
  displayGroupValue,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceTableData";

/*
 * Validates the data path a trace-table widget walks: stored arguments ->
 * POST /telemetry/traces/analytics body (chartType="table"), plus the small
 * label helpers the table header/cells use. The backend's consumption of
 * these fields is covered by TraceAggregationService.test.ts; the shared
 * filter/format helpers are covered by TraceChartData.test.ts.
 */

const START: Date = new Date("2026-06-01T00:00:00.000Z");
// 60 minutes later -> bucket size 1 (the smallest tier).
const END_1H: Date = new Date("2026-06-01T01:00:00.000Z");

type BuildArgs = (overrides?: Partial<TraceTableArguments>) => JSONObject;

const buildRequest: BuildArgs = (
  overrides: Partial<TraceTableArguments> = {},
): JSONObject => {
  return buildTraceTableRequest({
    arguments: { groupByAttribute: "name", topLimit: 10, ...overrides },
    startTime: START,
    endTime: END_1H,
  });
};

describe("TraceTableData.buildTraceTableRequest", () => {
  test("defaults: table chartType, limit 10, rootOnly true, no metric", () => {
    const request: JSONObject = buildRequest();

    expect(request["chartType"]).toBe("table");
    expect(request["limit"]).toBe(10);
    expect(request["rootOnly"]).toBe(true);
    expect(request["startTime"]).toBe("2026-06-01T00:00:00.000Z");
    expect(request["endTime"]).toBe("2026-06-01T01:00:00.000Z");
    // The table returns a fixed stat set, so no metric is sent.
    expect(request["metric"]).toBeUndefined();
    // Optional filters must be absent, not empty objects/arrays.
    expect(request["attributes"]).toBeUndefined();
    expect(request["spanNameSearches"]).toBeUndefined();
  });

  test("group-by dimension becomes request.groupBy", () => {
    expect(buildRequest({ groupByAttribute: "url.host" })["groupBy"]).toEqual([
      "url.host",
    ]);
  });

  test("special dimensions pass the column name through", () => {
    for (const dimension of ["name", "statusCode", "kind"]) {
      expect(buildRequest({ groupByAttribute: dimension })["groupBy"]).toEqual([
        dimension,
      ]);
    }
  });

  test("blank group-by is omitted (caller guards before querying)", () => {
    expect(
      buildRequest({ groupByAttribute: "   " })["groupBy"],
    ).toBeUndefined();
  });

  test("max rows sets request.limit; missing/zero fall back to 10", () => {
    expect(buildRequest({ topLimit: 3 })["limit"]).toBe(3);
    expect(buildRequest({ topLimit: 0 })["limit"]).toBe(10);
    expect(
      buildTraceTableRequest({
        arguments: { groupByAttribute: "name" },
        startTime: START,
        endTime: END_1H,
      })["limit"],
    ).toBe(10);
  });

  test("string max rows is coerced to a number", () => {
    expect(buildRequest({ topLimit: "5" as unknown as number })["limit"]).toBe(
      5,
    );
  });

  test("include child spans flips rootOnly off", () => {
    expect(buildRequest({ includeChildSpans: true })["rootOnly"]).toBe(false);
    expect(buildRequest({ includeChildSpans: false })["rootOnly"]).toBe(true);
  });

  test("span name contains becomes request.spanNameSearches", () => {
    expect(
      buildRequest({ spanNameContains: "/Shipment/ShipShipment" })[
        "spanNameSearches"
      ],
    ).toEqual(["/Shipment/ShipShipment"]);
    expect(
      buildRequest({ spanNameContains: "   " })["spanNameSearches"],
    ).toBeUndefined();
  });

  test("structured and legacy attribute filters become request.attributes", () => {
    expect(
      buildRequest({ attributeFilters: { "url.host": "x" } })["attributes"],
    ).toEqual({ "url.host": "x" });
    expect(
      buildRequest({ attributeFilters: "url.host=x; http.method=POST" })[
        "attributes"
      ],
    ).toEqual({ "url.host": "x", "http.method": "POST" });
  });

  test("all options together compose into one coherent table request", () => {
    const request: JSONObject = buildRequest({
      attributeFilters: { "url.host": "x" },
      groupByAttribute: "url.host",
      topLimit: 5,
      includeChildSpans: true,
      spanNameContains: "Ship",
    });
    expect(request["chartType"]).toBe("table");
    expect(request["attributes"]).toEqual({ "url.host": "x" });
    expect(request["groupBy"]).toEqual(["url.host"]);
    expect(request["limit"]).toBe(5);
    expect(request["rootOnly"]).toBe(false);
    expect(request["spanNameSearches"]).toEqual(["Ship"]);
  });
});

describe("TraceTableData.dimensionLabel", () => {
  test("built-in dimensions get friendly labels", () => {
    expect(dimensionLabel("name")).toBe("Span Name");
    expect(dimensionLabel("statusCode")).toBe("Status Code");
    expect(dimensionLabel("kind")).toBe("Span Kind");
    expect(dimensionLabel("primaryEntityId")).toBe("Service");
  });

  test("arbitrary attribute keys are shown verbatim", () => {
    expect(dimensionLabel("url.host")).toBe("url.host");
  });
});

describe("TraceTableData.displayGroupValue", () => {
  test("empty value renders as (empty)", () => {
    expect(displayGroupValue("name", "")).toBe("(empty)");
  });

  test("status code enum is mapped to a readable name", () => {
    expect(displayGroupValue("statusCode", "2")).toBe("Error");
    expect(displayGroupValue("statusCode", "1")).toBe("Ok");
    // Unknown codes fall back to the raw value.
    expect(displayGroupValue("statusCode", "9")).toBe("9");
  });

  test("span kind enum is mapped to a readable name", () => {
    expect(displayGroupValue("kind", "2")).toBe("Server");
    expect(displayGroupValue("kind", "3")).toBe("Client");
  });

  test("other dimensions are shown verbatim", () => {
    expect(displayGroupValue("name", "/checkout")).toBe("/checkout");
    expect(displayGroupValue("url.host", "api.example.com")).toBe(
      "api.example.com",
    );
  });
});
