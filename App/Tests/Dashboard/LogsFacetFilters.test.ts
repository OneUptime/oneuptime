import { beforeAll, describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * The logs explorer's facet chips, end to end without a renderer: which
 * facets the sidebar asks for, what a chip's key reads, and how a saved
 * view / deep link's query is read back into chips.
 *
 * Before the resource facet catalog the viewer asked for Host / Docker /
 * Podman / Kubernetes only, so a project whose telemetry came from Proxmox,
 * vCenter, Ceph, Docker Swarm, serverless functions, cloud resources, RUM
 * applications or IoT fleets never got a facet for them — and a chip
 * restored for one of them read its raw key. These tests walk the catalog
 * rather than a copy of it, so a type added there is covered here at once.
 */

type FacetFiltersModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters");
type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");
type MergeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge");

let FacetFilters: FacetFiltersModule;
let Pivot: PivotModule;
let Merge: MergeModule;

const RESOURCE_ID: string = "0195d6c1-0000-7000-8000-0000000000d1";
const OTHER_RESOURCE_ID: string = "0195d6c1-0000-7000-8000-0000000000d2";
const SERVICE_ID: string = "0195d6c1-0000-7000-8000-0000000000e1";

/*
 * Common/UI/Config reads `window` the moment it loads, and the module pulls
 * it in transitively (SavedViewQueryMerge -> LogsCrossSignalPivot ->
 * RouteMap), so the browser stub has to exist before the deferred imports.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  FacetFilters = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters"
  );
  Pivot = await import(
    "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );
  Merge = await import(
    "../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge"
  );
});

function chips(
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> {
  return new Map(
    entries.map(
      ([key, values]: [string, Array<string>]): [string, Set<string>] => {
        return [key, new Set(values)];
      },
    ),
  );
}

function asPlain(
  filters: Map<string, Set<string>>,
): Record<string, Array<string>> {
  const plain: Record<string, Array<string>> = {};

  for (const [key, values] of filters.entries()) {
    plain[key] = Array.from(values).sort();
  }

  return plain;
}

const catalogKeys: Array<[string]> = RESOURCE_FACET_CATALOG_KEYS.map(
  (facetKey: string): [string] => {
    return [facetKey];
  },
);

describe("LOGS_EXPLORER_FACET_KEYS", () => {
  test("asks for severity, the Service facet and every catalog resource type", () => {
    expect(FacetFilters.LOGS_EXPLORER_FACET_KEYS).toEqual([
      "severityText",
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
      "dockerSwarmClusterId",
      "proxmoxClusterId",
      "vmwareVCenterId",
      "cephClusterId",
      "serverlessFunctionId",
      "cloudResourceId",
      "rumApplicationId",
      "iotFleetId",
    ]);
  });

  test("is the catalog, in catalog (sidebar) order, after severity and Service", () => {
    expect(FacetFilters.LOGS_EXPLORER_FACET_KEYS.slice(0, 2)).toEqual([
      "severityText",
      "primaryEntityId",
    ]);
    expect(FacetFilters.LOGS_EXPLORER_FACET_KEYS.slice(2)).toEqual([
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
  });

  test.each(catalogKeys)("includes %s", (facetKey: string) => {
    expect(FacetFilters.LOGS_EXPLORER_FACET_KEYS).toContain(facetKey);
  });

  test("asks for no key twice", () => {
    expect(new Set(FacetFilters.LOGS_EXPLORER_FACET_KEYS).size).toBe(
      FacetFilters.LOGS_EXPLORER_FACET_KEYS.length,
    );
  });

  test("never asks for the legacy serviceId alias", () => {
    expect(FacetFilters.LOGS_EXPLORER_FACET_KEYS).not.toContain("serviceId");
  });
});

describe("chip key labels", () => {
  test("keep every label the viewer had before", () => {
    expect(FacetFilters.LOGS_FACET_CHIP_KEY_LABELS).toMatchObject({
      severityText: "Severity",
      primaryEntityId: "Service",
      hostId: "Host",
      dockerHostId: "Docker Host",
      podmanHostId: "Podman Host",
      kubernetesClusterId: "Kubernetes Cluster",
      traceId: "Trace",
      spanId: "Span",
      body: "Message contains",
    });
  });

  test("pin the label of every new resource type", () => {
    expect(FacetFilters.LOGS_FACET_CHIP_KEY_LABELS).toMatchObject({
      dockerSwarmClusterId: "Docker Swarm Cluster",
      proxmoxClusterId: "Proxmox Cluster",
      vmwareVCenterId: "vCenter",
      cephClusterId: "Ceph Cluster",
      serverlessFunctionId: "Serverless Function",
      cloudResourceId: "Cloud Resource",
      rumApplicationId: "RUM Application",
      iotFleetId: "IoT Fleet",
    });
  });

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, string, ServiceType] => {
        return [definition.facetKey, definition.label, definition.serviceType];
      },
    ),
  )(
    "a %s chip reads %p",
    (facetKey: string, label: string, serviceType: ServiceType) => {
      expect(FacetFilters.getLogsFacetChipDisplayKey(facetKey)).toBe(label);
      expect(FacetFilters.getLogsFacetChipDisplayKey(facetKey)).not.toBe(
        facetKey,
      );
      // A catalog entry names a real, distinct ServiceType.
      expect(Object.values(ServiceType)).toContain(serviceType);
    },
  );

  test("an attributes chip reads its attribute key", () => {
    expect(
      FacetFilters.getLogsFacetChipDisplayKey(
        "attributes.resource.k8s.cluster.name",
      ),
    ).toBe("resource.k8s.cluster.name");
    expect(FacetFilters.getLogsFacetChipDisplayKey("attributes.hostId")).toBe(
      "hostId",
    );
  });

  test("the body chip says it is a substring match", () => {
    expect(FacetFilters.getLogsFacetChipDisplayKey("body")).toBe(
      "Message contains",
    );
  });

  test("an unknown key keeps its raw key rather than a guessed label", () => {
    expect(FacetFilters.getLogsFacetChipDisplayKey("mysteryFacet")).toBe(
      "mysteryFacet",
    );
    expect(FacetFilters.getLogsFacetChipDisplayKey("serviceId")).toBe(
      "serviceId",
    );
  });

  test("labels are distinct, so two chip groups never read the same", () => {
    const labels: Array<string> = Object.values(
      FacetFilters.LOGS_FACET_CHIP_KEY_LABELS,
    );

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("getLogsQueryValues", () => {
  test("an Includes reads as each of its values", () => {
    expect(
      FacetFilters.getLogsQueryValues(
        new Includes([RESOURCE_ID, OTHER_RESOURCE_ID]),
      ),
    ).toEqual([RESOURCE_ID, OTHER_RESOURCE_ID]);
  });

  test("an Includes of ObjectIDs reads as their string ids", () => {
    expect(
      FacetFilters.getLogsQueryValues(
        new Includes([
          new ObjectID(RESOURCE_ID),
          new ObjectID(OTHER_RESOURCE_ID),
        ]),
      ),
    ).toEqual([RESOURCE_ID, OTHER_RESOURCE_ID]);
  });

  test("a Search reads as its text, and a blank one as nothing", () => {
    expect(
      FacetFilters.getLogsQueryValues(new Search("connection refused")),
    ).toEqual(["connection refused"]);
    expect(FacetFilters.getLogsQueryValues(new Search("   "))).toEqual([]);
  });

  test("scalars read as one value", () => {
    expect(FacetFilters.getLogsQueryValues("Error")).toEqual(["Error"]);
    expect(FacetFilters.getLogsQueryValues(42)).toEqual(["42"]);
    expect(FacetFilters.getLogsQueryValues(new ObjectID(SERVICE_ID))).toEqual([
      SERVICE_ID,
    ]);
  });

  test("anything else reads as no chip", () => {
    expect(FacetFilters.getLogsQueryValues(undefined)).toEqual([]);
    expect(FacetFilters.getLogsQueryValues(null)).toEqual([]);
    expect(FacetFilters.getLogsQueryValues({ hostId: [RESOURCE_ID] })).toEqual(
      [],
    );
    expect(FacetFilters.getLogsQueryValues([RESOURCE_ID])).toEqual([]);
  });
});

describe("buildLogsFacetFiltersFromQuery", () => {
  test("reads column chips, attribute chips and resource chips back", () => {
    const restored: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      {
        severityText: new Includes(["Error", "Fatal"]),
        primaryEntityId: SERVICE_ID,
        body: new Search("timeout"),
        attributes: { "http.method": "GET" },
        resourceFilters: {
          proxmoxClusterId: [RESOURCE_ID],
          hostId: [OTHER_RESOURCE_ID],
        },
      } as any,
      {},
    );

    expect(asPlain(restored)).toEqual({
      severityText: ["Error", "Fatal"],
      primaryEntityId: [SERVICE_ID],
      body: ["timeout"],
      "attributes.http.method": ["GET"],
      proxmoxClusterId: [RESOURCE_ID],
      hostId: [OTHER_RESOURCE_ID],
    });
  });

  test.each(catalogKeys)(
    "a saved view's %s chip comes back as a chip",
    (facetKey: string) => {
      const restored: Map<
        string,
        Set<string>
      > = FacetFilters.buildLogsFacetFiltersFromQuery(
        {
          resourceFilters: { [facetKey]: [RESOURCE_ID, OTHER_RESOURCE_ID] },
        } as any,
        {},
      );

      expect(asPlain(restored)).toEqual({
        [facetKey]: [RESOURCE_ID, OTHER_RESOURCE_ID].sort(),
      });
    },
  );

  test("restores one chip group per catalog type from a single saved view", () => {
    const resourceFilters: Record<string, Array<string>> = {};

    for (const facetKey of RESOURCE_FACET_CATALOG_KEYS) {
      resourceFilters[facetKey] = [RESOURCE_ID];
    }

    const restored: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      { resourceFilters } as any,
      {},
    );

    expect(Array.from(restored.keys())).toEqual([
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
  });

  test("a resource chip the host page pins is the page's, not a removable chip", () => {
    const restored: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      {
        resourceFilters: {
          proxmoxClusterId: [RESOURCE_ID],
          cephClusterId: [OTHER_RESOURCE_ID],
        },
      } as any,
      { proxmoxClusterId: RESOURCE_ID } as any,
    );

    expect(asPlain(restored)).toEqual({ cephClusterId: [OTHER_RESOURCE_ID] });
  });

  test("column chips the host page pins are skipped too", () => {
    const restored: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      {
        primaryEntityId: SERVICE_ID,
        severityText: "Error",
        attributes: { team: "a", env: "prod" },
      } as any,
      { primaryEntityId: SERVICE_ID, attributes: { env: "prod" } } as any,
    );

    expect(asPlain(restored)).toEqual({
      severityText: ["Error"],
      "attributes.team": ["a"],
    });
  });

  test("malformed resource selections are dropped rather than restored as chips", () => {
    const restored: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      {
        resourceFilters: {
          // Not a uuid.
          proxmoxClusterId: ["not-an-id"],
          // Not an array.
          iotFleetId: RESOURCE_ID,
          // Not a resource facet.
          madeUpClusterId: [RESOURCE_ID],
          // Service ids never ride resourceFilters.
          primaryEntityId: [SERVICE_ID],
          // A good one survives beside them.
          vmwareVCenterId: [RESOURCE_ID, "nope"],
        },
      } as any,
      {},
    );

    expect(asPlain(restored)).toEqual({ vmwareVCenterId: [RESOURCE_ID] });
  });

  test("a query with no resourceFilters, or a junk one, restores no resource chips", () => {
    for (const resourceFilters of [
      undefined,
      null,
      "proxmoxClusterId",
      [RESOURCE_ID],
      {},
    ]) {
      expect(
        asPlain(
          FacetFilters.buildLogsFacetFiltersFromQuery(
            { resourceFilters } as any,
            {},
          ),
        ),
      ).toEqual({});
    }
  });

  test("a new resource key stored as a bare column is not restored as a chip", () => {
    /*
     * Only `resourceFilters` is read for resource chips: a stray top-level
     * `proxmoxClusterId` is not a Log column, and turning it into a chip
     * would re-compile it into resourceFilters the next time a chip changes
     * — silently widening what the saved view actually matched.
     */
    const restored: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      { proxmoxClusterId: RESOURCE_ID } as any,
      {},
    );

    expect(asPlain(restored)).toEqual({});
  });
});

