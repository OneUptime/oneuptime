import { describe, expect, test } from "@jest/globals";
import { applyLogsFacetExclusionsToRequest } from "../../../../UI/Components/LogsViewer/LogsFacetExclusions";
import { JSONObject } from "../../../../Types/JSON";

/*
 * What a logs view leaves out, onto a request for the aggregate endpoints
 * (the chart, the facet counts, the analytics tab). The logs explorer
 * offered no "is not" until the endpoints took these fields: an exclusion
 * would have drawn bars and counts for rows the list no longer showed.
 */

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";
const CLUSTER_ID: string = "8c0f2f1e-2e4f-4a8c-9a1a-2f5b6c7d8e9f";

const chips: (
  entries: Array<[string, Array<string>]>,
) => Map<string, Set<string>> = (
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> => {
  return new Map<string, Set<string>>(
    entries.map(([key, values]: [string, Array<string>]) => {
      return [key, new Set<string>(values)];
    }),
  );
};

describe("applyLogsFacetExclusionsToRequest", () => {
  test("severities, services and resources left out each ride their own field", () => {
    const request: JSONObject = applyLogsFacetExclusionsToRequest(
      {},
      chips([
        ["!severityText", ["Debug", "Trace", ""]],
        ["!primaryEntityId", [CHECKOUT_ID]],
        ["!serviceId", [BILLING_ID]],
        ["!hostId", [HOST_ID]],
        ["kubernetesClusterId", [CLUSTER_ID]],
      ]),
    );

    expect(request).toEqual({
      excludedSeverityTexts: ["Debug", "Trace"],
      excludedServiceIds: [CHECKOUT_ID, BILLING_ID],
      excludedResourceFilters: { hostId: [HOST_ID] },
    });
  });

  test("a severity or service the request already keeps wins: a log has one of each", () => {
    const request: JSONObject = applyLogsFacetExclusionsToRequest(
      { severityTexts: ["Error"], serviceIds: [CHECKOUT_ID] },
      chips([
        ["!severityText", ["Debug"]],
        ["!primaryEntityId", [BILLING_ID]],
      ]),
    );

    expect(request).toEqual({
      severityTexts: ["Error"],
      serviceIds: [CHECKOUT_ID],
    });
  });

  test("a resource left out applies beside resources kept: a log names several", () => {
    const request: JSONObject = applyLogsFacetExclusionsToRequest(
      { resourceFilters: { kubernetesClusterId: [CLUSTER_ID] } },
      chips([["!hostId", [HOST_ID]]]),
    );

    expect(request["resourceFilters"]).toEqual({
      kubernetesClusterId: [CLUSTER_ID],
    });
    expect(request["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });
  });

  test("an empty kept list is no kept list: the exclusion still applies", () => {
    const request: JSONObject = applyLogsFacetExclusionsToRequest(
      { severityTexts: [], serviceIds: [] },
      chips([
        ["!severityText", ["Debug"]],
        ["!primaryEntityId", [CHECKOUT_ID]],
      ]),
    );

    expect(request["excludedSeverityTexts"]).toEqual(["Debug"]);
    expect(request["excludedServiceIds"]).toEqual([CHECKOUT_ID]);
  });

  test("nothing left out adds nothing, and the same request object is handed back", () => {
    const original: JSONObject = { severityTexts: ["Error"] };
    const request: JSONObject = applyLogsFacetExclusionsToRequest(
      original,
      chips([["severityText", ["Error"]]]),
    );

    expect(request).toBe(original);
    expect(request).toEqual({ severityTexts: ["Error"] });
  });
});
