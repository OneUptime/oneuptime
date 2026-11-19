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
import { Location, MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS, ON THE ROLE'S OWN PAGE
 * (#9767), rendered for real with only the network stubbed:
 *
 *   - the Delete dialog lists the workflows that run as the role, each a
 *     link to its Run As, says deleting it would stop them, and asks what
 *     they run as from now on - Default to begin with;
 *   - Delete sends that choice with the role's id, and a role no workflow
 *     runs as is deleted as it always was;
 *   - for a reader who may not edit workflows, Delete is locked, saying how
 *     many run as it, why it can't be deleted yet, and who can.
 */

let licenseModeForTest: string = "editable";

(
  globalThis as unknown as { __licenseModeForTest: () => string }
).__licenseModeForTest = (): string => {
  return licenseModeForTest;
};

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __licenseModeForTest: () => string }
        ).__licenseModeForTest();
      },
    };
  },
);

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("Common/UI/Utils/Permission", () => {
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

jest.mock("Common/UI/Utils/User", () => {
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

jest.mock("Common/UI/Utils/Translation", () => {
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
const getItemMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
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
      createOrUpdate: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0c000000-0000-4000-8000-000000000001";
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

import TeamRoleView from "../../../Dashboard/CustomRoles/RoleViewPage";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap from "@oneuptime/dashboard/Utils/RouteMap";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Route from "Common/Types/API/Route";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WorkflowRunAs,
} from "Common/Types/Workflow/WorkflowRunAs";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "Common/Tests/Spy";

const PROJECT_ID: string = "0c000000-0000-4000-8000-000000000001";
const ROLE_ID: string = "0c000000-0000-4000-8000-000000000002";
const WORKFLOW_ID: string = "0c000000-0000-4000-8000-0000000000e1";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

// The workflows that run as the role.
let workflowRows: Array<Workflow> = [];

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

function role(): CustomRole {
  const customRole: CustomRole = new CustomRole();
  customRole._id = ROLE_ID;
  customRole.name = "Incident Responder";
  customRole.description = "Declares, works and resolves incidents.";
  customRole.permissionCount = 2;
  return customRole;
}

function workflow(id: string, name: string): Workflow {
  const row: Workflow = new Workflow();
  row._id = id;
  row.name = name;
  return row;
}

beforeEach(() => {
  licenseModeForTest = "editable";
  holding([Permission.ProjectOwner]);
  workflowRows = [workflow(WORKFLOW_ID, "Close stale incidents")];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
  );

  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(ROLE_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getItemMock.mockImplementation(async (): Promise<any> => {
    return role();
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const data: Array<unknown> =
      params.modelType === Workflow ? workflowRows : [];

    return { data: data, count: data.length, skip: 0, limit: 50 };
  });

  deleteItemMock.mockImplementation(async (): Promise<void> => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  deleteItemMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter
      initialEntries={[`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`]}
    >
      <TeamRoleView {...pageProps} />
    </MemoryRouter>,
  );

  await screen.findByText(
    "Declares, works and resolves incidents.",
    {},
    { timeout: 10000 },
  );
}

// Lets React finish the renders it scheduled outside act().
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });
  }
}

function deleteButton(): HTMLElement {
  const deleteCard: HTMLElement = screen
    .getAllByTestId("card")
    .find((candidate: HTMLElement): boolean => {
      return (
        within(candidate).queryByTestId("model-delete-card-message") !== null
      );
    })!;

  return within(deleteCard)
    .getAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === "Delete Custom Role";
    })!;
}

async function openTheDialog(): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    fireEvent.click(deleteButton());
  });

  return await screen.findByTestId(
    "custom-role-delete-workflows",
    {},
    { timeout: 10000 },
  );
}

function submitButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

describe("deleting a custom role that workflows run as", () => {
  test("the dialog lists them, links each to its Run As, and says they would stop", async () => {
    await renderPage();
    await settle();

    const box: HTMLElement = await openTheDialog();

    expect(box).toHaveTextContent("1 workflow runs as this role");
    expect(box).toHaveTextContent(
      "Deleting the role would stop them until someone changes what they run as",
    );

    const link: HTMLElement = within(box).getByRole("link", {
      name: "Close stale incidents",
    });

    expect(link.getAttribute("href")).toContain(
      `/workflows/${WORKFLOW_ID}/settings#run-as`,
    );
    expect(screen.getByLabelText("Run them as")).toBeInTheDocument();
    expect(box).toHaveTextContent("Default permissions");
  });

  test("Delete sends what they run as instead: Default, to begin with", async () => {
    await renderPage();
    await settle();
    await openTheDialog();

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    const call: any = deleteItemMock.mock.calls[0]![0];

    expect(call.modelType).toBe(CustomRole);
    expect(call.id.toString()).toBe(ROLE_ID);
    expect(call.miscDataProps).toEqual({
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
    });
  });

  test("a role no workflow runs as is deleted as it always was", async () => {
    workflowRows = [];

    await renderPage();
    await settle();

    await act(async (): Promise<void> => {
      fireEvent.click(deleteButton());
    });
    await screen.findByTestId("modal-footer-submit-button");

    expect(screen.queryByTestId("custom-role-delete-workflows")).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    expect(deleteItemMock.mock.calls[0]![0].miscDataProps).toBeUndefined();
  });

  test("is locked for a reader who may not edit workflows, saying why and who can", async () => {
    // May delete the role and read workflows, but not edit them.
    holding([
      Permission.EditProjectTeamPermissions,
      Permission.ReadProjectTeam,
      Permission.ReadWorkflow,
    ]);

    await renderPage();
    await settle();

    await waitFor(() => {
      expect(deleteButton()).toBeDisabled();
    });

    // A locked button explains itself in the tooltip its wrapper shows.
    await act(async (): Promise<void> => {
      fireEvent.mouseEnter(deleteButton().parentElement as HTMLElement);
    });

    const tooltips: Array<HTMLElement> = await screen.findAllByRole("tooltip");

    expect(tooltips[tooltips.length - 1]).toHaveTextContent(
      "1 workflow runs as this role. You can't change what these workflows run as, so you can't delete this role yet. Someone who can edit them can choose what they run as in each workflow's Settings, or delete the role.",
    );

    fireEvent.click(deleteButton());
    await settle();

    expect(screen.queryByTestId("custom-role-delete-workflows")).toBeNull();
    expect(deleteItemMock).not.toHaveBeenCalled();
  });
});
