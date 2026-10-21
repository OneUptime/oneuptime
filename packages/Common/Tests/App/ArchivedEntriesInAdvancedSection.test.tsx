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
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Link from "../../Types/Link";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import SideMenuItem from "../../UI/Components/SideMenu/SideMenuItem";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  allLinks,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./Dashboard/SideMenuHarness";

/*
 * "Can you please move this archive side menu to the advanced section in the
 * side menu? Create a new advanced section in the side menu if it doesn't
 * exist, and move the archive there. Please do this everywhere else in the
 * product where possible. This section should be collapsed by default" (the
 * maintainer, on the Workflows menu, whose main section listed Workflows,
 * Global Variables and Archived).
 *
 * Every side menu in the product, in every app that has one (the Dashboard,
 * the Admin Dashboard and the public status page), is found on disk and
 * rendered for real against its app's RouteMap. Wherever a menu has an entry
 * for archived things (titled "Archived...", or linking to one of the
 * Dashboard's archived pages, the PageMap keys ending in _ARCHIVED), that
 * entry:
 *
 *  - sits in the menu's one Advanced section, and nowhere else in the menu;
 *  - is folded away, with the rest of Advanced, on the menu's first page;
 *  - is the one active entry on its own page, where Advanced is open, and the
 *    phone menu names it "Advanced / <entry>";
 *  - and Advanced comes last, just before Developer, which stays the last
 *    section of a list menu. On-Call's Advanced section is the one exception
 *    (see ADVANCED_KEEPS_ITS_PLACE).
 *
 * And every archived page the Dashboard has is reached from exactly one menu,
 * except the ones in NOT_IN_A_SIDE_MENU, each with its reason. The menus are
 * found from their source, and a sweep renders all of them to make sure the
 * source match missed none, so a new menu is checked the day it is written.
 */

/*
 * The Admin Dashboard titles its sections with react-i18next keys. Resolve
 * them from its English locale so its menus render the words a user sees;
 * the Dashboard's flat English strings fall through unchanged.
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

const ADVANCED: string = "Advanced";
const DEVELOPER: string = "Developer";

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

/*
 * How a menu writes an entry for archived things: a title that starts with
 * "Archived", or a link to an archived page.
 */
const DECLARES_ARCHIVED_ENTRY: RegExp =
  /title(?:=|:\s*)"Archived[^"]*"|PageMap\.[A-Z_]+_ARCHIVED\b/;

// What a rendered entry for archived things is called.
const ARCHIVED_TITLE: RegExp = /^Archived\b/;

/*
 * Archived pages no side menu lists, and why. Anything else ending in
 * _ARCHIVED must be reached from exactly one menu.
 */
const NOT_IN_A_SIDE_MENU: Readonly<Record<string, string>> = {
  /*
   * Exceptions has no side menu: its pages are tabs in the page header, and
   * Archived is a status in the Exceptions list's own status filter
   * (Unresolved, Resolved, Archived), beside its Overview tile. The URL is
   * kept so old links still land on that filter.
   */
  [PageMap.EXCEPTIONS_ARCHIVED]:
    "Exceptions has no side menu; archived exceptions are a status filter in its list",
};

/*
 * Menus whose Advanced section is not the last one before Developer, and
 * why. Everywhere else Advanced closes the menu.
 */
const ADVANCED_KEEPS_ITS_PLACE: Readonly<Record<string, string>> = {
  /*
   * On-Call had an Advanced section (User Overrides, Execution Logs) before
   * the archive moved into it, between Incoming Calls and Reports. The
   * archived policies joined it where it stands rather than moving pages
   * people already find there.
   */
  "Dashboard/src/Pages/OnCallDuty/SideMenu.tsx":
    "On-Call's Advanced section predates the rule and keeps its place",
};

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
  // Relative to packages/App/FeatureSet, e.g. "Dashboard/src/Pages/Workflow/SideMenu.tsx".
  name: string;
  file: string;
  declaresArchived: boolean;
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
      declaresArchived: DECLARES_ARCHIVED_ENTRY.test(
        fs.readFileSync(file, "utf8"),
      ),
    };
  })
  .sort((a: MenuModule, b: MenuModule): number => {
    return a.name.localeCompare(b.name);
  });

const MENUS_WITH_ARCHIVED: ReadonlyArray<MenuModule> = MENU_MODULES.filter(
  (menu: MenuModule): boolean => {
    return menu.declaresArchived;
  },
);

// Every archived page of the Dashboard, by its PageMap key.
const ARCHIVED_PAGES: ReadonlyArray<string> = Object.values(PageMap)
  .filter((key: string): boolean => {
    return key.endsWith("_ARCHIVED");
  })
  .sort();

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

