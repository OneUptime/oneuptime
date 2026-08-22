import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The detections → monitors bridge is three pieces of wiring plus one
 * fragile contract, and every piece fails silently:
 *
 *  - the Security Events → Monitors tab takes the same five hand-written
 *    registrations as every other tab (PageMap, RoutePath, RouteMap,
 *    PageRoute, nav tab + layout match + breadcrumb), any of which can be
 *    dropped without a type error;
 *  - the Detection Rules "Create Monitor" row action deep-links into
 *    monitor create with ?detectionRuleId=, which only works while
 *    Create.tsx actually reads that param;
 *  - the Monitors page scopes its table with a base-query monitorType,
 *    which only means anything while the page really passes it;
 *  - and the un-hidden Event Class field is a one-line showIf that a
 *    refactor could quietly re-hide.
 *
 * Runtime wiring is asserted through the imported RouteMap/PageMap
 * modules; page-level invariants are pinned against source, because the
 * pages are React components and react is a Dashboard-only dependency
 * (same reasoning as SecurityEventsSetupGuide.test.ts, one file up).
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;
type Link = import("Common/Types/Link").default;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];
let getSecurityEventsBreadcrumbs: (path: string) => Array<Link> | undefined;
let setNavigationLocation: (pathname: string) => void;

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readDashboardSource(...relativeParts: Array<string>): string {
  return fs.readFileSync(
    nodePath.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const monitorsPageSource: string = readDashboardSource(
  "Pages",
  "SecurityEvents",
  "Monitors.tsx",
);
const detectionRulesSource: string = readDashboardSource(
  "Pages",
  "SecurityEvents",
  "DetectionRules.tsx",
);
const monitorCreateSource: string = readDashboardSource(
  "Pages",
  "Monitor",
  "Create.tsx",
);
const routesSource: string = readDashboardSource(
  "Routes",
  "SecurityEventsRoutes.tsx",
);
const navTabsSource: string = readDashboardSource(
  "Components",
  "SecurityEvents",
  "SecurityEventsNavTabs.tsx",
);
const layoutSource: string = readDashboardSource(
  "Pages",
  "SecurityEvents",
  "Layout.tsx",
);
const stepFormSource: string = readDashboardSource(
  "Components",
  "Form",
  "Monitor",
  "SecurityEventsMonitor",
  "SecurityEventsMonitorStepForm.tsx",
);

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

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/RouteMap"
  );

  RouteMap = routeMapModule.default;
  RouteUtil = routeMapModule.RouteUtil;
  SecurityEventsRoutePath = routeMapModule.SecurityEventsRoutePath;
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
  RouteParams = (
    await import("../../FeatureSet/Dashboard/src/Utils/RouteParams")
  ).default;
  getSecurityEventsBreadcrumbs = (
    await import(
      "../../FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs"
    )
  ).getSecurityEventsBreadcrumbs;

  const Navigation: typeof import("Common/UI/Utils/Navigation").default = (
    await import("Common/UI/Utils/Navigation")
  ).default;

  setNavigationLocation = (pathname: string): void => {
    Navigation.setLocation({
      pathname: pathname,
      search: "",
      hash: "",
      state: null,
      key: "test",
    });
  };
});

