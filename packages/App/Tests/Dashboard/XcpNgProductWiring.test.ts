import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RouteAttributes,
  pageRoutesIn,
  routeMapPath,
  routesAt,
} from "../Helpers/PageRoutes";

/*
 * The XCP-ng product is a lazy-loaded route group mirroring the Proxmox
 * one: a product Layout (every pool, the archived ones, the install guide,
 * owner / label rules and their history) plus one pool's View layout with
 * its inventory (hosts, VMs, storage repositories, each with a page of its
 * own), telemetry and activity pages. Every piece of that wiring fails
 * silently rather than loudly:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a View page with no PageRoute is reachable from the side menu but 404s,
 *   - a detail route registered with one trailing segment shadows its list,
 *   - a pool matched on its name instead of its UUID splits its history the
 *     day someone renames it in Xen Orchestra.
 *
 * The App suite runs in a plain Node environment with no React renderer and
 * cannot import the dashboard's route modules (they reach for browser
 * globals), so these are source-level invariants, following
 * StorageArrayProductWiring.test.ts. Whitespace is squashed so Prettier can
 * reflow without making the tests brittle.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...segments: Array<string>) => string;

const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

type SquashFunction = (source: string) => string;

const squash: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

/** All whitespace removed, for assertions Prettier would otherwise reflow. */
const dense: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, "");
};

const stripComments: SquashFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

/** Every PageMap key the product is built from (the agreed contract). */
const XCP_NG_PAGE_KEYS: ReadonlyArray<string> = [
  "XCP_NG_ROOT",
  "XCP_NG_POOLS",
  "XCP_NG_POOLS_ARCHIVED",
  "XCP_NG_DOCUMENTATION",
  "XCP_NG_SETTINGS_OWNER_RULES",
  "XCP_NG_SETTINGS_OWNER_RULE_VIEW",
  "XCP_NG_SETTINGS_LABEL_RULES",
  "XCP_NG_SETTINGS_LABEL_RULE_VIEW",
  "XCP_NG_SETTINGS_RULES_AUDIT_LOGS",
  "XCP_NG_POOL_VIEW",
  "XCP_NG_POOL_VIEW_HOSTS",
  "XCP_NG_POOL_VIEW_HOST_DETAIL",
  "XCP_NG_POOL_VIEW_VMS",
  "XCP_NG_POOL_VIEW_VM_DETAIL",
  "XCP_NG_POOL_VIEW_STORAGE",
  "XCP_NG_POOL_VIEW_STORAGE_DETAIL",
  // The pool drawn as one map: Components/ResourceTopology.
  "XCP_NG_POOL_VIEW_TOPOLOGY",
  "XCP_NG_POOL_VIEW_INSIGHTS",
  "XCP_NG_POOL_VIEW_RECOMMENDATIONS",
  "XCP_NG_POOL_VIEW_METRICS",
  "XCP_NG_POOL_VIEW_LOGS",
  "XCP_NG_POOL_VIEW_ALERTS",
  "XCP_NG_POOL_VIEW_INCIDENTS",
  "XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE",
  "XCP_NG_POOL_VIEW_FEED",
  "XCP_NG_POOL_VIEW_OWNERS",
  "XCP_NG_POOL_VIEW_SETTINGS",
  "XCP_NG_POOL_VIEW_DOCUMENTATION",
  "XCP_NG_POOL_VIEW_AUDIT_LOGS",
  "XCP_NG_POOL_VIEW_DELETE",
  // The connections a probe reads, and one connection's page (#10996, #10999).
  "XCP_NG_CONNECTIONS",
  "XCP_NG_CONNECTION_VIEW",
];

/**
 * Keys that name a real, navigable page. XCP_NG_ROOT is the lazy-route
 * mount (`/xcp-ng/*`).
 */
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> = XCP_NG_PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "XCP_NG_ROOT";
  },
);

/**
 * Every page module under Pages/XcpNg/View and the PageMap key whose
 * PageRoute must render it. A file here with no entry in XcpNgRoutes.tsx is
 * a page that exists on disk but can never be reached.
 */
const VIEW_PAGES: ReadonlyArray<[string, string]> = [
  ["Index.tsx", "XCP_NG_POOL_VIEW"],
  ["Hosts.tsx", "XCP_NG_POOL_VIEW_HOSTS"],
  ["HostDetail.tsx", "XCP_NG_POOL_VIEW_HOST_DETAIL"],
  ["Vms.tsx", "XCP_NG_POOL_VIEW_VMS"],
  ["VmDetail.tsx", "XCP_NG_POOL_VIEW_VM_DETAIL"],
  ["Storage.tsx", "XCP_NG_POOL_VIEW_STORAGE"],
  ["StorageDetail.tsx", "XCP_NG_POOL_VIEW_STORAGE_DETAIL"],
  ["Topology.tsx", "XCP_NG_POOL_VIEW_TOPOLOGY"],
  ["Insights.tsx", "XCP_NG_POOL_VIEW_INSIGHTS"],
  ["Recommendations.tsx", "XCP_NG_POOL_VIEW_RECOMMENDATIONS"],
  ["Metrics.tsx", "XCP_NG_POOL_VIEW_METRICS"],
  ["Logs.tsx", "XCP_NG_POOL_VIEW_LOGS"],
  ["Alerts.tsx", "XCP_NG_POOL_VIEW_ALERTS"],
  ["Incidents.tsx", "XCP_NG_POOL_VIEW_INCIDENTS"],
  ["ScheduledMaintenance.tsx", "XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE"],
  ["Feed.tsx", "XCP_NG_POOL_VIEW_FEED"],
  ["Owners.tsx", "XCP_NG_POOL_VIEW_OWNERS"],
  ["Settings.tsx", "XCP_NG_POOL_VIEW_SETTINGS"],
  ["Documentation.tsx", "XCP_NG_POOL_VIEW_DOCUMENTATION"],
  ["AuditLogs.tsx", "XCP_NG_POOL_VIEW_AUDIT_LOGS"],
  ["Delete.tsx", "XCP_NG_POOL_VIEW_DELETE"],
];

