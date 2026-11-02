import { describe, expect, test } from "@jest/globals";
import {
  FACET_EXCLUDE_KEY_PREFIX,
  getBaseFacetKey,
  getExcludedFacetEntries,
  isExcludeFacetKey,
  toExcludeFacetKey,
} from "../../../Types/Telemetry/FacetExcludeKey";
import {
  RESOURCE_FILTERS_FIELD,
  EXCLUDED_RESOURCE_FILTERS_FIELD,
  collectExcludedResourceEntityFacetSelections,
  collectExcludedServiceFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
} from "../../../Types/Telemetry/ResourceEntityFacet";
import * as FacetSelection from "../../../UI/Components/TelemetryViewer/FacetSelection";
import { SECURITY_EVENT_EXCLUDE_FACET_PREFIX } from "../../../Utils/SecurityEvent/SecurityEventSearch";

/*
 * The one marker every telemetry explorer writes a value it leaves out
 * with: `!` before the chip's KEY (`!severityText: debug`). Kept in Types so
 * the request builders of Logs, Traces, Metrics and Exceptions read the same
 * marker the facet sidebar and the chip row do, and the shared resource
 * readers can split the kept resources from the ones left out.
 */

const CLUSTER_ID: string = "8c0f2f1e-2e4f-4a8c-9a1a-2f5b6c7d8e9f";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("the exclusion marker", () => {
  test("is `!`, on the key", () => {
    expect(FACET_EXCLUDE_KEY_PREFIX).toBe("!");
    expect(toExcludeFacetKey("severityText")).toBe("!severityText");
    expect(toExcludeFacetKey("attributes.host.name")).toBe(
      "!attributes.host.name",
    );
  });

  test("is written once, however often it is asked for", () => {
    expect(toExcludeFacetKey(toExcludeFacetKey("severityText"))).toBe(
      "!severityText",
    );
  });

  test("reads back to the facet it filters", () => {
    expect(getBaseFacetKey("!severityText")).toBe("severityText");
    expect(getBaseFacetKey("severityText")).toBe("severityText");
    expect(getBaseFacetKey("!attributes.http.method")).toBe(
      "attributes.http.method",
    );
  });

  test("tells a chip that leaves its value out from one that keeps it", () => {
    expect(isExcludeFacetKey("!hostId")).toBe(true);
    expect(isExcludeFacetKey("hostId")).toBe(false);
    expect(isExcludeFacetKey("")).toBe(false);
    expect(isExcludeFacetKey(undefined as unknown as string)).toBe(false);
  });

  test("is the one the facet sidebar and Security Events write", () => {
    expect(FacetSelection.FACET_EXCLUDE_KEY_PREFIX).toBe(
      FACET_EXCLUDE_KEY_PREFIX,
    );
    expect(FacetSelection.toExcludeFacetKey).toBe(toExcludeFacetKey);
    expect(FacetSelection.getBaseFacetKey).toBe(getBaseFacetKey);
    expect(FacetSelection.isExcludeFacetKey).toBe(isExcludeFacetKey);
    expect(SECURITY_EVENT_EXCLUDE_FACET_PREFIX).toBe(FACET_EXCLUDE_KEY_PREFIX);
  });
});

describe("the chips that leave values out, read under the facet they filter", () => {
  test("only the `!` chips, keyed by their facet", () => {
    expect(
      getExcludedFacetEntries([
        ["severityText", ["error"]],
        ["!severityText", ["debug"]],
        ["!hostId", [HOST_ID]],
      ]),
    ).toEqual([
      ["severityText", ["debug"]],
      ["hostId", [HOST_ID]],
    ]);
  });

  test("a bare `!` names no facet and is dropped", () => {
    expect(getExcludedFacetEntries([["!", ["x"]]])).toEqual([]);
  });
});

describe("the resources a reader left out", () => {
  const chips: Array<[string, Set<string>]> = [
    ["kubernetesClusterId", new Set<string>([CLUSTER_ID])],
    ["!hostId", new Set<string>([HOST_ID, HOST_ID, ""])],
    ["primaryEntityId", new Set<string>([SERVICE_ID])],
    ["!primaryEntityId", new Set<string>([OTHER_SERVICE_ID])],
    ["!serviceId", new Set<string>([OTHER_SERVICE_ID, SERVICE_ID])],
    ["!severityText", new Set<string>(["debug"])],
  ];

  test("resource facets left out, by facet, once each, never the kept ones", () => {
    expect(collectExcludedResourceEntityFacetSelections(chips)).toEqual({
      hostId: [HOST_ID],
    });
    expect(collectResourceEntityFacetSelections(chips)).toEqual({
      kubernetesClusterId: [CLUSTER_ID],
    });
  });

  test("services left out, under either of the Service facet's names", () => {
    expect(collectExcludedServiceFacetSelections(chips)).toEqual([
      OTHER_SERVICE_ID,
      SERVICE_ID,
    ]);
    expect(collectServiceFacetSelections(chips)).toEqual([SERVICE_ID]);
  });

  test("ride their own field beside the kept ones", () => {
    expect(RESOURCE_FILTERS_FIELD).toBe("resourceFilters");
    expect(EXCLUDED_RESOURCE_FILTERS_FIELD).toBe("excludedResourceFilters");
  });

  test("nothing left out is nothing, never an empty list", () => {
    expect(
      collectExcludedResourceEntityFacetSelections([["hostId", [HOST_ID]]]),
    ).toEqual({});
    expect(
      collectExcludedServiceFacetSelections([
        ["primaryEntityId", [SERVICE_ID]],
      ]),
    ).toEqual([]);
  });
});
