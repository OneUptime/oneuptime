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
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  InviteSuggestion,
  InviteSuggestionStanding,
} from "../../../../Types/Team/InviteSuggestions";
import { ProjectMemberSearchMatch } from "../../../../Types/Team/ProjectMemberSearch";
import UserType from "../../../../Types/UserType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SUGGEST EVERY ACCOUNT WHEN INVITING (#9744).
 *
 * On a server somebody runs, an invitation's email box suggests the
 * server's other accounts - marked Not in this project yet - to its master
 * admins, and, once one of them turns on Suggest Every Account When
 * Inviting (GlobalConfig.suggestServerAccountsWhenInviting, Admin Dashboard
 * > Settings > Authentication), to anyone signed in who may invite people
 * to the project: a Project Owner, a Project Admin, or a role with Invite
 * New Members, unblocked, in the request's project. The switch is off until
 * turned on: on a server that hosts several organizations it would show one
 * organization's people to another.
 *
 * And never on OneUptime Cloud, whatever the switch says and whoever asks:
 * its accounts are its customers', and nobody on Cloud is ever told about
 * an account outside their own project.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaa0000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aaaa0000-0000-4000-8000-000000000002",
);

const COLLEAGUE: ProjectMemberSearchMatch = {
  userId: "eeee0000-0000-4000-8000-000000000001",
  name: "Ada Byron",
  email: "ada.byron@acme.test",
};

function account(person: ProjectMemberSearchMatch): User {
  const user: User = new User();
  user._id = person.userId;
  user.name = person.name as never;
  user.email = person.email as never;
  return user;
}

// A person signed in, holding these permissions in the project.
function personWith(
  permissions: Array<Permission>,
  options?: {
    isBlocked?: boolean | undefined;
    userType?: UserType | undefined;
    tenantId?: ObjectID | undefined;
  },
): DatabaseCommonInteractionProps {
  const tenantId: ObjectID = options?.tenantId || PROJECT_ID;

  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [tenantId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: tenantId,
      permissions: permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  };

  if (options?.isBlocked) {
    permissionMap[tenantId.toString()]!.permissions.push(
      ...permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: true,
        };
      }),
    );
  }

  return {
    tenantId: tenantId,
    userId: new ObjectID("dddd0000-0000-4000-8000-000000000001"),
    userType: options?.userType || UserType.User,
    userTenantAccessPermission: permissionMap,
  } as DatabaseCommonInteractionProps;
}

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  ...personWith([]),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

let switchRead: Spy;
let accountReads: Spy;

function turnSwitch(isOn: boolean): void {
  switchRead.mockResolvedValue(isOn);
}

function mayFind(props: DatabaseCommonInteractionProps): Promise<boolean> {
  return InviteSuggestions.mayFindServerAccounts({
    projectId: PROJECT_ID,
    props: props,
  });
}

function suggest(
  props: DatabaseCommonInteractionProps,
): Promise<Array<InviteSuggestion>> {
  return InviteSuggestions.suggest({
    projectId: PROJECT_ID,
    request: { text: "ada", teamId: null },
    props: props,
  });
}

