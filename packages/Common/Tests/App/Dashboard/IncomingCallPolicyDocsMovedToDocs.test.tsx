import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import {
  Location,
  MemoryRouter,
  NavigationType,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { MOVED_INCOMING_CALL_POLICY_DOCS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * An incoming call policy had a "Documentation" page in its side menu: a
 * manual of how incoming calls are routed, drawn in the product, beside the
 * docs page that says the same - and it had drifted from it (it offered
 * teams to ring, which a rule cannot, and a "voicemail message" callers
 * never hear). The docs are the one place for it now: the policy list links
 * there (View Documentation), and the old address - in bookmarks and older
 * messages - forwards to the policy's Overview, keeping its id, outside the
 * layout so the side menu never flashes on the way.
 *
 * This mounts the REAL On-Call Duty route group, every page of it replaced
 * by a marker that names it.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

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

const POLICY_ID: string = "7b000000-0000-4000-8000-0000000000c1";

const PAGE_IMPORT: RegExp = /"\.\.\/Pages\/(OnCallDuty\/[A-Za-z/]+)"/g;

// Every page module the route group imports, read from its source.
function pageModules(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Routes", "OnCallDutyRoutes.tsx"),
    "utf8",
  );

  return Array.from(
    new Set(
      Array.from(source.matchAll(PAGE_IMPORT)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  );
}

function LocationProbe(): React.ReactElement {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="location">
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="hash">{location.hash}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
}

let layoutRenders: number = 0;

for (const module of pageModules()) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    if (module.endsWith("/Layout")) {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          layoutRenders++;
          const { Outlet } = jest.requireActual("react-router-dom") as {
            Outlet: React.ComponentType;
          };
          return (
            <div data-testid="layout" data-layout={module}>
              <LocationProbe />
              <Outlet />
            </div>
          );
        },
      };
    }

    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="page">{module}</div>;
      },
    };
  });
}

const OnCallDutyRoutes: React.FunctionComponent<Record<string, unknown>> = (
  jest.requireActual(`${DASHBOARD}/Routes/OnCallDutyRoutes`) as {
    default: React.FunctionComponent<Record<string, unknown>>;
  }
).default;

const BASE: string = `/dashboard/${PROJECT_ID}/on-call-duty`;

function visit(url: string): void {
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.ON_CALL_DUTY_ROOT]!.toString()}
          element={
            <OnCallDutyRoutes
              pageRoute={new Route(BASE)}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
        {/*
         * Where a forward that left the route group would land: a test that
         * passed only because nothing matched would see this.
         */}
        <RouterRoute
          path="*"
          element={
            <div data-testid="outside">
              <LocationProbe />
            </div>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function landedOn(): string {
  return (
    (screen.getByTestId("pathname").textContent ?? "") +
    (screen.getByTestId("search").textContent ?? "") +
    (screen.getByTestId("hash").textContent ?? "")
  );
}

beforeEach(() => {
  layoutRenders = 0;
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the incoming call policy manual gave way to the docs", () => {
  test("the old address, relative to On-Call Duty, is incoming-call-policies/:id/docs", () => {
    expect(MOVED_INCOMING_CALL_POLICY_DOCS_PATH).toBe(
      "incoming-call-policies/:id/docs",
    );
  });

  test("no page is at that address any more, and the manual is gone", () => {
    for (const route of Object.values(RouteMap)) {
      expect(route.toString()).not.toBe(
        `/dashboard/:projectId/on-call-duty/${MOVED_INCOMING_CALL_POLICY_DOCS_PATH}`,
      );
    }

    expect(Object.keys(PageMap)).not.toContain(
      "ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS",
    );
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "OnCallDuty",
          "IncomingCallPolicy",
          "Docs.tsx",
        ),
      ),
    ).toBe(false);
    expect(pageModules()).not.toContain("OnCallDuty/IncomingCallPolicy/Docs");
  });

  test("the forward is mounted outside the policy's layout", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Routes", "OnCallDutyRoutes.tsx"),
      "utf8",
    );
    const forwardAt: number = source.indexOf(
      "path={MOVED_INCOMING_CALL_POLICY_DOCS_PATH}",
    );
    const layoutAt: number = source.indexOf(
      "element={<IncomingCallPolicyViewLayout {...props} />}",
    );

    expect(forwardAt).toBeGreaterThan(-1);
    expect(layoutAt).toBeGreaterThan(-1);
    expect(forwardAt).toBeLessThan(layoutAt);
  });

  test("the scaffolding found the policy's layout and Overview", () => {
    expect(pageModules()).toEqual(
      expect.arrayContaining([
        "OnCallDuty/IncomingCallPolicy/Layout",
        "OnCallDuty/IncomingCallPolicy/Index",
      ]),
    );
  });
});

describe("the old Documentation address of a policy", () => {
  test("arrives at the policy's Overview, keeping its id", () => {
    visit(`${BASE}/incoming-call-policies/${POLICY_ID}/docs`);

    expect(screen.queryByTestId("outside")).not.toBeInTheDocument();
    expect(landedOn()).toBe(`${BASE}/incoming-call-policies/${POLICY_ID}`);
    expect(screen.getByTestId("page")).toHaveTextContent(
      "OnCallDuty/IncomingCallPolicy/Index",
    );
  });

  test("replaces the history entry, so Back does not bounce through it", () => {
    visit(`${BASE}/incoming-call-policies/${POLICY_ID}/docs`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("keeps its query string and hash", () => {
    visit(`${BASE}/incoming-call-policies/${POLICY_ID}/docs?from=email#top`);

    expect(landedOn()).toBe(
      `${BASE}/incoming-call-policies/${POLICY_ID}?from=email#top`,
    );
  });

  test("draws the policy's layout no more often than a direct visit to the Overview", () => {
    visit(`${BASE}/incoming-call-policies/${POLICY_ID}`);
    const direct: number = layoutRenders;
    cleanup();
    layoutRenders = 0;

    visit(`${BASE}/incoming-call-policies/${POLICY_ID}/docs`);

    expect(direct).toBeGreaterThan(0);
    expect(layoutRenders).toBe(direct);
  });

  test("every other page of a policy still opens as itself", () => {
    for (const [segment, module] of [
      ["", "OnCallDuty/IncomingCallPolicy/Index"],
      ["/escalation", "OnCallDuty/IncomingCallPolicy/Escalation"],
      ["/settings", "OnCallDuty/IncomingCallPolicy/Settings"],
      ["/delete", "OnCallDuty/IncomingCallPolicy/Delete"],
    ] as Array<[string, string]>) {
      visit(`${BASE}/incoming-call-policies/${POLICY_ID}${segment}`);

      expect({ segment, page: screen.getByTestId("page").textContent }).toEqual(
        { segment, page: module },
      );
      cleanup();
    }
  });
});
