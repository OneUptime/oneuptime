import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Security Events setup guide is the page that tells a customer how to
 * get SIEM signals into OneUptime, and everything it teaches is a copy of
 * something that lives somewhere else in the repo:
 *
 *  - the ingest path is declared in the Telemetry API router,
 *  - the auth header is read by the telemetry ingest middleware,
 *  - the `?format=` dialects are the aliases SecurityEventNormalizer
 *    accepts,
 *  - and reaching the page at all takes five hand-written wirings (PageMap
 *    key, SecurityEventsRoutePath entry, absolute RouteMap Route, a
 *    PageRoute in SecurityEventsRoutes.tsx, a nav tab, a breadcrumb).
 *
 * Every one of those fails silently. A renamed route leaves the tab
 * highlighted on the wrong page or the breadcrumb trail empty; a changed
 * ingest path or a mistyped dialect leaves the guide confidently printing
 * a curl command that 404s or an event that is normalized as generic JSON.
 * Nothing about either looks wrong on screen, which is why they are pinned
 * here rather than left to review.
 *
 * Same deferred-import + browser-stub shape as
 * App/Tests/Dashboard/SessionReplayRoutes.test.ts: Common/UI/Config reads
 * `window` at module load and RouteMap pulls it in transitively.
 * The .tsx sources are read as text rather than imported, because react is
 * a Dashboard dependency that App's own install never provides.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;
type Link = import("Common/Types/Link").default;
type SecurityEventFormat =
  import("Common/Types/SecurityEvent/SecurityEventFormat").default;
type NormalizedSecurityEvent =
  import("Common/Types/SecurityEvent/NormalizedSecurityEvent").default;
type SecurityEventNormalizerClass =
  typeof import("Common/Utils/SecurityEvent/SecurityEventNormalizer").default;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];
let getSecurityEventsBreadcrumbs: (path: string) => Array<Link> | undefined;
let SecurityEventNormalizer: SecurityEventNormalizerClass;
let parseFormat: (value: string) => SecurityEventFormat | null;
let setNavigationLocation: (pathname: string) => void;

/*
 * Read as constants rather than inline literals: eslint's wrap-regex wants
 * an inline regex parenthesised and prettier wants the parentheses gone,
 * and the two rules fight forever over the same line.
 */
const INGEST_ROUTE_PATTERN: RegExp = /router\.post\(\s*"([^"]+)"/;
const SAMPLE_PATTERN: RegExp = /format: "([^"]*)",\s*body: `([\s\S]*?)`,/g;
const DIALECT_PATTERN: RegExp = /\?format=([a-z-]+)/g;

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

const setupGuideSource: string = readDashboardSource(
  "Components",
  "SecurityEvents",
  "SecurityEventsSetupGuide.tsx",
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
const routesSource: string = readDashboardSource(
  "Routes",
  "SecurityEventsRoutes.tsx",
);
const eventsTableSource: string = readDashboardSource(
  "Components",
  "SecurityEvents",
  "SecurityEventsTable.tsx",
);
const ingestApiSource: string = fs.readFileSync(
  nodePath.join(
    __dirname,
    "../../FeatureSet/Telemetry/API/SecurityEventsIngest.ts",
  ),
  "utf8",
);
const ingestMiddlewareSource: string = fs.readFileSync(
  nodePath.join(
    __dirname,
    "../../../Common/Server/Middleware/TelemetryIngest.ts",
  ),
  "utf8",
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
  SecurityEventNormalizer = (
    await import("Common/Utils/SecurityEvent/SecurityEventNormalizer")
  ).default;
  parseFormat = SecurityEventNormalizer.parseFormat.bind(
    SecurityEventNormalizer,
  );

  /*
   * The breadcrumb resolver walks the LIVE location to build ancestor
   * links, so a trail can only be produced with a concrete URL in place.
   */
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

describe("Security events setup guide wiring", () => {
  test("the page key exists and has a route path segment", () => {
    expect(PageMap.SECURITY_EVENTS_DOCUMENTATION).toBeTruthy();
    expect(SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_DOCUMENTATION]).toBe(
      "documentation",
    );
  });

  test("the key resolves to an absolute route under security-events", () => {
    const route: Route | undefined =
      RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION];

    expect(route).toBeDefined();
    expect(route!.toString()).toBe(
      `/dashboard/${RouteParams.ProjectID}/security-events/documentation`,
    );
  });

  test("the route is registered in SecurityEventsRoutes", () => {
    expect(routesSource).toContain(
      'import SecurityEventsDocumentationPage from "../Pages/SecurityEvents/Documentation"',
    );
    expect(routesSource).toContain(
      "SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_DOCUMENTATION]",
    );
    expect(routesSource).toContain("<SecurityEventsDocumentationPage");
  });

  test("the setup guide has a nav tab pointing at the documentation route", () => {
    expect(navTabsSource).toContain('"setup"');
    expect(navTabsSource).toContain('label: "Setup Guide"');
    expect(navTabsSource).toContain(
      "RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION] as Route",
    );
  });

  /*
   * The layout highlights a tab by substring-matching the live path. A
   * renamed route segment would leave the guide open with the Events tab
   * lit, so the literal it matches has to stay a suffix of the real route.
   */
  test("the layout's active-tab match follows the real route", () => {
    const route: string =
      RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION]!.toString();

    expect(layoutSource).toContain('return "setup"');
    expect(layoutSource).toContain(
      'path.includes("/security-events/documentation")',
    );
    expect(route.endsWith("/security-events/documentation")).toBe(true);
  });

  test("the setup guide has a breadcrumb trail", () => {
    const pattern: string = RouteUtil.getRouteString(
      PageMap.SECURITY_EVENTS_DOCUMENTATION,
    );

    setNavigationLocation(pattern.replace(RouteParams.ProjectID, "proj-1"));

    const trail: Array<Link> | undefined =
      getSecurityEventsBreadcrumbs(pattern);

    expect(trail).toBeDefined();
    expect(
      trail!.map((link: Link) => {
        return link.title;
      }),
    ).toEqual(["Project", "Security Events", "Setup Guide"]);
  });

  test("the empty events table points at the setup guide", () => {
    expect(eventsTableSource).toContain(
      "RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION] as Route",
    );
  });
});

