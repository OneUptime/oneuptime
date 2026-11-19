// UX rule: Docs/ux/README.md#finding-a-page
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import {
  goTo,
  linksIn,
  PROJECT_ID,
  renderMenu,
  sectionTitlesInOrder,
} from "./SideMenuHarness";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import { slugifyPaletteCommandId } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import {
  getRecordPageSearchKinds,
  RecordPageSearchKind,
  RecordPageSearchPage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/RecordPageSearchIndex";
import { getRecordPageSearchModels } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/RecordPageSearchModels";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { PRODUCTS_IN_RESOURCES } from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductsInResources";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataSecurityResourceScope } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import { getEmptyProjectProductsAnswer } from "../../../Types/Product/ProjectProductsAnswer";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

/*
 * Search (Cmd/Ctrl+K) finds a record's own pages (#9204): a status page's
 * Settings, Single Sign-On, Subscribers or Branding, a monitor's Criteria, a
 * cluster's Pods.
 *
 * Search reads them from RecordPageSearchIndex.ts, because the menus are
 * React components that load data as they draw. This keeps the two in step,
 * as PageSearchIndexCoversMenus does for the pages that open without a
 * record: every side menu of the Dashboard is found on disk and drawn for
 * real with a record's id, and each page it links to for that record must be
 * in the index, under the menu's section and title. Then the real palette is
 * opened on the record's page and each page's title typed into it: the page
 * must be found, for that record. And off the record's page, "status page
 * sso" and "acme subscribers" must find the page for the records the
 * search answers with.
 *
 * Nothing is listed per menu: a page added to a record's menu is checked the
 * day it is written, and fails here until the index has it.
 */

