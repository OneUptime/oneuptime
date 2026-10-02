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

/*
 * Whether this install has billing on, pinned by the suite rather than read
 * from the environment: a project's admin menu grows Billing and Support
 * sections with it, and CI and a bare `npx jest` disagree about the default.
 */
let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

/*
 * The Admin Dashboard titles its sections with react-i18next keys. English
 * resolves them from its locale; "another language" stands for any
 * translation, where the shared section cannot recognise a title by its
 * English words, so each menu has to say which of its sections fold.
 */
let mockLanguage: "English" | "another language" = "English";

jest.mock("react-i18next", () => {
  const nodeFs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const nodePath: typeof import("path") = jest.requireActual(
    "path",
  ) as typeof import("path");

  const adminEnglish: Record<string, unknown> = JSON.parse(
    nodeFs.readFileSync(
      nodePath.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Locales",
        "en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const english: (key: string) => string = (key: string): string => {
    let value: unknown = adminEnglish;

    for (const part of key.split(".")) {
      if (typeof value !== "object" || value === null) {
        return key;
      }

      value = (value as Record<string, unknown>)[part];
    }

    return typeof value === "string" ? value : key;
  };

  /*
   * The shared section looks its title up again for display, so a title
   * already in "another language" is passed back as it is.
   */
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          if (mockLanguage === "English" || key.startsWith("«")) {
            return mockLanguage === "English" ? english(key) : key;
          }

          return `«${english(key)}»`;
        },
      };
    },
  };
});

import AdminHealthSideMenu from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/SideMenu";
import AdminProjectSideMenu from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu";
import AdminSettingsSideMenu from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "../Dashboard/SideMenuHarness";

/*
 * "Collapsing things in the side menu that are not used frequently ... for
 * every side menu across the project" (the maintainer). The Admin
 * Dashboard's menus follow the same rule as the Dashboard's: what the menu is
 * opened for stays open, and the rest folds down to its title and opens by
 * itself on its own pages.
 */

const PROJECT_MODEL_ID: ObjectID = new ObjectID(
  "0193c0de-6666-4aaa-8bbb-000000000006",
);

interface SectionState {
  title: string;
  expanded: boolean;
}

function sectionStates(): Array<SectionState> {
  return sectionTitlesInOrder().map((title: string): SectionState => {
    return { title, expanded: isExpanded(title) };
  });
}

function adminRoute(pageMapKey: string, modelId?: ObjectID): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
    modelId ? { modelId } : undefined,
  ).toString();
}

beforeEach(() => {
  billingEnabledForTest = false;
  mockLanguage = "English";
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("Admin Settings: only Basic starts open", () => {
  test("on the Authentication page, every section after Basic is folded", async () => {
    goTo(adminRoute(PageMap.SETTINGS_AUTHENTICATION));
    await renderMenu(<AdminSettingsSideMenu />);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "Authentication", expanded: false },
      { title: "Notifications", expanded: false },
      { title: "Monitoring", expanded: false },
      { title: "Data Retention", expanded: false },
      { title: "AI", expanded: false },
      { title: "API and Integrations", expanded: false },
    ]);
    expect(sectionBody("Notifications")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
  });

  test("folds the same sections in any language", async () => {
    mockLanguage = "another language";
    goTo(adminRoute(PageMap.SETTINGS_AUTHENTICATION));
    await renderMenu(<AdminSettingsSideMenu />);

    expect(sectionStates()).toEqual([
      { title: "«Basic»", expanded: true },
      { title: "«Authentication»", expanded: false },
      { title: "«Notifications»", expanded: false },
      { title: "«Monitoring»", expanded: false },
      { title: "«Data Retention»", expanded: false },
      { title: "«AI»", expanded: false },
      { title: "«API and Integrations»", expanded: false },
    ]);
  });

  test.each([
    [PageMap.SETTINGS_SMTP, "Notifications", "Emails"],
    [PageMap.SETTINGS_AI_AGENTS, "AI", "Global AI Agents"],
    [PageMap.SETTINGS_GLOBAL_SSO, "Authentication", "Global SSO"],
    [PageMap.SETTINGS_API_KEY, "API and Integrations", "API Key"],
  ])(
    "the %s page opens %s and marks %s",
    async (page: string, section: string, entry: string) => {
      goTo(adminRoute(page));
      await renderMenu(<AdminSettingsSideMenu />);

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([entry]);
      expect(isExpanded("Basic")).toBe(true);
    },
  );

  test("a folded section opens with a click", async () => {
    goTo(adminRoute(PageMap.SETTINGS_AUTHENTICATION));
    await renderMenu(<AdminSettingsSideMenu />);

    fireEvent.click(sectionToggle("Notifications"));

    expect(isExpanded("Notifications")).toBe(true);
    expect(linksIn("Notifications")).toHaveLength(4);
  });
});

describe("Admin Health: is this instance healthy, first", () => {
  test("Overview and Datastores are open; Diagnostics and Maintenance fold", async () => {
    goTo(adminRoute(PageMap.HEALTH));
    await renderMenu(<AdminHealthSideMenu />);

    expect(sectionStates()).toEqual([
      { title: "Overview", expanded: true },
      { title: "Datastores", expanded: true },
      { title: "Diagnostics", expanded: false },
      { title: "Maintenance", expanded: false },
    ]);
  });

  test.each([
    [PageMap.HEALTH_LOGS, "Diagnostics", "Diagnostic Logs"],
    [PageMap.HEALTH_MIGRATIONS, "Maintenance", "Migrations"],
  ])(
    "the %s page opens %s and marks %s",
    async (page: string, section: string, entry: string) => {
      goTo(adminRoute(page));
      await renderMenu(<AdminHealthSideMenu />);

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([entry]);
    },
  );
});

describe("a project in the Admin Dashboard: its members first", () => {
  test("without billing: Basic and Members open, Advanced folded", async () => {
    goTo(adminRoute(PageMap.PROJECT_VIEW, PROJECT_MODEL_ID));
    await renderMenu(<AdminProjectSideMenu modelId={PROJECT_MODEL_ID} />);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "Members", expanded: true },
      { title: "Advanced", expanded: false },
    ]);
  });

  test("with billing: Billing and Support fold, in any language", async () => {
    billingEnabledForTest = true;

    for (const language of ["English", "another language"] as const) {
      mockLanguage = language;
      goTo(adminRoute(PageMap.PROJECT_VIEW, PROJECT_MODEL_ID));
      await renderMenu(<AdminProjectSideMenu modelId={PROJECT_MODEL_ID} />);

      expect({
        language,
        expanded: sectionStates().map((state: SectionState): boolean => {
          return state.expanded;
        }),
      }).toEqual({ language, expanded: [true, true, false, false, false] });

      cleanup();
    }
  });

  test("with billing, the Subscription page opens Billing", async () => {
    billingEnabledForTest = true;
    goTo(adminRoute(PageMap.PROJECT_SUBSCRIPTION, PROJECT_MODEL_ID));
    await renderMenu(<AdminProjectSideMenu modelId={PROJECT_MODEL_ID} />);

    expect(isExpanded("Billing")).toBe(true);
    expect(isExpanded("Support")).toBe(false);
    expect(activeLinkTitles()).toEqual(["Subscription"]);
  });
});
