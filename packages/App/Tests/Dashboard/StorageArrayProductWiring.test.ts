import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import StorageArrayResourceKind, {
  StorageArrayResourceKindUtil,
} from "Common/Types/StorageArray/StorageArrayResourceKind";

/*
 * The Storage Arrays product is a lazy-loaded route group mirroring the Ceph
 * one: a product Layout (array list, archived list, install guide, owner /
 * label rules) plus a per-array View layout with inventory, telemetry and
 * activity pages. Unlike Ceph, the inventory pages depend on the array's
 * platform: a FlashArray has volumes, hosts, pods (replication) and
 * directories, a FlashBlade file systems and buckets, and both have
 * hardware. Every piece of that wiring fails silently rather than loudly:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a View page with no PageRoute is reachable from the side menu but 404s,
 *   - a side menu item offered for the wrong platform opens an empty table,
 *   - an install guide that embeds a stale collector config registers the
 *     array under the wrong identity attribute (or not at all).
 *
 * The App suite runs in a plain Node environment with no React renderer and
 * cannot import the dashboard's route modules (they reach for browser
 * globals), so these are source-level invariants, following the same pattern
 * as VMwareProductWiring.test.ts. Whitespace is squashed so Prettier can
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
const STORAGE_ARRAY_PAGE_KEYS: ReadonlyArray<string> = [
  "STORAGE_ARRAYS_ROOT",
  "STORAGE_ARRAYS",
  "STORAGE_ARRAYS_ARCHIVED",
  "STORAGE_ARRAYS_DOCUMENTATION",
  "STORAGE_ARRAYS_SETTINGS_OWNER_RULES",
  "STORAGE_ARRAYS_SETTINGS_OWNER_RULE_VIEW",
  "STORAGE_ARRAYS_SETTINGS_LABEL_RULES",
  "STORAGE_ARRAYS_SETTINGS_LABEL_RULE_VIEW",
  "STORAGE_ARRAY_VIEW",
  "STORAGE_ARRAY_VIEW_VOLUMES",
  "STORAGE_ARRAY_VIEW_VOLUME_DETAIL",
  "STORAGE_ARRAY_VIEW_HOSTS",
  "STORAGE_ARRAY_VIEW_HOST_DETAIL",
  "STORAGE_ARRAY_VIEW_REPLICATION",
  "STORAGE_ARRAY_VIEW_HARDWARE",
  "STORAGE_ARRAY_VIEW_DIRECTORIES",
  "STORAGE_ARRAY_VIEW_FILE_SYSTEMS",
  "STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL",
  "STORAGE_ARRAY_VIEW_BUCKETS",
  "STORAGE_ARRAY_VIEW_BUCKET_DETAIL",
  "STORAGE_ARRAY_VIEW_INSIGHTS",
  "STORAGE_ARRAY_VIEW_RECOMMENDATIONS",
  "STORAGE_ARRAY_VIEW_METRICS",
  "STORAGE_ARRAY_VIEW_LOGS",
  "STORAGE_ARRAY_VIEW_INCIDENTS",
  "STORAGE_ARRAY_VIEW_ALERTS",
  "STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE",
  "STORAGE_ARRAY_VIEW_OWNERS",
  "STORAGE_ARRAY_VIEW_FEED",
  "STORAGE_ARRAY_VIEW_AUDIT_LOGS",
  "STORAGE_ARRAY_VIEW_SETTINGS",
  "STORAGE_ARRAY_VIEW_DELETE",
  "STORAGE_ARRAY_VIEW_DOCUMENTATION",
];

/**
 * Keys that name a real, navigable page. STORAGE_ARRAYS_ROOT is the
 * lazy-route mount (`/storage-arrays/*`).
 */
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> =
  STORAGE_ARRAY_PAGE_KEYS.filter((key: string): boolean => {
    return key !== "STORAGE_ARRAYS_ROOT";
  });

/**
 * Like every other product, the Archived page renders under the product
 * Layout without a breadcrumb trail.
 */
const BREADCRUMB_PAGE_KEYS: ReadonlyArray<string> = NAVIGABLE_PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "STORAGE_ARRAYS_ARCHIVED";
  },
);

/**
 * Every page module under Pages/StorageArray/View and the PageMap key whose
 * PageRoute must render it. A file here with no entry in
 * StorageArrayRoutes.tsx is a page that exists on disk but can never be
 * reached.
 */