describe("Security Events monitors tab wiring", () => {
  test("the page key exists and has a route path segment", () => {
    expect(PageMap.SECURITY_EVENTS_MONITORS).toBeTruthy();
    expect(SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_MONITORS]).toBe(
      "monitors",
    );
  });

  test("the key resolves to an absolute route under security-events", () => {
    const route: Route | undefined = RouteMap[PageMap.SECURITY_EVENTS_MONITORS];

    expect(route).toBeDefined();
    expect(route!.toString()).toBe(
      `/dashboard/${RouteParams.ProjectID}/security-events/monitors`,
    );
  });

  test("the route is registered in SecurityEventsRoutes", () => {
    expect(routesSource).toContain(
      'import SecurityEventsMonitorsPage from "../Pages/SecurityEvents/Monitors"',
    );
    expect(routesSource).toContain(
      "SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_MONITORS]",
    );
    expect(routesSource).toContain("<SecurityEventsMonitorsPage");
  });

  test("the nav tab points at the monitors route", () => {
    expect(navTabsSource).toContain('"monitors"');
    expect(navTabsSource).toContain('label: "Monitors"');
    expect(navTabsSource).toContain(
      "RouteMap[PageMap.SECURITY_EVENTS_MONITORS] as Route",
    );
  });

  test("the layout's active-tab match follows the real route", () => {
    const route: string =
      RouteMap[PageMap.SECURITY_EVENTS_MONITORS]!.toString();

    expect(layoutSource).toContain('return "monitors"');
    expect(layoutSource).toContain(
      'path.includes("/security-events/monitors")',
    );
    expect(route.endsWith("/security-events/monitors")).toBe(true);
  });

  test("the monitors tab has a breadcrumb trail", () => {
    const pattern: string = RouteUtil.getRouteString(
      PageMap.SECURITY_EVENTS_MONITORS,
    );

    setNavigationLocation(pattern.replace(RouteParams.ProjectID, "proj-1"));

    const trail: Array<Link> | undefined =
      getSecurityEventsBreadcrumbs(pattern);

    expect(trail).toBeDefined();
    expect(
      trail!.map((link: Link) => {
        return link.title;
      }),
    ).toEqual(["Project", "Security Events", "Monitors"]);
  });
});

describe("Security Events monitors page", () => {
  test("scopes the table to Security Events monitors", () => {
    expect(monitorsPageSource).toContain(
      "monitorType: MonitorType.SecurityEvents",
    );
  });

  test("uses its own filter-state key so it cannot share URL state with the main monitors table", () => {
    expect(monitorsPageSource).toContain(
      'tableId: "security-events-monitors-table"',
    );
  });

  test("replaces the built-in create button with a permission-gated, type-preselecting deep link", () => {
    const source: string = stripComments(monitorsPageSource);

    expect(source).toContain("disableCreate={true}");
    expect(source).toContain("PermissionGate.gateCardButton");
    expect(source).toContain("RouteMap[PageMap.MONITOR_CREATE] as Route");
    expect(source).toContain("monitorType: MonitorType.SecurityEvents");
    /*
     * The deep link must go through the monitor create PAGE — never an
     * inline create form, which would bypass the pay-as-you-go consent
     * gate that page carries.
     */
    expect(source).not.toContain("FormType.Create");
  });

  test("keeps the reseller telemetry gate the other tabs have", () => {
    expect(monitorsPageSource).toContain("enableTelemetryFeatures === false");
    expect(monitorsPageSource).toContain("<ErrorMessage");
  });
});

