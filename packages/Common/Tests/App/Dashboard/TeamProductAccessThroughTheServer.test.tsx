import {
  afterAll,
  afterEach,
  beforeAll,
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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import type { Mock } from "jest-mock";
import path from "path";
import * as React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

/*
 * A TEAM'S PRODUCT ACCESS, ANSWERED BY THE SERVER ITSELF (#10289).
 *
 * "Admin of Cloud, view-only on Network Monitoring, nothing on App
 * Platforms." The team's Permissions page gives a team one level per
 * product on the Product Access card. Here the card runs against the
 * server's own TeamPermission routes (BaseAPI) over HTTP - its grant
 * ceiling, its hooks, its error handler - with the tables in memory
 * (DashboardRequestsOverHttp), and a real i18next reading the Dashboard's
 * real locale files:
 *
 *   - every product with levels is a row, in the products menu's groups and
 *     names, showing the level the team holds of it; a product the project
 *     hides waits behind Show All Products, unless the team holds
 *     something of it;
 *   - a pick saves at once: the new level's row is given, then the old one
 *     taken away, the team holding one level of the product, and the row
 *     says "Saved"; clearing the list takes the product away;
 *   - a level the reader may not give is listed, cannot be picked, and says
 *     why; one the page offered by mistake is refused by the server, said,
 *     and nothing is written;
 *   - who may not change the team's permissions reads each level, with
 *     why;
 *   - what the card does not change is said under the product's name: a
 *     level through a custom role, one for some records only, a block;
 *   - a level changed in the permissions table is drawn again;
 *   - in German, the card reads in German.
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import TeamProductAccess, {
  getTeamProductAccessRowTestId,
  TEAM_PRODUCT_ACCESS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamProductAccess";
import {
  LEVEL_BLOCKED_SOMEWHERE,
  LEVEL_DESCRIPTIONS,
  LEVEL_FROM_CUSTOM_ROLE,
  LEVEL_LIMITED_SOMEWHERE,
  LEVEL_NOT_YOURS_TO_GIVE,
  PRODUCT_ACCESS_TITLE,
  SHOW_ALL_PRODUCTS,
  SHOW_FEWER_PRODUCTS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamProductAccessWords";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LabelService from "../../../Server/Services/LabelService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import { PRODUCTS_WITH_LEVELS } from "../../../Types/Product/ProductLevels";
import { getEmptyProjectProductsAnswer } from "../../../Types/Product/ProjectProductsAnswer";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../Server/TestingUtils/ServerProductsOn";

const PROJECT_ID: string = "10289000-0000-4000-8000-000000000301";
const TEAM_ID: string = "10289000-0000-4000-8000-0000000003b1";
const OTHER_TEAM_ID: string = "10289000-0000-4000-8000-0000000003b2";
const LABEL_ID: string = "10289000-0000-4000-8000-0000000003c1";

const WAIT: { timeout: number } = { timeout: 15000 };

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

const readLocale: (code: string) => LocaleData = (code: string): LocaleData => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
};

const ENGLISH: LocaleData = readLocale("en");
const GERMAN: LocaleData = readLocale("de");

const translation: i18n = createInstance();

const asService: (service: unknown) => DatabaseService<BaseModel> = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let permissions: InMemoryTable;

// The reader's permission rows, as the tab keeps them.
function userRow(
  permission: Permission,
  extra: Partial<UserPermission> = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...extra,
  };
}

/*
 * Signs the reader in: what the server holds them to, and the snapshot the
 * page reads its locks from. `pageThinks` is a snapshot the page read before
 * it changed: what the page offers, not what the server allows.
 */
function signInAs(
  held: Array<Permission>,
  pageThinks: Array<Permission> = held,
): void {
  caller = {
    ...customDomainCaller({
      permissions: [Permission.ProjectUser, ...held],
      projectId: new ObjectID(PROJECT_ID),
    }),
    ...ON_HIGHEST_PLAN,
  };

  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [
      userRow(Permission.CurrentUser),
      userRow(Permission.ProjectUser),
      ...pageThinks.map((permission: Permission): UserPermission => {
        return userRow(permission);
      }),
    ],
  });
  PermissionGate.clearPermissionPropsCache();
}

