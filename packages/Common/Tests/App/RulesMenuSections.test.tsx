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
import { isTitleCollapsedByDefault } from "../../UI/Components/SideMenu/SideMenuSectionState";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./Dashboard/SideMenuHarness";

/*
 * "Create a new section for rules and have monitor rules there. The section
 * should be collapsed by default" (the maintainer, of a status page's menu,
 * where Monitor Rules sat in the open Resources section).
 *
 * Every Dashboard side menu is found on disk and rendered for real. Across
 * all of them:
 *
 *  - Monitor Rules, and an SLO's Burn Rate Rules beside it, always sit in a
 *    section titled Rules - on a status page's menu, on an SLO's, and on any
 *    menu that lists them later - never beside the everyday pages of the
 *    resource;
 *  - a Rules section holds rules pages only;
 *  - a Rules section is folded down to its title on the page its menu opens
 *    to, and opens by itself on each of its pages, with that page marked.
 *
 * Product menus' Owner Rules and Label Rules sit in their (folded) Settings
 * sections, beside the other settings of the product, and an on-call
 * policy's Escalation Rules are the policy itself: those are not held here.
 */

// Rules pages that live in a Rules section wherever a menu lists them.
const RULES_PAGES_UNDER_RULES: ReadonlyArray<string> = [
  "Monitor Rules",
  "Burn Rate Rules",
];

const RULES_SECTION_TITLE: string = "Rules";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
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

const DASHBOARD_SOURCE_DIR: string = path.join(
  FEATURE_SETS_DIR,
  "Dashboard",
  "src",
);

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
  // Relative to packages/App/FeatureSet, e.g. "Dashboard/src/Pages/Slo/View/SideMenu.tsx".
  name: string;
  file: string;
}

const MENU_MODULES: ReadonlyArray<MenuModule> = sourceFilesUnder(
  DASHBOARD_SOURCE_DIR,
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

const MODEL_ID: ObjectID = new ObjectID("0193c0de-4444-4aaa-8bbb-0000000000e1");

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
  menu: string;
  // The page the menu opens to: its first entry.
  landing: string | undefined;
  sections: Array<SectionReading>;
}

// The menu's sections and their links, as drawn inside the project.
async function readMenu(menu: MenuModule): Promise<MenuReading> {
  await renderMenuModuleAt(menu, PROJECT_HOME);

  const sections: Array<SectionReading> = sectionTitlesInOrder().map(
    (title: string): SectionReading => {
      return { title, links: linksIn(title) };
    },
  );

  cleanup();

  return {
    menu: menu.name,
    landing: sections.flatMap((section: SectionReading): Array<MenuLink> => {
      return section.links;
    })[0]?.href,
    sections,
  };
}

let menuReadings: Array<MenuReading> | null = null;

// Every Dashboard menu, read once for the whole suite.
async function allMenuReadings(): Promise<Array<MenuReading>> {
  if (!menuReadings) {
    const readings: Array<MenuReading> = [];

    for (const menu of MENU_MODULES) {
      readings.push(await readMenu(menu));
    }

    menuReadings = readings;
  }

  return menuReadings;
}

function moduleNamed(name: string): MenuModule {
  const menu: MenuModule | undefined = MENU_MODULES.find(
    (candidate: MenuModule): boolean => {
      return candidate.name === name;
    },
  );

  expect({ name, found: Boolean(menu) }).toEqual({ name, found: true });

  return menu as MenuModule;
}

interface PlacedRulesPage {
  menu: string;
  page: string;
  section: string;
}

// Where every Monitor Rules or Burn Rate Rules entry of every menu sits.
function placedRulesPages(
  readings: Array<MenuReading>,
): Array<PlacedRulesPage> {
  return readings.flatMap((reading: MenuReading): Array<PlacedRulesPage> => {
    return reading.sections.flatMap(
      (section: SectionReading): Array<PlacedRulesPage> => {
        return section.links
          .filter((link: MenuLink): boolean => {
            return RULES_PAGES_UNDER_RULES.includes(link.title);
          })
          .map((link: MenuLink): PlacedRulesPage => {
            return {
              menu: reading.menu,
              page: link.title,
              section: section.title,
            };
          });
      },
    );
  });
}

function rulesSectionOf(reading: MenuReading): SectionReading | undefined {
  return reading.sections.find((section: SectionReading): boolean => {
    return section.title === RULES_SECTION_TITLE;
  });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(PROJECT_HOME);
});

