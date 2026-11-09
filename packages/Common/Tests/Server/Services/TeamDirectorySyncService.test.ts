import ProjectUserProfileService from "../../../Server/Services/ProjectUserProfileService";
import TeamDirectorySyncService, {
  DirectoryMember,
  TeamDirectorySyncResult,
} from "../../../Server/Services/TeamDirectorySyncService";
import TeamMemberCustomFieldService from "../../../Server/Services/TeamMemberCustomFieldService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import ProjectUserProfile from "../../../Models/DatabaseModels/ProjectUserProfile";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TEAM DIRECTORY SYNC: one team is made to match an external roster -
 * accounts with real names, accepted memberships, the directory's facts in
 * custom fields, and (when asked) the people it no longer lists taken off
 * the team. Every store is mocked; what is asked is what gets written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "21000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("21000000-0000-4000-8000-000000000002");

interface Store {
  team: Team | null;
  users: Map<string, User>;
  memberships: Array<TeamMember>;
  customFields: Array<string>;
  profiles: Map<string, ProjectUserProfile>;
}

let store: Store;
let calls: Record<string, Array<unknown>>;

function record(name: string, value: unknown): void {
  (calls[name] = calls[name] || []).push(value);
}

function userOf(data: {
  email: string;
  name?: string;
  isEmailVerified?: boolean;
  registered?: boolean;
}): User {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(data.email);
  if (data.name) {
    user.name = new Name(data.name);
  }
  user.isEmailVerified = data.isEmailVerified ?? true;
  if (data.registered) {
    user.password = new HashedString("hashed");
  }
  store.users.set(data.email, user);
  return user;
}

function membershipOf(user: User, accepted: boolean): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.userId = user.id!;
  member.teamId = TEAM_ID;
  member.hasAcceptedInvitation = accepted;
  member.user = user;
  store.memberships.push(member);
  return member;
}

function mock(target: unknown, method: string, impl: unknown): void {
  jest
    .spyOn(target as Record<string, never>, method as never)
    .mockImplementation(impl as never);
}

