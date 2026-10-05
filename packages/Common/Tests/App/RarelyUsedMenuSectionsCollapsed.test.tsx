import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import Link from "../../Types/Link";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import SideMenuItem from "../../UI/Components/SideMenu/SideMenuItem";
import {
  SECTION_TITLES_COLLAPSED_BY_DEFAULT,
  isTitleCollapsedByDefault,
} from "../../UI/Components/SideMenu/SideMenuSectionState";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./Dashboard/SideMenuHarness";

/*
 * "We need to make the UI very simple to understand and use, and one of the
 * ways to do that is collapsing things in the side menu that are not used
 * frequently. For example, incident list side menu should look like this
 * [Overview and Episodes open; AI, Workspace, Rules and Settings collapsed].
 * Can you please do this for every side menu across the project. This will
 * make sure users dont have decision paralysis when they look at oneuptime
 * UI." (the maintainer)
 *
 * Every side menu in the product, in every app that has one (the Dashboard,
 * the Admin Dashboard and the public status page), is found on disk and
 * rendered for real against its app's RouteMap, on the page it opens to
 * (its first entry). For each menu this checks that:
 *
 *  - every section titled for a rarely used kind of section (Settings,
 *    Rules, Workspace, AI, Logs, Advanced, Developer and the rest of
 *    SECTION_TITLES_COLLAPSED_BY_DEFAULT) starts collapsed, its rows folded
 *    away and hidden, unless the menu keeps it open on purpose
 *    (KEPT_OPEN_ON_PURPOSE, each with its reason);
 *  - every other section that starts open is an everyday one: its title is
 *    in EVERYDAY_SECTION_TITLES. A new section is a decision: it either holds
 *    what people open the menu for, or it folds away;
 *  - every collapsed section opens by itself on each of its own pages, with
 *    that page's entry the one marked as current: collapsing must never hide
 *    where the user is.
 *
 * Nothing is listed per menu: a new menu is checked the day it is written.
 */

/*
 * The Admin Dashboard titles its sections with react-i18next keys
 * ("sideMenu.settingsAi"). Resolve them from its English locale so its menus
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

/*
 * Sections that may start open: the ones that hold what people open a menu
 * for. A product's lists and the filtered views of them (Episodes, Attention
 * Required), a resource's own views (its telemetry, workloads, activity,
 * notes), and the few pages a settings menu is mostly opened for.
 *
 * The first section of a menu holds the page the menu opens to, so it is
 * open whatever its title and is not looked up here.
 *
 * To add a section that starts open, add its title here, if it holds what
 * people come to the menu for. If it does not, fold it instead: add its
 * title to SECTION_TITLES_COLLAPSED_BY_DEFAULT (SideMenuSectionState.ts)
 * when it names the same kind of section in every menu, or set
 * `defaultCollapsed` on the section.
 */
const EVERYDAY_SECTION_TITLES: ReadonlyArray<string> = [
  // Product lists, and the views of them people check every day.
  "Alerts",
  "Attention Required",
  "Episodes",
  "Incidents",
  "Incoming Calls",
  "Monitors",
  "More",
  "Scheduled Events",
  "Schedules",
  "Topology",
  // A resource's own views.
  "Activity",
  "Alert Notes",
  "Episode Notes",
  "Infrastructure",
  "Investigation",
  "Members",
  "Members & Access",
  "Membership",
  "Notes",
  "Observability",
  "On-Call",
  "Operations",
  "Resolve",
  "Resources",
  "Session Replay",
  "Storage",
  "Team",
  "Telemetry",
  "Timeline",
  "Workloads",
  // The pages a settings menu is mostly opened for.
  "Alerts & Notifications",
  "Datastores",
];

/*
 * Sections titled for a rarely used kind of section that a menu keeps open
 * anyway, and why. Everywhere else those titles start collapsed.
 */