// The Dashboard's archived pages, as the hrefs a menu renders for them.
function archivedPageHrefs(): Array<string> {
  return ARCHIVED_PAGES.map((key: string): string => {
    return routeFor(key);
  });
}

function isArchivedEntry(
  link: MenuLink,
  archivedHrefs: Array<string>,
): boolean {
  return ARCHIVED_TITLE.test(link.title) || archivedHrefs.includes(link.href);
}

interface MenuReading {
  sections: Array<string>;
  links: Array<MenuLink>;
  advancedLinks: Array<MenuLink>;
  archivedEntries: Array<MenuLink>;
}

// The menu as drawn on the project's home page.
async function readMenu(menu: MenuModule): Promise<MenuReading> {
  await renderMenuModuleAt(menu, PROJECT_HOME);

  const sections: Array<string> = sectionTitlesInOrder();
  const links: Array<MenuLink> = allLinks();
  const archivedHrefs: Array<string> = archivedPageHrefs();
  const reading: MenuReading = {
    sections,
    links,
    advancedLinks: sections.includes(ADVANCED) ? linksIn(ADVANCED) : [],
    archivedEntries: links.filter((link: MenuLink): boolean => {
      return isArchivedEntry(link, archivedHrefs);
    }),
  };

  cleanup();

  return reading;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(PROJECT_HOME);
});

afterEach(() => {
  cleanup();
});

const MENU_CASES: Array<[string, MenuModule]> = MENUS_WITH_ARCHIVED.map(
  (menu: MenuModule): [string, MenuModule] => {
    return [menu.name, menu];
  },
);

describe("every entry for archived things sits in a collapsed Advanced section", () => {
  test.each(MENU_CASES)(
    "%s: the entry is in Advanced, and only there",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading = await readMenu(menu);

      expect(reading.archivedEntries.length).toBeGreaterThan(0);
      expect(
        reading.sections.filter((title: string): boolean => {
          return title === ADVANCED;
        }),
      ).toEqual([ADVANCED]);

      for (const entry of reading.archivedEntries) {
        expect({ menu: menu.name, entry, inAdvanced: true }).toEqual({
          menu: menu.name,
          entry,
          inAdvanced: reading.advancedLinks.some((link: MenuLink): boolean => {
            return link.href === entry.href && link.title === entry.title;
          }),
        });

        // Moved, not copied: no other section still links to it.
        expect(
          reading.links.filter((link: MenuLink): boolean => {
            return link.href === entry.href;
          }),
        ).toHaveLength(1);
      }
    },
  );

  test.each(MENU_CASES)(
    "%s: Advanced is folded away on the menu's first page",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading = await readMenu(menu);
      const firstPage: MenuLink | undefined = reading.links.find(
        (link: MenuLink): boolean => {
          return !reading.advancedLinks.some((advanced: MenuLink): boolean => {
            return advanced.href === link.href;
          });
        },
      );

      expect(firstPage).toBeDefined();

      await renderMenuModuleAt(menu, firstPage!.href);

      expect({ page: firstPage!.href, expanded: isExpanded(ADVANCED) }).toEqual(
        { page: firstPage!.href, expanded: false },
      );
      expect(sectionBody(ADVANCED)).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );
    },
  );

  test.each(MENU_CASES)(
    "%s: on the archived page, Advanced is open and the entry is the active one",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading = await readMenu(menu);

      for (const entry of reading.archivedEntries) {
        await renderMenuModuleAt(menu, entry.href);

        expect({ page: entry.href, expanded: isExpanded(ADVANCED) }).toEqual({
          page: entry.href,
          expanded: true,
        });
        expect(sectionBody(ADVANCED)).not.toHaveClass("invisible");
        expect(activeLinkTitles()).toEqual([entry.title]);

        cleanup();
      }
    },
  );

  test.each(MENU_CASES)(
    "%s: on a phone, the menu names Advanced and the entry on the archived page",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading = await readMenu(menu);

      setViewportWidth(MOBILE_WIDTH);

      for (const entry of reading.archivedEntries) {
        await renderMenuModuleAt(menu, entry.href);

        expect(mobileSummaryText()).toContain(`${ADVANCED} / ${entry.title}`);

        cleanup();
      }
    },
  );

  test.each(MENU_CASES)(
    "%s: Advanced comes last, before only Developer",
    async (_name: string, menu: MenuModule) => {
      const reading: MenuReading = await readMenu(menu);
      const after: Array<string> = reading.sections.slice(
        reading.sections.indexOf(ADVANCED) + 1,
      );

      if (ADVANCED_KEEPS_ITS_PLACE[menu.name]) {
        // It still ends with Developer, as every list menu does.
        expect(reading.sections[reading.sections.length - 1]).toBe(DEVELOPER);
        return;
      }

      expect({ menu: menu.name, after }).toEqual({
        menu: menu.name,
        after: reading.sections.includes(DEVELOPER) ? [DEVELOPER] : [],
      });
    },
  );
});

