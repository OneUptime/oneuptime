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
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import { AUDIT_LOG_ROOT_RESOURCE_TABLES } from "../../../Types/AuditLog/AuditLogCoverage";
import Link from "../../../Types/Link";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import { RESOURCE_META } from "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import {
  CloudResourceViewTab,
  ENVIRONMENT_VIEW_PAGES,
  RESOURCE_VIEW_PAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CloudResourceViewPages";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { getApiSingularName } from "../../../Utils/ModelApiName";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  allLinks,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * EVERY RESOURCE'S VIEW MENU HAS AN AUDIT LOGS PAGE (issue #6246).
 *
 * Every project-scoped model is audited (#6187), and a resource's Audit Logs
 * page lists its own entries and those of what belongs to it. A resource
 * whose page has no Audit Logs item keeps its history only in Project
 * Settings > Audit Logs, mixed with everything else - as network devices,
 * forms, cloud accounts, exceptions and a dozen more did.
 *
 * So every resource's view menu in the Dashboard (a menu that takes the id
 * of the resource it belongs to) is found on disk and drawn. Each has one
 * Audit Logs item: a tab of its own resource (…/<id>/audit-logs), right
 * before the Delete item in the section that holds it - or last in its
 * section, for a resource nobody deletes from its page - lit, and its
 * section open, on its page; and the resource is one the audit log rolls
 * entries up to, drawn and linked in the project-wide log. Or the menu is
 * listed below, with the reason it has none, and the reason is checked.
 *
 * A view menu added tomorrow fails here until it has one.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

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

const AUDIT_LOGS_TITLE: string = "Audit Logs";

/*
 * Why a resource's view menu has no Audit Logs page. Each reason is checked,
 * not only stated.
 */
type NoAuditLogsReason =
  // Its records are not audited: there is nothing to list.
  | { kind: "NotAudited"; model: { new (): BaseModel }; why: string }
  // Another product's read-only view of a record whose page has one.
  | { kind: "ReadOnlyViewOf"; menu: string; page: PageMap; why: string }
  // No layout draws it.
  | { kind: "DrawnNowhere"; why: string };

const VIEW_MENUS_WITHOUT_AUDIT_LOGS: Readonly<
  Record<string, NoAuditLogsReason>
> = {
  "Pages/AIInsights/View/SideMenu.tsx": {
    kind: "NotAudited",
    model: AIInsight,
    why: "An AI insight is what OneUptime AI finds, rewritten as it finds more - nobody changes one - so it is not audited (What agents and telemetry report, AuditLogCoverage).",
  },
  "Pages/Users/View/SideMenu.tsx": {
    kind: "NotAudited",
    model: User,
    why: "A person is not one project's record, so is not audited: who added them to a team or took them off it is on that team's Audit Logs page, and their own notification setup is theirs alone.",
  },
  "Pages/DataObservability/View/SideMenu.tsx": {
    kind: "ReadOnlyViewOf",
    menu: "Pages/DataSecurity/StoreView/SideMenu.tsx",
    page: PageMap.DATA_SECURITY_STORE_VIEW_AUDIT_LOGS,
    why: "A database here is Data Security's data store, read through Data Observability's own route: nothing about it is changed from these pages, and its history is on its Audit Logs page in Data Security.",
  },
  "Pages/StatusPages/View/AnnouncementSideMenu.tsx": {
    kind: "DrawnNowhere",
    why: "Rendered by no layout: an announcement's pages use Pages/StatusPages/AnnouncementSideMenu.tsx, which has the page.",
  },
};

/*
 * The view pages of a resource drawn in a second product: an App Platforms
 * environment is a CloudResource row, as a cloud resource is, and its
 * project-wide entries open Cloud's page, which forwards it to App
 * Platforms (Utils/CloudResourceViewPages).
 */
const SECOND_PRODUCT_VIEWS: Readonly<Record<string, string>> = {
  [PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW]: "Cloud Resource",
};

const RENDERS_SIDE_MENU: RegExp =
  /from\s+"Common\/UI\/Components\/SideMenu\/SideMenu"/;

// A resource's view menu takes the id of the resource it belongs to.
const TAKES_MODEL_ID: RegExp = /modelId:\s*ObjectID/;

const TYPESCRIPT_SOURCE: RegExp = /\.tsx?$/;

// The pages through which a menu changes or deletes its record.
const CHANGES_THE_RECORD: RegExp = /\/(settings|owners|delete)$/;

function sourceFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(entryPath));
    } else if (TYPESCRIPT_SOURCE.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const SOURCE_FILES: ReadonlyArray<string> = sourceFilesUnder(DASHBOARD_SRC);

interface ViewMenu {
  // Relative to Dashboard/src, e.g. "Pages/Workflow/View/SideMenu.tsx".
  name: string;
  file: string;
}

const VIEW_MENUS: ReadonlyArray<ViewMenu> = SOURCE_FILES.filter(
  (file: string): boolean => {
    if (!path.basename(file).endsWith("SideMenu.tsx")) {
      return false;
    }

    const source: string = fs.readFileSync(file, "utf8");

    return RENDERS_SIDE_MENU.test(source) && TAKES_MODEL_ID.test(source);
  },
)
  .map((file: string): ViewMenu => {
    return {
      name: path.relative(DASHBOARD_SRC, file).split(path.sep).join("/"),
      file,
    };
  })
  .sort((a: ViewMenu, b: ViewMenu): number => {
    return a.name.localeCompare(b.name);
  });

const VIEW_MENUS_WITH_AUDIT_LOGS: ReadonlyArray<ViewMenu> = VIEW_MENUS.filter(
  (menu: ViewMenu): boolean => {
    return !VIEW_MENUS_WITHOUT_AUDIT_LOGS[menu.name];
  },
);

function menuNamed(name: string): ViewMenu {
  const menu: ViewMenu | undefined = VIEW_MENUS.find(
    (candidate: ViewMenu): boolean => {
      return candidate.name === name;
    },
  );

  if (!menu) {
    throw new Error(`No view menu ${name}`);
  }

  return menu;
}

const MODEL_ID: ObjectID = new ObjectID("0193c0de-4444-4aaa-8bbb-000000000046");

const MENU_PROPS: Record<string, unknown> = {
  modelId: MODEL_ID,
  monitorType: MonitorType.Website,
};

const PROJECT_HOME: string = `/dashboard/${PROJECT_ID}`;

async function renderMenuAt(
  menu: ViewMenu,
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

function hrefOf(page: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: MODEL_ID,
  }).toString();
}

/*
 * Every Audit Logs page of a resource's view, by the address it has for
 * MODEL_ID in the project the test is on (read once it is on one).
 */
function auditLogsPages(): Array<{ key: string; href: string }> {
  return Object.keys(RouteMap)
    .filter((key: string): boolean => {
      return key.endsWith("_AUDIT_LOGS") && key !== PageMap.SETTINGS_AUDIT_LOGS;
    })
    .map((key: string): { key: string; href: string } => {
      return { key, href: hrefOf(key) };
    });
}

// The section that holds a link, and the links beside it.
function sectionOf(href: string): { title: string; links: Array<MenuLink> } {
  for (const title of sectionTitlesInOrder()) {
    const links: Array<MenuLink> = linksIn(title);

    if (
      links.some((link: MenuLink): boolean => {
        return link.href === href;
      })
    ) {
      return { title, links };
    }
  }

  throw new Error(`No section holds ${href}`);
}

const ROOT_TYPES: ReadonlySet<string> = new Set<string>(
  (AllModelTypes as Array<{ new (): BaseModel }>)
    .map((modelType: { new (): BaseModel }): BaseModel => {
      return new modelType();
    })
    .filter((model: BaseModel): boolean => {
      return AUDIT_LOG_ROOT_RESOURCE_TABLES.has(model.tableName as string);
    })
    .map((model: BaseModel): string => {
      // The type entries are stored under: a renamed model's kept API name.
      return getApiSingularName(model);
    }),
);

// The resource type whose project-wide entries open this view page.
function resourceTypeOfView(view: string): string | undefined {
  if (SECOND_PRODUCT_VIEWS[view]) {
    return SECOND_PRODUCT_VIEWS[view];
  }

  return Object.keys(RESOURCE_META).find((type: string): boolean => {
    return RESOURCE_META[type]!.viewRoute === view;
  });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(PROJECT_HOME);
});

afterEach(() => {
  cleanup();
});

