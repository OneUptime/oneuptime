import {
  TelemetryViewerUrlParamNames,
  buildTelemetryViewerUrlParams,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryViewerUrlState";
import Dictionary from "Common/Types/Dictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * The Logs / Traces / Metrics / Exceptions explorers each mirror their view
 * into the URL. They used to do it by building a fresh URLSearchParams and
 * replacing `location.search` wholesale, which deleted every param they didn't
 * own — a co-mounted table's saved filters, the Profiles tab's deep-link ids,
 * dashboard variables — the moment an explorer rendered.
 *
 * They now hand this helper the params they want set, and it expands them into
 * the full owned set with the unused ones nulled, so `Navigation.setQueryString`
 * removes exactly those and merges the rest.
 */

describe("buildTelemetryViewerUrlParams", () => {
  test("nulls every owned param when the view sets nothing", () => {
    const params: Dictionary<string | null> = buildTelemetryViewerUrlParams({});

    expect(Object.keys(params).sort()).toEqual(
      [...TelemetryViewerUrlParamNames].sort(),
    );

    for (const name of TelemetryViewerUrlParamNames) {
      expect(params[name]).toBeNull();
    }
  });

  test("keeps the params the view set and nulls the rest", () => {
    const params: Dictionary<string | null> = buildTelemetryViewerUrlParams({
      search: "service:api",
      page: "3",
    });

    expect(params["search"]).toBe("service:api");
    expect(params["page"]).toBe("3");
    expect(params["filters"]).toBeNull();
    expect(params["range"]).toBeNull();
    expect(params["pageSize"]).toBeNull();
  });

  test("never mentions a param it does not own, so foreign params survive", () => {
    const params: Dictionary<string | null> = buildTelemetryViewerUrlParams({
      search: "api",
    });

    /*
     * These are owned by other things on the same route. Because they are
     * absent from the result, setQueryString leaves them exactly as they are.
     */
    expect(params).not.toHaveProperty("monitors-table-filter");
    expect(params).not.toHaveProperty("monitors-table-view");
    expect(params).not.toHaveProperty("var-region");
    expect(params).not.toHaveProperty("serviceId");
    expect(params).not.toHaveProperty("tab");
  });

  test("treats an explicit null the same as omitting the param", () => {
    const params: Dictionary<string | null> = buildTelemetryViewerUrlParams({
      search: null,
    });

    expect(params["search"]).toBeNull();
  });

  test("carries a value that is not part of the owned set through unchanged", () => {
    /*
     * A viewer that grows a new param still works — it just needs adding to
     * TelemetryViewerUrlParamNames before it can be *cleared*.
     */
    const params: Dictionary<string | null> = buildTelemetryViewerUrlParams({
      brandNewParam: "value",
    });

    expect(params["brandNewParam"]).toBe("value");
  });

  test("covers every param the four explorers write", () => {
    /*
     * Guards against a viewer adding a param and forgetting to register it —
     * an unregistered param can be set but never removed, so a filter the user
     * cleared would linger in a shared link.
     */
    for (const name of [
      "search",
      "filters",
      "range",
      "start",
      "end",
      "page",
      "pageSize",
      "view",
      "rootOnly",
      "status",
    ]) {
      expect(TelemetryViewerUrlParamNames).toContain(name);
    }
  });
});