const VIEW_PAGES: ReadonlyArray<[string, string]> = [
  ["Index.tsx", "STORAGE_ARRAY_VIEW"],
  ["Volumes.tsx", "STORAGE_ARRAY_VIEW_VOLUMES"],
  ["VolumeDetail.tsx", "STORAGE_ARRAY_VIEW_VOLUME_DETAIL"],
  ["Hosts.tsx", "STORAGE_ARRAY_VIEW_HOSTS"],
  ["HostDetail.tsx", "STORAGE_ARRAY_VIEW_HOST_DETAIL"],
  ["Replication.tsx", "STORAGE_ARRAY_VIEW_REPLICATION"],
  ["Hardware.tsx", "STORAGE_ARRAY_VIEW_HARDWARE"],
  ["Directories.tsx", "STORAGE_ARRAY_VIEW_DIRECTORIES"],
  ["FileSystems.tsx", "STORAGE_ARRAY_VIEW_FILE_SYSTEMS"],
  ["FileSystemDetail.tsx", "STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL"],
  ["Buckets.tsx", "STORAGE_ARRAY_VIEW_BUCKETS"],
  ["BucketDetail.tsx", "STORAGE_ARRAY_VIEW_BUCKET_DETAIL"],
  ["Insights.tsx", "STORAGE_ARRAY_VIEW_INSIGHTS"],
  ["Recommendations.tsx", "STORAGE_ARRAY_VIEW_RECOMMENDATIONS"],
  ["Metrics.tsx", "STORAGE_ARRAY_VIEW_METRICS"],
  ["Logs.tsx", "STORAGE_ARRAY_VIEW_LOGS"],
  ["Incidents.tsx", "STORAGE_ARRAY_VIEW_INCIDENTS"],
  ["Alerts.tsx", "STORAGE_ARRAY_VIEW_ALERTS"],
  ["ScheduledMaintenance.tsx", "STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE"],
  ["Owners.tsx", "STORAGE_ARRAY_VIEW_OWNERS"],
  ["Feed.tsx", "STORAGE_ARRAY_VIEW_FEED"],
  ["AuditLogs.tsx", "STORAGE_ARRAY_VIEW_AUDIT_LOGS"],
  ["Settings.tsx", "STORAGE_ARRAY_VIEW_SETTINGS"],
  ["Delete.tsx", "STORAGE_ARRAY_VIEW_DELETE"],
  ["Documentation.tsx", "STORAGE_ARRAY_VIEW_DOCUMENTATION"],
];

/** Product-level pages (rendered under Pages/StorageArray/Layout.tsx). */
const PRODUCT_PAGES: ReadonlyArray<[Array<string>, string]> = [
  [["StorageArrays.tsx"], "STORAGE_ARRAYS"],
  [["Documentation.tsx"], "STORAGE_ARRAYS_DOCUMENTATION"],
  [["Archived.tsx"], "STORAGE_ARRAYS_ARCHIVED"],
  [["Settings", "OwnerRules.tsx"], "STORAGE_ARRAYS_SETTINGS_OWNER_RULES"],
  [["Settings", "LabelRules.tsx"], "STORAGE_ARRAYS_SETTINGS_LABEL_RULES"],
];

/** Detail pages and the list each is reached from. */
const DETAIL_PAGES: ReadonlyArray<[string, string, string]> = [
  ["STORAGE_ARRAY_VIEW_VOLUME_DETAIL", "volumes", "Volumes.tsx"],
  ["STORAGE_ARRAY_VIEW_HOST_DETAIL", "hosts", "Hosts.tsx"],
  ["STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL", "file-systems", "FileSystems.tsx"],
  ["STORAGE_ARRAY_VIEW_BUCKET_DETAIL", "buckets", "Buckets.tsx"],
];

describe("PageMap declares the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");

  test.each(STORAGE_ARRAY_PAGE_KEYS)("%s is declared", (key: string) => {
    expect(pageMap).toContain(`${key} = "${key}"`);
  });

  test("there is no AI agent page — storage arrays have no resource AI agent", () => {
    expect(pageMap).not.toContain("STORAGE_ARRAY_VIEW_AI_AGENT");
  });

  test("the product's keys come right after Ceph's", () => {
    const cephArchived: number = pageMap.indexOf(
      'CEPH_ARCHIVED = "CEPH_ARCHIVED"',
    );
    const storageRoot: number = pageMap.indexOf(
      'STORAGE_ARRAYS_ROOT = "STORAGE_ARRAYS_ROOT"',
    );
    expect(cephArchived).toBeGreaterThan(-1);
    expect(storageRoot).toBeGreaterThan(cephArchived);
    expect(pageMap.slice(cephArchived, storageRoot)).not.toMatch(
      /[A-Z_]+ = "[A-Z_]+",\s+[A-Z_]+ = /,
    );
  });
});

