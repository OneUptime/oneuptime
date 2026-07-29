import { beforeAll, describe, expect, test } from "@jest/globals";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The registry in `Common` knows about all eight resource types, but a
 * recommendation only reaches a user if `App` also mounts a page for it. That
 * link is eight independent hand-written wirings — PageMap key, RoutePath
 * entry, RouteMap Route, PageRoute, SideMenuItem, breadcrumb — with nothing
 * tying them back to the registry. A ninth resource type added to the catalog,
 * or a type whose wiring is only half-finished, produces no error anywhere:
 * the recommendations simply never appear, and the only symptom is a resource
 * that quietly has no recommended monitors.
 *
 * These enumerate the ENUM rather than a hand-kept list, so adding a member to
 * `MonitorRecommendationResourceType` fails here until its page is wired up.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;

let RouteMap: RouteMapModule["default"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];

/*
 * Resource type -> the PageMap key of its recommendations page. This mapping is
 * the one thing that cannot be derived: the keys follow each resource's own
 * naming (HOST_VIEW vs DOCKER_HOST_VIEW vs IOT_FLEET_VIEW), not the enum's.
 */
let recommendationPageKey: Record<MonitorRecommendationResourceType, string>;

const ALL_RESOURCE_TYPES: Array<MonitorRecommendationResourceType> =
  Object.values(MonitorRecommendationResourceType);

/*
 * Common/UI/Config reads `window` the moment it loads, and RouteMap pulls it in
 * transitively via ProjectUtil, so the browser stub has to exist before either
 * of them does — hence the deferred imports. A static import would be hoisted
 * above the stub and throw. Same approach as DeviceSummaryFilterRoute.test.ts.
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

  /*
   * Node 26 ships real sessionStorage/localStorage globals and plain
   * assignment over them throws inside jest's vm context; defining the
   * property works on every version. ProjectUtil falls through to these when
   * the URL carries no project id.
   */
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

  RouteMap = (await import("../../FeatureSet/Dashboard/src/Utils/RouteMap"))
    .default;
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
  RouteParams = (
    await import("../../FeatureSet/Dashboard/src/Utils/RouteParams")
  ).default;

  recommendationPageKey = {
    [MonitorRecommendationResourceType.Kubernetes]:
      PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.Host]: PageMap.HOST_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.Docker]:
      PageMap.DOCKER_HOST_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.DockerSwarm]:
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.Podman]:
      PageMap.PODMAN_HOST_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.Proxmox]:
      PageMap.PROXMOX_CLUSTER_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.Ceph]:
      PageMap.CEPH_CLUSTER_VIEW_RECOMMENDATIONS,
    [MonitorRecommendationResourceType.IoTDevice]:
      PageMap.IOT_FLEET_VIEW_RECOMMENDATIONS,
  };
});

describe("Monitor recommendation page wiring", () => {
  test("the catalog covers every resource type in the enum", () => {
    /*
     * Guards the assumption the rest of this file rests on: if the catalog
     * itself were missing a type, every route assertion below would still pass
     * while the page rendered "No monitor recommendations are available".
     */
    for (const resourceType of ALL_RESOURCE_TYPES) {
      expect(
        MonitorRecommendationCatalog.getResourceTypeDefinition(resourceType),
      ).toBeDefined();
      expect(
        MonitorRecommendationCatalog.getRecommendations(resourceType).length,
      ).toBeGreaterThan(0);
    }
  });

  test("every resource type has a recommendations page key", () => {
    for (const resourceType of ALL_RESOURCE_TYPES) {
      expect(recommendationPageKey[resourceType]).toBeTruthy();
    }
  });

  test("every recommendations page key resolves to a route", () => {
    for (const resourceType of ALL_RESOURCE_TYPES) {
      const route: Route | undefined =
        RouteMap[recommendationPageKey[resourceType]];

      expect(route).toBeDefined();
      expect(route!.toString().length).toBeGreaterThan(0);
    }
  });

  test("every recommendations route ends with /recommendations", () => {
    for (const resourceType of ALL_RESOURCE_TYPES) {
      const path: string =
        RouteMap[recommendationPageKey[resourceType]]!.toString();

      expect(path.endsWith("/recommendations")).toBe(true);
    }
  });

  test("every recommendations route carries the model id one segment before the end", () => {
    /*
     * The page reads its record with `Navigation.getLastParamAsObjectID(1)`,
     * which only resolves correctly when the model id sits immediately before
     * the last segment. A route shaped any other way loads the wrong record —
     * or none — without erroring.
     */
    for (const resourceType of ALL_RESOURCE_TYPES) {
      const segments: Array<string> =
        RouteMap[recommendationPageKey[resourceType]]!.toString().split("/");

      expect(segments[segments.length - 2]).toBe(RouteParams.ModelID);
    }
  });

  test("no two resource types share a recommendations route", () => {
    const paths: Array<string> = ALL_RESOURCE_TYPES.map(
      (resourceType: MonitorRecommendationResourceType) => {
        return RouteMap[recommendationPageKey[resourceType]]!.toString();
      },
    );

    expect(new Set<string>(paths).size).toBe(ALL_RESOURCE_TYPES.length);
  });

  test("no two resource types share a page key", () => {
    const keys: Array<string> = ALL_RESOURCE_TYPES.map(
      (resourceType: MonitorRecommendationResourceType) => {
        return recommendationPageKey[resourceType];
      },
    );

    expect(new Set<string>(keys).size).toBe(ALL_RESOURCE_TYPES.length);
  });
});