// One of the team's permission rows, as the server stores it.
function teamRow(
  id: string,
  permission: Permission,
  extra: StoredRow = {},
): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    permission: permission,
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...extra,
  };
}

// The teams, as a permission row joins one: its delete reads isPermissionsEditable.
const TEAMS: Record<string, StoredRow> = {
  [TEAM_ID]: { _id: TEAM_ID, isPermissionsEditable: true },
  [OTHER_TEAM_ID]: { _id: OTHER_TEAM_ID, isPermissionsEditable: true },
};

// Every row joins its team by teamId, as Postgres joins it, the card's own too.
function joinTeams(): void {
  for (const row of permissions.rows) {
    row["team"] = row["team"] || TEAMS[String(row["teamId"])];
  }
}

function seed(rows: Array<StoredRow>): void {
  permissions = useInMemoryTable(asService(TeamPermissionService), rows);
  joinTeams();

  const save: (...args: Array<unknown>) => Promise<unknown> =
    permissions.repository.save.getMockImplementation() as (
      ...args: Array<unknown>
    ) => Promise<unknown>;

  permissions.repository.save.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const result: unknown = await save(...args);
      joinTeams();
      return result;
    },
  );

  useInMemoryTable(asService(TeamService), [
    {
      _id: TEAM_ID,
      projectId: PROJECT_ID,
      name: "Platform",
      isPermissionsEditable: true,
    },
    {
      _id: OTHER_TEAM_ID,
      projectId: PROJECT_ID,
      name: "Support",
      isPermissionsEditable: true,
    },
  ]);
  useInMemoryTable(asService(TeamMemberService), []);
  useInMemoryTable(asService(LabelService), [
    { _id: LABEL_ID, projectId: PROJECT_ID, name: "EU" },
  ]);
}

// The permissions the team holds now, of the products' levels: what the card wrote.
function teamPermissions(): Array<string> {
  return permissions.rows
    .filter((row: StoredRow): boolean => {
      return String(row["teamId"]) === TEAM_ID;
    })
    .map((row: StoredRow): string => {
      return `${String(row["permission"])}${
        row["isBlockPermission"] ? " (block)" : ""
      }`;
    })
    .sort();
}

interface Drawn {
  onLevelChange: Mock<() => void>;
  view: RenderResult;
  drawAgain: (refreshToggle: string) => void;
}

function draw(): Drawn {
  const onLevelChange: Mock<() => void> = jest.fn();
  const card: (refreshToggle: string) => React.ReactElement = (
    refreshToggle: string,
  ): React.ReactElement => {
    return (
      <I18nextProvider i18n={translation}>
        <TeamProductAccess
          teamId={new ObjectID(TEAM_ID)}
          refreshToggle={refreshToggle}
          onLevelChange={onLevelChange as never}
        />
      </I18nextProvider>
    );
  };
  const view: RenderResult = render(card(""));

  return {
    onLevelChange,
    view,
    drawAgain: (refreshToggle: string): void => {
      view.rerender(card(refreshToggle));
    },
  };
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByTestId(getTeamProductAccessRowTestId(ProductKey.Cloud)),
    ).toBeInTheDocument();
  }, WAIT);
}

function rowOf(product: ProductKey): HTMLElement {
  return screen.getByTestId(getTeamProductAccessRowTestId(product));
}

function levelBoxOf(product: ProductKey): HTMLElement {
  return within(rowOf(product)).getByTestId(
    `${getTeamProductAccessRowTestId(product)}-level`,
  );
}

// What a product's row shows as its level: the list's pick, its placeholder, or the text.
function levelShown(product: ProductKey): string {
  return withoutIsolateMarks(levelBoxOf(product).textContent || "").trim();
}

