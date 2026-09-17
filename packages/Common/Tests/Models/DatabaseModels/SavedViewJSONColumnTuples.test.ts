import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import TraceSavedView from "../../../Models/DatabaseModels/TraceSavedView";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import { readSavedViewFilters } from "../../../Utils/Telemetry/SavedViewFilters";
import { describe, expect, test } from "@jest/globals";

/*
 * A saved view's filter tuples pass through DatabaseBaseModel.toJSON twice:
 * once in the browser on the way to the API, and once on the server on the way
 * back out — every REST response for a model goes through it. Both directions
 * ran the serializer that flattened nested arrays, so a row could be perfectly
 * intact in Postgres and still reach the browser as
 * { "0": facetKey, "1": value }.
 *
 * That is why this is pinned at the model layer and not only on the helper:
 * the read path has to hold on its own, or a patched browser talking to an
 * unpatched API is still broken.
 */

const SAVED_STATE: TelemetrySavedViewState = {
  search: "status:error",
  filters: [
    ["primaryEntityId", "6512f1a0a1b2c3d4e5f60718"],
    ["attributes.http.method", "GET"],
  ],
  timeRange: { range: "Past one hour" },
  pageSize: 50,
  rootOnly: false,
};

function readFiltersFromJSON(json: JSONObject): JSONArray {
  return (json["query"] as JSONObject)["filters"] as JSONArray;
}

describe("Saved view JSON columns keep their filter tuples through toJSON", () => {
  test("TraceSavedView keeps filters as arrays", () => {
    const view: TraceSavedView = new TraceSavedView();
    view.name = "Errors in checkout";
    view.query = SAVED_STATE;

    const json: JSONObject = BaseModel.toJSON(view, TraceSavedView);
    const filters: JSONArray = readFiltersFromJSON(json);

    expect(Array.isArray(filters)).toBe(true);
    expect(Array.isArray(filters[0])).toBe(true);
    expect(filters).toEqual(SAVED_STATE.filters);
  });

  test("MetricSavedView keeps filters as arrays", () => {
    const view: MetricSavedView = new MetricSavedView();
    view.name = "Hot services";
    view.query = SAVED_STATE;

    const json: JSONObject = BaseModel.toJSON(view, MetricSavedView);
    const filters: JSONArray = readFiltersFromJSON(json);

    expect(Array.isArray(filters)).toBe(true);
    expect(Array.isArray(filters[0])).toBe(true);
    expect(filters).toEqual(SAVED_STATE.filters);
  });

  test("A serialized view is still readable by the explorer", () => {
    const view: TraceSavedView = new TraceSavedView();
    view.query = SAVED_STATE;

    const json: JSONObject = BaseModel.toJSON(view, TraceSavedView);

    expect(readSavedViewFilters(readFiltersFromJSON(json))).toEqual(
      SAVED_STATE.filters,
    );
  });

  test("The rest of the saved state is untouched", () => {
    const view: TraceSavedView = new TraceSavedView();
    view.query = SAVED_STATE;

    const query: JSONObject = BaseModel.toJSON(view, TraceSavedView)[
      "query"
    ] as JSONObject;

    expect(query["search"]).toBe("status:error");
    expect(query["pageSize"]).toBe(50);
    expect(query["rootOnly"]).toBe(false);
    expect(query["timeRange"]).toEqual({ range: "Past one hour" });
  });

  test("A view survives two passes, the way it does browser-to-API-to-browser", () => {
    const view: TraceSavedView = new TraceSavedView();
    view.query = SAVED_STATE;

    // Write side (browser -> API), then read side (API -> browser).
    const written: JSONObject = BaseModel.toJSON(view, TraceSavedView);
    const reloaded: TraceSavedView = BaseModel.fromJSON(
      written,
      TraceSavedView,
    ) as TraceSavedView;
    const returned: JSONObject = BaseModel.toJSON(reloaded, TraceSavedView);

    expect(readFiltersFromJSON(returned)).toEqual(SAVED_STATE.filters);
  });

  test("A view with no filters serializes without inventing any", () => {
    const view: TraceSavedView = new TraceSavedView();
    view.query = { search: "status:error" };

    const query: JSONObject = BaseModel.toJSON(view, TraceSavedView)[
      "query"
    ] as JSONObject;

    expect(query["filters"]).toBeUndefined();
    expect(readSavedViewFilters(query["filters"])).toEqual([]);
  });
});
