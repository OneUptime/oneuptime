// UX rule: Docs/ux/README.md#side-menus
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";

/*
 * What the dashboard says about itself: public, private, or unread.
 * `undefined` reads as "not found", and a thrown error as a failed read.
 */
let dashboardRead: { isPublicDashboard?: boolean } | null | Error = null;

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
      getItem: (): Promise<unknown> => {
        if (dashboardRead instanceof Error) {
          return Promise.reject(dashboardRead);
        }

        return Promise.resolve(dashboardRead);
      },
    },
  };
});

import DashboardPublicOnlySettings from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardPublicOnlySettings";
import DashboardPublicOnlyCopy, {
  DASHBOARD_PRIVATE_NOTICE_TEST_ID,
  DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID,
  DashboardPublicOnlyPage,
  isDashboardPrivateNoticeShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardPublicOnlyCopy";
import DashboardSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * A DASHBOARD'S PUBLIC-ONLY SETTINGS SAY WHAT THEY ARE FOR (#9134).
 *
 * Branding (the public page's title, description, logos, theme and favicon)
 * and Custom Domains change only a dashboard's public link. They sat in an
 * open "Branding" section on every dashboard, private ones included, where
 * they did nothing and said nothing. Now:
 *
 *   - the menu groups them under "Public Link", folded, opening by itself
 *     on either page;
 *   - while the dashboard is not shared publicly, each page opens on one
 *     notice that says so, with Change sharing, and folds its settings under
 *     it; on a public dashboard, or before the dashboard is read, the
 *     settings are drawn as they are.
 */

const MODEL_ID: string = "0193c0de-6666-4aaa-8bbb-0000000000e5";
const DASHBOARD_ID: ObjectID = new ObjectID(MODEL_ID);

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function viewRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: DASHBOARD_ID,
  }).toString();
}

async function renderSettings(page: DashboardPublicOnlyPage): Promise<void> {
  await act(async () => {
    render(
      <DashboardPublicOnlySettings dashboardId={DASHBOARD_ID} page={page}>
        <div data-testid="the-settings">Logo</div>
      </DashboardPublicOnlySettings>,
    );
  });
}

beforeEach(() => {
  dashboardRead = null;
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the notice", () => {
  test("shows only once the dashboard is read as private", () => {
    expect(isDashboardPrivateNoticeShown(false)).toBe(true);
    expect(isDashboardPrivateNoticeShown(true)).toBe(false);
    expect(isDashboardPrivateNoticeShown(undefined)).toBe(false);
  });

  test("on a private dashboard, says the settings do nothing yet and folds them", async () => {
    dashboardRead = { isPublicDashboard: false };
    await renderSettings(DashboardPublicOnlyPage.Branding);

    expect(
      screen.getByTestId(DASHBOARD_PRIVATE_NOTICE_TEST_ID),
    ).toHaveTextContent(DashboardPublicOnlyCopy.privateNotice);
    expect(
      screen.getByTestId(DASHBOARD_PRIVATE_NOTICE_TEST_ID),
    ).toHaveTextContent(DashboardPublicOnlyCopy.privateNoticeAction);
    expect(
      screen.getByTestId(DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID),
    ).toHaveTextContent(DashboardPublicOnlyCopy.foldTitle);
    expect(
      screen.getByTestId(DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID),
    ).toHaveTextContent(
      DashboardPublicOnlyCopy.foldSummary[DashboardPublicOnlyPage.Branding],
    );
  });

  test("Change sharing opens the dashboard's Sharing page", async () => {
    dashboardRead = { isPublicDashboard: false };
    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {
      return undefined;
    });

    await renderSettings(DashboardPublicOnlyPage.CustomDomains);

    fireEvent.click(screen.getByTestId(DASHBOARD_PRIVATE_NOTICE_TEST_ID));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      viewRoute(PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS),
    );
  });

  test.each([
    ["public", { isPublicDashboard: true }],
    ["not found", null],
    ["unreadable", new Error("offline")],
  ])(
    "on a %s dashboard, draws the settings as they are",
    async (_label: string, read: typeof dashboardRead) => {
      dashboardRead = read;
      await renderSettings(DashboardPublicOnlyPage.Branding);

      expect(screen.getByTestId("the-settings")).toBeVisible();
      expect(
        screen.queryByTestId(DASHBOARD_PRIVATE_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("each page draws its settings inside it, with its own words", () => {
    for (const [file, page] of [
      ["Branding.tsx", "DashboardPublicOnlyPage.Branding"],
      ["CustomDomains.tsx", "DashboardPublicOnlyPage.CustomDomains"],
    ]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Pages", "Dashboards", "View", file!),
        "utf8",
      );

      expect(source).toContain("<DashboardPublicOnlySettings");
      expect(source).toContain(`page={${page}}`);
    }
  });

  test("every Dashboard locale words it", () => {
    const words: Array<string> = [
      DashboardPublicOnlyCopy.privateNotice,
      DashboardPublicOnlyCopy.privateNoticeAction,
      DashboardPublicOnlyCopy.foldTitle,
      DashboardPublicOnlyCopy.foldDescription,
      ...Object.values(DashboardPublicOnlyCopy.foldSummary),
      "Public Link",
    ];
    const localesDir: string = path.join(DASHBOARD_SRC, "Locales");

    for (const file of fs.readdirSync(localesDir)) {
      if (!file.endsWith(".json") || file === "en.json") {
        continue;
      }

      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ) as Record<string, string>;

      for (const word of words) {
        // Present, and in the language's own words rather than English.
        expect(`${file}: ${locale[word]}`).not.toBe(`${file}: ${word}`);
        expect(locale[word]).toBeTruthy();
      }
    }
  });
});

describe("the dashboard's side menu", () => {
  async function renderMenuAt(page: string): Promise<void> {
    goTo(viewRoute(page));
    await renderMenu(<DashboardSideMenu modelId={DASHBOARD_ID} />);
  }

  test("groups Branding, Custom Domains, and who signs in to the link under Public Link, folded", async () => {
    await renderMenuAt(PageMap.DASHBOARD_VIEW);

    expect(sectionTitlesInOrder()).not.toContain("Branding");
    expect(sectionTitlesInOrder()).not.toContain("Owners");
    expect(linksIn("Public Link")).toEqual([
      { title: "Branding", href: viewRoute(PageMap.DASHBOARD_VIEW_BRANDING) },
      {
        title: "Custom Domains",
        href: viewRoute(PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS),
      },
      // Who signs in when only people who sign in can view it (#10250).
      {
        title: "Private Users",
        href: viewRoute(PageMap.DASHBOARD_VIEW_PRIVATE_USERS),
      },
      {
        title: "Single Sign-On",
        href: viewRoute(PageMap.DASHBOARD_VIEW_SINGLE_SIGN_ON),
      },
    ] as Array<MenuLink>);
    expect(isExpanded("Public Link")).toBe(false);
  });

  test.each([
    [PageMap.DASHBOARD_VIEW_BRANDING, "Branding"],
    [PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS, "Custom Domains"],
    [PageMap.DASHBOARD_VIEW_PRIVATE_USERS, "Private Users"],
    [PageMap.DASHBOARD_VIEW_SINGLE_SIGN_ON, "Single Sign-On"],
  ])(
    "the %s page opens Public Link and marks %s",
    async (page: string, entry: string) => {
      await renderMenuAt(page);

      expect(isExpanded("Public Link")).toBe(true);
      expect(activeLinkTitles()).toEqual([entry]);
    },
  );
});
