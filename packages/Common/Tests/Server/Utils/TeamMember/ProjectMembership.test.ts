import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectMembership, {
  ProjectMembershipStandings,
  ProjectUserPair,
} from "../../../../Server/Utils/TeamMember/ProjectMembership";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * ProjectMembership is the one membership check every sender asks before it
 * delivers anything on a project's behalf. A member holds an ACCEPTED
 * membership of at least one team of the project; a pending invitee is not
 * one yet, and somebody removed from every team is not one any more.
 *
 * Pinned here:
 *   - the rule in SQL (accepted, not deleted, this project, this person),
 *   - the per-person condition that rides on a read a sender already makes,
 *   - the batched reads: one read for a batch of people, exact pairs across
 *     projects, chunked, deduplicated, with ids that are not uuids dropped,
 *   - members and invitees told apart in one read (getStandings), one
 *     person's membership read from the database (isMember), and the
 *     projects a person is a member of (getMemberProjectIds).
 */

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);
const USER_1: ObjectID = new ObjectID("11111111-0000-4000-8000-000000000001");
const USER_2: ObjectID = new ObjectID("22222222-0000-4000-8000-000000000002");
const USER_3: ObjectID = new ObjectID("33333333-0000-4000-8000-000000000003");

type QueryFunction = (
  sql: string,
  parameters: Array<string>,
) => Promise<Array<{ projectId: string; userId: string }>>;

function mockMembershipQuery(
  rows: Array<{ projectId: string; userId: string }>,
): Mock<QueryFunction> {
  const query: Mock<QueryFunction> = jest.fn<QueryFunction>(
    async (): Promise<Array<{ projectId: string; userId: string }>> => {
      return rows;
    },
  );

  jest
    .spyOn(TeamMemberService, "getRepository")
    .mockReturnValue({ manager: { query } } as never);

  return query;
}

