import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import Link from "../../Types/Link";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import SideMenuItem from "../../UI/Components/SideMenu/SideMenuItem";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  allLinks,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./Dashboard/SideMenuHarness";

/*
 * "Please always collapse the advanced section by default. Please do this for
 * entire project. Leaving it open by default causes decision paralysis for
 * users." (the maintainer, on the View Workflow menu)
 *
 * Every side menu in the product, in every app that has one (the Dashboard,
 * the Admin Dashboard and the public status page), is found on disk and
 * rendered for real against its app's RouteMap. For each menu with an
 * Advanced section this checks that:
 *
 *  - on the menu's first page, which is not in Advanced, Advanced is
 *    collapsed: aria-expanded is false and its rows are folded away and
 *    hidden (max-h-0, opacity-0, invisible);
 *  - on every page inside Advanced, it is open, because collapsing must never
 *    hide the page the user is on.
 *
 * Nothing is listed by hand: a new menu, or a new Advanced section, is checked
 * the day it is written. The sweep at the end only makes sure the walk itself
 * still finds the menus, so a moved folder cannot quietly empty this suite.
 */

/*
 * The Admin Dashboard titles its sections with react-i18next keys
 * ("sideMenu.advanced"). Resolve them from its English locale so its menus
 * render the words a user sees; the Dashboard's flat English strings fall
 * through unchanged.
 */
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

  const translate: (key: string) => string = (key: string): string => {
    let value: unknown = adminEnglish;

    for (const part of key.split(".")) {
      if (typeof value !== "object" || value === null) {
        return key;
      }

      value = (value as Record<string, unknown>)[part];
    }

    return typeof value === "string" ? value : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

// Badge counts: nothing open, nothing to count, no network.
jest.mock("../../UI/Utils/ModelAPI/ModelAPI", () => {
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

jest.mock("../../../App/FeatureSet/Dashboard/src/Utils/IncidentState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

// Its badge is computed from several fetches; the row itself is what matters here.
jest.mock(
  "../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

const FEATURE_SETS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

// Every app whose pages are drawn with the shared SideMenu.
const APP_SOURCE_DIRS: ReadonlyArray<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
].map((app: string): string => {
  return path.join(FEATURE_SETS_DIR, app, "src");
});

// A menu module renders the shared SideMenu (an item component only imports SideMenuItem).
const RENDERS_SIDE_MENU: RegExp =
  /from\s+"Common\/UI\/Components\/SideMenu\/SideMenu"/;

// How an Advanced section is written, in either form, in either kind of app.
const DECLARES_ADVANCED_SECTION: RegExp =
  /title(?:=|:\s*)(?:"Advanced"|\{?t\("sideMenu\.advanced"\)\}?)/;

function sourceFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

interface MenuModule {
  // Relative to packages/App/FeatureSet, e.g. "Dashboard/src/Pages/Workflow/View/SideMenu.tsx".
  name: string;
  file: string;
  declaresAdvanced: boolean;
}

const MENU_MODULES: ReadonlyArray<MenuModule> = APP_SOURCE_DIRS.flatMap(
  (dir: string): Array<string> => {
    return sourceFilesUnder(dir);
  },
)
  .filter((file: string): boolean => {
    return (
      path.basename(file).endsWith("SideMenu.tsx") &&
      RENDERS_SIDE_MENU.test(fs.readFileSync(file, "utf8"))
    );
  })
  .map((file: string): MenuModule => {
    return {
      name: path.relative(FEATURE_SETS_DIR, file).split(path.sep).join("/"),
      file,
      declaresAdvanced: DECLARES_ADVANCED_SECTION.test(
        fs.readFileSync(file, "utf8"),
      ),
    };
  })
  .sort((a: MenuModule, b: MenuModule): number => {
    return a.name.localeCompare(b.name);
  });

const MENUS_WITH_ADVANCED: ReadonlyArray<MenuModule> = MENU_MODULES.filter(
  (menu: MenuModule): boolean => {
    return menu.declaresAdvanced;
  },
);

const MODEL_ID: ObjectID = new ObjectID("0193c0de-4444-4aaa-8bbb-000000000004");

/*
 * Props for any menu: the resource menus take the id of the resource they
 * belong to, the monitor's also its type, and the rest ignore what they do
 * not declare.
 */
const MENU_PROPS: Record<string, unknown> = {
  modelId: MODEL_ID,
  monitorType: MonitorType.Website,
};

// Where a menu is first drawn to read its links: inside a project.
const PROJECT_HOME: string = `/dashboard/${PROJECT_ID}`;

async function renderMenuModuleAt(
  menu: MenuModule,
  currentPath: string,
): Promise<void> {
  const MenuComponent: FunctionComponent<Record<string, unknown>> = (
    jest.requireActual(menu.file) as {
      default: FunctionComponent<Record<string, unknown>>;
    }
  ).default;

  goTo(currentPath);
  await renderMenu(<MenuComponent {...MENU_PROPS} />);
}

interface AdvancedPages {
  outside: string;
  inside: Array<string>;
}

async function advancedPagesOf(menu: MenuModule): Promise<AdvancedPages> {
  await renderMenuModuleAt(menu, PROJECT_HOME);

  const inside: Array<string> = linksIn("Advanced").map(
    (link: MenuLink): string => {
      return link.href;
    },
  );
  const outside: string | undefined = allLinks()
    .map((link: MenuLink): string => {
      return link.href;
    })
    .find((href: string): boolean => {
      return !inside.includes(href);
    });

  cleanup();

  if (!outside) {
    throw new Error(`${menu.name} lists no page outside Advanced.`);
  }

  return { outside, inside };
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(PROJECT_HOME);
});

afterEach(() => {
  cleanup();
});

describe("every Advanced side-menu section starts collapsed", () => {
  test.each(
    MENUS_WITH_ADVANCED.map((menu: MenuModule): [string, MenuModule] => {
      return [menu.name, menu];
    }),
  )(
    "%s: Advanced is collapsed and its rows hidden on the menu's first page",
    async (_name: string, menu: MenuModule) => {
      const pages: AdvancedPages = await advancedPagesOf(menu);

      await renderMenuModuleAt(menu, pages.outside);

      expect(sectionTitlesInOrder()).toContain("Advanced");
      expect({ page: pages.outside, expanded: isExpanded("Advanced") }).toEqual(
        { page: pages.outside, expanded: false },
      );
      expect(sectionBody("Advanced")).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );
    },
  );

  test.each(
    MENUS_WITH_ADVANCED.map((menu: MenuModule): [string, MenuModule] => {
      return [menu.name, menu];
    }),
  )(
    "%s: Advanced is open on every page inside it",
    async (_name: string, menu: MenuModule) => {
      const pages: AdvancedPages = await advancedPagesOf(menu);

      expect(pages.inside.length).toBeGreaterThan(0);

      for (const page of pages.inside) {
        await renderMenuModuleAt(menu, page);

        expect({ page, expanded: isExpanded("Advanced") }).toEqual({
          page,
          expanded: true,
        });
        expect(sectionBody("Advanced")).not.toHaveClass("invisible");

        cleanup();
      }
    },
  );
});

describe("the sweep finds the product's menus", () => {
  /*
   * A sample the walk must find, from each app and each way a menu is
   * written, so a change to the folders or to RENDERS_SIDE_MENU shows up here
   * instead of as a suite that checks nothing.
   */
  const KNOWN_MENUS: ReadonlyArray<string> = [
    "AdminDashboard/src/Pages/Projects/View/SideMenu.tsx",
    "AdminDashboard/src/Pages/Users/View/SideMenu.tsx",
    "Dashboard/src/Components/Network/NetworkSideMenu.tsx",
    "Dashboard/src/Pages/Monitor/View/SideMenu.tsx",
    "Dashboard/src/Pages/OnCallDuty/SideMenu.tsx",
    "Dashboard/src/Pages/Settings/SideMenu.tsx",
    "Dashboard/src/Pages/StatusPages/View/AnnouncementSideMenu.tsx",
    "Dashboard/src/Pages/Workflow/SideMenu.tsx",
    "Dashboard/src/Pages/Workflow/View/SideMenu.tsx",
    "StatusPage/src/Pages/Subscribe/SideMenu.tsx",
  ];

  test("finds every app's menus", () => {
    expect(
      MENU_MODULES.map((menu: MenuModule): string => {
        return menu.name;
      }),
    ).toEqual(expect.arrayContaining([...KNOWN_MENUS]));
    expect(MENU_MODULES.length).toBeGreaterThanOrEqual(80);
  });

  // The workflow menu in the maintainer's screenshot, the project settings, and the Admin Dashboard.
  test("finds the Advanced sections it has to check", () => {
    expect(
      MENUS_WITH_ADVANCED.map((menu: MenuModule): string => {
        return menu.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "AdminDashboard/src/Pages/Projects/View/SideMenu.tsx",
        "AdminDashboard/src/Pages/Users/View/SideMenu.tsx",
        "Dashboard/src/Pages/Monitor/View/SideMenu.tsx",
        "Dashboard/src/Pages/OnCallDuty/SideMenu.tsx",
        "Dashboard/src/Pages/Settings/SideMenu.tsx",
        "Dashboard/src/Pages/Workflow/View/SideMenu.tsx",
      ]),
    );
    expect(MENUS_WITH_ADVANCED.length).toBeGreaterThanOrEqual(37);
  });

  /*
   * The source match above picks which menus get the two checks. Rendering
   * every menu catches an Advanced section it cannot see, such as one titled
   * through a constant.
   */
  test("every menu that renders an Advanced section is checked", async () => {
    const rendersAdvanced: Array<string> = [];

    for (const menu of MENU_MODULES) {
      await renderMenuModuleAt(menu, PROJECT_HOME);

      if (sectionTitlesInOrder().includes("Advanced")) {
        rendersAdvanced.push(menu.name);
      }

      cleanup();
    }

    expect(rendersAdvanced).toEqual(
      MENUS_WITH_ADVANCED.map((menu: MenuModule): string => {
        return menu.name;
      }),
    );
  });
});
