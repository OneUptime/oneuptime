import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import TeamMemberService from "../../Services/TeamMemberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { Raw } from "typeorm";

/*
 * Who counts as a member of a project, for everything that delivers a
 * notification to a person on the project's behalf: on-call pages, owner and
 * shift notifications, email rollups, workspace channel invites, routed
 * incoming calls.
 *
 * A member holds an ACCEPTED invitation to at least one team of the project -
 * the rule TeamMemberService.isUserMemberOfProject applies, and the one the
 * leave cleanups run on. A pending invitee is not a member yet, and somebody
 * removed from every team is not one any more: their personal notification
 * settings for the project are removed when they leave
 * (ProjectLeaveNotificationCleanup), and a row that still names them - an
 * owner on a closed incident, a reference a failed cleanup left behind -
 * never delivers anything, because every sender asks this first.
 *
 * Reads are batched: a sender asks once for everybody it is about to reach,
 * never once per recipient. Where a sender already reads one row of the
 * person's per send (their notification setting, their routed call number),
 * the membership condition rides on that read instead (userIdWhileMember),
 * so the check costs no extra query at all.
 */
export interface ProjectUserPair {
  projectId: ObjectID;
  userId: ObjectID;
}

/*
 * Where each of a batch of people stands in one project, as lower-cased ids
 * (getStandings). Somebody in neither set holds no membership of the project
 * at all: they left it, or were never in it.
 */
export interface ProjectMembershipStandings {
  // Hold an accepted membership of at least one team of the project.
  memberUserIds: Set<string>;
  // Hold only invitations to the project they have not accepted yet.
  invitedUserIds: Set<string>;
}

// Pairs per statement; two bound parameters each, far below Postgres' limit.
const MEMBERSHIP_PAIRS_PER_QUERY: number = 500;

export default class ProjectMembership {
  /*
   * The key getMemberKeys answers with. Lower-cased, because ids read back
   * from Postgres and ids from saved configuration differ in case.
   */
  public static getKey(
    projectId: ObjectID | string,
    userId: ObjectID | string,
  ): string {
    return `${projectId.toString().toLowerCase()}:${userId
      .toString()
      .toLowerCase()}`;
  }

  /*
   * The membership rule as SQL, for statements that cannot go through the
   * query builder (the data migration, the conditions below). Both operands
   * are SQL expressions - a column or a bound parameter - never values.
   */
  public static getMembershipExistsSql(data: {
    projectIdSql: string;
    userIdSql: string;
  }): string {
    return `EXISTS (SELECT 1 FROM "TeamMember" "projectMembership" WHERE "projectMembership"."projectId" = ${data.projectIdSql} AND "projectMembership"."userId" = ${data.userIdSql} AND "projectMembership"."hasAcceptedInvitation" = true AND "projectMembership"."deletedAt" IS NULL)`;
  }

  /*
   * A condition for the user column of a per-person row (a notification
   * setting, a routed call number): matches the row of `userId`, and only
   * while that person is a member of the project. A read carrying it comes
   * back empty for somebody who has left, exactly as if they had nothing set
   * up - one query, the one the sender was going to make anyway.
   */
  public static userIdWhileMember(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): FindWhereProperty<any> {
    const userIdParameter: string = `memberUserId${Text.generateRandomText(10)}`;
    const projectIdParameter: string = `memberProjectId${Text.generateRandomText(10)}`;

    return Raw(
      (alias: string): string => {
        return `(${alias} = :${userIdParameter} AND ${ProjectMembership.getMembershipExistsSql(
          {
            projectIdSql: `:${projectIdParameter}`,
            userIdSql: alias,
          },
        )})`;
      },
      {
        [userIdParameter]: data.userId.toString(),
        [projectIdParameter]: data.projectId.toString(),
      },
    );
  }