/*
 * The invariant saved views and deep links rest on: the chips a view shows
 * and the query it runs describe the same slice. Compile chips onto a query,
 * read them back, and you must get exactly the chips you started with.
 */
describe("chip -> query -> chip round trip for every resource type", () => {
  test.each(catalogKeys)(
    "%s chips survive compile and read-back unchanged",
    (facetKey: string) => {
      const original: Map<string, Set<string>> = chips([
        ["severityText", ["Error"]],
        ["primaryEntityId", [SERVICE_ID]],
        [facetKey, [RESOURCE_ID, OTHER_RESOURCE_ID]],
      ]);

      const query: Record<string, unknown> = {};

      Pivot.applyLogsFacetFiltersToQuery(query as any, original);

      expect(query[facetKey]).toBeUndefined();

      const restored: Map<
        string,
        Set<string>
      > = FacetFilters.buildLogsFacetFiltersFromQuery(query as any, {});

      expect(asPlain(restored)).toEqual(asPlain(original));
    },
  );

  test("every catalog type at once survives the round trip", () => {
    const entries: Array<[string, Array<string>]> =
      RESOURCE_FACET_CATALOG_KEYS.map(
        (facetKey: string): [string, Array<string>] => {
          return [facetKey, [RESOURCE_ID]];
        },
      );

    const original: Map<string, Set<string>> = chips(entries);
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(query as any, original);

    expect(
      asPlain(FacetFilters.buildLogsFacetFiltersFromQuery(query as any, {})),
    ).toEqual(asPlain(original));
  });

  test("a saved view's new-type chip removed elsewhere does not come back", () => {
    /*
     * Viewer -> Insights -> Viewer: the view carried a Proxmox cluster, the
     * user removed it, and the URL now carries only a Ceph cluster. The
     * strip must clear the view's resourceFilters so the read-back yields
     * exactly the URL's chips.
     */
    const savedQuery: JSONObject = {
      resourceFilters: { proxmoxClusterId: [RESOURCE_ID] },
    };
    const incoming: Map<string, Set<string>> = chips([
      ["cephClusterId", [OTHER_RESOURCE_ID]],
    ]);

    const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery,
      baseQuery: {},
    });

    Pivot.applyLogsFacetFiltersToQuery(stripped as any, incoming);

    expect(
      asPlain(FacetFilters.buildLogsFacetFiltersFromQuery(stripped as any, {})),
    ).toEqual({ cephClusterId: [OTHER_RESOURCE_ID] });
    // The cached saved view itself is untouched.
    expect(savedQuery).toEqual({
      resourceFilters: { proxmoxClusterId: [RESOURCE_ID] },
    });
  });

  test("a URL `filters` tuple for a new type compiles and restores like a host", () => {
    // The exact shape readInitialUrlState parses out of `?filters=`.
    const urlFilters: Array<[string, Array<string>]> = JSON.parse(
      JSON.stringify([
        ["rumApplicationId", [RESOURCE_ID]],
        ["iotFleetId", [OTHER_RESOURCE_ID]],
      ]),
    );

    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(query as any, chips(urlFilters));

    expect(query["resourceFilters"]).toEqual({
      rumApplicationId: [RESOURCE_ID],
      iotFleetId: [OTHER_RESOURCE_ID],
    });
    expect(
      asPlain(FacetFilters.buildLogsFacetFiltersFromQuery(query as any, {})),
    ).toEqual({
      rumApplicationId: [RESOURCE_ID],
      iotFleetId: [OTHER_RESOURCE_ID],
    });
  });
});
