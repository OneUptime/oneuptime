import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The VMware product is a lazy-loaded route group mirroring the Proxmox
 * one: a product Layout (vCenter list, archived list, install guide, owner /
 * label rules) plus a per-vCenter View layout with hosts, virtual machines,
 * datastores, clusters, resource pools, telemetry and activity pages. Every
 * piece of that wiring fails silently rather than loudly:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a View page with no PageRoute is reachable from the side menu but 404s,
 *   - a locale missing the nav key falls back to the raw key string,
 *   - an install guide that embeds a stale collector config registers the
 *     vCenter under the wrong identity attribute (or not at all).
 *
 * The App suite runs in a plain Node environment with no React renderer and
 * cannot import the dashboard's route modules (they reach for browser
 * globals), so these are source-level invariants, following the same pattern
 * as InventoryProductWiring.test.ts and EmptyResourceInventoryPages.test.ts.
 * Whitespace is squashed so Prettier can reflow without making the tests
 * brittle.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

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

/** Every PageMap key the product is built from. */
const VMWARE_PAGE_KEYS: ReadonlyArray<string> = [
  "VMWARE_ROOT",
  "VMWARE_VCENTERS",
  "VMWARE_VCENTER_VIEW",
  "VMWARE_VCENTER_VIEW_HOSTS",
  "VMWARE_VCENTER_VIEW_HOST_DETAIL",
  "VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES",
  "VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL",
  "VMWARE_VCENTER_VIEW_DATASTORES",
  "VMWARE_VCENTER_VIEW_DATASTORE_DETAIL",
  "VMWARE_VCENTER_VIEW_CLUSTERS",
  "VMWARE_VCENTER_VIEW_CLUSTER_DETAIL",
  "VMWARE_VCENTER_VIEW_RESOURCE_POOLS",
  "VMWARE_VCENTER_VIEW_INSIGHTS",
  "VMWARE_VCENTER_VIEW_RECOMMENDATIONS",
  "VMWARE_VCENTER_VIEW_METRICS",
  "VMWARE_VCENTER_VIEW_LOGS",
  "VMWARE_VCENTER_VIEW_INCIDENTS",
  "VMWARE_VCENTER_VIEW_ALERTS",
  "VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE",
  "VMWARE_VCENTER_VIEW_OWNERS",
  "VMWARE_VCENTER_VIEW_FEED",
  "VMWARE_VCENTER_VIEW_AUDIT_LOGS",
  "VMWARE_VCENTER_VIEW_SETTINGS",
  "VMWARE_VCENTER_VIEW_DELETE",
  "VMWARE_VCENTER_VIEW_DOCUMENTATION",
  "VMWARE_DOCUMENTATION",
  "VMWARE_SETTINGS_OWNER_RULES",
  "VMWARE_SETTINGS_LABEL_RULES",
  "VMWARE_ARCHIVED",
];

/**
 * Keys that name a real, navigable page. VMWARE_ROOT is the lazy-route
 * mount (`/vmware/*`), and — like every other product — the Archived page
 * renders under the product Layout without a breadcrumb trail.
 */
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> = VMWARE_PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "VMWARE_ROOT";
  },
);

const BREADCRUMB_PAGE_KEYS: ReadonlyArray<string> = NAVIGABLE_PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "VMWARE_ARCHIVED";
  },
);

/**
 * Every page module under Pages/VMware/View and the PageMap key whose
 * PageRoute must render it. A file here with no entry in VMwareRoutes.tsx
 * is a page that exists on disk but can never be reached.
 */
