import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";

/*
 * "Inoperational" is not a word most people use, and the Monitors and Home
 * menus led with it. The monitors whose status is not operational are now
 * "Not Operational" everywhere the Dashboard names them: both menus, the
 * pages' titles and the breadcrumb. The routes themselves are unchanged
 * (`/monitors/inoperational`, `/home/monitors-inoperational`) so bookmarks
 * keep working.
 *
 * The real menus are rendered against the real RouteMap. react-i18next is
 * answered from the real locale files, so the German test reads what a German
 * user sees - the old key's translation ("Nicht betriebsbereit") carried over
 * to the new English wording.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = activeLocale[key];
          if (typeof flat === "string") {
            return flat;
          }
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

/*
 * ModelAPI.count backs the badge counts; ModelListCache backs the Home menu's
 * unresolved incident/alert state lists. Stubbed inline because jest.mock is
 * hoisted above the imports.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import HomeLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import HomeSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/SideMenu";
import MonitorsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

function project(): Project {
  const value: Project = new Project();
  value._id = PROJECT_ID;
  return value;
}

async function renderMonitorsMenu(): Promise<void> {
  await renderMenu(<MonitorsSideMenu project={project()} />);
}

async function renderHomeMenu(): Promise<void> {
  await renderMenu(<HomeSideMenu project={project()} />);
}

beforeEach(() => {
  activeLocale = EN;
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("Monitors menu", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/monitors`);
  });

  test("Attention Required leads with Not Operational, linking to the same page as before", async () => {
    await renderMonitorsMenu();

    const attention: Array<MenuLink> = linksIn("Attention Required");

    expect(attention[0]).toEqual({
      title: "Not Operational",
      href: routeFor(PageMap.MONITORS_INOPERATIONAL),
    });
    // The URL did not change with the words, so bookmarks still work.
    expect(attention[0]!.href).toBe(
      `/dashboard/${PROJECT_ID}/monitors/inoperational`,
    );
  });

  test("the rest of Attention Required is untouched", async () => {
    await renderMonitorsMenu();

    expect(linksIn("Attention Required")).toEqual([
      {
        title: "Not Operational",
        href: routeFor(PageMap.MONITORS_INOPERATIONAL),
      },
      { title: "Disabled", href: routeFor(PageMap.MONITORS_DISABLED) },
      {
        title: "Probe Disconnected",
        href: routeFor(PageMap.MONITORS_PROBE_DISCONNECTED),
      },
      {
        title: "Probe Disabled",
        href: routeFor(PageMap.MONITORS_PROBE_DISABLED),
      },
    ]);
  });

  test("no entry anywhere in the menu says Inoperational", async () => {
    await renderMonitorsMenu();

    for (const title of titlesInMenu()) {
      expect(title).not.toMatch(/inoperational/i);
    }
    expect(sectionTitlesInOrder().join(" ")).not.toMatch(/inoperational/i);
  });
});

describe("Home menu", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/home`);
  });

  test("the Monitors section links Not Operational to Home's own list", async () => {
    await renderHomeMenu();

    expect(linksIn("Monitors")).toEqual([
      {
        title: "Not Operational",
        href: routeFor(PageMap.HOME_NOT_OPERATIONAL_MONITORS),
      },
    ]);
    expect(linksIn("Monitors")[0]!.href).toBe(
      `/dashboard/${PROJECT_ID}/home/monitors-inoperational`,
    );
  });

  test("no entry anywhere in the menu says Inoperational", async () => {
    await renderHomeMenu();

    for (const title of titlesInMenu()) {
      expect(title).not.toMatch(/inoperational/i);
    }
  });
});

describe("in German", () => {
  test("both menus show the translation the old wording already had", async () => {
    activeLocale = DE;
    const german: unknown = DE["Not Operational"];
    expect(typeof german).toBe("string");
    expect(german).not.toBe("Not Operational");
    // What "Inoperational" used to read as in German: the meaning did not move.
    expect(german).toBe("Nicht betriebsbereit");

    goTo(`/dashboard/${PROJECT_ID}/monitors`);
    await renderMonitorsMenu();
    expect(screen.getAllByText(german as string).length).toBeGreaterThanOrEqual(
      1,
    );
    cleanup();

    goTo(`/dashboard/${PROJECT_ID}/home`);
    await renderHomeMenu();
    expect(screen.getAllByText(german as string).length).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe("the not operational pages' titles and trail", () => {
  test("Home's list is titled Not Operational Monitors, in the heading and the breadcrumb", async () => {
    const pagePath: string = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOME_NOT_OPERATIONAL_MONITORS] as Route,
    ).toString();
    goTo(pagePath);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={[pagePath]}>
          <Routes>
            <PageRoute
              path="/dashboard/:projectId/home"
              element={
                <HomeLayout
                  currentProject={project()}
                  hasPaymentMethod={true}
                  pageRoute={RouteMap[PageMap.HOME] as Route}
                />
              }
            >
              <PageRoute
                path="monitors-inoperational"
                element={<div>List</div>}
              />
            </PageRoute>
          </Routes>
        </MemoryRouter>,
      );
    });

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });
    expect(trail).toHaveTextContent("Not Operational Monitors");
    expect(
      screen.getAllByText("Not Operational Monitors").length,
    ).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent || "").not.toMatch(/inoperational/i);
  });

  test("the Monitors product's trail ends in Not Operational", () => {
    const pattern: string = RouteUtil.getRouteString(
      PageMap.MONITORS_INOPERATIONAL,
    );
    goTo(pattern.replace(":projectId", PROJECT_ID));

    const links: Array<Link> | undefined = getMonitorBreadcrumbs(pattern);

    expect(
      links?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Monitors", "Not Operational"]);
  });

  test("no monitor breadcrumb says Inoperational", () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors`);

    const monitorRoutes: Array<string> = Object.keys(RouteMap).filter(
      (route: string): boolean => {
        return RouteUtil.getRouteString(route).includes("/monitors");
      },
    );
    expect(monitorRoutes).toContain(PageMap.MONITORS_INOPERATIONAL);

    for (const route of monitorRoutes) {
      const links: Array<Link> | undefined = getMonitorBreadcrumbs(
        RouteUtil.getRouteString(route),
      );
      for (const link of links || []) {
        expect(link.title).not.toMatch(/inoperational/i);
      }
    }
  });
});

describe("the not operational page's own list card", () => {
  test("is titled Not Operational Monitors on both pages", () => {
    for (const file of [
      "Pages/Monitor/NotOperationalMonitors.tsx",
      "Pages/Home/NotOperationalMonitors.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(__dirname, "../../../../App/FeatureSet/Dashboard/src", file),
        "utf8",
      );
      expect(source).toContain('title="Not Operational Monitors"');
      expect(source).not.toMatch(/inoperational/i);
    }
  });
});
