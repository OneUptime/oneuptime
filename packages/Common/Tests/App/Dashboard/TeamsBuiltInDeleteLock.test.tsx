import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TEAMS LIST: Delete in each row's ⋯ menu and in Bulk Actions, on the
 * real page with only the network stubbed.
 *
 * Owners and Admin come with every project and the server refuses to delete
 * them (TeamService). Their Delete stays in the menu, locked, saying why in
 * the server's words (BuiltInTeam); every other team - Members included -
 * deletes as any row does. A bulk Delete that includes a built-in team sends
 * nothing for it and lists it, with that reason, among the teams it did not
 * delete.
 */

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the consts.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

// The team custom field definitions: this project has none.
jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<any> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0e000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import TeamsPage, {
  BUILT_IN_TEAM_DELETE_REASON,
  getTeamDeleteDisabledReason,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission, { UserPermission } from "../../../Types/Permission";
import { BUILT_IN_TEAM_DELETE_MESSAGE } from "../../../Types/Team/BuiltInTeam";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";

const OWNERS_ID: string = "0e000000-0000-4000-8000-0000000000a1";
const ADMIN_ID: string = "0e000000-0000-4000-8000-0000000000a2";
const MEMBERS_ID: string = "0e000000-0000-4000-8000-0000000000a3";
const ENGINEERING_ID: string = "0e000000-0000-4000-8000-0000000000a4";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAMS] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function team(id: string, name: string, isTeamDeleteable: boolean): Team {
  const row: Team = new Team();
  row._id = id;
  row.name = name;
  row.isTeamDeleteable = isTeamDeleteable;
  return row;
}

// What a new project starts with, and one team of its own.
const TEAMS: Array<Team> = [
  team(OWNERS_ID, "Owners", false),
  team(ADMIN_ID, "Admin", false),
  team(MEMBERS_ID, "Members", true),
  team(ENGINEERING_ID, "Engineering", true),
];

// The row showing this team's name.
async function rowOf(name: string): Promise<HTMLElement> {
  const cell: HTMLElement = await screen.findByText(
    name,
    { selector: "td *, td" },
    { timeout: 10000 },
  );
  return cell.closest("tr")!;
}

async function openRowMenu(name: string): Promise<HTMLElement> {
  const row: HTMLElement = await rowOf(name);
  fireEvent.click(within(row).getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
}

function reasonOf(item: HTMLElement): string | null {
  const describedBy: string | null = item.getAttribute("aria-describedby");
  return describedBy
    ? document.getElementById(describedBy)?.textContent || null
    : null;
}

async function selectRows(names: Array<string>): Promise<void> {
  for (const name of names) {
    const row: HTMLElement = await rowOf(name);
    fireEvent.click(row.querySelector('input[type="checkbox"]')!);
  }
}

function menuItemNamed(label: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((item: HTMLElement): boolean => {
    return (item.textContent || "").trim() === label;
  });
}

async function runBulkDelete(): Promise<void> {
  fireEvent.click(await screen.findByText("Bulk Actions"));

  await waitFor(() => {
    expect(menuItemNamed("Delete")).toBeDefined();
  });

  fireEvent.click(menuItemNamed("Delete")!);

  await waitFor(() => {
    expect(
      document.querySelector('[data-testid="modal-footer"]'),
    ).not.toBeNull();
  });

  fireEvent.click(
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="modal-footer"] button',
      ),
    ).find((button: HTMLButtonElement): boolean => {
      return (button.textContent || "").trim() === "Delete";
    })!,
  );
}