const VIEW_PAGES: ReadonlyArray<[string, string]> = [
  ["Index.tsx", "VMWARE_VCENTER_VIEW"],
  ["Hosts.tsx", "VMWARE_VCENTER_VIEW_HOSTS"],
  ["HostDetail.tsx", "VMWARE_VCENTER_VIEW_HOST_DETAIL"],
  ["VirtualMachines.tsx", "VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES"],
  ["VirtualMachineDetail.tsx", "VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL"],
  ["Datastores.tsx", "VMWARE_VCENTER_VIEW_DATASTORES"],
  ["DatastoreDetail.tsx", "VMWARE_VCENTER_VIEW_DATASTORE_DETAIL"],
  ["Clusters.tsx", "VMWARE_VCENTER_VIEW_CLUSTERS"],
  ["ClusterDetail.tsx", "VMWARE_VCENTER_VIEW_CLUSTER_DETAIL"],
  ["ResourcePools.tsx", "VMWARE_VCENTER_VIEW_RESOURCE_POOLS"],
  ["Insights.tsx", "VMWARE_VCENTER_VIEW_INSIGHTS"],
  ["Recommendations.tsx", "VMWARE_VCENTER_VIEW_RECOMMENDATIONS"],
  ["Metrics.tsx", "VMWARE_VCENTER_VIEW_METRICS"],
  ["Logs.tsx", "VMWARE_VCENTER_VIEW_LOGS"],
  ["Incidents.tsx", "VMWARE_VCENTER_VIEW_INCIDENTS"],
  ["Alerts.tsx", "VMWARE_VCENTER_VIEW_ALERTS"],
  ["ScheduledMaintenance.tsx", "VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE"],
  ["Owners.tsx", "VMWARE_VCENTER_VIEW_OWNERS"],
  ["Feed.tsx", "VMWARE_VCENTER_VIEW_FEED"],
  ["AuditLogs.tsx", "VMWARE_VCENTER_VIEW_AUDIT_LOGS"],
  ["Settings.tsx", "VMWARE_VCENTER_VIEW_SETTINGS"],
  ["Delete.tsx", "VMWARE_VCENTER_VIEW_DELETE"],
  ["Documentation.tsx", "VMWARE_VCENTER_VIEW_DOCUMENTATION"],
];

/** Product-level pages (rendered under Pages/VMware/Layout.tsx). */
const PRODUCT_PAGES: ReadonlyArray<[Array<string>, string]> = [
  [["VCenters.tsx"], "VMWARE_VCENTERS"],
  [["Documentation.tsx"], "VMWARE_DOCUMENTATION"],
  [["Archived.tsx"], "VMWARE_ARCHIVED"],
  [["Settings", "OwnerRules.tsx"], "VMWARE_SETTINGS_OWNER_RULES"],
  [["Settings", "LabelRules.tsx"], "VMWARE_SETTINGS_LABEL_RULES"],
];

describe("PageMap declares the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");

  test.each(VMWARE_PAGE_KEYS)("%s is declared", (key: string) => {
    expect(pageMap).toContain(`${key} = "${key}"`);
  });
});