  /*
   * The ids among `userIds` that belong to members of the project, lower-cased.
   * One read for the whole batch.
   */
  public static async getMemberUserIds(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID | string>;
  }): Promise<Set<string>> {
    const memberUserIds: Array<ObjectID> =
      await TeamMemberService.getProjectMemberUserIds({
        projectId: data.projectId,
        userIds: data.userIds,
      });

    return new Set<string>(
      memberUserIds.map((userId: ObjectID): string => {
        return userId.toString().toLowerCase();
      }),
    );
  }

  /*
   * Whether one person is a member of the project now - read from the
   * database, never from a cached permission set. For a check that stands
   * between a stored credential (a connected MCP client, a calendar link)
   * and the project, on every use. One count, the same rule the leave
   * cleanups apply (TeamMemberService.isUserMemberOfProject).
   */
  public static async isMember(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    return await TeamMemberService.isUserMemberOfProject({
      projectId: data.projectId,
      userId: data.userId,
    });
  }

  /*
   * Every project the person is a member of now, each once - read from the
   * database. For reads that span a person's projects (their own upcoming
   * shifts), so a project they have left is never among them, even while a
   * row of it still names them.
   */
  public static async getMemberProjectIds(data: {
    userId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: data.userId,
        hasAcceptedInvitation: true,
      },
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const membership of memberships) {
      if (membership.projectId) {
        projectIds.set(
          membership.projectId.toString().toLowerCase(),
          membership.projectId,
        );
      }
    }

    return Array.from(projectIds.values());
  }

  /*
   * Where each of `userIds` stands in the project: a member, only invited,
   * or neither. One read of the people's membership rows for the whole
   * batch, accepted and pending together, so telling an invitation not
   * accepted yet apart from having left costs nothing extra. An id that is
   * not a uuid is in neither set.
   */
  public static async getStandings(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID | string>;
  }): Promise<ProjectMembershipStandings> {
    const standings: ProjectMembershipStandings = {
      memberUserIds: new Set<string>(),
      invitedUserIds: new Set<string>(),
    };

    const requested: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const userId of data.userIds) {
      const value: string = userId?.toString() || "";

      if (ObjectID.isValidUUID(value)) {
        requested.set(value.toLowerCase(), new ObjectID(value));
      }
    }

    if (requested.size === 0) {
      return standings;
    }

    const rows: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(Array.from(requested.values())),
      },
      select: {
        userId: true,
        hasAcceptedInvitation: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const pending: Set<string> = new Set<string>();

    for (const row of rows) {
      const userId: string = row.userId?.toString().toLowerCase() || "";

      if (!userId) {
        continue;
      }

      if (row.hasAcceptedInvitation) {
        standings.memberUserIds.add(userId);
      } else {
        pending.add(userId);
      }
    }

    for (const userId of pending) {
      if (!standings.memberUserIds.has(userId)) {
        standings.invitedUserIds.add(userId);
      }
    }

    return standings;
  }

  /*
   * For a batch spanning several projects (a worker tick): the keys
   * (getKey) of the pairs whose person is a member of that project. One
   * statement per MEMBERSHIP_PAIRS_PER_QUERY pairs, matching exact pairs - a
   * person's membership of another project in the batch never counts for
   * this one. An id that is not a uuid matches nothing.
   */
  public static async getMemberKeys(
    pairs: Array<ProjectUserPair>,
  ): Promise<Set<string>> {
    const requested: Map<string, ProjectUserPair> = new Map<
      string,
      ProjectUserPair
    >();

    for (const pair of pairs) {
      if (!pair?.projectId || !pair?.userId) {
        continue;
      }

      if (
        !ObjectID.isValidUUID(pair.projectId.toString()) ||
        !ObjectID.isValidUUID(pair.userId.toString())
      ) {
        continue;
      }

      requested.set(
        ProjectMembership.getKey(pair.projectId, pair.userId),
        pair,
      );
    }

    const memberKeys: Set<string> = new Set<string>();

    const uniquePairs: Array<ProjectUserPair> = Array.from(requested.values());

    for (
      let start: number = 0;
      start < uniquePairs.length;
      start += MEMBERSHIP_PAIRS_PER_QUERY
    ) {
      const chunk: Array<ProjectUserPair> = uniquePairs.slice(
        start,
        start + MEMBERSHIP_PAIRS_PER_QUERY,
      );

      const parameters: Array<string> = [];
      const values: Array<string> = [];

      for (const pair of chunk) {
        parameters.push(pair.projectId.toString(), pair.userId.toString());
        values.push(
          `($${parameters.length - 1}::uuid, $${parameters.length}::uuid)`,
        );
      }

      const rows: Array<{ projectId: string; userId: string }> =
        await TeamMemberService.getRepository().manager.query(
          `SELECT DISTINCT member."projectId"::text AS "projectId", member."userId"::text AS "userId"
             FROM "TeamMember" member
             JOIN (VALUES ${values.join(", ")}) AS requested("projectId", "userId")
               ON member."projectId" = requested."projectId"
              AND member."userId" = requested."userId"
            WHERE member."hasAcceptedInvitation" = true
              AND member."deletedAt" IS NULL`,
          parameters,
        );

      for (const row of rows || []) {
        if (row?.projectId && row?.userId) {
          memberKeys.add(ProjectMembership.getKey(row.projectId, row.userId));
        }
      }
    }

    return memberKeys;
  }
}