const KEPT_OPEN_ON_PURPOSE: Readonly<Record<string, Record<string, string>>> = {
  /*
   * A workflow's run history is how it is checked: the runs moved out of
   * Advanced into a Logs section of their own precisely so that they are
   * never folded away (WorkflowRunsLogsMenus.test.tsx).
   */
  "Dashboard/src/Pages/Workflow/SideMenu.tsx": {
    Logs: "workflow runs are how workflows are checked, so they stay on screen",
  },
  "Dashboard/src/Pages/Workflow/View/SideMenu.tsx": {
    Logs: "a workflow's runs are how it is checked, so they stay on screen",
  },
};

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
  // Relative to packages/App/FeatureSet, e.g. "Dashboard/src/Pages/Incidents/SideMenu.tsx".
  name: string;
  file: string;
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
    };
  })
  .sort((a: MenuModule, b: MenuModule): number => {
    return a.name.localeCompare(b.name);
  });

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

interface SectionReading {
  title: string;
  links: Array<MenuLink>;
}

interface MenuReading {
  // The page the menu opens to: its first entry.
  landing: string;
  sections: Array<SectionReading>;
}

// The menu's sections and their links, as drawn inside the project.
async function readMenu(menu: MenuModule): Promise<MenuReading | null> {
  await renderMenuModuleAt(menu, PROJECT_HOME);

  const sections: Array<SectionReading> = sectionTitlesInOrder().map(
    (title: string): SectionReading => {
      return { title, links: linksIn(title) };
    },
  );

  cleanup();

  const landing: string | undefined = sections
    .flatMap((section: SectionReading): Array<MenuLink> => {
      return section.links;
    })
    .map((link: MenuLink): string => {
      return link.href;
    })[0];

  // A menu of loose entries (the status page's Subscribe menu) has no sections to fold.
  if (!landing) {
    return null;
  }

  return { landing, sections };
}

function isKeptOpenOnPurpose(menu: MenuModule, title: string): boolean {
  return Boolean(KEPT_OPEN_ON_PURPOSE[menu.name]?.[title]);
}

function holdsPage(section: SectionReading, href: string): boolean {
  return section.links.some((link: MenuLink): boolean => {
    return link.href === href;
  });
}

const MENU_CASES: Array<[string, MenuModule]> = MENU_MODULES.map(
  (menu: MenuModule): [string, MenuModule] => {
    return [menu.name, menu];
  },
);

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(PROJECT_HOME);
});

afterEach(() => {
  cleanup();
});

describe("every side menu folds its rarely used sections away", () => {
  test.each(MENU_CASES)(
    "%s: on the page it opens to, every rarely used section is collapsed",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading | null = await readMenu(menu);

      if (!reading) {
        return;
      }

      await renderMenuModuleAt(menu, reading.landing);

      for (const section of reading.sections) {
        if (
          !isTitleCollapsedByDefault(section.title) ||
          holdsPage(section, reading.landing)
        ) {
          continue;
        }

        const keptOpen: boolean = isKeptOpenOnPurpose(menu, section.title);

        expect({
          menu: menu.name,
          section: section.title,
          expanded: isExpanded(section.title),
        }).toEqual({
          menu: menu.name,
          section: section.title,
          expanded: keptOpen,
        });

        if (keptOpen) {
          expect(sectionBody(section.title)).not.toHaveClass("invisible");
        } else {
          expect(sectionBody(section.title)).toHaveClass(
            "max-h-0",
            "opacity-0",
            "invisible",
          );
        }
      }
    },
  );

  test.each(MENU_CASES)(
    "%s: every section that starts open is an everyday one",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading | null = await readMenu(menu);

      if (!reading) {
        return;
      }

      await renderMenuModuleAt(menu, reading.landing);

      const openWithoutReason: Array<string> = reading.sections
        .filter((section: SectionReading): boolean => {
          return (
            !holdsPage(section, reading.landing) &&
            isExpanded(section.title) &&
            !EVERYDAY_SECTION_TITLES.includes(section.title) &&
            !isKeptOpenOnPurpose(menu, section.title)
          );
        })
        .map((section: SectionReading): string => {
          return section.title;
        });

      /*
       * A section listed here starts open without being an everyday one.
       * Fold it (SECTION_TITLES_COLLAPSED_BY_DEFAULT, or `defaultCollapsed`
       * on the section), or, if it holds what people open this menu for,
       * add its title to EVERYDAY_SECTION_TITLES above.
       */
      expect({ menu: menu.name, openWithoutReason }).toEqual({
        menu: menu.name,
        openWithoutReason: [],
      });
    },
  );

  test.each(MENU_CASES)(
    "%s: a collapsed section opens by itself on each of its pages",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading | null = await readMenu(menu);

      if (!reading) {
        return;
      }

      await renderMenuModuleAt(menu, reading.landing);

      const collapsed: Array<SectionReading> = reading.sections.filter(
        (section: SectionReading): boolean => {
          return !isExpanded(section.title);
        },
      );

      cleanup();

      for (const section of collapsed) {
        for (const link of section.links) {
          await renderMenuModuleAt(menu, link.href);

          expect({
            menu: menu.name,
            page: link.href,
            section: section.title,
            expanded: isExpanded(section.title),
          }).toEqual({
            menu: menu.name,
            page: link.href,
            section: section.title,
            expanded: true,
          });
          expect(sectionBody(section.title)).not.toHaveClass("invisible");
          expect(activeLinkTitles()).toContain(link.title);

          cleanup();
        }
      }
    },
  );
});

