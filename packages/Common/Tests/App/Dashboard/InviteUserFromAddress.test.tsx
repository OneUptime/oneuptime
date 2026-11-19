import "@testing-library/jest-dom";
import {
  act,
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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SEARCH'S INVITE USER OPENS THE USERS PAGE'S OWN INVITE (#7035), on the
 * real Settings > Users page with its table stubbed and only the network
 * under it.
 *
 * Search opens the page with ?create=1. The page then opens Invite New User
 * as its Invite User button does - or, while SCIM manages who is in the
 * project, the note that says so - for whoever may invite. Someone who may
 * not just sees the list. Reloading opens it again, and closing it, or
 * inviting someone, takes the ask off the address, so Back to the list never
 * opens it again.
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

let tableIsDrawn: boolean = false;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      tableIsDrawn = true;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "0d100000-0000-4000-8000-000000000001",
);
const MEMBERS_ID: string = "0d100000-0000-4000-8000-0000000000a3";
const NEW_USER_ID: string = "0d100000-0000-4000-8000-0000000000b1";
const USERS_PATH: string = "/dashboard/project/users";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

let scimManagedCount: number = 0;
let searchWhenNavigated: Array<string> = [];

// What the person holds in the project, as the page reads it.
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

function list(data: Array<unknown>): unknown {
  return { data: data, count: data.length, skip: 0, limit: 10000 };
}

function membersTeam(): Team {
  const value: Team = new Team();
  value._id = MEMBERS_ID;
  value.name = "Members";
  return value;
}

function membersPermission(): TeamPermission {
  const value: TeamPermission = new TeamPermission();
  value._id = ObjectID.generate().toString();
  value.teamId = new ObjectID(MEMBERS_ID);
  value.permission = Permission.ProjectMember;
  value.isBlockPermission = false;
  value.scope = PermissionScope.All;
  return value;
}

beforeEach((): void => {
  standInForGlobalConfig();
  holding([Permission.ProjectOwner]);
  scimManagedCount = 0;
  searchWhenNavigated = [];
  tableIsDrawn = false;
  PermissionGate.clearPermissionPropsCache();
  window.localStorage.clear();
  window.history.replaceState(window.history.state, "", USERS_PATH);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "navigate").mockImplementation(((
    ...args: Array<unknown>
  ): void => {
    searchWhenNavigated.push(window.location.search);
    navigateMock(...args);
  }) as never);
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  getJestSpyOn(ModelAPI, "count").mockImplementation(
    (async (): Promise<number> => {
      return scimManagedCount;
    }) as never,
  );
  getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null);
  getJestSpyOn(ModelAPI, "getList").mockImplementation(((
    ...args: Array<unknown>
  ): unknown => {
    return getListMock(...args);
  }) as never);
  getJestSpyOn(ModelAPI, "createOrUpdate").mockImplementation(((
    ...args: Array<unknown>
  ): unknown => {
    return createOrUpdateMock(...args);
  }) as never);

  getListMock.mockImplementation((async (params: {
    modelType: unknown;
  }): Promise<unknown> => {
    if (params.modelType === TeamPermission) {
      return list([membersPermission()]);
    }

    if (params.modelType === Team) {
      return list([membersTeam()]);
    }

    return list([]);
  }) as never);

  createOrUpdateMock.mockImplementation((async (): Promise<unknown> => {
    return {
      data: {
        _id: ObjectID.generate().toString(),
        userId: NEW_USER_ID,
      },
    };
  }) as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  navigateMock.mockReset();
  jest.restoreAllMocks();
});

function goTo(address: string): void {
  window.history.pushState(window.history.state, "", address);
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <Users
        pageRoute={new Route("/dashboard/project/users")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function inviteDialog(): Promise<HTMLElement> {
  const modal: HTMLElement = await screen.findByTestId("modal");
  await within(modal).findByPlaceholderText("member@company.com");
  await act(async (): Promise<void> => {});
  return modal;
}

// Lets the page's reads (SCIM, the members team) settle.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });
}

describe("Invite User from the address (#7035)", () => {
  test("?create=1 opens Invite New User, on the members team, as the button does", async () => {
    goTo(`${USERS_PATH}?create=1`);
    renderPage();

    const modal: HTMLElement = await inviteDialog();

    expect(within(modal).getByText("Invite New User")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(modal).queryByRole("button", { name: "Team" }),
      ).toHaveTextContent("Members");
    });
    // Still asked for while it is open: a reload opens it again.
    expect(window.location.search).toBe("?create=1");
  });

  test("a reload opens it again", async () => {
    goTo(`${USERS_PATH}?create=1`);
    const first: ReturnType<typeof render> = renderPage();
    await inviteDialog();

    first.unmount();
    renderPage();

    await inviteDialog();
  });

  test("closing it takes create=1 off the address, in place", async () => {
    goTo(`${USERS_PATH}?create=1`);
    const historyLength: number = window.history.length;
    renderPage();
    const modal: HTMLElement = await inviteDialog();

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(window.location.pathname).toBe(USERS_PATH);
    expect(window.location.search).toBe("");
    expect(window.history.length).toBe(historyLength);
  });

  test("inviting someone takes it off before the new member's page opens", async () => {
    goTo(`${USERS_PATH}?create=1`);
    renderPage();
    const modal: HTMLElement = await inviteDialog();

    await act(async (): Promise<void> => {
      fireEvent.change(
        within(modal).getByPlaceholderText("member@company.com"),
        { target: { value: "new.person@example.com" } },
      );
    });
    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByRole("button", { name: "Invite" }));
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `/dashboard/project/users/${NEW_USER_ID}`,
    );
    expect(searchWhenNavigated).toEqual([""]);
  });

  test("someone who may not invite sees the list, with nothing opened", async () => {
    // Reads the project's people, invites nobody.
    holding([Permission.Viewer, Permission.ReadProjectTeam]);
    goTo(`${USERS_PATH}?create=1`);
    renderPage();
    await settle();

    expect(tableIsDrawn).toBe(true);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("while SCIM manages the project's people, it opens the note that says so, and closing it takes the ask off", async () => {
    scimManagedCount = 1;
    goTo(`${USERS_PATH}?create=1`);
    renderPage();

    const note: HTMLElement = await screen.findByTestId("modal");
    expect(
      within(note).getByText("Users are managed by SCIM Push Groups"),
    ).toBeInTheDocument();
    expect(
      within(note).queryByPlaceholderText("member@company.com"),
    ).toBeNull();

    /*
     * It waited for the SCIM read: the invite was never begun, not even
     * the look-up of the team it starts on.
     */
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === TeamPermission;
      }),
    ).toBe(false);

    await act(async (): Promise<void> => {
      fireEvent.click(within(note).getByRole("button", { name: "Close" }));
    });

    expect(window.location.search).toBe("");
  });

  test("an address that does not ask opens nothing", async () => {
    renderPage();
    await settle();

    expect(tableIsDrawn).toBe(true);
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});