describe("RouteMap gives every page a URL", () => {
  const routeMap: string = squash(readSource("Utils", "RouteMap.ts"));

  test.each(STORAGE_ARRAY_PAGE_KEYS)("%s has a route", (key: string) => {
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("the product is mounted at /storage-arrays", () => {
    expect(dense(routeMap)).toContain(
      "[PageMap.STORAGE_ARRAYS_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/storage-arrays/*`,)",
    );
    expect(dense(routeMap)).toContain(
      "[PageMap.STORAGE_ARRAYS]:newRoute(`/dashboard/${RouteParams.ProjectID}/storage-arrays`,)",
    );
  });

  test.each([
    ["STORAGE_ARRAY_VIEW_VOLUMES", "volumes"],
    ["STORAGE_ARRAY_VIEW_HOSTS", "hosts"],
    ["STORAGE_ARRAY_VIEW_REPLICATION", "replication"],
    ["STORAGE_ARRAY_VIEW_HARDWARE", "hardware"],
    ["STORAGE_ARRAY_VIEW_DIRECTORIES", "directories"],
    ["STORAGE_ARRAY_VIEW_FILE_SYSTEMS", "file-systems"],
    ["STORAGE_ARRAY_VIEW_BUCKETS", "buckets"],
    ["STORAGE_ARRAY_VIEW_INSIGHTS", "insights"],
    ["STORAGE_ARRAY_VIEW_RECOMMENDATIONS", "recommendations"],
    ["STORAGE_ARRAY_VIEW_METRICS", "metrics"],
    ["STORAGE_ARRAY_VIEW_LOGS", "logs"],
    ["STORAGE_ARRAY_VIEW_FEED", "feed"],
  ])("%s uses the URL segment %s", (key: string, segment: string) => {
    expect(dense(routeMap)).toContain(
      `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}\``,
    );
  });

  test.each(DETAIL_PAGES)(
    "%s carries a sub-model segment under %s",
    (key: string, segment: string) => {
      expect(dense(routeMap)).toContain(
        `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}/\${RouteParams.SubModelID}\``,
      );
    },
  );

  test("every view route is built from the StorageArrayRoutePath dictionary", () => {
    for (const key of NAVIGABLE_PAGE_KEYS) {
      if (key === "STORAGE_ARRAYS") {
        continue;
      }
      expect(dense(routeMap)).toContain(
        `StorageArrayRoutePath[PageMap.${key}]`,
      );
    }
  });
});

describe("every route is actually mounted", () => {
  const routes: string = squash(readSource("Routes", "StorageArrayRoutes.tsx"));

  test.each(NAVIGABLE_PAGE_KEYS)(
    "%s is rendered by a PageRoute",
    (key: string) => {
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("the array view renders the Overview by default", () => {
    // Otherwise a link to /storage-arrays/:id lands on a blank layout.
    expect(dense(routes)).toContain(
      "<PageRouteindexelement={<StorageArrayOverview",
    );
  });

  test("the view pages are nested under the array view layout", () => {
    expect(routes).toContain("element={<StorageArrayViewLayout");
    expect(routes).toContain("element={<StorageArrayLayout");
  });

  test("detail routes register two trailing path segments", () => {
    /*
     * RouteUtil.getLastPathForKey(key, 2) yields `volumes/:subModelId`; the
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
    expect(dense(routes)).toContain(
      "ruleViewModelType={StorageArrayOwnerRule}",
    );
    expect(dense(routes)).toContain(
      "ruleViewModelType={StorageArrayLabelRule}",
    );
  });

  test("both the product and the array view mount their Developer pages", () => {
    expect(dense(routes)).toContain(
      "getDeveloperDocsRoutes({modelType:StorageArray,scope:DeveloperDocsScope.List,props,mountPageKey:PageMap.STORAGE_ARRAYS_ROOT,})",
    );
    expect(dense(routes)).toContain(
      "getDeveloperDocsRoutes({modelType:StorageArray,scope:DeveloperDocsScope.View,props,})",
    );
  });

  test.each(VIEW_PAGES)(
    "Pages/StorageArray/View/%s exists and is imported by the routes file for %s",
    (file: string, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "StorageArray", "View", file),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/StorageArray/View/${file.replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test.each(PRODUCT_PAGES)(
    "Pages/StorageArray/%s exists and is routed for %s",
    (segments: Array<string>, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "StorageArray", ...segments),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/StorageArray/${segments.join("/").replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("no View page on disk is left unrouted", () => {
    const onDisk: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, "Pages", "StorageArray", "View"))
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

  test("there is no AI folder: storage arrays have no resource AI agent", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", "StorageArray", "View", "AI"),
      ),
    ).toBe(false);
  });

  test("AllRoutes exports the product", () => {
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as StorageArrayRoutes } from "./StorageArrayRoutes";',
    );
  });

  test("App.tsx mounts the product router at the product root", () => {
    const app: string = squash(readSource("App.tsx"));

    expect(app).toContain("RouteMap[PageMap.STORAGE_ARRAYS_ROOT]");
    expect(app).toContain("<StorageArrayRoutes {...commonPageProps} />");
    expect(dense(readSource("App.tsx"))).toContain(
      'lazy(()=>{returnimport("./Routes/StorageArrayRoutes");})',
    );
  });

  test("App.tsx mounts the product right after Ceph", () => {
    const app: string = readSource("App.tsx");
    const ceph: number = app.indexOf("<CephRoutes {...commonPageProps} />");
    const storage: number = app.indexOf(
      "<StorageArrayRoutes {...commonPageProps} />",
    );
    expect(ceph).toBeGreaterThan(-1);
    expect(storage).toBeGreaterThan(ceph);
    // No other product's router sits between the two.
    expect(
      app.slice(ceph + "<CephRoutes {...commonPageProps} />".length, storage),
    ).not.toContain("Routes {...commonPageProps}");
  });
});

describe("every navigable page has breadcrumbs", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "StorageArrayBreadcrumbs.ts"),
  );

  test.each(BREADCRUMB_PAGE_KEYS)(
    "%s has a breadcrumb trail",
    (key: string) => {
      expect(breadcrumbs).toContain(`PageMap.${key},`);
    },
  );

  test("the archived page has no trail, like every other product", () => {
    expect(breadcrumbs).not.toContain("PageMap.STORAGE_ARRAYS_ARCHIVED");
  });

  test("the trails use storage vocabulary, not Ceph's", () => {
    expect(breadcrumbs).toContain('"Storage Arrays"');
    expect(breadcrumbs).toContain('"View Storage Array"');
    expect(breadcrumbs).toContain('"Volumes"');
    expect(breadcrumbs).toContain('"File Systems"');
    expect(breadcrumbs).toContain('"Delete Storage Array"');
    expect(breadcrumbs).not.toContain("Ceph");
    expect(breadcrumbs).not.toContain('"View Cluster"');
    expect(breadcrumbs).not.toContain('"OSDs"');
  });

  test("the breadcrumb module is exported from the barrel", () => {
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      './StorageArrayBreadcrumbs"',
    );
  });

  test("both layouts read the storage array trail", () => {
    expect(readSource("Pages", "StorageArray", "Layout.tsx")).toContain(
      "getStorageArrayBreadcrumbs(path)",
    );
    expect(readSource("Pages", "StorageArray", "View", "Layout.tsx")).toContain(
      "getStorageArrayBreadcrumbs(path)",
    );
  });
});

describe("the side menus reach the whole product", () => {
  const productSideMenu: string = readSource(
    "Pages",
    "StorageArray",
    "SideMenu.tsx",
  );
  const viewSideMenu: string = readSource(
    "Pages",
    "StorageArray",
    "View",
    "SideMenu.tsx",
  );

  test("the product side menu links to the list, archive, docs and rules", () => {
    for (const key of [
      "STORAGE_ARRAYS",
      "STORAGE_ARRAYS_ARCHIVED",
      "STORAGE_ARRAYS_DOCUMENTATION",
      "STORAGE_ARRAYS_SETTINGS_OWNER_RULES",
      "STORAGE_ARRAYS_SETTINGS_LABEL_RULES",
    ]) {
      expect(dense(productSideMenu)).toContain(
        `RouteMap[PageMap.${key}]asRoute`,
      );
    }
    // The search index files the list under this exact title.
    expect(productSideMenu).toContain('title: "All Storage Arrays"');
  });

  test("the array side menu links to every view page", () => {
    for (const [, key] of VIEW_PAGES) {
      if (key.endsWith("_DETAIL")) {
        // Detail pages are reached from their list, not the side menu.
        continue;
      }
      const linked: boolean =
        dense(viewSideMenu).includes(`RouteMap[PageMap.${key}]asRoute`) ||
        dense(viewSideMenu).includes(`pageKey:PageMap.${key},`);
      expect({ key, linked }).toEqual({ key, linked: true });
    }
  });

  test("the inventory items are tied to the resource kind each lists", () => {
    for (const [kind, key, countKey] of [
      ["Volume", "STORAGE_ARRAY_VIEW_VOLUMES", "volumes"],
      ["Host", "STORAGE_ARRAY_VIEW_HOSTS", "hosts"],
      ["Pod", "STORAGE_ARRAY_VIEW_REPLICATION", "pods"],
      ["Directory", "STORAGE_ARRAY_VIEW_DIRECTORIES", "directories"],
      ["FileSystem", "STORAGE_ARRAY_VIEW_FILE_SYSTEMS", "fileSystems"],
      ["Bucket", "STORAGE_ARRAY_VIEW_BUCKETS", "buckets"],
      ["Hardware", "STORAGE_ARRAY_VIEW_HARDWARE", "hardware"],
    ] as Array<[string, string, string]>) {
      expect(dense(viewSideMenu)).toMatch(
        new RegExp(
          `kind:StorageArrayResourceKind\\.${kind},pageKey:PageMap\\.${key},title:"[^"]+",icon:IconProp\\.\\w+,countKey:"${countKey}",`,
        ),
      );
    }
  });

  test("the inventory items are filtered by the kinds the array's platform reports", () => {
    expect(dense(viewSideMenu)).toContain(
      "StorageArrayResourceKindUtil.getKindsForSystem(storageSystem)",
    );
    expect(dense(viewSideMenu)).toContain("returnkinds.includes(item.kind);");
    expect(dense(viewSideMenu)).toContain(
      "getInventoryMenuItems(props.storageSystem,)",
    );
  });

  test("a FlashArray gets volumes, hosts, replication, directories and hardware — never file systems or buckets", () => {
    const kinds: Array<StorageArrayResourceKind> =
      StorageArrayResourceKindUtil.getKindsForSystem(
        StorageSystem.PureStorageFlashArray,
      );
    for (const kind of [
      StorageArrayResourceKind.Volume,
      StorageArrayResourceKind.Host,
      StorageArrayResourceKind.Pod,
      StorageArrayResourceKind.Directory,
      StorageArrayResourceKind.Hardware,
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(kinds).not.toContain(StorageArrayResourceKind.FileSystem);
    expect(kinds).not.toContain(StorageArrayResourceKind.Bucket);
  });

  test("a FlashBlade gets file systems, buckets and hardware — never the FlashArray pages", () => {
    const kinds: Array<StorageArrayResourceKind> =
      StorageArrayResourceKindUtil.getKindsForSystem(
        StorageSystem.PureStorageFlashBlade,
      );
    for (const kind of [
      StorageArrayResourceKind.FileSystem,
      StorageArrayResourceKind.Bucket,
      StorageArrayResourceKind.Hardware,
    ]) {
      expect(kinds).toContain(kind);
    }
    for (const kind of [
      StorageArrayResourceKind.Volume,
      StorageArrayResourceKind.Host,
      StorageArrayResourceKind.Pod,
      StorageArrayResourceKind.Directory,
    ]) {
      expect(kinds).not.toContain(kind);
    }
  });

  test("an array whose platform is unknown gets no inventory pages at all", () => {
    expect(StorageArrayResourceKindUtil.getKindsForSystem("")).toEqual([]);
    expect(StorageArrayResourceKindUtil.getKindsForSystem(undefined)).toEqual(
      [],
    );
    expect(
      StorageArrayResourceKindUtil.getKindsForSystem("netapp.ontap"),
    ).toEqual([]);
    // The menu renders the Storage section only when it has items.
    expect(dense(viewSideMenu)).toContain(
      'inventoryItems.length>0?(<SideMenuSectiontitle="Storage">{inventoryItems}</SideMenuSection>)',
    );
  });

  test("the layout reads the platform from the array and hands it to the menu", () => {
    const layout: string = dense(
      readSource("Pages", "StorageArray", "View", "Layout.tsx"),
    );
    expect(layout).toContain("select:{storageSystem:true,}");
    expect(layout).toContain("storageSystem={storageSystem}");
  });

  test("the side menu badges come from the inventory summary", () => {
    /*
     * The layout POSTs /storage-array-resource/inventory-summary/:id and
     * hands the counts to the side menu; both halves must agree on the key
     * names or the badges silently render empty.
     */
    const layout: string = squash(
      readSource("Pages", "StorageArray", "View", "Layout.tsx"),
    );

    expect(layout).toContain('"/storage-array-resource/inventory-summary/"');
    for (const [summaryKey, countKey] of [
      ["volumeCount", "volumes"],
      ["hostCount", "hosts"],
      ["podCount", "pods"],
      ["directoryCount", "directories"],
      ["fileSystemCount", "fileSystems"],
      ["bucketCount", "buckets"],
      ["unhealthyHardwareCount", "unhealthyHardware"],
    ]) {
      expect(dense(layout)).toContain(`${countKey}:readNum("${summaryKey}")`);
    }
    // Hardware counts every hardware kind the Hardware page lists.
    for (const summaryKey of [
      "hardwareCount",
      "driveCount",
      "controllerCount",
      "networkInterfaceCount",
    ]) {
      expect(layout).toContain(`readNum("${summaryKey}")`);
    }
    expect(dense(viewSideMenu)).toContain("counts[item.countKey]");
  });

  test("the inventory summary fields the layout reads are the ones the API sends", () => {
    const api: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Server",
        "API",
        "StorageArrayResourceAPI.ts",
      ),
      "utf8",
    );
    for (const summaryKey of [
      "volumeCount",
      "hostCount",
      "podCount",
      "directoryCount",
      "fileSystemCount",
      "bucketCount",
      "hardwareCount",
      "driveCount",
      "controllerCount",
      "networkInterfaceCount",
      "unhealthyHardwareCount",
    ]) {
      expect(api).toContain(`${summaryKey}:`);
    }
    expect(api).toContain("/inventory-summary/:storageArrayId");
  });

  test("the array side menu scopes activity counts by the storageArrays relation", () => {
    const sideMenu: string = squash(viewSideMenu);

    expect(sideMenu).toContain("storageArrays: new Includes([props.modelId])");
    expect(sideMenu.split("storageArrays: new Includes").length - 1).toBe(3);
    expect(sideMenu).not.toContain("cephClusters");
  });

  test("the array side menu has no AI section", () => {
    expect(viewSideMenu).not.toContain('title="AI"');
    expect(viewSideMenu).not.toContain("AI_AGENT");
    expect(viewSideMenu).not.toContain("AI_INSIGHTS");
  });

  test("recommendations are the storage array's own", () => {
    expect(dense(viewSideMenu)).toContain(
      "resourceType={MonitorRecommendationResourceType.StorageArray}",
    );
    expect(
      dense(readSource("Pages", "StorageArray", "View", "Recommendations.tsx")),
    ).toContain(
      "resourceType={MonitorRecommendationResourceType.StorageArray}",
    );
  });
});

describe("the record tabs carry the storage array into what they create", () => {
  test.each([
    ["Incidents.tsx", "IncidentsTable"],
    ["Alerts.tsx", "AlertsTable"],
    ["ScheduledMaintenance.tsx", "ScheduledMaintenancesTable"],
  ])("%s scopes %s by the array and creates from it", (file: string) => {
    const source: string = dense(
      readSource("Pages", "StorageArray", "View", file),
    );
    expect(source).toContain("query.storageArrays=newIncludes([modelId]);");
    expect(source).toContain(
      "createFrom={{kind:CreateFromRecordKind.StorageArray,id:modelId}}",
    );
  });
});

describe("the navbar link exists and is not commented out", () => {
  const navBarRaw: string = readSource("Utils", "NavigationItems.tsx");
  const navBar: string = squash(navBarRaw);

  test("there is a live Storage Arrays entry", () => {
    expect(dense(navBarRaw)).toContain(
      't("navbar.items.storageArraysTitle","StorageArrays")',
    );
    expect(dense(navBarRaw)).toContain(
      't("navbar.items.storageArraysDescription",',
    );
  });

  test("the entry routes to the product", () => {
    expect(navBar).toContain("RouteMap[PageMap.STORAGE_ARRAYS] as Route");
    expect(navBar).toContain("activeRoute: RouteMap[PageMap.STORAGE_ARRAYS]");
  });

  test("the entry carries the StorageArray icon and sits with infrastructure", () => {
    const start: number = navBar.indexOf('t("navbar.items.storageArraysTitle"');
    const entry: string = navBar.slice(start, start + 900);
    expect(entry).toContain("icon: IconProp.StorageArray");
    expect(entry).toContain("category: infrastructureCategory");
  });

  test("the entry comes right after Ceph's", () => {
    const ceph: number = navBar.indexOf('t("navbar.items.cephTitle"');
    const storage: number = navBar.indexOf(
      't("navbar.items.storageArraysTitle"',
    );
    expect(ceph).toBeGreaterThan(-1);
    expect(storage).toBeGreaterThan(ceph);
    // No other product's entry sits between the two.
    expect(navBar.slice(ceph, storage)).not.toMatch(
      /t\("navbar\.items\.(?!ceph)\w+Title"/,
    );
  });

  test("the entry is found by the words storage admins search for", () => {
    const start: number = navBar.indexOf('t("navbar.items.storageArraysTitle"');
    const entry: string = navBar.slice(start, start + 900);
    for (const keyword of ["pure storage", "flasharray", "flashblade"]) {
      expect(entry).toContain(`"${keyword}"`);
    }
  });

  test("the entry is not inside a block comment", () => {
    expect(squash(stripComments(navBarRaw))).toContain(
      't("navbar.items.storageArraysTitle"',
    );
  });
});

describe("the install guide is wired to the shipped agent", () => {
  const markdownSource: string = readSource(
    "Pages",
    "StorageArray",
    "Utils",
    "DocumentationMarkdown.ts",
  );

  test("it never ships a placeholder ingestion key or URL in the .env file", () => {
    expect(markdownSource).toContain("`ONEUPTIME_URL=${data.oneuptimeUrl}`");
    expect(markdownSource).toContain(
      "`ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}`",
    );
    expect(markdownSource).not.toContain("your-telemetry-ingestion-key");
  });

  test("the config forbids splitting a scrape across exports", () => {
    /*
     * The comment explaining WHY it is absent mentions the key, so only an
     * actual YAML setting line counts.
     */
    expect(markdownSource).not.toMatch(/^\s*send_batch_max_size:/m);
  });

  test("the guide documents every agent environment variable", () => {
    for (const variable of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "STORAGE_ARRAY_NAME",
      "STORAGE_SYSTEM",
      "STORAGE_ARRAY_COLLECTOR_CONFIG",
      "COMPOSE_PROFILES",
      "PURE_FA_ENDPOINT",
      "PURE_FA_API_TOKEN",
      "PURE_FB_ENDPOINT",
      "PURE_FB_API_TOKEN",
      "STORAGE_ARRAY_INSECURE_SKIP_VERIFY",
    ]) {
      expect(markdownSource).toContain(`| \\\`${variable}\\\` |`);
    }
  });

  test("the documentation card renders the guide with the selected key and platform", () => {
    const card: string = squash(
      readSource("Components", "StorageArray", "DocumentationCard.tsx"),
    );

    expect(card).toContain("const StorageArrayDocumentationCard");
    expect(card).toContain("<SetupGuideCard");
    expect(card).toContain("getStorageArraySetupGuide({");
    expect(card).toContain("apiKey: context.apiKey");
    expect(card).toContain("hasApiKey: context.hasApiKey");
    expect(card).toContain(
      "platform: resolveStorageArrayPlatform(context.option)",
    );
    expect(card).toContain(
      "initialOption={getStorageArrayPlatformForSystem(props.storageSystem)}",
    );
    expect(card).toContain("icon={IconProp.StorageArray}");
    expect(card).toContain("export default StorageArrayDocumentationCard");
  });

  test("an array's own Documentation tab opens the guide on its name and platform", () => {
    const page: string = dense(
      readSource("Pages", "StorageArray", "View", "Documentation.tsx"),
    );
    expect(page).toContain('arrayName={storageArray.name||""}');
    expect(page).toContain("storageSystem={storageArray.storageSystem}");
    expect(page).toContain("select:{name:true,storageSystem:true,}");
  });

  test("the list page shows the guide only while the project has no array", () => {
    const list: string = squash(
      readSource("Pages", "StorageArray", "StorageArrays.tsx"),
    );
    expect(list).toContain("{arrayCount === 0 && (");
    expect(list.indexOf("<StorageArrayDocumentationCard")).toBeGreaterThan(
      list.indexOf("{arrayCount === 0 && ("),
    );
    expect(list).toContain("isCreateable={true}");
    expect(list).toContain("return (currentCount || 0) + 1;");
  });
});

describe("no Ceph or VMware concept leaked into the storage array pages", () => {
  const productDir: string = path.join(DASHBOARD_SRC, "Pages", "StorageArray");
  const componentDir: string = path.join(
    DASHBOARD_SRC,
    "Components",
    "StorageArray",
  );

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

  test("there are storage array page sources to scan", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  test.each(
    files.map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file);
    }),
  )(
    "%s carries no Ceph, VMware or AI agent identifiers",
    (relative: string) => {
      const source: string = stripComments(
        fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8"),
      );

      for (const forbidden of [
        "CephCluster",
        "cephCluster",
        "CEPH_",
        "ceph_",
        "ceph.cluster.name",
        "VMwareVCenter",
        "vmware.vcenter.name",
        "ResourceAiAgent",
        "AiResourceType",
        "osdCount",
      ]) {
        expect({
          relative,
          forbidden,
          found: source.includes(forbidden),
        }).toEqual({ relative, forbidden, found: false });
      }
    },
  );

  test("telemetry is scoped on the storage.array.name resource attribute", () => {
    for (const file of ["Metrics.tsx", "Logs.tsx"]) {
      expect(readSource("Pages", "StorageArray", "View", file)).toContain(
        '"resource.storage.array.name"',
      );
    }
    expect(
      readSource(
        "Pages",
        "StorageArray",
        "Utils",
        "StorageArrayResourceUtils.ts",
      ),
    ).toContain(
      'export const STORAGE_ARRAY_ATTRIBUTE: string = "resource.storage.array.name";',
    );
    // Every chart the pages build goes through the catalog query builder.
    expect(
      dense(
        readSource(
          "Pages",
          "StorageArray",
          "Utils",
          "StorageArrayResourceUtils.ts",
        ),
      ),
    ).toContain("[STORAGE_ARRAY_ATTRIBUTE]:data.arrayName,");
    for (const file of ["Index.tsx", "Insights.tsx"]) {
      expect(readSource("Pages", "StorageArray", "View", file)).toContain(
        "buildCatalogQueries(",
      );
    }
  });

  test("the logs and metrics pages scope by the array's entity key", () => {
    for (const file of ["Metrics.tsx", "Logs.tsx"]) {
      const source: string = dense(
        readSource("Pages", "StorageArray", "View", file),
      );
      expect(source).toContain("keyForStorageArray(");
      expect(source).toContain('attributeKey:"resource.storage.array.name"');
    }
  });

  test("no page computes a rate: Pure's values are per-second gauges already", () => {
    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");
      expect({ file, rate: source.includes("transformAsRate") }).toEqual({
        file,
        rate: false,
      });
    }
  });

  test("the pages use storage-array prefixed preference and storage keys", () => {
    expect(readSource("Pages", "StorageArray", "StorageArrays.tsx")).toContain(
      'userPreferencesKey="storage-arrays-table"',
    );
    expect(readSource("Pages", "StorageArray", "Archived.tsx")).toContain(
      'userPreferencesKey="storage-arrays-archived-table"',
    );
    expect(readSource("Pages", "StorageArray", "View", "Index.tsx")).toContain(
      '"storage-array-overview-auto-refresh-interval"',
    );
    expect(readSource("Pages", "StorageArray", "View", "Logs.tsx")).toContain(
      "`storage-array-logs-${modelId.toString()}`",
    );
  });
});

describe("detail pages travel by the object's encoded name", () => {
  test.each(DETAIL_PAGES)(
    "%s is linked from %s with the percent-encoded externalId",
    (key: string, _segment: string, listFile: string) => {
      const list: string = dense(
        readSource("Pages", "StorageArray", "View", listFile),
      );
      expect(list).toContain(`RouteMap[PageMap.${key}]asRoute`);
      expect(list).toContain(
        'subModelId:StorageArrayResourceUtils.routeParamFromExternalId(item.externalId||"",)',
      );
    },
  );

  test("the detail component decodes the param before looking the row up", () => {
    const detail: string = dense(
      readSource(
        "Components",
        "StorageArray",
        "StorageArrayResourceDetail.tsx",
      ),
    );
    expect(detail).toContain(
      "StorageArrayResourceUtils.externalIdFromRouteParam(Navigation.getLastParamAsString(),)",
    );
    expect(detail).toContain("Navigation.getLastParamAsObjectID(2)");
  });
});
