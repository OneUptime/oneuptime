import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService, {
  NextInRotationInSchedule,
} from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyTimeLogService from "../../Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../Services/TeamMemberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import ProjectMembership, {
  ProjectUserPair,
} from "../TeamMember/ProjectMembership";

/*
 * WHO AN ESCALATION RULE PAGES NOW, AND THROUGH WHAT (#10464, #10412).
 *
 * A rule names people, teams and on-call schedules - a row of its own each
 * (OnCallDutyPolicyEscalationRule{User,Team,Schedule}) - and one person can
 * be paged by it through several of them: named on it and a member of one of
 * its teams, a member of two of its teams, on call in one of its schedules.
 * A level pages each person once, whichever of its rows names them
 * (OnCallDutyPolicyEscalationRuleService.pageTargets). Each row used to tell
 * them on its own that they were added, and that they were removed - so a
 * person heard "added" twice for one rule, and "removed" while another row
 * still paged them. Here is who a rule pages now, by each path that pages
 * them, so a row's add and removal tell them only what changed for them:
 *
 *   - "added" when the rule starts paging them where it did not before. A
 *     person named on the rule, or in one of its teams, is paged by it at any
 *     time: being named is news unless a row made before this one names them
 *     already (LASTING_PATHS) - being on call in one of its schedules for a
 *     shift is not that, and the schedule's hand-offs say when shifts start
 *     and end. Whoever is on call in a schedule added to the rule is told,
 *     unless the rule paged them already in any way (EVERY_PATH);
 *   - "removed" only when nothing on the rule pages them any more: named on
 *     it, in one of its teams, on call in one of its schedules now, or next
 *     in the rotation of one it pages that way.
 *
 * "Made before this one" settles two adds at the same moment: each counts
 * only the rows older than its own, so one of them always tells the person,
 * and only a race that has both read before either wrote tells them twice.
 *
 * The on-call time log is kept per path, as OnCallDutyPolicyTimeLogService
 * keeps it (named, a team, a schedule): a path's log starts with it and ends
 * with it, and the timesheet counts a person's overlapping logs once. Taking
 * one path away keeps the logs of the paths left open (keepTimeLogsOpen), so
 * someone still paged is never shown as off call - a team they joined after
 * it was put on the rule had no log of its own until then.
 *
 * ONLY A MEMBER OF THE PROJECT IS PAGED (ProjectMembership). Someone only
 * invited may be named on a rule, or be in one of its teams or schedules,
 * and is paged once they join: until they accept, no path pages them, so no
 * row of the rule tells them anything or logs them as on call. Their logs
 * start when they join (openTimeLogsOfMember). Someone who left the project
 * is paged by nothing either.
 *
 * The next person in a schedule's rotation is paged by a rule that pages it
 * that way, as a backup: it keeps that person from hearing "removed" while
 * they are, and, as before, is never told on its own nor logged.
 */

export enum RulePathKind {
  // Named on the rule.
  Person = "Person",
  // An accepted member of a team the rule names.
  Team = "Team",
  // On call now in a schedule the rule pages whoever is on call in.
  OnCall = "OnCall",
  // Next now in the rotation of a schedule the rule pages that way.
  NextInRotation = "NextInRotation",
}

// One way a rule pages a person: the row that makes it, and when it was made.
export interface RulePath {
  kind: RulePathKind;
  rowId: string;
  createdAt: Date | null;
  // The team a Team path is through, and the schedule of the other two.
  teamId: ObjectID | null;
  scheduleId: ObjectID | null;
}

// Everyone a rule pages now, by lower-cased user id, each with every path.
export type RuleReach = Map<string, Array<RulePath>>;

// The paths that page a person at any time, and every path.
export const LASTING_PATHS: ReadonlyArray<RulePathKind> = [
  RulePathKind.Person,
  RulePathKind.Team,
];

export const EVERY_PATH: ReadonlyArray<RulePathKind> = [
  RulePathKind.Person,
  RulePathKind.Team,
  RulePathKind.OnCall,
  RulePathKind.NextInRotation,
];

// The rule a read is about.
export interface EscalationRuleOfReach {
  projectId: ObjectID;
  ruleId: ObjectID;
  // Its policy: a schedule applies the policy's own overrides too.
  policyId: ObjectID | null;
}

// Who of a batch of people is a member of their project (readMembers).
export interface RuleMembers {
  isMember: (projectId: ObjectID, userId: ObjectID) => boolean;
}

export type { ProjectUserPair };

const keyOf: (userId: ObjectID | string) => string = (
  userId: ObjectID | string,
): string => {
  return userId.toString().toLowerCase();
};