describe("Detection rule → monitor deep link", () => {
  test("the rules page has a Create Monitor row action carrying the rule id", () => {
    const source: string = stripComments(detectionRulesSource);

    expect(source).toContain('title: "Create Monitor"');
    expect(source).toContain("RouteMap[PageMap.MONITOR_CREATE] as Route");
    expect(source).toContain("detectionRuleId: item._id?.toString()");
    // A row button that never calls onCompleteAction spins forever.
    expect(source).toContain("onCompleteAction()");
  });

  test("the row action is permission-gated like every other door into monitor create", () => {
    /*
     * BaseModelTable passes custom actionButtons through with no
     * permission check, so an ungated button walks a viewer into the
     * whole wizard and refuses at submit (issue #3306) — the exact flow
     * MonitorTable's own gate exists to prevent.
     */
    const source: string = stripComments(detectionRulesSource);

    expect(source).toContain("PermissionGate.check");
    expect(source).toContain("ModelAction.Create");
    expect(source).toContain("disabled: !monitorCreateGate.isAllowed");
  });

  test("the prefilled filter joins on the immutable rule id, not the name", () => {
    /*
     * Findings carry the rule's CURRENT name; a monitor's stored filter
     * is frozen. Joining on name goes silently blind on the first
     * rename — the id cannot change.
     */
    const prefillSource: string = stripComments(
      readDashboardSource("Utils", "SecurityEventsMonitorPrefill.ts"),
    );

    expect(prefillSource).toContain("DETECTION_RULE_ID_ATTRIBUTE");
    expect(prefillSource).not.toContain("DETECTION_RULE_NAME_ATTRIBUTE");
  });

  test("monitor create reads the detectionRuleId param the button sends", () => {
    const source: string = stripComments(monitorCreateSource);

    expect(source).toContain(
      'Navigation.getQueryStringByName("detectionRuleId")',
    );
    expect(source).toContain("preSeedFromDetectionRuleLink");
    expect(source).toContain("buildDetectionRuleMonitorPrefill");
  });

  test("monitor create reads the bare monitorType param the monitors tab sends", () => {
    const source: string = stripComments(monitorCreateSource);

    expect(source).toContain('Navigation.getQueryStringByName("monitorType")');
    /*
     * The param is user-typeable, so it must be validated against the
     * enum rather than trusted into initialValues.
     */
    expect(source).toContain("Object.values(MonitorType).includes");
  });

  test("the detection-rule prefill gates the form behind isLoading", () => {
    /*
     * ModelForm reads initialValues once on mount; an async prefill that
     * does not gate rendering is silently ignored.
     */
    const source: string = stripComments(monitorCreateSource);

    const branch: number = source.indexOf(
      'Navigation.getQueryStringByName("detectionRuleId")',
    );

    expect(branch).toBeGreaterThan(-1);

    const branchBlock: string = source.slice(branch, branch + 400);

    expect(branchBlock).toContain("setIsLoading(true)");
    expect(branchBlock).toContain("setIsLoading(false)");
  });
});

describe("Security Events monitor step form", () => {
  test("Event Class is a first-class field, not an advanced option", () => {
    const source: string = stripComments(stepFormSource);

    /*
     * Find the classNames field block and assert it carries no showIf.
     * The block ends at the next `field: {` — if a showIf lives between,
     * the field went back behind the advanced toggle.
     */
    const fieldStart: number = source.indexOf("classNames: true");

    expect(fieldStart).toBeGreaterThan(-1);

    const nextField: number = source.indexOf("field: {", fieldStart);
    const fieldBlock: string =
      nextField === -1
        ? source.slice(fieldStart)
        : source.slice(fieldStart, nextField);

    expect(fieldBlock).not.toContain("showIf");
  });

  test("severity, service and attribute filters stay behind the advanced toggle", () => {
    const source: string = stripComments(stepFormSource);

    for (const fieldName of [
      "severityNames: true",
      "telemetryServiceIds: true",
      "attributes: true",
    ]) {
      const fieldStart: number = source.indexOf(fieldName);

      expect(fieldStart).toBeGreaterThan(-1);

      const nextField: number = source.indexOf("field: {", fieldStart);
      const fieldBlock: string =
        nextField === -1
          ? source.slice(fieldStart)
          : source.slice(fieldStart, nextField);

      expect(fieldBlock).toContain("showAdvancedOptions");
    }
  });
});

describe("Detection rule incident form fields", () => {
  test("the incident toggle and severity dropdown exist and chain", () => {
    const source: string = stripComments(detectionRulesSource);

    expect(source).toContain("shouldCreateIncident: true");
    expect(source).toContain("incidentSeverity: true");
    expect(source).toContain("model.shouldCreateIncident === true");
    expect(source).toContain("model.shouldCreateAlert === true");
  });

  test("createInitialValues mirrors the DB defaults so showIf sees booleans", () => {
    const source: string = stripComments(detectionRulesSource);

    expect(source).toContain("shouldCreateAlert: true,");
    expect(source).toContain("shouldCreateIncident: false,");
  });
});