describe("every archived page is reached from one menu", () => {
  test("each archived page of the Dashboard is linked from exactly one side menu, unless it says why not", async () => {
    const linkedFrom: Record<string, Array<string>> = {};
    const hrefs: Array<string> = archivedPageHrefs();

    for (const menu of MENU_MODULES) {
      const reading: MenuReading = await readMenu(menu);

      for (const link of reading.links) {
        const page: string | undefined =
          ARCHIVED_PAGES[hrefs.indexOf(link.href)];

        if (page) {
          linkedFrom[page] = [...(linkedFrom[page] || []), menu.name];
        }
      }
    }

    for (const page of ARCHIVED_PAGES) {
      if (NOT_IN_A_SIDE_MENU[page]) {
        expect({ page, linkedFrom: linkedFrom[page] || [] }).toEqual({
          page,
          linkedFrom: [],
        });
        continue;
      }

      expect({ page, menus: (linkedFrom[page] || []).length }).toEqual({
        page,
        menus: 1,
      });
    }
  });

  test("every exemption names an archived page that exists", () => {
    for (const page of Object.keys(NOT_IN_A_SIDE_MENU)) {
      expect(ARCHIVED_PAGES).toContain(page);
    }

    for (const menu of Object.keys(ADVANCED_KEEPS_ITS_PLACE)) {
      expect(
        MENUS_WITH_ARCHIVED.map((module: MenuModule): string => {
          return module.name;
        }),
      ).toContain(menu);
    }
  });
});

describe("the words the entries are drawn with are translated", () => {
  /*
   * The Dashboard looks a side-menu title up by its English text in each
   * locale file, and a missing key silently shows English. On-Call's entry,
   * "Archived Policies", is new with the move.
   */
  const LOCALES_DIR: string = path.join(
    FEATURE_SETS_DIR,
    "Dashboard",
    "src",
    "Locales",
  );
  const LOCALE_FILES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .sort();

  test.each([ADVANCED, "Archived", "Archived Policies"])(
    "%s is in every Dashboard locale, and translated outside English",
    (key: string) => {
      expect(LOCALE_FILES.length).toBeGreaterThanOrEqual(17);

      for (const file of LOCALE_FILES) {
        const locale: Record<string, unknown> = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
        ) as Record<string, unknown>;
        const value: unknown = locale[key];

        expect({ file, key, isText: typeof value === "string" }).toEqual({
          file,
          key,
          isText: true,
        });

        if (file === "en.json") {
          expect(value).toBe(key);
        } else {
          expect({ file, key, value, translated: true }).toEqual({
            file,
            key,
            value,
            translated: value !== key && (value as string).trim().length > 0,
          });
        }
      }
    },
  );
});

describe("the sweep finds the menus with archived entries", () => {
  // The workflow menu in the maintainer's screenshot, and one of each kind.
  test("finds the menus it has to check", () => {
    expect(
      MENUS_WITH_ARCHIVED.map((menu: MenuModule): string => {
        return menu.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Dashboard/src/Components/Network/NetworkSideMenu.tsx",
        "Dashboard/src/Pages/Inventory/SideMenu.tsx",
        "Dashboard/src/Pages/Monitor/SideMenu.tsx",
        "Dashboard/src/Pages/OnCallDuty/SideMenu.tsx",
        "Dashboard/src/Pages/Service/SideMenu.tsx",
        "Dashboard/src/Pages/Workflow/SideMenu.tsx",
      ]),
    );
    expect(MENUS_WITH_ARCHIVED.length).toBeGreaterThanOrEqual(23);
    expect(ARCHIVED_PAGES.length).toBeGreaterThanOrEqual(24);
  });

  /*
   * The source match above picks which menus get the checks. Rendering every
   * menu catches an entry it cannot see, such as one titled through a
   * constant.
   */
  test("every menu that renders an entry for archived things is checked", async () => {
    const rendersArchived: Array<string> = [];

    for (const menu of MENU_MODULES) {
      const reading: MenuReading = await readMenu(menu);

      if (reading.archivedEntries.length > 0) {
        rendersArchived.push(menu.name);
      }
    }

    expect(rendersArchived).toEqual(
      MENUS_WITH_ARCHIVED.map((menu: MenuModule): string => {
        return menu.name;
      }),
    );
  });
});
