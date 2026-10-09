import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DocsNav, { NavGroup, NavLink } from "../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../FeatureSet/Docs/Utils/I18n";

/*
 * Incidents > Integrations > Huntress is a list page and a connection page,
 * a route pair, a breadcrumb pair, a side-menu section of its own, a search
 * entry and a docs link. Every one of those is a hand edit, and none of it
 * is reachable from a unit test of the pages: a half-finished wiring fails
 * nowhere until a user clicks a menu entry that 404s, or lands on a page
 * that reads the wrong segment as the connection's id.
 *
 * So the routes are resolved for real and the sources are read and matched
 * (whitespace-squashed, so prettier re-wrapping a line cannot fail them),
 * the way SystemdUnitsPageWiring.test.ts pins the Systemd pages.
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

const DOCS_PAGE: string = "/docs/integrations/huntress";

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
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
 * in, so the browser stub has to exist first - hence the deferred imports.
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

describe("the Huntress routes", () => {
  test("sit under Incidents > Integrations, the connection's id last", () => {
    expect(
      (RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS] as Route).toString(),
    ).toBe(
      `/dashboard/${RouteParams.ProjectID}/incidents/integrations/huntress`,
    );
    expect(
      (
        RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS_VIEW] as Route
      ).toString(),
    ).toBe(
      `/dashboard/${RouteParams.ProjectID}/incidents/integrations/huntress/${RouteParams.ModelID}`,
    );
  });

  test("resolve a connection's page from its id", () => {
    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS_VIEW] as Route,
        { modelId: "6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b" },
      ).toString(),
    ).toContain(
      "/incidents/integrations/huntress/6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    );
  });

  test("are mounted, each with its page", () => {
    const source: string = readCode("Routes", "IncidentsRoutes.tsx");

    expect(source).toContain(
      'import IncidentIntegrationsHuntress from "../Pages/Incidents/Integrations/Huntress";',
    );
    expect(source).toContain(
      'import IncidentIntegrationsHuntressView from "../Pages/Incidents/Integrations/HuntressView";',
    );
    expect(source).toMatch(
      /path=\{ IncidentsRoutePath\[PageMap\.INCIDENTS_INTEGRATIONS_HUNTRESS\] \|\| "" \} element=\{ <IncidentIntegrationsHuntress /,
    );
    expect(source).toMatch(
      /path=\{ IncidentsRoutePath\[PageMap\.INCIDENTS_INTEGRATIONS_HUNTRESS_VIEW\] \|\| "" \} element=\{ <IncidentIntegrationsHuntressView /,
    );
  });

  test("the connection's page reads its id from the last segment", () => {
    expect(
      readCode("Pages", "Incidents", "Integrations", "HuntressView.tsx"),
    ).toContain("Navigation.getLastParamAsObjectID()");
  });

  test("carry a breadcrumb trail back to Incidents", () => {
    const source: string = readCode(
      "Utils",
      "Breadcrumbs",
      "IncidentBreadcrumbs.ts",
    );

    expect(source).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS, [ "Project", "Incidents", "Integrations", "Huntress", ])',
    );
    expect(source).toContain(
      'BuildBreadcrumbLinksByTitles( PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS_VIEW, ["Project", "Incidents", "Integrations", "Huntress", "View Connection"], )',
    );
  });
});

describe("the Incidents side menu", () => {
  test("has an Integrations section, folded, holding Huntress", () => {
    const source: string = readCode("Pages", "Incidents", "SideMenu.tsx");

    expect(source).toMatch(
      /\{ title: "Integrations", defaultCollapsed: true, items: \[ \{ link: \{ title: "Huntress", to: RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.INCIDENTS_INTEGRATIONS_HUNTRESS\] as Route, \), \}, icon: IconProp\.ShieldCheck, \}, \], \}/,
    );
  });
});

describe("the command palette", () => {
  test("finds Huntress under Integrations, by the words a security team uses", () => {
    const source: string = readCode(
      "Components",
      "CommandPalette",
      "PageSearchIndex.ts",
    );

    expect(source).toContain(
      '{ title: "Integrations", pages: [ { page: PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS, title: "Huntress", icon: IconProp.ShieldCheck, keywords: [ "edr", "itdr", "mdr", "security incidents", "incident reports", ], }, ], }',
    );
  });
});

describe("the docs link on the connections list", () => {
  test("points at the Huntress page of the docs", () => {
    expect(
      readCode("Pages", "Incidents", "Integrations", "Huntress.tsx"),
    ).toContain(`documentationLink={new Route("${DOCS_PAGE}")}`);
  });

  test("names a page the docs serve, in every language", () => {
    const links: Array<string> = DocsNav.flatMap((group: NavGroup) => {
      return group.links.map((link: NavLink): string => {
        return link.url;
      });
    });

    expect(links).toContain(DOCS_PAGE);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        exists: fs.existsSync(
          path.join(DOCS_CONTENT, language, "integrations", "huntress.md"),
        ),
      }).toEqual({ language, exists: true });
    }
  });
});

describe("the connection's page", () => {
  test("reads the connection again while Huntress has not reached it", () => {
    const source: string = readCode(
      "Pages",
      "Incidents",
      "Integrations",
      "HuntressView.tsx",
    );

    expect(source).toContain(
      "export const HUNTRESS_SETUP_POLL_INTERVAL_MS: number = 5000;",
    );
    expect(source).toContain(
      "getHuntressConnectionState(connection) !== HuntressConnectionState.Receiving",
    );
    expect(source).toContain("}, HUNTRESS_SETUP_POLL_INTERVAL_MS);");
    expect(source).toContain("clearInterval(interval);");
  });

  test("edits the connection with the same form it was connected with", () => {
    const source: string = readCode(
      "Pages",
      "Incidents",
      "Integrations",
      "HuntressView.tsx",
    );

    expect(source).toContain("formFields={getHuntressConnectionFormFields()}");
    expect(source).toContain('editButtonText="Edit Settings"');
  });
});
