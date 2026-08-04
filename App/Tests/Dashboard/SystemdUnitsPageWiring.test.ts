import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  HOST_NAME_ATTR,
  MIN_OTELCOL_CONTRIB_VERSION,
  SYSTEMD_UNIT_NAME_ATTR,
  encodeUnitNameForUrl,
} from "../../FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits";

/*
 * The Systemd Units tab is the Linux twin of the Windows Services tab: a list
 * page, a detail page, a route pair, a breadcrumb pair, and an os.type-gated
 * side-menu entry. Every one of those is hand-wired, and none of it is
 * reachable from a unit test — the App suite runs in a plain Node environment
 * with no renderer, and `App/tsconfig.json` excludes FeatureSet/Dashboard, so
 * `npm run compile` never type-checks these pages either.
 *
 * A half-finished wiring therefore fails nowhere. It reaches the user as a
 * menu entry that 404s, or a tab that says "no data" forever on a host that
 * has been reporting units all along.
 *
 * So these assert the wiring the way NetworkSitePageInvariants.test.ts pins
 * the Network pages: the routes are resolved for real, the sources are read
 * and matched. Sources are whitespace-squashed first so prettier re-wrapping a
 * line cannot turn a real regression check into a red herring, and negative
 * assertions read a comment-stripped copy so a comment explaining a removal
 * cannot fail the test that checks it is gone.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const DOCS_CONTENT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCode(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

/*
 * Common/UI/Config reads `window` the moment it loads, and RouteMap pulls it
 * in transitively via ProjectUtil, so the browser stub has to exist before
 * either of them does — hence the deferred imports. A static import would be
 * hoisted above the stub and throw. Same approach as
 * MonitorRecommendationRoutes.test.ts.
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
   * property works on every version.
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

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/RouteMap"
  );
  RouteMap = routeMapModule.default;
  RouteUtil = routeMapModule.RouteUtil;
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
  RouteParams = (
    await import("../../FeatureSet/Dashboard/src/Utils/RouteParams")
  ).default;
});

describe("Systemd Units routes", () => {
  test("both page keys resolve to a route", () => {
    expect(RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNITS]).toBeTruthy();
    expect(RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW]).toBeTruthy();
  });

  test("the routes sit at the segment depth the pages read params from", () => {
    /*
     * SystemdUnits.tsx reads Navigation.getLastParamAsObjectID(1) and
     * SystemdUnitView.tsx reads (2) plus getLastParamAsString(). Those indices
     * are counted from the end of the path, so changing the depth breaks the
     * pages silently — they would resolve some other segment as the host id.
     */
    const list: Array<string> = (
      RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNITS] as Route
    )
      .toString()
      .split("/");
    const detail: Array<string> = (
      RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW] as Route
    )
      .toString()
      .split("/");

    expect(list[list.length - 1]).toBe("systemd");
    expect(list[list.length - 2]).toBe(RouteParams.ModelID);

    expect(detail[detail.length - 1]).toBe(RouteParams.SubModelID);
    expect(detail[detail.length - 2]).toBe("systemd");
    expect(detail[detail.length - 3]).toBe(RouteParams.ModelID);
  });

  test("does not collide with the Windows Services routes", () => {
    const routes: Array<string> = [
      PageMap.HOST_VIEW_SYSTEMD_UNITS,
      PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW,
      PageMap.HOST_VIEW_SERVICES,
      PageMap.HOST_VIEW_SERVICE_VIEW,
    ].map((key: string): string => {
      return (RouteMap[key] as Route).toString();
    });

    expect(new Set(routes).size).toBe(routes.length);
  });

  test("every unit name systemd can produce survives the URL", () => {
    /*
     * Route rejects characters outside its charset by throwing from the
     * setter, so an unescaped backslash in a device unit name would blow up
     * the list page rather than render a broken link.
     */
    const names: Array<string> = [
      "nginx.service",
      "getty@tty1.service",
      "dev-disk-by\\x2duuid-1234.device",
      "a unit with spaces.service",
      "weird~tilde.service",
      "unicode-ünïtñame.service",
    ];

    for (const name of names) {
      const populated: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW] as Route,
        {
          modelId: "0123456789abcdef01234567",
          subModelId: encodeUnitNameForUrl(name),
        },
      );

      expect(populated.toString()).not.toContain(RouteParams.SubModelID);
    }
  });

  test("both routes carry a breadcrumb trail", () => {
    /*
     * getHostBreadcrumbs itself cannot be called here — it resolves each
     * crumb through Navigation.location, which only the router populates —
     * so the registration is asserted from the source instead. Without it
     * the page renders with no breadcrumbs and no way back to the host.
     */
    const source: string = readCode(
      "Utils",
      "Breadcrumbs",
      "HostBreadcrumbs.ts",
    );

    expect(source).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SYSTEMD_UNITS, [ "Project", "Hosts", "View Host", "Systemd Units", ])',
    );
    expect(source).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW, [ "Project", "Hosts", "View Host", "Systemd Units", "View Unit", ])',
    );
  });
});

