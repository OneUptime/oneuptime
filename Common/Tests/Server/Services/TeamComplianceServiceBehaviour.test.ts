import TeamComplianceService, {
  TeamComplianceStatus,
} from "../../../Server/Services/TeamComplianceService";
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
 * TeamComplianceService is, today, the ONLY surface in the product that answers
 * "is this responder actually reachable?". Teams > View > Compliance renders it,
 * and a project owner who reads a green row there believes the person on that
 * row will be paged. That makes every one of this service's judgements
 * load-bearing: a false green is a page that nobody ever receives, and a false
 * red is an owner chasing a responder who is already configured correctly.
 *
 * This file is a CHARACTERIZATION suite. It pins the behaviour the service has
 * RIGHT NOW - including four defects the readiness plan (Internal/Roadmap/
 * OnCallNotificationReadiness.md, section 2.6) calls out - so that the phase
 * which rebuilds this on the shared readiness service can see, test by test,
 * exactly which judgements it is changing.
 *
 * What is pinned:
 *
 *   (A) The four "has a notification method" rules. Each one asks its own
 *       User*Service for a single row scoped to userId + projectId AND
 *       isVerified: true - an unverified phone number is not a phone number as
 *       far as paging is concerned - and each carries its own reason string
 *       that the table prints verbatim.
 *
 *   (B) The two "has on-call rules" rules. A user is compliant only when EVERY
 *       severity in the project has a rule; the missing ones are named, not
 *       counted. Zero severities is vacuously compliant.
 *
 *   (C) checkUserCompliance skips disabled settings without asking the
 *       underlying service anything at all, and reports compliance purely by
 *       "did anything land in nonCompliantRules".
 *
 *   (D) getTeamComplianceStatus refuses to describe a team that does not exist.
 *
 *   (E) A rule type the switch does not know about fails OPEN (compliant).
 *
 * The four pinned defects, each flagged inline where it is asserted:
 *
 *   DEFECT 1 (plan 2.6, TeamComplianceService.ts:416 and :517) - only
 *     userCallId/userSmsId/userEmailId/userPushId count as "a notification
 *     method". A responder whose rule pages them on Telegram, WhatsApp or a
 *     webhook is reported NON-COMPLIANT even though the page would be
 *     delivered. Owners are sent to fix a responder who is already reachable.
 *
 *   DEFECT 2 (plan 2.6, :395) - the rule lookup does not filter on ruleType, so
 *     a rule that only fires WHEN_USER_GOES_OFF_CALL is counted as incident
 *     on-call coverage. This is the dangerous direction: a false GREEN.
 *
 *   DEFECT 3 (:473) - alert severities are fetched with a hard-coded limit of
 *     100 while incident severities use LIMIT_PER_PROJECT. The two halves of
 *     the same feature disagree about how many severities a project may have.
 *
 *   DEFECT 4 (plan 2.6, :95 and :119) - team members and users are both fetched
 *     with limit: 100. The 101st member of a team is not reported
 *     non-compliant; they are not reported at all, which reads as "everyone is
 *     fine".
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

// A severity row as the service selects it (_id + name only).
interface SeverityRow {
  _id: string;
  name?: string | undefined;
}