beforeEach(() => {
  mockIsBillingEnabled = false;

  switchRead = getJestSpyOn(
    GlobalConfigService,
    "getSuggestServerAccountsWhenInviting",
  ).mockResolvedValue(false);

  // The project's own people: nobody matches what was typed.
  getJestSpyOn(ProjectMemberSearch, "canSeeMembers").mockReturnValue(true);
  getJestSpyOn(ProjectMemberSearch, "search").mockResolvedValue([]);
  getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue([]);
  getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(new Team());

  // The server's other accounts, by name and by email.
  accountReads = getJestSpyOn(UserService, "findBy").mockImplementation(
    async (findBy: { query: JSONObject }): Promise<Array<User>> => {
      return findBy.query["name"] ? [account(COLLEAGUE)] : [];
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the switch on, on a server somebody runs", () => {
  beforeEach(() => {
    turnSwitch(true);
  });

  test.each([
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a role with Invite New Members", [Permission.InviteProjectTeamMembers]],
  ])(
    "%s is offered the server's other accounts, not in this project yet",
    async (_who: string, permissions: Array<Permission>) => {
      const props: DatabaseCommonInteractionProps = personWith(permissions);

      expect(await mayFind(props)).toBe(true);
      expect(await suggest(props)).toEqual([
        { ...COLLEAGUE, standing: InviteSuggestionStanding.NotInProject },
      ]);
    },
  );

  test("the accounts are read as the server's, a few at a time, by name and by email", async () => {
    await suggest(personWith([Permission.ProjectAdmin]));

    expect(accountReads).toHaveBeenCalledTimes(2);

    for (const call of accountReads.mock.calls) {
      expect((call[0] as { props: JSONObject }).props).toEqual({
        isRoot: true,
      });
    }
  });

  test.each([
    ["a member who may not invite", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["someone who holds nothing in the project", []],
  ])(
    "%s is not, and the switch is not even read",
    async (_who: string, permissions: Array<Permission>) => {
      const props: DatabaseCommonInteractionProps = personWith(permissions);

      expect(await mayFind(props)).toBe(false);
      expect(switchRead).not.toHaveBeenCalled();
    },
  );

  test("a Project Admin whose invitations are blocked is not", async () => {
    expect(
      await mayFind(
        personWith([Permission.InviteProjectTeamMembers], { isBlocked: true }),
      ),
    ).toBe(false);
  });

  test("a Project Admin of another project is not, in this one", async () => {
    expect(
      await mayFind(
        personWith([Permission.ProjectAdmin], { tenantId: OTHER_PROJECT_ID }),
      ),
    ).toBe(false);
  });

  test("a project API key is not, whatever it may do: the suggestions are for a person typing", async () => {
    const apiKey: DatabaseCommonInteractionProps = {
      ...personWith([Permission.ProjectAdmin], { userType: UserType.API }),
      userId: undefined,
    } as DatabaseCommonInteractionProps;

    expect(await mayFind(apiKey)).toBe(false);
    expect(
      await mayFind(
        personWith([Permission.ProjectAdmin], { userType: UserType.API }),
      ),
    ).toBe(false);
  });

  test("a workflow is not", async () => {
    expect(
      await mayFind(
        personWith([Permission.ProjectAdmin], { userType: UserType.Workflow }),
      ),
    ).toBe(false);
  });
});

describe("the switch off, as every server starts", () => {
  test("a Project Admin is offered the project's people only", async () => {
    turnSwitch(false);

    const props: DatabaseCommonInteractionProps = personWith([
      Permission.ProjectAdmin,
    ]);

    expect(await mayFind(props)).toBe(false);
    expect(await suggest(props)).toEqual([]);
    expect(accountReads).not.toHaveBeenCalled();
    expect(switchRead).toHaveBeenCalled();
  });

  test("a master admin is still offered every account, without the switch being read", async () => {
    turnSwitch(false);

    expect(await mayFind(MASTER_ADMIN)).toBe(true);
    expect(switchRead).not.toHaveBeenCalled();
  });
});

describe("on OneUptime Cloud, whatever the switch says", () => {
  beforeEach(() => {
    mockIsBillingEnabled = true;
    turnSwitch(true);
  });

  test.each([
    ["a Project Owner", personWith([Permission.ProjectOwner])],
    ["a Project Admin", personWith([Permission.ProjectAdmin])],
    [
      "a role with Invite New Members",
      personWith([Permission.InviteProjectTeamMembers]),
    ],
    ["a master admin", MASTER_ADMIN],
  ])(
    "%s is never offered an account outside the project",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await mayFind(props)).toBe(false);
      expect(await suggest(props)).toEqual([]);
      expect(accountReads).not.toHaveBeenCalled();
      expect(switchRead).not.toHaveBeenCalled();
    },
  );
});

describe("InviteSuggestions.mayInviteToProject", () => {
  test.each([
    [Permission.ProjectOwner, true],
    [Permission.ProjectAdmin, true],
    [Permission.InviteProjectTeamMembers, true],
    [Permission.ProjectMember, false],
    [Permission.ReadProjectTeam, false],
  ])("holding %s: %s", (permission: Permission, expected: boolean) => {
    expect(
      InviteSuggestions.mayInviteToProject({
        projectId: PROJECT_ID,
        props: personWith([permission]),
      }),
    ).toBe(expected);
  });

  test("root and a master admin may, as the invitation lets them", () => {
    expect(
      InviteSuggestions.mayInviteToProject({
        projectId: PROJECT_ID,
        props: { isRoot: true },
      }),
    ).toBe(true);
    expect(
      InviteSuggestions.mayInviteToProject({
        projectId: PROJECT_ID,
        props: MASTER_ADMIN,
      }),
    ).toBe(true);
  });
});