describe("every resource's view menu has an Audit Logs page", () => {
  test.each(
    VIEW_MENUS_WITH_AUDIT_LOGS.map((menu: ViewMenu): [string, ViewMenu] => {
      return [menu.name, menu];
    }),
  )(
    "%s: one Audit Logs item, its resource's own, right before Delete",
    async (_name: string, menu: ViewMenu) => {
      await renderMenuAt(menu, PROJECT_HOME);

      const items: Array<MenuLink> = allLinks().filter(
        (link: MenuLink): boolean => {
          return link.title === AUDIT_LOGS_TITLE;
        },
      );

      expect({ menu: menu.name, items: items.length }).toEqual({
        menu: menu.name,
        items: 1,
      });

      const href: string = items[0]!.href;

      // A tab of this resource: …/<its id>/audit-logs, fully populated.
      expect(href).toMatch(
        new RegExp(
          `^/dashboard/${PROJECT_ID}/.+/${MODEL_ID.toString()}/audit-logs$`,
        ),
      );

      // Before the Delete item, in its section; else last in its section.
      const section: { title: string; links: Array<MenuLink> } =
        sectionOf(href);
      const at: number = section.links.findIndex((link: MenuLink): boolean => {
        return link.href === href;
      });
      const deleteLink: MenuLink | undefined = allLinks().find(
        (link: MenuLink): boolean => {
          return link.href.endsWith("/delete");
        },
      );

      if (deleteLink) {
        expect({ menu: menu.name, next: section.links[at + 1] }).toEqual({
          menu: menu.name,
          next: deleteLink,
        });
        expect(deleteLink.href).toBe(href.replace(/\/audit-logs$/, "/delete"));
      } else {
        expect({ menu: menu.name, last: at }).toEqual({
          menu: menu.name,
          last: section.links.length - 1,
        });
      }
    },
  );

  test.each(
    VIEW_MENUS_WITH_AUDIT_LOGS.map((menu: ViewMenu): [string, ViewMenu] => {
      return [menu.name, menu];
    }),
  )(
    "%s: its page is a resource the log rolls entries up to, drawn and linked in the project's log",
    async (_name: string, menu: ViewMenu) => {
      await renderMenuAt(menu, PROJECT_HOME);

      const href: string = allLinks().find((link: MenuLink): boolean => {
        return link.title === AUDIT_LOGS_TITLE;
      })!.href;
      const pages: Array<string> = auditLogsPages()
        .filter((page: { key: string; href: string }): boolean => {
          return page.href === href;
        })
        .map((page: { key: string; href: string }): string => {
          return page.key;
        });

      expect({ menu: menu.name, pages: pages.length }).toEqual({
        menu: menu.name,
        pages: 1,
      });

      const view: string = pages[0]!.replace(/_AUDIT_LOGS$/, "");
      const type: string | undefined = resourceTypeOfView(view);

      expect({ menu: menu.name, view, type: Boolean(type) }).toEqual({
        menu: menu.name,
        view,
        type: true,
      });
      expect({ menu: menu.name, type, root: ROOT_TYPES.has(type!) }).toEqual({
        menu: menu.name,
        type,
        root: true,
      });
    },
  );

  test.each(
    VIEW_MENUS_WITH_AUDIT_LOGS.map((menu: ViewMenu): [string, ViewMenu] => {
      return [menu.name, menu];
    }),
  )(
    "%s: on its own page the item is lit and its section open",
    async (_name: string, menu: ViewMenu) => {
      await renderMenuAt(menu, PROJECT_HOME);

      const href: string = allLinks().find((link: MenuLink): boolean => {
        return link.title === AUDIT_LOGS_TITLE;
      })!.href;
      const sectionTitle: string = sectionOf(href).title;

      cleanup();
      await renderMenuAt(menu, href);

      expect({ menu: menu.name, lit: activeLinkTitles() }).toEqual({
        menu: menu.name,
        lit: [AUDIT_LOGS_TITLE],
      });
      expect({ menu: menu.name, open: isExpanded(sectionTitle) }).toEqual({
        menu: menu.name,
        open: true,
      });
    },
  );

  test("the sweep finds the view menus (it is not vacuous)", () => {
    expect(
      VIEW_MENUS_WITH_AUDIT_LOGS.map((menu: ViewMenu): string => {
        return menu.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Pages/Monitor/View/SideMenu.tsx",
        "Pages/NetworkDevice/View/SideMenu.tsx",
        "Pages/NetworkSite/View/SideMenu.tsx",
        "Pages/Forms/View/SideMenu.tsx",
        "Pages/Cloud/Accounts/View/SideMenu.tsx",
        "Pages/Cloud/View/SideMenu.tsx",
        "Pages/AppPlatforms/View/SideMenu.tsx",
        "Pages/Serverless/View/SideMenu.tsx",
        "Pages/DataObservability/TableView/SideMenu.tsx",
        "Pages/DataPipeline/View/SideMenu.tsx",
        "Pages/DataProduct/View/SideMenu.tsx",
        "Pages/Exceptions/View/SideMenu.tsx",
        "Pages/DataSecurity/StoreView/SideMenu.tsx",
        "Pages/DataSecurity/IssueView/SideMenu.tsx",
        "Pages/Code/Repository/SideMenu.tsx",
        "Pages/StatusPages/AnnouncementSideMenu.tsx",
        "Pages/SecurityEvents/CaseView/SideMenu.tsx",
      ]),
    );
    expect(VIEW_MENUS_WITH_AUDIT_LOGS.length).toBeGreaterThanOrEqual(48);
  });
});

