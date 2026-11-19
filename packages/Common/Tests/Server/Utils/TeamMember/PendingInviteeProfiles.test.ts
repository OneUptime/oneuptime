import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import { And, Equal, FindOperator, ILike } from "typeorm";
import Incident from "../../../../Models/DatabaseModels/Incident";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import PendingInviteeProfiles, {
  ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE,
  ACCOUNT_DATE_COLUMNS,
  PROFILE_COLUMNS_SHOWN_ONCE_JOINED,
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";

/*
 * A PERSON'S OWN PROFILE IS NOT A PROJECT'S TO SEE UNTIL THEY JOIN IT (#9823,
 * Server/Utils/TeamMember/PendingInviteeProfiles).
 *
 * Inviting an address used to show the inviting project the profile of the
 * account the address already had - its name, picture, two-factor flag and
 * account dates - where an account the invitation made had none. So an
 * invitation told the inviter whether the address had an account. These
 * tests pin what a reader sees of a person reached through a relation, what
 * a filter through one may match, and who sees a person's picture.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "11111111-1111-4111-8111-222222222222";
const READER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PENDING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PERSON_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID(READER_ID),
  tenantId: new ObjectID(PROJECT_ID),
  userType: UserType.User,
};

const API_KEY_PROPS: DatabaseCommonInteractionProps = {
  tenantId: new ObjectID(PROJECT_ID),
  userType: UserType.API,
};

// A person as a read returns them through a relation, every column read.
function personRead(id: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name("Their Own Name");
  user.profilePictureId = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  user.twoFactorAuthEnabled = true;
  user.createdAt = new Date("2020-01-01T00:00:00Z");
  user.updatedAt = new Date("2026-11-19T10:00:00Z");
  user.version = 42;
  return user;
}

// A membership row, as a read of the Users list returns it.
function membershipRead(userId: string): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.user = personRead(userId);
  return member;
}

const USER_SELECT: unknown = {
  _id: true,
  user: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
    twoFactorAuthEnabled: true,
    createdAt: true,
    updatedAt: true,
  },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a read returns of a person reached through a relation", () => {
  test("someone only invited shows the name typed for them, and no picture, two-factor flag or account dates", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([
        {
          userId: PENDING_ID,
          projectId: PROJECT_ID,
          inviteeName: "Grace (typed)",
          createdAt: new Date(),
        },
      ]);

    const rows: Array<TeamMember> = [membershipRead(PENDING_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: TeamMember,
      rows: rows,
      select: USER_SELECT,
      props: PERSON_PROPS,
    });

    const user: User = rows[0]!.user!;

    expect(user.name?.toString()).toBe("Grace (typed)");
    expect(user.profilePictureId).toBeUndefined();
    expect(user.twoFactorAuthEnabled).toBeUndefined();
    expect(user.createdAt).toBeUndefined();
    expect(user.updatedAt).toBeUndefined();
    expect(user.version).toBeUndefined();
    // The project typed the address: it stays, and so does the id.
    expect(user._id).toBe(PENDING_ID);
  });

  test("someone only invited, with no name typed, shows no name at all - never their own", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([
        {
          userId: PENDING_ID,
          projectId: PROJECT_ID,
          inviteeName: null,
          createdAt: new Date(),
        },
      ]);

    const rows: Array<TeamMember> = [membershipRead(PENDING_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: TeamMember,
      rows: rows,
      select: USER_SELECT,
      props: PERSON_PROPS,
    });

    expect(rows[0]!.user!.name).toBeUndefined();
  });

  test("a member keeps their profile, but their account dates are their own", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([]);

    const rows: Array<TeamMember> = [membershipRead(MEMBER_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: TeamMember,
      rows: rows,
      select: USER_SELECT,
      props: PERSON_PROPS,
    });

    const user: User = rows[0]!.user!;

    expect(user.name?.toString()).toBe("Their Own Name");
    expect(user.profilePictureId).toBeDefined();
    expect(user.twoFactorAuthEnabled).toBe(true);
    for (const column of ACCOUNT_DATE_COLUMNS) {
      expect((user as unknown as Record<string, unknown>)[column]).toBe(
        undefined,
      );
    }
  });

  test("the reader reading themselves keeps everything, and is never asked about", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([]);

    const rows: Array<TeamMember> = [membershipRead(READER_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: TeamMember,
      rows: rows,
      select: USER_SELECT,
      props: PERSON_PROPS,
    });

    expect(rows[0]!.user!.name?.toString()).toBe("Their Own Name");
    expect(rows[0]!.user!.updatedAt).toBeDefined();
    expect(asked).not.toHaveBeenCalled();
  });

  test.each([
    ["OneUptime itself (root)", { isRoot: true }],
    [
      "a master admin",
      { isMasterAdmin: true, userId: new ObjectID(READER_ID) },
    ],
  ])(
    "%s sees every profile, and nothing is read for it",
    async (_case: string, props: DatabaseCommonInteractionProps) => {
      const asked: SpyInstance<
        typeof PendingInviteeProfiles.readPendingMemberships
      > = jest.spyOn(PendingInviteeProfiles, "readPendingMemberships");

      const rows: Array<TeamMember> = [membershipRead(PENDING_ID)];

      await PendingInviteeProfiles.withholdFromRows({
        modelType: TeamMember,
        rows: rows,
        select: USER_SELECT,
        props: props,
      });

      expect(rows[0]!.user!.name?.toString()).toBe("Their Own Name");
      expect(rows[0]!.user!.createdAt).toBeDefined();
      expect(asked).not.toHaveBeenCalled();
    },
  );

  test("a read that names people by id alone, or not at all, reads nothing more", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = jest.spyOn(PendingInviteeProfiles, "readPendingMemberships");

    for (const select of [
      { _id: true, userId: true },
      { _id: true, user: { _id: true } },
      { _id: true, team: { name: true } },
    ]) {
      await PendingInviteeProfiles.withholdFromRows({
        modelType: TeamMember,
        rows: [membershipRead(PENDING_ID)],
        select: select,
        props: PERSON_PROPS,
      });
    }

    expect(asked).not.toHaveBeenCalled();
  });

  test("people reached through a list (a record's owners) are each read as one", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([
        {
          userId: PENDING_ID,
          projectId: PROJECT_ID,
          inviteeName: "Grace (typed)",
          createdAt: new Date(),
        },
      ]);

    const incident: Incident = new Incident();
    (incident as unknown as Record<string, unknown>)["createdByUser"] =
      personRead(PENDING_ID);

    await PendingInviteeProfiles.withholdFromRows({
      modelType: Incident,
      rows: [incident],
      select: { _id: true, createdByUser: { name: true, email: true } },
      props: PERSON_PROPS,
    });

    const creator: User = (incident as unknown as { createdByUser: User })
      .createdByUser;

    expect(creator.name?.toString()).toBe("Grace (typed)");
    expect(creator.profilePictureId).toBeUndefined();
  });

  test("an API key reads as its one project", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([
        {
          userId: PENDING_ID,
          projectId: PROJECT_ID,
          inviteeName: null,
          createdAt: new Date(),
        },
      ]);

    const rows: Array<TeamMember> = [membershipRead(PENDING_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: TeamMember,
      rows: rows,
      select: USER_SELECT,
      props: API_KEY_PROPS,
    });

    expect(asked.mock.calls[0]![0].reader).toEqual({ projectId: PROJECT_ID });
    expect(rows[0]!.user!.name).toBeUndefined();
  });
});

describe("which of a person's invitations names them", () => {
  test("the request's project's first, then the newest that has a name; the reader never", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([
        {
          userId: PENDING_ID,
          projectId: OTHER_PROJECT_ID,
          inviteeName: "Newest elsewhere",
          createdAt: new Date("2026-11-19T00:00:00Z"),
        },
        {
          userId: PENDING_ID,
          projectId: PROJECT_ID,
          inviteeName: "From this project",
          createdAt: new Date("2025-01-01T00:00:00Z"),
        },
        {
          userId: MEMBER_ID,
          projectId: OTHER_PROJECT_ID,
          inviteeName: "  ",
          createdAt: new Date("2026-11-19T00:00:00Z"),
        },
        {
          userId: MEMBER_ID,
          projectId: OTHER_PROJECT_ID,
          inviteeName: "Older, but named",
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      ]);

    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfiles({
        userIds: [PENDING_ID.toUpperCase(), MEMBER_ID, READER_ID, "not-an-id"],
        props: PERSON_PROPS,
      });

    expect(withheld.get(PENDING_ID)?.inviteeName).toBe("From this project");
    expect(withheld.get(MEMBER_ID)?.inviteeName).toBe("Older, but named");
    expect(withheld.has(READER_ID)).toBe(false);
  });

  test("nobody to ask about: no person and no project", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = jest.spyOn(PendingInviteeProfiles, "readPendingMemberships");

    expect(
      (
        await PendingInviteeProfiles.readWithheldProfiles({
          userIds: [PENDING_ID],
          props: { userType: UserType.Public },
        })
      ).size,
    ).toBe(0);
    expect(asked).not.toHaveBeenCalled();
  });

  test("a project as the reader, for its audit log", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([
        {
          userId: PENDING_ID,
          projectId: PROJECT_ID,
          inviteeName: "Grace (typed)",
          createdAt: new Date(),
        },
      ]);

    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: [PENDING_ID],
        projectId: new ObjectID(PROJECT_ID),
      });

    expect(asked.mock.calls[0]![0].reader).toEqual({ projectId: PROJECT_ID });
    expect(withheld.get(PENDING_ID)?.inviteeName).toBe("Grace (typed)");
  });
});

describe("the query that finds someone pending for a reader", () => {
  test("a person's projects are every project they have a membership in", () => {
    const statement: string =
      PendingInviteeProfiles.getPendingMembershipsStatement({
        userId: READER_ID,
      });

    expect(statement).toContain(`"pending"."hasAcceptedInvitation" = false`);
    expect(statement).toContain(
      `SELECT "readerMembership"."projectId" FROM "TeamMember" "readerMembership" WHERE "readerMembership"."userId" = $2`,
    );
    // Joined any of the reader's projects: not pending for them.
    expect(statement).toContain(
      `NOT EXISTS (SELECT 1 FROM "TeamMember" "accepted" WHERE "accepted"."userId" = "pending"."userId" AND "accepted"."hasAcceptedInvitation" = true`,
    );
    expect(statement).toContain(`"pending"."userId" = ANY($1::uuid[])`);
  });

  test("a project's projects are itself", () => {
    const statement: string =
      PendingInviteeProfiles.getPendingMembershipsStatement({
        projectId: PROJECT_ID,
      });

    expect(statement).toContain(`"pending"."projectId" IN ($2::uuid)`);
    expect(statement).not.toContain("readerMembership");
  });
});

// The SQL a condition writes for a column.
function sqlOf(condition: unknown, alias: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<FindOperator<unknown>>)
      .map((each: FindOperator<unknown>): string => {
        return each.type === "raw" && each.getSql
          ? each.getSql(alias)
          : `[${each.type}]`;
      })
      .join(" AND ");
  }

  return operator.getSql ? operator.getSql(alias) : `[${operator.type}]`;
}

describe("what a read is filtered by", () => {
  test.each(
    PROFILE_COLUMNS_SHOWN_ONCE_JOINED.map((column: string) => {
      return [column];
    }),
  )(
    "a filter through a relation on a person's %s matches nobody pending for the reader",
    (column: string) => {
      const query: Record<string, unknown> = {
        projectId: PROJECT_ID,
        user: { [column]: ILike("%gra%") },
      };

      const narrowed: Record<string, unknown> =
        PendingInviteeProfiles.narrowRelationFilters({
          modelType: TeamMember,
          query: query,
          props: PERSON_PROPS,
        });

      const user: Record<string, unknown> = narrowed["user"] as Record<
        string,
        unknown
      >;

      expect(user[column]).toBe(
        (query["user"] as Record<string, unknown>)[column],
      );

      const sql: string = sqlOf(user["_id"], `"user"."_id"`);

      expect(sql).toContain(`("user"."_id" NOT IN (SELECT`);
      expect(sql).toContain(`"hasAcceptedInvitation" = false`);
      expect(sql).toMatch(/"userId" <> :pendingInviteeReader[A-Za-z]{10}/);

      // The caller's query is never written to.
      expect((query["user"] as Record<string, unknown>)["_id"]).toBeUndefined();
    },
  );

  test("a filter on a person's address or id alone is left as it is", () => {
    for (const filter of [
      { email: ILike("%gra%") },
      { _id: PENDING_ID },
    ] as Array<Record<string, unknown>>) {
      const query: Record<string, unknown> = { user: filter };

      expect(
        PendingInviteeProfiles.narrowRelationFilters({
          modelType: TeamMember,
          query: query,
          props: PERSON_PROPS,
        }),
      ).toBe(query);
    }
  });

  test("an id the filter already names is kept beside the condition", () => {
    const narrowed: Record<string, unknown> =
      PendingInviteeProfiles.narrowRelationFilters({
        modelType: TeamMember,
        query: {
          user: { _id: Equal(PENDING_ID), name: ILike("%a%") },
        } as Record<string, unknown>,
        props: PERSON_PROPS,
      });

    const id: FindOperator<unknown> = (
      narrowed["user"] as Record<string, unknown>
    )["_id"] as FindOperator<unknown>;

    expect(id.type).toBe("and");
  });

  test("a read across projects - one query each - is narrowed in each", () => {
    const narrowed: Array<Record<string, unknown>> =
      PendingInviteeProfiles.narrowRelationFilters({
        modelType: TeamMember,
        query: [
          { projectId: PROJECT_ID, user: { name: ILike("%a%") } },
          { projectId: OTHER_PROJECT_ID, user: { name: ILike("%a%") } },
        ] as Array<Record<string, unknown>>,
        props: PERSON_PROPS,
      });

    for (const each of narrowed) {
      expect((each["user"] as Record<string, unknown>)["_id"]).toBeDefined();
    }
  });

  test("a filter a level deeper is narrowed the same way", () => {
    const narrowed: Record<string, unknown> =
      PendingInviteeProfiles.narrowRelationFilters({
        modelType: TeamMember,
        query: {
          team: { createdByUser: { name: ILike("%a%") } },
        } as Record<string, unknown>,
        props: PERSON_PROPS,
      });

    const creator: Record<string, unknown> = (
      narrowed["team"] as Record<string, unknown>
    )["createdByUser"] as Record<string, unknown>;

    expect(sqlOf(creator["_id"], "c")).toContain("(c NOT IN (SELECT");
  });

  test("an API key's filter excludes those pending in its one project", () => {
    const narrowed: Record<string, unknown> =
      PendingInviteeProfiles.narrowRelationFilters({
        modelType: TeamMember,
        query: { user: { name: ILike("%a%") } } as Record<string, unknown>,
        props: API_KEY_PROPS,
      });

    const sql: string = sqlOf(
      (narrowed["user"] as Record<string, unknown>)["_id"],
      "u",
    );

    expect(sql).toMatch(/"projectId" IN \(:pendingInviteeReader[A-Za-z]{10}\)/);
    expect(sql).not.toContain("<>");
  });

  test.each([
    ["OneUptime itself", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
    ["nobody, in no project", { userType: UserType.Public }],
  ])(
    "%s: the query is left as it is",
    (_case: string, props: DatabaseCommonInteractionProps) => {
      const query: Record<string, unknown> = {
        user: { name: ILike("%a%") },
      };

      expect(
        PendingInviteeProfiles.narrowRelationFilters({
          modelType: TeamMember,
          query: query,
          props: props,
        }),
      ).toBe(query);
    },
  );
});

describe("a person's account dates are theirs", () => {
  test.each(
    ACCOUNT_DATE_COLUMNS.map((column: string) => {
      return [column];
    }),
  )(
    "a filter or an order through a relation by a person's %s is refused",
    (column: string) => {
      expect(() => {
        PendingInviteeProfiles.assertMayReadThroughRelation({
          relatedModel: new User(),
          column: column,
          props: PERSON_PROPS,
        });
      }).toThrow(
        new NotAuthorizedException(
          ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE,
        ),
      );
    },
  );

  test("their other columns, another model's dates, and OneUptime's and a master admin's reads pass", () => {
    const passes: Array<
      Parameters<typeof PendingInviteeProfiles.assertMayReadThroughRelation>[0]
    > = [
      { relatedModel: new User(), column: "name", props: PERSON_PROPS },
      { relatedModel: new User(), column: "email", props: PERSON_PROPS },
      {
        relatedModel: new Incident(),
        column: "createdAt",
        props: PERSON_PROPS,
      },
      {
        relatedModel: new User(),
        column: "updatedAt",
        props: { isRoot: true },
      },
      {
        relatedModel: new User(),
        column: "createdAt",
        props: { isMasterAdmin: true },
      },
    ];

    for (const each of passes) {
      expect(() => {
        PendingInviteeProfiles.assertMayReadThroughRelation(each);
      }).not.toThrow();
    }
  });

  test("the refusal is a sentence that says what to do instead", () => {
    expect(ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE).toMatch(
      /^[A-Z].*\.$/,
    );
    expect(ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE).toContain(
      "record's own dates",
    );
  });
});

describe("who sees a person's picture", () => {
  const person: ObjectID = new ObjectID(PENDING_ID);

  test("nobody signed in sees none, and nothing is read", async () => {
    const shares: SpyInstance<
      typeof PendingInviteeProfiles.sharesJoinedProject
    > = jest.spyOn(PendingInviteeProfiles, "sharesJoinedProject");

    expect(
      await PendingInviteeProfiles.maySeePicture({
        personUserId: person,
        reader: null,
      }),
    ).toBe(false);
    expect(shares).not.toHaveBeenCalled();
  });

  test("the person themselves, however their id is spelled, and a master admin", async () => {
    const shares: SpyInstance<
      typeof PendingInviteeProfiles.sharesJoinedProject
    > = jest.spyOn(PendingInviteeProfiles, "sharesJoinedProject");

    expect(
      await PendingInviteeProfiles.maySeePicture({
        personUserId: person,
        reader: {
          userId: new ObjectID(PENDING_ID.toUpperCase()),
          isMasterAdmin: false,
        },
      }),
    ).toBe(true);
    expect(
      await PendingInviteeProfiles.maySeePicture({
        personUserId: person,
        reader: { userId: new ObjectID(READER_ID), isMasterAdmin: true },
      }),
    ).toBe(true);
    expect(shares).not.toHaveBeenCalled();
  });

  test.each([
    ["has joined a project of the reader's", true],
    ["has only been invited, or shares no project", false],
  ])(
    "anyone else, when the person %s: %p",
    async (_case: string, shared: boolean) => {
      const shares: SpyInstance<
        typeof PendingInviteeProfiles.sharesJoinedProject
      > = jest
        .spyOn(PendingInviteeProfiles, "sharesJoinedProject")
        .mockResolvedValue(shared);

      expect(
        await PendingInviteeProfiles.maySeePicture({
          personUserId: person,
          reader: { userId: new ObjectID(READER_ID), isMasterAdmin: false },
        }),
      ).toBe(shared);
      expect(shares).toHaveBeenCalledWith({
        personUserId: PENDING_ID,
        readerUserId: READER_ID,
      });
    },
  );

  test("with no database to ask, nobody else sees it", async () => {
    expect(
      await PendingInviteeProfiles.sharesJoinedProject({
        personUserId: PENDING_ID,
        readerUserId: READER_ID,
      }),
    ).toBe(false);
  });
});

describe("withholdFromPerson, one person at a time", () => {
  test("a person with no id we can read keeps their profile but not their dates", () => {
    const person: Record<string, unknown> = {
      name: new Name("Someone"),
      updatedAt: new Date(),
    };

    PendingInviteeProfiles.withholdFromPerson({
      person: person,
      readerUserId: READER_ID,
      withheld: new Map<string, WithheldProfile>(),
    });

    expect((person["name"] as Name).toString()).toBe("Someone");
    expect(person["updatedAt"]).toBeUndefined();
  });

  test("columns a read did not return are not added", () => {
    const person: Record<string, unknown> = { _id: PENDING_ID };

    PendingInviteeProfiles.withholdFromPerson({
      person: person,
      readerUserId: READER_ID,
      withheld: new Map<string, WithheldProfile>([
        [PENDING_ID, { inviteeName: "Grace" }],
      ]),
    });

    expect(Object.keys(person)).toEqual(["_id"]);
  });

  test("And() is what an id already named is combined with", () => {
    // Guards the shape the narrowing above relies on.
    expect(And(Equal("x"), Equal("y")).type).toBe("and");
  });
});