/*
 * The menu in the maintainer's screenshot: Overview and Episodes open, and
 * AI, Workspace, Rules and Settings folded down to their titles (the AI
 * section, gone for a while, is back with the AI settings and the
 * auto-remediation rules in it). Developer, added since, folds too.
 */
describe("the Incidents menu, as the maintainer drew it", () => {
  const INCIDENTS_MENU: string = "Dashboard/src/Pages/Incidents/SideMenu.tsx";

  function incidentsMenu(): MenuModule {
    const menu: MenuModule | undefined = MENU_MODULES.find(
      (candidate: MenuModule): boolean => {
        return candidate.name === INCIDENTS_MENU;
      },
    );

    if (!menu) {
      throw new Error(`The sweep did not find ${INCIDENTS_MENU}.`);
    }

    return menu;
  }

  test("opens on All Incidents with Overview and Episodes open, and the rest folded", async () => {
    await renderMenuModuleAt(
      incidentsMenu(),
      `/dashboard/${PROJECT_ID}/incidents`,
    );

    expect(
      sectionTitlesInOrder().map((title: string) => {
        return { title, expanded: isExpanded(title) };
      }),
    ).toEqual([
      { title: "Overview", expanded: true },
      { title: "Episodes", expanded: true },
      { title: "AI", expanded: false },
      { title: "Workspace", expanded: false },
      { title: "Rules", expanded: false },
      { title: "Settings", expanded: false },
      { title: "Developer", expanded: false },
    ]);
  });

  test("a folded section opens with a click, and folds away again", async () => {
    await renderMenuModuleAt(
      incidentsMenu(),
      `/dashboard/${PROJECT_ID}/incidents`,
    );

    fireEvent.click(sectionToggle("Workspace"));

    expect(isExpanded("Workspace")).toBe(true);
    expect(sectionBody("Workspace")).not.toHaveClass("invisible");

    fireEvent.click(sectionToggle("Workspace"));

    expect(isExpanded("Workspace")).toBe(false);
    expect(sectionBody("Workspace")).toHaveClass("invisible");
  });

  test("on a phone, a folded section opens from the menu without closing it", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderMenuModuleAt(
      incidentsMenu(),
      `/dashboard/${PROJECT_ID}/incidents`,
    );

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    expect(isExpanded("Workspace")).toBe(false);

    fireEvent.click(sectionToggle("Workspace"));

    expect(screen.getByTestId("mobile-sidemenu-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(isExpanded("Workspace")).toBe(true);
    /*
     * The project in this sweep has no chat workspace connected (every list
     * comes back empty), so Workspace holds the one entry that connects one
     * instead of Slack and Microsoft Teams.
     */
    expect(
      linksIn("Workspace").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Connect Slack or Teams"]);
  });
});

describe("the rule and its exceptions stay honest", () => {
  test("the rarely used titles include the four the maintainer folded, and Advanced and Developer", () => {
    for (const title of [
      "AI",
      "Workspace",
      "Rules",
      "Settings",
      "Advanced",
      "Developer",
    ]) {
      expect(SECTION_TITLES_COLLAPSED_BY_DEFAULT).toContain(title);
    }
  });

  // A title cannot be both, or the two lists would disagree about it.
  test("no everyday title is also a rarely used one", () => {
    expect(
      EVERYDAY_SECTION_TITLES.filter((title: string): boolean => {
        return isTitleCollapsedByDefault(title);
      }),
    ).toEqual([]);
  });

  test("every section kept open on purpose names a menu and a rarely used title it has", async () => {
    for (const [menuName, sections] of Object.entries(KEPT_OPEN_ON_PURPOSE)) {
      const menu: MenuModule | undefined = MENU_MODULES.find(
        (candidate: MenuModule): boolean => {
          return candidate.name === menuName;
        },
      );

      expect({ menuName, found: Boolean(menu) }).toEqual({
        menuName,
        found: true,
      });

      const reading: MenuReading | null = await readMenu(menu!);

      for (const [title, reason] of Object.entries(sections)) {
        expect(reason.trim().length).toBeGreaterThan(0);
        expect(isTitleCollapsedByDefault(title)).toBe(true);
        expect(
          reading?.sections.map((section: SectionReading): string => {
            return section.title;
          }),
        ).toContain(title);
      }
    }
  });

  // Keeps the everyday list from collecting titles no menu uses any more.
  test("every everyday title is a section some menu starts with open", async () => {
    const openTitles: Set<string> = new Set();

    for (const menu of MENU_MODULES) {
      const reading: MenuReading | null = await readMenu(menu);

      if (!reading) {
        continue;
      }

      await renderMenuModuleAt(menu, reading.landing);

      for (const section of reading.sections) {
        if (isExpanded(section.title)) {
          openTitles.add(section.title);
        }
      }

      cleanup();
    }

    expect(
      EVERYDAY_SECTION_TITLES.filter((title: string): boolean => {
        return !openTitles.has(title);
      }),
    ).toEqual([]);
  });
});

describe("the sweep finds the product's menus", () => {
  /*
   * A sample the walk must find, from each app and each way a menu is
   * written, so a change to the folders or to RENDERS_SIDE_MENU shows up here
   * instead of as a suite that checks nothing.
   */
  const KNOWN_MENUS: ReadonlyArray<string> = [
    "AdminDashboard/src/Pages/Health/SideMenu.tsx",
    "AdminDashboard/src/Pages/Settings/SideMenu.tsx",
    "Dashboard/src/Components/Network/NetworkSideMenu.tsx",
    "Dashboard/src/Pages/Incidents/SideMenu.tsx",
    "Dashboard/src/Pages/Kubernetes/View/SideMenu.tsx",
    "Dashboard/src/Pages/Monitor/View/SideMenu.tsx",
    "Dashboard/src/Pages/Settings/SideMenu.tsx",
    "Dashboard/src/Pages/StatusPages/View/SideMenu.tsx",
    "Dashboard/src/Pages/UserSettings/SideMenu.tsx",
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

  test("most menus have a section to fold, so the checks above check something", async () => {
    let menusWithAFoldedSection: number = 0;

    for (const menu of MENU_MODULES) {
      const reading: MenuReading | null = await readMenu(menu);

      if (!reading) {
        continue;
      }

      await renderMenuModuleAt(menu, reading.landing);

      if (
        reading.sections.some((section: SectionReading): boolean => {
          return !isExpanded(section.title);
        })
      ) {
        menusWithAFoldedSection++;
      }

      cleanup();
    }

    expect(menusWithAFoldedSection).toBeGreaterThanOrEqual(70);
  });
});