describe("RouteMap gives every page a URL", () => {
  const routeMap: string = squash(readSource("Utils", "RouteMap.ts"));

  test.each(VMWARE_PAGE_KEYS)("%s has a route", (key: string) => {
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("the product is mounted at /vmware", () => {
    expect(routeMap).toContain("/vmware/*");
  });

  test.each([
    ["VMWARE_VCENTER_VIEW_HOSTS", "hosts"],
    ["VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES", "virtual-machines"],
    ["VMWARE_VCENTER_VIEW_DATASTORES", "datastores"],
    ["VMWARE_VCENTER_VIEW_CLUSTERS", "clusters"],
    ["VMWARE_VCENTER_VIEW_RESOURCE_POOLS", "resource-pools"],
  ])(
    "%s uses the vSphere vocabulary segment %s",
    (key: string, segment: string) => {
      /*
       * The spec fixes the URL segments (hosts / virtual-machines /
       * datastores / clusters / resource-pools); a Proxmox segment copied
       * over (nodes / guests / storage) would be a silent vocabulary leak.
       */
      expect(dense(routeMap)).toContain(
        `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}\``,
      );
    },
  );

  test("detail routes carry a sub-model segment", () => {
    for (const key of [
      "VMWARE_VCENTER_VIEW_HOST_DETAIL",
      "VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL",
      "VMWARE_VCENTER_VIEW_DATASTORE_DETAIL",
      "VMWARE_VCENTER_VIEW_CLUSTER_DETAIL",
    ]) {
      expect(dense(routeMap)).toContain(
        `[PageMap.${key}]:\`\${RouteParams.ModelID}/`,
      );
      const start: number = dense(routeMap).indexOf(`[PageMap.${key}]:`);
      const declaration: string = dense(routeMap).slice(start, start + 140);
      expect(declaration).toContain("${RouteParams.SubModelID}");
    }
  });
});

describe("every route is actually mounted", () => {
  const routes: string = squash(readSource("Routes", "VMwareRoutes.tsx"));

  test.each(NAVIGABLE_PAGE_KEYS)(
    "%s is rendered by a PageRoute",
    (key: string) => {
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("the vCenter view renders the Overview by default", () => {
    // Otherwise a link to /vmware/:id lands on a blank layout.
    expect(routes).toContain(
      "<PageRoute index element={ <VMwareVCenterOverview",
    );
  });

  test("the view pages are nested under the vCenter view layout", () => {
    expect(routes).toContain("element={<VMwareVCenterViewLayout");
    expect(routes).toContain("element={<VMwareLayout");
  });

  test("detail routes register two trailing path segments", () => {
    /*
     * RouteUtil.getLastPathForKey(key, 2) yields `hosts/:subModelId`; the
     * default depth of 1 would register only `:subModelId` and shadow the
     * list route.
     */
    for (const key of [
      "VMWARE_VCENTER_VIEW_HOST_DETAIL",
      "VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL",
      "VMWARE_VCENTER_VIEW_DATASTORE_DETAIL",
      "VMWARE_VCENTER_VIEW_CLUSTER_DETAIL",
    ]) {
      expect(dense(routes)).toMatch(
        new RegExp(`RouteUtil\\.getLastPathForKey\\(PageMap\\.${key},2,?\\)`),
      );
    }
  });

  test.each(VIEW_PAGES)(
    "Pages/VMware/View/%s exists and is imported by the routes file for %s",
    (file: string, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "VMware", "View", file),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/VMware/View/${file.replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test.each(PRODUCT_PAGES)(
    "Pages/VMware/%s exists and is routed for %s",
    (segments: Array<string>, key: string) => {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, "Pages", "VMware", ...segments)),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/VMware/${segments.join("/").replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("no View page on disk is left unrouted", () => {
    /*
     * The table above is what the routes file must render; this is the
     * reverse check — a page added to the folder without a route entry
     * (and without a row in VIEW_PAGES) fails here rather than shipping
     * unreachable.
     */
    const onDisk: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, "Pages", "VMware", "View"))
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

  test("AllRoutes exports the product", () => {
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as VMwareRoutes } from "./VMwareRoutes";',
    );
  });

  test("App.tsx mounts the product router at the product root", () => {
    const app: string = squash(readSource("App.tsx"));

    expect(app).toContain("RouteMap[PageMap.VMWARE_ROOT]");
    expect(app).toContain("<VMwareRoutes {...commonPageProps} />");
    expect(dense(readSource("App.tsx"))).toContain(
      'lazy(()=>{returnimport("./Routes/VMwareRoutes");})',
    );
  });
});

describe("every navigable page has breadcrumbs", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "VMwareBreadcrumbs.ts"),
  );

  test.each(BREADCRUMB_PAGE_KEYS)(
    "%s has a breadcrumb trail",
    (key: string) => {
      expect(breadcrumbs).toContain(`PageMap.${key}`);
    },
  );

  test("the archived page has no trail, like every other product", () => {
    expect(breadcrumbs).not.toContain("PageMap.VMWARE_ARCHIVED");
  });

  test("the trails use vSphere vocabulary, not Proxmox's", () => {
    expect(breadcrumbs).toContain('"View vCenter"');
    expect(breadcrumbs).toContain('"Virtual Machines"');
    expect(breadcrumbs).toContain('"Datastores"');
    expect(breadcrumbs).not.toContain("Proxmox");
    expect(breadcrumbs).not.toContain('"Guests"');
    expect(breadcrumbs).not.toContain('"Nodes"');
  });

  test("the breadcrumb module is exported from the barrel", () => {
    /*
     * The layouts import `getVMwareBreadcrumbs` from the barrel; an
     * unexported module compiles fine everywhere except the import site.
     */
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      './VMwareBreadcrumbs"',
    );
  });

  test("both layouts read the VMware trail", () => {
    expect(readSource("Pages", "VMware", "Layout.tsx")).toContain(
      "getVMwareBreadcrumbs(path)",
    );
    expect(readSource("Pages", "VMware", "View", "Layout.tsx")).toContain(
      "getVMwareBreadcrumbs(path)",
    );
  });
});

describe("the side menus reach the whole product", () => {
  test("the product side menu links to the list, archive, docs and rules", () => {
    const sideMenu: string = squash(
      readSource("Pages", "VMware", "SideMenu.tsx"),
    );

    for (const key of [
      "VMWARE_VCENTERS",
      "VMWARE_ARCHIVED",
      "VMWARE_DOCUMENTATION",
      "VMWARE_SETTINGS_OWNER_RULES",
      "VMWARE_SETTINGS_LABEL_RULES",
    ]) {
      expect(dense(sideMenu)).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
  });

  test("the vCenter side menu links to every view page", () => {
    const sideMenu: string = squash(
      readSource("Pages", "VMware", "View", "SideMenu.tsx"),
    );

    for (const [, key] of VIEW_PAGES) {
      if (key.endsWith("_DETAIL")) {
        // Detail pages are reached from their list, not the side menu.
        continue;
      }
      expect(dense(sideMenu)).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
  });

  test("the vCenter side menu badges come from the inventory summary", () => {
    /*
     * The layout POSTs /vmware-resource/inventory-summary/:id and hands the
     * counts to the side menu; both halves must agree on the key names or
     * the badges silently render empty.
     */
    const layout: string = squash(
      readSource("Pages", "VMware", "View", "Layout.tsx"),
    );
    const sideMenu: string = squash(
      readSource("Pages", "VMware", "View", "SideMenu.tsx"),
    );

    expect(layout).toContain('"/vmware-resource/inventory-summary/"');
    for (const [summaryKey, countKey] of [
      ["hostCount", "hosts"],
      ["virtualMachineCount", "virtualMachines"],
      ["datastoreCount", "datastores"],
      ["clusterCount", "clusters"],
      ["resourcePoolCount", "resourcePools"],
    ]) {
      expect(layout).toContain(`readNum("${summaryKey}")`);
      expect(sideMenu).toContain(`badge={counts.${countKey}}`);
    }
  });

  test("the vCenter side menu scopes activity counts by the vmwareVCenters relation", () => {
    const sideMenu: string = squash(
      readSource("Pages", "VMware", "View", "SideMenu.tsx"),
    );

    expect(sideMenu).toContain("vmwareVCenters: new Includes([props.modelId])");
    expect(sideMenu).not.toContain("proxmoxClusters");
  });
});

describe("the navbar link exists and is not commented out", () => {
  const navBarRaw: string = readSource("Utils", "NavigationItems.tsx");
  const navBar: string = squash(navBarRaw);

  test("there is a live VMware entry", () => {
    expect(dense(navBarRaw)).toContain('t("navbar.items.vmwareTitle"');
    expect(dense(navBarRaw)).toContain('t("navbar.items.vmwareDescription"');
  });

  test("the entry routes to the product", () => {
    expect(navBar).toContain("RouteMap[PageMap.VMWARE_VCENTERS] as Route");
    expect(navBar).toContain("activeRoute: RouteMap[PageMap.VMWARE_VCENTERS]");
  });

  test("the entry carries the VMware icon", () => {
    const start: number = navBar.indexOf('t("navbar.items.vmwareTitle"');
    const entry: string = navBar.slice(start, start + 600);
    expect(entry).toContain("icon: IconProp.VMware");
  });

  test("the entry is not inside a block comment", () => {
    expect(squash(stripComments(navBarRaw))).toContain(
      't("navbar.items.vmwareTitle"',
    );
  });
});

describe("the navbar entry is translated everywhere", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("all 17 locale files are present", () => {
    expect(localeFiles.length).toBe(17);
  });

  test.each(localeFiles)("%s carries the VMware nav keys", (file: string) => {
    const contents: Record<string, any> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    );

    const items: Record<string, string> = contents["navbar"]?.["items"] || {};

    expect(items["vmwareTitle"]).toBe("VMware");
    expect(typeof items["vmwareDescription"]).toBe("string");
    expect(items["vmwareDescription"]!.length).toBeGreaterThan(0);
  });

  test.each(localeFiles)(
    "%s keeps the VMware keys next to the Proxmox keys",
    (file: string) => {
      /*
       * Line-parallel locale files are what makes a diff across 17
       * languages reviewable; an entry appended at the end of one file
       * would still validate but drift the files apart.
       */
      const lines: Array<string> = fs
        .readFileSync(path.join(LOCALES_DIR, file), "utf8")
        .split("\n");
      const proxmoxIndex: number = lines.findIndex((line: string): boolean => {
        return line.includes('"proxmoxDescription":');
      });
      expect(proxmoxIndex).toBeGreaterThan(-1);
      expect(lines[proxmoxIndex + 1]).toContain('"vmwareTitle": "VMware"');
      expect(lines[proxmoxIndex + 2]).toContain('"vmwareDescription":');
    },
  );

  test("non-English locales do not reuse the English description verbatim", () => {
    const english: Record<string, any> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    );
    const englishDescription: string =
      english["navbar"]["items"]["vmwareDescription"];

    for (const file of localeFiles) {
      if (file === "en.json") {
        continue;
      }
      const contents: Record<string, any> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );
      expect(contents["navbar"]["items"]["vmwareDescription"]).not.toBe(
        englishDescription,
      );
    }
  });
});

