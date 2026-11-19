let mockIsBillingEnabled: boolean = false;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import InviteSuggestions from "../../../../Server/Utils/Team/InviteSuggestions";
import ProjectMemberSearch from "../../../../Server/Utils/Team/ProjectMemberSearch";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../Types/BaseDatabase/Search";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  INVITE_SUGGESTIONS_SERVER_LIMIT,
  InviteSuggestion,
  InviteSuggestionStanding,
} from "../../../../Types/Team/InviteSuggestions";
import { ProjectMemberSearchMatch } from "../../../../Types/Team/ProjectMemberSearch";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S HALF OF AN INVITATION'S SUGGESTIONS (#9701).
 *
 *   - Only for a reader who may see the project's people, as Search is;
 *     anyone else is refused, and nothing is read.
 *   - The project's people come from Search's own read
 *     (ProjectMemberSearch.search), with the reader's own props, in the
 *     request's project: never anyone of another project.
 *   - Only those whose address the reader may see.
 *   - Where each stands, from their memberships of the project, read with
 *     the reader's own props: in the team (accepted, or invited to it),
 *     invited to the project, or a member.
 *   - The server's other accounts only for a master admin of a server
 *     somebody runs: never on Cloud, never to anybody else; each once, not
 *     one already found, as not in this project unless a membership says
 *     otherwise.
 *   - A team named is the request's project's, or the request is refused.
 */

// A spy, as getJestSpyOn hands it back.
type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaa0000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("bbbb0000-0000-4000-8000-000000000001");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "bbbb0000-0000-4000-8000-000000000002",
);

const ADA: ProjectMemberSearchMatch = {
  userId: "cccc0000-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@acme.test",
};
const GRACE: ProjectMemberSearchMatch = {
  userId: "cccc0000-0000-4000-8000-000000000002",
  name: "Grace Hopper",
  email: "grace@acme.test",
};
const LINUS: ProjectMemberSearchMatch = {
  userId: "cccc0000-0000-4000-8000-000000000003",
  name: "Linus",
  email: "linus@acme.test",
};
// Found by name, with no address the reader may see.
const NO_ADDRESS: ProjectMemberSearchMatch = {
  userId: "cccc0000-0000-4000-8000-000000000004",
  name: "Hidden Address",
};

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("dddd0000-0000-4000-8000-000000000001"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  ...MEMBER_PROPS,
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

function membership(
  person: ProjectMemberSearchMatch,
  teamId: ObjectID,
  hasAcceptedInvitation: boolean,
): TeamMember {
  const row: TeamMember = new TeamMember();
  row.userId = new ObjectID(person.userId);
  row.teamId = teamId;
  row.hasAcceptedInvitation = hasAcceptedInvitation;
  return row;
}

function account(person: ProjectMemberSearchMatch): User {
  const user: User = new User();
  user._id = person.userId;
  user.name = person.name as never;
  user.email = person.email as never;
  return user;
}

interface Reads {
  canSee: Spy;
  search: Spy;
  memberships: Spy;
  team: Spy;
  users: Spy;
}

function stubReads(data: {
  canSeeMembers?: boolean;
  people?: Array<ProjectMemberSearchMatch>;
  memberships?: Array<TeamMember>;
  team?: Team | null;
  serverAccounts?: { name?: Array<User>; email?: Array<User> };
}): Reads {
  return {
    canSee: getJestSpyOn(ProjectMemberSearch, "canSeeMembers").mockReturnValue(
      data.canSeeMembers !== false,
    ),
    search: getJestSpyOn(ProjectMemberSearch, "search").mockResolvedValue(
      data.people || [],
    ),
    memberships: getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue(
      data.memberships || [],
    ),
    team: getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(
      data.team === undefined ? new Team() : data.team,
    ),
    users: getJestSpyOn(UserService, "findBy").mockImplementation(
      async (findBy: { query: JSONObject }): Promise<Array<User>> => {
        return findBy.query["name"]
          ? data.serverAccounts?.name || []
          : data.serverAccounts?.email || [];
      },
    ),
  };
}

function suggest(
  props: DatabaseCommonInteractionProps,
  teamId: ObjectID | null = TEAM_ID,
  text: string = "a",
): Promise<Array<InviteSuggestion>> {
  return InviteSuggestions.suggest({
    projectId: PROJECT_ID,
    request: { text: text.length > 1 ? text : "ada", teamId: teamId },
    props: props,
  });
}

beforeEach(() => {
  mockIsBillingEnabled = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may ask", () => {
  test("a reader who may not see the project's people is refused, and nothing is read", async () => {
    const reads: Reads = stubReads({ canSeeMembers: false, people: [ADA] });

    await expect(suggest(MEMBER_PROPS)).rejects.toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(reads.search).not.toHaveBeenCalled();
    expect(reads.memberships).not.toHaveBeenCalled();
    expect(reads.users).not.toHaveBeenCalled();
  });

  test("the reader's own project and props decide what they may see", async () => {
    const reads: Reads = stubReads({ people: [ADA] });

    await suggest(MEMBER_PROPS);

    expect(reads.canSee.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      props: MEMBER_PROPS,
    });
    expect(reads.search.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      text: "ada",
      props: MEMBER_PROPS,
    });
  });
});

