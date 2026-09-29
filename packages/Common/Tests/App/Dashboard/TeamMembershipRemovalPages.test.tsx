import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
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

/*
 * The three tables a user can be removed from, and what each now says before
 * it does it:
 *
 *   - Users > View User > Teams     - one of this user's teams
 *   - Teams > View Team > Members   - this team's member
 *   - Users                         - the whole project
 *
 * The first is the one in the bug report: "Are you sure you want to delete
 * this  ?", then, on removing the last team, the user silently vanished from
 * the project while the admin was left on the page with a live "Remove from
 * Project" and no way to tell what had happened.
 *
 * TeamMembershipRemoval.test.ts pins the words. This file pins that each page
 * actually asks for them - a dropped prop brings the blank dialog straight
 * back with every unit test still green - and that the Teams tab leaves the
 * page once the user is gone.
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
 * A stand-in ModelTable that records its props, as in
 * UsersTableGroupsByPerson.test.tsx: what matters here is what each page hands
 * the table, and what those callbacks do when the table calls them.
 */
type CapturedTableProps = {
  deleteButtonText?: string | undefined;
  getDeleteConfirmation?:
    | ((item: TeamMember) => Promise<DeleteConfirmation>)
    | undefined;
  onItemDeleted?: ((item: TeamMember) => void) | undefined;
  bulkActions?:
    | {
        deleteConfirmationWarning?: string | undefined;
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

import UserViewTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/Teams";
import TeamViewMembers from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Members";
import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { DeleteConfirmation } from "../../../UI/Components/ModelTable/BaseModelTable";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import TeamMembersByUser, {
  ProjectUserRow,
} from "../../../UI/Utils/TeamMembersByUser";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000aa");
const TEAM_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000bb");

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

type MembershipSpec = {
  id: string;
  teamName?: string | undefined;
  accepted?: boolean | undefined;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const membership: TeamMember = new TeamMember();
  membership._id = spec.id;
  membership.userId = USER_ID;
  membership.projectId = PROJECT_ID;
  membership.hasAcceptedInvitation = spec.accepted ?? true;

  const user: User = new User();
  user._id = USER_ID.toString();
  user.name = new Name("Jane Doe");
  user.email = new Email("jane@example.com");
  membership.user = user;

  if (spec.teamName) {
    const team: Team = new Team();
    team._id = `team-${spec.id}`;
    team.name = spec.teamName;
    membership.team = team;
  }

  return membership;
};

const asList: (memberships: Array<TeamMember>) => ListResult<TeamMember> = (
  memberships: Array<TeamMember>,
): ListResult<TeamMember> => {
  return {
    data: memberships,
    count: memberships.length,
    skip: 0,
    limit: memberships.length,
  };
};

/*
 * Hand-rolled, as in ProjectUsersModelAPI.test.ts: the installed jest typings
 * cannot describe a spy on a generic static without collapsing it.
 */
interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

let getListSpy: Spy;
let countSpy: Spy;
let navigateSpy: Spy;

const pageProps: {
  pageRoute: Route;
  currentProject: Project;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/dashboard/users"),
  currentProject: currentProject,
  hasPaymentMethod: true,
};

type RenderPageFunction = (page: React.ReactElement) => Promise<void>;

const renderPage: RenderPageFunction = async (
  page: React.ReactElement,
): Promise<void> => {
  render(<MemoryRouter>{page}</MemoryRouter>);

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
};

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 5; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
};

beforeEach(() => {
  capturedTableProps = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
  // Members and Users count SCIM configs on mount; the Teams tab counts memberships.
  countSpy = jest.spyOn(ModelAPI, "count") as unknown as Spy;
  countSpy.mockResolvedValue(0);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation((() => {
    return undefined;
  }) as never) as unknown as Spy;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Users > View User > Teams", () => {
  beforeEach(async () => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(USER_ID);

    await renderPage(<UserViewTeams {...pageProps} />);
  });

  test("still labels the row action Remove", () => {
    expect(capturedTableProps!.deleteButtonText).toBe("Remove");
  });

  test("asks for a confirmation that names the user and team, instead of 'delete this  ?'", async () => {
    getListSpy.mockResolvedValue(
      asList([
        buildMembership({ id: "m1", teamName: "Members" }),
        buildMembership({ id: "m2", teamName: "Owners" }),
      ]),
    );

    expect(capturedTableProps!.getDeleteConfirmation).toBeDefined();

    const row: TeamMember = new TeamMember();
    row._id = "m1";

    const confirmation: DeleteConfirmation =
      await capturedTableProps!.getDeleteConfirmation!(row);

    expect(confirmation.description).toContain(
      "Remove Jane Doe (jane@example.com) from the Members team?",
    );
    expect(confirmation.description).toContain(
      "will stay in this project through their other team: Owners.",
    );
    expect(confirmation.title).toBe("Remove from Team");
  });

  test("reads the memberships of the user whose page this is", async () => {
    getListSpy.mockResolvedValue(
      asList([buildMembership({ id: "m1", teamName: "Members" })]),
    );

    const row: TeamMember = new TeamMember();
    row._id = "m1";

    await capturedTableProps!.getDeleteConfirmation!(row);

    const query: Record<string, unknown> = (
      getListSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["userId"]).toBe(USER_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
  });

  // The bug report's scenario: the last team.
  test("warns that removing the last team removes the user from the project", async () => {
    getListSpy.mockResolvedValue(
      asList([buildMembership({ id: "m1", teamName: "Members" })]),
    );

    const row: TeamMember = new TeamMember();
    row._id = "m1";

    const confirmation: DeleteConfirmation =
      await capturedTableProps!.getDeleteConfirmation!(row);

    expect(confirmation.title).toBe("Remove from Team and Project");
    expect(confirmation.submitButtonText).toBe("Remove from Team and Project");
    expect(confirmation.description).toContain(
      "so they will also be removed from the project",
    );
  });

  describe("after a removal", () => {
    test("goes to the Users list once the user is no longer in the project", async () => {
      countSpy.mockResolvedValue(0);

      capturedTableProps!.onItemDeleted!(buildMembership({ id: "m1" }));
      await flush();

      expect(navigateSpy.mock.calls).toHaveLength(1);
      expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.USERS] as Route,
        ).toString(),
      );

      const countQuery: Record<string, unknown> = (
        countSpy.mock.calls[countSpy.mock.calls.length - 1]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(countQuery).toEqual({ userId: USER_ID, projectId: PROJECT_ID });
    });

    test("stays put while the user still has a team here", async () => {
      countSpy.mockResolvedValue(2);

      capturedTableProps!.onItemDeleted!(buildMembership({ id: "m1" }));
      await flush();

      expect(navigateSpy.mock.calls).toHaveLength(0);
    });

    test("stays put, quietly, if it cannot find out", async () => {
      countSpy.mockImplementation(async (): Promise<number> => {
        throw new Error("network down");
      });

      expect(() => {
        capturedTableProps!.onItemDeleted!(buildMembership({ id: "m1" }));
      }).not.toThrow();
      await flush();

      expect(navigateSpy.mock.calls).toHaveLength(0);
    });
  });
});