/** Product-level pages (rendered under Pages/XcpNg/Layout.tsx). */
const PRODUCT_PAGES: ReadonlyArray<[Array<string>, string]> = [
  [["Pools.tsx"], "XCP_NG_POOLS"],
  [["Documentation.tsx"], "XCP_NG_DOCUMENTATION"],
  [["Archived.tsx"], "XCP_NG_POOLS_ARCHIVED"],
  [["Connections.tsx"], "XCP_NG_CONNECTIONS"],
  [["ConnectionView.tsx"], "XCP_NG_CONNECTION_VIEW"],
  [["Settings", "OwnerRules.tsx"], "XCP_NG_SETTINGS_OWNER_RULES"],
  [["Settings", "LabelRules.tsx"], "XCP_NG_SETTINGS_LABEL_RULES"],
  [["Settings", "RulesAuditLogs.tsx"], "XCP_NG_SETTINGS_RULES_AUDIT_LOGS"],
];

/** Detail pages and the URL segment of the list each is reached from. */
const DETAIL_PAGES: ReadonlyArray<[string, string]> = [
  ["XCP_NG_POOL_VIEW_HOST_DETAIL", "hosts"],
  ["XCP_NG_POOL_VIEW_VM_DETAIL", "vms"],
  ["XCP_NG_POOL_VIEW_STORAGE_DETAIL", "storage"],
];

describe("PageMap declares the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");

  test.each(XCP_NG_PAGE_KEYS)("%s is declared", (key: string) => {
    expect(pageMap).toContain(`${key} = "${key}"`);
  });

  test("there is no AI agent page — XCP-ng pools have no resource AI agent yet (#10998)", () => {
    expect(pageMap).not.toContain("XCP_NG_POOL_VIEW_AI_");
  });

  test("the product's keys come right after VMware's", () => {
    const vmwareArchived: number = pageMap.indexOf(
      'VMWARE_ARCHIVED = "VMWARE_ARCHIVED"',
    );
    const xcpNgRoot: number = pageMap.indexOf('XCP_NG_ROOT = "XCP_NG_ROOT"');
    expect(vmwareArchived).toBeGreaterThan(-1);
    expect(xcpNgRoot).toBeGreaterThan(vmwareArchived);
    expect(pageMap.slice(vmwareArchived, xcpNgRoot)).not.toMatch(
      /[A-Z_]+ = "[A-Z_]+",\s+[A-Z_]+ = /,
    );
  });
});