// A notification rule row as the service selects it, plus the channels it ignores.
interface RuleRow {
  _id?: string;
  ruleType?: NotificationRuleType;
  userCallId?: ObjectID;
  userSmsId?: ObjectID;
  userEmailId?: ObjectID;
  userPushId?: ObjectID;
  userTelegramId?: ObjectID;
  userWhatsAppId?: ObjectID;
  userWebhookId?: ObjectID;
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

function checkRule(ruleType: ComplianceRuleType): Promise<RuleCheckResult> {
  return callPrivate(
    "checkRuleCompliance",
    USER_ID,
    PROJECT_ID,
    ruleType,
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
  ) as Promise<UserComplianceResult>;
}

function firstCall(spy: jest.SpyInstance): CapturedFindBy {
  return spy.mock.calls[0]![0] as CapturedFindBy;
}

function severity(id: string, name?: string): SeverityRow {
  return { _id: id, name: name };
}

let userEmailFindBy: jest.SpyInstance;
let userSmsFindBy: jest.SpyInstance;
let userCallFindBy: jest.SpyInstance;
let userPushFindBy: jest.SpyInstance;
let incidentSeverityFindBy: jest.SpyInstance;
let alertSeverityFindBy: jest.SpyInstance;
let notificationRuleFindBy: jest.SpyInstance;
let teamFindOneById: jest.SpyInstance;
let complianceSettingFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let userFindBy: jest.SpyInstance;

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
 * Answer the per-severity rule lookup from a map keyed by severity id, so a
 * test can say "Sev1 is covered, Sev2 is not" the way the database would.
 */
function answerRulesBySeverity(
  key: "incidentSeverityId" | "alertSeverityId",
  rulesBySeverityId: Record<string, Array<RuleRow>>,
): void {
  notificationRuleFindBy.mockImplementation(
    (data: CapturedFindBy): Promise<Array<RuleRow>> => {
      const severityId: string = String(data.query[key]);
      return Promise.resolve(rulesBySeverityId[severityId] || []);
    },
  );
}

beforeEach(() => {
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
  teamFindOneById = jest
    .spyOn(TeamService, "findOneById")
    .mockResolvedValue({ name: "Platform On-Call" } as Team);
  complianceSettingFindBy = jest
    .spyOn(TeamComplianceSettingService, "findBy")
    .mockResolvedValue([] as never);
  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([] as never);
  userFindBy = jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);
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
 * (B) The two "has on-call rules for every severity" rules.
 * -------------------------------------------------------------------------
 */

describe("checkRuleCompliance - HasIncidentOnCallRules", () => {
  test.each<[string, RuleRow]>([
    ["userCallId", { _id: "r", userCallId: ObjectID.generate() }],
    ["userSmsId", { _id: "r", userSmsId: ObjectID.generate() }],
    ["userEmailId", { _id: "r", userEmailId: ObjectID.generate() }],
    ["userPushId", { _id: "r", userPushId: ObjectID.generate() }],
  ])(
    "a rule carrying %s covers a severity",
    async (_label: string, rule: RuleRow) => {
      incidentSeverityFindBy.mockResolvedValue([
        severity("sev-1", "Critical"),
      ] as never);
      answerRulesBySeverity("incidentSeverityId", { "sev-1": [rule] });

      const result: RuleCheckResult = await checkRule(
        ComplianceRuleType.HasIncidentOnCallRules,
      );

      expect(result).toEqual({ compliant: true, reason: "" });
    },
  );

  test("every severity covered => compliant, and one lookup per severity", async () => {
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
      severity("sev-2", "Major"),
      severity("sev-3", "Minor"),
    ] as never);
    answerRulesBySeverity("incidentSeverityId", {
      "sev-1": [{ _id: "a", userEmailId: ObjectID.generate() }],
      "sev-2": [{ _id: "b", userSmsId: ObjectID.generate() }],
      "sev-3": [{ _id: "c", userPushId: ObjectID.generate() }],
    });

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
    /*
     * The N+1 the plan flags at 2.6: one findBy per severity, per user. Pinned
     * so a batched rewrite is a deliberate, visible change.
     */
    expect(notificationRuleFindBy).toHaveBeenCalledTimes(3);
  });

  test("missing severities are NAMED, in severity order, in the exact reason format", async () => {
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
      severity("sev-2", "Major"),
      severity("sev-3", "Minor"),
    ] as never);
    answerRulesBySeverity("incidentSeverityId", {
      "sev-2": [{ _id: "b", userEmailId: ObjectID.generate() }],
    });

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

  test("a rule row with NO method at all leaves the severity missing", async () => {
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
    ] as never);
    // A rule exists, but points at nothing that can be dialled.
    answerRulesBySeverity("incidentSeverityId", { "sev-1": [{ _id: "r" }] });

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({
      compliant: false,
      reason: "Missing notification rules for incident severities: Critical",
    });
  });

  test("a severity with no name falls back to its id in the reason", async () => {
    incidentSeverityFindBy.mockResolvedValue([severity("sev-1")] as never);

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
    // Nothing to be missing => the rule lookup is never reached.
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
  });

  test("incident severities are fetched with LIMIT_PER_PROJECT", async () => {
    await checkRule(ComplianceRuleType.HasIncidentOnCallRules);

    const call: CapturedFindBy = firstCall(incidentSeverityFindBy);
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.props?.isRoot).toBe(true);
  });

  test("the per-severity rule lookup is limited to ONE row", async () => {
    /*
     * Current behaviour, worth knowing about: only the first matching rule is
     * ever inspected. A user whose first rule for a severity carries no method
     * but whose second one does is reported non-compliant.
     */
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
    ] as never);

    await checkRule(ComplianceRuleType.HasIncidentOnCallRules);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    expect(call.limit).toBe(1);
    expect(call.skip).toBe(0);
    expect(call.query["userId"]).toBe(USER_ID);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.query["incidentSeverityId"]).toBe("sev-1");
  });
});