describe("Systemd Units route registration", () => {
  test("both pages are imported and mounted under the host view", () => {
    const source: string = readCode("Routes", "HostRoutes.tsx");

    expect(source).toContain(
      'import HostSystemdUnits from "../Pages/Host/View/SystemdUnits";',
    );
    expect(source).toContain(
      'import HostSystemdUnitView from "../Pages/Host/View/SystemdUnitView";',
    );
    expect(source).toMatch(
      /getLastPathForKey\(\s*PageMap\.HOST_VIEW_SYSTEMD_UNITS\s*\)/,
    );
    expect(source).toMatch(
      /getLastPathForKey\(\s*PageMap\.HOST_VIEW_SYSTEMD_UNIT_VIEW,\s*2,?\s*\)/,
    );
  });

  test("the detail route is registered with two path segments", () => {
    /*
     * getLastPathForKey defaults to one segment. Registering the detail page
     * with the default yields `:subModelId` alone, which shadows the list
     * route's `systemd` segment — the list page becomes unreachable.
     */
    expect(
      RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW, 2),
    ).toBe(`systemd/${RouteParams.SubModelID}`);
    expect(RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_SYSTEMD_UNITS)).toBe(
      "systemd",
    );
  });
});

describe("Systemd Units side-menu gating", () => {
  test("the entry is gated on a lowercased os.type containing linux", () => {
    const source: string = readCode("Pages", "Host", "View", "SideMenu.tsx");

    expect(source).toContain('setIsLinuxHost(osType.includes("linux"))');
    expect(source).toContain("{isLinuxHost ? (");
    expect(source).toContain(
      "RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNITS] as Route",
    );
    expect(source).toContain('title: "Systemd Units"');
  });

  test("os.type is lowercased before matching", () => {
    // Ingest never normalizes os.type, so "Linux" is a shape that reaches us.
    const source: string = readCode("Pages", "Host", "View", "SideMenu.tsx");
    expect(source).toContain('(item?.osType || "").toLowerCase()');
  });

  test("the Windows Services entry is still gated and still present", () => {
    const source: string = readCode("Pages", "Host", "View", "SideMenu.tsx");

    expect(source).toContain('setIsWindowsHost(osType.includes("windows"))');
    expect(source).toContain("{isWindowsHost ? (");
    expect(source).toContain("RouteMap[PageMap.HOST_VIEW_SERVICES] as Route");
  });

  test("both gates share one host fetch", () => {
    /*
     * The menu item pops in after the round-trip; a second fetch would only
     * widen that gap for no benefit.
     */
    const source: string = readCode("Pages", "Host", "View", "SideMenu.tsx");
    expect(source.split("modelType: Host,").length - 1).toBe(1);
  });
});

