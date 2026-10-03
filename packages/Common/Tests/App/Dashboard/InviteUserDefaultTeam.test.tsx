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
 * INVITE USER STARTS ON THE MEMBERS TEAM - on the real Settings > Users page,
 * with its table stubbed (UsersTableGroupsByPerson.test.tsx pins the table)
 * and only the network under it.
 *
 * Invite New User asked for a team with nothing picked, so every invitation
 * began with a permissions decision between Owners, Admin and Members. Now:
 *
 *   - the project's members team is picked when the dialog opens, and the
 *     Team field says so;
 *   - the invitation sends it as it always sent a team, and another can be
 *     picked;
 *   - nothing is picked when there is no such team, when the inviter may not
 *     invite to it (the server would refuse), or when it cannot be looked
 *     up - the dialog opens all the same;
 *   - Invite User shows it is busy while it looks, and opens once.
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

// The account lookup behind the Name field is not what this file is about.
jest.mock("../../../UI/Utils/UserEmailRegistrationStatus", () => {
  return {
    __esModule: true,
    useUserEmailRegistrationStatus: () => {
      return {
        isEmailRegistered: true,
        checkEmail: (): void => {},
      };
    },
  };
});

type CapturedButton = {
  title: string;
  isLoading?: boolean | undefined;
  onClick: () => void;
};

type CapturedTableProps = {
  cardProps?: { buttons?: Array<CapturedButton> | undefined } | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

/*
 * The network, spied on rather than mocked away: the page's Users table
 * reads through ProjectUsersModelAPI, a subclass of ModelAPI, which needs the
 * real class to extend.
 */
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
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

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "0d100000-0000-4000-8000-000000000001",
);
const OWNERS_ID: string = "0d100000-0000-4000-8000-0000000000a1";
const ADMIN_ID: string = "0d100000-0000-4000-8000-0000000000a2";
const MEMBERS_ID: string = "0d100000-0000-4000-8000-0000000000a3";
const NEW_USER_ID: string = "0d100000-0000-4000-8000-0000000000b1";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

let teams: Array<Team> = [];
let teamPermissions: Array<TeamPermission> = [];
let failLookup: boolean = false;
let holdLookup: Promise<void> | null = null;

function team(id: string, name: string): Team {
  const value: Team = new Team();
  value._id = id;
  value.name = name;
  return value;
}

function teamPermission(
  teamId: string,
  permission: Permission,
): TeamPermission {
  const value: TeamPermission = new TeamPermission();
  value._id = ObjectID.generate().toString();
  value.teamId = new ObjectID(teamId);
  value.permission = permission;
  value.isBlockPermission = false;
  value.scope = PermissionScope.All;
  return value;
}

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

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  capturedTableProps = null;
  failLookup = false;
  holdLookup = null;

  // What a new project starts with (ProjectService.addDefaultProjectTeams).
  teams = [
    team(OWNERS_ID, "Owners"),
    team(ADMIN_ID, "Admin"),
    team(MEMBERS_ID, "Members"),
  ];
  teamPermissions = [
    teamPermission(OWNERS_ID, Permission.ProjectOwner),
    teamPermission(ADMIN_ID, Permission.ProjectAdmin),
    teamPermission(MEMBERS_ID, Permission.ProjectMember),
  ];

  PermissionGate.clearPermissionPropsCache();
  window.localStorage.clear();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  // No SCIM Push Groups: invitations are made here.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);
  getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null);
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    (...args: Array<any>): any => {
      return getListMock(...args);
    },
  );
  getJestSpyOn(ModelAPI, "createOrUpdate").mockImplementation(
    (...args: Array<any>): any => {
      return createOrUpdateMock(...args);
    },
  );

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === TeamPermission) {
      if (holdLookup) {
        await holdLookup;
      }

      if (failLookup) {
        throw new Error(
          "You do not have permission to read this Team Permission.",
        );
      }

      return list(teamPermissions);
    }

    if (params.modelType === Team) {
      return list(teams);
    }

    return list([]);
  });

  createOrUpdateMock.mockImplementation(async (): Promise<any> => {
    return {
      data: {
        _id: ObjectID.generate().toString(),
        userId: NEW_USER_ID,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <Users
        pageRoute={new Route("/dashboard/users")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
}

function inviteButton(): CapturedButton {
  const button: CapturedButton | undefined =
    capturedTableProps?.cardProps?.buttons?.find(
      (candidate: CapturedButton): boolean => {
        return candidate.title === "Invite User";
      },
    );

  expect(button).toBeDefined();

  return button!;
}

async function openInviteModal(): Promise<HTMLElement> {
  await renderPage();

  await act(async (): Promise<void> => {
    inviteButton().onClick();
  });

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByPlaceholderText("member@company.com");

  // BasicForm settles its fields and starting values in effects.
  await act(async (): Promise<void> => {});

  return modal;
}

/*
 * The Team field with a team picked: a button named by the field's label,
 * showing the team - the same role and name the E2E spec clicks
 * (E2E/Tests/Dashboard/InviteUser.spec.ts). With none picked it is the
 * search box instead.
 */
function teamValue(modal: HTMLElement): HTMLElement | null {
  return within(modal).queryByRole("button", { name: "Team" });
}

async function typeEmail(modal: HTMLElement, email: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(within(modal).getByPlaceholderText("member@company.com"), {
      target: { value: email },
    });
  });
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(modal).getByRole("button", { name: "Invite" }));
  });
}

function sentTeamId(): string | undefined {
  const request: any = createOrUpdateMock.mock.calls[0]![0];
  const model: TeamMember = request.model;

  return model.team?._id?.toString() || model.teamId?.toString();
}

