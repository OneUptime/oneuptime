import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { MemoryRouter } from "react-router-dom";

/*
 * REMOVE FROM PROJECT, SAID BEFORE IT IS PRESSED (#6599).
 *
 * Someone whose Remove Team Members reaches only the teams they own cannot
 * take a person off a team they do not, so the server refuses their Remove
 * from Project - but the refusal came after the confirmation. Now, for
 * such a reader, the Users list asks the server about the people it shows
 * (POST /team-member/project-removal-reach) and locks Remove from Project
 * for whoever would stay: in the row's menu, with the teams that keep
 * them; in Bulk Actions, whose dialog says who stays and whose run lists
 * them as not removed (the row lock is what the bulk delete checks); and
 * on the person's own page. A reader who may remove people across the
 * whole project, or nobody at all, is never asked about.
 */

let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // Every permission the rows below grant, as the snapshot holds them.
      getAllPermissions: (): Array<string> => {
        return (
          (
            projectPermissionsForTest as {
              permissions?: Array<{ permission: string }>;
            } | null
          )?.permissions || []
        ).map((row: { permission: string }): string => {
          return row.permission;
        });
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

type CapturedTableProps = {
  onFetchSuccess?: ((rows: Array<TeamMember>) => void) | undefined;
  getDeleteDisabledReason?:
    | ((row: TeamMember) => string | undefined)
    | undefined;
  bulkActions?:
    | {
        deleteConfirmationDetails?:
          | ((items: Array<TeamMember>, controls: unknown) => ReactElement)
          | undefined;
      }
    | undefined;
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

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import RemoveUserFromProject from "../../../../App/FeatureSet/Dashboard/src/Components/User/RemoveUserFromProject";
import TeamMembershipRemoval from "../../../../App/FeatureSet/Dashboard/src/Utils/TeamMembershipRemoval";
import { getProjectRemovalLockReason } from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectRemovalReach";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { PROJECT_REMOVAL_REACH_ROUTE } from "../../../Types/Team/ProjectRemovalReach";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";

const PROJECT_ID: ObjectID = new ObjectID(
  "71100000-0000-4000-8000-000000000001",
);
const GRACE: string = "71200000-0000-4000-8000-000000000001";
const ALAN: string = "71200000-0000-4000-8000-000000000002";

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

// May remove people only from the teams they own.
const REMOVES_FROM_OWN_TEAMS: Array<{
  permission: Permission;
  scope: PermissionScope;
}> = [
  { permission: Permission.ProjectMember, scope: PermissionScope.All },
  {
    permission: Permission.RemoveProjectTeamMembers,
    scope: PermissionScope.Owned,
  },
];

function row(
  userId: string,
  name: string,
  teamNames: Array<string>,
): TeamMember {
  const membership: TeamMember = new TeamMember();
  membership._id = ObjectID.generate().toString();
  membership.userId = new ObjectID(userId);
  membership.projectId = PROJECT_ID;
  membership.hasAcceptedInvitation = true;

  const user: User = new User();
  user._id = userId;
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  membership.user = user;

  (membership as unknown as { teamsForUser: Array<Team> }).teamsForUser =
    teamNames.map((teamName: string): Team => {
      const team: Team = new Team();
      team._id = ObjectID.generate().toString();
      team.name = teamName;
      return team;
    });

  return membership;
}

type ReachAnswer = "answer" | "fails" | "throws";

let reachAnswer: ReachAnswer = "answer";
let reachPeople: Array<JSONObject> = [];
let reachAsks: Array<JSONObject> = [];

beforeEach(() => {
  standInForGlobalConfig();
  capturedTableProps = null;
  reachAnswer = "answer";
  reachAsks = [];
  reachPeople = [
    {
      userId: GRACE,
      teamNames: ["Security", "Platform"],
      hiddenTeamCount: 0,
      hasTeamInReach: true,
    },
  ];

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url?.toString() || "";

        if (!url.endsWith(PROJECT_REMOVAL_REACH_ROUTE)) {
          return new HTTPResponse<JSONObject>(200, {}, {});
        }

        reachAsks.push(options.data as JSONObject);

        if (reachAnswer === "throws") {
          throw new Error("network down");
        }

        if (reachAnswer === "fails") {
          return new HTTPErrorResponse(500, { message: "Not now." }, {});
        }

        return new HTTPResponse<JSONObject>(200, { people: reachPeople }, {});
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

async function renderUsers(): Promise<void> {
  render(
    <MemoryRouter>
      <Users
        pageRoute={new Route(`/dashboard/${PROJECT_ID.toString()}/users`)}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
}

async function showRows(rows: Array<TeamMember>): Promise<void> {
  await act(async () => {
    capturedTableProps!.onFetchSuccess!(rows);
  });
  await flush();
}

const GRACE_ROW: () => TeamMember = (): TeamMember => {
  return row(GRACE, "Grace Member", ["Mine", "Platform", "Security"]);
};
const ALAN_ROW: () => TeamMember = (): TeamMember => {
  return row(ALAN, "Alan Turing", ["Mine"]);
};

describe("the Users list, for someone who removes people only from the teams they own", () => {
  beforeEach(() => {
    holding(REMOVES_FROM_OWN_TEAMS);
  });

  test("asks the server about the people on the page, by user id", async () => {
    await renderUsers();
    await showRows([GRACE_ROW(), ALAN_ROW()]);

    expect(reachAsks).toEqual([{ userIds: [GRACE, ALAN] }]);
  });

  test("locks Remove from Project for whoever would stay, naming the teams that keep them and where to go instead", async () => {
    await renderUsers();
    await showRows([GRACE_ROW(), ALAN_ROW()]);

    expect(capturedTableProps!.getDeleteDisabledReason!(GRACE_ROW())).toBe(
      "Your role can't remove people from Platform and Security, so they would stay in this project. Remove them from your teams on their Teams page instead.",
    );
  });

  test("leaves it open for someone the reader may take off every team", async () => {
    await renderUsers();
    await showRows([GRACE_ROW(), ALAN_ROW()]);

    expect(
      capturedTableProps!.getDeleteDisabledReason!(ALAN_ROW()),
    ).toBeUndefined();
  });

  test("counts the teams the reader may not read, never naming them", async () => {
    reachPeople = [
      {
        userId: GRACE,
        teamNames: ["Platform"],
        hiddenTeamCount: 2,
        hasTeamInReach: true,
      },
      {
        userId: ALAN,
        teamNames: [],
        hiddenTeamCount: 1,
        hasTeamInReach: false,
      },
    ];

    await renderUsers();
    await showRows([GRACE_ROW(), ALAN_ROW()]);

    expect(capturedTableProps!.getDeleteDisabledReason!(GRACE_ROW())).toBe(
      "Your role can't remove people from Platform and 2 other teams, so they would stay in this project. Remove them from your teams on their Teams page instead.",
    );
    // No team of theirs to take them off: nowhere else to send the reader.
    expect(capturedTableProps!.getDeleteDisabledReason!(ALAN_ROW())).toBe(
      "Your role can't remove people from 1 of their teams, so they would stay in this project.",
    );
  });

  test.each([
    ["fails", "fails"],
    ["cannot be reached", "throws"],
  ] as Array<[string, ReachAnswer]>)(
    "locks nothing when the answer %s: the server still refuses, and says why",
    async (_case: string, answer: ReachAnswer) => {
      reachAnswer = answer;

      await renderUsers();
      await showRows([GRACE_ROW()]);

      expect(reachAsks).toHaveLength(1);
      expect(
        capturedTableProps!.getDeleteDisabledReason!(GRACE_ROW()),
      ).toBeUndefined();
    },
  );

  test("keeps what an earlier page said, and a page read again replaces what it said of its own people", async () => {
    await renderUsers();
    await showRows([GRACE_ROW()]);

    // The next page: Alan only. Grace is still known to stay.
    reachPeople = [];
    await showRows([ALAN_ROW()]);

    expect(
      capturedTableProps!.getDeleteDisabledReason!(GRACE_ROW()),
    ).toBeDefined();

    // The first page again: Grace may go now.
    await showRows([GRACE_ROW()]);

    expect(
      capturedTableProps!.getDeleteDisabledReason!(GRACE_ROW()),
    ).toBeUndefined();
  });

  test("the bulk Remove from Project's dialog says who stays, before it runs", async () => {
    await renderUsers();
    await showRows([GRACE_ROW(), ALAN_ROW()]);

    render(
      capturedTableProps!.bulkActions!.deleteConfirmationDetails!(
        [GRACE_ROW(), ALAN_ROW()],
        { setIsSubmitHeld: () => {} },
      ),
    );

    expect(screen.getByTestId("project-removal-bulk-kept")).toHaveTextContent(
      "1 of the selected people stays in this project, because your role can't remove them from all of their teams:",
    );
    expect(
      screen
        .getAllByTestId("project-removal-bulk-kept-person")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Grace Member (grace@example.com)"]);
  });

  test("the bulk dialog says nothing more when everyone selected may go", async () => {
    await renderUsers();
    await showRows([GRACE_ROW(), ALAN_ROW()]);

    const { container } = render(
      capturedTableProps!.bulkActions!.deleteConfirmationDetails!(
        [ALAN_ROW()],
        { setIsSubmitHeld: () => {} },
      ),
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the Users list, for anyone else", () => {
  test.each([
    [
      "a Project Admin",
      [{ permission: Permission.ProjectAdmin, scope: PermissionScope.All }],
    ],
    [
      "someone who removes people from every team",
      [
        { permission: Permission.ProjectMember, scope: PermissionScope.All },
        {
          permission: Permission.RemoveProjectTeamMembers,
          scope: PermissionScope.All,
        },
      ],
    ],
    [
      "someone who may remove nobody",
      [{ permission: Permission.ProjectMember, scope: PermissionScope.All }],
    ],
  ])(
    "never asks for %s, and locks nothing",
    async (
      _reader: string,
      rows: Array<{ permission: Permission; scope: PermissionScope }>,
    ) => {
      holding(rows);

      await renderUsers();
      await showRows([GRACE_ROW(), ALAN_ROW()]);

      expect(reachAsks).toEqual([]);
      expect(
        capturedTableProps!.getDeleteDisabledReason!(GRACE_ROW()),
      ).toBeUndefined();
    },
  );
});

describe("the person's page", () => {
  const GRACE_ID: ObjectID = new ObjectID(GRACE);

  beforeEach(() => {
    jest
      .spyOn(TeamMembershipRemoval, "fetchUserMemberships")
      .mockResolvedValue([GRACE_ROW()]);
  });

  async function renderPersonPage(): Promise<void> {
    render(
      <MemoryRouter>
        <RemoveUserFromProject
          projectId={PROJECT_ID}
          userId={GRACE_ID}
          onActionComplete={() => {}}
          onError={() => {}}
        />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: /Remove from Project/ });
  }

  test("locks Remove from Project for someone the reader's role would leave, and says why in place of what removing would do", async () => {
    holding(REMOVES_FROM_OWN_TEAMS);

    await renderPersonPage();

    expect(reachAsks).toEqual([{ userIds: [GRACE] }]);
    expect(
      screen.getByText(
        "Your role can't remove people from Platform and Security, so they would stay in this project. Remove them from your teams on their Teams page instead.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Remove Grace Member \(grace@example.com\) from this project/,
      ),
    ).toBeNull();

    const button: HTMLElement = screen.getByRole("button", {
      name: /Remove from Project/,
    });

    expect(
      button.hasAttribute("disabled") ||
        button.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  test("offers it as before when the reader may take them off every team", async () => {
    holding(REMOVES_FROM_OWN_TEAMS);
    reachPeople = [];

    await renderPersonPage();

    expect(
      screen.getByText(
        /Remove Grace Member \(grace@example.com\) from this project/,
      ),
    ).toBeInTheDocument();

    const button: HTMLElement = screen.getByRole("button", {
      name: /Remove from Project/,
    });

    expect(button).not.toBeDisabled();
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
  });

  test("never asks for a Project Admin", async () => {
    holding([
      { permission: Permission.ProjectAdmin, scope: PermissionScope.All },
    ]);

    await renderPersonPage();

    expect(reachAsks).toEqual([]);
    expect(
      screen.getByText(
        /Remove Grace Member \(grace@example.com\) from this project/,
      ),
    ).toBeInTheDocument();
  });
});

describe("the lock's words", () => {
  test("list five teams by name, then count the rest", () => {
    expect(
      getProjectRemovalLockReason(
        {
          userId: GRACE,
          teamNames: ["A", "B", "C", "D", "E", "F", "G"],
          hiddenTeamCount: 0,
          hasTeamInReach: false,
        },
        getGlobalTranslator(),
      ),
    ).toBe(
      "Your role can't remove people from A, B, C, D, E and 2 more, so they would stay in this project.",
    );
  });

  test("name one team on its own", () => {
    expect(
      getProjectRemovalLockReason(
        {
          userId: GRACE,
          teamNames: ["Platform"],
          hiddenTeamCount: 0,
          hasTeamInReach: false,
        },
        getGlobalTranslator(),
      ),
    ).toBe(
      "Your role can't remove people from Platform, so they would stay in this project.",
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "read in %s's words, with the team names as written",
    (language: string) => {
      const reason: string = getProjectRemovalLockReason(
        {
          userId: GRACE,
          teamNames: ["Platform", "Security"],
          hiddenTeamCount: 1,
          hasTeamInReach: true,
        },
        dashboardTranslator(language),
      );

      expect(reason).toContain("Platform");
      expect(reason).toContain("Security");
      expect(reason).not.toContain("Your role can't remove people");
      expect(reason).not.toContain("{{");
    },
  );
});
