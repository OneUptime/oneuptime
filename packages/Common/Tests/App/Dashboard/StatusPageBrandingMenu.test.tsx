import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";

// Badge counts: nothing open, nothing to count, no network.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

import StatusPageSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  renderMenu,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * A status page's Branding section: three entries, as on a dashboard's menu -
 * the one Branding page, Custom Domains, and HTML, CSS & JavaScript. It was
 * seven (Essential Branding, HTML, CSS & JavaScript, Custom Domains, Header,
 * Footer, Overview Page, Languages), and what people looked for was rarely
 * where the names said.
 *
 * The section folds by its title like every rarely used section
 * (RarelyUsedMenuSectionsCollapsed holds every menu to that); here it is
 * pinned with its entries, and opening by itself on each of its pages with
 * that page marked.
 */

const MODEL_ID: string = "0193c0de-5555-4aaa-8bbb-0000000000b7";

// A status page's address, with its id filled in.
function viewRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(MODEL_ID),
  }).toString();
}

// The section, top to bottom: what it is called, and where it goes.
const BRANDING_SECTION: Array<{ title: string; page: string }> = [
  { title: "Branding", page: PageMap.STATUS_PAGE_VIEW_BRANDING },
  { title: "Custom Domains", page: PageMap.STATUS_PAGE_VIEW_DOMAINS },
  {
    title: "HTML, CSS & JavaScript",
    page: PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS,
  },
];

async function renderMenuAt(page: string): Promise<void> {
  goTo(viewRoute(page));
  await renderMenu(<StatusPageSideMenu modelId={new ObjectID(MODEL_ID)} />);
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("a status page's Branding section", () => {
  test("is three entries: Branding, Custom Domains, and HTML, CSS & JavaScript", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW);

    expect(linksIn("Branding")).toEqual(
      BRANDING_SECTION.map(
        (entry: { title: string; page: string }): MenuLink => {
          return { title: entry.title, href: viewRoute(entry.page) };
        },
      ),
    );
  });

  test("every entry has its icon", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW);

    expect(iconCountIn("Branding")).toBe(3);
  });

  test("no entry is left for the screens it replaced", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW);

    const titles: Array<string> = titlesInMenu();

    for (const gone of [
      "Essential Branding",
      "Header",
      "Footer",
      "Overview Page",
      "Languages",
      "Navbar",
    ]) {
      expect([gone, titles.includes(gone)]).toEqual([gone, false]);
    }

    for (const gone of [
      "header-style",
      "footer-style",
      "overview-page-branding",
      "languages",
      "navbar-style",
    ]) {
      expect(
        linksIn("Branding").filter((link: MenuLink): boolean => {
          return link.href.endsWith(`/${gone}`);
        }),
      ).toEqual([]);
    }
  });

  test("is folded on the status page's overview, and opens from its title", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW);

    expect(isExpanded("Branding")).toBe(false);

    fireEvent.click(sectionToggle("Branding"));

    expect(isExpanded("Branding")).toBe(true);
  });

  test.each(BRANDING_SECTION)(
    "opens by itself on $title, with that entry marked",
    async (entry: { title: string; page: string }) => {
      await renderMenuAt(entry.page);

      expect(isExpanded("Branding")).toBe(true);
      expect(activeLinkTitles()).toEqual([entry.title]);
    },
  );

  test("stays folded on Advanced Settings, where the uptime % and downtime statuses went", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW_SETTINGS);

    expect(isExpanded("Branding")).toBe(false);
    expect(isExpanded("Advanced")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Advanced Settings"]);
  });
});