async function openLevels(product: ProductKey): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.keyDown(within(levelBoxOf(product)).getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
  });
}

interface ListedLevel {
  text: string;
  isDisabled: boolean;
}

function listedLevels(): Array<ListedLevel> {
  return screen
    .getAllByRole("option")
    .map((option: HTMLElement): ListedLevel => {
      return {
        text: withoutIsolateMarks(option.textContent || "").trim(),
        isDisabled: option.getAttribute("aria-disabled") === "true",
      };
    });
}

async function pickLevel(title: string): Promise<void> {
  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return withoutIsolateMarks(candidate.textContent || "")
        .trim()
        .startsWith(title);
    });

  expect(option).toBeDefined();

  await act(async (): Promise<void> => {
    fireEvent.mouseDown(option as HTMLElement);
    fireEvent.click(option as HTMLElement);
  });
}

async function clearLevel(product: ProductKey): Promise<void> {
  const clear: HTMLElement | null = levelBoxOf(product).querySelector(
    ".ou-select__clear-indicator",
  );

  expect(clear).not.toBeNull();

  // react-select clears on a primary-button mousedown, not on click.
  await act(async (): Promise<void> => {
    fireEvent.mouseDown(clear as HTMLElement, { button: 0 });
  });
}

async function saved(product: ProductKey): Promise<void> {
  await waitFor(() => {
    expect(
      withoutIsolateMarks(
        within(rowOf(product)).getByTestId(
          `${getTeamProductAccessRowTestId(product)}-status`,
        ).textContent || "",
      ),
    ).toContain("Saved");
  }, WAIT);
}

function writesSent(): Array<string> {
  return server.requests
    .filter((sent: SentRequest): boolean => {
      return sent.method !== "GET" && !sent.path.includes("/get-list");
    })
    .map((sent: SentRequest): string => {
      return `${sent.method} ${sent.path.replace(/\/[0-9a-f-]{36}$/, "/:id")} ${sent.status}`;
    });
}

// The menu's own items, as the card reads them: names and groups.
function menuItems(): Array<MoreMenuItem> {
  let items: Array<MoreMenuItem> = [];

  const Probe: () => React.ReactElement = (): React.ReactElement => {
    const navigation: DashboardNavigationItems = useDashboardNavigationItems();
    items = navigation.moreMenuItems;
    return <></>;
  };

  const probe: RenderResult = render(
    <I18nextProvider i18n={translation}>
      <Probe />
    </I18nextProvider>,
  );
  probe.unmount();

  return items;
}

function titleOf(product: ProductKey): string {
  return (
    menuItems().find((item: MoreMenuItem): boolean => {
      return item.key === product;
    })?.title || ""
  );
}

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
  });

  // The session guards, as a signed-in member passes them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);

  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      TeamPermissionService.modelType as { new (): BaseModel },
      asService(TeamPermissionService),
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
  jest.restoreAllMocks();
});

beforeEach(async () => {
  await translation.changeLanguage("en");
  server.requests.length = 0;
  window.localStorage.clear();
  ProjectProducts.reset();
  // A follow-up ask of the products menu answers what the test set.
  ProjectProducts.setFetcher(async () => {
    return ProjectProducts.getState(PROJECT_ID).answer;
  });

  stubProjectDirectory({});
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  });
  jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
  jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);

  signInAs([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  jest.restoreAllMocks();

  // The session guards stay as the routers were built with them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
});