describe("RouteMap gives every page a URL", () => {
  const routeMap: string = squash(readSource("Utils", "RouteMap.ts"));

  test.each(XCP_NG_PAGE_KEYS)("%s has a route", (key: string) => {
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("the product is mounted at /xcp-ng", () => {
    expect(dense(routeMap)).toContain(
      "[PageMap.XCP_NG_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/xcp-ng/*`,)",
    );
    expect(dense(routeMap)).toContain(
      "[PageMap.XCP_NG_POOLS]:newRoute(`/dashboard/${RouteParams.ProjectID}/xcp-ng`,)",
    );
  });

  test.each([
    ["XCP_NG_POOL_VIEW_HOSTS", "hosts"],
    ["XCP_NG_POOL_VIEW_VMS", "vms"],
    ["XCP_NG_POOL_VIEW_STORAGE", "storage"],
    ["XCP_NG_POOL_VIEW_TOPOLOGY", "topology"],
    ["XCP_NG_POOL_VIEW_INSIGHTS", "insights"],
    ["XCP_NG_POOL_VIEW_RECOMMENDATIONS", "recommendations"],
    ["XCP_NG_POOL_VIEW_METRICS", "metrics"],
    ["XCP_NG_POOL_VIEW_LOGS", "logs"],
    ["XCP_NG_POOL_VIEW_ALERTS", "alerts"],
    ["XCP_NG_POOL_VIEW_INCIDENTS", "incidents"],
    ["XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE", "scheduled-maintenance"],
    ["XCP_NG_POOL_VIEW_FEED", "feed"],
    ["XCP_NG_POOL_VIEW_OWNERS", "owners"],
    ["XCP_NG_POOL_VIEW_SETTINGS", "settings"],
    ["XCP_NG_POOL_VIEW_DOCUMENTATION", "documentation"],
    ["XCP_NG_POOL_VIEW_AUDIT_LOGS", "audit-logs"],
    ["XCP_NG_POOL_VIEW_DELETE", "delete"],
  ])("%s uses the URL segment %s", (key: string, segment: string) => {
    expect(dense(routeMap)).toContain(
      `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}\``,
    );
  });

  test("the pool's own page is the pool's id under /xcp-ng", () => {
    expect(dense(routeMap)).toContain(
      "[PageMap.XCP_NG_POOL_VIEW]:`${RouteParams.ModelID}`",
    );
  });

  test.each([
    ["XCP_NG_DOCUMENTATION", "documentation"],
    ["XCP_NG_SETTINGS_OWNER_RULES", "settings/owner-rules"],
    ["XCP_NG_SETTINGS_LABEL_RULES", "settings/label-rules"],
    ["XCP_NG_POOLS_ARCHIVED", "archived"],
    ["XCP_NG_CONNECTIONS", "connections"],
  ])("the product page %s is at %s", (key: string, segment: string) => {
    expect(dense(routeMap)).toContain(`[PageMap.${key}]:\`${segment}\``);
  });

  test("a connection's page is its id under connections, never one segment that would shadow a pool", () => {
    expect(dense(routeMap)).toContain(
      "[PageMap.XCP_NG_CONNECTION_VIEW]:`connections/${RouteParams.ModelID}`",
    );
  });

  test("the rule history page is at settings/rules-audit-logs, as every product's", () => {
    expect(dense(routeMap)).toContain(
      '[PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS]:"settings/rules-audit-logs"',
    );
  });

  test.each(DETAIL_PAGES)(
    "%s carries a sub-model segment (the object's XAPI UUID) under %s",
    (key: string, segment: string) => {
      expect(dense(routeMap)).toContain(
        `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}/\${RouteParams.SubModelID}\``,
      );
    },
  );

  test("every route below the product root is built from the XcpNgRoutePath dictionary", () => {
    for (const key of NAVIGABLE_PAGE_KEYS) {
      if (key === "XCP_NG_POOLS") {
        continue;
      }
      expect(dense(routeMap)).toContain(`XcpNgRoutePath[PageMap.${key}]`);
    }
  });

  test("the product's routes come right after VMware's", () => {
    const vmwareArchived: number = dense(routeMap).indexOf(
      "[PageMap.VMWARE_ARCHIVED]:newRoute(",
    );
    const xcpNgRoot: number = dense(routeMap).indexOf(
      "[PageMap.XCP_NG_ROOT]:newRoute(",
    );
    const iotRoot: number = dense(routeMap).indexOf(
      "[PageMap.IOT_ROOT]:newRoute(",
    );
    expect(vmwareArchived).toBeGreaterThan(-1);
    expect(xcpNgRoot).toBeGreaterThan(vmwareArchived);
    expect(iotRoot).toBeGreaterThan(xcpNgRoot);
  });
});

describe("every route is actually mounted", () => {
  const routes: string = squash(readSource("Routes", "XcpNgRoutes.tsx"));

  test.each(NAVIGABLE_PAGE_KEYS)(
    "%s is rendered by a PageRoute",
    (key: string) => {
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("the pool view renders the Overview by default", () => {
    // Otherwise a link to /xcp-ng/:id lands on a blank layout.
    expect(dense(routes)).toContain(
      "<PageRouteindexelement={<XcpNgPoolOverview",
    );
  });

  test("the view pages are nested under the pool view layout", () => {
    expect(routes).toContain("element={<XcpNgPoolViewLayout");
    expect(routes).toContain("element={<XcpNgLayout");
    expect(dense(routes)).toContain(
      'path={XcpNgRoutePath[PageMap.XCP_NG_POOL_VIEW]||""}element={<XcpNgPoolViewLayout{...props}/>}',
    );
  });

  test("detail routes register two trailing path segments", () => {
    /*
     * RouteUtil.getLastPathForKey(key, 2) yields `hosts/:subModelId`; the
     * default depth of 1 would register only `:subModelId` and shadow the
     * list route.
     */
    for (const [key] of DETAIL_PAGES) {
      expect(dense(routes)).toMatch(
        new RegExp(`RouteUtil\\.getLastPathForKey\\(PageMap\\.${key},2,?\\)`),
      );
    }
  });

  test("the rule view routes hand the rule model to the rule pages", () => {
    expect(dense(routes)).toContain("ruleViewModelType={XcpNgPoolOwnerRule}");
    expect(dense(routes)).toContain("ruleViewModelType={XcpNgPoolLabelRule}");
  });

  test("both the product and the pool view mount their Developer pages", () => {
    expect(dense(routes)).toContain(
      "getDeveloperDocsRoutes({modelType:XcpNgPool,scope:DeveloperDocsScope.List,props,mountPageKey:PageMap.XCP_NG_ROOT,})",
    );
    expect(dense(routes)).toContain(
      "getDeveloperDocsRoutes({modelType:XcpNgPool,scope:DeveloperDocsScope.View,props,})",
    );
  });

  test.each(VIEW_PAGES)(
    "Pages/XcpNg/View/%s exists and is imported by the routes file for %s",
    (file: string, key: string) => {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, "Pages", "XcpNg", "View", file)),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/XcpNg/View/${file.replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test.each(PRODUCT_PAGES)(
    "Pages/XcpNg/%s exists and is routed for %s",
    (segments: Array<string>, key: string) => {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, "Pages", "XcpNg", ...segments)),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/XcpNg/${segments.join("/").replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("no View page on disk is left unrouted", () => {
    const onDisk: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, "Pages", "XcpNg", "View"))
      .filter((file: string): boolean => {
        return (
          file.endsWith(".tsx") &&
          file !== "Layout.tsx" &&
          file !== "SideMenu.tsx"
        );
      })
      .sort();

    expect(onDisk).toEqual(
      VIEW_PAGES.map((entry: [string, string]): string => {
        return entry[0];
      }).sort(),
    );
  });

  test("there is no AI folder: XCP-ng pools have no resource AI agent yet", () => {
    expect(
      fs.existsSync(path.join(DASHBOARD_SRC, "Pages", "XcpNg", "View", "AI")),
    ).toBe(false);
  });

  test("AllRoutes exports the product", () => {
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as XcpNgRoutes } from "./XcpNgRoutes";',
    );
  });

  test("App.tsx mounts the product router at the product root, lazily", () => {
    expect(
      routesAt(
        pageRoutesIn(path.join(DASHBOARD_SRC, "App.tsx")),
        routeMapPath("XCP_NG_ROOT"),
      ),
    ).toEqual([
      {
        path: routeMapPath("XCP_NG_ROOT"),
        element: "<XcpNgRoutes {...commonPageProps} />",
      },
    ]);
    expect(dense(readSource("App.tsx"))).toContain(
      'lazy(()=>{returnimport("./Routes/XcpNgRoutes");})',
    );
  });

  test("App.tsx mounts the product right after VMware", () => {
    const appRoutes: Array<RouteAttributes> = pageRoutesIn(
      path.join(DASHBOARD_SRC, "App.tsx"),
    );
    const vmwarePath: string = routeMapPath("VMWARE_ROOT");

    expect(routesAt(appRoutes, vmwarePath)).toEqual([
      { path: vmwarePath, element: "<VMwareRoutes {...commonPageProps} />" },
    ]);

    // Each the only route at its path, so where it sits is where it mounts.
    const paths: Array<string | undefined> = appRoutes.map(
      (route: RouteAttributes): string | undefined => {
        return route["path"];
      },
    );
    const vmware: number = paths.indexOf(vmwarePath);
    const xcpNg: number = paths.indexOf(routeMapPath("XCP_NG_ROOT"));

    expect(xcpNg).toBeGreaterThan(vmware);
    // No other product's router sits between the two.
    expect(
      appRoutes
        .slice(vmware + 1, xcpNg)
        .filter((route: RouteAttributes): boolean => {
          return (route["element"] || "").includes(
            "Routes {...commonPageProps}",
          );
        }),
    ).toEqual([]);
  });

  test("the product counts as XCP-ng for the products a project uses", () => {
    expect(
      dense(readSource("Utils", "ProjectProducts", "ProductOfRoute.ts")),
    ).toContain("[ProductKey.XcpNg]:[PageMap.XCP_NG_ROOT],");
  });
});

describe("every navigable page has breadcrumbs", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "XcpNgBreadcrumbs.ts"),
  );

  test.each(NAVIGABLE_PAGE_KEYS)("%s has a breadcrumb trail", (key: string) => {
    expect(breadcrumbs).toContain(`PageMap.${key},`);
  });

  test("the list's trail reads Project > XCP-ng > XCP-ng Pools, never Ceph's bare Pools", () => {
    expect(dense(breadcrumbs)).toContain(
      'PageMap.XCP_NG_POOLS,["Project","XCP-ng","XCP-ngPools",]',
    );
  });

  test("the archived page's trail reads Project > XCP-ng > Archived", () => {
    expect(dense(breadcrumbs)).toContain(
      'PageMap.XCP_NG_POOLS_ARCHIVED,["Project","XCP-ng","Archived",]',
    );
  });

  test("a part's page sits under its list: View Pool > VMs > VM Detail", () => {
    expect(dense(breadcrumbs)).toContain(
      'PageMap.XCP_NG_POOL_VIEW_VM_DETAIL,["Project","XCP-ng","ViewPool","VMs","VMDetail",]',
    );
    expect(dense(breadcrumbs)).toContain(
      'PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL,["Project","XCP-ng","ViewPool","Hosts","HostDetail",]',
    );
    expect(dense(breadcrumbs)).toContain(
      'PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL,["Project","XCP-ng","ViewPool","Storage","StorageDetail",]',
    );
  });

  test("the trails use XCP-ng's words, not another product's", () => {
    expect(breadcrumbs).toContain('"XCP-ng"');
    expect(breadcrumbs).toContain('"View Pool"');
    expect(breadcrumbs).toContain('"Hosts"');
    expect(breadcrumbs).toContain('"VMs"');
    expect(breadcrumbs).toContain('"Delete Pool"');
    // The page the side menu calls Resource Usage, as every product's.
    expect(breadcrumbs).toContain('"Resource Usage"');
    expect(breadcrumbs).not.toContain("Proxmox");
    expect(breadcrumbs).not.toContain('"View Cluster"');
    expect(breadcrumbs).not.toContain('"Guests"');
    expect(breadcrumbs).not.toContain('"Nodes"');
  });

  test("the breadcrumb module is exported from the barrel", () => {
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      'export * from "./XcpNgBreadcrumbs";',
    );
  });

  test("both layouts read the XCP-ng trail", () => {
    expect(readSource("Pages", "XcpNg", "Layout.tsx")).toContain(
      "getXcpNgBreadcrumbs(path)",
    );
    expect(readSource("Pages", "XcpNg", "View", "Layout.tsx")).toContain(
      "getXcpNgBreadcrumbs(path)",
    );
  });
});