afterEach(() => {
  cleanup();
});

describe("rules pages sit in a Rules section", () => {
  test("the menus are found on disk, the status page's and the SLO's among them", () => {
    expect(MENU_MODULES.length).toBeGreaterThan(50);
    moduleNamed("Dashboard/src/Pages/StatusPages/View/SideMenu.tsx");
    moduleNamed("Dashboard/src/Pages/Slo/View/SideMenu.tsx");
  });

  test("a Rules section folds by its title in every menu", () => {
    expect(isTitleCollapsedByDefault(RULES_SECTION_TITLE)).toBe(true);
  });

  test("Monitor Rules and Burn Rate Rules are under Rules in every menu that lists them", async () => {
    const placed: Array<PlacedRulesPage> = placedRulesPages(
      await allMenuReadings(),
    );

    // Today's menus, so the sweep is known to have found them.
    expect(placed).toEqual(
      expect.arrayContaining([
        {
          menu: "Dashboard/src/Pages/Slo/View/SideMenu.tsx",
          page: "Monitor Rules",
          section: RULES_SECTION_TITLE,
        },
        {
          menu: "Dashboard/src/Pages/Slo/View/SideMenu.tsx",
          page: "Burn Rate Rules",
          section: RULES_SECTION_TITLE,
        },
        {
          menu: "Dashboard/src/Pages/StatusPages/View/SideMenu.tsx",
          page: "Monitor Rules",
          section: RULES_SECTION_TITLE,
        },
      ]),
    );

    const elsewhere: Array<PlacedRulesPage> = placed.filter(
      (entry: PlacedRulesPage): boolean => {
        return entry.section !== RULES_SECTION_TITLE;
      },
    );

    /*
     * A Monitor Rules or Burn Rate Rules entry outside a Rules section: move
     * it into the menu's Rules section (add one, titled "Rules", if the menu
     * has none - it folds by its title).
     */
    expect(elsewhere).toEqual([]);
  });

  test("a Rules section holds rules pages only", async () => {
    const strays: Array<{ menu: string; page: string }> = [];

    for (const reading of await allMenuReadings()) {
      const rules: SectionReading | undefined = rulesSectionOf(reading);

      for (const link of rules?.links || []) {
        if (!link.title.endsWith(" Rules")) {
          strays.push({ menu: reading.menu, page: link.title });
        }
      }
    }

    expect(strays).toEqual([]);
  });
});

describe("a Rules section is folded until it is needed", () => {
  test("on the page its menu opens to, every Rules section is folded down to its title", async () => {
    const withRules: Array<MenuReading> = (await allMenuReadings()).filter(
      (reading: MenuReading): boolean => {
        return Boolean(rulesSectionOf(reading)) && Boolean(reading.landing);
      },
    );

    // The status page's and the SLO's, and the product menus with rules.
    expect(
      withRules.map((reading: MenuReading): string => {
        return reading.menu;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Dashboard/src/Pages/Slo/View/SideMenu.tsx",
        "Dashboard/src/Pages/StatusPages/View/SideMenu.tsx",
        "Dashboard/src/Pages/Incidents/SideMenu.tsx",
        "Dashboard/src/Pages/Alerts/SideMenu.tsx",
        "Dashboard/src/Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
        "Dashboard/src/Components/Network/NetworkSideMenu.tsx",
      ]),
    );

    for (const reading of withRules) {
      await renderMenuModuleAt(
        moduleNamed(reading.menu),
        reading.landing as string,
      );

      expect({
        menu: reading.menu,
        expanded: isExpanded(RULES_SECTION_TITLE),
      }).toEqual({ menu: reading.menu, expanded: false });
      expect(sectionBody(RULES_SECTION_TITLE)).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );

      cleanup();
    }
  });

  test("a Rules section opens by itself on each of its pages, with that page marked", async () => {
    for (const reading of await allMenuReadings()) {
      const rules: SectionReading | undefined = rulesSectionOf(reading);

      for (const link of rules?.links || []) {
        await renderMenuModuleAt(moduleNamed(reading.menu), link.href);

        expect({
          menu: reading.menu,
          page: link.title,
          expanded: isExpanded(RULES_SECTION_TITLE),
          marked: activeLinkTitles(),
        }).toEqual({
          menu: reading.menu,
          page: link.title,
          expanded: true,
          marked: [link.title],
        });
        expect(sectionBody(RULES_SECTION_TITLE)).not.toHaveClass("invisible");

        cleanup();
      }
    }
  });
});