describe("Systemd Units pages query the right thing", () => {
  const PAGES: Array<string> = ["SystemdUnits.tsx", "SystemdUnitView.tsx"];

  test("both pages filter to this host on the resource-prefixed key", () => {
    for (const page of PAGES) {
      const source: string = readCode("Pages", "Host", "View", page);
      expect(source).toContain("[HOST_NAME_ATTR]: item.hostIdentifier");
    }
  });

  test("both pages drop the state set's zero rows server-side", () => {
    /*
     * Without this the query returns eight rows per unit per scrape and the
     * fetch cap silently truncates the list mid-snapshot.
     */
    for (const page of PAGES) {
      const source: string = readCode("Pages", "Host", "View", page);
      expect(source).toContain("value: new GreaterThan<number>(0)");
    }
  });

  test("both pages ask for the systemd metric, not the Windows one", () => {
    for (const page of PAGES) {
      const source: string = readCode("Pages", "Host", "View", page);
      expect(source).toContain("name: SYSTEMD_UNIT_STATE_METRIC_NAME");
      expect(source).not.toContain("windows.service.status");
      expect(source).not.toContain("WINDOWS_SERVICE_METRIC_NAME");
    }
  });

  test("attribute keys come from the shared module, never inlined", () => {
    /*
     * Two copies of "resource.systemd.unit.name" is two places to get the
     * prefix wrong, and the wrong one matches nothing without erroring.
     */
    for (const page of PAGES) {
      const source: string = readCode("Pages", "Host", "View", page);
      expect(source).not.toContain('"resource.systemd.unit.name"');
      expect(source).not.toContain('"systemd.unit.active_state"');
      expect(source).not.toContain('"resource.host.name"');
    }
  });

  test("the detail page pins the query to one unit", () => {
    const source: string = readCode(
      "Pages",
      "Host",
      "View",
      "SystemdUnitView.tsx",
    );
    expect(source).toContain("[SYSTEMD_UNIT_NAME_ATTR]: unitName");
  });

  test("shaping is delegated to the tested module, not re-implemented", () => {
    const list: string = readCode("Pages", "Host", "View", "SystemdUnits.tsx");
    expect(list).toContain("buildSystemdUnitRows(datapoints)");

    const detail: string = readCode(
      "Pages",
      "Host",
      "View",
      "SystemdUnitView.tsx",
    );
    expect(detail).toContain("buildSystemdUnitSamples(datapoints)");
    expect(detail).toContain("detectSystemdStateTransitions(parsed)");
    expect(detail).toContain("computeSystemdAvailability(samples)");
  });
});

describe("Systemd Units pages do not collide with the Services pages", () => {
  test("the two detail views keep separate auto-refresh preferences", () => {
    const systemd: string = readSource(
      "Pages",
      "Host",
      "View",
      "SystemdUnitView.tsx",
    );
    const windows: string = readSource(
      "Pages",
      "Host",
      "View",
      "ServiceView.tsx",
    );

    expect(systemd).toContain('"host-systemd-unit-view-auto-refresh-interval"');
    expect(windows).toContain('"host-service-view-auto-refresh-interval"');
    expect(systemd).not.toContain('"host-service-view-auto-refresh-interval"');
  });

  test("the two tables keep separate ids", () => {
    expect(readSource("Pages", "Host", "View", "SystemdUnits.tsx")).toContain(
      'id="host-systemd-units-table"',
    );
    expect(readSource("Pages", "Host", "View", "Services.tsx")).toContain(
      'id="host-services-table"',
    );
  });

  test("the Windows pages still read their own datapoint attributes", () => {
    /*
     * windowsservicereceiver puts identity on the datapoint, systemdreceiver
     * on the resource. Nothing should have "unified" these onto one key.
     */
    const windows: string = readCode(
      "Pages",
      "Host",
      "Utils",
      "WindowsServices.ts",
    );
    expect(windows).toContain('SERVICE_NAME_ATTR: string = "name"');
    expect(windows).toContain(
      'SERVICE_STARTUP_MODE_ATTR: string = "startup_mode"',
    );
  });
});