describe("the side menus reach the whole product", () => {
  const productSideMenu: string = readSource("Pages", "XcpNg", "SideMenu.tsx");
  const viewSideMenu: string = readSource(
    "Pages",
    "XcpNg",
    "View",
    "SideMenu.tsx",
  );

  test("the product side menu links to the list, archive, docs and rules", () => {
    for (const key of [
      "XCP_NG_POOLS",
      "XCP_NG_POOLS_ARCHIVED",
      "XCP_NG_DOCUMENTATION",
      "XCP_NG_SETTINGS_OWNER_RULES",
      "XCP_NG_SETTINGS_LABEL_RULES",
      "XCP_NG_SETTINGS_RULES_AUDIT_LOGS",
      "XCP_NG_CONNECTIONS",
    ]) {
      expect(dense(productSideMenu)).toContain(
        `RouteMap[PageMap.${key}]asRoute`,
      );
    }
    // The search index files the list under this exact title.
    expect(productSideMenu).toContain('title: "All Pools"');
  });

  test("the pool side menu links to every view page but the detail pages", () => {
    for (const [, key] of VIEW_PAGES) {
      if (key.endsWith("_DETAIL")) {
        // Detail pages are reached from their list, not the side menu.
        continue;
      }
      expect({
        key,
        linked: dense(viewSideMenu).includes(`RouteMap[PageMap.${key}]asRoute`),
      }).toEqual({ key, linked: true });
    }
  });

  test("the side menu badges come from the pool's row, not a second read of the inventory", () => {
    const layout: string = dense(
      readSource("Pages", "XcpNg", "View", "Layout.tsx"),
    );

    expect(layout).toContain(
      "select:{hostCount:true,vmCount:true,storageRepositoryCount:true,}",
    );
    expect(layout).toContain("hosts:readCount(pool.hostCount)");
    expect(layout).toContain("vms:readCount(pool.vmCount)");
    expect(layout).toContain(
      "storageRepositories:readCount(pool.storageRepositoryCount)",
    );
    expect(dense(viewSideMenu)).toContain("badge={counts.hosts}");
    expect(dense(viewSideMenu)).toContain("badge={counts.vms}");
    expect(dense(viewSideMenu)).toContain("badge={counts.storageRepositories}");
  });

  test("the pool's count columns are the ones the model has", () => {
    const model: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Models",
        "DatabaseModels",
        "XcpNgPool.ts",
      ),
      "utf8",
    );
    for (const column of [
      "hostCount",
      "runningHostCount",
      "vmCount",
      "runningVmCount",
      "storageRepositoryCount",
      "storageCapacityBytes",
      "storageUsedBytes",
      "xenOrchestraName",
      "reportedName",
      "poolIdentifier",
      "agentVersion",
      "agentLastSeenAt",
    ]) {
      expect(model).toContain(`public ${column}?:`);
    }
  });

  test("the pool side menu scopes activity counts by the xcpNgPools relation", () => {
    const sideMenu: string = squash(viewSideMenu);

    expect(sideMenu).toContain("xcpNgPools: new Includes([props.modelId])");
    expect(sideMenu.split("xcpNgPools: new Includes").length - 1).toBe(3);
    expect(sideMenu).not.toContain("proxmoxClusters");
  });

  test("the pool side menu has no AI section yet", () => {
    expect(viewSideMenu).not.toContain('title="AI"');
    expect(viewSideMenu).not.toContain("AI_AGENT");
    expect(viewSideMenu).not.toContain("AI_INSIGHTS");
  });

  test("recommendations are the XCP-ng templates'", () => {
    expect(dense(viewSideMenu)).toContain(
      "resourceType={MonitorRecommendationResourceType.XcpNg}",
    );
    expect(
      dense(readSource("Pages", "XcpNg", "View", "Recommendations.tsx")),
    ).toContain("resourceType={MonitorRecommendationResourceType.XcpNg}");
  });
});

