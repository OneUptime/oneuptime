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

import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
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
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  InviteSuggestion,
  InviteSuggestionStanding,
} from "../../../../Types/Team/InviteSuggestions";
import UserType from "../../../../Types/UserType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A MASTER ADMIN ASKS ABOUT A PROJECT THEY ARE NOT IN (#9826).
 *
 * The Admin Dashboard's invitation forms ask for a project's suggestions as
 * a master admin, who is usually no member of it: no team, no permission
 * in it, only the master admin's own props, in the project the page is
 * about (POST /team-member/invite-suggestions-in-project/:id). Here, with
 * Search's own reads (ProjectMemberSearch) and the server's rule for its
 * other accounts left as they are - only the database stood in for:
 *
 *   - the project's people are found, by name and by email, with the master
 *     admin's own props in that project, never as root, and each says where
 *     they stand for the team being invited to;
 *   - on a server somebody runs, the server's other accounts too, as not in
 *     this project yet - without the server's switch being read;
 *   - on OneUptime Cloud, the project's people only;
 *   - anyone else who is no member of the project is refused before
 *     anything is read, as before.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "98260000-0000-4000-8000-0000000000b1",
);
const TEAM_ID: ObjectID = new ObjectID("98260000-0000-4000-8000-0000000000b2");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "98260000-0000-4000-8000-0000000000b3",
);

interface Person {
  userId: string;
  name: string;
  email: string;
}

// People of the project: Ada in the team, Linus invited to another one.
const ADA: Person = {
  userId: "98260000-0000-4000-8000-0000000000c1",
  name: "Ada Lovelace",
  email: "ada@acme.test",
};
const LINUS: Person = {
  userId: "98260000-0000-4000-8000-0000000000c2",
  name: "Linus Ada",
  email: "linus@acme.test",
};

// An account on the server, in no team of the project.
const ADA_BYRON: Person = {
  userId: "98260000-0000-4000-8000-0000000000c3",
  name: "Ada Byron",
  email: "ada.byron@other.test",
};

// A master admin of the server, in the project the Admin Dashboard's page is about.
const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: new ObjectID("98260000-0000-4000-8000-0000000000d1"),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
  tenantId: PROJECT_ID,
};

// Somebody signed in who is no member of the project, and no master admin.
const STRANGER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("98260000-0000-4000-8000-0000000000d2"),
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

function account(person: Person): User {
  const user: User = new User();
  user._id = person.userId;
  user.name = person.name as never;
  user.email = person.email as never;
  return user;
}

// A membership as Search reads it: with its person.
function membershipFound(person: Person, teamId: ObjectID): TeamMember {
  const row: TeamMember = new TeamMember();
  row._id = ObjectID.generate().toString();
  row.userId = new ObjectID(person.userId);
  row.teamId = teamId;
  row.user = account(person);
  return row;
}

// A membership as the standings read it.
function membership(
  person: Person,
  teamId: ObjectID,
  hasAcceptedInvitation: boolean,
): TeamMember {
  const row: TeamMember = new TeamMember();
  row.userId = new ObjectID(person.userId);
  row.teamId = teamId;
  row.hasAcceptedInvitation = hasAcceptedInvitation;
  return row;
}

interface MembershipRead {
  query: JSONObject;
  props: DatabaseCommonInteractionProps;
}

let membershipReads: Spy;
let accountReads: Spy;
let switchRead: Spy;