describe("the card lists every product with levels, as the products menu does", () => {
  test("each product is a row, in the menu's groups, order and names, showing the team's level", async () => {
    seed([
      teamRow("10289000-0000-4000-8000-0000000003d1", Permission.CloudAdmin),
      teamRow("10289000-0000-4000-8000-0000000003d2", Permission.NetworkViewer),
      teamRow("10289000-0000-4000-8000-0000000003d3", Permission.CephViewer, {
        teamId: OTHER_TEAM_ID,
      }),
    ]);
    draw();
    await loaded();

    // The customer's example: Admin of Cloud, Viewer of Network, nothing else.
    expect(levelShown(ProductKey.Cloud)).toBe("Admin");
    expect(levelShown(ProductKey.Network)).toBe("Viewer");
    expect(levelShown(ProductKey.AppPlatforms)).toBe("No access");
    // Another team's level is that team's.
    expect(levelShown(ProductKey.Ceph)).toBe("No access");

    const items: Array<MoreMenuItem> = menuItems();
    const inMenuOrder: Array<ProductKey> = items
      .map((item: MoreMenuItem): ProductKey => {
        return item.key as ProductKey;
      })
      .filter((product: ProductKey): boolean => {
        return PRODUCTS_WITH_LEVELS.includes(product);
      });

    const rows: Array<string> = Array.from(
      screen
        .getByTestId(TEAM_PRODUCT_ACCESS_TEST_ID)
        .querySelectorAll<HTMLElement>("li[data-testid]"),
    ).map((row: HTMLElement): string => {
      return row.getAttribute("data-testid") || "";
    });

    expect(rows).toEqual(
      inMenuOrder.map((product: ProductKey): string => {
        return getTeamProductAccessRowTestId(product);
      }),
    );
    expect(rows).toHaveLength(PRODUCTS_WITH_LEVELS.length);

    // Named as the menu names it, under the menu's group.
    const cloud: MoreMenuItem = items.find((item: MoreMenuItem): boolean => {
      return item.key === ProductKey.Cloud;
    })!;

    expect(within(rowOf(ProductKey.Cloud)).getByText(cloud.title)).toBeTruthy();
    expect(
      within(
        rowOf(ProductKey.Cloud).closest("section") as HTMLElement,
      ).getByRole("heading").textContent,
    ).toBe(cloud.category);
    expect(screen.getByText(PRODUCT_ACCESS_TITLE)).toBeTruthy();
  });

  test("a product the project hides waits behind Show All Products, unless the team holds something of it", async () => {
    ProjectProducts.setAnswer(PROJECT_ID, {
      ...getEmptyProjectProductsAnswer(),
      hidden: [ProductKey.Proxmox, ProductKey.Ceph, ProductKey.Podman],
    });
    seed([
      teamRow("10289000-0000-4000-8000-0000000003e1", Permission.PodmanAdmin, {
        isBlockPermission: true,
      }),
    ]);
    draw();
    await loaded();

    const shown: () => Array<string> = (): Array<string> => {
      return Array.from(
        screen
          .getByTestId(TEAM_PRODUCT_ACCESS_TEST_ID)
          .querySelectorAll<HTMLElement>("li[data-testid]"),
      ).map((row: HTMLElement): string => {
        return row.getAttribute("data-testid") || "";
      });
    };

    expect(shown()).not.toContain(
      getTeamProductAccessRowTestId(ProductKey.Proxmox),
    );
    expect(shown()).not.toContain(
      getTeamProductAccessRowTestId(ProductKey.Ceph),
    );
    // A block the team has on a hidden product is never out of sight.
    expect(shown()).toContain(getTeamProductAccessRowTestId(ProductKey.Podman));
    expect(shown()).toHaveLength(PRODUCTS_WITH_LEVELS.length - 2);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: SHOW_ALL_PRODUCTS }));
    });

    expect(shown()).toHaveLength(PRODUCTS_WITH_LEVELS.length);
    expect(
      screen.getByRole("button", { name: SHOW_FEWER_PRODUCTS }),
    ).toBeTruthy();
  });

  test("nothing hidden: no Show All Products", async () => {
    seed([]);
    draw();
    await loaded();

    expect(
      screen.queryByRole("button", { name: SHOW_ALL_PRODUCTS }),
    ).toBeNull();
  });
});