function deletedIds(): Array<string> {
  return deleteItemMock.mock.calls.map((args: Array<any>): string => {
    return String(args[0].id);
  });
}

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/teams`,
  );

  getListMock.mockImplementation(async (): Promise<any> => {
    return { data: TEAMS, count: TEAMS.length, skip: 0, limit: 10 };
  });
  deleteItemMock.mockImplementation(async (): Promise<void> => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  deleteItemMock.mockReset();
  jest.restoreAllMocks();
});

describe("the reason", () => {
  test("is the server's refusal, word for word", () => {
    expect(BUILT_IN_TEAM_DELETE_REASON).toBe(BUILT_IN_TEAM_DELETE_MESSAGE);
  });

  test("is given for a team that comes with every project, and for no other", () => {
    expect(getTeamDeleteDisabledReason(TEAMS[0]!)).toBe(
      BUILT_IN_TEAM_DELETE_REASON,
    );
    expect(getTeamDeleteDisabledReason(TEAMS[1]!)).toBe(
      BUILT_IN_TEAM_DELETE_REASON,
    );
    expect(getTeamDeleteDisabledReason(TEAMS[2]!)).toBeUndefined();
    expect(getTeamDeleteDisabledReason(TEAMS[3]!)).toBeUndefined();
    // A team read without the column is not locked: the server decides.
    expect(getTeamDeleteDisabledReason(new Team())).toBeUndefined();
  });
});

describe("the Teams list", () => {
  test("reads whether each team may be deleted with the list", async () => {
    render(<TeamsPage {...pageProps} />);

    await rowOf("Owners");

    const teamRead: Array<any> | undefined = getListMock.mock.calls.find(
      (args: Array<any>): boolean => {
        return args[0].modelType === Team;
      },
    );

    expect(teamRead).toBeDefined();
    expect(teamRead![0].select.isTeamDeleteable).toBe(true);
  });

  test.each(["Owners", "Admin"])(
    "%s keeps Delete in its ⋯ menu, locked, saying why",
    async (name: string) => {
      render(<TeamsPage {...pageProps} />);

      const menu: HTMLElement = await openRowMenu(name);
      const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
        name: "Delete",
      });

      expect(deleteItem).toHaveAttribute("aria-disabled", "true");
      expect(reasonOf(deleteItem)).toBe(BUILT_IN_TEAM_DELETE_MESSAGE);

      // Pressing it opens nothing and sends nothing.
      fireEvent.click(deleteItem);
      expect(document.querySelector('[data-testid="modal-footer"]')).toBeNull();
      expect(deleteItemMock).not.toHaveBeenCalled();
    },
  );

  test.each(["Members", "Engineering"])(
    "%s is deleted from its ⋯ menu",
    async (name: string) => {
      render(<TeamsPage {...pageProps} />);

      const menu: HTMLElement = await openRowMenu(name);
      const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
        name: "Delete",
      });

      expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");

      fireEvent.click(deleteItem);

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="modal-footer"]'),
        ).not.toBeNull();
      });

      fireEvent.click(
        Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '[data-testid="modal-footer"] button',
          ),
        ).find((button: HTMLButtonElement): boolean => {
          return (button.textContent || "").trim() === "Delete";
        })!,
      );

      await waitFor(() => {
        expect(deleteItemMock).toHaveBeenCalledTimes(1);
      });

      expect(deleteItemMock.mock.calls[0]![0].modelType).toBe(Team);
      expect(deletedIds()).toEqual([
        name === "Members" ? MEMBERS_ID : ENGINEERING_ID,
      ]);
    },
  );

  test("a bulk Delete deletes the project's own teams and lists a built-in one as not deleted, saying why", async () => {
    render(<TeamsPage {...pageProps} />);

    await selectRows(["Owners", "Engineering"]);
    await runBulkDelete();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="bulk-action-failed-count"]'),
      ).not.toBeNull();
    });

    // Nothing was sent for Owners.
    expect(deletedIds()).toEqual([ENGINEERING_ID]);
    expect(screen.getByText("1 Team deleted")).toBeInTheDocument();
    expect(screen.getByText("1 Team not deleted")).toBeInTheDocument();
    expect(screen.getByText(BUILT_IN_TEAM_DELETE_MESSAGE)).toBeInTheDocument();
  });
});