beforeEach(() => {
  mockIsBillingEnabled = false;

  switchRead = getJestSpyOn(
    GlobalConfigService,
    "getSuggestServerAccountsWhenInviting",
  ).mockResolvedValue(false);

  getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(new Team());

  /*
   * The project's memberships: Search's reads (by name, by email, each with
   * the person), then the standings' read of the people found.
   */
  membershipReads = getJestSpyOn(
    TeamMemberService,
    "findBy",
  ).mockImplementation(
    async (findBy: MembershipRead): Promise<Array<TeamMember>> => {
      const user: JSONObject | undefined = findBy.query["user"] as
        | JSONObject
        | undefined;

      if (user && user["name"]) {
        return [
          membershipFound(ADA, TEAM_ID),
          membershipFound(LINUS, OTHER_TEAM_ID),
        ];
      }

      if (user && user["email"]) {
        return [membershipFound(ADA, TEAM_ID)];
      }

      return [
        membership(ADA, TEAM_ID, true),
        membership(LINUS, OTHER_TEAM_ID, false),
      ];
    },
  );

  // The server's other accounts, by name and by email.
  accountReads = getJestSpyOn(UserService, "findBy").mockImplementation(
    async (findBy: { query: JSONObject }): Promise<Array<User>> => {
      return findBy.query["name"]
        ? [account(ADA_BYRON), account(ADA)]
        : [account(ADA_BYRON)];
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function suggest(
  props: DatabaseCommonInteractionProps,
): Promise<Array<InviteSuggestion>> {
  return InviteSuggestions.suggest({
    projectId: PROJECT_ID,
    request: { text: "ada", teamId: TEAM_ID },
    props: props,
  });
}

function reads(): Array<MembershipRead> {
  return membershipReads.mock.calls.map(
    (call: Array<unknown>): MembershipRead => {
      return call[0] as MembershipRead;
    },
  );
}

describe("a master admin who is no member of the project", () => {
  test("may see its people and their addresses, as they may in the Admin Dashboard", () => {
    expect(MASTER_ADMIN.userTenantAccessPermission).toBeUndefined();
    expect(
      ProjectMemberSearch.canSeeMembers({
        projectId: PROJECT_ID,
        props: MASTER_ADMIN,
      }),
    ).toBe(true);
    expect(
      ProjectMemberSearch.canSeeEmails({
        projectId: PROJECT_ID,
        props: MASTER_ADMIN,
      }),
    ).toBe(true);
  });

  test("on a server somebody runs: the project's people where they stand, then the server's other accounts", async () => {
    expect(await suggest(MASTER_ADMIN)).toEqual([
      {
        ...ADA,
        standing: InviteSuggestionStanding.InThisTeam,
      },
      {
        ...LINUS,
        standing: InviteSuggestionStanding.Invited,
      },
      {
        ...ADA_BYRON,
        standing: InviteSuggestionStanding.NotInProject,
      },
    ]);

    // A master admin needs no switch: it is not even read.
    expect(switchRead).not.toHaveBeenCalled();
  });

  test("the project's people are read in that project, by name and by email, with the master admin's own props", async () => {
    await suggest(MASTER_ADMIN);

    const [byName, byEmail, standings] = reads();

    expect((byName!.query["user"] as JSONObject)["name"]).toBeInstanceOf(
      Search,
    );
    expect((byEmail!.query["user"] as JSONObject)["email"]).toBeInstanceOf(
      Search,
    );

    for (const read of [byName!, byEmail!, standings!]) {
      expect(read.query["projectId"]).toEqual(PROJECT_ID);
      expect(read.props).toBe(MASTER_ADMIN);
      expect(read.props.isRoot).toBeUndefined();
    }

    // The server's accounts are the server's, read as root, as always.
    for (const call of accountReads.mock.calls) {
      expect((call[0] as { props: JSONObject }).props).toEqual({
        isRoot: true,
      });
    }
  });

  test("on OneUptime Cloud: the project's people only, and no account of the server is read", async () => {
    mockIsBillingEnabled = true;

    expect(
      (await suggest(MASTER_ADMIN)).map((each: InviteSuggestion): string => {
        return each.email;
      }),
    ).toEqual([ADA.email, LINUS.email]);
    expect(accountReads).not.toHaveBeenCalled();
    expect(switchRead).not.toHaveBeenCalled();
  });
});

describe("anyone else who is no member of the project", () => {
  test("may not see its people, and is refused before anything is read, as before", async () => {
    expect(
      ProjectMemberSearch.canSeeMembers({
        projectId: PROJECT_ID,
        props: STRANGER,
      }),
    ).toBe(false);

    await expect(suggest(STRANGER)).rejects.toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(membershipReads).not.toHaveBeenCalled();
    expect(accountReads).not.toHaveBeenCalled();
  });

  test("even with the server's switch on", async () => {
    switchRead.mockResolvedValue(true);

    await expect(suggest(STRANGER)).rejects.toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(
      await InviteSuggestions.mayFindServerAccounts({
        projectId: PROJECT_ID,
        props: STRANGER,
      }),
    ).toBe(false);
    expect(accountReads).not.toHaveBeenCalled();
  });
});