describe("a pick saves at once, through the server", () => {
  test("another level: the new row given first, the old one taken away after, and Saved", async () => {
    seed([
      teamRow("10289000-0000-4000-8000-0000000003f1", Permission.CloudAdmin),
    ]);
    const drawn: Drawn = draw();
    await loaded();

    await openLevels(ProductKey.Cloud);
    await pickLevel("Member");
    await saved(ProductKey.Cloud);

    expect(writesSent()).toEqual([
      "POST /api/team-permission 200",
      "DELETE /api/team-permission/:id 200",
    ]);
    expect(teamPermissions()).toEqual([Permission.CloudMember]);
    expect(levelShown(ProductKey.Cloud)).toBe("Member");
    expect(drawn.onLevelChange).toHaveBeenCalledTimes(1);
  });

  test("a first level: one row given, nothing taken away", async () => {
    seed([]);
    draw();
    await loaded();

    await openLevels(ProductKey.Network);
    await pickLevel("Viewer");
    await saved(ProductKey.Network);

    expect(writesSent()).toEqual(["POST /api/team-permission 200"]);
    expect(teamPermissions()).toEqual([Permission.NetworkViewer]);
  });

  test("two picks in a row: the second waits its turn and is planned from what the first wrote", async () => {
    seed([
      teamRow("10289000-0000-4000-8000-0000000003f2", Permission.HostViewer),
    ]);
    draw();
    await loaded();

    await openLevels(ProductKey.Hosts);
    await pickLevel("Admin");
    await openLevels(ProductKey.Hosts);
    await pickLevel("Member");
    await saved(ProductKey.Hosts);

    await waitFor(() => {
      expect(teamPermissions()).toEqual([Permission.HostMember]);
    }, WAIT);
    expect(levelShown(ProductKey.Hosts)).toBe("Member");
    expect(
      writesSent().filter((write: string): boolean => {
        return !write.endsWith(" 200");
      }),
    ).toEqual([]);
  });

  test("a change refused half way says so, and shows the level the team holds now", async () => {
    seed([
      // A row the server will not take away: its team's permissions are locked.
      teamRow("10289000-0000-4000-8000-0000000003fb", Permission.CloudAdmin, {
        team: { _id: TEAM_ID, isPermissionsEditable: false },
      }),
    ]);
    draw();
    await loaded();

    await openLevels(ProductKey.Cloud);
    await pickLevel("Viewer");

    const error: HTMLElement = await within(
      rowOf(ProductKey.Cloud),
    ).findByTestId(
      `${getTeamProductAccessRowTestId(ProductKey.Cloud)}-error`,
      {},
      WAIT,
    );

    expect(writesSent()).toEqual([
      "POST /api/team-permission 200",
      "DELETE /api/team-permission/:id 400",
    ]);
    expect(withoutIsolateMarks(error.textContent || "")).toContain(
      "not deleteable",
    );
    // The new level was given and the old one stayed: the team holds both.
    expect(teamPermissions()).toEqual([
      Permission.CloudAdmin,
      Permission.CloudViewer,
    ]);
    expect(levelShown(ProductKey.Cloud)).toBe("Admin");
  });

  test("clearing the list takes the product away", async () => {
    seed([
      teamRow("10289000-0000-4000-8000-0000000003f3", Permission.RumAdmin),
      teamRow("10289000-0000-4000-8000-0000000003f4", Permission.RumViewer),
      teamRow("10289000-0000-4000-8000-0000000003f5", Permission.CloudViewer),
    ]);
    draw();
    await loaded();

    expect(levelShown(ProductKey.Rum)).toBe("Admin");

    await clearLevel(ProductKey.Rum);
    await saved(ProductKey.Rum);

    expect(writesSent()).toEqual([
      "DELETE /api/team-permission/:id 200",
      "DELETE /api/team-permission/:id 200",
    ]);
    // Another product's level stays.
    expect(teamPermissions()).toEqual([Permission.CloudViewer]);
    expect(levelShown(ProductKey.Rum)).toBe("No access");
  });

  test("what the card does not change stays: a level for some records, a custom role's, a block", async () => {
    seed([
      teamRow("10289000-0000-4000-8000-0000000003f6", Permission.CloudAdmin),
      teamRow("10289000-0000-4000-8000-0000000003f7", Permission.CloudMember, {
        scope: PermissionScope.Labels,
        labels: [{ _id: LABEL_ID, name: "EU" }],
      }),
      teamRow("10289000-0000-4000-8000-0000000003f8", Permission.CloudViewer, {
        teamCustomRoleId: "10289000-0000-4000-8000-0000000003f9",
      }),
      teamRow("10289000-0000-4000-8000-0000000003fa", Permission.CloudAdmin, {
        isBlockPermission: true,
        scope: PermissionScope.Labels,
        labels: [{ _id: LABEL_ID, name: "EU" }],
      }),
    ]);
    draw();
    await loaded();

    expect(levelShown(ProductKey.Cloud)).toBe("Admin");

    const notes: Array<string> = Array.from(
      within(rowOf(ProductKey.Cloud))
        .getByTestId(`${getTeamProductAccessRowTestId(ProductKey.Cloud)}-notes`)
        .querySelectorAll("p"),
    ).map((note: HTMLParagraphElement): string => {
      return withoutIsolateMarks(note.textContent || "");
    });

    expect(notes).toEqual([
      "Viewer through a custom role.",
      LEVEL_LIMITED_SOMEWHERE,
      LEVEL_BLOCKED_SOMEWHERE,
    ]);
    expect(notes[0]).toBe(LEVEL_FROM_CUSTOM_ROLE.Viewer);

    await clearLevel(ProductKey.Cloud);
    await saved(ProductKey.Cloud);

    expect(writesSent()).toEqual(["DELETE /api/team-permission/:id 200"]);
    expect(teamPermissions()).toEqual([
      `${Permission.CloudAdmin} (block)`,
      Permission.CloudMember,
      Permission.CloudViewer,
    ]);
  });
});