jest.mock("react-i18next", () => {
  const nodeFs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const nodePath: typeof import("path") = jest.requireActual(
    "path",
  ) as typeof import("path");

  // The Dashboard's English: nested keys resolve to their words.
  const english: Record<string, unknown> = JSON.parse(
    nodeFs.readFileSync(
      nodePath.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const translate: (key: string, defaultValue?: unknown) => string = (
    key: string,
    defaultValue?: unknown,
  ): string => {
    if (typeof english[key] === "string") {
      return english[key] as string;
    }

    let value: unknown = english;

    for (const part of key.split(".")) {
      if (typeof value !== "object" || value === null) {
        value = undefined;
        break;
      }

      value = (value as Record<string, unknown>)[part];
    }

    if (typeof value === "string") {
      return value;
    }

    return typeof defaultValue === "string" ? defaultValue : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

/*
 * The records the search answers with: one per kind, named "Acme <kind>",
 * with a record's id. Badge counts are nothing; the open record is not read.
 */
const RECORD_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";
const listRequests: Array<{ modelType: unknown; query: unknown }> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (request: {
        modelType: unknown;
        query: unknown;
        select?: Record<string, unknown>;
      }): Promise<unknown> => {
        listRequests.push({
          modelType: request.modelType,
          query: request.query,
        });
        const row: Record<string, unknown> = { _id: RECORD_ID };

        for (const column of Object.keys(request.select || {})) {
          if (column !== "_id") {
            row[column] = "Acme Record";
          }
        }

        return Promise.resolve({ data: [row], count: 1, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
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
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

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

// A menu module renders the shared SideMenu (an item component only imports SideMenuItem).
const RENDERS_SIDE_MENU: RegExp =
  /from\s+"Common\/UI\/Components\/SideMenu\/SideMenu"/;

function sideMenuFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sideMenuFilesUnder(entryPath));
    } else if (
      entry.name.endsWith("SideMenu.tsx") &&
      RENDERS_SIDE_MENU.test(fs.readFileSync(entryPath, "utf8"))
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

const MENU_FILES: Array<string> = sideMenuFilesUnder(DASHBOARD_SRC).sort();
const MODEL_ID: ObjectID = new ObjectID(RECORD_ID);
const KINDS: Array<RecordPageSearchKind> = getRecordPageSearchKinds();

interface RecordPageLink {
  menu: string;
  section: string;
  title: string;
  href: string;
}

// Every RouteMap key, by the path it opens for the record in this project.
function getPageKeysByPath(): Map<string, Array<string>> {
  const byPath: Map<string, Array<string>> = new Map();

  for (const key of Object.keys(RouteMap)) {
    const routePath: string = RouteUtil.populateRouteParams(
      RouteMap[key] as Route,
      { modelId: MODEL_ID },
    ).toString();

    byPath.set(routePath, [...(byPath.get(routePath) || []), key]);
  }

  return byPath;
}

// The links of every menu that carry the record's id: the record's pages.
async function readRecordPageLinks(): Promise<Array<RecordPageLink>> {
  const links: Array<RecordPageLink> = [];

  for (const file of MENU_FILES) {
    const menu: string = path
      .relative(DASHBOARD_SRC, file)
      .split(path.sep)
      .join("/");

    const MenuComponent: FunctionComponent<Record<string, unknown>> = (
      jest.requireActual(file) as {
        default: FunctionComponent<Record<string, unknown>>;
      }
    ).default;

    goTo(`/dashboard/${PROJECT_ID}`);

    await renderMenu(
      <MenuComponent
        modelId={MODEL_ID}
        monitorType={MonitorType.Website}
        project={{ isFeatureFlagMonitorGroupsEnabled: true }}
      />,
    );

    for (const section of sectionTitlesInOrder()) {
      for (const link of linksIn(section)) {
        if (link.href.includes(MODEL_ID.toString())) {
          links.push({ menu, section, title: link.title, href: link.href });
        }
      }
    }

    cleanup();
  }

  return links;
}

let recordLinks: Array<RecordPageLink> = [];
let pageKeysByPath: Map<string, Array<string>> = new Map();

/*
 * A resource's menu draws another product's pages - its Security Events,
 * its Data Security and Compliance (#9547) - only in a project that uses
 * that product, for a reader who may read it, and Data Security's only for
 * a resource that holds a data store (ProductsInResources). The menus are
 * drawn, and Search opened, for such a project, reader and resource, so
 * those pages are held to the index as every other page is.
 */
function givenEveryProductInResources(): void {
  const usage: Partial<Record<ProductKey, ProductUsage>> = {};

  for (const product of PRODUCTS_IN_RESOURCES) {
    usage[product] = ProductUsage.InUse;
  }

  ProjectProducts.setFetcher(async () => {
    return { ...getEmptyProjectProductsAnswer(), usage };
  });
  ProjectProducts.setAnswer(PROJECT_ID, {
    ...getEmptyProjectProductsAnswer(),
    usage,
  });

  const check: typeof PermissionGate.check =
    PermissionGate.check.bind(PermissionGate);

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (
        ...args: Parameters<typeof PermissionGate.check>
      ): PermissionGateResult => {
        if (args[0] instanceof SecurityEvent || args[0] instanceof DataStore) {
          return { isAllowed: true };
        }

        return check(...args);
      },
    );

  jest
    .spyOn(DataSecurityApi, "getResourceScope")
    .mockImplementation(
      async (resource: {
        kind: DataStoreResourceKind;
        id: ObjectID;
      }): Promise<DataSecurityResourceScope> => {
        return {
          kind: resource.kind,
          id: resource.id.toString(),
          name: "Acme Record",
          dataStoreIds: [RECORD_ID],
          ownedDataStoreIds: [RECORD_ID],
          complianceOwner: null,
          isTruncated: false,
        };
      },
    );
}

beforeAll(async () => {
  givenEveryProductInResources();
  goTo(`/dashboard/${PROJECT_ID}`);
  recordLinks = await readRecordPageLinks();
  pageKeysByPath = getPageKeysByPath();
}, 300000);

afterAll(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
});

function getPageKeys(link: RecordPageLink): Array<string> {
  return pageKeysByPath.get(link.href.split("?")[0] || "") || [];
}

function getKindOfMenu(menu: string): RecordPageSearchKind | undefined {
  return KINDS.find((kind: RecordPageSearchKind): boolean => {
    return kind.menus.includes(menu);
  });
}

function getRecordPath(page: RecordPageSearchPage): string {
  return RouteUtil.populateRouteParams(RouteMap[page.page] as Route, {
    modelId: MODEL_ID,
  }).toString();
}

function openPaletteAt(pathname: string): void {
  cleanup();
  goTo(pathname);
  window.localStorage.setItem(
    `project_${PROJECT_ID}`,
    JSON.stringify({
      _id: PROJECT_ID,
      isFeatureFlagMonitorGroupsEnabled: true,
    }),
  );
  render(<DashboardCommandPalette />);
  act((): void => {
    GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
  });
}

function typeQuery(query: string): void {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: query },
  });
}

function shownOptionIds(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.getAttribute("data-testid") || "";
  });
}