describe("the install guide embeds the real agent configuration", () => {
  const markdownSource: string = readSource(
    "Pages",
    "VMware",
    "Utils",
    "DocumentationMarkdown.ts",
  );

  test("it stamps the vmware.vcenter.name identity attribute", () => {
    /*
     * Ingest discovers the vCenter from this attribute. A guide that
     * tells users to stamp anything else (or copies proxmox.cluster.name
     * from the Proxmox guide) registers nothing.
     */
    expect(markdownSource).toContain("key: vmware.vcenter.name");
    expect(markdownSource).toContain("VMWARE_VCENTER_NAME=my-vcenter");
    expect(markdownSource).not.toContain("proxmox.cluster.name");
    expect(markdownSource).not.toContain("PROXMOX_CLUSTER_NAME");
  });

  test("it never ships a placeholder ingestion key or URL", () => {
    /*
     * The `.env` block must interpolate the viewer's OneUptime URL and the
     * ingestion key they picked in the card — a literal placeholder would
     * be copied verbatim into a real install.
     */
    expect(markdownSource).toContain("ONEUPTIME_URL=${data.oneuptimeUrl}");
    expect(markdownSource).toContain(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}",
    );
    expect(markdownSource).not.toContain("your-telemetry-ingestion-key");
    expect(markdownSource).not.toContain("<YOUR_API_KEY>");
  });

  test("it embeds the shipped collector config, not a paraphrase", () => {
    const collectorConfig: string = fs.readFileSync(
      path.join(REPO_ROOT, "VMwareAgent", "otel-collector-config.yaml"),
      "utf8",
    );
    const compose: string = fs.readFileSync(
      path.join(REPO_ROOT, "VMwareAgent", "docker-compose.yml"),
      "utf8",
    );

    /*
     * The markdown lives in a template literal, so `${env:X}` is written
     * as `\${env:X}` there — unescape before comparing with the YAML.
     */
    const unescaped: string = markdownSource.replace(/\\\$\{/g, "${");

    for (const line of [
      'endpoint: "${env:VCENTER_ENDPOINT}"',
      'username: "${env:VCENTER_USERNAME}"',
      'password: "${env:VCENTER_PASSWORD}"',
      'collection_interval: "${env:VCENTER_COLLECTION_INTERVAL}"',
      "insecure_skip_verify: ${env:VCENTER_INSECURE_SKIP_VERIFY}",
      "vcenter.host.memory.capacity:",
      'value: "${env:VMWARE_VCENTER_NAME}"',
      "send_batch_size: 8192",
      "processors: [memory_limiter, resource, batch]",
      'endpoint: "${env:ONEUPTIME_URL}/otlp"',
      'x-oneuptime-token: "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"',
    ]) {
      expect(collectorConfig).toContain(line);
      expect(unescaped).toContain(line);
    }

    const imageMatch: RegExpMatchArray | null = compose.match(/image:\s*(\S+)/);
    expect(imageMatch).not.toBeNull();
    expect(unescaped).toContain(`image: ${imageMatch![1]}`);
    expect(unescaped).toContain("container_name: oneuptime-vmware-agent");
  });

  test("the config forbids splitting a scrape across exports", () => {
    /*
     * send_batch_max_size would break inventory counts and power-state
     * inference. The comment explaining WHY it is absent mentions the key,
     * so only an actual YAML setting line counts.
     */
    expect(markdownSource).not.toMatch(/^\s*send_batch_max_size:/m);
  });

  test("it gives the real Docker Compose .env quoting rule", () => {
    /*
     * Compose v2 interpolates $VAR in unquoted and double-quoted values and
     * treats " #" as a comment; single quotes are the only literal form.
     * Advice to drop the quotes steers users away from the one fix, and
     * install.sh never "keeps" a file it rewrites.
     */
    expect(markdownSource).not.toContain("without quotes");
    expect(markdownSource).not.toContain("quotes included");
    expect(markdownSource).not.toContain("keeps your");
    expect(markdownSource).toContain("single-quote it in \\`.env\\`");
    expect(markdownSource).toContain(
      "a password containing \\`$\\`, \\`#\\`, spaces or quotes",
    );
  });

  test("the guide documents every agent environment variable", () => {
    for (const variable of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "VMWARE_VCENTER_NAME",
      "VCENTER_ENDPOINT",
      "VCENTER_USERNAME",
      "VCENTER_PASSWORD",
      "VCENTER_INSECURE_SKIP_VERIFY",
      "VCENTER_COLLECTION_INTERVAL",
    ]) {
      expect(markdownSource).toContain(`| \\\`${variable}\\\` |`);
    }
  });

  test("the documentation card renders the guide with the selected key", () => {
    const card: string = squash(
      readSource("Components", "VMware", "DocumentationCard.tsx"),
    );

    expect(card).toContain("const VMwareDocumentationCard");
    expect(card).toContain("getVMwareInstallationMarkdown({");
    expect(card).toContain("apiKey: apiKeyValue");
    expect(card).toContain("export default VMwareDocumentationCard");
  });
});

