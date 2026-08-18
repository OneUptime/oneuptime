import { describe, expect, test } from "@jest/globals";
import {
  ALL_RESOURCE_FACET_KEYS,
  MAX_RESOURCE_IDS_PER_FACET,
  RESOURCE_ENTITY_FACET_KEYS,
  ResourceEntityFacetSelections,
  SERVICE_FACET_KEYS,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
  hasResourceEntityFacetSelections,
  isResourceEntityFacetKey,
  isResourceFacetKey,
  isServiceFacetKey,
  parseResourceEntityFacetSelections,
} from "../../../Types/Telemetry/ResourceEntityFacet";

/*
 * The split this module encodes is the whole fix for issue #3216: the
 * Services facet reads out of `primaryEntityId`, every other resource facet
 * has to be resolved through the resource's entity key. Getting a key into
 * the wrong bucket silently reintroduces the bug (a cluster id compared
 * against a column that only holds Service ids), so the classification is
 * pinned here rather than left to the call sites.
 */

const CLUSTER_ID: string = "8c0f2f1e-2e4f-4a8c-9a1a-2f5b6c7d8e9f";
const OTHER_CLUSTER_ID: string = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";
const SERVICE_ID: string = "0d1c2b3a-4958-4867-9776-8574a3b2c1d0";

function facetMap(
  entries: Record<string, Array<string>>,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of Object.entries(entries)) {
    map.set(key, new Set(values));
  }

  return map;
}

