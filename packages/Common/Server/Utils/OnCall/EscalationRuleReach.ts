import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
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
 *
 * The same rule speaks for a whole policy, read for one person
 * (readPolicyPathsOfPerson): a schedule's hand-off tells whoever's shift
 * ended they are no longer on call for a policy only when nothing on it
 * pages them any more (#10556). And for someone who joined
 * (readRulesOfMember, getRulesNewToMember): the rules that page them now,
 * and of those the ones that did not before, which they are told of once
 * for each policy (OnCallJoinNotices, #10557) and logged on.
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

/*
 * One way a rule of a policy pages one person (readPolicyPathsOfPerson,
 * readRulesOfMember): the path, and the rule and the policy it is on.
 */
export interface PersonRulePath extends RulePath {
  policyId: ObjectID;
  ruleId: ObjectID;
}

// What pages one person, by policy id (lower case), with every path.
export type PolicyReachOfPerson = Map<string, Array<PersonRulePath>>;

// One of a member's accepted memberships of the project's teams.
export interface MemberTeam {
  teamId: ObjectID;
  membershipId: string;
  createdAt: Date | null;
}

// Every rule that pages a member now, and through what (readRulesOfMember).
export interface MemberRules {
  // Their accepted memberships, each with when it was made.
  teams: Array<MemberTeam>;
  // Named on a rule, one of their teams on it, or on call in a schedule it pages.
  paths: Array<PersonRulePath>;
}

/*
 * How someone came to be paged by more (getRulesNewToMember): the
 * membership made accepted that did it - a team joined, or the project's
 * first - or none when they joined the project by accepting an invitation,
 * which accepts every other one of theirs in it.
 */
export interface MemberJoin {
  membershipId: ObjectID | null;
}

// A rule that started paging a member, with every path it pages them by.
export interface RuleNewToMember {
  policyId: ObjectID;
  ruleId: ObjectID;
  paths: Array<PersonRulePath>;
}

// The rules that started paging a member when they joined, each once.
export interface RulesNewToMember {
  // They joined the project: nothing paged them before.
  joinedProject: boolean;
  // Else the team they joined, a member already.
  teamId: ObjectID | null;
  rules: Array<RuleNewToMember>;
}

/*
 * Who a schedule's hand-off tells and logs, for each policy as a whole
 * (readHandoff, #10556).
 */
export interface HandoffReach {
  // A member of the project: told and logged. Unread, everyone is.
  isMember: (userId: ObjectID) => boolean;
  /*
   * Whether the policy still pages whoever's shift ended, through anything
   * on it: their hand-off then says nothing. Unread, none does.
   */
  isStillPagedBy: (policyId: ObjectID) => boolean;
}

const keyOf: (userId: ObjectID | string) => string = (
  userId: ObjectID | string,
): string => {
  return userId.toString().toLowerCase();
};

// What a row is told apart by, when two are made at the same moment.
interface MadeAt {
  createdAt: Date | null;
  id: string;
}

/*
 * Whether `row` was made before `other`: by when, then by id - so two made
 * at the same moment are told apart the same way every time.
 */
const isMadeBefore: (row: MadeAt, other: MadeAt) => boolean = (
  row: MadeAt,
  other: MadeAt,
): boolean => {
  const at: number = row.createdAt
    ? new Date(row.createdAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const otherAt: number = other.createdAt
    ? new Date(other.createdAt).getTime()
    : Number.NEGATIVE_INFINITY;

  if (at !== otherAt) {
    return at < otherAt;
  }

  return row.id.toLowerCase() < other.id.toLowerCase();
};

// Each id once, as given first.
const eachOnce: (ids: ReadonlyArray<ObjectID>) => Array<ObjectID> = (
  ids: ReadonlyArray<ObjectID>,
): Array<ObjectID> => {
  const seen: Set<string> = new Set<string>();

  return ids.filter((id: ObjectID): boolean => {
    const key: string = keyOf(id);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
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

      const userId: ObjectID | null =
        await EscalationRuleReach.whoScheduleRowPages({
          scheduleId: scheduleId,
          policyId: data.policyId,
          pagesNextInRotation: Boolean(row.pageNextInRotation),
        });

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

      return (
        !own ||
        isMadeBefore(
          { createdAt: path.createdAt, id: path.rowId },
          { createdAt: own.createdAt, id: own.rowId },
        )
      );
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
   * SOMEONE JOINED: the time logs of every rule that pages them now - by
   * name, through a team they are an accepted member of, or as whoever is
   * on call in a schedule it pages (readRulesOfMember) - which no rule kept
   * while they were only invited, or before they were in that team. Called
   * when a membership becomes accepted (TeamMemberService); the logs
   * already open are left as they are, so calling it again changes
   * nothing. A schedule's hand-off logs nobody only invited (#10556), so
   * someone who joins during their shift is logged on it from then, and
   * the hand-off that ends the shift ends the log.
   */
  public static async openTimeLogsOfMember(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const rules: MemberRules | null =
      await EscalationRuleReach.readRulesOfMember(data);

    // Someone not a member after all - an invitation still waiting - is logged nowhere.
    if (!rules) {
      return;
    }

    const startsAt: Date = OneUptimeDate.getCurrentDate();

    for (const path of rules.paths) {
      await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        projectId: data.projectId,
        onCallDutyPolicyId: path.policyId,
        onCallDutyPolicyEscalationRuleId: path.ruleId,
        userId: data.userId,
        ...(path.kind === RulePathKind.Team && path.teamId
          ? { teamId: path.teamId }
          : {}),
        ...(path.kind === RulePathKind.OnCall && path.scheduleId
          ? { onCallDutyPolicyScheduleId: path.scheduleId }
          : {}),
        startsAt: startsAt,
      });
    }
  }

  /*
   * EVERY RULE THAT PAGES A MEMBER NOW, AND THROUGH WHAT (#10557): the
   * rules that name them, the rules that name a team they are an accepted
   * member of, and the rules that page whoever is on call in a schedule
   * whose roster has them on call now - with their accepted memberships,
   * each with when it was made. What someone who joined is logged on
   * (openTimeLogsOfMember) and told of (getRulesNewToMember). A schedule's
   * on-call person is read off its roster as its hand-offs keep it
   * (currentUserIdOnRoster), one read however many schedules: the hand-off
   * that ends the shift ends the log this starts. Named first, then teams,
   * then schedules. Null for someone who is not a member of the project:
   * nothing pages them.
   */
  public static async readRulesOfMember(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<MemberRules | null> {
    const [namedRows, memberships, schedulesOnCall]: [
      Array<OnCallDutyPolicyEscalationRuleUser>,
      Array<TeamMember>,
      Array<OnCallDutyPolicySchedule>,
    ] = await Promise.all([
      OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: { projectId: data.projectId, userId: data.userId },
        select: {
          _id: true,
          createdAt: true,
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
        select: { _id: true, teamId: true, createdAt: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      OnCallDutyPolicyScheduleService.findBy({
        query: {
          projectId: data.projectId,
          currentUserIdOnRoster: data.userId,
        },
        select: { _id: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    // Someone not a member - an invitation still waiting - is paged by nothing.
    if (memberships.length === 0) {
      return null;
    }

    const teams: Array<MemberTeam> = [];

    for (const membership of memberships) {
      if (membership.teamId && membership.id) {
        teams.push({
          teamId: membership.teamId,
          membershipId: membership.id.toString(),
          createdAt: membership.createdAt || null,
        });
      }
    }

    const scheduleIds: Array<ObjectID> = schedulesOnCall
      .map((schedule: OnCallDutyPolicySchedule): ObjectID | null => {
        return schedule.id;
      })
      .filter((scheduleId: ObjectID | null): scheduleId is ObjectID => {
        return Boolean(scheduleId);
      });

    const [teamRows, scheduleRows]: [
      Array<OnCallDutyPolicyEscalationRuleTeam>,
      Array<OnCallDutyPolicyEscalationRuleSchedule>,
    ] = await Promise.all([
      teams.length > 0
        ? OnCallDutyPolicyEscalationRuleTeamService.findBy({
            query: {
              projectId: data.projectId,
              teamId: QueryHelper.any(
                teams.map((team: MemberTeam): ObjectID => {
                  return team.teamId;
                }),
              ),
            },
            select: {
              _id: true,
              createdAt: true,
              teamId: true,
              onCallDutyPolicyId: true,
              onCallDutyPolicyEscalationRuleId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      scheduleIds.length > 0
        ? OnCallDutyPolicyEscalationRuleScheduleService.findBy({
            query: {
              projectId: data.projectId,
              onCallDutyPolicyScheduleId: QueryHelper.any(scheduleIds),
            },
            select: {
              _id: true,
              createdAt: true,
              onCallDutyPolicyScheduleId: true,
              pageNextInRotation: true,
              onCallDutyPolicyId: true,
              onCallDutyPolicyEscalationRuleId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const paths: Array<PersonRulePath> = [];

    for (const row of namedRows) {
      const path: PersonRulePath | null = EscalationRuleReach.toPersonPath({
        kind: RulePathKind.Person,
        row: row,
        teamId: null,
        scheduleId: null,
      });

      if (path) {
        paths.push(path);
      }
    }

    for (const row of teamRows) {
      const path: PersonRulePath | null = row.teamId
        ? EscalationRuleReach.toPersonPath({
            kind: RulePathKind.Team,
            row: row,
            teamId: row.teamId,
            scheduleId: null,
          })
        : null;

      if (path) {
        paths.push(path);
      }
    }

    for (const row of scheduleRows) {
      // A rule that pages the next in the rotation does not page whoever is on call.
      if (row.pageNextInRotation || !row.onCallDutyPolicyScheduleId) {
        continue;
      }

      const path: PersonRulePath | null = EscalationRuleReach.toPersonPath({
        kind: RulePathKind.OnCall,
        row: row,
        teamId: null,
        scheduleId: row.onCallDutyPolicyScheduleId,
      });

      if (path) {
        paths.push(path);
      }
    }

    return { teams: teams, paths: paths };
  }

  /*
   * THE RULES THAT STARTED PAGING A MEMBER WHEN THEY JOINED (#10557), each
   * once, from what pages them now (readRulesOfMember):
   *
   *   - someone who joined the project: every one of them - nothing paged
   *     them while they were only invited, and nothing told them;
   *   - a member who joined another team: the rules that name that team
   *     and paged them through nothing lasting before - not named on it,
   *     nor a member of another of its teams since before they joined this
   *     one. Being on call in one of its schedules is not that, as for a
   *     row's add (LASTING_PATHS): the hand-offs speak only for shifts.
   *
   * A membership made accepted (`join.membershipId`) is the project joined
   * unless another accepted membership of theirs was made before it: two
   * made at the same moment count only the older, so one of them tells. A
   * membership that is not theirs any more - removed meanwhile - started
   * nothing.
   */
  public static getRulesNewToMember(data: {
    rules: MemberRules;
    join: MemberJoin;
  }): RulesNewToMember {
    const byRule: Map<string, RuleNewToMember> = new Map<
      string,
      RuleNewToMember
    >();

    for (const path of data.rules.paths) {
      const key: string = keyOf(path.ruleId);
      const rule: RuleNewToMember = byRule.get(key) || {
        policyId: path.policyId,
        ruleId: path.ruleId,
        paths: [],
      };

      rule.paths.push(path);
      byRule.set(key, rule);
    }

    const membershipId: string | null = data.join.membershipId
      ? keyOf(data.join.membershipId)
      : null;

    if (!membershipId) {
      return { joinedProject: true, teamId: null, rules: [...byRule.values()] };
    }

    const joined: MemberTeam | undefined = data.rules.teams.find(
      (team: MemberTeam): boolean => {
        return keyOf(team.membershipId) === membershipId;
      },
    );

    if (!joined) {
      return { joinedProject: false, teamId: null, rules: [] };
    }

    const olderTeamKeys: Set<string> = new Set<string>(
      data.rules.teams
        .filter((team: MemberTeam): boolean => {
          return (
            keyOf(team.membershipId) !== membershipId &&
            isMadeBefore(
              { createdAt: team.createdAt, id: team.membershipId },
              { createdAt: joined.createdAt, id: joined.membershipId },
            )
          );
        })
        .map((team: MemberTeam): string => {
          return keyOf(team.teamId);
        }),
    );

    // No membership of theirs was there before this one: they joined the project.
    if (olderTeamKeys.size === 0) {
      return { joinedProject: true, teamId: null, rules: [...byRule.values()] };
    }

    const joinedTeamKey: string = keyOf(joined.teamId);

    return {
      joinedProject: false,
      teamId: joined.teamId,
      rules: [...byRule.values()].filter((rule: RuleNewToMember): boolean => {
        const isThroughJoinedTeam: boolean = rule.paths.some(
          (path: PersonRulePath): boolean => {
            return (
              path.kind === RulePathKind.Team &&
              Boolean(path.teamId) &&
              keyOf(path.teamId!) === joinedTeamKey
            );
          },
        );

        const wasPagedBefore: boolean = rule.paths.some(
          (path: PersonRulePath): boolean => {
            return (
              path.kind === RulePathKind.Person ||
              (path.kind === RulePathKind.Team &&
                Boolean(path.teamId) &&
                olderTeamKeys.has(keyOf(path.teamId!)))
            );
          },
        );

        return isThroughJoinedTeam && !wasPagedBefore;
      }),
    };
  }

  /*
   * WHAT EACH OF `policyIds` PAGES ONE PERSON THROUGH NOW (#10556): the
   * paths read() works out for a rule - named on it, an accepted member of
   * one of its teams, on call now in one of its schedules, next now in the
   * rotation of one it pages that way - across every rule of each policy,
   * read for this one person rather than for everyone on each rule. By
   * policy id (lower case): a policy that pages them by nothing is not in
   * it, and neither is any for someone who is not a member of the project.
   *
   * Enough to say whether each policy pages them, and by what: every row
   * that names them or a team of theirs, and the schedules of a policy no
   * such row settles - worked out in that policy's overrides, as a page
   * through it works them out, each once, until one pages them.
   */
  public static async readPolicyPathsOfPerson(data: {
    projectId: ObjectID;
    userId: ObjectID;
    policyIds: ReadonlyArray<ObjectID>;
  }): Promise<PolicyReachOfPerson> {
    const reach: PolicyReachOfPerson = new Map<string, Array<PersonRulePath>>();
    const policyIds: Array<ObjectID> = eachOnce(data.policyIds);

    if (policyIds.length === 0) {
      return reach;
    }

    const add: (path: PersonRulePath | null) => void = (
      path: PersonRulePath | null,
    ): void => {
      if (!path) {
        return;
      }

      const key: string = keyOf(path.policyId);
      const paths: Array<PersonRulePath> = reach.get(key) || [];
      paths.push(path);
      reach.set(key, paths);
    };

    const memberUserIds: Set<string> = await ProjectMembership.getMemberUserIds(
      {
        projectId: data.projectId,
        userIds: [data.userId],
      },
    );

    // Nobody but a member of the project is paged by anything.
    if (!memberUserIds.has(keyOf(data.userId))) {
      return reach;
    }

    const [namedRows, memberships]: [
      Array<OnCallDutyPolicyEscalationRuleUser>,
      Array<TeamMember>,
    ] = await Promise.all([
      OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
          onCallDutyPolicyId: QueryHelper.any(policyIds),
        },
        select: {
          _id: true,
          createdAt: true,
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

    for (const row of namedRows) {
      add(
        EscalationRuleReach.toPersonPath({
          kind: RulePathKind.Person,
          row: row,
          teamId: null,
          scheduleId: null,
        }),
      );
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
              onCallDutyPolicyId: QueryHelper.any(policyIds),
            },
            select: {
              _id: true,
              createdAt: true,
              teamId: true,
              onCallDutyPolicyId: true,
              onCallDutyPolicyEscalationRuleId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    for (const row of teamRows) {
      add(
        row.teamId
          ? EscalationRuleReach.toPersonPath({
              kind: RulePathKind.Team,
              row: row,
              teamId: row.teamId,
              scheduleId: null,
            })
          : null,
      );
    }

    // A policy a row names them on pages them, whatever its schedules say.
    const unsettledPolicyIds: Array<ObjectID> = policyIds.filter(
      (policyId: ObjectID): boolean => {
        return !reach.has(keyOf(policyId));
      },
    );

    if (unsettledPolicyIds.length === 0) {
      return reach;
    }

    const scheduleRows: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          projectId: data.projectId,
          onCallDutyPolicyId: QueryHelper.any(unsettledPolicyIds),
        },
        select: {
          _id: true,
          createdAt: true,
          onCallDutyPolicyScheduleId: true,
          pageNextInRotation: true,
          onCallDutyPolicyId: true,
          onCallDutyPolicyEscalationRuleId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    // Who each schedule pages for each policy, worked out once.
    const pagedBySchedule: Map<string, ObjectID | null> = new Map<
      string,
      ObjectID | null
    >();

    for (const row of scheduleRows) {
      const scheduleId: ObjectID | undefined = row.onCallDutyPolicyScheduleId;
      const policyId: ObjectID | undefined = row.onCallDutyPolicyId;

      if (!scheduleId || !policyId || reach.has(keyOf(policyId))) {
        continue;
      }

      const pagesNextInRotation: boolean = Boolean(row.pageNextInRotation);
      const scheduleKey: string = `${keyOf(policyId)}:${keyOf(scheduleId)}:${pagesNextInRotation ? "next" : "on-call"}`;

      if (!pagedBySchedule.has(scheduleKey)) {
        pagedBySchedule.set(
          scheduleKey,
          await EscalationRuleReach.whoScheduleRowPages({
            scheduleId: scheduleId,
            policyId: policyId,
            pagesNextInRotation: pagesNextInRotation,
          }),
        );
      }

      const pagedUserId: ObjectID | null =
        pagedBySchedule.get(scheduleKey) || null;

      if (!pagedUserId || keyOf(pagedUserId) !== keyOf(data.userId)) {
        continue;
      }

      add(
        EscalationRuleReach.toPersonPath({
          kind: pagesNextInRotation
            ? RulePathKind.NextInRotation
            : RulePathKind.OnCall,
          row: row,
          teamId: null,
          scheduleId: scheduleId,
        }),
      );
    }

    return reach;
  }

  /*
   * WHO A SCHEDULE'S HAND-OFF TELLS AND LOGS, FOR EACH POLICY AS A WHOLE
   * (#10556). A hand-off tells whoever's shift ended "You are no longer
   * on-call for Payments", for each policy that pages the schedule;
   * whoever is on call now "You are now on-call", and starts their time
   * logs; and whoever is next "You are next on-call". It spoke for the
   * schedule's path of the policy, not for the policy:
   *
   *   - nothing reaches someone only invited (#10412), nor anyone who has
   *     left: a hand-off tells them nothing and logs them nowhere - their
   *     time logs start when they join (openTimeLogsOfMember);
   *   - "no longer on-call" is said for a policy only when nothing on it
   *     pages them any more: named on one of its rules, a member of one of
   *     its teams, on call in another of its schedules, or next in the
   *     rotation of one it pages that way (readPolicyPathsOfPerson). Their
   *     shift's time log ends either way: the logs of the paths left are
   *     their own.
   *
   * One read of who is a member, for everyone the hand-off names; the
   * policies are read for whoever's shift ended, and only when they are a
   * member. A read that fails tells and logs as before, and is logged.
   */
  public static async readHandoff(data: {
    projectId: ObjectID;
    policyIds: ReadonlyArray<ObjectID>;
    // Whoever's shift ended - when somebody else is on call now.
    endedUserId: ObjectID | null;
    // Everyone the hand-off may tell or log.
    userIds: ReadonlyArray<ObjectID | null>;
  }): Promise<HandoffReach> {
    const userIds: Array<ObjectID> = eachOnce(
      data.userIds.filter((userId: ObjectID | null): userId is ObjectID => {
        return Boolean(userId);
      }),
    );

    let memberUserIds: Set<string> | null = null;

    if (userIds.length > 0) {
      try {
        memberUserIds = await ProjectMembership.getMemberUserIds({
          projectId: data.projectId,
          userIds: userIds,
        });
      } catch (error) {
        logger.error(
          "Could not read who a schedule's hand-off may tell; everyone it names is told and logged as before.",
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        logger.error(
          error as Error,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        memberUserIds = null;
      }
    }

    const isMember: (userId: ObjectID) => boolean = (
      userId: ObjectID,
    ): boolean => {
      return memberUserIds === null || memberUserIds.has(keyOf(userId));
    };

    let stillPagingPolicyKeys: Set<string> = new Set<string>();

    if (
      data.endedUserId &&
      isMember(data.endedUserId) &&
      data.policyIds.length > 0
    ) {
      try {
        const reach: PolicyReachOfPerson =
          await EscalationRuleReach.readPolicyPathsOfPerson({
            projectId: data.projectId,
            userId: data.endedUserId,
            policyIds: data.policyIds,
          });

        stillPagingPolicyKeys = new Set<string>(reach.keys());
      } catch (error) {
        logger.error(
          `Could not read whether the on-call policies of a schedule still page user ${data.endedUserId.toString()}, whose shift ended; they are told as before.`,
          {
            projectId: data.projectId.toString(),
            userId: data.endedUserId.toString(),
          } as LogAttributes,
        );
        logger.error(
          error as Error,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        stillPagingPolicyKeys = new Set<string>();
      }
    }

    return {
      isMember: isMember,
      isStillPagedBy: (policyId: ObjectID): boolean => {
        return stillPagingPolicyKeys.has(keyOf(policyId));
      },
    };
  }

  // Who a schedule's row on a rule pages now: whoever is on call, or next in its rotation.
  private static async whoScheduleRowPages(data: {
    scheduleId: ObjectID;
    // A schedule applies its policy's own overrides too.
    policyId: ObjectID | null;
    pagesNextInRotation: boolean;
  }): Promise<ObjectID | null> {
    if (data.pagesNextInRotation) {
      const next: NextInRotationInSchedule | null =
        await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
          data.scheduleId,
          { onCallDutyPolicyId: data.policyId || undefined },
        );

      return next?.nextUserId || null;
    }

    return await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
      data.scheduleId,
      { onCallDutyPolicyId: data.policyId || undefined },
    );
  }

  // A rule's row as a path of one person's, or null for one read back without its rule.
  private static toPersonPath(data: {
    kind: RulePathKind;
    row: {
      id: ObjectID | null;
      createdAt?: Date | undefined;
      onCallDutyPolicyId?: ObjectID | undefined;
      onCallDutyPolicyEscalationRuleId?: ObjectID | undefined;
    };
    teamId: ObjectID | null;
    scheduleId: ObjectID | null;
  }): PersonRulePath | null {
    const policyId: ObjectID | undefined = data.row.onCallDutyPolicyId;
    const ruleId: ObjectID | undefined =
      data.row.onCallDutyPolicyEscalationRuleId;

    if (!data.row.id || !policyId || !ruleId) {
      return null;
    }

    return {
      kind: data.kind,
      rowId: data.row.id.toString(),
      createdAt: data.row.createdAt || null,
      teamId: data.teamId,
      scheduleId: data.scheduleId,
      policyId: policyId,
      ruleId: ruleId,
    };
  }
}
