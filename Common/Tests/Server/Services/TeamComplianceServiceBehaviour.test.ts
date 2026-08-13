import TeamComplianceService, {
  TeamComplianceStatus,
} from "../../../Server/Services/TeamComplianceService";
import OnCallReadinessService, {
  ReadinessCoverageCell,
  ReadinessStatus,
  ReadinessSummary,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import TeamComplianceSettingService from "../../../Server/Services/TeamComplianceSettingService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserPushService from "../../../Server/Services/UserPushService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Team from "../../../Models/DatabaseModels/Team";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The readiness service is replaced wholesale, rather than spied on in place.
 *
 * Everything except the default export is kept, because the enums and the
 * contract types are values this file uses to BUILD its fixtures - a mock that
 * dropped them would leave the tests writing readiness payloads by hand and
 * drifting from the shape the real service emits.
 *
 * Replacing the class itself buys two things. TeamComplianceService is a unit
 * here, so the seam should be a stub and not the real module's top-level import
 * graph (TypeORM, every database model, the whole service layer). And a stub
 * makes the DEPENDENCY explicit: this file asserts, once and loudly, that the
 * real class actually exposes the entry points it stubs - see "the batched
 * readiness contract this service depends on" below - rather than letting a
 * jest.spyOn failure in beforeEach take out fifty unrelated tests.
 */
jest.mock("../../../Server/Services/OnCallReadinessService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Services/OnCallReadinessService",
  );

  return {
    ...actual,
    __esModule: true,
    default: {
      getReadinessForProject: jest.fn(),
      getReadinessForUsers: jest.fn(),
      getReadinessForUser: jest.fn(),
    },
  };
});

/*
 * TeamComplianceService answers "is this responder actually reachable?" for
 * Teams > View > Compliance, and a project owner who reads a green row there
 * believes the person on that row will be paged. That makes every one of this
 * service's judgements load-bearing: a false green is a page that nobody ever
 * receives, and a false red is an owner chasing a responder who is already
 * configured correctly.
 *
 * It was the ONLY surface answering that question until Phase 2. It is now one
 * of several, all reading OnCallReadinessService - which is the point, because
 * two surfaces disagreeing about whether someone can be paged is worse than
 * either of them being wrong on its own.
 *
 * This file began as a CHARACTERIZATION suite: it pinned the behaviour the
 * service had before the readiness work, including four defects the plan
 * (Internal/Roadmap/OnCallNotificationReadiness.md, section 2.6) called out.
 * PHASE 2 HAS NOW CLOSED ALL FOUR, by rebuilding the two "has on-call rules"
 * checks on top of OnCallReadinessService, and the four DEFECT blocks below
 * have been inverted in place - each still sits under its original heading so
 * the before/after is readable in one diff.
 *
 * What is pinned:
 *
 *   (A) The four "has a notification method" rules. Each one asks its own
 *       User*Service for a single row scoped to userId + projectId AND
 *       isVerified: true - an unverified phone number is not a phone number as
 *       far as paging is concerned - and each carries its own reason string
 *       that the table prints verbatim. These four stayed here rather than
 *       moving to the readiness service: ComplianceRuleType names one specific
 *       channel per rule, so there is nothing to batch and nothing for the two
 *       surfaces to disagree about - they are already asking one table the same
 *       question.
 *
 *   (B) The two "has on-call rules" rules, now answered off a UserReadiness
 *       coverage array instead of a per-severity walk. A user is compliant only
 *       when EVERY (ruleType, severity) cell is covered or explicitly opted out;
 *       the missing ones are named, not counted. No cells is vacuously
 *       compliant.
 *
 *   (C) checkUserCompliance skips disabled settings without asking the
 *       underlying service anything at all, and reports compliance purely by
 *       "did anything land in nonCompliantRules".
 *
 *   (D) getTeamComplianceStatus refuses to describe a team that does not exist.
 *
 *   (E) A rule type the switch does not know about fails OPEN (compliant).
 *
 * The four defects, and how Phase 2 closed each:
 *
 *   DEFECT 1 (plan 2.6, old TeamComplianceService.ts:416 and :517) - only
 *     userCallId/userSmsId/userEmailId/userPushId counted as "a notification
 *     method", so a responder paged on Telegram, WhatsApp or a webhook was
 *     reported NON-COMPLIANT even though the page would land.
 *     CLOSED: the service no longer reads channel columns at all. It reads
 *     `hasRule` off a coverage cell, and which channels make a rule count is
 *     OnCallReadinessService's judgement - made once, for all seven channels,
 *     for every surface.
 *
 *   DEFECT 2 (plan 2.6, old :395) - the rule lookup did not filter on ruleType,
 *     so a rule that only fires WHEN_USER_GOES_OFF_CALL was counted as incident
 *     on-call coverage. The dangerous direction: a false GREEN.
 *     CLOSED: coverage cells are keyed BY ruleType and the incident check reads
 *     only ON_CALL_EXECUTED_INCIDENT cells, the alert check only
 *     ON_CALL_EXECUTED_ALERT.
 *
 *   DEFECT 3 (old :473) - alert severities were fetched with a hard-coded limit
 *     of 100 while incident severities used LIMIT_PER_PROJECT, so the two halves
 *     of one feature disagreed about how many severities a project may have.
 *     CLOSED: neither half fetches severities any more. Both read the same
 *     coverage array, so they cannot disagree.
 *
 *   DEFECT 4 (plan 2.6, old :95 and :119) - team members and users were both
 *     fetched with limit: 100. The 101st member was not reported
 *     non-compliant; they were not reported at all, which reads as "everyone is
 *     fine".
 *     CLOSED: LIMIT_PER_PROJECT at all three sites, including the compliance
 *     settings read the plan's table did not list.
 *
 * And the N+1 the plan flags alongside them - one findBy per severity per user -
 * is closed by the same delegation, but NOT by the delegation alone, and the
 * distinction is worth stating because the first attempt at it got this wrong.
 * Delegating to readiness "once per user" replaced a cheap N+1 with an expensive
 * one: getReadinessForUser resolves the project's entire responder set on every
 * call, so a per-user fill cost five or six heavy queries per member instead of
 * one light query per severity. The whole team is now answered by AT MOST TWO
 * readiness computations - the project-scope summary, plus one batched
 * getReadinessForUsers for whoever that summary does not cover - and the rule
 * checks make no lookup of their own at all.
 *
 *   (F) A member the batch cannot resolve is reported as UNCHECKED rather than
 *       as compliant, and does not fail the page for anybody else.
 *
 *   (G) SECURITY, pre-existing and not a Phase 2 regression: the team row is
 *       read by id AND projectId. It used to be read by id alone with
 *       isRoot: true, so a team id from another project resolved and its
 *       members' reachability was described to a caller from outside it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// The shape checkRuleCompliance answers with.
interface RuleCheckResult {
  compliant: boolean;
  reason: string;
}

// The shape checkUserCompliance answers with.
interface UserComplianceResult {
  isCompliant: boolean;
  nonCompliantRules: Array<{ ruleType: ComplianceRuleType; reason: string }>;
}

// Enough of a findBy argument to assert on, without importing FindBy generics.
interface CapturedFindBy {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  props?: { isRoot?: boolean };
}

/*
 * One (ruleType, severity) cell of a UserReadiness coverage array - the unit the
 * on-call-rule checks now reason about. `hasRule` and `isOptOut` are the
 * readiness service's verdicts, already reconciled across all seven channels, so
 * a test here says "readiness reports this cell covered" rather than "a row with
 * this column set exists".
 */