/*
 * A product's admin who manages a team's levels: reads the team's
 * permissions and may change them, and holds Cloud Admin alone.
 */
const CLOUD_ADMIN_WHO_MANAGES_TEAMS: Array<Permission> = [
  Permission.CloudAdmin,
  Permission.ReadProjectTeam,
  Permission.EditProjectTeamPermissions,
];

describe("the reader gives no more than they hold, and the server stays the judge", () => {
  test("a Cloud Admin who may change teams' permissions is offered Cloud Admin alone, and told why not the rest", async () => {
    signInAs(CLOUD_ADMIN_WHO_MANAGES_TEAMS);
    seed([]);
    draw();
    await loaded();

    await openLevels(ProductKey.Cloud);

    expect(listedLevels()).toEqual([
      { text: `Viewer${LEVEL_NOT_YOURS_TO_GIVE}`, isDisabled: true },
      { text: `Member${LEVEL_NOT_YOURS_TO_GIVE}`, isDisabled: true },
      { text: `Admin${LEVEL_DESCRIPTIONS.Admin}`, isDisabled: false },
    ]);

    await pickLevel("Admin");
    await saved(ProductKey.Cloud);

    expect(teamPermissions()).toEqual([Permission.CloudAdmin]);
  });

  test("another product's level is offered to nobody who does not hold it", async () => {
    signInAs(CLOUD_ADMIN_WHO_MANAGES_TEAMS);
    seed([]);
    draw();
    await loaded();

    await openLevels(ProductKey.Network);

    for (const level of listedLevels()) {
      expect(level.isDisabled).toBe(true);
    }
  });

  test("a level the page offered by mistake is refused by the server, said in words, and nothing is written", async () => {
    // The page read Network Admin from a snapshot older than the server's.
    signInAs(CLOUD_ADMIN_WHO_MANAGES_TEAMS, [
      ...CLOUD_ADMIN_WHO_MANAGES_TEAMS,
      Permission.NetworkAdmin,
    ]);
    seed([]);
    draw();
    await loaded();

    await openLevels(ProductKey.Network);
    await pickLevel("Admin");

    const error: HTMLElement = await within(
      rowOf(ProductKey.Network),
    ).findByTestId(
      `${getTeamProductAccessRowTestId(ProductKey.Network)}-error`,
      {},
      WAIT,
    );

    expect(writesSent()).toEqual(["POST /api/team-permission 422"]);
    expect(withoutIsolateMarks(error.textContent || "")).toContain(
      "cannot grant",
    );
    expect(teamPermissions()).toEqual([]);
    // The list goes back to what the team has.
    await waitFor(() => {
      expect(levelShown(ProductKey.Network)).toBe("No access");
    }, WAIT);
  });

  test("who may not change teams' permissions reads each level, with why, and is offered no list", async () => {
    signInAs([Permission.CloudAdmin, Permission.ReadProjectTeam]);
    seed([
      teamRow("10289000-0000-4000-8000-000000000401", Permission.CloudAdmin),
    ]);
    draw();
    await loaded();

    expect(
      within(levelBoxOf(ProductKey.Cloud)).queryByRole("combobox"),
    ).toBeNull();
    expect(levelShown(ProductKey.Cloud)).toBe("Admin");
    expect(levelShown(ProductKey.Network)).toBe("No access");
    expect(
      screen.getByTestId(`${TEAM_PRODUCT_ACCESS_TEST_ID}-locked`).textContent,
    ).toBeTruthy();
    expect(writesSent()).toEqual([]);
  });
});

