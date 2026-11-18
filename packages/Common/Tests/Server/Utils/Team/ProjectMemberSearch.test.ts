import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectMemberSearch, {
  PROJECT_MEMBER_SEARCH_READ_LIMIT,
} from "../../../../Server/Utils/Team/ProjectMemberSearch";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { ProjectMemberSearchMatch } from "../../../../Types/Team/ProjectMemberSearch";
import UserType from "../../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S HALF OF SEARCH'S PEOPLE (#7036).
 *
 * A person is found through their membership of the project, by their name
 * or their email, read as the Users page reads the project's members: with
 * the caller's own permissions, by the very checks that list passes. So:
 *
 *   - a member who may not see the project's people is refused, and nothing
 *     is read;
 *   - an email is searched and answered only where the Users page's read of
 *     it would pass;
 *   - every read is the request's project's, with the caller's props, never
 *     root;
 *   - what was typed is matched literally;
 *   - one person on several teams is one person, best match first, a few.
 *
 * The reads are stood in for here; ProjectMemberSearchPostgres runs the same
 * search on a migrated Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b1f0a0e-2222-4c1e-9a1e-000000000001",
);
const USER_ID: ObjectID = new ObjectID("7b1f0a0e-2222-4c1e-9a1e-0000000000aa");

function propsHolding(
  permissions: Array<Permission>,
  options: { blocked?: Array<Permission>; userType?: UserType } = {},
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = [
    ...permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
    ...(options.blocked || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  const tenantAccess: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: rows,
    },
  };

  return {
    tenantId: PROJECT_ID,
    userId: options.userType === UserType.API ? undefined : USER_ID,
    userType: options.userType || UserType.User,
    userTenantAccessPermission: tenantAccess,
  } as DatabaseCommonInteractionProps;
}

function membership(data: {
  userId: string;
  name?: string | undefined;
  email?: string | undefined;
}): TeamMember {
  const user: User = new User();
  user._id = data.userId;

  if (data.name !== undefined) {
    (user as unknown as JSONObject)["name"] = data.name;
  }

  if (data.email !== undefined) {
    (user as unknown as JSONObject)["email"] = data.email;
  }

  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.userId = new ObjectID(data.userId);
  member.user = user;
  return member;
}

const ADA_ID: string = "7b1f0a0e-2222-4c1e-9a1e-0000000000a1";
const BOB_ID: string = "7b1f0a0e-2222-4c1e-9a1e-0000000000b1";
const EVE_ID: string = "7b1f0a0e-2222-4c1e-9a1e-0000000000e1";

interface FindByCall {
  query: JSONObject;
  select: JSONObject;
  sort: JSONObject;
  limit: number;
  skip: number;
  props: DatabaseCommonInteractionProps;
}

let findBySpy: jest.SpyInstance;
let byName: Array<TeamMember> = [];
let byEmail: Array<TeamMember> = [];

function calls(): Array<FindByCall> {
  return findBySpy.mock.calls.map((call: Array<unknown>): FindByCall => {
    return call[0] as FindByCall;
  });
}

// Which of the user's columns each read searched, in order.
function searchedColumns(): Array<string> {
  return calls().map((call: FindByCall): string => {
    return Object.keys(call.query["user"] as JSONObject)[0]!;
  });
}

