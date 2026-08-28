import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Feed page is deliberately a page of its own rather than another card on
 * the overview, which already carries more than a screenful. That makes it
 * reachable only if five separate things line up: a PageMap key, a RouteMap
 * entry, a <PageRoute> in the product's routes file, a side menu link, and the
 * page component itself.
 *
 * Miss any one and there is no error anywhere - the menu entry is simply
 * absent, or the link 404s inside the layout. Nine products got this wiring at
 * once, so the sweep is the point: whichever one was fumbled fails by name.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

interface FeedPageSpec {
  product: string;
  pageMapKey: string;
  /** Product segment in the dashboard URL. */
  urlPrefix: string;
  pagesDirectory: string;
  routesFile: string;
}

const FEED_PAGES: Array<FeedPageSpec> = [
  {
    product: "Kubernetes",
    pageMapKey: "KUBERNETES_CLUSTER_VIEW_FEED",
    urlPrefix: "kubernetes",
    pagesDirectory: "Kubernetes",
    routesFile: "KubernetesRoutes.tsx",
  },
  {
    product: "Docker",
    pageMapKey: "DOCKER_HOST_VIEW_FEED",
    urlPrefix: "docker",
    pagesDirectory: "Docker",
    routesFile: "DockerRoutes.tsx",
  },
  {
    product: "Docker Swarm",
    pageMapKey: "DOCKER_SWARM_CLUSTER_VIEW_FEED",
    urlPrefix: "docker-swarm",
    pagesDirectory: "DockerSwarm",
    routesFile: "DockerSwarmRoutes.tsx",
  },
  {
    product: "Ceph",
    pageMapKey: "CEPH_CLUSTER_VIEW_FEED",
    urlPrefix: "ceph",
    pagesDirectory: "Ceph",
    routesFile: "CephRoutes.tsx",
  },
  {
    product: "Podman",
    pageMapKey: "PODMAN_HOST_VIEW_FEED",
    urlPrefix: "podman",
    pagesDirectory: "Podman",
    routesFile: "PodmanRoutes.tsx",
  },
  {
    product: "Proxmox",
    pageMapKey: "PROXMOX_CLUSTER_VIEW_FEED",
    urlPrefix: "proxmox",
    pagesDirectory: "Proxmox",
    routesFile: "ProxmoxRoutes.tsx",
  },
  {
    product: "Host",
    pageMapKey: "HOST_VIEW_FEED",
    urlPrefix: "host",
    pagesDirectory: "Host",
    routesFile: "HostRoutes.tsx",
  },
  {
    product: "Cloud",
    pageMapKey: "CLOUD_RESOURCE_VIEW_FEED",
    urlPrefix: "cloud",
    pagesDirectory: "Cloud",
    routesFile: "CloudResourceRoutes.tsx",
  },
  {
    product: "Service Catalog",
    pageMapKey: "SERVICE_VIEW_FEED",
    urlPrefix: "service",
    pagesDirectory: "Service",
    routesFile: "ServiceRoutes.tsx",
  },
];

const MODEL_ID: ObjectID = ObjectID.generate();

function read(...segments: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
}

describe("Resource feed pages", () => {
  test("every product that grew a feed is covered here", () => {
    expect(FEED_PAGES.length).toBe(9);
  });

  test.each(FEED_PAGES)(
    "$product has a Feed page key and route",
    (spec: FeedPageSpec) => {
      const key: string = spec.pageMapKey;

      expect(Object.keys(PageMap)).toContain(key);

      const route: Route | undefined = RouteMap[
        PageMap[key as keyof typeof PageMap]
      ] as Route | undefined;

      expect(route).toBeTruthy();

      const populated: string = RouteUtil.populateRouteParams(route!, {
        modelId: MODEL_ID,
      }).toString();

      expect(populated).toContain(`/${spec.urlPrefix}/`);
      expect(populated.endsWith("/feed")).toBe(true);
      expect(populated).toContain(MODEL_ID.toString());
    },
  );

  test("no two products share a feed route", () => {
    const routes: Array<string> = FEED_PAGES.map((spec: FeedPageSpec) => {
      return (
        RouteMap[PageMap[spec.pageMapKey as keyof typeof PageMap]] as Route
      ).toString();
    });

    expect(new Set(routes).size).toBe(routes.length);
  });

  test.each(FEED_PAGES)(
    "$product renders a page component at that route",
    (spec: FeedPageSpec) => {
      const pageFile: string = path.join(
        DASHBOARD_SRC,
        "Pages",
        spec.pagesDirectory,
        "View",
        "Feed.tsx",
      );

      expect(fs.existsSync(pageFile)).toBe(true);

      const routes: string = read("Routes", spec.routesFile);

      expect(routes).toContain(`PageMap.${spec.pageMapKey}`);
      expect(routes).toContain(
        `from "../Pages/${spec.pagesDirectory}/View/Feed"`,
      );
    },
  );

  test.each(FEED_PAGES)(
    "$product links to the feed from its side menu",
    (spec: FeedPageSpec) => {
      /*
       * A page with no menu entry is a page nobody finds. This asserts the
       * link exists AND that it points at the feed key rather than being a
       * copy of the neighbouring entry.
       */
      const sideMenu: string = read(
        "Pages",
        spec.pagesDirectory,
        "View",
        "SideMenu.tsx",
      );

      expect(sideMenu).toContain('title: "Feed"');
      expect(sideMenu).toContain(
        `RouteMap[PageMap.${spec.pageMapKey}] as Route`,
      );
    },
  );

  test.each(FEED_PAGES)(
    "$product's feed page reads the model id from the route",
    (spec: FeedPageSpec) => {
      const page: string = read(
        "Pages",
        spec.pagesDirectory,
        "View",
        "Feed.tsx",
      );

      /*
       * The feed route is <modelId>/feed, so the id is one segment back.
       * getLastParamAsObjectID(0) would read the literal string "feed".
       */
      expect(page).toContain("Navigation.getLastParamAsObjectID(1)");
      expect(page).toContain("ResourceFeed");
    },
  );
});