describe("the card and the permissions table show the same rows", () => {
  test("a level changed in the table is drawn again when the table says so", async () => {
    seed([
      teamRow("10289000-0000-4000-8000-000000000501", Permission.CloudAdmin),
    ]);
    const drawn: Drawn = draw();
    await loaded();

    expect(levelShown(ProductKey.Cloud)).toBe("Admin");

    // The permissions table edited the row: Cloud Viewer now.
    permissions.rows[0]!["permission"] = Permission.CloudViewer;

    await act(async (): Promise<void> => {
      drawn.drawAgain("after-the-table");
    });

    await waitFor(() => {
      expect(levelShown(ProductKey.Cloud)).toBe("Viewer");
    }, WAIT);
  });

  test("a change the card made is not drawn twice when the table reads again after it", async () => {
    seed([]);
    const drawn: Drawn = draw();
    await loaded();

    await openLevels(ProductKey.Cloud);
    await pickLevel("Admin");
    await saved(ProductKey.Cloud);

    // The page asks the table to read again, and the table tells the card.
    await act(async (): Promise<void> => {
      drawn.drawAgain("after-the-card");
    });

    await waitFor(() => {
      expect(
        server.requests.filter((sent: SentRequest): boolean => {
          return sent.path.includes("/get-list");
        }),
      ).toHaveLength(2);
    }, WAIT);

    // Still Saved: the list kept what it saved, and was not drawn anew.
    await saved(ProductKey.Cloud);
    expect(levelShown(ProductKey.Cloud)).toBe("Admin");
  });
});

describe("in German", () => {
  test("the card reads in German: its title, the levels and No access", async () => {
    await translation.changeLanguage("de");
    seed([
      teamRow("10289000-0000-4000-8000-000000000601", Permission.CloudAdmin),
    ]);
    draw();
    await loaded();

    const german: (english: string) => string = (english: string): string => {
      return String(GERMAN[english] || "");
    };

    expect(german(PRODUCT_ACCESS_TITLE)).not.toBe("");
    expect(german(PRODUCT_ACCESS_TITLE)).not.toBe(PRODUCT_ACCESS_TITLE);
    expect(screen.getByText(german(PRODUCT_ACCESS_TITLE))).toBeTruthy();
    expect(levelShown(ProductKey.Cloud)).toBe(german("Admin"));
    expect(levelShown(ProductKey.Network)).toBe(german("No access"));
    expect(titleOf(ProductKey.Cloud)).not.toBe("");
    expect(
      within(rowOf(ProductKey.Cloud)).getByText(titleOf(ProductKey.Cloud)),
    ).toBeTruthy();
  });
});
