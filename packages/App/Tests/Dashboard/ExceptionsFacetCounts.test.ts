import { describe, expect, test } from "@jest/globals";
import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";
import {
  EXCEPTIONS_EXPLORER_FACET_KEYS,
  EXCEPTIONS_SERVICE_FACET_KEY,
  getExceptionChipFacetKey,
  getExceptionChosenFacetKeys,
  getExceptionFacetServiceIds,
} from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsFacetCounts";

/*
 * The Exceptions explorer's facet counts. A facet with a value chosen is
 * counted without its own selection (FacetCountPlan), so the exception
 * types, environments or services beside a checked one stay listed with
 * their counts and a second can be checked. The viewer's wiring is rendered
 * in Common's ExplorerFacetMultiSelect.
 */

const RESOURCE_FACET_KEYS: Array<string> = [
  EXCEPTIONS_SERVICE_FACET_KEY,
  ...RESOURCE_FACET_CATALOG_KEYS,
];

describe("the Exceptions explorer's facets", () => {
  test("Service, every catalog resource, then the type and the environment", () => {
    expect(EXCEPTIONS_EXPLORER_FACET_KEYS).toEqual([
      "primaryEntityId",
      ...RESOURCE_FACET_CATALOG_KEYS,
      "exceptionType",
      "environment",
    ]);
  });

  test("a chip counts its facet; a Service chip under its old name the Service facet", () => {
    expect(getExceptionChipFacetKey("exceptionType")).toBe("exceptionType");
    expect(getExceptionChipFacetKey("environment")).toBe("environment");
    expect(getExceptionChipFacetKey("serviceId")).toBe("primaryEntityId");
    expect(getExceptionChipFacetKey("hostId")).toBe("hostId");
  });

  test("a chip no facet lists counts nothing", () => {
    expect(getExceptionChipFacetKey("errorClass")).toBeNull();
    expect(getExceptionChipFacetKey("attributes.http.route")).toBeNull();
  });

  test("the chosen facets: the reader's chips, each facet once, never the page's", () => {
    expect(
      getExceptionChosenFacetKeys([
        { facetKey: "exceptionType" },
        { facetKey: "exceptionType" },
        { facetKey: "kubernetesClusterId" },
        { facetKey: "primaryEntityId", readOnly: true },
        { facetKey: "errorClass" },
      ]).sort(),
    ).toEqual(["exceptionType", "kubernetesClusterId"]);
  });
});

describe("the services a facet count reads", () => {
  const facetGroups: Record<string, Array<string>> = {
    primaryEntityId: ["chip-service"],
    hostId: ["chip-host"],
    exceptionType: ["TypeError"],
  };

  test("with nothing left out: typed services, every resource chip and the page's entity", () => {
    expect(
      getExceptionFacetServiceIds({
        typedServiceIds: ["typed-service"],
        facetGroups: facetGroups,
        resourceFacetKeys: RESOURCE_FACET_KEYS,
        pageEntityId: "page-entity",
      }).sort(),
    ).toEqual(["chip-host", "chip-service", "page-entity", "typed-service"]);
  });

  test("the Service facet's own count leaves out its chips and the typed services - not the page's entity", () => {
    expect(
      getExceptionFacetServiceIds({
        typedServiceIds: ["typed-service"],
        facetGroups: facetGroups,
        resourceFacetKeys: RESOURCE_FACET_KEYS,
        pageEntityId: "page-entity",
        omitFacetKey: "primaryEntityId",
      }).sort(),
    ).toEqual(["chip-host", "page-entity"]);
  });

  test("a resource facet's own count leaves out only its own chips", () => {
    expect(
      getExceptionFacetServiceIds({
        typedServiceIds: ["typed-service"],
        facetGroups: facetGroups,
        resourceFacetKeys: RESOURCE_FACET_KEYS,
        omitFacetKey: "hostId",
      }).sort(),
    ).toEqual(["chip-service", "typed-service"]);
  });

  test("another facet's own count reads every service", () => {
    expect(
      getExceptionFacetServiceIds({
        typedServiceIds: [],
        facetGroups: facetGroups,
        resourceFacetKeys: RESOURCE_FACET_KEYS,
        omitFacetKey: "exceptionType",
      }).sort(),
    ).toEqual(["chip-host", "chip-service"]);
  });

  test("an id named twice is read once", () => {
    expect(
      getExceptionFacetServiceIds({
        typedServiceIds: ["same"],
        facetGroups: { primaryEntityId: ["same"] },
        resourceFacetKeys: RESOURCE_FACET_KEYS,
        pageEntityId: "same",
      }),
    ).toEqual(["same"]);
  });
});
