import OnCallReadinessService, {
  ReadinessCoverageCell,
  ReadinessSummary,
  UserReadiness,
} from "./OnCallReadinessService";
import TeamComplianceSettingService from "./TeamComplianceSettingService";
import TeamMemberService from "./TeamMemberService";
import UserEmailService from "./UserEmailService";
import UserSmsService from "./UserSmsService";
import UserCallService from "./UserCallService";
import UserPushService from "./UserPushService";
import UserService from "./UserService";
import TeamService from "./TeamService";
import ObjectID from "../../Types/ObjectID";
import ComplianceRuleType from "../../Types/Team/ComplianceRuleType";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import logger from "../Utils/Logger";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

export interface UserComplianceStatus {
  userId: ObjectID;
  userName: string;
  userEmail: string;
  userProfilePictureId?: ObjectID | undefined;
  isCompliant: boolean;
  nonCompliantRules: Array<{
    ruleType: ComplianceRuleType;
    reason: string;
  }>;
}

export interface TeamComplianceStatus {
  teamId: ObjectID;
  teamName: string;
  complianceSettings: Array<{
    ruleType: ComplianceRuleType;
    enabled: boolean;
  }>;
  userComplianceStatuses: Array<UserComplianceStatus>;
}

/*
 * How many members' channel checks may be in flight at once. Each member costs
 * one small indexed existence check per enabled channel rule (four at most), so
 * twenty members in flight is up to eighty concurrent queries - enough to keep
 * the page quick on a large team, and nowhere near enough to matter to a
 * connection pool shared with the rest of the product. The number is a ceiling
 * on the burst, not a target: a five-member team still issues five.
 */
const MAX_CONCURRENT_MEMBER_CHECKS: number = 20;

/*
 * Teams > View > Compliance. The route (`/team/compliance-status/:teamId`) and
 * every field of the payload above are unchanged, because
 * TeamComplianceStatusTable.tsx renders them verbatim - including the reason
 * strings, which are printed as prose rather than mapped through any lookup.
 *
 * What changed in Phase 2 is where the answers come from. The two "does this
 * user have on-call rules?" questions used to be answered here, by walking every
 * severity in the project and issuing one findBy per severity per user; that
 * walk got four things wrong (it ignored ruleType, so an off-call rule counted
 * as incident coverage; it read only four of the seven channel columns, so a
 * Telegram/WhatsApp/Webhook responder was reported unreachable; it capped alert
 * severities at 100 while capping incident severities at LIMIT_PER_PROJECT; and
 * it was quadratic). All four are now OnCallReadinessService's problem, answered
 * from AT MOST TWO batched, cached computations for the whole team - which also
 * means this page and the on-call readiness surfaces can no longer disagree
 * about whether a given responder is covered.
 *
 * The four "does this user have a verified <channel>?" questions stay here, as
 * direct existence checks. ComplianceRuleType names one specific channel per
 * rule, so there is nothing to batch across severities and nothing for the
 * readiness service to reconcile: both surfaces are asking the same table the
 * same question and necessarily agree already.
 *
 * TENANT SCOPING. Every read below - including the team row itself - carries the
 * projectId the caller was authorised for, and every read is made with
 * `isRoot: true` because this page deliberately reports on people the reader may
 * have no permission to read individually. Root reads mean the projectId in the
 * QUERY is the only tenant boundary there is: the team was previously fetched by
 * id alone, so a team id belonging to another project resolved and its members'
 * reachability was described to a caller from outside that project. The id and
 * the project are now asked for together, in one query, so a foreign team simply
 * does not exist as far as this service is concerned.
 */