describe("the record tabs carry the pool into what they create", () => {
  test.each([
    ["Incidents.tsx", "IncidentsTable"],
    ["Alerts.tsx", "AlertsTable"],
    ["ScheduledMaintenance.tsx", "ScheduledMaintenancesTable"],
  ])("%s scopes %s by the pool and creates from it", (file: string) => {
    const source: string = dense(readSource("Pages", "XcpNg", "View", file));
    expect(source).toContain("query.xcpNgPools=newIncludes([modelId]);");
    expect(source).toContain(
      "createFrom={{kind:CreateFromRecordKind.XcpNgPool,id:modelId}}",
    );
  });

  test("a create page opened from a pool is told so by xcpNgPoolId and keeps the pool", () => {
    const createFrom: string = dense(
      readSource("Components", "CreateFromRecord", "CreateFromRecord.ts"),
    );
    expect(createFrom).toContain('XcpNgPool="XcpNgPool",');
    expect(createFrom).toContain(
      'kind:CreateFromRecordKind.XcpNgPool,queryParam:"xcpNgPoolId",listTitle:"XCP-ng",listPage:PageMap.XCP_NG_POOLS,viewTitle:"ViewPool",viewPage:PageMap.XCP_NG_POOL_VIEW,field:namedRecords("xcpNgPools"),',
    );
    for (const tab of [
      "XCP_NG_POOL_VIEW_INCIDENTS",
      "XCP_NG_POOL_VIEW_ALERTS",
      "XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE",
    ]) {
      expect(createFrom).toContain(`page:PageMap.${tab},`);
    }
    expect(
      dense(
        readSource(
          "Components",
          "CreateFromRecord",
          "useRecordToCreateFrom.ts",
        ),
      ),
    ).toContain("[CreateFromRecordKind.XcpNgPool]:XcpNgPool,");
  });
});