describe("ProjectMembership", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the rule", () => {
    test("a key is the lower-cased project and person, so ids compare whatever their case", () => {
      expect(
        ProjectMembership.getKey(
          "AAAAAAAA-0000-4000-8000-000000000001",
          "11111111-0000-4000-8000-00000000000A",
        ),
      ).toBe(
        "aaaaaaaa-0000-4000-8000-000000000001:11111111-0000-4000-8000-00000000000a",
      );
    });

    test("membership is an accepted, not deleted TeamMember row of that project and person", () => {
      const sql: string = ProjectMembership.getMembershipExistsSql({
        projectIdSql: 'row."projectId"',
        userIdSql: 'row."userId"',
      });

      expect(sql.startsWith('EXISTS (SELECT 1 FROM "TeamMember"')).toBe(true);
      expect(sql).toContain('"projectId" = row."projectId"');
      expect(sql).toContain('"userId" = row."userId"');
      expect(sql).toContain('"hasAcceptedInvitation" = true');
      expect(sql).toContain('"deletedAt" IS NULL');
    });
  });

  describe("userIdWhileMember", () => {
    test("matches the person's own row, and only while they are a member of the project", () => {
      const condition: FindOperator<unknown> =
        ProjectMembership.userIdWhileMember({
          projectId: PROJECT_A,
          userId: USER_1,
        }) as FindOperator<unknown>;

      expect(condition).toBeInstanceOf(FindOperator);
      expect(condition.type).toBe("raw");

      const parameters: Record<string, unknown> =
        (condition.objectLiteralParameters as Record<string, unknown>) || {};
      const values: Array<unknown> = Object.values(parameters);

      expect(values).toContain(USER_1.toString());
      expect(values).toContain(PROJECT_A.toString());

      const sql: string = (condition.getSql as (alias: string) => string)(
        '"UserNotificationSetting"."userId"',
      );

      const userParameter: string = Object.keys(parameters).find(
        (key: string): boolean => {
          return parameters[key] === USER_1.toString();
        },
      )!;
      const projectParameter: string = Object.keys(parameters).find(
        (key: string): boolean => {
          return parameters[key] === PROJECT_A.toString();
        },
      )!;

      // The row is the person's...
      expect(sql).toContain(
        `"UserNotificationSetting"."userId" = :${userParameter}`,
      );
      // ...and the person holds an accepted membership of this project.
      expect(sql).toContain(
        ProjectMembership.getMembershipExistsSql({
          projectIdSql: `:${projectParameter}`,
          userIdSql: '"UserNotificationSetting"."userId"',
        }),
      );
    });

    test("two conditions in one query never share a parameter name", () => {
      const first: FindOperator<unknown> = ProjectMembership.userIdWhileMember({
        projectId: PROJECT_A,
        userId: USER_1,
      }) as FindOperator<unknown>;
      const second: FindOperator<unknown> = ProjectMembership.userIdWhileMember(
        {
          projectId: PROJECT_A,
          userId: USER_1,
        },
      ) as FindOperator<unknown>;

      const firstKeys: Array<string> = Object.keys(
        first.objectLiteralParameters || {},
      );
      const secondKeys: Array<string> = Object.keys(
        second.objectLiteralParameters || {},
      );

      for (const key of firstKeys) {
        expect(secondKeys).not.toContain(key);
        // Bare identifiers TypeORM can bind.
        expect(key).toMatch(/^[A-Za-z]+$/);
      }
    });
  });

  describe("getMemberUserIds", () => {
    test("one read for the whole batch, answered as lower-cased ids", async () => {
      const read: SpyInstance<
        typeof TeamMemberService.getProjectMemberUserIds
      > = jest
        .spyOn(TeamMemberService, "getProjectMemberUserIds")
        .mockResolvedValue([
          new ObjectID(USER_1.toString().toUpperCase()),
          USER_3,
        ]);

      const members: Set<string> = await ProjectMembership.getMemberUserIds({
        projectId: PROJECT_A,
        userIds: [USER_1, USER_2, USER_3],
      });

      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_A,
        userIds: [USER_1, USER_2, USER_3],
      });
      expect(Array.from(members).sort()).toEqual(
        [USER_1.toString(), USER_3.toString()].sort(),
      );
    });
  });

  describe("getStandings", () => {
    test("one read of every membership row of the people asked about, accepted and pending together", async () => {
      const read: SpyInstance<typeof TeamMemberService.findBy> = jest
        .spyOn(TeamMemberService, "findBy")
        .mockResolvedValue([
          // A member of two teams, one of them still pending.
          { userId: USER_1, hasAcceptedInvitation: true },
          { userId: USER_1, hasAcceptedInvitation: false },
          // Only invited, the id read back upper-cased.
          {
            userId: new ObjectID(USER_2.toString().toUpperCase()),
            hasAcceptedInvitation: false,
          },
        ] as never);

      const standings: ProjectMembershipStandings =
        await ProjectMembership.getStandings({
          projectId: PROJECT_A,
          userIds: [USER_1, USER_2, USER_3, "not-a-uuid"],
        });

      expect(read).toHaveBeenCalledTimes(1);

      const call: Parameters<typeof TeamMemberService.findBy>[0] =
        read.mock.calls[0]![0];
      const query: Record<string, unknown> = call.query as Record<
        string,
        unknown
      >;

      expect(query["projectId"]).toBe(PROJECT_A);
      // Accepted and pending alike: the flag is read, not filtered on.
      expect(query["hasAcceptedInvitation"]).toBeUndefined();
      expect(call.select).toEqual({
        userId: true,
        hasAcceptedInvitation: true,
      });
      expect(call.props).toEqual({ isRoot: true });
      expect(call.limit).toBe(LIMIT_MAX);
      expect(call.skip).toBe(0);

      // A member with a pending row elsewhere is a member, not invited.
      expect(Array.from(standings.memberUserIds)).toEqual([USER_1.toString()]);
      expect(Array.from(standings.invitedUserIds)).toEqual([USER_2.toString()]);
    });

    test("somebody with no row at all is in neither set: they left, or were never in it", async () => {
      jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

      const standings: ProjectMembershipStandings =
        await ProjectMembership.getStandings({
          projectId: PROJECT_A,
          userIds: [USER_3],
        });

      expect(standings.memberUserIds.size).toBe(0);
      expect(standings.invitedUserIds.size).toBe(0);
    });

    test("nobody to ask about means nothing read", async () => {
      const read: SpyInstance<typeof TeamMemberService.findBy> = jest.spyOn(
        TeamMemberService,
        "findBy",
      );

      const standings: ProjectMembershipStandings =
        await ProjectMembership.getStandings({
          projectId: PROJECT_A,
          userIds: ["not-a-uuid", ""],
        });

      expect(standings.memberUserIds.size).toBe(0);
      expect(standings.invitedUserIds.size).toBe(0);
      expect(read).not.toHaveBeenCalled();
    });

    test("a failed read is not swallowed", async () => {
      jest
        .spyOn(TeamMemberService, "findBy")
        .mockRejectedValue(new Error("database unavailable"));

      await expect(
        ProjectMembership.getStandings({
          projectId: PROJECT_A,
          userIds: [USER_1],
        }),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("getInvitedUserIds", () => {
    test("the people asked about who are only invited, from one read, as lower-cased ids", async () => {
      const read: SpyInstance<typeof TeamMemberService.findBy> = jest
        .spyOn(TeamMemberService, "findBy")
        .mockResolvedValue([
          {
            userId: new ObjectID(USER_2.toString().toUpperCase()),
            hasAcceptedInvitation: false,
          },
          { userId: USER_1, hasAcceptedInvitation: true },
        ] as never);

      const invited: Set<string> = await ProjectMembership.getInvitedUserIds({
        projectId: PROJECT_A,
        userIds: [USER_1, USER_2, "not-a-uuid"],
      });

      expect(read).toHaveBeenCalledTimes(1);
      expect(
        (read.mock.calls[0]![0].query as Record<string, unknown>)["projectId"],
      ).toBe(PROJECT_A);
      expect(Array.from(invited)).toEqual([USER_2.toString()]);
    });

    test("nobody to ask about means nothing read", async () => {
      const read: SpyInstance<typeof TeamMemberService.findBy> = jest.spyOn(
        TeamMemberService,
        "findBy",
      );

      await expect(
        ProjectMembership.getInvitedUserIds({
          projectId: PROJECT_A,
          userIds: ["not-a-uuid"],
        }),
      ).resolves.toEqual(new Set<string>());
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("isMember", () => {
    test("asks the database about that one person, whatever the case of the id", async () => {
      const read: SpyInstance<
        typeof TeamMemberService.getProjectMemberUserIds
      > = jest
        .spyOn(TeamMemberService, "getProjectMemberUserIds")
        .mockResolvedValue([new ObjectID(USER_1.toString().toUpperCase())]);

      await expect(
        ProjectMembership.isMember({ projectId: PROJECT_A, userId: USER_1 }),
      ).resolves.toBe(true);

      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_A,
        userIds: [USER_1],
      });
    });

    test("somebody who has left, or only been invited, is not a member", async () => {
      jest
        .spyOn(TeamMemberService, "getProjectMemberUserIds")
        .mockResolvedValue([]);

      await expect(
        ProjectMembership.isMember({ projectId: PROJECT_A, userId: USER_2 }),
      ).resolves.toBe(false);
    });

    test("a failed read is an error, never an answer", async () => {
      jest
        .spyOn(TeamMemberService, "getProjectMemberUserIds")
        .mockRejectedValue(new Error("database unavailable"));

      await expect(
        ProjectMembership.isMember({ projectId: PROJECT_A, userId: USER_1 }),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("getMemberProjectIds", () => {
    test("every project of the person's accepted memberships, each once", async () => {
      const read: SpyInstance<typeof TeamMemberService.findBy> = jest
        .spyOn(TeamMemberService, "findBy")
        .mockResolvedValue([
          { projectId: PROJECT_A },
          // Two teams of the same project.
          { projectId: new ObjectID(PROJECT_A.toString().toUpperCase()) },
          { projectId: PROJECT_B },
          { projectId: undefined },
        ] as never);

      const projectIds: Array<ObjectID> =
        await ProjectMembership.getMemberProjectIds({ userId: USER_1 });

      expect(
        projectIds.map((projectId: ObjectID): string => {
          return projectId.toString().toLowerCase();
        }),
      ).toEqual([PROJECT_A.toString(), PROJECT_B.toString()]);

      const call: Parameters<typeof TeamMemberService.findBy>[0] =
        read.mock.calls[0]![0];

      // Accepted rows only: an invitation is not a project of theirs yet.
      expect(call.query).toEqual({
        userId: USER_1,
        hasAcceptedInvitation: true,
      });
      expect(call.props).toEqual({ isRoot: true });
      expect(call.limit).toBe(LIMIT_MAX);
    });

    test("somebody in no project gets none", async () => {
      jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

      await expect(
        ProjectMembership.getMemberProjectIds({ userId: USER_3 }),
      ).resolves.toEqual([]);
    });
  });

  describe("getMemberKeys", () => {
    test("nothing asked means nothing read", async () => {
      const query: Mock<QueryFunction> = mockMembershipQuery([]);

      await expect(ProjectMembership.getMemberKeys([])).resolves.toEqual(
        new Set<string>(),
      );
      expect(query).not.toHaveBeenCalled();
    });

    test("one statement for a batch across projects, matching exact (project, person) pairs", async () => {
      const query: Mock<QueryFunction> = mockMembershipQuery([
        { projectId: PROJECT_A.toString(), userId: USER_1.toString() },
        { projectId: PROJECT_B.toString(), userId: USER_2.toString() },
      ]);

      const keys: Set<string> = await ProjectMembership.getMemberKeys([
        { projectId: PROJECT_A, userId: USER_1 },
        { projectId: PROJECT_A, userId: USER_2 },
        { projectId: PROJECT_B, userId: USER_2 },
      ]);

      expect(query).toHaveBeenCalledTimes(1);

      const [sql, parameters] = query.mock.calls[0]!;

      // Exact pairs, joined - never "anyone of these people in any of these projects".
      expect(sql).toContain(
        "JOIN (VALUES ($1::uuid, $2::uuid), ($3::uuid, $4::uuid), ($5::uuid, $6::uuid))",
      );
      expect(sql).toContain('member."hasAcceptedInvitation" = true');
      expect(sql).toContain('member."deletedAt" IS NULL');
      expect(parameters).toEqual([
        PROJECT_A.toString(),
        USER_1.toString(),
        PROJECT_A.toString(),
        USER_2.toString(),
        PROJECT_B.toString(),
        USER_2.toString(),
      ]);

      expect(keys).toEqual(
        new Set<string>([
          ProjectMembership.getKey(PROJECT_A, USER_1),
          ProjectMembership.getKey(PROJECT_B, USER_2),
        ]),
      );
      // USER_2 is a member of PROJECT_B, which says nothing about PROJECT_A.
      expect(keys.has(ProjectMembership.getKey(PROJECT_A, USER_2))).toBe(false);
    });

    test("a pair asked twice is asked once, and ids that are not uuids are dropped", async () => {
      const query: Mock<QueryFunction> = mockMembershipQuery([]);

      await ProjectMembership.getMemberKeys([
        { projectId: PROJECT_A, userId: USER_1 },
        {
          projectId: new ObjectID(PROJECT_A.toString().toUpperCase()),
          userId: USER_1,
        },
        { projectId: new ObjectID("not-a-uuid"), userId: USER_2 },
        {
          projectId: PROJECT_A,
          userId: undefined as unknown as ObjectID,
        },
      ] as Array<ProjectUserPair>);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]![1]).toEqual([
        PROJECT_A.toString().toUpperCase(),
        USER_1.toString(),
      ]);
    });

    test("only invalid ids means nothing read", async () => {
      const query: Mock<QueryFunction> = mockMembershipQuery([]);

      await expect(
        ProjectMembership.getMemberKeys([
          {
            projectId: new ObjectID("project-1"),
            userId: new ObjectID("user-1"),
          },
        ]),
      ).resolves.toEqual(new Set<string>());
      expect(query).not.toHaveBeenCalled();
    });

    test("a large batch is read in chunks of 500 pairs, never one unbounded statement", async () => {
      const query: Mock<QueryFunction> = mockMembershipQuery([]);

      const pairs: Array<ProjectUserPair> = [];

      for (let index: number = 0; index < 1001; index++) {
        pairs.push({ projectId: PROJECT_A, userId: ObjectID.generate() });
      }

      await ProjectMembership.getMemberKeys(pairs);

      expect(query).toHaveBeenCalledTimes(3);
      expect(query.mock.calls[0]![1]).toHaveLength(1000);
      expect(query.mock.calls[1]![1]).toHaveLength(1000);
      expect(query.mock.calls[2]![1]).toHaveLength(2);
    });

    test("a failed read is not swallowed: a sender must not take an error for 'not a member'", async () => {
      jest.spyOn(TeamMemberService, "getRepository").mockReturnValue({
        manager: {
          query: async (): Promise<never> => {
            throw new Error("database unavailable");
          },
        },
      } as never);

      await expect(
        ProjectMembership.getMemberKeys([
          { projectId: PROJECT_A, userId: USER_1 },
        ]),
      ).rejects.toThrow("database unavailable");
    });
  });
});