export default class EscalationRuleReach {
  /*
   * Who the rule pages now, through what. Its schedules' on-call person and
   * next in rotation are worked out only `withSchedules`: a person's or a
   * team's add asks for the lasting paths alone, and the rosters cost a
   * read each.
   */
  public static async read(
    data: EscalationRuleOfReach & { withSchedules: boolean },
  ): Promise<RuleReach> {
    const [userRows, teamRows, scheduleRows]: [
      Array<OnCallDutyPolicyEscalationRuleUser>,
      Array<OnCallDutyPolicyEscalationRuleTeam>,
      Array<OnCallDutyPolicyEscalationRuleSchedule>,
    ] = await Promise.all([
      OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: {
          projectId: data.projectId,
          onCallDutyPolicyEscalationRuleId: data.ruleId,
        },
        select: { _id: true, userId: true, createdAt: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      OnCallDutyPolicyEscalationRuleTeamService.findBy({
        query: {
          projectId: data.projectId,
          onCallDutyPolicyEscalationRuleId: data.ruleId,
        },
        select: { _id: true, teamId: true, createdAt: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      data.withSchedules
        ? OnCallDutyPolicyEscalationRuleScheduleService.findBy({
            query: {
              projectId: data.projectId,
              onCallDutyPolicyEscalationRuleId: data.ruleId,
            },
            select: {
              _id: true,
              onCallDutyPolicyScheduleId: true,
              pageNextInRotation: true,
              createdAt: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const found: Array<{ userId: ObjectID; path: RulePath }> = [];

    for (const row of userRows) {
      if (row.userId && row.id) {
        found.push({
          userId: row.userId,
          path: {
            kind: RulePathKind.Person,
            rowId: row.id.toString(),
            createdAt: row.createdAt || null,
            teamId: null,
            scheduleId: null,
          },
        });
      }
    }

    const teamIds: Array<ObjectID> = teamRows
      .map((row: OnCallDutyPolicyEscalationRuleTeam): ObjectID | undefined => {
        return row.teamId;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    if (teamIds.length > 0) {
      // Accepted rows only: an invitation puts nobody on a team's roster.
      const memberships: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          teamId: QueryHelper.any(teamIds),
          hasAcceptedInvitation: true,
        },
        select: { userId: true, teamId: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const membership of memberships) {
        const row: OnCallDutyPolicyEscalationRuleTeam | undefined =
          teamRows.find((teamRow: OnCallDutyPolicyEscalationRuleTeam) => {
            return (
              teamRow.teamId?.toString().toLowerCase() ===
              membership.teamId?.toString().toLowerCase()
            );
          });

        if (!membership.userId || !row?.id || !row.teamId) {
          continue;
        }

        found.push({
          userId: membership.userId,
          path: {
            kind: RulePathKind.Team,
            rowId: row.id.toString(),
            createdAt: row.createdAt || null,
            teamId: row.teamId,
            scheduleId: null,
          },
        });
      }
    }

    for (const row of scheduleRows) {
      const scheduleId: ObjectID | undefined = row.onCallDutyPolicyScheduleId;

      if (!scheduleId || !row.id) {
        continue;
      }

      let userId: ObjectID | null = null;

      if (row.pageNextInRotation) {
        const next: NextInRotationInSchedule | null =
          await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
            scheduleId,
            { onCallDutyPolicyId: data.policyId || undefined },
          );

        userId = next?.nextUserId || null;
      } else {
        userId =
          await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
            scheduleId,
            { onCallDutyPolicyId: data.policyId || undefined },
          );
      }

      if (!userId) {
        continue;
      }

      found.push({
        userId: userId,
        path: {
          kind: row.pageNextInRotation
            ? RulePathKind.NextInRotation
            : RulePathKind.OnCall,
          rowId: row.id.toString(),
          createdAt: row.createdAt || null,
          teamId: null,
          scheduleId: scheduleId,
        },
      });
    }

    const reach: RuleReach = new Map<string, Array<RulePath>>();

    if (found.length === 0) {
      return reach;
    }

    // Nobody but a member of the project is paged by anything.
    const memberUserIds: Set<string> = await ProjectMembership.getMemberUserIds(
      {
        projectId: data.projectId,
        userIds: found.map((each: { userId: ObjectID }): ObjectID => {
          return each.userId;
        }),
      },
    );

    for (const each of found) {
      const key: string = keyOf(each.userId);

      if (!memberUserIds.has(key)) {
        continue;
      }

      const paths: Array<RulePath> = reach.get(key) || [];
      paths.push(each.path);
      reach.set(key, paths);
    }

    return reach;
  }

  /*
   * The same, or null when it could not be read: the caller then tells and
   * logs as a rule did before, and the read's failure is logged.
   */
  public static async readOrNull(
    data: EscalationRuleOfReach & { withSchedules: boolean },
  ): Promise<RuleReach | null> {
    // A row read back without its rule names none to ask about.
    if (!data.projectId || !data.ruleId) {
      return null;
    }

    try {
      return await EscalationRuleReach.read(data);
    } catch (error) {
      logger.error(
        `Could not read who escalation rule ${data.ruleId.toString()} pages; its people are told and logged as each row tells them.`,
        {
          projectId: data.projectId.toString(),
          onCallDutyPolicyEscalationRuleId: data.ruleId.toString(),
        } as LogAttributes,
      );
      logger.error(
        error as Error,
        {
          projectId: data.projectId.toString(),
        } as LogAttributes,
      );

      return null;
    }
  }

  // A rule's key in what readEach answers: its project and its id.
  public static getRuleKey(rule: EscalationRuleOfReach): string {
    return ProjectMembership.getKey(rule.projectId || "", rule.ruleId || "");
  }

  /*
   * Who each of `rules` pages now, read once for each rule however many
   * times it is named, by getRuleKey: null for one that could not be read.
   * After a removal, who each rule still pages.
   */
  public static async readEach(data: {
    rules: ReadonlyArray<EscalationRuleOfReach>;
    withSchedules: boolean;
  }): Promise<Map<string, RuleReach | null>> {
    const reachByRule: Map<string, RuleReach | null> = new Map<
      string,
      RuleReach | null
    >();

    for (const rule of data.rules) {
      // A row read back without its rule names none to ask about.
      if (!rule.projectId || !rule.ruleId) {
        continue;
      }

      const key: string = EscalationRuleReach.getRuleKey(rule);

      if (reachByRule.has(key)) {
        continue;
      }

      reachByRule.set(
        key,
        await EscalationRuleReach.readOrNull({
          ...rule,
          withSchedules: data.withSchedules,
        }),
      );
    }

    return reachByRule;
  }

  /*
   * Which of these people are members of their project now: who a removal
   * may tell they were removed. Someone only invited, or who has left, was
   * told nothing when a rule started naming them, and is told nothing when
   * it stops. Unread, every one of them counts as a member: the message's
   * sender asks again (UserNotificationSettingService).
   */
  public static async readMembers(
    pairs: ReadonlyArray<ProjectUserPair>,
  ): Promise<RuleMembers> {
    let memberKeys: Set<string> | null = null;

    try {
      memberKeys = await ProjectMembership.getMemberKeys([...pairs]);
    } catch (error) {
      logger.error(error as Error);
      memberKeys = null;
    }

    return {
      isMember: (projectId: ObjectID, userId: ObjectID): boolean => {
        return (
          memberKeys === null ||
          memberKeys.has(ProjectMembership.getKey(projectId, userId))
        );
      },
    };
  }

  // A person's paths in a reach; none for someone it does not page.
  public static getPaths(
    reach: RuleReach,
    userId: ObjectID | string,
  ): Array<RulePath> {
    return reach.get(keyOf(userId)) || [];
  }

  /*
   * Whether `paths` - one person's - had a path of `kinds` before the row
   * `rowId` was made: another row, made before it (by when, then by id, so
   * two rows made at the same moment are told apart the same way every
   * time). A row whose own path is not among them - it pages them no more -
   * counts every other path as earlier.
   */
  public static wasPagedBefore(data: {
    paths: ReadonlyArray<RulePath>;
    rowId: ObjectID | string;
    kinds: ReadonlyArray<RulePathKind>;
  }): boolean {
    const rowId: string = data.rowId.toString().toLowerCase();
    const own: RulePath | undefined = data.paths.find(
      (path: RulePath): boolean => {
        return path.rowId.toLowerCase() === rowId;
      },
    );

    return data.paths.some((path: RulePath): boolean => {
      if (
        path.rowId.toLowerCase() === rowId ||
        !data.kinds.includes(path.kind)
      ) {
        return false;
      }

      return !own || EscalationRuleReach.isMadeBefore(path, own);
    });
  }

  /*
   * Whether `paths` - one person's - hold the row `rowId`: the row pages
   * them now. Not so for someone only invited, or who has left.
   */
  public static isPagedByRow(
    paths: ReadonlyArray<RulePath>,
    rowId: ObjectID | string,
  ): boolean {
    const id: string = rowId.toString().toLowerCase();

    return paths.some((path: RulePath): boolean => {
      return path.rowId.toLowerCase() === id;
    });
  }

  // Everyone the row `rowId` pages now - a team's members - with their paths.
  public static getPagedByRow(
    reach: RuleReach,
    rowId: ObjectID | string,
  ): Array<{ userId: ObjectID; paths: Array<RulePath> }> {
    const paged: Array<{ userId: ObjectID; paths: Array<RulePath> }> = [];

    for (const [userId, paths] of reach.entries()) {
      if (EscalationRuleReach.isPagedByRow(paths, rowId)) {
        paged.push({ userId: new ObjectID(userId), paths: paths });
      }
    }

    return paged;
  }

  // Whether `paths` hold a path of `kinds`.
  public static isPaged(
    paths: ReadonlyArray<RulePath>,
    kinds: ReadonlyArray<RulePathKind> = EVERY_PATH,
  ): boolean {
    return paths.some((path: RulePath): boolean => {
      return kinds.includes(path.kind);
    });
  }

  /*
   * The person's time log stays open on each path that still pages them and
   * keeps one - named, a team's, on call in a schedule - when another path
   * of theirs is taken away. startTimeLogForUser keeps one open log per
   * path, so a log already open is left as it is. Not waited for: a log
   * that cannot be written is logged, and tells nobody anything.
   */
  public static keepTimeLogsOpen(data: {
    projectId: ObjectID;
    // A log is kept by its policy too: none is kept for a row without one.
    policyId: ObjectID | null;
    ruleId: ObjectID;
    userId: ObjectID;
    paths: ReadonlyArray<RulePath>;
  }): void {
    const policyId: ObjectID | null = data.policyId;

    if (!policyId) {
      return;
    }

    for (const path of data.paths) {
      if (path.kind === RulePathKind.NextInRotation) {
        continue;
      }

      OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        projectId: data.projectId,
        onCallDutyPolicyId: policyId,
        onCallDutyPolicyEscalationRuleId: data.ruleId,
        userId: data.userId,
        ...(path.kind === RulePathKind.Team && path.teamId
          ? { teamId: path.teamId }
          : {}),
        ...(path.kind === RulePathKind.OnCall && path.scheduleId
          ? { onCallDutyPolicyScheduleId: path.scheduleId }
          : {}),
        startsAt: OneUptimeDate.getCurrentDate(),
      }).catch((error: Error) => {
        logger.error(
          `Error keeping the on-call time log of user ${data.userId.toString()} open: ${error}`,
          {
            projectId: data.projectId.toString(),
            userId: data.userId.toString(),
          } as LogAttributes,
        );
      });
    }
  }

  /*
   * SOMEONE JOINED: the time logs of every rule that pages them by name or
   * through a team they are an accepted member of, which no rule kept while
   * they were only invited - or before they were in that team. Called when
   * a membership becomes accepted (TeamMemberService); the logs already
   * open are left as they are, so calling it again changes nothing. A
   * schedule's logs follow its roster's hand-offs.
   */
  public static async openTimeLogsOfMember(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const [namedRows, memberships]: [
      Array<OnCallDutyPolicyEscalationRuleUser>,
      Array<TeamMember>,
    ] = await Promise.all([
      OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: { projectId: data.projectId, userId: data.userId },
        select: {
          onCallDutyPolicyId: true,
          onCallDutyPolicyEscalationRuleId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
          hasAcceptedInvitation: true,
        },
        select: { teamId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    // Someone not a member after all - an invitation still waiting - is logged nowhere.
    if (memberships.length === 0) {
      return;
    }

    const teamIds: Array<ObjectID> = memberships
      .map((membership: TeamMember): ObjectID | undefined => {
        return membership.teamId;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    const teamRows: Array<OnCallDutyPolicyEscalationRuleTeam> =
      teamIds.length > 0
        ? await OnCallDutyPolicyEscalationRuleTeamService.findBy({
            query: {
              projectId: data.projectId,
              teamId: QueryHelper.any(teamIds),
            },
            select: {
              teamId: true,
              onCallDutyPolicyId: true,
              onCallDutyPolicyEscalationRuleId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    const startsAt: Date = OneUptimeDate.getCurrentDate();

    for (const row of namedRows) {
      if (!row.onCallDutyPolicyId || !row.onCallDutyPolicyEscalationRuleId) {
        continue;
      }

      await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        projectId: data.projectId,
        onCallDutyPolicyId: row.onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: row.onCallDutyPolicyEscalationRuleId,
        userId: data.userId,
        startsAt: startsAt,
      });
    }

    for (const row of teamRows) {
      if (
        !row.teamId ||
        !row.onCallDutyPolicyId ||
        !row.onCallDutyPolicyEscalationRuleId
      ) {
        continue;
      }

      await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        projectId: data.projectId,
        onCallDutyPolicyId: row.onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: row.onCallDutyPolicyEscalationRuleId,
        userId: data.userId,
        teamId: row.teamId,
        startsAt: startsAt,
      });
    }
  }

  // Whether `path`'s row was made before `other`'s: by when, then by id.
  private static isMadeBefore(path: RulePath, other: RulePath): boolean {
    const at: number = path.createdAt
      ? new Date(path.createdAt).getTime()
      : Number.NEGATIVE_INFINITY;
    const otherAt: number = other.createdAt
      ? new Date(other.createdAt).getTime()
      : Number.NEGATIVE_INFINITY;

    if (at !== otherAt) {
      return at < otherAt;
    }

    return path.rowId.toLowerCase() < other.rowId.toLowerCase();
  }
}