describe("the navbar link exists and is not commented out", () => {
  const navBarRaw: string = readSource("Utils", "NavigationItems.tsx");
  const navBar: string = squash(navBarRaw);

  test("there is a live XCP-ng entry", () => {
    expect(dense(navBarRaw)).toContain('t("navbar.items.xcpNgTitle","XCP-ng")');
    expect(dense(navBarRaw)).toContain('t("navbar.items.xcpNgDescription",');
  });

  test("the entry routes to the product", () => {
    expect(navBar).toContain("RouteMap[PageMap.XCP_NG_POOLS] as Route");
    expect(navBar).toContain("activeRoute: RouteMap[PageMap.XCP_NG_POOLS]");
  });

  test("the entry carries the XCP-ng icon and key, and sits with infrastructure", () => {
    const start: number = navBar.indexOf('t("navbar.items.xcpNgTitle"');
    const entry: string = navBar.slice(start - 60, start + 900);
    expect(entry).toContain("key: ProductKey.XcpNg");
    expect(entry).toContain("icon: IconProp.XcpNg");
    expect(entry).toContain("category: infrastructureCategory");
  });

  test("the entry comes right after VMware's", () => {
    const vmware: number = navBar.indexOf('t("navbar.items.vmwareTitle"');
    const xcpNg: number = navBar.indexOf('t("navbar.items.xcpNgTitle"');
    expect(vmware).toBeGreaterThan(-1);
    expect(xcpNg).toBeGreaterThan(vmware);
    // No other product's entry sits between the two.
    expect(navBar.slice(vmware, xcpNg)).not.toMatch(
      /t\("navbar\.items\.(?!vmware)\w+Title"/,
    );
  });

  test("the entry is found by the words people running XCP-ng or XenServer search for", () => {
    const start: number = navBar.indexOf('t("navbar.items.xcpNgTitle"');
    const entry: string = navBar.slice(start, start + 900);
    for (const keyword of [
      "xen",
      "xenserver",
      "xen orchestra",
      "xo",
      "xcp",
      "hypervisor",
    ]) {
      expect(entry).toContain(`"${keyword}"`);
    }
  });

  test("the entry is not inside a block comment", () => {
    expect(squash(stripComments(navBarRaw))).toContain(
      't("navbar.items.xcpNgTitle"',
    );
  });
});

describe("the product explains itself and opens its install guide from Add", () => {
  const list: string = squash(readSource("Pages", "XcpNg", "Pools.tsx"));
  const onboarding: string = squash(
    readSource("Components", "XcpNg", "XcpNgPoolOnboarding.tsx"),
  );
  const card: string = squash(
    readSource("Components", "XcpNg", "DocumentationCard.tsx"),
  );

  test("the list shows its showcase under the empty table while the project has no pool", () => {
    // Counted by the shared first-record watch (useFirstRecordWatch).
    expect(list).toContain("{firstRecordWatch.count === 0 && (");
    expect(
      list.indexOf(
        "<ResourceShowcaseCard showcase={XCP_NG_POOL_SHOWCASE} addButton={{ title: XCP_NG_POOL_ONBOARDING.addTitle,",
      ),
    ).toBeGreaterThan(list.indexOf("{firstRecordWatch.count === 0 && ("));
    expect(list).not.toContain("<AddResourceGuide");
  });

  test("a pool registers itself when Xen Orchestra first reports it, so the list has no create form", () => {
    expect(list).toContain("isCreateable={false}");
    expect(list).toContain("formFields={[]}");
    expect(list).toContain("title: XCP_NG_POOL_ONBOARDING.addTitle,");
    expect(list).toContain(
      "<AddResourceModal onboarding={XCP_NG_POOL_ONBOARDING}",
    );
    // One the dialog sees connect puts the showcase away at once.
    expect(list).toContain("firstRecordWatch.onRecordCreated();");
  });

  test("the Add guide asks for no pool name: pools name themselves after Xen Orchestra's", () => {
    expect(onboarding).toContain("<XcpNgDocumentationCard");
    expect(onboarding).not.toMatch(/\bname: \{/);
    expect(onboarding).toContain("viewPage: PageMap.XCP_NG_POOL_VIEW,");
  });

  test("the documentation card draws the shared setup guide from the XCP-ng markdown", () => {
    expect(card).toContain("const XcpNgDocumentationCard");
    expect(card).toContain("<SetupGuideCard");
    expect(card).toContain("getXcpNgSetupGuide({");
    expect(card).toContain("apiKey: context.apiKey");
    expect(card).toContain("hasApiKey: context.hasApiKey");
    expect(card).toContain("method: resolveXcpNgConnectMethod(context.option)");
    expect(card).toContain("xenOrchestraName: props.xenOrchestraName");
    expect(card).toContain("options={XCP_NG_CONNECT_METHODS}");
    expect(card).toContain("translations={XCP_NG_DOCUMENTATION_TRANSLATIONS}");
    expect(card).toContain("icon={IconProp.XcpNg}");
    expect(card).toContain("export default XcpNgDocumentationCard");
  });

  test("a pool's own Documentation tab installs under the name of the Xen Orchestra it is read from", () => {
    const page: string = dense(
      readSource("Pages", "XcpNg", "View", "Documentation.tsx"),
    );
    expect(page).toContain("select:{name:true,xenOrchestraName:true,}");
    expect(page).toContain(
      "xenOrchestraName={pool.xenOrchestraName||undefined}",
    );
  });

  test("the product-level Documentation page draws the same guide", () => {
    expect(readSource("Pages", "XcpNg", "Documentation.tsx")).toContain(
      "<XcpNgDocumentationCard",
    );
  });

  test("the product's explanation is registered under its menu's page, with its docs", () => {
    const onboardings: string = dense(
      readSource("Components", "ProductOnboarding", "ProductOnboardings.ts"),
    );
    expect(onboardings).toContain(
      '[ProductKey.XcpNg]:{page:PageMap.XCP_NG_POOLS,name:translationKey("XCP-ng"),showcase:XCP_NG_POOL_SHOWCASE,docsRoute:docs("telemetry/xcp-ng"),}',
    );
    expect(readSource("Pages", "XcpNg", "Layout.tsx")).toContain(
      "<ProductAboutButton product={ProductKey.XcpNg} />",
    );
  });
});

describe("no other product's concept leaked into the XCP-ng pages", () => {
  const productDir: string = path.join(DASHBOARD_SRC, "Pages", "XcpNg");
  const componentDir: string = path.join(DASHBOARD_SRC, "Components", "XcpNg");

  const TS_FILE_PATTERN: RegExp = /\.tsx?$/;

  function walk(directory: string): Array<string> {
    const out: Array<string> = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(absolute));
      } else if (TS_FILE_PATTERN.test(entry.name)) {
        out.push(absolute);
      }
    }
    return out;
  }

  const files: Array<string> = [...walk(productDir), ...walk(componentDir)];

  test("there are XCP-ng page sources to scan", () => {
    expect(files.length).toBeGreaterThan(25);
  });

  test.each(
    files.map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file);
    }),
  )(
    "%s carries no Proxmox, VMware, Ceph or storage array identifiers",
    (relative: string) => {
      const source: string = stripComments(
        fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8"),
      );

      for (const forbidden of [
        "ProxmoxCluster",
        "proxmoxCluster",
        "PROXMOX_",
        "proxmox.cluster.name",
        "pve.scope",
        "VMwareVCenter",
        "vmware.vcenter.name",
        "CephCluster",
        "StorageArray",
        "ResourceAiAgent",
        "AiResourceType",
      ]) {
        expect({
          relative,
          forbidden,
          found: source.includes(forbidden),
        }).toEqual({ relative, forbidden, found: false });
      }
    },
  );

  test("telemetry is matched on the pool's UUID (xcp_ng.pool.id), never on its name", () => {
    for (const file of ["Metrics.tsx", "Logs.tsx"]) {
      const source: string = dense(readSource("Pages", "XcpNg", "View", file));
      expect(source).toContain('"resource.xcp_ng.pool.id"');
      expect(source).toContain("keyForXcpNgPool(");
      expect(source).toContain('attributeKey:"resource.xcp_ng.pool.id"');
      expect(source).toContain("attributeValue:pool.poolIdentifier");
      expect(source).not.toContain("attributeValue:pool.name");
      /*
       * The locked chip names the pool, not its UUID, under the kind's own
       * name: the bare "Pool" is Ceph's storage pool in every language.
       */
      expect(source).toContain('"resource.xcp_ng.pool.id":"XCP-ngPool"');
      expect(source).toContain(
        '"resource.xcp_ng.pool.id":pool.name||pool.poolIdentifier',
      );
    }
  });

  test("the pool's Logs say there are none from the agent, and why", () => {
    const logs: string = readSource("Pages", "XcpNg", "View", "Logs.tsx");
    expect(logs).toContain("noLogsMessage=");
    expect(squash(logs)).toContain("The XCP-ng Agent sends no logs yet");
    expect(logs).toContain("SavedViewScopeKind.XcpNgPool");
    expect(logs).toContain("`xcp-ng-pool-logs-${modelId.toString()}`");
  });

  test("Resource Usage reads the catalog, scoped by the pool's UUID and each series' scope", () => {
    const insights: string = dense(
      readSource("Pages", "XcpNg", "View", "Insights.tsx"),
    );
    expect(insights).toContain(
      'constXCP_NG_POOL_RESOURCE_ATTRIBUTE:string="resource.xcp_ng.pool.id";',
    );
    expect(insights).toContain(
      "[XCP_NG_POOL_RESOURCE_ATTRIBUTE]:data.poolIdentifier,[XCP_NG_SCOPE_ATTRIBUTE]:metric.defaultResourceScope,",
    );
    expect(insights).toContain("getXcpNgMetricById(");
    expect(insights).toContain("chartWordsInReadersLanguage(");
  });

  test("no page computes a rate: Xen Orchestra's throughputs are per-second gauges already", () => {
    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");
      expect({ file, rate: source.includes("transformAsRate") }).toEqual({
        file,
        rate: false,
      });
    }
  });

  test("the pages use xcp-ng prefixed preference and storage keys", () => {
    expect(readSource("Pages", "XcpNg", "Pools.tsx")).toContain(
      'userPreferencesKey="xcp-ng-pools-table"',
    );
    expect(readSource("Pages", "XcpNg", "Archived.tsx")).toContain(
      'userPreferencesKey="xcp-ng-pools-archived-table"',
    );
    expect(readSource("Pages", "XcpNg", "Pools.tsx")).toContain(
      'persistKey: "xcp-ng-pools-table"',
    );
  });
});