function openRecordOptionId(
  kind: RecordPageSearchKind,
  page: RecordPageSearchPage,
): string {
  return `command-palette-option-${slugifyPaletteCommandId(
    "record-page",
    `${kind.id}-${RECORD_ID}-${page.page}`,
  )}`;
}

function recordPagesOptionId(kindId: string, pageKey: string): string {
  return `command-palette-option-record-pages-${kindId}-${RECORD_ID}-${pageKey}`;
}

// Types, then waits out the record search's debounce and its answer.
async function searchRecords(query: string): Promise<Array<string>> {
  typeQuery(query);

  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 260);
    });
  });

  return shownOptionIds();
}

/*
 * The record search's own requests, for the record pages': the record
 * search sends what was typed whole, this the name left once the page's
 * and the kind's words are out (or nothing, for any record of the kind).
 */
function recordPageRequests(
  typed: string,
): Array<{ modelType: unknown; query: unknown }> {
  return listRequests.filter(
    (request: { modelType: unknown; query: unknown }): boolean => {
      const search: { value?: string } | undefined = (
        request.query as Record<string, { value?: string }>
      )["_multiFieldSearch"];
      return !search || search.value !== typed;
    },
  );
}

function getKind(kindId: string): RecordPageSearchKind {
  return KINDS.find((kind: RecordPageSearchKind): boolean => {
    return kind.id === kindId;
  })!;
}