describe("the view menus without one", () => {
  test.each(Object.keys(VIEW_MENUS_WITHOUT_AUDIT_LOGS))(
    "%s is a real view menu, with a reason, and no Audit Logs item",
    async (name: string) => {
      const reason: NoAuditLogsReason = VIEW_MENUS_WITHOUT_AUDIT_LOGS[name]!;

      expect(reason.why.length).toBeGreaterThan(40);

      await renderMenuAt(menuNamed(name), PROJECT_HOME);

      expect(
        allLinks().filter((link: MenuLink): boolean => {
          return link.title === AUDIT_LOGS_TITLE;
        }),
      ).toEqual([]);
    },
  );

  test.each(
    Object.keys(VIEW_MENUS_WITHOUT_AUDIT_LOGS).filter(
      (name: string): boolean => {
        return VIEW_MENUS_WITHOUT_AUDIT_LOGS[name]!.kind === "NotAudited";
      },
    ),
  )("%s: its records are not audited", (name: string) => {
    const reason: NoAuditLogsReason = VIEW_MENUS_WITHOUT_AUDIT_LOGS[name]!;

    if (reason.kind !== "NotAudited") {
      throw new Error(name);
    }

    expect(new reason.model().enableAuditLogOn).toBeUndefined();
  });

  test.each(
    Object.keys(VIEW_MENUS_WITHOUT_AUDIT_LOGS).filter(
      (name: string): boolean => {
        return VIEW_MENUS_WITHOUT_AUDIT_LOGS[name]!.kind === "ReadOnlyViewOf";
      },
    ),
  )(
    "%s: the record's own page in its product has the Audit Logs page",
    async (name: string) => {
      const reason: NoAuditLogsReason = VIEW_MENUS_WITHOUT_AUDIT_LOGS[name]!;

      if (reason.kind !== "ReadOnlyViewOf") {
        throw new Error(name);
      }

      // Read-only: nothing on its menu changes or deletes the record.
      await renderMenuAt(menuNamed(name), PROJECT_HOME);
      expect(
        allLinks().filter((link: MenuLink): boolean => {
          return CHANGES_THE_RECORD.test(link.href);
        }),
      ).toEqual([]);
      cleanup();

      await renderMenuAt(menuNamed(reason.menu), PROJECT_HOME);
      expect(
        allLinks().find((link: MenuLink): boolean => {
          return link.title === AUDIT_LOGS_TITLE;
        })?.href,
      ).toBe(hrefOf(reason.page));
    },
  );

  test.each(
    Object.keys(VIEW_MENUS_WITHOUT_AUDIT_LOGS).filter(
      (name: string): boolean => {
        return VIEW_MENUS_WITHOUT_AUDIT_LOGS[name]!.kind === "DrawnNowhere";
      },
    ),
  )("%s: no file imports it", (name: string) => {
    const target: string = path.join(DASHBOARD_SRC, name);
    const importers: Array<string> = SOURCE_FILES.filter(
      (file: string): boolean => {
        const source: string = fs.readFileSync(file, "utf8");

        return Array.from(source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)).some(
          (match: RegExpMatchArray): boolean => {
            const resolved: string = path.resolve(
              path.dirname(file),
              match[1]!,
            );

            return resolved === target.replace(/\.tsx$/, "");
          },
        );
      },
    );

    expect(importers).toEqual([]);
  });

  test("a second product's view of a resource is that resource's, in both products", () => {
    expect(ENVIRONMENT_VIEW_PAGES[CloudResourceViewTab.Overview]).toBe(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    );
    expect(RESOURCE_META["Cloud Resource"]!.viewRoute).toBe(
      RESOURCE_VIEW_PAGES[CloudResourceViewTab.Overview],
    );
    expect(ENVIRONMENT_VIEW_PAGES[CloudResourceViewTab.AuditLogs]).toBe(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_AUDIT_LOGS,
    );
    expect(RESOURCE_VIEW_PAGES[CloudResourceViewTab.AuditLogs]).toBe(
      PageMap.CLOUD_RESOURCE_VIEW_AUDIT_LOGS,
    );
  });
});