beforeEach(() => {
  byName = [];
  byEmail = [];
  findBySpy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((async (
      data: FindByCall,
    ): Promise<Array<TeamMember>> => {
      const column: string = Object.keys(data.query["user"] as JSONObject)[0]!;
      return column === "email" ? byEmail : byName;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may see the project's people", () => {
  test.each([
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a Project Member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["someone who may read the project's teams", [Permission.ReadProjectTeam]],
  ] as Array<[string, Array<Permission>]>)(
    "%s may, emails too, as the Users page shows them",
    (_who: string, permissions: Array<Permission>) => {
      const props: DatabaseCommonInteractionProps = propsHolding(permissions);

      expect(
        ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
      ).toBe(true);
      expect(
        ProjectMemberSearch.canSeeEmails({ projectId: PROJECT_ID, props }),
      ).toBe(true);
    },
  );

  /*
   * Every member of a project holds Project User besides their teams' roles
   * (AccessTokenService), which reads its member profiles: a member whose
   * role only reads services still sees its people, as on the Users page.
   */
  test("a member whose role only reads services may, through the Project User every member holds", () => {
    const props: DatabaseCommonInteractionProps = propsHolding([
      Permission.ReadService,
      Permission.ProjectUser,
    ]);

    expect(
      ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
    ).toBe(true);
  });

  test("…unless their team takes Project User away", () => {
    const props: DatabaseCommonInteractionProps = propsHolding(
      [Permission.ReadService, Permission.ProjectUser],
      { blocked: [Permission.ProjectUser] },
    );

    expect(
      ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
    ).toBe(false);
    expect(
      ProjectMemberSearch.canSeeEmails({ projectId: PROJECT_ID, props }),
    ).toBe(false);
  });

  test.each([
    ["a key that may only read services", [Permission.ReadService]],
    [
      "a key that may only create incidents",
      [Permission.CreateProjectIncident],
    ],
    ["a key with no permission in the project", []],
  ] as Array<[string, Array<Permission>]>)(
    "%s may not: the Users page would list no one for them",
    (_who: string, permissions: Array<Permission>) => {
      const props: DatabaseCommonInteractionProps = propsHolding(permissions, {
        userType: UserType.API,
      });

      expect(
        ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
      ).toBe(false);
      expect(
        ProjectMemberSearch.canSeeEmails({ projectId: PROJECT_ID, props }),
      ).toBe(false);
    },
  );

  test("a team's block on the permission that would let them takes it away", () => {
    const props: DatabaseCommonInteractionProps = propsHolding(
      [Permission.ReadProjectTeam],
      { blocked: [Permission.ReadProjectTeam] },
    );

    expect(
      ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
    ).toBe(false);
  });

  test("a project API key may, with the key's own permissions", () => {
    expect(
      ProjectMemberSearch.canSeeMembers({
        projectId: PROJECT_ID,
        props: propsHolding([Permission.ProjectMember], {
          userType: UserType.API,
        }),
      }),
    ).toBe(true);
    expect(
      ProjectMemberSearch.canSeeMembers({
        projectId: PROJECT_ID,
        props: propsHolding([Permission.ReadService], {
          userType: UserType.API,
        }),
      }),
    ).toBe(false);
  });

  test("root and a master admin see everyone", () => {
    for (const props of [
      { isRoot: true } as DatabaseCommonInteractionProps,
      {
        isMasterAdmin: true,
        userId: USER_ID,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps,
    ]) {
      expect(
        ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
      ).toBe(true);
      expect(
        ProjectMemberSearch.canSeeEmails({ projectId: PROJECT_ID, props }),
      ).toBe(true);
    }
  });
});

describe("the search", () => {
  const member: DatabaseCommonInteractionProps = propsHolding([
    Permission.ProjectMember,
  ]);

  test("finds a teammate by part of their name, reading the project's memberships with the caller's own props", async () => {
    byName = [
      membership({
        userId: ADA_ID,
        name: "Ada Lovelace",
        email: "ada@acme.test",
      }),
    ];

    const found: Array<ProjectMemberSearchMatch> =
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "love",
        props: member,
      });

    expect(found).toEqual([
      { userId: ADA_ID, name: "Ada Lovelace", email: "ada@acme.test" },
    ]);

    for (const call of calls()) {
      // The caller's props, never root.
      expect(call.props).toBe(member);
      expect(call.props.isRoot).toBeFalsy();
      // The request's own project.
      expect(String(call.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(call.limit).toBe(PROJECT_MEMBER_SEARCH_READ_LIMIT);
      expect(call.skip).toBe(0);
    }
  });

  test("searches the name and the email, each with what was typed, in order of what it searched", async () => {
    await ProjectMemberSearch.search({
      projectId: PROJECT_ID,
      text: "ada",
      props: member,
    });

    expect(searchedColumns()).toEqual(["name", "email"]);

    const [nameRead, emailRead] = calls() as [FindByCall, FindByCall];

    expect((nameRead.query["user"] as JSONObject)["name"]).toEqual(
      new Search("ada"),
    );
    expect((emailRead.query["user"] as JSONObject)["email"]).toEqual(
      new Search("ada"),
    );
    expect(nameRead.sort).toEqual({ user: { name: SortOrder.Ascending } });
    expect(emailRead.sort).toEqual({ user: { email: SortOrder.Ascending } });
    expect(emailRead.select).toEqual({
      _id: true,
      userId: true,
      user: { _id: true, name: true, email: true },
    });
  });

  test("finds a teammate by their email", async () => {
    byEmail = [
      membership({
        userId: BOB_ID,
        name: "Bob Builder",
        email: "bob@acme.test",
      }),
    ];

    expect(
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "bob@acme",
        props: member,
      }),
    ).toEqual([
      { userId: BOB_ID, name: "Bob Builder", email: "bob@acme.test" },
    ]);
  });

  test("someone invited who has no name yet is found by their email, and read by it", async () => {
    byEmail = [membership({ userId: EVE_ID, email: "eve@acme.test" })];

    expect(
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "eve",
        props: member,
      }),
    ).toEqual([{ userId: EVE_ID, name: "", email: "eve@acme.test" }]);
  });

  test("nothing matching answers nobody", async () => {
    expect(
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "zzqx",
        props: member,
      }),
    ).toEqual([]);
  });

  test("what was typed is matched literally: a % or _ is no wildcard", async () => {
    await ProjectMemberSearch.search({
      projectId: PROJECT_ID,
      text: "50%_off\\",
      props: member,
    });

    for (const call of calls()) {
      const column: string = Object.keys(call.query["user"] as JSONObject)[0]!;
      expect((call.query["user"] as JSONObject)[column]).toEqual(
        new Search("50\\%\\_off\\\\"),
      );
    }
  });

  test("one person found by name and by email, and on several teams, is one result, best match first", async () => {
    byName = [
      membership({ userId: BOB_ID, name: "Bob Adams", email: "bob@acme.test" }),
      membership({
        userId: ADA_ID,
        name: "Ada Lovelace",
        email: "ada@acme.test",
      }),
      membership({
        userId: ADA_ID,
        name: "Ada Lovelace",
        email: "ada@acme.test",
      }),
    ];
    byEmail = [
      membership({
        userId: ADA_ID,
        name: "Ada Lovelace",
        email: "ada@acme.test",
      }),
    ];

    expect(
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "ada",
        props: member,
      }),
    ).toEqual([
      { userId: ADA_ID, name: "Ada Lovelace", email: "ada@acme.test" },
      { userId: BOB_ID, name: "Bob Adams", email: "bob@acme.test" },
    ]);
  });

  test("answers a few people at most", async () => {
    byName = Array.from({ length: 12 }, (_value: unknown, index: number) => {
      return membership({
        userId: `7b1f0a0e-2222-4c1e-9a1e-0000000001${String(index).padStart(2, "0")}`,
        name: `Ada ${index}`,
      });
    });

    expect(
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "ada",
        props: member,
      }),
    ).toHaveLength(5);
  });

  test("a member who may not see the project's people is refused, and nothing is read", async () => {
    await expect(
      ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "ada",
        props: propsHolding([Permission.ReadService]),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(findBySpy).not.toHaveBeenCalled();
  });

  /*
   * Every signed-in person holds Current User in any project they open
   * (getDefaultUserTenantAccessPermission). The table lets it read their own
   * memberships, but a membership's user column leaves it out - so the read
   * with their props would be refused. One who holds nothing more is
   * refused here instead, before anything is read
   * (CallerReadsReadableColumns relies on it).
   */
  test("someone who holds only what every signed-in person holds is refused, and nothing is read", async () => {
    const props: DatabaseCommonInteractionProps = propsHolding([
      Permission.CurrentUser,
      Permission.UnAuthorizedSsoUser,
    ]);

    expect(
      ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
    ).toBe(false);
    expect(
      ProjectMemberSearch.canSeeEmails({ projectId: PROJECT_ID, props }),
    ).toBe(false);

    await expect(
      ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "ada",
        props: props,
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(findBySpy).not.toHaveBeenCalled();
  });
});