describe("the record page index matches the records' menus", () => {
  test("the sweep reads the record menus: every product with one, and hundreds of pages", () => {
    const menus: Set<string> = new Set(
      recordLinks.map((link: RecordPageLink): string => {
        return link.menu;
      }),
    );

    expect(menus.size).toBeGreaterThanOrEqual(45);
    expect(recordLinks.length).toBeGreaterThanOrEqual(600);
    expect(menus).toContain("Pages/StatusPages/View/SideMenu.tsx");
  });

  test("every menu that draws a record's pages is one kind's, and every kind's menu draws them", () => {
    const menus: Set<string> = new Set(
      recordLinks.map((link: RecordPageLink): string => {
        return link.menu;
      }),
    );

    const withoutKind: Array<string> = Array.from(menus).filter(
      (menu: string): boolean => {
        return (
          KINDS.filter((kind: RecordPageSearchKind): boolean => {
            return kind.menus.includes(menu);
          }).length !== 1
        );
      },
    );

    expect(withoutKind).toEqual([]);

    const stale: Array<string> = KINDS.flatMap(
      (kind: RecordPageSearchKind): Array<string> => {
        return kind.menus;
      },
    ).filter((menu: string): boolean => {
      return !menus.has(menu);
    });

    expect(stale).toEqual([]);
  });

  test("every page a record's menu links to is in its kind, under the menu's section and title", () => {
    const problems: Array<string> = [];

    for (const link of recordLinks) {
      const where: string = `${link.menu} > ${link.section} > ${link.title}`;
      const kind: RecordPageSearchKind | undefined = getKindOfMenu(link.menu);
      const keys: Array<string> = getPageKeys(link);
      const page: RecordPageSearchPage | undefined = kind?.pages.find(
        (candidate: RecordPageSearchPage): boolean => {
          return keys.includes(candidate.page);
        },
      );

      if (!page) {
        problems.push(`${where}: not in RecordPageSearchIndex.ts`);
        continue;
      }

      if (page.title !== link.title || page.section !== link.section) {
        problems.push(`${where}: indexed as ${page.section} > ${page.title}`);
      }

      const queryString: string = link.href.includes("?")
        ? link.href.slice(link.href.indexOf("?"))
        : "";

      if ((page.queryString || "") !== queryString) {
        problems.push(`${where}: opens with "${page.queryString || ""}"`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("the index has no page its menus no longer link to", () => {
    const linked: Set<string> = new Set<string>();

    for (const link of recordLinks) {
      for (const key of getPageKeys(link)) {
        linked.add(`${getKindOfMenu(link.menu)?.id}:${key}`);
      }
    }

    const stale: Array<string> = KINDS.flatMap(
      (kind: RecordPageSearchKind): Array<string> => {
        return kind.pages.map((page: RecordPageSearchPage): string => {
          return `${kind.id}:${page.page}`;
        });
      },
    ).filter((key: string): boolean => {
      return !linked.has(key);
    });

    expect(stale).toEqual([]);
  });
});

describe("on a record's page, Search finds its other pages by their names", () => {
  test("typing a page's menu title finds it for this record, placed the way the menu shows it", () => {
    const problems: Array<string> = [];

    for (const kind of KINDS) {
      openPaletteAt(getRecordPath(kind.pages[0]!));

      for (const page of kind.pages) {
        typeQuery(page.title);

        const where: string = `${kind.id} > ${page.section} > ${page.title}`;
        const optionId: string = openRecordOptionId(kind, page);

        if (!shownOptionIds().includes(optionId)) {
          problems.push(`${where}: not found by its title`);
          continue;
        }

        const option: HTMLElement = screen.getByTestId(optionId);

        if (!option.textContent?.includes(page.title)) {
          problems.push(`${where}: shown as "${option.textContent}"`);
        }

        const crumbs: string =
          screen.queryByTestId(`${optionId}-breadcrumb`)?.textContent || "";

        // The record, then the menu's section unless it is the page's name.
        if (!crumbs.includes(kind.recordName)) {
          problems.push(
            `${where}: breadcrumb "${crumbs}" leaves out the record`,
          );
        }

        if (page.section !== page.title && !crumbs.includes(page.section)) {
          problems.push(
            `${where}: breadcrumb "${crumbs}" leaves out the section`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  }, 300000);

  test("the issue's example: on a status page, sso, oidc and advanced settings open its pages", () => {
    const statusPage: RecordPageSearchKind = getKind("status-pages");
    openPaletteAt(getRecordPath(statusPage.pages[0]!));

    const byKey: (key: PageMap) => RecordPageSearchPage = (
      key: PageMap,
    ): RecordPageSearchPage => {
      return statusPage.pages.find((page: RecordPageSearchPage): boolean => {
        return page.page === key;
      })!;
    };

    for (const [query, key] of [
      ["sso", PageMap.STATUS_PAGE_VIEW_SSO],
      ["oidc", PageMap.STATUS_PAGE_VIEW_SSO],
      ["advanced settings", PageMap.STATUS_PAGE_VIEW_SETTINGS],
      ["sms subscribers", PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS],
      ["logo", PageMap.STATUS_PAGE_VIEW_BRANDING],
    ] as Array<[string, PageMap]>) {
      typeQuery(query);
      expect({ query, shown: shownOptionIds()[0] }).toEqual({
        query,
        shown: openRecordOptionId(statusPage, byKey(key)),
      });
    }
  });

  test("choosing one opens that page of this record", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    try {
      const statusPage: RecordPageSearchKind = getKind("status-pages");
      openPaletteAt(getRecordPath(statusPage.pages[0]!));
      typeQuery("single sign-on");
      fireEvent.click(screen.getByTestId(shownOptionIds()[0]!));

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0]![0]!.toString()).toBe(
        `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/sso`,
      );
    } finally {
      navigate.mockRestore();
    }
  });

  test("off a record's page, a page's name alone offers no record's page", () => {
    openPaletteAt(`/dashboard/${PROJECT_ID}/home`);
    typeQuery("Single Sign-On");

    expect(
      shownOptionIds().filter((id: string): boolean => {
        return id.includes("record-page");
      }),
    ).toEqual([]);
  });
});

describe("anywhere, a page's name with a record's finds it for the matching records", () => {
  test("status page sso: each status page's Single Sign-On, under the record", async () => {
    openPaletteAt(`/dashboard/${PROJECT_ID}/home`);
    listRequests.length = 0;

    const shown: Array<string> = await searchRecords("status page sso");
    const optionId: string = recordPagesOptionId(
      "status-pages",
      PageMap.STATUS_PAGE_VIEW_SSO,
    );

    expect(shown).toContain(optionId);
    expect(screen.getByTestId(optionId).textContent).toContain(
      "Single Sign-On",
    );
    expect(screen.getByTestId(`${optionId}-breadcrumb`).textContent).toContain(
      "Acme Record",
    );
    // One kind was named, so one kind was looked up.
    expect(recordPageRequests("status page sso")).toHaveLength(1);
  });

  test("<page name> subscribers: the records named so are looked up by that name", async () => {
    openPaletteAt(`/dashboard/${PROJECT_ID}/home`);
    listRequests.length = 0;

    const shown: Array<string> = await searchRecords("acme subscribers");

    expect(shown).toContain(
      recordPagesOptionId("status-pages", PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS),
    );
    const requests: Array<{ modelType: unknown; query: unknown }> =
      recordPageRequests("acme subscribers");
    expect(requests).toHaveLength(1);
    expect(
      (requests[0]!.query as Record<string, { value?: string }>)[
        "_multiFieldSearch"
      ]?.value,
    ).toBe("acme");
  });

  test("old names find the renamed pages", async () => {
    openPaletteAt(`/dashboard/${PROJECT_ID}/home`);

    expect(await searchRecords("status page advanced settings")).toContain(
      recordPagesOptionId("status-pages", PageMap.STATUS_PAGE_VIEW_SETTINGS),
    );
    expect(await searchRecords("status page oidc")).toContain(
      recordPagesOptionId("status-pages", PageMap.STATUS_PAGE_VIEW_SSO),
    );
    expect(await searchRecords("dashboard delete")).toContain(
      recordPagesOptionId("dashboards", PageMap.DASHBOARD_VIEW_DELETE),
    );
  });

  test("it stays bounded: a page many kinds have looks up a few kinds", async () => {
    openPaletteAt(`/dashboard/${PROJECT_ID}/home`);
    listRequests.length = 0;

    await searchRecords("acme settings");

    const requests: number = recordPageRequests("acme settings").length;
    expect(requests).toBeGreaterThan(0);
    expect(requests).toBeLessThanOrEqual(4);
  });

  test("every kind looked up is found by what one is called and a page's title", async () => {
    openPaletteAt(`/dashboard/${PROJECT_ID}/home`);
    const problems: Array<string> = [];
    const models: ReturnType<typeof getRecordPageSearchModels> =
      getRecordPageSearchModels();

    for (const kind of KINDS) {
      if (!models.has(kind.id)) {
        continue;
      }

      // A page of its own, past the Overview every kind has.
      const page: RecordPageSearchPage = kind.pages[1] || kind.pages[0]!;
      const query: string = `${kind.recordName} ${page.title}`;
      const shown: Array<string> = await searchRecords(query);

      if (!shown.includes(recordPagesOptionId(kind.id, page.page))) {
        problems.push(`${kind.id}: "${query}" does not offer ${page.page}`);
      }
    }

    expect(problems).toEqual([]);
  }, 120000);
});
