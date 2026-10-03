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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * CREATE TEAM, on the real Teams page, with only the network stubbed.
 *
 * A team used to be made from a name and a description, and it held no
 * permissions: people invited to it could sign in and do nothing until
 * someone opened the team, found Permissions and picked from some forty role
 * cards. Now:
 *
 *   - the form asks Name and Access - Project Admin, Project Member, Viewer,
 *     or Choose permissions later, which is picked - with the description
 *     folded under Advanced;
 *   - the team is created exactly as before: nothing about its access goes
 *     with it;
 *   - a role picked under Access becomes the team's first permission once
 *     the team exists, at scope All, through the team permission endpoint;
 *   - Choose permissions later adds nothing;
 *   - a team with a role opens on Members, to invite people; one whose
 *     permissions were left for later opens on Permissions, where Add Role
 *     is;
 *   - a role the server refuses leaves the team, says why, and links to its
 *     Permissions page;
 *   - the user sees only the roles they may hand on, and is not asked
 *     without the right to add permissions to a team.
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
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
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
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
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
            return "0d000000-0000-4000-8000-000000000001";
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

import TeamsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { ROLE_ACCESS_LATER } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess";
import { TEAM_ACCESS_NOTICE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleAccessNotice";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import Permission, { UserPermission } from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0d000000-0000-4000-8000-000000000001";
const NEW_TEAM_ID: string = "0d000000-0000-4000-8000-000000000002";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAMS] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

let navigateCalls: Array<string> = [];

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