describe("Security events setup guide content", () => {
  /*
   * The path is read out of the router rather than hardcoded here: this
   * test exists to catch the guide and the endpoint drifting apart, and a
   * second hardcoded copy would only move the drift into the test.
   */
  test("the guide teaches the path the ingest router actually serves", () => {
    const ingestPath: string = INGEST_ROUTE_PATTERN.exec(ingestApiSource)![1]!;

    expect(ingestPath).toBe("/security-events/v1/ingest");
    expect(setupGuideSource).toContain(ingestPath);
  });

  test("the guide sends the token in the header ingest reads", () => {
    expect(ingestMiddlewareSource).toContain('"x-oneuptime-token"');
    expect(setupGuideSource).toContain("x-oneuptime-token");
  });

  /*
   * Every ?format= value printed in a snippet has to be one the server
   * recognizes. An unrecognized value is not rejected — parseFormat
   * returns null and ingest silently falls back to per-event sniffing —
   * so a typo here would teach a dialect that quietly does nothing.
   */
  test("every dialect the guide prints is one the normalizer accepts", () => {
    const formats: Array<string> = Array.from(
      setupGuideSource.matchAll(DIALECT_PATTERN),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(formats.length).toBeGreaterThan(0);

    for (const format of formats) {
      expect(parseFormat(format)).not.toBeNull();
    }
  });

  /*
   * The guide claims the body may be a single object, a bare array or
   * { events: [...] }. That is a promise about extractEventsFromBody in
   * SecurityEventsIngestService, so it is only safe to print while the
   * service still unwraps all three.
   */
  test("the body shapes the guide promises are the ones ingest unwraps", () => {
    const serviceSource: string = fs.readFileSync(
      nodePath.join(
        __dirname,
        "../../FeatureSet/Telemetry/Services/SecurityEventsIngestService.ts",
      ),
      "utf8",
    );

    expect(serviceSource).toContain(
      'for (const key of ["events", "entries", "logs"])',
    );
    expect(serviceSource).toContain("if (Array.isArray(body))");
    expect(setupGuideSource).toContain('"events": [');
  });

  /*
   * The samples are the whole point of the page: someone pastes one into a
   * terminal and expects a real event out the other end. Run each of them
   * through the normalizer the ingest queue actually uses, so a sample can
   * never quietly degrade into a row that says "Security event", Unknown
   * severity and no actor - which renders perfectly and teaches nothing.
   */
  test("every sample normalizes into a populated event", () => {
    const samples: Array<{ format: string; body: string }> = Array.from(
      setupGuideSource.matchAll(SAMPLE_PATTERN),
    ).map((match: RegExpMatchArray) => {
      return { format: match[1]!, body: match[2]! };
    });

    // One per dialect the guide offers.
    expect(samples.length).toBe(4);

    for (const sample of samples) {
      const declaredFormat: string =
        Array.from(sample.format.matchAll(DIALECT_PATTERN)).map(
          (match: RegExpMatchArray) => {
            return match[1]!;
          },
        )[0] || "";
      const payload: Record<string, unknown> = JSON.parse(sample.body);
      const events: Array<Record<string, unknown>> = Array.isArray(
        payload["events"],
      )
        ? (payload["events"] as Array<Record<string, unknown>>)
        : [payload];

      expect(events.length).toBeGreaterThan(0);

      for (const event of events) {
        const normalized: NormalizedSecurityEvent | null =
          SecurityEventNormalizer.normalize(
            event,
            /*
             * The generic sample deliberately carries no ?format=, so it
             * goes through detection exactly as it would on ingest.
             */
            parseFormat(declaredFormat) || undefined,
          );

        expect(normalized).not.toBeNull();
        expect(normalized!.severityName).not.toBe("Unknown");
        expect(normalized!.message).toBeTruthy();
        expect(normalized!.message).not.toBe("Security event");
        expect(normalized!.principalUser).toBeTruthy();
        expect(normalized!.observables.length).toBeGreaterThan(0);
      }
    }
  });
});
