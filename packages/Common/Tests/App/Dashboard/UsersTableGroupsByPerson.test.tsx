import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
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
 * The customer-facing bug this whole change exists for: Settings > Users
 * listed TeamMember, a (user, team) join row, so one person on three teams
 * filled three rows with the same name and avatar and read as three different
 * people.
 *
 * The unit suites cover the grouping util and the API class. Neither of them
 * touches the page, and the fix on the page is a single prop -
 * modelAPI={ProjectUsersModelAPI} - whose loss brings every duplicate straight
 * back with no test failing. That prop, the column that now has to render a
 * list of teams rather than one, and the row's derived status are what this
 * file pins.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
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

/*
 * The page is rendered through a stand-in ModelTable that records the props it
 * was given. Rendering the real one would drag in the facet bar, the URL
 * state and the pager, none of which this file is about - what matters is
 * which API the page hands the table, and what its columns do with a grouped
 * row.
 */
type CapturedTableProps = {
  modelAPI?: unknown;
  columns: Array<{
    title: string;
    disableSort?: boolean | undefined;
    getElement?: ((item: TeamMember) => ReactElement) | undefined;
    getExportValue?: ((item: TeamMember) => string) | undefined;
  }>;
  deleteButtonText?: string | undefined;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  isDeleteable?: boolean | undefined;
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
import ProjectUsersModelAPI from "../../../UI/Utils/ModelAPI/ProjectUsersModelAPI";
import TeamMembersByUser, {
  ProjectUserRow,
} from "../../../UI/Utils/TeamMembersByUser";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

type MembershipSpec = {
  id: string;
  userId: string;
  userName?: string | undefined;
  teamId?: string | undefined;
  teamName?: string | undefined;
  hasAcceptedInvitation?: boolean | undefined;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const teamMember: TeamMember = new TeamMember();

  teamMember._id = spec.id;
  teamMember.userId = new ObjectID(spec.userId);
  teamMember.projectId = PROJECT_ID;
  teamMember.hasAcceptedInvitation = spec.hasAcceptedInvitation ?? true;

  const user: User = new User();
  user._id = spec.userId;

  if (spec.userName) {
    user.name = new Name(spec.userName);
  }

  teamMember.user = user;

  if (spec.teamId) {
    teamMember.teamId = new ObjectID(spec.teamId);

    const team: Team = new Team();
    team._id = spec.teamId;
    team.name = spec.teamName || spec.teamId;
    teamMember.team = team;
  }

  return teamMember;
};

/*
 * A row exactly as ProjectUsersModelAPI hands it to the table, built by the
 * real grouping code rather than hand-written, so a change in the shape of a
 * grouped row cannot leave these assertions passing against a shape the page
 * never actually receives.
 */
const buildGroupedRow: (
  memberships: Array<MembershipSpec>,
) => ProjectUserRow = (memberships: Array<MembershipSpec>): ProjectUserRow => {
  return TeamMembersByUser.groupByUser(memberships.map(buildMembership))[0]!;
};

type ColumnOf = (title: string) => CapturedTableProps["columns"][0];

const columnTitled: ColumnOf = (
  title: string,
): CapturedTableProps["columns"][0] => {
  const column: CapturedTableProps["columns"][0] | undefined =
    capturedTableProps?.columns.find(
      (candidate: CapturedTableProps["columns"][0]) => {
        return candidate.title === title;
      },
    );

  if (!column) {
    throw new Error(
      `No "${title}" column. Columns: ${(capturedTableProps?.columns || [])
        .map((candidate: CapturedTableProps["columns"][0]) => {
          return candidate.title;
        })
        .join(", ")}`,
    );
  }

  return column;
};

type RenderCellFunction = (title: string, row: ProjectUserRow) => void;

const renderCell: RenderCellFunction = (
  title: string,
  row: ProjectUserRow,
): void => {
  render(<MemoryRouter>{columnTitled(title).getElement!(row)}</MemoryRouter>);
};

describe("Settings > Users page", () => {
  beforeEach(async () => {
    capturedTableProps = null;

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    // The page counts SCIM configs on mount to decide whether to warn.
    jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the fix itself", () => {
    /*
     * If this fails, every user on more than one team is back to occupying one
     * row per team - which is the bug customers reported.
     */
    test("lists people, not memberships, by using the grouping API", () => {
      expect(capturedTableProps!.modelAPI).toBe(ProjectUsersModelAPI);
    });

    test("names its rows after people", () => {
      expect(capturedTableProps!.singularName).toBe("User");
      expect(capturedTableProps!.pluralName).toBe("Users");
    });
  });

  describe("the Teams column", () => {
    test("shows every team the person belongs to, not just one", () => {
      renderCell(
        "Teams",
        buildGroupedRow([
          {
            id: "m1",
            userId: "u1",
            userName: "Thomas Stock",
            teamId: "t1",
            teamName: "NTW_Online Operations",
          },
          {
            id: "m2",
            userId: "u1",
            userName: "Thomas Stock",
            teamId: "t2",
            teamName: "Owners",
          },
        ]),
      );

      expect(screen.getByText("NTW_Online Operations")).toBeInTheDocument();
      expect(screen.getByText("Owners")).toBeInTheDocument();
    });

    test("collapses a long team list behind a 'more' control rather than growing the row", () => {
      renderCell(
        "Teams",
        buildGroupedRow([
          { id: "m1", userId: "u1", teamId: "t1", teamName: "Alpha" },
          { id: "m2", userId: "u1", teamId: "t2", teamName: "Bravo" },
          { id: "m3", userId: "u1", teamId: "t3", teamName: "Charlie" },
          { id: "m4", userId: "u1", teamId: "t4", teamName: "Delta" },
          { id: "m5", userId: "u1", teamId: "t5", teamName: "Echo" },
        ]),
      );

      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.queryByText("Echo")).not.toBeInTheDocument();
      expect(screen.getByText("2 more teams")).toBeInTheDocument();
    });

    test("says so when the person is on no team at all", () => {
      renderCell(
        "Teams",
        buildGroupedRow([{ id: "m1", userId: "u1", userName: "Nobody" }]),
      );

      expect(screen.getByText("No team assigned")).toBeInTheDocument();
    });

    /*
     * The exporter is column-driven and would otherwise fall back to the
     * single `team` on the membership the row was built from, so the CSV would
     * quietly disagree with the cell beside it.
     */
    test("exports every team, not the one the row was built from", () => {
      const row: ProjectUserRow = buildGroupedRow([
        { id: "m1", userId: "u1", teamId: "t1", teamName: "Engineering" },
        { id: "m2", userId: "u1", teamId: "t2", teamName: "On-Call" },
        { id: "m3", userId: "u1", teamId: "t3", teamName: "Admins" },
      ]);

      expect(columnTitled("Teams").getExportValue!(row)).toBe(
        "Admins; Engineering; On-Call",
      );
    });

    test("exports an empty cell rather than crashing on a team-less row", () => {
      const row: ProjectUserRow = buildGroupedRow([
        { id: "m1", userId: "u1", userName: "Nobody" },
      ]);

      expect(columnTitled("Teams").getExportValue!(row)).toBe("");
    });
  });

  describe("the Status column", () => {
    test("reads Member once any invitation has been accepted", () => {
      renderCell(
        "Status",
        buildGroupedRow([
          {
            id: "m1",
            userId: "u1",
            teamId: "t1",
            hasAcceptedInvitation: true,
          },
        ]),
      );

      expect(screen.getByText("Member")).toBeInTheDocument();
      expect(screen.queryByText(/Pending/)).not.toBeInTheDocument();
    });

    test("reads Invitation Sent while nothing has been accepted", () => {
      renderCell(
        "Status",
        buildGroupedRow([
          {
            id: "m1",
            userId: "u1",
            teamId: "t1",
            hasAcceptedInvitation: false,
          },
          {
            id: "m2",
            userId: "u1",
            teamId: "t2",
            hasAcceptedInvitation: false,
          },
        ]),
      );

      expect(screen.getByText("Invitation Sent")).toBeInTheDocument();
      expect(screen.queryByText("Member")).not.toBeInTheDocument();
    });

    /*
     * Per-team invitation state used to be visible because each row WAS one
     * team. On a grouped row it would disappear entirely without this.
     */
    test("still surfaces invitations the person has not accepted yet", () => {
      renderCell(
        "Status",
        buildGroupedRow([
          {
            id: "m1",
            userId: "u1",
            teamId: "t1",
            hasAcceptedInvitation: true,
          },
          {
            id: "m2",
            userId: "u1",
            teamId: "t2",
            hasAcceptedInvitation: false,
          },
          {
            id: "m3",
            userId: "u1",
            teamId: "t3",
            hasAcceptedInvitation: false,
          },
        ]),
      );

      expect(screen.getByText("Member")).toBeInTheDocument();
      expect(screen.getByText("2 Invitations Pending")).toBeInTheDocument();
    });

    test("counts a single pending invitation in the singular", () => {
      renderCell(
        "Status",
        buildGroupedRow([
          {
            id: "m1",
            userId: "u1",
            teamId: "t1",
            hasAcceptedInvitation: true,
          },
          {
            id: "m2",
            userId: "u1",
            teamId: "t2",
            hasAcceptedInvitation: false,
          },
        ]),
      );

      expect(screen.getByText("1 Invitation Pending")).toBeInTheDocument();
    });

    /*
     * The server can only order by the stored per-membership column, which on
     * a grouped row disagrees with the derived one on screen - so the control
     * has to be off rather than visibly not sorting.
     */
    test("offers no sort control, because the value is derived", () => {
      expect(columnTitled("Status").disableSort).toBe(true);
    });
  });

  describe("removing someone", () => {
    test("labels the action as removal from the project, not from a team", () => {
      expect(capturedTableProps!.deleteButtonText).toBe("Remove from Project");
    });
  });
});