describe("Invite User", () => {
  test("starts on a new project's Members team, and says so", async () => {
    const modal: HTMLElement = await openInviteModal();

    await waitFor(() => {
      expect(teamValue(modal)).not.toBeNull();
    });

    expect(teamValue(modal)).toHaveTextContent("Members");
    expect(
      within(modal).getByText(
        "Their team decides what they can do in this project. Members is picked to start with; choose another team to give them different access.",
      ),
    ).toBeInTheDocument();

    // Nothing left to pick: the search box shows only when no team is.
    expect(within(modal).queryByPlaceholderText("Select a team")).toBeNull();
  });

  test("invites to it without touching the team", async () => {
    const modal: HTMLElement = await openInviteModal();

    // Shown as picked: what is on screen is what is sent.
    await waitFor(() => {
      expect(teamValue(modal)).toHaveTextContent("Members");
    });

    await typeEmail(modal, "new.person@example.com");
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentTeamId()).toBe(MEMBERS_ID);
    expect(createOrUpdateMock.mock.calls[0]![0].miscDataProps).toEqual(
      expect.objectContaining({ email: "new.person@example.com" }),
    );
  });

  test("another team can be picked instead", async () => {
    const modal: HTMLElement = await openInviteModal();

    await waitFor(() => {
      expect(teamValue(modal)).not.toBeNull();
    });

    fireEvent.click(teamValue(modal)!);

    const owners: HTMLElement = await waitFor((): HTMLElement => {
      const found: HTMLElement | undefined = screen
        .getAllByRole("option")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").includes("Owners");
        });

      if (!found) {
        throw new Error("No Owners option yet");
      }

      return found;
    });

    fireEvent.click(owners);

    await waitFor(() => {
      expect(teamValue(modal)).toHaveTextContent("Owners");
    });

    await typeEmail(modal, "new.person@example.com");
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentTeamId()).toBe(OWNERS_ID);
  });

  test("a renamed members team is still the one picked", async () => {
    teams = [team(OWNERS_ID, "Owners"), team(MEMBERS_ID, "Engineering")];
    teamPermissions = [
      teamPermission(OWNERS_ID, Permission.ProjectOwner),
      teamPermission(MEMBERS_ID, Permission.ProjectMember),
    ];

    const modal: HTMLElement = await openInviteModal();

    await waitFor(() => {
      expect(
        within(modal).getByText(
          "Their team decides what they can do in this project. Engineering is picked to start with; choose another team to give them different access.",
        ),
      ).toBeInTheDocument();
    });

    await typeEmail(modal, "new.person@example.com");
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentTeamId()).toBe(MEMBERS_ID);
  });

  test("looks the team up in the project's teams and their permissions", async () => {
    await openInviteModal();

    const lookups: Array<any> = getListMock.mock.calls
      .map((args: Array<any>): any => {
        return args[0];
      })
      .filter((params: any): boolean => {
        return params.modelType === TeamPermission;
      });

    expect(lookups).toHaveLength(1);
    expect(lookups[0].query).toEqual({ projectId: PROJECT_ID });
  });
});

describe("Invite User picks nothing", () => {
  async function expectNothingPicked(modal: HTMLElement): Promise<void> {
    expect(
      await within(modal).findByPlaceholderText("Select a team"),
    ).toBeInTheDocument();
    expect(teamValue(modal)).toBeNull();
    expect(
      within(modal).getByText(
        "Their team decides what they can do in this project.",
      ),
    ).toBeInTheDocument();
  }

  test("when the project has no members team", async () => {
    teams = [team(OWNERS_ID, "Owners"), team(ADMIN_ID, "Admin")];
    teamPermissions = [
      teamPermission(OWNERS_ID, Permission.ProjectOwner),
      teamPermission(ADMIN_ID, Permission.ProjectAdmin),
    ];

    await expectNothingPicked(await openInviteModal());
  });

  test("for a Project Admin outside Members, whom the server would refuse", async () => {
    holding([Permission.ProjectAdmin]);

    await expectNothingPicked(await openInviteModal());
  });

  test("when the teams cannot be read, and the dialog still opens", async () => {
    failLookup = true;

    const modal: HTMLElement = await openInviteModal();

    await expectNothingPicked(modal);

    // The invitation itself still works: the team is picked by hand.
    expect(
      within(modal).getByPlaceholderText("member@company.com"),
    ).toBeInTheDocument();
  });

  test("and the invitation cannot be sent without a team", async () => {
    teams = [team(OWNERS_ID, "Owners")];
    teamPermissions = [teamPermission(OWNERS_ID, Permission.ProjectOwner)];

    const modal: HTMLElement = await openInviteModal();

    await typeEmail(modal, "new.person@example.com");
    await submit(modal);

    expect(
      await within(modal).findByText("Team is required."),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("while Invite User looks the team up", () => {
  test("its button shows it is busy, and a second click opens nothing more", async () => {
    let release: () => void = (): void => {};
    holdLookup = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    await renderPage();

    await act(async (): Promise<void> => {
      inviteButton().onClick();
    });

    await waitFor(() => {
      expect(inviteButton().isLoading).toBe(true);
    });
    expect(screen.queryByTestId("modal")).toBeNull();

    await act(async (): Promise<void> => {
      inviteButton().onClick();
    });

    await act(async (): Promise<void> => {
      release();
    });

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(modal).toBeInTheDocument();
    expect(screen.getAllByTestId("modal")).toHaveLength(1);

    await waitFor(() => {
      expect(inviteButton().isLoading).toBe(false);
    });

    const lookups: number = getListMock.mock.calls.filter(
      (args: Array<any>): boolean => {
        return args[0].modelType === TeamPermission;
      },
    ).length;

    expect(lookups).toBe(1);
  });
});