export default class TeamComplianceService {
  public static async getTeamComplianceStatus(
    teamId: ObjectID,
    projectId: ObjectID,
  ): Promise<TeamComplianceStatus> {
    /*
     * The team is looked up BY ID AND BY PROJECT, together. Splitting those into
     * "read by id, then compare projectId" would work just as well when written
     * correctly, but the comparison is a line somebody can delete without the
     * query looking wrong; a query that names both columns cannot be half-right.
     *
     * A team from another project therefore comes back null and is answered with
     * the same "Team not found" a nonexistent id gets - deliberately identical,
     * so this endpoint cannot be used to learn which team ids exist elsewhere.
     */
    const team: Partial<Team> | null = await TeamService.findOneBy({
      query: {
        _id: teamId.toString(),
        projectId: projectId,
      },
      select: {
        name: true,
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!team) {
      throw new BadDataException("Team not found");
    }

    /*
     * LIMIT_PER_PROJECT, not 100, at all three sites below. The old cap was the
     * worst kind of bug for a compliance page: a truncated list does not render
     * as an error or as a warning, it renders as fewer rows - and a member who
     * is simply absent from the table reads exactly like a member with nothing
     * wrong. TeamComplianceSetting is one row per rule type today so its cap was
     * harmless, but it is the same mistake and is fixed with the other two.
     */
    const complianceSettings: Array<{
      ruleType?: ComplianceRuleType;
      enabled?: boolean;
    }> = await TeamComplianceSettingService.findBy({
      query: {
        teamId: teamId,
        projectId: projectId,
      },
      select: {
        ruleType: true,
        enabled: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Get team members
    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        teamId: teamId,
        projectId: projectId,
      },
      select: {
        userId: true,
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * LIMIT_PER_PROJECT is a ceiling, not a promise, and a page that hits it
     * renders as fewer rows rather than as a warning - the 10,001st member is
     * not reported non-compliant, they are absent, and an absent row reads as
     * "no problem here". Ten thousand members on one team is not a shape any
     * install has, which is why this is a log rather than a paging loop, but the
     * day it happens the operator gets a sentence saying the page is incomplete
     * instead of a table that quietly is.
     */
    if (teamMembers.length >= LIMIT_PER_PROJECT) {
      logger.error(
        `TeamComplianceService read ${LIMIT_PER_PROJECT} members of team ${teamId.toString()} in project ${projectId.toString()} and stopped. The compliance page for this team is INCOMPLETE: members past that ceiling are absent from it entirely, and absence reads as compliance.`,
      );
    }

    const userIds: Array<ObjectID> = teamMembers
      .map((member: TeamMember): ObjectID => {
        return member.userId!;
      })
      .filter(Boolean);

    // Get user details
    const users: Array<User> = await UserService.findBy({
      query: {
        _id: new Includes(userIds),
      },
      select: {
        name: true,
        email: true,
        _id: true,
        profilePictureId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const settings: Array<{ ruleType: ComplianceRuleType; enabled: boolean }> =
      complianceSettings.map(
        (setting: {
          ruleType?: ComplianceRuleType;
          enabled?: boolean;
        }): { ruleType: ComplianceRuleType; enabled: boolean } => {
          return {
            ruleType: setting.ruleType!,
            enabled: setting.enabled || false,
          };
        },
      );

    const readinessByUserId: Map<string, UserReadiness> =
      await this.getReadinessByUserId(
        users.map((user: User): ObjectID => {
          return user.id!;
        }),
        projectId,
        settings,
      );

    /*
     * Users are checked concurrently rather than one at a time - there is no
     * reason for Ada's lookups to wait on Grace's - but concurrently is not the
     * same as all at once. Each user's channel rules cost up to four existence
     * checks, so a bare Promise.all over a 5,000-member team opens twenty
     * thousand simultaneous queries and the page that was meant to be faster
     * takes the pool down with it. The bounded map keeps the parallelism and
     * caps the burst, and it assigns results by index so the table's rows do not
     * shuffle.
     */
    const userComplianceStatuses: Array<UserComplianceStatus> =
      await this.mapWithBoundedConcurrency(
        users,
        MAX_CONCURRENT_MEMBER_CHECKS,
        async (user: User): Promise<UserComplianceStatus> => {
          const complianceStatus: {
            isCompliant: boolean;
            nonCompliantRules: Array<{
              ruleType: ComplianceRuleType;
              reason: string;
            }>;
          } = await this.checkUserCompliance(
            user.id!,
            projectId,
            settings,
            readinessByUserId.get(user.id!.toString()),
          );

          return {
            userId: user.id!,
            userName:
              user.name?.toString() || user.email?.toString() || "Unknown User",
            userEmail: user.email?.toString() || "",
            userProfilePictureId: user.profilePictureId,
            ...complianceStatus,
          };
        },
      );

    return {
      teamId: teamId,
      teamName: team.name || "Unknown Team",
      complianceSettings: settings,
      userComplianceStatuses,
    };
  }

  /*
   * Readiness for a whole team, in AT MOST TWO readiness computations however
   * many members the team has.
   *
   * The project-scope summary is asked for first and used as the source for
   * everyone it happens to contain. It resolves every responder on every policy
   * in the project in one batched pass, so for a team that exists because its
   * members are on call - which is the only kind of team this page is really
   * about - it answers for all of them at once, and it is very likely already
   * warm in the readiness service's 60s cache because the On-Call banner and the
   * readiness page request that same scope.
   *
   * Members the summary does not cover are those on no policy at all. They are
   * still subject to the team's compliance rules, so they cannot be skipped -
   * and they are now resolved in ONE batched `getReadinessForUsers` call rather
   * than one `getReadinessForUser` per member.
   *
   * That distinction is the whole point of this function. `getReadinessForUser`
   * resolves the project's ENTIRE responder set on every call, purely to work
   * out which policies reach the one user it was asked about, so a 40-member
   * team with 38 members on no policy used to cost 38 full project resolutions -
   * hundreds of queries - to render one page. The batched entry point pays for
   * that resolution once and answers for every member from it.
   *
   * A member the batch cannot resolve - somebody removed from the project
   * between the member read above and this call - is simply absent from the map.
   * They are NOT an error: one person leaving a team must not blank the page for
   * the other thirty-nine. checkHasOnCallRules reports their on-call rules as
   * unverified rather than as fine, because "we could not check" and "there is
   * nothing wrong" are different answers and only one of them is true.
   *
   * Nothing is computed when neither on-call-rule setting is enabled: the
   * channel rules do not consult readiness, so a team that only checks "has a
   * verified email" must not pay for a project-wide readiness pass.
   */
  private static async getReadinessByUserId(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
    settings: Array<{ ruleType: ComplianceRuleType; enabled: boolean }>,
  ): Promise<Map<string, UserReadiness>> {
    const readinessByUserId: Map<string, UserReadiness> = new Map<
      string,
      UserReadiness
    >();

    if (userIds.length === 0) {
      return readinessByUserId;
    }

    const needsReadiness: boolean = settings.some(
      (setting: {
        ruleType: ComplianceRuleType;
        enabled: boolean;
      }): boolean => {
        return (
          setting.enabled &&
          (setting.ruleType === ComplianceRuleType.HasIncidentOnCallRules ||
            setting.ruleType === ComplianceRuleType.HasAlertOnCallRules)
        );
      },
    );

    if (!needsReadiness) {
      return readinessByUserId;
    }

    const wanted: Set<string> = new Set<string>(
      userIds.map((userId: ObjectID): string => {
        return userId.toString();
      }),
    );

    const summary: ReadinessSummary =
      await OnCallReadinessService.getReadinessForProject(projectId);

    for (const readiness of summary.users) {
      const key: string = readiness.userId.toString();
      if (wanted.has(key)) {
        readinessByUserId.set(key, readiness);
      }
    }

    const missing: Array<ObjectID> = userIds.filter(
      (userId: ObjectID): boolean => {
        return !readinessByUserId.has(userId.toString());
      },
    );

    if (missing.length === 0) {
      return readinessByUserId;
    }

    /*
     * One call, whatever `missing.length` is. The batch answers only for the
     * users it can resolve, so its result is keyed back onto the ids it carries
     * rather than zipped against `missing` by position - a batch that dropped a
     * user would otherwise shift everybody after them onto the wrong readiness,
     * which is the single worst thing this page could do.
     */
    const filled: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(missing, projectId);

    for (const readiness of filled) {
      readinessByUserId.set(readiness.userId.toString(), readiness);
    }

    return readinessByUserId;
  }

  /*
   * Promise.all with a ceiling.
   *
   * Results are written into a pre-sized array by index rather than pushed, so
   * the output order matches the input order no matter what order the workers
   * happen to finish in. The table's rows are rendered in this order and a page
   * whose rows reshuffle between renders is unreadable.
   *
   * Rejections are deliberately NOT swallowed here. A member whose data is
   * merely absent is handled where that absence has meaning (see
   * checkHasOnCallRules); a query that actually FAILS is an infrastructure
   * fault, and turning it into "every member is non-compliant" would dress a
   * database outage up as forty people misconfiguring their phones.
   */
  private static async mapWithBoundedConcurrency<TInput, TOutput>(
    items: Array<TInput>,
    maxConcurrency: number,
    mapper: (item: TInput) => Promise<TOutput>,
  ): Promise<Array<TOutput>> {
    const results: Array<TOutput> = new Array<TOutput>(items.length);
    let cursor: number = 0;

    const runWorker: () => Promise<void> = async (): Promise<void> => {
      while (cursor < items.length) {
        const index: number = cursor;
        cursor++;
        results[index] = await mapper(items[index]!);
      }
    };

    const workers: Array<Promise<void>> = [];

    for (
      let worker: number = 0;
      worker < Math.min(maxConcurrency, items.length);
      worker++
    ) {
      workers.push(runWorker());
    }

    await Promise.all(workers);

    return results;
  }

  /*
   * `readiness` is required and may be undefined, matching checkRuleCompliance:
   * undefined is the answer "the batch could not resolve this member", and an
   * OPTIONAL parameter would let a future caller forget to thread it through and
   * silently turn every member into that case.
   */
  private static async checkUserCompliance(
    userId: ObjectID,
    projectId: ObjectID,
    complianceSettings: Array<{
      ruleType: ComplianceRuleType;
      enabled: boolean;
    }>,
    readiness: UserReadiness | undefined,
  ): Promise<{
    isCompliant: boolean;
    nonCompliantRules: Array<{ ruleType: ComplianceRuleType; reason: string }>;
  }> {
    const nonCompliantRules: Array<{
      ruleType: ComplianceRuleType;
      reason: string;
    }> = [];

    // Check each enabled compliance rule
    for (const setting of complianceSettings) {
      if (!setting.enabled) {
        continue;
      }

      const isCompliant: { compliant: boolean; reason: string } =
        await this.checkRuleCompliance(
          userId,
          projectId,
          setting.ruleType,
          readiness,
        );

      if (!isCompliant.compliant) {
        nonCompliantRules.push({
          ruleType: setting.ruleType,
          reason: isCompliant.reason,
        });
      }
    }

    return {
      isCompliant: nonCompliantRules.length === 0,
      nonCompliantRules,
    };
  }

  /*
   * `readiness` is the caller's already-resolved UserReadiness for this user.
   *
   * It is a required parameter that may be undefined, rather than an optional
   * one, and the difference matters: undefined means "the batch could not
   * resolve this person", which is an answer, whereas an omitted argument would
   * mean "the caller forgot" and used to be repaired by fetching readiness right
   * here. That repair was a per-user, per-RULE fan-out hiding inside a function
   * that looks like a pure predicate - the on-call rules are two of the six, so
   * a team with both enabled paid for it twice per member - and it is gone. The
   * only source of readiness is now the batch in getReadinessByUserId.
   */
  private static async checkRuleCompliance(
    userId: ObjectID,
    projectId: ObjectID,
    ruleType: ComplianceRuleType,
    readiness: UserReadiness | undefined,
  ): Promise<{ compliant: boolean; reason: string }> {
    switch (ruleType) {
      case ComplianceRuleType.HasNotificationEmailMethod:
        return await this.checkHasNotificationEmail(userId, projectId);

      case ComplianceRuleType.HasNotificationSMSMethod:
        return await this.checkHasNotificationSMS(userId, projectId);

      case ComplianceRuleType.HasNotificationCallMethod:
        return await this.checkHasNotificationCall(userId, projectId);

      case ComplianceRuleType.HasNotificationPushMethod:
        return await this.checkHasNotificationPush(userId, projectId);

      /*
       * Not awaited: checkHasOnCallRules reads an array it was handed and makes
       * no query at all, so there is nothing to wait for. An async wrapper would
       * only make it look as though there were.
       */
      case ComplianceRuleType.HasIncidentOnCallRules:
        return this.checkHasOnCallRules({
          notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          severityKind: "incident",
          readiness: readiness,
        });

      case ComplianceRuleType.HasAlertOnCallRules:
        return this.checkHasOnCallRules({
          notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          severityKind: "alert",
          readiness: readiness,
        });

      default:
        return { compliant: true, reason: "" };
    }
  }

  private static async checkHasNotificationEmail(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userEmails: Array<{ _id?: string }> = await UserEmailService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasEmail: boolean = userEmails.length > 0;
    return {
      compliant: hasEmail,
      reason: hasEmail
        ? ""
        : "No verified email address configured for notifications",
    };
  }

  private static async checkHasNotificationSMS(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userSMS: Array<{ _id?: string }> = await UserSmsService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasSMS: boolean = userSMS.length > 0;
    return {
      compliant: hasSMS,
      reason: hasSMS
        ? ""
        : "No verified phone number configured for SMS notifications",
    };
  }

  private static async checkHasNotificationCall(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userCalls: Array<{ _id?: string }> = await UserCallService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasCall: boolean = userCalls.length > 0;
    return {
      compliant: hasCall,
      reason: hasCall
        ? ""
        : "No verified phone number configured for call notifications",
    };
  }

  private static async checkHasNotificationPush(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<{ compliant: boolean; reason: string }> {
    const userPush: Array<{ _id?: string }> = await UserPushService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: 1,
      skip: 0,
    });

    const hasPush: boolean = userPush.length > 0;
    return {
      compliant: hasPush,
      reason: hasPush ? "" : "No verified push notification device configured",
    };
  }

  /*
   * Both on-call-rule compliance rules, answered off one readiness coverage
   * array. A coverage cell is one (ruleType, severity) pair with the readiness
   * service's verdict on it, which is what closes all four defects at once:
   *
   *  - the cell is keyed BY ruleType, so a rule that only fires when the user
   *    goes off call can no longer be counted as incident coverage;
   *  - `hasRule` is true for a rule on any of the seven channels, so a responder
   *    whose only method is Telegram, WhatsApp or a webhook is no longer
   *    reported as having nothing;
   *  - the severities behind the cells are read with LIMIT_PER_PROJECT for both
   *    kinds, so the incident and alert halves can no longer disagree about how
   *    many severities a project may have;
   *  - and the whole array arrives from one batched read, rather than one findBy
   *    per severity per user.
   *
   * `isOptOut` is honoured as coverage, not as a gap. An opt-out row is the user
   * saying "never notify me for this" on purpose; reporting that as a compliance
   * failure would send an owner to fix something that is already the way it was
   * asked to be. It matches the readiness contract, where Ready means every cell
   * is covered OR explicitly muted.
   *
   * Readiness also reports cells for the two EPISODE rule types, and the
   * ruleType filter drops them here. That is not an oversight: ComplianceRuleType
   * has no episode rule, so the team's compliance settings never ask about
   * episode coverage, and silently folding it into the incident or alert verdict
   * would fail a team against a rule its owner never turned on. Episode coverage
   * is visible on the readiness surfaces, where it is not gated by an opt-in
   * per-team setting at all.
   *
   * The reason string names the missing severities in the order the readiness
   * service reports them and falls back to the severity id when a severity has
   * no name, because the owner reading it has to be able to act on it without
   * opening anyone's settings.
   *
   * NO READINESS AT ALL is its own answer, and it is deliberately not a pass.
   * The batch omits a user when it cannot resolve them - the ordinary cause
   * being that they were removed from the project between the member read and
   * the readiness read - and there are only two honest things to do with that:
   * fail the whole page for everybody, or report the one row as unchecked. This
   * feature exists because a responder can be silently unreachable, so reporting
   * an unchecked responder as compliant would be the exact failure it was built
   * to prevent, and failing the page over one departed member would take the
   * other thirty-nine rows with it.
   */
  private static checkHasOnCallRules(data: {
    notificationRuleType: NotificationRuleType;
    severityKind: string;
    readiness: UserReadiness | undefined;
  }): { compliant: boolean; reason: string } {
    const userReadiness: UserReadiness | undefined = data.readiness;

    if (!userReadiness) {
      return {
        compliant: false,
        reason: `Could not check ${data.severityKind} notification rules for this user - they may no longer be a member of this project`,
      };
    }

    const missingSeverities: Array<string> = userReadiness.coverage
      .filter((cell: ReadinessCoverageCell): boolean => {
        return (
          cell.ruleType === data.notificationRuleType &&
          !cell.hasRule &&
          !cell.isOptOut
        );
      })
      .map((cell: ReadinessCoverageCell): string => {
        return cell.severityName || cell.severityId?.toString() || "";
      });

    if (missingSeverities.length > 0) {
      return {
        compliant: false,
        reason: `Missing notification rules for ${data.severityKind} severities: ${missingSeverities.join(", ")}`,
      };
    }

    return {
      compliant: true,
      reason: "",
    };
  }
}