function teamRoute(teamId: string, page: "members" | "permissions"): string {
  return `/dashboard/${PROJECT_ID}/teams/${teamId}/${page}`;
}

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/teams`,
  );

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );

  getListMock.mockImplementation(async (): Promise<any> => {
    // A project with no teams of its own yet.
    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  // The server answers a create with the new team.
  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: NEW_TEAM_ID,
        name: data.model.name,
      },
    };
  });

  createMock.mockImplementation(async (): Promise<any> => {
    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
});

function laterCard(modal: HTMLElement): HTMLElement | null {
  return within(modal).queryByTestId(`card-select-option-${ROLE_ACCESS_LATER}`);
}

/*
 * BasicForm settles its fields and defaults in effects. Wait until it has:
 * on a busy machine one tick is not enough. A default that never arrives -
 * a form holding on to the last team's answers - still fails here.
 */
async function waitForFormDefaults(modal: HTMLElement): Promise<void> {
  await within(modal).findByPlaceholderText("Team Name");
  await act(async (): Promise<void> => {});

  await waitFor(() => {
    const later: HTMLElement | null = laterCard(modal);

    if (later) {
      expect(later).toHaveAttribute("aria-checked", "true");
    }
  });
}

function createTeamButton(): HTMLElement | undefined {
  return screen
    .queryAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes("Create Team");
    });
}

async function openCreateForm(): Promise<HTMLElement> {
  render(<TeamsPage {...pageProps} />);

  const createButton: HTMLElement = await waitFor(
    (): HTMLElement => {
      const button: HTMLElement | undefined = createTeamButton();

      if (!button) {
        throw new Error("No Create Team button yet");
      }

      return button;
    },
    { timeout: 10000 },
  );

  fireEvent.click(createButton);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await waitForFormDefaults(modal);

  return modal;
}

function typeName(modal: HTMLElement, name: string): void {
  fireEvent.change(within(modal).getByPlaceholderText("Team Name"), {
    target: { value: name },
  });
}

function accessCard(modal: HTMLElement, value: string): HTMLElement {
  return within(modal).getByTestId(`card-select-option-${value}`);
}

function accessCardValues(modal: HTMLElement): Array<string> {
  return within(modal)
    .queryAllByRole("radio")
    .map((card: HTMLElement): string => {
      return (card.getAttribute("data-testid") || "").replace(
        "card-select-option-",
        "",
      );
    });
}

function advancedHeader(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole("button", { name: /^Advanced/ });
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(modal).getByRole("button", { name: "Create Team" }));
  });
}

function teamRequest(): any {
  const call: Array<any> | undefined = createOrUpdateMock.mock.calls.find(
    (args: Array<any>): boolean => {
      return args[0].modelType === Team;
    },
  );

  expect(call).toBeDefined();

  return call![0];
}

describe("the Create Team form", () => {
  test("asks Name and Access, with the description folded under Advanced, and no steps", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(within(modal).getByText("Access")).toBeInTheDocument();
    expect(
      within(modal).getByText(
        "What the team's members can do. You can change it on the team's page at any time.",
      ),
    ).toBeInTheDocument();

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(advancedHeader(modal)).not.toHaveTextContent("Configured");
    expect(
      within(modal).getByPlaceholderText("Team Description"),
    ).not.toBeVisible();

    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
  });

  test("offers Project Admin, Project Member, Viewer and Choose permissions later, the last picked", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(accessCardValues(modal)).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      ROLE_ACCESS_LATER,
    ]);

    expect(accessCard(modal, ROLE_ACCESS_LATER)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    for (const role of [
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      expect(accessCard(modal, role)).toHaveAttribute("aria-checked", "false");
    }

    // The team's own words for leaving it for later.
    expect(
      within(modal).getByText(
        "No access yet. Add a narrower role, such as Incident Member, or single permissions on the team's page.",
      ),
    ).toBeInTheDocument();
  });

  test("a description typed under Advanced makes the folded header say Configured", async () => {
    const modal: HTMLElement = await openCreateForm();

    fireEvent.click(advancedHeader(modal));
    expect(
      within(modal).getByPlaceholderText("Team Description"),
    ).toBeVisible();

    fireEvent.change(within(modal).getByPlaceholderText("Team Description"), {
      target: { value: "Looks after the payment services." },
    });
    fireEvent.click(advancedHeader(modal));

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(advancedHeader(modal)).toHaveTextContent("Configured");
  });
});

describe("creating a team", () => {
  test("with the defaults: the team as before, no access, and its Permissions page opens", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([teamRoute(NEW_TEAM_ID, "permissions")]);
    });

    const request: any = teamRequest();

    expect(request.formType).toBe(FormType.Create);
    expect(request.model.name).toBe("Support");

    // Nothing about access goes with the team, as a column or misc data.
    expect(request.miscDataProps).toEqual({});
    expect(
      (request.model as unknown as Record<string, unknown>)["access"],
    ).toBeUndefined();

    // Choose permissions later: no permission is added.
    expect(createMock).not.toHaveBeenCalled();
  });

  test("the pages a new team opens on are the ones the route map names", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toHaveLength(1);
    });

    expect(navigateCalls[0]).toBe(
      (RouteMap[PageMap.TEAM_VIEW_MEMBERS] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", NEW_TEAM_ID),
    );
  });

  test.each([
    [Permission.ProjectAdmin],
    [Permission.ProjectMember],
    [Permission.Viewer],
  ])(
    "with %s picked, the team is made first, the role becomes its first permission, and Members opens",
    async (role: Permission) => {
      const modal: HTMLElement = await openCreateForm();

      typeName(modal, "Frontend On-Call");
      fireEvent.click(accessCard(modal, role));

      expect(accessCard(modal, role)).toHaveAttribute("aria-checked", "true");

      await submit(modal);

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });

      const permissionRequest: any = createMock.mock.calls[0]![0];

      expect(permissionRequest.modelType).toBe(TeamPermission);

      const row: TeamPermission = permissionRequest.model;

      expect(row).toBeInstanceOf(TeamPermission);
      expect(row.permission).toBe(role);
      expect(row.teamId?.toString()).toBe(NEW_TEAM_ID);
      expect(row.projectId?.toString()).toBe(PROJECT_ID);
      expect(row.isBlockPermission).toBe(false);
      // Every resource in the project, as Add Role's Scope starts.
      expect(row.scope).toBe(PermissionScope.All);
      expect(row.labels).toBeUndefined();

      // The team went first, and carried nothing of the role.
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      expect(createOrUpdateMock.mock.invocationCallOrder[0]!).toBeLessThan(
        createMock.mock.invocationCallOrder[0]!,
      );
      expect(teamRequest().miscDataProps).toEqual({});

      await waitFor(() => {
        expect(navigateCalls).toEqual([teamRoute(NEW_TEAM_ID, "members")]);
      });
    },
  );

  test("a role picked and then taken back adds nothing, and Permissions opens", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    fireEvent.click(accessCard(modal, ROLE_ACCESS_LATER));

    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([teamRoute(NEW_TEAM_ID, "permissions")]);
    });

    expect(createMock).not.toHaveBeenCalled();
  });

  test("a second team does not inherit the first one's role", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "First");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(navigateCalls).toHaveLength(1);
    });

    // The page stays mounted here (navigation is stubbed): make another.
    fireEvent.click(createTeamButton()!);

    const secondModal: HTMLElement = await screen.findByTestId("modal");

    // Back on Choose permissions later, not on the first team's Viewer.
    await waitForFormDefaults(secondModal);

    expect(accessCard(secondModal, Permission.Viewer)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(accessCard(secondModal, ROLE_ACCESS_LATER)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    typeName(secondModal, "Second");
    await submit(secondModal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(navigateCalls).toHaveLength(2);
    });

    // Only the first team was given a role.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(navigateCalls[1]).toBe(teamRoute(NEW_TEAM_ID, "permissions"));
  });

  test("the description typed under Advanced is saved with the team", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(advancedHeader(modal));
    fireEvent.change(within(modal).getByPlaceholderText("Team Description"), {
      target: { value: "Answers customers." },
    });

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(teamRequest().model.name).toBe("Support");
    expect(teamRequest().model.description).toBe("Answers customers.");
  });

  test("a team that cannot be created stays on the form and adds no permission", async () => {
    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new Error("A team with this name already exists.");
    });

    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    expect(
      await within(modal).findByText("A team with this name already exists."),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigateCalls).toEqual([]);
  });
});

describe("a role the server refuses", () => {
  beforeEach(() => {
    createMock.mockImplementation(async (): Promise<never> => {
      throw new Error(
        "You cannot grant ProjectAdmin because your own access does not include that permission at an equal or broader scope.",
      );
    });
  });

  test("leaves the team, says why it has no access, and stays on the list", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    const notice: HTMLElement = await screen.findByTestId(
      TEAM_ACCESS_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent("Support was created without access.");
    expect(notice).toHaveTextContent(
      "You cannot grant ProjectAdmin because your own access does not include that permission at an equal or broader scope.",
    );
    expect(notice).toHaveTextContent("Open the team to give it a role");

    expect(navigateCalls).toEqual([]);
    // The team itself was made, once.
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  test("the notice opens the team's Permissions page", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    const notice: HTMLElement = await screen.findByTestId(
      TEAM_ACCESS_NOTICE_TEST_ID,
    );

    fireEvent.click(notice);

    expect(navigateCalls).toEqual([teamRoute(NEW_TEAM_ID, "permissions")]);
  });

  test("the notice can be closed", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    const notice: HTMLElement = await screen.findByTestId(
      TEAM_ACCESS_NOTICE_TEST_ID,
    );

    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByTestId(TEAM_ACCESS_NOTICE_TEST_ID)).toBeNull();
    });
    expect(navigateCalls).toEqual([]);
  });

  test("the next team that is given its role clears the notice", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    await screen.findByTestId(TEAM_ACCESS_NOTICE_TEST_ID);

    createMock.mockImplementation(async (): Promise<any> => {
      return { data: {} };
    });

    fireEvent.click(createTeamButton()!);

    const secondModal: HTMLElement = await screen.findByTestId("modal");

    await waitForFormDefaults(secondModal);
    typeName(secondModal, "Auditors");
    fireEvent.click(accessCard(secondModal, Permission.Viewer));
    await submit(secondModal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([teamRoute(NEW_TEAM_ID, "members")]);
    });
    expect(screen.queryByTestId(TEAM_ACCESS_NOTICE_TEST_ID)).toBeNull();
  });
});

describe("who is asked what", () => {
  test("a project admin is offered the role they hold, and Choose permissions later", async () => {
    holding([Permission.ProjectAdmin]);

    const modal: HTMLElement = await openCreateForm();

    expect(accessCardValues(modal)).toEqual([
      Permission.ProjectAdmin,
      ROLE_ACCESS_LATER,
    ]);
  });

  test("a permission editor is offered the roles they hold", async () => {
    holding([
      Permission.CreateProjectTeam,
      Permission.EditProjectTeamPermissions,
      Permission.Viewer,
    ]);

    const modal: HTMLElement = await openCreateForm();

    expect(accessCardValues(modal)).toEqual([
      Permission.Viewer,
      ROLE_ACCESS_LATER,
    ]);
  });

  test("someone who may create teams but not give them permissions is not asked, and the team opens on Members", async () => {
    holding([Permission.CreateProjectTeam, Permission.ReadProjectTeam]);

    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).queryByText("Access")).toBeNull();
    expect(within(modal).queryAllByRole("radio")).toEqual([]);

    // The rest of the form is as for everyone.
    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(advancedHeader(modal)).toBeInTheDocument();

    typeName(modal, "Support");
    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([teamRoute(NEW_TEAM_ID, "members")]);
    });

    expect(teamRequest().miscDataProps).toEqual({});
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("the request the team's create sends", () => {
  test("is the same with or without a role picked", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Support");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const json: JSONObject = Team.toJSON(teamRequest().model, Team);

    // A name: nothing the form added.
    expect(Object.keys(json).sort()).toEqual(["name"]);
  });
});