describe("systemd receiver documentation", () => {
  function languageDirectories(): Array<string> {
    return fs
      .readdirSync(DOCS_CONTENT, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return (
          entry.isDirectory() &&
          fs.existsSync(
            path.join(
              DOCS_CONTENT,
              entry.name,
              "telemetry",
              "host-otel-collector.md",
            ),
          )
        );
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      });
  }

  function hostCollectorDoc(language: string): string {
    return fs.readFileSync(
      path.join(DOCS_CONTENT, language, "telemetry", "host-otel-collector.md"),
      "utf8",
    );
  }

  /*
   * The three "Complete example" sections are the configs users copy whole.
   * They are found by their fenced YAML rather than by heading text, because
   * the headings are translated and the YAML is not.
   */
  function completeExampleConfigs(doc: string): Array<string> {
    return (doc.match(/```yaml\n[\s\S]*?```/g) || []).filter(
      (block: string): boolean => {
        return (
          block.includes("x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN") &&
          block.includes("service:\n  pipelines:")
        );
      },
    );
  }

  test("the English page documents the receiver end to end", () => {
    const doc: string = hostCollectorDoc("en");

    expect(doc).toContain("systemdreceiver");
    expect(doc).toContain("systemd.unit.state");
    expect(doc).toContain("systemd.unit.active_state");
    expect(doc).toContain(MIN_OTELCOL_CONTRIB_VERSION);
    expect(doc).toContain("receivers: [hostmetrics, systemd]");
  });

  test("does not tell operators to run the collector as root", () => {
    /*
     * The receiver only makes the read-only D-Bus calls systemd already
     * allows any user — the same ones `systemctl list-units` makes — and the
     * upstream package runs the collector as the unprivileged
     * `otelcol-contrib` user. Prescribing root would be a gratuitous
     * privilege escalation for the whole collector process, and would send a
     * genuinely-empty tab (usually a missing `resourcedetection`) down a
     * dead-end fix.
     */
    const sources: Array<string> = [
      hostCollectorDoc("en"),
      fs.readFileSync(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "Host",
          "Utils",
          "DocumentationMarkdown.ts",
        ),
        "utf8",
      ),
    ];

    /*
     * The false claims, not the word "root". The corrected copy still says
     * "not root" and "Root is not required", and still tells users the
     * `process` scraper needs CAP_SYS_PTRACE or root to read other users'
     * processes — which is true and must keep passing.
     */
    const FALSE_CLAIMS: Array<RegExp> = [
      /runs as root/i,
      /(has to|must|needs to|need to) run as root/i,
      /root, which is what lets/i,
    ];

    for (const source of sources) {
      const found: Array<string> = FALSE_CLAIMS.filter(
        (pattern: RegExp): boolean => {
          return pattern.test(source);
        },
      ).map((pattern: RegExp): string => {
        return pattern.source;
      });

      expect(found).toEqual([]);
    }

    expect(hostCollectorDoc("en")).toContain("Root is not required");
    expect(hostCollectorDoc("en")).toContain(
      "the `otelcol-contrib` user, not root",
    );
  });

  test("the volume figures account for the default-on CPU metric", () => {
    /*
     * `systemd.service.cpu.time` is enabled by default and records twice per
     * unit, so the receiver costs ten datapoints per unit per scrape, not the
     * eight the state set alone implies. A budget built on eight lands 25%
     * short.
     */
    const doc: string = hostCollectorDoc("en");

    expect(doc).toContain("systemd.service.cpu.time");
    expect(doc).toContain("10 datapoints per unit per scrape");
    expect(doc).not.toContain("8 datapoints per unit per scrape");
  });

  test("every copy-whole config stamps host.name onto its resources", () => {
    /*
     * The systemd receiver attaches only `systemd.unit.name` to each unit's
     * resource. Without resourcedetection in the same pipeline there is no
     * host.name, the samples never attach to a Host, and the tab is empty
     * forever — as are the Metrics, Processes and Logs tabs.
     */
    const configs: Array<string> = completeExampleConfigs(
      hostCollectorDoc("en"),
    );

    expect(configs.length).toBeGreaterThanOrEqual(3);

    const withoutDetection: Array<number> = [];

    configs.forEach((config: string, index: number): void => {
      const pipelines: number = (config.match(/^ {6}receivers:/gm) || [])
        .length;
      const detections: number = (
        config.match(/^ {6}processors: \[resourcedetection/gm) || []
      ).length;
      if (pipelines === 0 || detections !== pipelines) {
        withoutDetection.push(index);
      }
    });

    expect(withoutDetection).toEqual([]);
  });

  test("every translation carries the same receiver setup", () => {
    /*
     * The translated copies are hand-maintained and line-parallel with the
     * English one, with no script and no CI job keeping them in step. A
     * language that misses this edit ships setup instructions for a tab its
     * readers can see but cannot fill.
     *
     * Only the untranslatable tokens are asserted — YAML, metric names and
     * version strings stay verbatim in every language.
     */
    const languages: Array<string> = languageDirectories();
    expect(languages.length).toBeGreaterThan(10);
    expect(languages).toContain("en");

    const english: string = hostCollectorDoc("en");
    const missing: Array<string> = [];

    for (const language of languages) {
      const doc: string = hostCollectorDoc(language);

      if (!doc.includes("systemd.unit.state")) {
        missing.push(`${language}: systemd.unit.state`);
      }
      if (!doc.includes(MIN_OTELCOL_CONTRIB_VERSION)) {
        missing.push(`${language}: ${MIN_OTELCOL_CONTRIB_VERSION}`);
      }
      if (!doc.includes("receivers: [hostmetrics, systemd]")) {
        missing.push(`${language}: systemd in the metrics pipeline`);
      }

      const configs: Array<string> = completeExampleConfigs(doc);
      if (configs.length !== completeExampleConfigs(english).length) {
        missing.push(`${language}: ${configs.length} copy-whole configs`);
      }
      for (const config of configs) {
        const pipelines: number = (config.match(/^ {6}receivers:/gm) || [])
          .length;
        const detections: number = (
          config.match(/^ {6}processors: \[resourcedetection/gm) || []
        ).length;
        if (pipelines === 0 || detections !== pipelines) {
          missing.push(`${language}: resourcedetection in every pipeline`);
          break;
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("no translation left a code fence unclosed", () => {
    // A stray fence swallows the rest of the page when it renders.
    const unbalanced: Array<string> = [];

    for (const language of languageDirectories()) {
      const fences: number = (hostCollectorDoc(language).match(/```/g) || [])
        .length;
      if (fences % 2 !== 0) {
        unbalanced.push(`${language}: ${fences} fences`);
      }
    }

    expect(unbalanced).toEqual([]);
  });

  test("the in-app Documentation tab explains the Linux setup", () => {
    const source: string = readSource(
      "Pages",
      "Host",
      "Utils",
      "DocumentationMarkdown.ts",
    );

    expect(source).toContain("getLinuxSystemdStepMarkdown");
    expect(source).toContain("Step 3 — Enable the Systemd Units tab");
    expect(source).toContain("receivers: [hostmetrics, systemd]");
    expect(source).toContain(MIN_OTELCOL_CONTRIB_VERSION.replace("v", ""));
  });

  test("the Linux setup is offered on every native Linux install, and only those", () => {
    /*
     * A containerised collector cannot reach the host's D-Bus socket, so
     * offering the step for Docker or Kubernetes would send users down a
     * path that cannot work.
     */
    const raw: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Pages",
        "Host",
        "Utils",
        "DocumentationMarkdown.ts",
      ),
      "utf8",
    );

    const callSites: number = (
      raw.match(/\$\{getLinuxSystemdStepMarkdown\(\)\}/g) || []
    ).length;
    expect(callSites).toBe(3);

    const withoutTheStep: Array<string> = [];

    for (const method of ["linux-deb", "linux-rpm", "linux-tarball"]) {
      const caseStart: number = raw.indexOf(`case "${method}":`);
      expect(caseStart).toBeGreaterThan(-1);
      const caseBody: string = raw.substring(
        caseStart,
        raw.indexOf('case "', caseStart + 10),
      );
      if (!caseBody.includes("getLinuxSystemdStepMarkdown")) {
        withoutTheStep.push(method);
      }
    }

    expect(withoutTheStep).toEqual([]);
  });
});

describe("the shared module is the single source of the contract", () => {
  test("the constants the pages and docs agree on are exported once", () => {
    expect(SYSTEMD_UNIT_NAME_ATTR).toBe("resource.systemd.unit.name");
    expect(HOST_NAME_ATTR).toBe("resource.host.name");
    expect(MIN_OTELCOL_CONTRIB_VERSION).toBe("v0.143.0");
  });
});