describe("no Proxmox concept leaked into the VMware pages", () => {
  const vmwareDir: string = path.join(DASHBOARD_SRC, "Pages", "VMware");

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

  const files: Array<string> = walk(vmwareDir);

  test("there are VMware page sources to scan", () => {
    expect(files.length).toBeGreaterThan(25);
  });

  test.each(
    files.map((file: string): string => {
      return path.relative(vmwareDir, file);
    }),
  )("%s carries no pve / Proxmox identifiers", (relative: string) => {
    const source: string = fs.readFileSync(
      path.join(vmwareDir, relative),
      "utf8",
    );

    for (const forbidden of [
      "ProxmoxCluster",
      "proxmoxCluster",
      "PROXMOX_",
      "pve_",
      "pve.scope",
      "proxmox.cluster.name",
      "cephCluster",
      "QEMU",
      "haState",
      "isBackedUp",
      "pveVersion",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("every page scopes telemetry on the vmware.vcenter.name resource attribute", () => {
    for (const file of [
      "Metrics.tsx",
      "Logs.tsx",
      "Insights.tsx",
      "Index.tsx",
    ]) {
      expect(readSource("Pages", "VMware", "View", file)).toContain(
        '"resource.vmware.vcenter.name"',
      );
    }
  });

  test("utilization charts apply no ratio-to-percent transform", () => {
    /*
     * vcenter.*.utilization and vcenter.vm.cpu.readiness are already
     * percentages. A `value * 100` copied from the Proxmox pages (where
     * pve_cpu_usage_ratio is 0..1) would render 4,500% CPU.
     */
    for (const file of [
      "Insights.tsx",
      "HostDetail.tsx",
      "VirtualMachineDetail.tsx",
      "ClusterDetail.tsx",
      "DatastoreDetail.tsx",
    ]) {
      expect(readSource("Pages", "VMware", "View", file)).not.toContain(
        "value * 100",
      );
    }
  });

  test("the pages use vmware- prefixed preference and storage keys", () => {
    expect(readSource("Pages", "VMware", "VCenters.tsx")).toContain(
      'userPreferencesKey="vmware-vcenters-table"',
    );
    expect(readSource("Pages", "VMware", "Archived.tsx")).toContain(
      'userPreferencesKey="vmware-archived-table"',
    );
    expect(readSource("Pages", "VMware", "View", "Index.tsx")).toContain(
      '"vmware-overview-auto-refresh-interval"',
    );
    expect(readSource("Pages", "VMware", "View", "Logs.tsx")).toContain(
      "`vmware-vcenter-logs-${modelId.toString()}`",
    );
  });
});