describe("the pools list shows what each pool is", () => {
  const list: string = dense(readSource("Pages", "XcpNg", "Pools.tsx"));

  test.each([
    ["Status", "otelCollectorStatus"],
    ["Xen Orchestra", "xenOrchestraName"],
    ["Hosts", "hostCount"],
    ["VMs", "vmCount"],
    ["Storage", "storageUsedBytes"],
    ["Last Seen", "lastSeenAt"],
  ])("a %s column (%s)", (title: string, field: string) => {
    expect(list).toContain(`field:{${field}:true,},title:"${dense(title)}",`);
  });

  test("Hosts and VMs read running of total from the pool's snapshot", () => {
    expect(list).toContain(
      "running:item.runningHostCount,total:item.hostCount,",
    );
    expect(list).toContain("running:item.runningVmCount,total:item.vmCount,");
    expect(list).toContain('"{{running}}/{{total}}running"');
    expect(list).toContain("running:data.translator.formatNumber(running),");
    expect(list).toContain("total:data.translator.formatNumber(total),");
  });

  test("Storage is the shared usage bar, of the pool's storage repositories' capacity", () => {
    expect(list).toContain(
      "<StorageUsageBarusage={getStorageUsage({capacity:item.storageCapacityBytes,used:item.storageUsedBytes,})}/>",
    );
  });

  test("the archive asks for archiving rather than deleting, as every resource list", () => {
    expect(list).toContain(
      "deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}",
    );
    expect(list).toContain("actionButtons={[...archiveRowActions]}");
  });
});