describe("ResourceEntityFacet", () => {
  describe("facet classification", () => {
    test("the Services facet and its pre-rename alias read out of primaryEntityId", () => {
      expect(isServiceFacetKey("primaryEntityId")).toBe(true);
      expect(isServiceFacetKey("serviceId")).toBe(true);
      expect(isResourceEntityFacetKey("primaryEntityId")).toBe(false);
      expect(isResourceEntityFacetKey("serviceId")).toBe(false);
    });

    test("every non-Service resource facet needs entity-key resolution", () => {
      for (const facetKey of [
        "hostId",
        "dockerHostId",
        "podmanHostId",
        "kubernetesClusterId",
      ]) {
        expect(isResourceEntityFacetKey(facetKey)).toBe(true);
        expect(isServiceFacetKey(facetKey)).toBe(false);
      }
    });

    test("non-resource facets belong to neither group", () => {
      for (const facetKey of [
        "severityText",
        "traceId",
        "spanId",
        "attributes.k8s.cluster.name",
        "",
      ]) {
        expect(isResourceFacetKey(facetKey)).toBe(false);
      }
    });

    test("the combined list is exactly the two groups, with no overlap", () => {
      expect(ALL_RESOURCE_FACET_KEYS).toEqual([
        ...SERVICE_FACET_KEYS,
        ...RESOURCE_ENTITY_FACET_KEYS,
      ]);
      expect(new Set(ALL_RESOURCE_FACET_KEYS).size).toBe(
        ALL_RESOURCE_FACET_KEYS.length,
      );
    });
  });

  describe("collectResourceEntityFacetSelections", () => {
    test("keeps each facet's ids under its own key", () => {
      const selections: ResourceEntityFacetSelections =
        collectResourceEntityFacetSelections(
          facetMap({
            kubernetesClusterId: [CLUSTER_ID],
            hostId: [HOST_ID],
          }).entries(),
        );

      expect(selections).toEqual({
        kubernetesClusterId: [CLUSTER_ID],
        hostId: [HOST_ID],
      });
    });

    test("leaves Service selections out — they are not entity-key resolved", () => {
      const selections: ResourceEntityFacetSelections =
        collectResourceEntityFacetSelections(
          facetMap({
            primaryEntityId: [SERVICE_ID],
            serviceId: [SERVICE_ID],
            severityText: ["Error"],
          }).entries(),
        );

      expect(selections).toEqual({});
    });

    test("accepts a plain record via Object.entries (the traces explorer's shape)", () => {
      const selections: ResourceEntityFacetSelections =
        collectResourceEntityFacetSelections(
          Object.entries({
            kubernetesClusterId: [CLUSTER_ID, OTHER_CLUSTER_ID],
          }),
        );

      expect(selections["kubernetesClusterId"]).toEqual([
        CLUSTER_ID,
        OTHER_CLUSTER_ID,
      ]);
    });

    test("de-duplicates repeated ids within one facet", () => {
      const selections: ResourceEntityFacetSelections =
        collectResourceEntityFacetSelections(
          Object.entries({
            kubernetesClusterId: [CLUSTER_ID, CLUSTER_ID],
          }),
        );

      expect(selections["kubernetesClusterId"]).toEqual([CLUSTER_ID]);
    });

    test("drops a facet whose last chip was just removed rather than emitting []", () => {
      const selections: ResourceEntityFacetSelections =
        collectResourceEntityFacetSelections(
          facetMap({ kubernetesClusterId: [] }).entries(),
        );

      expect(selections).toEqual({});
      expect(hasResourceEntityFacetSelections(selections)).toBe(false);
    });

    test("skips blank values", () => {
      const selections: ResourceEntityFacetSelections =
        collectResourceEntityFacetSelections(
          Object.entries({ hostId: ["", HOST_ID] }),
        );

      expect(selections["hostId"]).toEqual([HOST_ID]);
    });
  });

  describe("collectServiceFacetSelections", () => {
    test("unions the canonical key and its alias", () => {
      expect(
        collectServiceFacetSelections(
          facetMap({
            primaryEntityId: [SERVICE_ID],
            serviceId: [SERVICE_ID, HOST_ID],
          }).entries(),
        ),
      ).toEqual([SERVICE_ID, HOST_ID]);
    });

    test("ignores non-Service resource facets", () => {
      expect(
        collectServiceFacetSelections(
          facetMap({ kubernetesClusterId: [CLUSTER_ID] }).entries(),
        ),
      ).toEqual([]);
    });
  });

  describe("parseResourceEntityFacetSelections", () => {
    test("accepts a well-formed selection map", () => {
      expect(
        parseResourceEntityFacetSelections({
          kubernetesClusterId: [CLUSTER_ID],
        }),
      ).toEqual({ kubernetesClusterId: [CLUSTER_ID] });
    });

    test("drops unknown facet keys", () => {
      expect(
        parseResourceEntityFacetSelections({
          kubernetesClusterId: [CLUSTER_ID],
          primaryEntityId: [SERVICE_ID],
          somethingElse: [CLUSTER_ID],
        }),
      ).toEqual({ kubernetesClusterId: [CLUSTER_ID] });
    });

    test("drops ids that are not ObjectID strings", () => {
      expect(
        parseResourceEntityFacetSelections({
          kubernetesClusterId: [CLUSTER_ID, "not-an-id", "'; DROP TABLE --"],
        }),
      ).toEqual({ kubernetesClusterId: [CLUSTER_ID] });
    });

    test("a facet left with no valid id is dropped entirely", () => {
      expect(parseResourceEntityFacetSelections({ hostId: ["nope"] })).toEqual(
        {},
      );
    });

    test("non-array values carry no filter", () => {
      expect(
        parseResourceEntityFacetSelections({
          kubernetesClusterId: CLUSTER_ID,
        }),
      ).toEqual({});
    });

    test("junk input parses to no constraint rather than throwing", () => {
      for (const junk of [undefined, null, "", 0, [], "string", true]) {
        expect(parseResourceEntityFacetSelections(junk)).toEqual({});
      }
    });

    test("caps the id list so a crafted request cannot send an unbounded IN", () => {
      const many: Array<string> = Array.from(
        { length: MAX_RESOURCE_IDS_PER_FACET + 25 },
        (_unused: unknown, index: number): string => {
          return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        },
      );

      const parsed: ResourceEntityFacetSelections =
        parseResourceEntityFacetSelections({ kubernetesClusterId: many });

      expect(parsed["kubernetesClusterId"]).toHaveLength(
        MAX_RESOURCE_IDS_PER_FACET,
      );
    });

    test("de-duplicates before capping", () => {
      const parsed: ResourceEntityFacetSelections =
        parseResourceEntityFacetSelections({
          hostId: [HOST_ID, HOST_ID, HOST_ID],
        });

      expect(parsed["hostId"]).toEqual([HOST_ID]);
    });
  });
});