function coverageCell(data: {
  ruleType: NotificationRuleType;
  severityId?: string | undefined;
  severityName?: string | undefined;
  hasRule?: boolean | undefined;
  isOptOut?: boolean | undefined;
}): ReadinessCoverageCell {
  return {
    ruleType: data.ruleType,
    severityId: data.severityId ? new ObjectID(data.severityId) : undefined,
    severityName: data.severityName,
    hasRule: data.hasRule === true,
    isOptOut: data.isOptOut === true,
  };
}

function readinessWith(
  coverage: Array<ReadinessCoverageCell>,
  userId: ObjectID = USER_ID,
): UserReadiness {
  return {
    userId: userId,
    userName: "Ada",
    userEmail: "ada@example.com",
    userProfilePictureId: undefined,
    status: ReadinessStatus.PartiallyReady,
    methods: [],
    coverage: coverage,
    reasons: [],
    reachedVia: [],
  };
}

function summaryWith(users: Array<UserReadiness>): ReadinessSummary {
  return {
    projectId: PROJECT_ID,
    onCallDutyPolicyId: undefined,
    readyCount: 0,
    partiallyReadyCount: users.length,
    notReachableCount: 0,
    /*
     * Both are scope-level facts this service does not read - it consults the
     * per-user coverage cells and nothing else - but they are part of the
     * contract, so the fixture carries them rather than casting them away. A
     * summary that ARRIVES truncated is handled without needing the flag: a
     * member missing from it falls into the batched fill and is resolved
     * directly, so truncation costs an extra read rather than a wrong verdict.
     */
    isFallbackEnabled: true,
    isTruncated: false,
    users: users,
  };
}

/*
 * checkRuleCompliance and checkUserCompliance are private statics. Calling them
 * directly (rather than only through getTeamComplianceStatus) is what lets each
 * branch of the switch be pinned in isolation; it does not widen the service's
 * public surface.
 */
function callPrivate(
  name: string,
  ...args: Array<unknown>
): Promise<RuleCheckResult | UserComplianceResult> {
  const statics: Record<
    string,
    (
      ...callArgs: Array<unknown>
    ) => Promise<RuleCheckResult | UserComplianceResult>
  > = TeamComplianceService as unknown as Record<
    string,
    (
      ...callArgs: Array<unknown>
    ) => Promise<RuleCheckResult | UserComplianceResult>
  >;

  return statics[name]!.apply(TeamComplianceService, args);
}

/*
 * Readiness is now an ARGUMENT to the rule checks rather than something they
 * fetch. That is the caller-side half of the N+1 fix: the whole-team read
 * resolves readiness in one batch and hands each user's answer down, so a rule
 * check that went looking for its own would be a per-user, per-rule fan-out
 * hiding inside a predicate. `stagedReadiness` is what a test hands in, and
 * `answerReadinessWith` sets it.
 */
let stagedReadiness: UserReadiness | undefined;

function checkRule(ruleType: ComplianceRuleType): Promise<RuleCheckResult> {
  return callPrivate(
    "checkRuleCompliance",
    USER_ID,
    PROJECT_ID,
    ruleType,
    stagedReadiness,
  ) as Promise<RuleCheckResult>;
}

function checkUser(
  settings: Array<{ ruleType: ComplianceRuleType; enabled: boolean }>,
): Promise<UserComplianceResult> {
  return callPrivate(
    "checkUserCompliance",
    USER_ID,
    PROJECT_ID,
    settings,
    stagedReadiness,
  ) as Promise<UserComplianceResult>;
}

function firstCall(spy: jest.SpyInstance): CapturedFindBy {
  return spy.mock.calls[0]![0] as CapturedFindBy;
}

let userEmailFindBy: jest.SpyInstance;
let userSmsFindBy: jest.SpyInstance;
let userCallFindBy: jest.SpyInstance;
let userPushFindBy: jest.SpyInstance;
let incidentSeverityFindBy: jest.SpyInstance;
let alertSeverityFindBy: jest.SpyInstance;
let notificationRuleFindBy: jest.SpyInstance;
let teamFindOneBy: jest.SpyInstance;
let complianceSettingFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let userFindBy: jest.SpyInstance;
let readinessForUser: jest.SpyInstance;
let readinessForUsers: jest.SpyInstance;
let readinessForProject: jest.SpyInstance;

// Maps a "has method" rule type back to the service it interrogates.
function methodSpyFor(ruleType: ComplianceRuleType): jest.SpyInstance {
  switch (ruleType) {
    case ComplianceRuleType.HasNotificationEmailMethod:
      return userEmailFindBy;
    case ComplianceRuleType.HasNotificationSMSMethod:
      return userSmsFindBy;
    case ComplianceRuleType.HasNotificationCallMethod:
      return userCallFindBy;
    case ComplianceRuleType.HasNotificationPushMethod:
      return userPushFindBy;
    default:
      throw new Error(`No notification-method service for ${ruleType}`);
  }
}

/*
 * Hand the rule checks a coverage array. The default posture is "no cells at
 * all", which is the readiness-service equivalent of a project with no
 * severities configured.
 */
function answerReadinessWith(coverage: Array<ReadinessCoverageCell>): void {
  stagedReadiness = readinessWith(coverage);
}