describe("the project's people", () => {
  test("each with where they stand for the team being invited to", async () => {
    stubReads({
      people: [ADA, GRACE, LINUS],
      memberships: [
        membership(ADA, TEAM_ID, true),
        membership(GRACE, OTHER_TEAM_ID, true),
        membership(GRACE, TEAM_ID, false),
        membership(LINUS, OTHER_TEAM_ID, false),
      ],
    });

    expect(await suggest(MEMBER_PROPS)).toEqual([
      { ...ADA, standing: InviteSuggestionStanding.InThisTeam },
      { ...GRACE, standing: InviteSuggestionStanding.InvitedToThisTeam },
      { ...LINUS, standing: InviteSuggestionStanding.Invited },
    ]);
  });

  test("for the project, with no team named", async () => {
    const reads: Reads = stubReads({
      people: [ADA],
      memberships: [membership(ADA, TEAM_ID, true)],
    });

    expect(await suggest(MEMBER_PROPS, null)).toEqual([
      { ...ADA, standing: InviteSuggestionStanding.Member },
    ]);
    expect(reads.team).not.toHaveBeenCalled();
  });

  test("only those whose address the reader may see: an invitation goes to an address", async () => {
    stubReads({
      people: [NO_ADDRESS, ADA],
      memberships: [membership(ADA, OTHER_TEAM_ID, true)],
    });

    expect(
      (await suggest(MEMBER_PROPS)).map((each: InviteSuggestion): string => {
        return each.userId;
      }),
    ).toEqual([ADA.userId]);
  });

  test("their memberships are read in the project, with the reader's own props, never as root", async () => {
    const reads: Reads = stubReads({ people: [ADA, GRACE] });

    await suggest(MEMBER_PROPS);

    const read: {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = reads.memberships.mock.calls[0]![0];

    expect(read.query["projectId"]).toEqual(PROJECT_ID);
    expect(read.select).toEqual({
      _id: true,
      userId: true,
      teamId: true,
      hasAcceptedInvitation: true,
    });
    expect(read.props).toBe(MEMBER_PROPS);
    expect(read.props.isRoot).toBeUndefined();
  });

  test("nobody found: nothing more is read", async () => {
    const reads: Reads = stubReads({ people: [] });

    expect(await suggest(MEMBER_PROPS)).toEqual([]);
    expect(reads.memberships).not.toHaveBeenCalled();
  });
});

describe("the team named", () => {
  test("is looked for in the request's project", async () => {
    const reads: Reads = stubReads({ people: [ADA] });

    await suggest(MEMBER_PROPS);

    expect(reads.team.mock.calls[0]![0].query).toEqual({
      _id: TEAM_ID,
      projectId: PROJECT_ID,
    });
  });

  test("one of another project, or none, is refused", async () => {
    stubReads({ people: [ADA], team: null });

    await expect(suggest(MEMBER_PROPS)).rejects.toBeInstanceOf(
      BadDataException,
    );
  });
});

describe("the server's other accounts", () => {
  const SERVER_ONLY: ProjectMemberSearchMatch = {
    userId: "eeee0000-0000-4000-8000-000000000001",
    name: "Ada Byron",
    email: "ada.byron@other.test",
  };

  test("on a server somebody runs, for its master admin: not in this project yet", async () => {
    const reads: Reads = stubReads({
      people: [ADA],
      memberships: [membership(ADA, OTHER_TEAM_ID, true)],
      serverAccounts: {
        name: [account(ADA), account(SERVER_ONLY)],
        email: [account(SERVER_ONLY)],
      },
    });

    expect(await suggest(MASTER_ADMIN_PROPS)).toEqual([
      { ...ADA, standing: InviteSuggestionStanding.Member },
      { ...SERVER_ONLY, standing: InviteSuggestionStanding.NotInProject },
    ]);

    // By name and by email, literally, a few of each, as OneUptime.
    const userReads: Array<{
      query: JSONObject;
      limit: number;
      props: DatabaseCommonInteractionProps;
    }> = reads.users.mock.calls.map(
      (
        call: Array<unknown>,
      ): {
        query: JSONObject;
        limit: number;
        props: DatabaseCommonInteractionProps;
      } => {
        return call[0] as {
          query: JSONObject;
          limit: number;
          props: DatabaseCommonInteractionProps;
        };
      },
    );

    expect(userReads).toHaveLength(2);
    expect(userReads[0]!.query["name"]).toBeInstanceOf(Search);
    expect(userReads[1]!.query["email"]).toBeInstanceOf(Search);

    for (const read of userReads) {
      expect(read.limit).toBe(INVITE_SUGGESTIONS_SERVER_LIMIT);
      expect(read.props).toEqual({ isRoot: true });
    }
  });

  test("an account found that is in the project after all says where it stands", async () => {
    stubReads({
      people: [],
      memberships: [membership(SERVER_ONLY, TEAM_ID, true)],
      serverAccounts: { name: [account(SERVER_ONLY)] },
    });

    expect(await suggest(MASTER_ADMIN_PROPS)).toEqual([
      { ...SERVER_ONLY, standing: InviteSuggestionStanding.InThisTeam },
    ]);
  });

  test("never on OneUptime Cloud, not even to a master admin", async () => {
    mockIsBillingEnabled = true;

    const reads: Reads = stubReads({
      people: [ADA],
      serverAccounts: { name: [account(SERVER_ONLY)] },
    });

    expect(
      (await suggest(MASTER_ADMIN_PROPS)).map((each: InviteSuggestion) => {
        return each.userId;
      }),
    ).toEqual([ADA.userId]);
    expect(reads.users).not.toHaveBeenCalled();
    expect(InviteSuggestions.mayFindServerAccounts(MASTER_ADMIN_PROPS)).toBe(
      false,
    );
  });

  test("never to anybody but a master admin", async () => {
    const reads: Reads = stubReads({
      people: [ADA],
      serverAccounts: { name: [account(SERVER_ONLY)] },
    });

    await suggest(MEMBER_PROPS);

    expect(reads.users).not.toHaveBeenCalled();
    expect(InviteSuggestions.mayFindServerAccounts(MEMBER_PROPS)).toBe(false);
    expect(InviteSuggestions.mayFindServerAccounts(MASTER_ADMIN_PROPS)).toBe(
      true,
    );
  });

  test(`${INVITE_SUGGESTIONS_SERVER_LIMIT} at most, each once, none without an address`, async () => {
    const many: Array<ProjectMemberSearchMatch> = Array.from(
      { length: INVITE_SUGGESTIONS_SERVER_LIMIT + 2 },
      (_value: unknown, index: number): ProjectMemberSearchMatch => {
        return {
          userId: `ffff0000-0000-4000-8000-00000000000${index}`,
          name: `Account ${index}`,
          email: `account${index}@other.test`,
        };
      },
    );

    stubReads({
      people: [],
      serverAccounts: {
        name: [account(NO_ADDRESS), ...many.map(account)],
        email: many.map(account),
      },
    });

    const found: Array<InviteSuggestion> = await suggest(MASTER_ADMIN_PROPS);

    expect(found).toHaveLength(INVITE_SUGGESTIONS_SERVER_LIMIT);
    expect(
      new Set(
        found.map((each: InviteSuggestion): string => {
          return each.userId;
        }),
      ).size,
    ).toBe(INVITE_SUGGESTIONS_SERVER_LIMIT);
    expect(
      found.some((each: InviteSuggestion): boolean => {
        return each.userId === NO_ADDRESS.userId;
      }),
    ).toBe(false);
  });
});