/*
 * Every reader of the project's people sees their emails on the Users page
 * today: a user's email is a column any reader of a membership's user may
 * read (canReadOnRelationQuery). Were that ever to change, a search by email
 * would tell a reader an address the page would not show them, one guess at
 * a time - so the search asks the page's own check, and here that check is
 * made to refuse.
 */
describe("a reader who may not see emails", () => {
  beforeEach(() => {
    const getMetadata: (key: string) => TableColumnMetadata =
      User.prototype.getTableColumnMetadata;
    const getAccess: (key: string) => ColumnAccessControl | null =
      User.prototype.getColumnAccessControlFor;

    jest
      .spyOn(User.prototype, "getTableColumnMetadata")
      .mockImplementation(function (
        this: User,
        key: string,
      ): TableColumnMetadata {
        const metadata: TableColumnMetadata = getMetadata.call(this, key);

        return key === "email"
          ? { ...metadata, canReadOnRelationQuery: false }
          : metadata;
      });

    jest
      .spyOn(User.prototype, "getColumnAccessControlFor")
      .mockImplementation(function (
        this: User,
        key: string,
      ): ColumnAccessControl | null {
        const access: ColumnAccessControl | null = getAccess.call(this, key);

        // Nobody's: not even the user's own account reads it here.
        return key === "email" && access ? { ...access, read: [] } : access;
      });
  });

  test("sees the people, never their emails", () => {
    const props: DatabaseCommonInteractionProps = propsHolding([
      Permission.ProjectMember,
    ]);

    expect(
      ProjectMemberSearch.canSeeMembers({ projectId: PROJECT_ID, props }),
    ).toBe(true);
    expect(
      ProjectMemberSearch.canSeeEmails({ projectId: PROJECT_ID, props }),
    ).toBe(false);
  });

  test("is never searched by email, and answered without them", async () => {
    byName = [
      membership({
        userId: ADA_ID,
        name: "Ada Lovelace",
        email: "ada@acme.test",
      }),
    ];
    byEmail = [
      membership({
        userId: BOB_ID,
        name: "Bob Builder",
        email: "bob@acme.test",
      }),
    ];

    const found: Array<ProjectMemberSearchMatch> =
      await ProjectMemberSearch.search({
        projectId: PROJECT_ID,
        text: "acme",
        props: propsHolding([Permission.ProjectMember]),
      });

    // The name only: no read by email, and no email selected.
    expect(searchedColumns()).toEqual(["name"]);
    expect(calls()[0]!.select).toEqual({
      _id: true,
      userId: true,
      user: { _id: true, name: true },
    });
    // An email the read handed back anyway is not answered.
    expect(found).toEqual([{ userId: ADA_ID, name: "Ada Lovelace" }]);
  });
});