describe("Teams > View Team > Members", () => {
  beforeEach(async () => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(TEAM_ID);

    await renderPage(<TeamViewMembers {...pageProps} />);
  });

  test("asks for the same confirmation, reading the user off the row", async () => {
    getListSpy.mockResolvedValue(
      asList([buildMembership({ id: "m1", teamName: "Backend" })]),
    );

    expect(capturedTableProps!.getDeleteConfirmation).toBeDefined();

    const confirmation: DeleteConfirmation = await capturedTableProps!
      .getDeleteConfirmation!(buildMembership({ id: "m1" }));

    const query: Record<string, unknown> = (
      getListSpy.mock.calls[getListSpy.mock.calls.length - 1]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(query["userId"]).toBe(USER_ID);
    expect(confirmation.description).toContain(
      "Remove Jane Doe (jane@example.com) from the Backend team?",
    );
    expect(confirmation.title).toBe("Remove from Team and Project");
  });

  test("warns on bulk removal that a last team takes the project with it", () => {
    expect(
      capturedTableProps!.bulkActions?.deleteConfirmationWarning,
    ).toContain("also be removed from the project");
  });
});

describe("Users (the whole project)", () => {
  beforeEach(async () => {
    await renderPage(<Users {...pageProps} />);
  });

  const groupedRow: (specs: Array<MembershipSpec>) => ProjectUserRow = (
    specs: Array<MembershipSpec>,
  ): ProjectUserRow => {
    return TeamMembersByUser.groupByUser(specs.map(buildMembership))[0]!;
  };

  test("says Remove from Project and names every team, instead of 'Delete User'", async () => {
    const confirmation: DeleteConfirmation = await capturedTableProps!
      .getDeleteConfirmation!(
      groupedRow([
        { id: "m1", teamName: "Owners" },
        { id: "m2", teamName: "SRE" },
      ]),
    );

    expect(confirmation.title).toBe("Remove from Project");
    expect(confirmation.submitButtonText).toBe("Remove from Project");
    expect(confirmation.description).toContain(
      "Remove Jane Doe (jane@example.com) from this project?",
    );
    expect(confirmation.description).toContain(
      "all 2 of their teams (Owners and SRE)",
    );
  });

  // The grouped row already has the teams; asking the server again is waste.
  test("builds it from the row without another request", async () => {
    const callsBefore: number = getListSpy.mock.calls.length;

    await capturedTableProps!.getDeleteConfirmation!(
      groupedRow([{ id: "m1", teamName: "Owners" }]),
    );

    expect(getListSpy.mock.calls.length).toBe(callsBefore);
  });

  test("describes someone who never joined as a cancelled invitation", async () => {
    const confirmation: DeleteConfirmation = await capturedTableProps!
      .getDeleteConfirmation!(
      groupedRow([{ id: "m1", teamName: "Owners", accepted: false }]),
    );

    expect(confirmation.description).toContain(
      "They have not accepted an invitation to this project yet.",
    );
  });

  test("warns on bulk removal that every team goes", () => {
    expect(
      capturedTableProps!.bulkActions?.deleteConfirmationWarning,
    ).toContain("removed from every team in this project");
  });
});
