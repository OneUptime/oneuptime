import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
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
 * INVITE USER, FOR SOMEONE WHO INVITES ONLY TO THE TEAMS THEY OWN (#6561).
 *
 * Invite User starts on the project's members team (Utils/DefaultInviteTeam)
 * so that a default never ends in a refusal. Invite New Members scoped to
 * Owned reaches only the teams the inviter, or the team holding it, owns,
 * and the server refuses every other team - the members team included. Such
 * an inviter gets no team picked and chooses one of their own; someone who
 * may invite to every team still starts on the members team.
 */

let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): null => {
        return null;
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
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

type InviteButton = { title?: string; onClick?: () => void };

let capturedButtons: Array<InviteButton> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { cardProps?: { buttons?: Array<InviteButton> } }) => {
      capturedButtons = props.cardProps?.buttons || [];
      return null;
    },
  };
});

const inviteModalMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      inviteModalMock(props);
      return <div data-testid="invite-modal" />;
    },
  };
});

const findDefaultInviteTeamMock: MockFunction = getJestMockFunction();

// The lookup is replaced; who may invite to every team is the real rule.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../UI/Utils/DefaultInviteTeam",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...actual,
      findDefaultInviteTeam: (...args: Array<unknown>) => {
        return findDefaultInviteTeamMock(...args);
      },
    };
  },
);

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000f1",
);
const MEMBERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000f2";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

function holding(
  rows: Array<{ permission: Permission; scope: PermissionScope }>,
): void {
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: rows.map(
      (row: { permission: Permission; scope: PermissionScope }) => {
        return {
          permission: row.permission,
          scope: row.scope,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission",
        } as UserPermission;
      },
    ),
    _type: "UserTenantAccessPermission",
  };
}

async function openInviteUser(): Promise<Record<string, unknown>> {
  render(
    <MemoryRouter>
      <Users
        pageRoute={new Route(`/dashboard/${PROJECT_ID.toString()}/users`)}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  const invite: InviteButton | undefined = capturedButtons.find(
    (button: InviteButton): boolean => {
      return button.title === "Invite User";
    },
  );

  expect(invite).toBeDefined();

  await act(async () => {
    invite!.onClick!();
  });

  await waitFor(() => {
    expect(inviteModalMock).toHaveBeenCalled();
  });

  // Indexed rather than .at(-1): this project targets es2017.
  const calls: Array<Array<unknown>> = inviteModalMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  capturedButtons = [];
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);
  findDefaultInviteTeamMock.mockImplementation(async () => {
    return { id: MEMBERS_TEAM_ID, name: "Members" };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  inviteModalMock.mockReset();
  findDefaultInviteTeamMock.mockReset();
});

describe("Invite User's team, for whoever opens it", () => {
  test("someone who invites only to the teams they own gets no team picked, and picks one of theirs", async () => {
    holding([
      {
        permission: Permission.InviteProjectTeamMembers,
        scope: PermissionScope.Owned,
      },
      { permission: Permission.ProjectMember, scope: PermissionScope.All },
    ]);

    const modal: Record<string, unknown> = await openInviteUser();

    expect(findDefaultInviteTeamMock).not.toHaveBeenCalled();
    expect(modal["initialValues"]).toBeUndefined();
  });

  test("someone who may invite to every team starts on the members team", async () => {
    holding([
      {
        permission: Permission.InviteProjectTeamMembers,
        scope: PermissionScope.All,
      },
      { permission: Permission.ProjectMember, scope: PermissionScope.All },
    ]);

    const modal: Record<string, unknown> = await openInviteUser();

    expect(findDefaultInviteTeamMock).toHaveBeenCalledTimes(1);
    expect(
      String(
        (findDefaultInviteTeamMock.mock.calls[0]![0] as { projectId: unknown })
          .projectId,
      ),
    ).toBe(PROJECT_ID.toString());
    expect(modal["initialValues"]).toEqual({ team: MEMBERS_TEAM_ID });
  });

  test("so does a project admin", async () => {
    holding([
      { permission: Permission.ProjectAdmin, scope: PermissionScope.All },
    ]);

    const modal: Record<string, unknown> = await openInviteUser();

    expect(findDefaultInviteTeamMock).toHaveBeenCalledTimes(1);
    expect(modal["initialValues"]).toEqual({ team: MEMBERS_TEAM_ID });
  });
});