describe("a pool's Settings", () => {
  const settings: string = dense(
    readSource("Pages", "XcpNg", "View", "Settings.tsx"),
  );

  test("the details card is edited in one place, the pool's UUID folded under Advanced as its match column", () => {
    expect(settings).toContain("<ResourceDetailsCard<XcpNgPool>");
    expect(settings).toContain('column:"poolIdentifier"');
    expect(settings).toContain('title:"DisplayName"');
  });

  test("where the pool is read from is shown, never edited: Xen Orchestra, its name there and the agent", () => {
    expect(settings).toContain("field:{xenOrchestraName:true,},");
    expect(settings).toContain("field:{reportedName:true,},");
    expect(settings).toContain("field:{agentVersion:true,},");
    expect(settings).toContain("<AgentVersionkind={AgentKind.XcpNgAgent}");
  });

  test("retention folds under More settings, and Archive comes last", () => {
    const retention: number = settings.indexOf(
      "<TelemetryResourceMoreSettings<XcpNgPool>",
    );
    const archive: number = settings.indexOf("<ArchiveResourceCard<XcpNgPool>");
    expect(retention).toBeGreaterThan(settings.indexOf("<ResourceDetailsCard"));
    expect(archive).toBeGreaterThan(retention);
    expect(settings).toContain('resourceName="XCP-ngpool"');
  });
});

/*
 * The pool's Topology page: the loader reads the pool's XcpNgResource rows
 * and the builder (Builders/XcpNgTopology, D2's) decides what each part
 * shows. A column the builder reads but the loader does not select arrives
 * undefined, and the map quietly draws every part as healthy - an
 * over-allocated storage repository, a VM stopped after running, an ISO
 * library taken for VM storage - with no error anywhere.
 */
describe("the pool's map reads what its builder draws", () => {
  const loaders: string = stripComments(
    readSource(
      "Components",
      "ResourceTopology",
      "Loaders",
      "InventoryTopologyLoaders.ts",
    ),
  );
  const start: number = loaders.indexOf(
    "export async function loadXcpNgTopology(",
  );
  const next: number = loaders.indexOf("export async function", start + 1);
  const loader: string = dense(
    loaders.slice(start, next === -1 ? undefined : next),
  );
  const selectStart: number = loader.indexOf("rowSelect:{");
  const rowSelect: string = loader.slice(
    selectStart,
    loader.indexOf("}", selectStart),
  );

  const builder: string = stripComments(
    readSource(
      "Components",
      "ResourceTopology",
      "Builders",
      "XcpNgTopology.ts",
    ),
  );
  const model: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "Models",
      "DatabaseModels",
      "XcpNgResource.ts",
    ),
    "utf8",
  );

  // Every column the builder reads of a row itself.
  const readByBuilder: Array<string> = Array.from(
    new Set(
      Array.from(builder.matchAll(/\brow\.([a-zA-Z]+)\b/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  ).sort();

  /*
   * And the ones Pages/XcpNg/Utils/XcpNgHealth's assessments read for it:
   * how much of a storage repository is allocated, when a VM last ran, and
   * what a storage repository holds (an ISO library is no VM's storage).
   */
  const READ_FOR_THE_BUILDER: ReadonlyArray<string> = [
    "virtualAllocationBytes",
    "lastRunningAt",
    "contentType",
  ];

  test("the loader, its select and the builder's reads are found", () => {
    expect(start).toBeGreaterThan(-1);
    expect(loader).toContain("rowType:XcpNgResource,");
    expect(loader).toContain('relation:"xcpNgPools",');
    expect(selectStart).toBeGreaterThan(-1);
    expect(readByBuilder).toEqual(
      expect.arrayContaining(["externalId", "kind", "powerState"]),
    );
  });

  test.each(
    Array.from(new Set([...readByBuilder, ...READ_FOR_THE_BUILDER])).map(
      (column: string): [string] => {
        return [column];
      },
    ),
  )("%s is selected, and is a column of XcpNgResource", (column: string) => {
    expect(rowSelect).toContain(`${column}:true,`);
    expect(model).toContain(`public ${column}?:`);
  });

  test("the master Topology knows the pool by its UUID, never its name", () => {
    expect(loader).toContain(
      "keyForXcpNgPool(loaded.projectId.toString(),poolIdentifier)",
    );
    expect(loader).toContain(
      "resourceSelect:{name:true,poolIdentifier:true,lastSeenAt:true}",
    );
  });
});