beforeEach(() => {
  const team: Team = new Team();
  team._id = TEAM_ID.toString();
  team.name = "BetterStack On-Call";

  store = {
    team: team,
    users: new Map(),
    memberships: [],
    customFields: [],
    profiles: new Map(),
  };
  calls = {};

  mock(TeamService, "findOneBy", async () => {
    return store.team;
  });
  mock(TeamService, "create", async (args: { data: Team }) => {
    record("team.create", args.data);
    args.data._id = TEAM_ID.toString();
    return args.data;
  });

  mock(TeamMemberCustomFieldService, "findBy", async () => {
    return store.customFields.map((name: string) => {
      const field: TeamMemberCustomField = new TeamMemberCustomField();
      field.name = name;
      return field;
    });
  });
  mock(
    TeamMemberCustomFieldService,
    "create",
    async (args: { data: TeamMemberCustomField }) => {
      record("customField.create", args.data.name);
      return args.data;
    },
  );

  mock(TeamMemberService, "findBy", async () => {
    return store.memberships;
  });
  mock(TeamMemberService, "create", async (args: { data: TeamMember }) => {
    record("membership.create", args.data);
    return args.data;
  });
  mock(TeamMemberService, "updateOneById", async (args: unknown) => {
    record("membership.update", args);
  });
  mock(TeamMemberService, "deleteOneById", async (args: unknown) => {
    record("membership.delete", args);
  });

  mock(UserService, "findOneBy", async (args: { query: { email: Email } }) => {
    return store.users.get(args.query.email.toString()) || null;
  });
  mock(
    UserService,
    "createByEmail",
    async (args: { email: Email; name?: Name; isEmailVerified?: boolean }) => {
      record("user.create", args);
      return userOf({
        email: args.email.toString(),
        ...(args.name ? { name: args.name.toString() } : {}),
      });
    },
  );
  mock(UserService, "updateOneById", async (args: unknown) => {
    record("user.update", args);
  });

  mock(
    ProjectUserProfileService,
    "findOneBy",
    async (args: { query: { userId: ObjectID } }) => {
      return store.profiles.get(args.query.userId.toString()) || null;
    },
  );
  mock(
    ProjectUserProfileService,
    "create",
    async (args: { data: ProjectUserProfile }) => {
      record("profile.create", args.data);
      return args.data;
    },
  );
  mock(ProjectUserProfileService, "updateOneById", async (args: unknown) => {
    record("profile.update", args);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function sync(
  members: Array<DirectoryMember>,
  options?: { removeMissing?: boolean; dryRun?: boolean },
): Promise<TeamDirectorySyncResult> {
  return await TeamDirectorySyncService.sync({
    projectId: PROJECT_ID,
    teamName: "BetterStack On-Call",
    members: members,
    removeMissing: options?.removeMissing || false,
    dryRun: options?.dryRun || false,
  });
}

describe("parsing a roster", () => {
  test("addresses are lower-cased and names tidied", () => {
    expect(
      TeamDirectorySyncService.parseMembers([
        { email: " Alice@Example.com ", name: "  Alice   Smith " },
      ]),
    ).toEqual([
      {
        email: "alice@example.com",
        name: "Alice Smith",
        customFields: undefined,
      },
    ]);
  });

  test("a bad roster is refused whole", () => {
    expect(() => {
      return TeamDirectorySyncService.parseMembers({});
    }).toThrow(BadDataException);
    expect(() => {
      return TeamDirectorySyncService.parseMembers([{ email: "nope" }]);
    }).toThrow("valid email");
    expect(() => {
      return TeamDirectorySyncService.parseMembers([
        { email: "a@example.com" },
        { email: "A@example.com" },
      ]);
    }).toThrow("more than once");
    expect(() => {
      return TeamDirectorySyncService.parseMembers([
        { email: "a@example.com", customFields: { nested: { a: 1 } } },
      ]);
    }).toThrow("must be text, a number, a boolean or null");
  });

  test("a name longer than the column holds is cut to fit", () => {
    const [member] = TeamDirectorySyncService.parseMembers([
      { email: "a@example.com", name: "x".repeat(80) },
    ]);
    expect(member!.name!.length).toBe(50);
  });
});

describe("syncing a team", () => {
  test("someone new gets a verified account and an accepted membership", async () => {
    const result: TeamDirectorySyncResult = await sync([
      {
        email: "alice@example.com",
        name: "Alice Smith",
        customFields: { "BetterStack Role": "admin" },
      },
    ]);

    expect(result.members[0]).toMatchObject({
      email: "alice@example.com",
      action: "created",
      changes: ["user_created", "membership_created", "custom_fields"],
    });

    const created: { isEmailVerified?: boolean; name?: Name } = calls[
      "user.create"
    ]![0] as { isEmailVerified?: boolean; name?: Name };
    expect(created.isEmailVerified).toBe(true);
    expect(created.name?.toString()).toBe("Alice Smith");

    const membership: TeamMember = calls["membership.create"]![0] as TeamMember;
    expect(membership.hasAcceptedInvitation).toBe(true);
    expect(membership.teamId?.toString()).toBe(TEAM_ID.toString());

    expect(calls["customField.create"]).toEqual(["BetterStack Role"]);
    const profile: ProjectUserProfile = calls[
      "profile.create"
    ]![0] as ProjectUserProfile;
    expect(profile.customFields).toEqual({ "BetterStack Role": "admin" });
  });

  test("a member already in step is left alone", async () => {
    const user: User = userOf({ email: "bob@example.com", name: "Bob Lee" });
    membershipOf(user, true);
    store.customFields = ["BetterStack Role"];
    const profile: ProjectUserProfile = new ProjectUserProfile();
    profile._id = ObjectID.generate().toString();
    profile.customFields = { "BetterStack Role": "responder" };
    store.profiles.set(user.id!.toString(), profile);

    const result: TeamDirectorySyncResult = await sync([
      {
        email: "bob@example.com",
        name: "Bob Lee",
        customFields: { "BetterStack Role": "responder" },
      },
    ]);

    expect(result.members[0]!.action).toBe("unchanged");
    expect(result.summary.unchanged).toBe(1);
    expect(Object.keys(calls)).toEqual([]);
  });

  test("a renamed member, a pending invitation and changed fields are brought in step", async () => {
    const user: User = userOf({ email: "bob@example.com", name: "Bobby" });
    membershipOf(user, false);
    store.customFields = ["BetterStack Role"];
    const profile: ProjectUserProfile = new ProjectUserProfile();
    profile._id = ObjectID.generate().toString();
    profile.customFields = { "BetterStack Role": "member", Desk: "B2" };
    store.profiles.set(user.id!.toString(), profile);

    const result: TeamDirectorySyncResult = await sync([
      {
        email: "bob@example.com",
        name: "Bob Lee",
        customFields: { "BetterStack Role": "admin" },
      },
    ]);

    expect(result.members[0]).toMatchObject({
      action: "updated",
      changes: ["name", "invitation_accepted", "custom_fields"],
    });
    expect(calls["membership.update"]).toHaveLength(1);
    // A field the directory does not send is kept.
    expect(
      (calls["profile.update"]![0] as { data: ProjectUserProfile }).data
        .customFields,
    ).toEqual({ "BetterStack Role": "admin", Desk: "B2" });
  });

  test("an address never registered is verified, a registered one is left as its owner left it", async () => {
    const invited: User = userOf({
      email: "new@example.com",
      isEmailVerified: false,
    });
    membershipOf(invited, true);
    const registered: User = userOf({
      email: "own@example.com",
      isEmailVerified: false,
      registered: true,
    });
    membershipOf(registered, true);

    const result: TeamDirectorySyncResult = await sync([
      { email: "new@example.com" },
      { email: "own@example.com" },
    ]);

    expect(result.members[0]!.changes).toEqual(["email_verified"]);
    expect(result.members[1]!.action).toBe("unchanged");
  });

  test("members the directory no longer lists are removed only when asked", async () => {
    const kept: User = userOf({ email: "kept@example.com", name: "Kept" });
    membershipOf(kept, true);
    const gone: User = userOf({ email: "gone@example.com", name: "Gone" });
    const goneMembership: TeamMember = membershipOf(gone, true);

    let result: TeamDirectorySyncResult = await sync([
      { email: "kept@example.com", name: "Kept" },
    ]);
    expect(calls["membership.delete"]).toBeUndefined();
    expect(result.summary.removed).toBe(0);

    result = await sync([{ email: "kept@example.com", name: "Kept" }], {
      removeMissing: true,
    });
    expect(result.summary.removed).toBe(1);
    expect(
      (calls["membership.delete"]![0] as { id: ObjectID }).id.toString(),
    ).toBe(goneMembership.id!.toString());
  });

  test("an empty roster never empties the team", async () => {
    await expect(sync([], { removeMissing: true })).rejects.toThrow(
      "the directory listed nobody",
    );
  });

  test("a dry run writes nothing and says what it would do", async () => {
    store.team = null;
    const gone: User = userOf({ email: "gone@example.com" });
    membershipOf(gone, true);

    const result: TeamDirectorySyncResult = await sync(
      [{ email: "alice@example.com", name: "Alice", customFields: { a: "1" } }],
      { dryRun: true, removeMissing: true },
    );

    expect(result.team.created).toBe(true);
    expect(result.customFieldsCreated).toEqual(["a"]);
    expect(result.members[0]).toMatchObject({
      action: "created",
      changes: ["user_created", "membership_created", "custom_fields"],
    });
    expect(Object.keys(calls)).toEqual([]);
  });

  test("a missing team is created", async () => {
    store.team = null;

    const result: TeamDirectorySyncResult = await sync([
      { email: "alice@example.com" },
    ]);

    expect(result.team).toMatchObject({
      id: TEAM_ID.toString(),
      created: true,
    });
    expect((calls["team.create"]![0] as Team).name).toBe("BetterStack On-Call");
  });

  test("one member failing does not stop the rest, nor get them removed", async () => {
    const broken: User = userOf({ email: "broken@example.com", name: "Old" });
    membershipOf(broken, true);
    jest
      .spyOn(UserService, "updateOneById")
      .mockRejectedValueOnce(new Error("boom") as never);

    const result: TeamDirectorySyncResult = await sync(
      [
        { email: "broken@example.com", name: "New" },
        { email: "alice@example.com" },
      ],
      { removeMissing: true },
    );

    expect(result.members[0]).toMatchObject({
      action: "failed",
      error: "boom",
    });
    expect(result.members[1]!.action).toBe("created");
    expect(result.summary).toMatchObject({ failed: 1, created: 1, removed: 0 });
    expect(calls["membership.delete"]).toBeUndefined();
  });
});