beforeEach(() => {
  /*
   * Call history is cleared explicitly because restoreAllMocks does not do it
   * for the readiness stubs. jest.spyOn returns the EXISTING mock when the
   * property it is asked to spy on is already a mock function - which the three
   * entry points on the mocked module are - so those three spies are the same
   * objects in every test and would otherwise accumulate calls across the file.
   * That turns "this render made one batched call" into an assertion about
   * whatever the previous test happened to do, which is exactly the kind of
   * false green these tests exist to catch elsewhere.
   */
  jest.clearAllMocks();

  stagedReadiness = readinessWith([]);
  // Default posture: nothing configured anywhere. Each test opts into rows.
  userEmailFindBy = jest
    .spyOn(UserEmailService, "findBy")
    .mockResolvedValue([] as never);
  userSmsFindBy = jest
    .spyOn(UserSmsService, "findBy")
    .mockResolvedValue([] as never);
  userCallFindBy = jest
    .spyOn(UserCallService, "findBy")
    .mockResolvedValue([] as never);
  userPushFindBy = jest
    .spyOn(UserPushService, "findBy")
    .mockResolvedValue([] as never);
  incidentSeverityFindBy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([] as never);
  alertSeverityFindBy = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([] as never);
  notificationRuleFindBy = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockResolvedValue([] as never);
  teamFindOneBy = jest
    .spyOn(TeamService, "findOneBy")
    .mockResolvedValue({ name: "Platform On-Call" } as Team);
  complianceSettingFindBy = jest
    .spyOn(TeamComplianceSettingService, "findBy")
    .mockResolvedValue([] as never);
  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([] as never);
  userFindBy = jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);
  /*
   * Readiness is the on-call-rule half's only source now, and the whole-team
   * read reaches it through exactly two entry points: the project-scope summary,
   * and one batched fill for whoever that summary does not cover.
   * getReadinessForUser is stubbed as well precisely so the tests below can
   * assert it is NEVER reached - a single per-user call surviving anywhere in
   * this path is the defect, not an implementation detail.
   */
  readinessForUser = jest
    .spyOn(OnCallReadinessService, "getReadinessForUser")
    .mockResolvedValue(readinessWith([]) as never);
  readinessForUsers = jest
    .spyOn(OnCallReadinessService, "getReadinessForUsers")
    .mockResolvedValue([] as never);
  readinessForProject = jest
    .spyOn(OnCallReadinessService, "getReadinessForProject")
    .mockResolvedValue(summaryWith([]) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ------------------------------------------------------------------------- *
 * (A) The four "has a verified notification method" rules.
 * -------------------------------------------------------------------------
 */

describe("checkRuleCompliance - notification method rules", () => {
  test.each<[ComplianceRuleType]>([
    [ComplianceRuleType.HasNotificationEmailMethod],
    [ComplianceRuleType.HasNotificationSMSMethod],
    [ComplianceRuleType.HasNotificationCallMethod],
    [ComplianceRuleType.HasNotificationPushMethod],
  ])(
    "%s is compliant with an empty reason when one row comes back",
    async (ruleType: ComplianceRuleType) => {
      methodSpyFor(ruleType).mockResolvedValue([{ _id: "method-1" }] as never);

      const result: RuleCheckResult = await checkRule(ruleType);

      expect(result.compliant).toBe(true);
      // A compliant row must print nothing, not "OK" - the table renders it raw.
      expect(result.reason).toBe("");
    },
  );

  test.each<[ComplianceRuleType, string]>([
    [
      ComplianceRuleType.HasNotificationEmailMethod,
      "No verified email address configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationSMSMethod,
      "No verified phone number configured for SMS notifications",
    ],
    [
      ComplianceRuleType.HasNotificationCallMethod,
      "No verified phone number configured for call notifications",
    ],
    [
      ComplianceRuleType.HasNotificationPushMethod,
      "No verified push notification device configured",
    ],
  ])(
    "%s is non-compliant with its exact reason when nothing comes back",
    async (ruleType: ComplianceRuleType, reason: string) => {
      const result: RuleCheckResult = await checkRule(ruleType);

      expect(result.compliant).toBe(false);
      expect(result.reason).toBe(reason);
    },
  );

  test.each<[ComplianceRuleType]>([
    [ComplianceRuleType.HasNotificationEmailMethod],
    [ComplianceRuleType.HasNotificationSMSMethod],
    [ComplianceRuleType.HasNotificationCallMethod],
    [ComplianceRuleType.HasNotificationPushMethod],
  ])(
    "%s only counts VERIFIED methods - the query carries isVerified: true",
    async (ruleType: ComplianceRuleType) => {
      await checkRule(ruleType);

      const spy: jest.SpyInstance = methodSpyFor(ruleType);
      expect(spy).toHaveBeenCalledTimes(1);

      const call: CapturedFindBy = firstCall(spy);
      /*
       * An unverified phone number cannot receive a page, so counting one would
       * be a false green. This is the assertion that keeps that honest.
       */
      expect(call.query["isVerified"]).toBe(true);
      expect(call.query["userId"]).toBe(USER_ID);
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      // Existence check only - one row is all it takes.
      expect(call.limit).toBe(1);
      expect(call.skip).toBe(0);
      expect(call.props?.isRoot).toBe(true);
    },
  );

  test("each method rule asks only its OWN service", async () => {
    await checkRule(ComplianceRuleType.HasNotificationSMSMethod);

    expect(userSmsFindBy).toHaveBeenCalledTimes(1);
    expect(userEmailFindBy).not.toHaveBeenCalled();
    expect(userCallFindBy).not.toHaveBeenCalled();
    expect(userPushFindBy).not.toHaveBeenCalled();
  });

  test("more than one verified row is still just compliant", async () => {
    userEmailFindBy.mockResolvedValue([
      { _id: "email-1" },
      { _id: "email-2" },
    ] as never);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasNotificationEmailMethod,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (B) The two "has on-call rules for every severity" rules, now answered off a
 * UserReadiness coverage array rather than a per-severity walk of the rule
 * table. What is pinned here is the MAPPING - which cells count as a gap, in
 * what order they are named, and in exactly what wording - because that is what
 * the compliance table prints. Whether a given cell is covered is
 * OnCallReadinessService's judgement and is tested there.
 * -------------------------------------------------------------------------
 */

describe("checkRuleCompliance - HasIncidentOnCallRules", () => {
  test("a covered cell is compliant, whichever channel covered it", async () => {
    /*
     * DEFECT 1 INVERTED. There is no longer a channel column in sight here. The
     * service asks readiness "is this cell covered?", and readiness has already
     * weighed all seven channels, so a Telegram-only responder and an
     * email-only responder arrive at this code as the identical input and can
     * no longer be judged differently. The old test.each over
     * userCallId/userSmsId/userEmailId/userPushId - and the DEFECT 1 block that
     * showed Telegram/WhatsApp/Webhook failing the same check - collapse into
     * this one assertion, because the distinction they turned on no longer
     * exists on this side of the call.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: true,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
    // Never again by reading four of the seven channel columns itself.
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });

  test("every severity covered => compliant, with ONE readiness resolution however many severities", async () => {
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-2",
        severityName: "Major",
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-3",
        severityName: "Minor",
        hasRule: true,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
    /*
     * THE N+1 INVERTED. This case used to cost three findBy calls - one per
     * severity, per user. It now costs NONE: the check reads the coverage array
     * its caller already resolved, so neither the severity count nor the rule
     * count enters into how many round trips a compliance render makes.
     */
    expect(readinessForUser).not.toHaveBeenCalled();
    expect(readinessForUsers).not.toHaveBeenCalled();
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });

  test("missing severities are NAMED, in coverage order, in the exact reason format", async () => {
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: false,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-2",
        severityName: "Major",
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-3",
        severityName: "Minor",
        hasRule: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result.compliant).toBe(false);
    /*
     * The owner has to be able to act on this string without opening the user's
     * settings, so the names - not the ids, not a count - are the contract.
     */
    expect(result.reason).toBe(
      "Missing notification rules for incident severities: Critical, Minor",
    );
  });

  test("a cell that is neither covered nor opted out leaves the severity missing", async () => {
    /*
     * What used to read "a rule row exists but points at nothing that can be
     * dialled". That judgement moved rather than disappeared: readiness decides
     * whether a row amounts to a usable rule and reports the verdict as
     * hasRule, and on this side it is simply a gap.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: false,
        isOptOut: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({
      compliant: false,
      reason: "Missing notification rules for incident severities: Critical",
    });
  });

  test("an explicitly opted-out cell is coverage, not a gap", async () => {
    /*
     * New in Phase 2, and the reason the filter weighs isOptOut as well as
     * hasRule. An opt-out row is the user saying "never notify me for this" on
     * purpose; reporting deliberate silence as a compliance failure sends the
     * owner to fix something that is already exactly as it was asked to be. It
     * is also the judgement the readiness contract already makes, where Ready
     * means every cell covered OR explicitly muted.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: false,
        isOptOut: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-2",
        severityName: "Major",
        hasRule: true,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });

  test("a severity with no name falls back to its id in the reason", async () => {
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        hasRule: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result.reason).toBe(
      "Missing notification rules for incident severities: sev-1",
    );
  });

  test("a project with ZERO incident severities is vacuously compliant", async () => {
    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
    // Nothing to be missing, and the rule table is never touched either way.
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });

  test("the check queries nothing at all - it reads the coverage it was handed", async () => {
    /*
     * Replaces "the per-severity rule lookup is limited to ONE row". There is no
     * per-severity lookup left to limit - and with it goes the old surprise that
     * only the FIRST matching rule for a severity was ever inspected, so a user
     * whose second rule carried the method was reported non-compliant.
     *
     * Nor is there a readiness lookup. The check used to fall back to
     * getReadinessForUser whenever its caller did not hand readiness in, which
     * looked like a harmless convenience and was in fact a per-user, per-rule
     * fan-out: getReadinessForUser resolves the project's ENTIRE responder set
     * on every call, so a team with both on-call rules enabled paid for two full
     * project resolutions per member. The convenience is gone; readiness comes
     * from the batch or it is reported as unknown.
     */
    await checkRule(ComplianceRuleType.HasIncidentOnCallRules);

    expect(readinessForUser).not.toHaveBeenCalled();
    expect(readinessForUsers).not.toHaveBeenCalled();
    expect(readinessForProject).not.toHaveBeenCalled();
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });

  test("no readiness at all is reported as UNCHECKED, never as compliant", async () => {
    /*
     * The batch answers only for users it can resolve. A member removed from the
     * project between the member read and the readiness read is simply absent
     * from it, and this is what the page then says about them.
     *
     * Non-compliant, not compliant: this feature exists because a responder can
     * be silently unreachable, so "we could not check" must never render as the
     * same green as "we checked and it is fine". The reason string is prose the
     * table prints verbatim, so it names the likely cause rather than saying
     * something the reader cannot act on.
     */
    stagedReadiness = undefined;

    const incident: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );
    const alert: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(incident).toEqual({
      compliant: false,
      reason:
        "Could not check incident notification rules for this user - they may no longer be a member of this project",
    });
    expect(alert).toEqual({
      compliant: false,
      reason:
        "Could not check alert notification rules for this user - they may no longer be a member of this project",
    });

    // And it still does not go looking, which is what kept the old page slow.
    expect(readinessForUser).not.toHaveBeenCalled();
    expect(readinessForUsers).not.toHaveBeenCalled();
  });
});

describe("checkRuleCompliance - HasAlertOnCallRules", () => {
  test("every alert severity covered => compliant", async () => {
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-1",
        severityName: "Page",
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-2",
        severityName: "Ticket",
        hasRule: true,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });

  test("missing alert severities use the alert wording, not the incident wording", async () => {
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-1",
        severityName: "Page",
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-2",
        severityName: "Ticket",
        hasRule: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({
      compliant: false,
      reason: "Missing notification rules for alert severities: Ticket",
    });
  });

  test("a project with ZERO alert severities is vacuously compliant", async () => {
    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });

  test("the alert rule reads ON_CALL_EXECUTED_ALERT cells and ignores incident cells", async () => {
    /*
     * Replaces "the alert lookup queries alertSeverityId, not
     * incidentSeverityId". Both halves now read the SAME coverage array, so the
     * separation has to come from the ruleType filter - and one array carrying
     * an uncovered cell of each kind is the sharpest way to prove it does.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-1",
        severityName: "Page",
        hasRule: false,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({
      compliant: false,
      reason: "Missing notification rules for alert severities: Page",
    });
    expect(result.reason).not.toContain("Critical");
  });
});

/*
 * ------------------------------------------------------------------------- *
 * DEFECT 1 - CLOSED IN PHASE 2.
 *
 * Was: only four of the seven channels counted as "a notification method". Plan
 * 2.6, "Only counts userCallId/userSmsId/userEmailId/userPushId - a user whose
 * only method is Telegram, WhatsApp, or Webhook is falsely reported
 * non-compliant" (old TeamComplianceService.ts:416, :517). The old block here
 * pinned each of those three responders failing a check they should have passed,
 * and pinned the four-column `select` that caused it.
 *
 * Now: the service issues no rule query and reads no channel column at all, so
 * the defect is not fixed here so much as made unrepresentable here. What it
 * takes for a rule to count is decided once by OnCallReadinessService, across
 * all seven channels, for every surface that asks - which is also what stops
 * this page and the readiness page from drifting apart again.
 *
 * The per-channel inversions the old block called for now live one test up, in
 * "a covered cell is compliant, whichever channel covered it": there is no
 * longer any input to this code that distinguishes a Telegram responder from an
 * email one. What remains worth asserting is the structural fact that makes that
 * true.
 * -------------------------------------------------------------------------
 */

describe("DEFECT 1 closed - the channel judgement is no longer made here", () => {
  test.each<[ComplianceRuleType]>([
    [ComplianceRuleType.HasIncidentOnCallRules],
    [ComplianceRuleType.HasAlertOnCallRules],
  ])(
    "%s reads no notification-rule row, so it cannot miss a channel",
    async (ruleType: ComplianceRuleType) => {
      await checkRule(ruleType);

      /*
       * The three formerly-invisible channels were invisible because they were
       * never SELECTed. Nothing is SELECTed now - there is no query - so no
       * future edit can quietly reintroduce a partial column list.
       */
      expect(notificationRuleFindBy).not.toHaveBeenCalled();
      expect(readinessForUser).not.toHaveBeenCalled();
    },
  );

  test("coverage is taken from hasRule alone, not from any channel field", async () => {
    /*
     * The cell below carries no channel information whatsoever - readiness has
     * already resolved it - and it is enough to make the user compliant. That is
     * the shape of the fix: a responder reachable only on Telegram, WhatsApp or
     * a webhook produces exactly this cell and is now reported as covered.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-1",
        severityName: "Page",
        hasRule: true,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * DEFECT 2 - CLOSED IN PHASE 2.
 *
 * Was: the rule lookup did not filter on ruleType, so a rule that only fires
 * WHEN_USER_GOES_OFF_CALL was counted as incident coverage (plan 2.6, old
 * TeamComplianceService.ts:395). The false-GREEN direction, and the more
 * dangerous of the two: the owner was told a responder was covered for Sev1
 * incidents when their only rule fired as they went off call.
 *
 * Now: coverage arrives as cells keyed BY ruleType, and each check reads only
 * its own. The two tests below are the old false greens, inverted - same
 * scenario, opposite verdict.
 * -------------------------------------------------------------------------
 */

describe("DEFECT 2 closed - coverage is matched on ruleType", () => {
  test("a WHEN_USER_GOES_OFF_CALL rule is NOT incident coverage", async () => {
    /*
     * The user is fully covered for going off call and not at all for Sev1
     * incidents. Before Phase 2 this returned compliant; the off-call rule was
     * indistinguishable from incident coverage because ruleType was never part
     * of the query.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({
      compliant: false,
      reason: "Missing notification rules for incident severities: Critical",
    });
  });

  test("a WHEN_USER_GOES_ON_CALL rule is NOT alert coverage", async () => {
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        hasRule: true,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-1",
        severityName: "Page",
        hasRule: false,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({
      compliant: false,
      reason: "Missing notification rules for alert severities: Page",
    });
  });

  test("the two go-on-call / go-off-call cell types carry no severity and are never named", async () => {
    /*
     * Those two rule types are not per-severity at all, so their cells arrive
     * with severityId undefined. An implementation that filtered on "no rule"
     * before filtering on ruleType would name them as missing severities and
     * print an empty entry into the reason string; this pins that it does not.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        hasRule: false,
      }),
      coverageCell({
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
        hasRule: false,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: true,
      }),
    ]);

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * DEFECT 3 - CLOSED IN PHASE 2.
 *
 * Was: alert severities were fetched with a hard-coded limit of 100 while
 * incident severities used LIMIT_PER_PROJECT (old TeamComplianceService.ts:473
 * against :372), so the two halves of one feature disagreed about how many
 * severities a project may have. Past 100 alert severities the extras were never
 * checked, and an unchecked severity reads as coverage the user does not have.
 *
 * Now: neither half fetches severities. Both read the same coverage array from
 * the same readiness resolution, which is where the LIMIT_PER_PROJECT read now
 * lives - one read, so there is nothing left for the two halves to disagree
 * about.
 * -------------------------------------------------------------------------
 */

describe("DEFECT 3 closed - both halves read one severity list, not two", () => {
  test.each<[ComplianceRuleType]>([
    [ComplianceRuleType.HasIncidentOnCallRules],
    [ComplianceRuleType.HasAlertOnCallRules],
  ])(
    "%s fetches no severities of its own",
    async (ruleType: ComplianceRuleType) => {
      await checkRule(ruleType);

      expect(incidentSeverityFindBy).not.toHaveBeenCalled();
      expect(alertSeverityFindBy).not.toHaveBeenCalled();
      expect(readinessForUser).not.toHaveBeenCalled();
    },
  );

  test("the incident and alert halves are answered from the SAME readiness resolution", async () => {
    /*
     * One coverage array, both kinds of cell, one truncation point - so a
     * project can no longer have more alert severities than the alert half
     * bothers to look at while the incident half looks at all of them.
     */
    answerReadinessWith([
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "sev-1",
        severityName: "Critical",
        hasRule: false,
      }),
      coverageCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: "asev-1",
        severityName: "Page",
        hasRule: false,
      }),
    ]);

    const incident: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );
    const alert: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(incident.reason).toBe(
      "Missing notification rules for incident severities: Critical",
    );
    expect(alert.reason).toBe(
      "Missing notification rules for alert severities: Page",
    );
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
    expect(alertSeverityFindBy).not.toHaveBeenCalled();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (E) An unhandled rule type fails OPEN.
 * -------------------------------------------------------------------------
 */

describe("checkRuleCompliance - unknown rule types fail open", () => {
  test("an unrecognised ComplianceRuleType returns compliant with an empty reason", async () => {
    const unknownRule: ComplianceRuleType =
      "HasCarrierPigeon" as ComplianceRuleType;

    const result: RuleCheckResult = await checkRule(unknownRule);

    /*
     * Failing open means a compliance rule added to the enum but not to the
     * switch silently reports everyone as fine, rather than everyone as broken.
     * Pinned deliberately: it is a choice, not an accident.
     */
    expect(result).toEqual({ compliant: true, reason: "" });
  });

  test("an unrecognised ComplianceRuleType touches no service at all", async () => {
    await checkRule("SomethingElseEntirely" as ComplianceRuleType);

    expect(userEmailFindBy).not.toHaveBeenCalled();
    expect(userSmsFindBy).not.toHaveBeenCalled();
    expect(userCallFindBy).not.toHaveBeenCalled();
    expect(userPushFindBy).not.toHaveBeenCalled();
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
    expect(alertSeverityFindBy).not.toHaveBeenCalled();
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (C) checkUserCompliance - which settings are consulted, and how the verdict
 * is reached.
 * -------------------------------------------------------------------------
 */

describe("checkUserCompliance - enabled settings only", () => {
  test("a DISABLED setting is skipped entirely - its service is never asked", async () => {
    const result: UserComplianceResult = await checkUser([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: false,
      },
    ]);

    /*
     * Skipping has to happen before the lookup, not after: a disabled rule that
     * still ran the query would make the compliance page pay for checks nobody
     * asked for, on every user, on every render.
     */
    expect(userEmailFindBy).not.toHaveBeenCalled();
    expect(result).toEqual({ isCompliant: true, nonCompliantRules: [] });
  });

  test("disabled rules are skipped even when the user would fail them", async () => {
    const result: UserComplianceResult = await checkUser([
      { ruleType: ComplianceRuleType.HasNotificationSMSMethod, enabled: false },
      {
        ruleType: ComplianceRuleType.HasNotificationCallMethod,
        enabled: false,
      },
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: false },
    ]);

    expect(result.isCompliant).toBe(true);
    expect(userSmsFindBy).not.toHaveBeenCalled();
    expect(userCallFindBy).not.toHaveBeenCalled();
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
  });

  test("an enabled rule the user passes leaves nonCompliantRules empty", async () => {
    userEmailFindBy.mockResolvedValue([{ _id: "email-1" }] as never);

    const result: UserComplianceResult = await checkUser([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
    ]);

    expect(userEmailFindBy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ isCompliant: true, nonCompliantRules: [] });
  });

  test("an enabled rule the user fails is recorded with its rule type and reason", async () => {
    const result: UserComplianceResult = await checkUser([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
    ]);

    expect(result.isCompliant).toBe(false);
    expect(result.nonCompliantRules).toEqual([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        reason: "No verified email address configured for notifications",
      },
    ]);
  });

  test("failures accumulate in setting order, and disabled ones do not appear", async () => {
    userSmsFindBy.mockResolvedValue([{ _id: "sms-1" }] as never);

    const result: UserComplianceResult = await checkUser([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
      // Passes - must not appear.
      { ruleType: ComplianceRuleType.HasNotificationSMSMethod, enabled: true },
      // Would fail, but is off - must not appear either.
      {
        ruleType: ComplianceRuleType.HasNotificationPushMethod,
        enabled: false,
      },
      { ruleType: ComplianceRuleType.HasNotificationCallMethod, enabled: true },
    ]);

    expect(result.isCompliant).toBe(false);
    expect(
      result.nonCompliantRules.map(
        (rule: { ruleType: ComplianceRuleType; reason: string }) => {
          return rule.ruleType;
        },
      ),
    ).toEqual([
      ComplianceRuleType.HasNotificationEmailMethod,
      ComplianceRuleType.HasNotificationCallMethod,
    ]);
  });

  test("no settings at all means compliant - the feature is opt-in", async () => {
    const result: UserComplianceResult = await checkUser([]);

    expect(result).toEqual({ isCompliant: true, nonCompliantRules: [] });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (D) getTeamComplianceStatus - the whole-team read the page renders.
 * -------------------------------------------------------------------------
 */

describe("getTeamComplianceStatus", () => {
  test("throws BadDataException when the team does not exist", async () => {
    teamFindOneBy.mockResolvedValue(null as never);

    await expect(
      TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID),
    ).rejects.toBeInstanceOf(BadDataException);

    // It refuses before reading anything else about the team.
    expect(complianceSettingFindBy).not.toHaveBeenCalled();
    expect(teamMemberFindBy).not.toHaveBeenCalled();
  });

  test("SECURITY: the team is read by id AND project, in one query", async () => {
    /*
     * Pre-existing, and not introduced by the readiness work: the team used to
     * be fetched by id alone, with isRoot: true and no projectId anywhere in the
     * query. Every OTHER read here is project-scoped, so the hole was quiet - a
     * foreign team id resolved, and the page then described that team's members
     * by name and email to a caller from outside its project.
     *
     * Asserting the QUERY rather than the outcome is the point. An
     * implementation that read by id and then compared projectId would pass an
     * outcome test and still be one deleted line away from the hole; a query
     * naming both columns cannot be half-right.
     */
    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    const call: CapturedFindBy = firstCall(teamFindOneBy);

    expect(call.query["_id"]).toBe(TEAM_ID.toString());
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.props?.isRoot).toBe(true);
  });

  test("SECURITY: a team from another project does not resolve, and is not described", async () => {
    /*
     * The scoped query's behaviour, stated as the caller sees it. The stub
     * answers null for any read that does not name this project - which is what
     * the database does now that the projectId is in the query - and the service
     * refuses with the SAME "Team not found" a nonexistent id gets, so the
     * endpoint cannot be used to learn which team ids exist elsewhere.
     */
    const otherProjectId: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    teamFindOneBy.mockImplementation(
      (data: CapturedFindBy): Promise<Team | null> => {
        const queriedProjectId: unknown = data.query["projectId"];

        if (
          queriedProjectId &&
          queriedProjectId.toString() === PROJECT_ID.toString()
        ) {
          return Promise.resolve({ name: "Platform On-Call" } as Team);
        }

        return Promise.resolve(null);
      },
    );

    await expect(
      TeamComplianceService.getTeamComplianceStatus(TEAM_ID, otherProjectId),
    ).rejects.toThrow("Team not found");

    // Nothing about the team's members was read on the way to that refusal.
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(userFindBy).not.toHaveBeenCalled();
  });

  test("DEFECT 4 closed: team members are fetched with LIMIT_PER_PROJECT", async () => {
    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    const call: CapturedFindBy = firstCall(teamMemberFindBy);
    /*
     * DEFECT 4, CLOSED IN PHASE 2. This used to be the literal 100. Truncation
     * is the worst failure mode a compliance page has: the 101st member of a
     * large team was not listed as non-compliant, they were simply absent, and
     * an absent row reads as "no problem here".
     */
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.limit).not.toBe(100);
    expect(call.skip).toBe(0);
    expect(call.query["teamId"]).toBe(TEAM_ID);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
  });

  test("DEFECT 4 closed: users are fetched with LIMIT_PER_PROJECT as well", async () => {
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
    ] as never);

    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    const call: CapturedFindBy = firstCall(userFindBy);
    /* The second truncation point, which used to stack on top of the first. */
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.limit).not.toBe(100);
    expect(call.skip).toBe(0);
  });

  test("DEFECT 4 closed: the compliance settings read is uncapped too", async () => {
    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    /*
     * The third site, NOT listed in the plan's table at 2.6, which named only
     * :95 and :119. TeamComplianceSetting is one row per rule type today so the
     * old cap was harmless, but it was the same mistake and Phase 2 fixed it
     * with the other two rather than leaving a third one to be rediscovered.
     */
    expect(firstCall(complianceSettingFindBy).limit).toBe(LIMIT_PER_PROJECT);
  });

  test("the whole team's on-call coverage costs ONE project-scope readiness pass", async () => {
    /*
     * The team-scale shape of the N+1 fix. Two members, an enabled on-call rule,
     * and any number of severities behind it: before Phase 2 this was
     * members x severities findBy calls. Now the project-scope readiness summary
     * answers for everyone it covers in one pass, and only members it does not
     * cover - people on no policy at all - are filled in individually.
     */
    complianceSettingFindBy.mockResolvedValue([
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
      { _id: "tm-2", userId: OTHER_USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
      { id: OTHER_USER_ID, name: "Grace", email: "grace@example.com" },
    ] as never);
    readinessForProject.mockResolvedValue(
      summaryWith([
        readinessWith(
          [
            coverageCell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severityId: "sev-1",
              severityName: "Critical",
              hasRule: true,
            }),
          ],
          USER_ID,
        ),
        readinessWith(
          [
            coverageCell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severityId: "sev-1",
              severityName: "Critical",
              hasRule: false,
            }),
          ],
          OTHER_USER_ID,
        ),
      ]) as never,
    );

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(readinessForProject).toHaveBeenCalledTimes(1);
    expect(readinessForProject.mock.calls[0]).toEqual([PROJECT_ID]);
    // Everyone was covered by the summary, so nobody needed filling in.
    expect(readinessForUser).not.toHaveBeenCalled();
    expect(readinessForUsers).not.toHaveBeenCalled();
    expect(notificationRuleFindBy).not.toHaveBeenCalled();

    expect(status.userComplianceStatuses[0]!.isCompliant).toBe(true);
    expect(status.userComplianceStatuses[1]!.nonCompliantRules).toEqual([
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason: "Missing notification rules for incident severities: Critical",
      },
    ]);
  });

  test("members the project-scope summary does not cover are filled in by ONE batched call", async () => {
    /*
     * People on no policy at all are still subject to the team's compliance
     * rules, so they cannot simply be skipped - and until this change they were
     * filled in with `Promise.all(missing.map(getReadinessForUser))`.
     *
     * That fan-out was the N+1 the old comment here claimed was closed, and it
     * was worse than the one it replaced: every getReadinessForUser resolves the
     * project's ENTIRE responder set (five or six heavy queries) purely to work
     * out which policies reach the one user it was asked about. A forty-member
     * team with thirty-eight members on no policy issued thirty-eight of those,
     * uncapped and all at once, to render one page.
     *
     * Two members are staged here, not one, precisely because a per-user
     * implementation passes a single-member test.
     */
    complianceSettingFindBy.mockResolvedValue([
      { ruleType: ComplianceRuleType.HasAlertOnCallRules, enabled: true },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
      { _id: "tm-2", userId: OTHER_USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
      { id: OTHER_USER_ID, name: "Grace", email: "grace@example.com" },
    ] as never);
    // Project summary knows nothing about either of them - neither is on a policy.
    readinessForProject.mockResolvedValue(summaryWith([]) as never);
    readinessForUsers.mockResolvedValue([
      readinessWith(
        [
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityId: "asev-1",
            severityName: "Page",
            hasRule: false,
          }),
        ],
        USER_ID,
      ),
      readinessWith(
        [
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityId: "asev-1",
            severityName: "Page",
            hasRule: true,
          }),
        ],
        OTHER_USER_ID,
      ),
    ] as never);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    // ONE call, carrying both ids. Not one call per member.
    expect(readinessForUsers).toHaveBeenCalledTimes(1);
    expect(readinessForUser).not.toHaveBeenCalled();

    const batchedIds: Array<ObjectID> = readinessForUsers.mock
      .calls[0]![0] as Array<ObjectID>;
    expect(
      batchedIds.map((userId: ObjectID): string => {
        return userId.toString();
      }),
    ).toEqual([USER_ID.toString(), OTHER_USER_ID.toString()]);
    expect(readinessForUsers.mock.calls[0]![1]).toEqual(PROJECT_ID);

    /*
     * And the batch's answers land on the right people. The result is keyed back
     * by the userId each UserReadiness carries rather than zipped against the
     * request by position, so a batch that answered for one of the two would not
     * shift the other's verdict onto them.
     */
    expect(status.userComplianceStatuses[0]!.userName).toBe("Ada");
    expect(status.userComplianceStatuses[0]!.nonCompliantRules).toEqual([
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        reason: "Missing notification rules for alert severities: Page",
      },
    ]);
    expect(status.userComplianceStatuses[1]!.userName).toBe("Grace");
    expect(status.userComplianceStatuses[1]!.isCompliant).toBe(true);
  });

  test("only the members the summary MISSED are batched, and no call is made when it missed none", async () => {
    complianceSettingFindBy.mockResolvedValue([
      { ruleType: ComplianceRuleType.HasAlertOnCallRules, enabled: true },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
      { _id: "tm-2", userId: OTHER_USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
      { id: OTHER_USER_ID, name: "Grace", email: "grace@example.com" },
    ] as never);
    // Ada is on a policy and so is already in the summary; Grace is not.
    readinessForProject.mockResolvedValue(
      summaryWith([readinessWith([], USER_ID)]) as never,
    );
    readinessForUsers.mockResolvedValue([
      readinessWith([], OTHER_USER_ID),
    ] as never);

    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    const batchedIds: Array<ObjectID> = readinessForUsers.mock
      .calls[0]![0] as Array<ObjectID>;
    expect(
      batchedIds.map((userId: ObjectID): string => {
        return userId.toString();
      }),
    ).toEqual([OTHER_USER_ID.toString()]);
  });

  test("a member the batch cannot resolve is reported UNCHECKED, and the rest of the page still renders", async () => {
    /*
     * The degradation case, and the reason the fill is not allowed to throw.
     *
     * Grace is removed from the project between the member read and the
     * readiness read, so the batch answers for Ada and simply does not carry
     * Grace. The old code called getReadinessForUser per member inside a
     * Promise.all, and that call throws BadDataException for a non-member, so
     * one person leaving a team blanked the whole page for everybody else.
     *
     * Now the page renders: Ada's real verdict, and for Grace an honest "could
     * not check" rather than either a crash or - far worse - a green row.
     */
    complianceSettingFindBy.mockResolvedValue([
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
      { _id: "tm-2", userId: OTHER_USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
      { id: OTHER_USER_ID, name: "Grace", email: "grace@example.com" },
    ] as never);
    readinessForProject.mockResolvedValue(summaryWith([]) as never);
    // The batch answers for Ada only.
    readinessForUsers.mockResolvedValue([
      readinessWith(
        [
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            severityId: "sev-1",
            severityName: "Critical",
            hasRule: true,
          }),
        ],
        USER_ID,
      ),
    ] as never);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.userComplianceStatuses).toHaveLength(2);
    expect(status.userComplianceStatuses[0]!.userName).toBe("Ada");
    expect(status.userComplianceStatuses[0]!.isCompliant).toBe(true);

    expect(status.userComplianceStatuses[1]!.userName).toBe("Grace");
    expect(status.userComplianceStatuses[1]!.isCompliant).toBe(false);
    expect(status.userComplianceStatuses[1]!.nonCompliantRules).toEqual([
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason:
          "Could not check incident notification rules for this user - they may no longer be a member of this project",
      },
    ]);

    // And it did not quietly retry her one at a time.
    expect(readinessForUser).not.toHaveBeenCalled();
  });

  test("readiness is not computed at all when no on-call rule is enabled", async () => {
    /*
     * The four channel rules do not consult readiness, so a team that only
     * checks "has a verified email" must not pay for a project-wide readiness
     * pass on every render of the page.
     */
    complianceSettingFindBy.mockResolvedValue([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
      // Enabled would trigger it; disabled must not.
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: false },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
    ] as never);

    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(readinessForProject).not.toHaveBeenCalled();
    expect(readinessForUser).not.toHaveBeenCalled();
    expect(readinessForUsers).not.toHaveBeenCalled();
    expect(userEmailFindBy).toHaveBeenCalledTimes(1);
  });

  test("returns the team name, and every setting mapped with enabled defaulted to false", async () => {
    complianceSettingFindBy.mockResolvedValue([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
      // enabled left undefined - the mapping must not produce undefined.
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules },
    ] as never);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.teamId).toBe(TEAM_ID);
    expect(status.teamName).toBe("Platform On-Call");
    expect(status.complianceSettings).toEqual([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: false },
    ]);
  });

  test("a team row with no name renders as Unknown Team rather than blank", async () => {
    teamFindOneBy.mockResolvedValue({} as Team);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.teamName).toBe("Unknown Team");
  });

  test("each member is checked against the enabled settings and reported by name", async () => {
    complianceSettingFindBy.mockResolvedValue([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
      { _id: "tm-2", userId: OTHER_USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
      { id: OTHER_USER_ID, name: "Grace", email: "grace@example.com" },
    ] as never);
    // Ada has a verified email; Grace does not.
    userEmailFindBy.mockImplementation(
      (data: CapturedFindBy): Promise<Array<{ _id: string }>> => {
        if (data.query["userId"] === USER_ID) {
          return Promise.resolve([{ _id: "email-1" }]);
        }
        return Promise.resolve([]);
      },
    );

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.userComplianceStatuses).toHaveLength(2);
    expect(status.userComplianceStatuses[0]!.userName).toBe("Ada");
    expect(status.userComplianceStatuses[0]!.isCompliant).toBe(true);
    expect(status.userComplianceStatuses[0]!.nonCompliantRules).toEqual([]);

    expect(status.userComplianceStatuses[1]!.userName).toBe("Grace");
    expect(status.userComplianceStatuses[1]!.isCompliant).toBe(false);
    expect(status.userComplianceStatuses[1]!.nonCompliantRules).toEqual([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        reason: "No verified email address configured for notifications",
      },
    ]);
  });

  test("a user with no name falls back to their email, then to Unknown User", async () => {
    userFindBy.mockResolvedValue([
      { id: USER_ID, email: "nameless@example.com" },
      { id: OTHER_USER_ID },
    ] as never);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.userComplianceStatuses[0]!.userName).toBe(
      "nameless@example.com",
    );
    expect(status.userComplianceStatuses[0]!.userEmail).toBe(
      "nameless@example.com",
    );
    expect(status.userComplianceStatuses[1]!.userName).toBe("Unknown User");
    // An absent email becomes "", never the string "undefined".
    expect(status.userComplianceStatuses[1]!.userEmail).toBe("");
  });

  test("no enabled settings means every member is reported compliant without a single lookup", async () => {
    complianceSettingFindBy.mockResolvedValue([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: false,
      },
    ] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: USER_ID, name: "Ada", email: "ada@example.com" },
    ] as never);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.userComplianceStatuses[0]!.isCompliant).toBe(true);
    expect(userEmailFindBy).not.toHaveBeenCalled();
  });

  test("a team with no members returns an empty status list, not an error", async () => {
    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.userComplianceStatuses).toEqual([]);
    expect(status.complianceSettings).toEqual([]);
  });

  test("the profile picture id is carried through for the table's avatar", async () => {
    const pictureId: ObjectID = ObjectID.generate();
    userFindBy.mockResolvedValue([
      {
        id: USER_ID,
        name: "Ada",
        email: "ada@example.com",
        profilePictureId: pictureId,
      },
    ] as never);

    const status: TeamComplianceStatus =
      await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(status.userComplianceStatuses[0]!.userProfilePictureId).toBe(
      pictureId,
    );
  });

  test("every read is made as root - the page reports on people the caller cannot read", async () => {
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
    ] as never);

    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    expect(firstCall(teamFindOneBy).props?.isRoot).toBe(true);
    expect(firstCall(complianceSettingFindBy).props?.isRoot).toBe(true);
    expect(firstCall(teamMemberFindBy).props?.isRoot).toBe(true);
    expect(firstCall(userFindBy).props?.isRoot).toBe(true);

    /*
     * Root reads make the projectId in the QUERY the only tenant boundary there
     * is, so every one of them has to carry it. This is the assertion that would
     * have caught the team read: it was the one root read in the file with no
     * projectId in its query.
     */
    expect(firstCall(teamFindOneBy).query["projectId"]).toBe(PROJECT_ID);
    expect(firstCall(complianceSettingFindBy).query["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(firstCall(teamMemberFindBy).query["projectId"]).toBe(PROJECT_ID);
  });

  test("the batched readiness contract this service depends on exists on the real service", () => {
    /*
     * The readiness service is stubbed for every other test in this file, which
     * is right for a unit test and would happily keep passing if the entry
     * points it stubs were renamed or never landed. This is the one assertion
     * made against the REAL class: TeamComplianceService calls exactly these two
     * and nothing else, so if either disappears the page breaks at runtime and
     * should break here first.
     */
    const actual: { default: Record<string, unknown> } = jest.requireActual(
      "../../../Server/Services/OnCallReadinessService",
    );

    expect(typeof actual.default["getReadinessForProject"]).toBe("function");
    expect(typeof actual.default["getReadinessForUsers"]).toBe("function");
  });
});