describe("checkRuleCompliance - HasAlertOnCallRules", () => {
  test("every alert severity covered => compliant", async () => {
    alertSeverityFindBy.mockResolvedValue([
      severity("asev-1", "Page"),
      severity("asev-2", "Ticket"),
    ] as never);
    answerRulesBySeverity("alertSeverityId", {
      "asev-1": [{ _id: "a", userCallId: ObjectID.generate() }],
      "asev-2": [{ _id: "b", userEmailId: ObjectID.generate() }],
    });

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });

  test("missing alert severities use the alert wording, not the incident wording", async () => {
    alertSeverityFindBy.mockResolvedValue([
      severity("asev-1", "Page"),
      severity("asev-2", "Ticket"),
    ] as never);
    answerRulesBySeverity("alertSeverityId", {
      "asev-1": [{ _id: "a", userCallId: ObjectID.generate() }],
    });

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

  test("the alert rule lookup queries alertSeverityId, not incidentSeverityId", async () => {
    alertSeverityFindBy.mockResolvedValue([
      severity("asev-1", "Page"),
    ] as never);

    await checkRule(ComplianceRuleType.HasAlertOnCallRules);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    expect(call.query["alertSeverityId"]).toBe("asev-1");
    expect(call.query).not.toHaveProperty("incidentSeverityId");
  });
});

/*
 * ------------------------------------------------------------------------- *
 * DEFECT 1 - only four of the seven channels count as "a notification method".
 * Plan 2.6: "Only counts userCallId/userSmsId/userEmailId/userPushId - a user
 * whose only method is Telegram, WhatsApp, or Webhook is falsely reported
 * non-compliant" (TeamComplianceService.ts:416, :517).
 *
 * A later phase must INVERT every assertion in this block: each of these users
 * would in fact be paged successfully, so the honest answer is compliant.
 * -------------------------------------------------------------------------
 */

describe("DEFECT 1 - Telegram / WhatsApp / Webhook rules are not counted", () => {
  test.each<[string, RuleRow]>([
    ["Telegram", { _id: "r", userTelegramId: ObjectID.generate() }],
    ["WhatsApp", { _id: "r", userWhatsAppId: ObjectID.generate() }],
    ["Webhook", { _id: "r", userWebhookId: ObjectID.generate() }],
  ])(
    "DEFECT 1: an incident rule whose only method is %s reads as no method at all",
    async (_channel: string, rule: RuleRow) => {
      incidentSeverityFindBy.mockResolvedValue([
        severity("sev-1", "Critical"),
      ] as never);
      answerRulesBySeverity("incidentSeverityId", { "sev-1": [rule] });

      const result: RuleCheckResult = await checkRule(
        ComplianceRuleType.HasIncidentOnCallRules,
      );

      /*
       * DEFECT 1 - Phase 2 inverts this: the rule DOES page the responder, so
       * the correct answer is { compliant: true, reason: "" }.
       */
      expect(result).toEqual({
        compliant: false,
        reason: "Missing notification rules for incident severities: Critical",
      });
    },
  );

  test.each<[string, RuleRow]>([
    ["Telegram", { _id: "r", userTelegramId: ObjectID.generate() }],
    ["WhatsApp", { _id: "r", userWhatsAppId: ObjectID.generate() }],
    ["Webhook", { _id: "r", userWebhookId: ObjectID.generate() }],
  ])(
    "DEFECT 1: an alert rule whose only method is %s reads as no method at all",
    async (_channel: string, rule: RuleRow) => {
      alertSeverityFindBy.mockResolvedValue([
        severity("asev-1", "Page"),
      ] as never);
      answerRulesBySeverity("alertSeverityId", { "asev-1": [rule] });

      const result: RuleCheckResult = await checkRule(
        ComplianceRuleType.HasAlertOnCallRules,
      );

      /* DEFECT 1 - Phase 2 inverts this to compliant. */
      expect(result).toEqual({
        compliant: false,
        reason: "Missing notification rules for alert severities: Page",
      });
    },
  );

  test("DEFECT 1: the three uncounted channels are not even SELECTed", async () => {
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
    ] as never);

    await checkRule(ComplianceRuleType.HasIncidentOnCallRules);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    expect(call.select).toEqual({
      _id: true,
      userCallId: true,
      userSmsId: true,
      userEmailId: true,
      userPushId: true,
    });
    /* DEFECT 1 - Phase 2 must add these three to the select as well. */
    expect(call.select).not.toHaveProperty("userTelegramId");
    expect(call.select).not.toHaveProperty("userWhatsAppId");
    expect(call.select).not.toHaveProperty("userWebhookId");
  });

  test("DEFECT 1: a counted method alongside an uncounted one still saves the row", async () => {
    // Proves the defect is about which columns are read, not about the row.
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
    ] as never);
    answerRulesBySeverity("incidentSeverityId", {
      "sev-1": [
        {
          _id: "r",
          userTelegramId: ObjectID.generate(),
          userEmailId: ObjectID.generate(),
        },
      ],
    });

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(result).toEqual({ compliant: true, reason: "" });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * DEFECT 2 - the rule lookup ignores ruleType.
 * Plan 2.6: "Ignores ruleType - a rule for WHEN_USER_GOES_ON_CALL counts as
 * incident coverage" (TeamComplianceService.ts:395).
 *
 * This is the false-GREEN direction and the more dangerous of the two: the
 * owner is told the responder is covered for Sev1 incidents when the only rule
 * they have fires when they go off call.
 * -------------------------------------------------------------------------
 */

describe("DEFECT 2 - ruleType is not part of the coverage query", () => {
  test("DEFECT 2: the incident lookup query has NO ruleType key", async () => {
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
    ] as never);

    await checkRule(ComplianceRuleType.HasIncidentOnCallRules);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    /*
     * DEFECT 2 - Phase 2 adds
     *   ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT
     * here, and this assertion flips to expect that key.
     */
    expect(call.query).not.toHaveProperty("ruleType");
    expect(Object.keys(call.query).sort()).toEqual([
      "incidentSeverityId",
      "projectId",
      "userId",
    ]);
  });

  test("DEFECT 2: the alert lookup query has NO ruleType key either", async () => {
    alertSeverityFindBy.mockResolvedValue([
      severity("asev-1", "Page"),
    ] as never);

    await checkRule(ComplianceRuleType.HasAlertOnCallRules);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    /* DEFECT 2 - Phase 2 adds ruleType: ON_CALL_EXECUTED_ALERT here. */
    expect(call.query).not.toHaveProperty("ruleType");
    expect(Object.keys(call.query).sort()).toEqual([
      "alertSeverityId",
      "projectId",
      "userId",
    ]);
  });

  test("DEFECT 2: a WHEN_USER_GOES_OFF_CALL rule is counted as incident coverage", async () => {
    incidentSeverityFindBy.mockResolvedValue([
      severity("sev-1", "Critical"),
    ] as never);
    answerRulesBySeverity("incidentSeverityId", {
      "sev-1": [
        {
          _id: "r",
          ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
          userEmailId: ObjectID.generate(),
        },
      ],
    });

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    /*
     * DEFECT 2 - a FALSE GREEN. Phase 2 inverts this: a rule that only fires
     * when the user goes off call is not incident coverage, so the expected
     * answer becomes non-compliant naming "Critical".
     */
    expect(result).toEqual({ compliant: true, reason: "" });
  });

  test("DEFECT 2: a WHEN_USER_GOES_ON_CALL rule is counted as alert coverage", async () => {
    alertSeverityFindBy.mockResolvedValue([
      severity("asev-1", "Page"),
    ] as never);
    answerRulesBySeverity("alertSeverityId", {
      "asev-1": [
        {
          _id: "r",
          ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
          userSmsId: ObjectID.generate(),
        },
      ],
    });

    const result: RuleCheckResult = await checkRule(
      ComplianceRuleType.HasAlertOnCallRules,
    );

    /* DEFECT 2 - Phase 2 inverts this to non-compliant naming "Page". */
    expect(result).toEqual({ compliant: true, reason: "" });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * DEFECT 3 - the two severity fetches disagree about how many severities exist.
 * -------------------------------------------------------------------------
 */

describe("DEFECT 3 - alert severities use a hard-coded limit of 100", () => {
  test("DEFECT 3: AlertSeverityService.findBy is called with the literal 100", async () => {
    await checkRule(ComplianceRuleType.HasAlertOnCallRules);

    const call: CapturedFindBy = firstCall(alertSeverityFindBy);
    /*
     * DEFECT 3 - Phase 2 replaces this with LIMIT_PER_PROJECT so the alert half
     * matches the incident half. Beyond 100 alert severities the extra ones are
     * never checked, which reads as coverage the user does not have.
     */
    expect(call.limit).toBe(100);
    expect(call.limit).not.toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
  });

  test("DEFECT 3: the incident half uses LIMIT_PER_PROJECT - the two disagree", async () => {
    await checkRule(ComplianceRuleType.HasIncidentOnCallRules);
    await checkRule(ComplianceRuleType.HasAlertOnCallRules);

    expect(firstCall(incidentSeverityFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(alertSeverityFindBy).limit).toBe(100);
    expect(firstCall(incidentSeverityFindBy).limit).not.toBe(
      firstCall(alertSeverityFindBy).limit,
    );
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
    teamFindOneById.mockResolvedValue(null as never);

    await expect(
      TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID),
    ).rejects.toBeInstanceOf(BadDataException);

    // It refuses before reading anything else about the team.
    expect(complianceSettingFindBy).not.toHaveBeenCalled();
    expect(teamMemberFindBy).not.toHaveBeenCalled();
  });

  test("DEFECT 4: team members are fetched with the literal limit 100", async () => {
    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    const call: CapturedFindBy = firstCall(teamMemberFindBy);
    /*
     * DEFECT 4 - Phase 2 must page or raise this. The 101st member of a large
     * team is not listed as non-compliant; they are simply absent, and an
     * absent row reads as "no problem here".
     */
    expect(call.limit).toBe(100);
    expect(call.limit).not.toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
    expect(call.query["teamId"]).toBe(TEAM_ID);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
  });

  test("DEFECT 4: users are fetched with the literal limit 100 as well", async () => {
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
    ] as never);

    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    const call: CapturedFindBy = firstCall(userFindBy);
    /* DEFECT 4 - second truncation point, stacked on top of the first. */
    expect(call.limit).toBe(100);
    expect(call.limit).not.toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
  });

  test("DEFECT 4: the compliance settings themselves are also capped at 100", async () => {
    await TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);

    /*
     * DEFECT 4 (third site, NOT listed in the plan's table at 2.6, which names
     * only :95 and :119). TeamComplianceSetting is one row per rule type today,
     * so the cap is harmless now - but it is the same mistake and should be
     * fixed with the other two.
     */
    expect(firstCall(complianceSettingFindBy).limit).toBe(100);
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
    teamFindOneById.mockResolvedValue({} as Team);

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

    expect(
      (teamFindOneById.mock.calls[0]![0] as { props: { isRoot?: boolean } })
        .props.isRoot,
    ).toBe(true);
    expect(firstCall(complianceSettingFindBy).props?.isRoot).toBe(true);
    expect(firstCall(teamMemberFindBy).props?.isRoot).toBe(true);
    expect(firstCall(userFindBy).props?.isRoot).toBe(true);
  });
});
