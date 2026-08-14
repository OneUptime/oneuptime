import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import OnCallReadinessService, {
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService, {
  CoverageLossCell,
  NotificationDeletionImpact,
  PostDeletionReachability,
} from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "What would I lose by deleting this?" - asked BEFORE the delete, answered
 * without blocking it.
 *
 * There are two ways a responder can delete themselves into silence, and
 * neither one looks like that from the screen it happens on:
 *
 *   (a) Deleting a RULE that is the last one covering a (ruleType x severity)
 *       cell. The rule table is a list of rows, not a coverage grid, so "this
 *       is the only thing left for Sev1 incidents" is written nowhere.
 *
 *   (b) Deleting a METHOD, which CASCADES. Every method foreign key on
 *       UserNotificationRule is onDelete: "CASCADE" - and six of the seven
 *       method services delete the rows themselves in onBeforeDelete besides -
 *       so removing one phone number destroys every rule that pointed at it.
 *       The delete dialog for a phone number mentions notification rules
 *       nowhere at all.
 *
 * The properties pinned here are the ones whose failure is silent:
 *
 *   ADVISORY, NOT BLOCKING. Nothing in this file may write, and nothing may
 *   throw for a delete that is merely inconvenient. A hook that threw would
 *   break the legitimate deletes too - a user leaving a project, an admin
 *   retiring a decommissioned number - and this is the user's own
 *   configuration. Section (G) stands guard over that.
 *
 *   ONE ANSWER TO "IS THIS PERSON ON CALL". It comes from
 *   OnCallReadinessService and is never re-derived. A delete dialog that said
 *   "not on call" while the readiness page said "NotReachable on 3 policies"
 *   would leave an admin with no way to tell which to believe - and they would
 *   believe the reassuring one. Section (D) asserts both that readiness is
 *   asked and that nothing else is.
 *
 *   THE OPT-OUT PREDICATE. `isOptOut` is nullable and was added long after
 *   these rows started existing, so it is NULL on every pre-existing rule; the
 *   naive `=== false` split would classify all of them as neither rules nor
 *   opt-outs and report a fully configured user as having nothing to lose.
 *   And an opt-out only makes silence deliberate if it SURVIVES: deleting the
 *   opt-out along with the last rule leaves neither.
 *
 *   THE SEVERITY COLUMN PER RULE TYPE. Incident and incident-episode rules are
 *   scoped by incidentSeverityId, alert and alert-episode by alertSeverityId.
 *   A rule read through the wrong column matches no page at runtime, so
 *   counting it as coverage would certify a gap as covered.
 *
 *   CERTAINTY ABOUT REACHABILITY. Push, Email and Webhook have no project
 *   switch, which is what makes "a verified one of those survives" a certain
 *   answer and "only paid channels survive" an honest "depends". Inventing a
 *   green in the second case is the exact false reassurance this whole feature
 *   exists to prevent.
 *
 * Nothing here touches a database. Every read is a jest.spyOn at the service
 * boundary, including OnCallReadinessService itself, so what is under test is
 * this service's own decision-making.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f",
);

const SEV1_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SEV2_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ALERT_SEV1_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const ALERT_SEV2_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const RULE_1_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RULE_2_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const RULE_3_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const RULE_4_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const SMS_METHOD_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const EMAIL_METHOD_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const WHATSAPP_METHOD_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

interface FindByCall {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  sort?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  props?: { isRoot?: boolean } | undefined;
}

interface FindOneByCall {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  props?: { isRoot?: boolean } | undefined;
}

/*
 * The mutable world every spy reads from. Reset wholesale in beforeEach: a
 * leaked rule row would change a coverage verdict somewhere far away, and a
 * leaked readiness answer would change every sentence in the warning list.
 */
let ruleRows: Array<UserNotificationRule> = [];
let incidentSeverityRows: Array<IncidentSeverity> = [];
let alertSeverityRows: Array<AlertSeverity> = [];
let readinessRows: Array<UserReadiness> = [];
let projectRow: Project | null = null;

/*
 * When set, the rule read returns a FULL page every time regardless of skip,
 * which is the only way to drive the page ceiling without materialising half a
 * million rows.
 */
let ruleReadAlwaysReturnsAFullPage: boolean = false;

let ruleFindBy: jest.SpyInstance;
let ruleCreate: jest.SpyInstance;
let ruleDeleteBy: jest.SpyInstance;
let ruleUpdateOneBy: jest.SpyInstance;
let incidentSeverityFindBy: jest.SpyInstance;
let alertSeverityFindBy: jest.SpyInstance;
let readinessForUsers: jest.SpyInstance;
let projectFindOneById: jest.SpyInstance;
let emailFindOneBy: jest.SpyInstance;
let smsFindOneBy: jest.SpyInstance;
let callFindOneBy: jest.SpyInstance;
let pushFindOneBy: jest.SpyInstance;
let whatsAppFindOneBy: jest.SpyInstance;
let telegramFindOneBy: jest.SpyInstance;
let webhookFindOneBy: jest.SpyInstance;
let escalationUserFindBy: jest.SpyInstance;
let escalationTeamFindBy: jest.SpyInstance;
let scheduleLayerUserFindBy: jest.SpyInstance;
let overrideFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let loggerError: jest.SpyInstance;

function rule(data: {
  id?: ObjectID | undefined;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  isOptOut?: boolean | undefined;
  userEmailId?: ObjectID | undefined;
  userSmsId?: ObjectID | undefined;
  userCallId?: ObjectID | undefined;
  userPushId?: ObjectID | undefined;
  userWhatsAppId?: ObjectID | undefined;
  userTelegramId?: ObjectID | undefined;
  userWebhookId?: ObjectID | undefined;
}): UserNotificationRule {
  const model: UserNotificationRule = new UserNotificationRule();
  model.projectId = PROJECT_ID;
  model.userId = USER_ID;
  model.ruleType = data.ruleType;

  if (data.id) {
    model.id = data.id;
  }

  if (data.incidentSeverityId) {
    model.incidentSeverityId = data.incidentSeverityId;
  }

  if (data.alertSeverityId) {
    model.alertSeverityId = data.alertSeverityId;
  }

  if (data.isOptOut !== undefined) {
    model.isOptOut = data.isOptOut;
  }

  if (data.userEmailId) {
    model.userEmailId = data.userEmailId;
  }

  if (data.userSmsId) {
    model.userSmsId = data.userSmsId;
  }

  if (data.userCallId) {
    model.userCallId = data.userCallId;
  }

  if (data.userPushId) {
    model.userPushId = data.userPushId;
  }

  if (data.userWhatsAppId) {
    model.userWhatsAppId = data.userWhatsAppId;
  }

  if (data.userTelegramId) {
    model.userTelegramId = data.userTelegramId;
  }

  if (data.userWebhookId) {
    model.userWebhookId = data.userWebhookId;
  }

  return model;
}

/** The most common shape: an incident rule on one severity, on one method. */
function incidentRule(
  id: ObjectID,
  severityId: ObjectID,
  methodId: ObjectID = SMS_METHOD_ID,
): UserNotificationRule {
  return rule({
    id: id,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    incidentSeverityId: severityId,
    userSmsId: methodId,
  });
}

function incidentSeverity(id: ObjectID, name: string): IncidentSeverity {
  const model: IncidentSeverity = new IncidentSeverity();
  model.id = id;
  model.name = name;

  return model;
}

function alertSeverity(id: ObjectID, name: string): AlertSeverity {
  const model: AlertSeverity = new AlertSeverity();
  model.id = id;
  model.name = name;

  return model;
}

/*
 * `methodId` is the id of the method ROW this entry describes, and every entry
 * gets its own by default because readiness emits one entry per row - a
 * responder with two verified SMS numbers is two entries, not one. The
 * deletion-impact code below still identifies the row being deleted by its
 * CHANNEL rather than by this id (see the comment on remainingVerifiedMethods),
 * so the value is never compared against anything here; giving each entry a
 * distinct one keeps the fixture honest rather than implying two rows share an
 * id. Callers that need a specific id can pass one.
 */
function method(
  methodType: ReadinessMethodType,
  isVerified: boolean = true,
  methodId: ObjectID = ObjectID.generate(),
): ReadinessMethod {
  return {
    methodId: methodId,
    methodType: methodType,
    maskedIdentifier: "•••",
    isVerified: isVerified,
  };
}

function readiness(data: {
  status?: ReadinessStatus | undefined;
  methods?: Array<ReadinessMethod> | undefined;
  reachedVia?: Array<ResponderSource> | undefined;
}): UserReadiness {
  return {
    userId: USER_ID,
    userName: "Ada Lovelace",
    userEmail: "ada@corp.example.com",
    status: data.status || ReadinessStatus.Ready,
    methods: data.methods || [method(ReadinessMethodType.Email)],
    coverage: [],
    reasons: [],
    reachedVia: data.reachedVia || [ResponderSource.Direct],
  };
}

function project(disableOnCallNotificationFallback: boolean): Project {
  const model: Project = new Project();
  model.id = PROJECT_ID;
  model.disableOnCallNotificationFallback = disableOnCallNotificationFallback;

  return model;
}

function firstCall(spy: jest.SpyInstance): FindByCall {
  return spy.mock.calls[0]![0] as FindByCall;
}

function ruleDeletionImpact(
  ...ruleIds: Array<ObjectID>
): Promise<NotificationDeletionImpact> {
  return UserNotificationRuleService.getRuleDeletionImpact({
    projectId: PROJECT_ID,
    userId: USER_ID,
    notificationRuleIds: ruleIds,
  });
}

function methodDeletionImpact(
  methodType: ReadinessMethodType,
  methodId: ObjectID,
): Promise<NotificationDeletionImpact> {
  return UserNotificationRuleService.getNotificationMethodDeletionImpact({
    projectId: PROJECT_ID,
    methodType: methodType,
    methodId: methodId,
  });
}

function cellFor(
  impact: NotificationDeletionImpact,
  ruleType: NotificationRuleType,
  severityId: ObjectID,
): CoverageLossCell | undefined {
  return impact.coverageLost.find((cell: CoverageLossCell): boolean => {
    return (
      cell.ruleType === ruleType &&
      cell.severityId?.toString() === severityId.toString()
    );
  });
}

function warningsMatching(
  impact: NotificationDeletionImpact,
  fragment: string,
): Array<string> {
  return impact.warnings.filter((warning: string): boolean => {
    return warning.includes(fragment);
  });
}

beforeEach(() => {
  /*
   * Readiness caches its answers for a minute behind static maps, and this file
   * spies on the method rather than the cache - but a previous file in the same
   * jest process may have left entries behind, and a cached hit would bypass a
   * spy that a later test asserts the call count of.
   */
  OnCallReadinessService.clearCache();

  ruleRows = [];
  incidentSeverityRows = [
    incidentSeverity(SEV1_ID, "Sev1"),
    incidentSeverity(SEV2_ID, "Sev2"),
  ];
  alertSeverityRows = [
    alertSeverity(ALERT_SEV1_ID, "Alert Sev1"),
    alertSeverity(ALERT_SEV2_ID, "Alert Sev2"),
  ];
  readinessRows = [readiness({})];
  projectRow = project(false);
  ruleReadAlwaysReturnsAFullPage = false;

  ruleFindBy = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation((async (
      data: FindByCall,
    ): Promise<Array<UserNotificationRule>> => {
      if (ruleReadAlwaysReturnsAFullPage) {
        return new Array(LIMIT_PER_PROJECT).fill(ruleRows[0]);
      }

      const skip: number = data.skip || 0;
      const limit: number = data.limit || ruleRows.length;

      return ruleRows.slice(skip, skip + limit);
    }) as never);

  /*
   * The three writes this service could make. Every one of them is asserted to
   * be zero across the whole suite in section (G): a preview that writes is not
   * a preview.
   */
  ruleCreate = jest
    .spyOn(UserNotificationRuleService, "create")
    .mockResolvedValue(new UserNotificationRule() as never);
  ruleDeleteBy = jest
    .spyOn(UserNotificationRuleService, "deleteBy")
    .mockResolvedValue(0 as never);
  ruleUpdateOneBy = jest
    .spyOn(UserNotificationRuleService, "updateOneBy")
    .mockResolvedValue(undefined as never);

  incidentSeverityFindBy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async (): Promise<Array<IncidentSeverity>> => {
      return incidentSeverityRows;
    }) as never);
  alertSeverityFindBy = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockImplementation((async (): Promise<Array<AlertSeverity>> => {
      return alertSeverityRows;
    }) as never);

  readinessForUsers = jest
    .spyOn(OnCallReadinessService, "getReadinessForUsers")
    .mockImplementation((async (): Promise<Array<UserReadiness>> => {
      return readinessRows;
    }) as never);

  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<Project | null> => {
      return projectRow;
    }) as never);

  const smsRow: UserSMS = new UserSMS();
  smsRow.id = SMS_METHOD_ID;
  smsRow.userId = USER_ID;
  smsRow.projectId = PROJECT_ID;
  smsRow.phone = new Phone("+14155554821");
  smsRow.isVerified = true;

  const emailRow: UserEmail = new UserEmail();
  emailRow.id = EMAIL_METHOD_ID;
  emailRow.userId = USER_ID;
  emailRow.projectId = PROJECT_ID;
  emailRow.email = new Email("ada@corp.example.com");
  emailRow.isVerified = true;

  const callRow: UserCall = new UserCall();
  callRow.id = SMS_METHOD_ID;
  callRow.userId = USER_ID;
  callRow.isVerified = true;

  const pushRow: UserPush = new UserPush();
  pushRow.id = SMS_METHOD_ID;
  pushRow.userId = USER_ID;
  pushRow.isVerified = true;

  const whatsAppRow: UserWhatsApp = new UserWhatsApp();
  whatsAppRow.id = WHATSAPP_METHOD_ID;
  whatsAppRow.userId = USER_ID;
  whatsAppRow.isVerified = true;

  const telegramRow: UserTelegram = new UserTelegram();
  telegramRow.id = SMS_METHOD_ID;
  telegramRow.userId = USER_ID;
  telegramRow.isVerified = true;

  /*
   * Deliberately carries NO isVerified. UserWebhook has no such column at all,
   * and the service has to treat presence as the whole test - a fixture that
   * set the field would let a regression to `Boolean(row.isVerified)` pass.
   */
  const webhookRow: UserWebhook = new UserWebhook();
  webhookRow.id = SMS_METHOD_ID;
  webhookRow.userId = USER_ID;

  emailFindOneBy = jest
    .spyOn(UserEmailService, "findOneBy")
    .mockResolvedValue(emailRow as never);
  smsFindOneBy = jest
    .spyOn(UserSmsService, "findOneBy")
    .mockResolvedValue(smsRow as never);
  callFindOneBy = jest
    .spyOn(UserCallService, "findOneBy")
    .mockResolvedValue(callRow as never);
  pushFindOneBy = jest
    .spyOn(UserPushService, "findOneBy")
    .mockResolvedValue(pushRow as never);
  whatsAppFindOneBy = jest
    .spyOn(UserWhatsAppService, "findOneBy")
    .mockResolvedValue(whatsAppRow as never);
  telegramFindOneBy = jest
    .spyOn(UserTelegramService, "findOneBy")
    .mockResolvedValue(telegramRow as never);
  webhookFindOneBy = jest
    .spyOn(UserWebhookService, "findOneBy")
    .mockResolvedValue(webhookRow as never);

  /*
   * The responder-set reads. These exist purely so section (D) can assert they
   * are NEVER touched: the moment this service answers "is this person on call"
   * for itself, there are two answers to that question in the product.
   */
  escalationUserFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockResolvedValue([] as never);
  escalationTeamFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue([] as never);
  scheduleLayerUserFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockResolvedValue([] as never);
  overrideFindBy = jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
    .mockResolvedValue([] as never);
  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([] as never);

  loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  OnCallReadinessService.clearCache();
});

/*
 * ---------------------------------------------------------------------------
 * (A) Deleting a RULE: what coverage actually disappears.
 *
 * Coverage is a property of what is LEFT, not of what goes, which is why the
 * service reads every rule the user has rather than only the ones being
 * deleted. Each test below is a shape where counting the deleted rules alone
 * gives the wrong answer.
 * ---------------------------------------------------------------------------
 */

describe("deleting a rule: coverage loss", () => {
  test("deleting the only rule covering a cell reports that cell as lost", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(1);
    expect(impact.coverageLost[0]!.ruleType).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(impact.coverageLost[0]!.severityId?.toString()).toBe(
      SEV1_ID.toString(),
    );
    expect(impact.coverageLost[0]!.severityName).toBe("Sev1");
    expect(impact.coverageLost[0]!.rulesRemoved).toBe(1);
  });

  test("deleting ONE of two rules on the same cell loses nothing - the other still covers it", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV1_ID, EMAIL_METHOD_ID),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("deleting BOTH rules on a cell does lose it", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV1_ID, EMAIL_METHOD_ID),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
    );

    expect(impact.rulesDeletedCount).toBe(2);
    expect(impact.coverageLost).toHaveLength(1);
    expect(impact.coverageLost[0]!.rulesRemoved).toBe(2);
  });

  test("other cells are untouched by a deletion that empties one of them", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID),
      incidentRule(RULE_2_ID, SEV2_ID),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.coverageLost).toHaveLength(1);
    expect(
      cellFor(impact, NotificationRuleType.ON_CALL_EXECUTED_INCIDENT, SEV2_ID),
    ).toBeUndefined();
  });

  test("a cell whose only rules are for a DIFFERENT rule type is a different cell", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID),
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    /*
     * The episode rule is on the same severity and does NOT cover the incident
     * cell. Readiness keys coverage on (userId, ruleType, severityId) for the
     * same reason: a rule of the wrong type matches no page of this type.
     */
    expect(impact.coverageLost).toHaveLength(1);
    expect(impact.coverageLost[0]!.ruleType).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
  });

  test("an empty id list deletes nothing and still answers the other questions", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact();

    expect(impact.rulesDeletedCount).toBe(0);
    expect(impact.coverageLost).toHaveLength(0);
    expect(impact.isOnCallResponder).toBe(true);
    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
    expect(impact.isFallbackEnabled).toBe(true);
  });

  test("rulesRemoved counts only the rules taken out of that cell", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV1_ID, EMAIL_METHOD_ID),
      incidentRule(RULE_3_ID, SEV2_ID, SMS_METHOD_ID),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
      RULE_3_ID,
    );

    expect(impact.rulesDeletedCount).toBe(3);
    expect(
      cellFor(impact, NotificationRuleType.ON_CALL_EXECUTED_INCIDENT, SEV1_ID)!
        .rulesRemoved,
    ).toBe(2);
    expect(
      cellFor(impact, NotificationRuleType.ON_CALL_EXECUTED_INCIDENT, SEV2_ID)!
        .rulesRemoved,
    ).toBe(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (B) The opt-out predicate.
 *
 * Two separate traps live here. The first is `isOptOut === true` versus
 * `=== false`: the column is nullable and NULL on every rule written before it
 * existed. The second is subtler - an opt-out only means "this silence is
 * deliberate" if it SURVIVES the deletion.
 * ---------------------------------------------------------------------------
 */

describe("opt-out rows", () => {
  test("a NULL isOptOut is a real rule, not an opt-out (the pre-existing-rows trap)", async () => {
    /*
     * The builder leaves isOptOut unset, which is what the column actually
     * looks like on every rule written before it existed.
     */
    const legacyRule: UserNotificationRule = incidentRule(RULE_1_ID, SEV1_ID);

    expect(legacyRule.isOptOut).toBeUndefined();

    ruleRows = [legacyRule];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    /*
     * If NULL were read as "neither a rule nor an opt-out", this cell would
     * have had no rules to lose and the deletion would look free.
     */
    expect(impact.coverageLost).toHaveLength(1);
  });

  test("a surviving opt-out means losing the last rule is not a gap", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID),
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        isOptOut: true,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("deleting the opt-out ALONGSIDE the last rule does report the gap", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID),
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        isOptOut: true,
      }),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
    );

    /*
     * After this write there is neither a rule nor a stated intention to be
     * silent, which is exactly the accidental silence this whole feature is
     * about. An opt-out that is itself being deleted must not suppress it.
     */
    expect(impact.rulesDeletedCount).toBe(2);
    expect(impact.coverageLost).toHaveLength(1);
  });

  test("deleting ONLY the opt-out is not a coverage loss - it is the opposite", async () => {
    ruleRows = [
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        isOptOut: true,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_2_ID);

    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("an opt-out row is never counted as coverage of its own cell", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        isOptOut: true,
      }),
      incidentRule(RULE_2_ID, SEV1_ID),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_2_ID);

    /*
     * rulesBefore counts real rules only. If the opt-out were counted, this
     * cell would read "1 of 2 removed" and the loss would be missed - which is
     * the same bug in the other direction.
     */
    expect(impact.coverageLost).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (C) The severity column follows the RULE TYPE, never whichever column
 * happens to be populated. An alert rule matched against an incident severity
 * matches no page at runtime - counting it would certify a gap as covered,
 * which is the exact shape of Gap G.
 * ---------------------------------------------------------------------------
 */

describe("the severity model per rule type", () => {
  test("an alert rule is scoped by alertSeverityId, and covers an alert cell", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        alertSeverityId: ALERT_SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.coverageLost).toHaveLength(1);
    expect(impact.coverageLost[0]!.severityId?.toString()).toBe(
      ALERT_SEV1_ID.toString(),
    );
    expect(impact.coverageLost[0]!.severityName).toBe("Alert Sev1");
  });

  test("an alert rule carrying ONLY an incidentSeverityId covers nothing", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        incidentSeverityId: SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    /*
     * It is still counted as a deleted row - it does exist - but it covered no
     * cell, because nothing at runtime would ever match it.
     */
    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("a severity-scoped rule with NO severity at all covers nothing (the Gap G corpse)", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("all four paging rule types produce their own cells", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: RULE_3_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        alertSeverityId: ALERT_SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: RULE_4_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        alertSeverityId: ALERT_SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
      RULE_3_ID,
      RULE_4_ID,
    );

    expect(impact.coverageLost).toHaveLength(4);
    expect(
      impact.coverageLost.map(
        (cell: CoverageLossCell): NotificationRuleType => {
          return cell.ruleType;
        },
      ),
    ).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ]);
  });

  test("an incident severity name never names an alert cell, even on a colliding id", async () => {
    /*
     * Incident and alert severities live in different tables with
     * independently generated ids. A name map keyed on the id alone would let
     * one label the other; keying on (kind, id) is what makes that impossible.
     */
    incidentSeverityRows = [incidentSeverity(SEV1_ID, "INCIDENT NAME")];
    alertSeverityRows = [alertSeverity(SEV1_ID, "ALERT NAME")];

    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        alertSeverityId: SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.coverageLost[0]!.severityName).toBe("ALERT NAME");
  });

  test("a severity the project no longer lists degrades to a nameless cell, not a crash", async () => {
    incidentSeverityRows = [];

    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.coverageLost).toHaveLength(1);
    expect(impact.coverageLost[0]!.severityName).toBeUndefined();
    expect(warningsMatching(impact, "this severity")).toHaveLength(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (D) Handoff rules are reported apart from paging coverage.
 *
 * Nobody is waiting on "you are now on call". Mixing it into the same list as a
 * missed Sev1 page at the same weight is how a warning surface teaches people
 * to skim it.
 * ---------------------------------------------------------------------------
 */

describe("handoff (shift change) rules", () => {
  test("losing the last on-call handoff rule is reported separately, not as coverage", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.coverageLost).toHaveLength(0);
    expect(impact.handoffNotificationsLost).toEqual([
      NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    ]);
    expect(warningsMatching(impact, "when they go on call")).toHaveLength(1);
  });

  test("both handoff types can be lost at once, in a stable order", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
    );

    expect(impact.handoffNotificationsLost).toEqual([
      NotificationRuleType.WHEN_USER_GOES_ON_CALL,
      NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    ]);
  });

  test("a surviving handoff rule on another method loses nothing", async () => {
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: RULE_2_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        userEmailId: EMAIL_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.handoffNotificationsLost).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (E) Deleting a METHOD: the cascade.
 *
 * This is the shape that costs people pages. The rules are not what was
 * clicked, and their disappearance is the whole point of the preview.
 * ---------------------------------------------------------------------------
 */

describe("deleting a notification method: the cascade", () => {
  test("every rule pointing at the method is counted and its cells are lost", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV2_ID, SMS_METHOD_ID),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.rulesDeletedCount).toBe(2);
    expect(impact.coverageLost).toHaveLength(2);
    expect(
      warningsMatching(impact, "also deletes 2 notification rules"),
    ).toHaveLength(1);
  });

  test("rules on a DIFFERENT method of the same channel survive", async () => {
    const otherSmsId: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV1_ID, otherSmsId),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.rulesDeletedCount).toBe(1);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("the foreign key tested follows the CHANNEL, not merely the id value", async () => {
    /*
     * The crossed-column regression. A rule that points at a WhatsApp method
     * whose id happens to equal the SMS id being deleted must not be reported
     * as going away - and the reverse mistake would leave a rule out of a
     * cascade that really does take it.
     */
    ruleRows = [
      rule({
        id: RULE_1_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        userWhatsAppId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.rulesDeletedCount).toBe(0);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("each of the seven channels reads its own foreign key", async () => {
    const cases: Array<{
      methodType: ReadinessMethodType;
      makeRule: () => UserNotificationRule;
    }> = [
      {
        methodType: ReadinessMethodType.Email,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userEmailId: SMS_METHOD_ID,
          });
        },
      },
      {
        methodType: ReadinessMethodType.SMS,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userSmsId: SMS_METHOD_ID,
          });
        },
      },
      {
        methodType: ReadinessMethodType.Call,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userCallId: SMS_METHOD_ID,
          });
        },
      },
      {
        methodType: ReadinessMethodType.Push,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userPushId: SMS_METHOD_ID,
          });
        },
      },
      {
        methodType: ReadinessMethodType.WhatsApp,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userWhatsAppId: WHATSAPP_METHOD_ID,
          });
        },
      },
      {
        methodType: ReadinessMethodType.Telegram,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userTelegramId: SMS_METHOD_ID,
          });
        },
      },
      {
        methodType: ReadinessMethodType.Webhook,
        makeRule: (): UserNotificationRule => {
          return rule({
            id: RULE_1_ID,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: SEV1_ID,
            userWebhookId: SMS_METHOD_ID,
          });
        },
      },
    ];

    for (const one of cases) {
      ruleRows = [one.makeRule()];

      const methodId: ObjectID =
        one.methodType === ReadinessMethodType.WhatsApp
          ? WHATSAPP_METHOD_ID
          : SMS_METHOD_ID;

      const impact: NotificationDeletionImpact = await methodDeletionImpact(
        one.methodType,
        methodId,
      );

      expect(impact.rulesDeletedCount).toBe(1);
      expect(impact.coverageLost).toHaveLength(1);
    }
  });

  test("the method row is looked up scoped by projectId, not by id alone", async () => {
    ruleRows = [];

    await methodDeletionImpact(ReadinessMethodType.SMS, SMS_METHOD_ID);

    const call: FindOneByCall = smsFindOneBy.mock.calls[0]![0] as FindOneByCall;

    expect(call.query["_id"]?.toString()).toBe(SMS_METHOD_ID.toString());
    expect(call.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
  });

  test("the userId comes from the METHOD ROW, and the rule read uses it", async () => {
    /*
     * The caller never supplies a userId on this path. Taking it from the row
     * is what makes it impossible to ask about one user's method under another
     * user's name and get an answer that belongs to neither.
     */
    const foreignRow: UserSMS = new UserSMS();
    foreignRow.id = SMS_METHOD_ID;
    foreignRow.userId = OTHER_USER_ID;
    foreignRow.isVerified = true;
    smsFindOneBy.mockResolvedValue(foreignRow as never);

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.userId.toString()).toBe(OTHER_USER_ID.toString());
    expect(firstCall(ruleFindBy).query["userId"]?.toString()).toBe(
      OTHER_USER_ID.toString(),
    );
    expect(readinessForUsers.mock.calls[0]![0]![0].toString()).toBe(
      OTHER_USER_ID.toString(),
    );
  });

  test("a method that is not there throws rather than reporting an empty impact", async () => {
    smsFindOneBy.mockResolvedValue(null as never);

    await expect(
      methodDeletionImpact(ReadinessMethodType.SMS, SMS_METHOD_ID),
    ).rejects.toThrow("Notification method not found");
  });

  test("a method row with no userId throws rather than guessing", async () => {
    const orphan: UserSMS = new UserSMS();
    orphan.id = SMS_METHOD_ID;
    smsFindOneBy.mockResolvedValue(orphan as never);

    await expect(
      methodDeletionImpact(ReadinessMethodType.SMS, SMS_METHOD_ID),
    ).rejects.toThrow("Notification method not found");
  });

  test("the cascade sentence is singular for one rule", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID)];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(
      warningsMatching(impact, "also deletes 1 notification rule that use it"),
    ).toHaveLength(1);
  });

  test("no cascade sentence when the method carries no rules at all", async () => {
    ruleRows = [];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(warningsMatching(impact, "also deletes")).toHaveLength(0);
  });

  test("the cascade sentence comes FIRST - it is the part nobody clicked", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID)];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.warnings[0]).toContain("also deletes");
  });
});

/*
 * ---------------------------------------------------------------------------
 * (F) Reachability after the deletion.
 *
 * Two of the four answers are certain and two are not, and the split is
 * structural: a method must be VERIFIED to be used at all, and Push, Email and
 * Webhook have no project switch that can turn them off. Anything that turns
 * the honest "depends" into a green is a false reassurance in the one dialog
 * where it costs a page.
 * ---------------------------------------------------------------------------
 */

describe("reachability after the deletion", () => {
  test("deleting the last verified method reports NotReachable and says so", async () => {
    readinessRows = [
      readiness({
        status: ReadinessStatus.Ready,
        methods: [method(ReadinessMethodType.SMS)],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(PostDeletionReachability.NotReachable);
    expect(impact.verifiedMethodCountAfterDeletion).toBe(0);
    expect(
      warningsMatching(impact, "last verified notification method"),
    ).toHaveLength(1);
  });

  test("a surviving verified Email is a CERTAIN yes - no project switch can turn it off", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Email),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
    expect(impact.verifiedMethodCountAfterDeletion).toBe(1);
  });

  test("a surviving verified Push is equally certain", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Push),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
  });

  test("a surviving Webhook counts, because a webhook has no verification concept", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Webhook),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
  });

  test("only PAID channels surviving is an honest 'depends', never a green", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.Email),
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Call),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.Email,
      EMAIL_METHOD_ID,
    );

    expect(impact.reachability).toBe(
      PostDeletionReachability.DependsOnProjectSettings,
    );
    expect(impact.verifiedMethodCountAfterDeletion).toBe(2);

    const warning: Array<string> = warningsMatching(
      impact,
      "channel the project can switch off",
    );

    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain("SMS, Call");
    expect(warning[0]).toContain("On-Call > Readiness");
  });

  test("deleting an UNVERIFIED method changes nothing about reachability", async () => {
    const unverified: UserSMS = new UserSMS();
    unverified.id = SMS_METHOD_ID;
    unverified.userId = USER_ID;
    unverified.isVerified = false;
    smsFindOneBy.mockResolvedValue(unverified as never);

    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.Email),
          method(ReadinessMethodType.SMS, false),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    /*
     * An unverified method is never used by anything, so removing it cannot
     * cost a page - and a scary sentence in front of somebody cleaning up a
     * typo'd number is exactly the noise that gets warnings ignored.
     */
    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
    expect(impact.verifiedMethodCountAfterDeletion).toBe(1);
  });

  test("exactly ONE entry of the channel is removed - a second number of the same kind survives", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.SMS),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.verifiedMethodCountAfterDeletion).toBe(1);
    expect(impact.reachability).toBe(
      PostDeletionReachability.DependsOnProjectSettings,
    );
  });

  test("a user readiness already calls NotReachable is AlreadyNotReachable, not a new break", async () => {
    readinessRows = [
      readiness({
        status: ReadinessStatus.NotReachable,
        methods: [method(ReadinessMethodType.SMS)],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(
      PostDeletionReachability.AlreadyNotReachable,
    );
    expect(
      warningsMatching(impact, "already has no usable notification method"),
    ).toHaveLength(1);
    expect(
      warningsMatching(impact, "last verified notification method"),
    ).toHaveLength(0);
  });

  test("NotReachable status wins over a surviving verified method on a switched-off channel", async () => {
    /*
     * Readiness says NotReachable when nothing is USABLE, which includes "every
     * verified method is on a channel this project switched off". Checking that
     * first is what stops the branches below promising reachability on the
     * strength of a method nothing can send on.
     */
    readinessRows = [
      readiness({
        status: ReadinessStatus.NotReachable,
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Call),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(
      PostDeletionReachability.AlreadyNotReachable,
    );
  });

  test("no readiness at all is Unknown, and is never guessed at", async () => {
    readinessRows = [];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(PostDeletionReachability.Unknown);
    expect(impact.isOnCallResponder).toBe(false);
    expect(impact.reachedVia).toEqual([]);
    expect(warningsMatching(impact, "could not be determined")).toHaveLength(1);
  });

  test("deleting a RULE never changes the verified method count", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.Email),
          method(ReadinessMethodType.SMS),
        ],
      }),
    ];

    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.verifiedMethodCountAfterDeletion).toBe(2);
    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
  });

  test("unverified methods never count towards the surviving total", async () => {
    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Email, false),
          method(ReadinessMethodType.Call, false),
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.verifiedMethodCountAfterDeletion).toBe(0);
    expect(impact.reachability).toBe(PostDeletionReachability.NotReachable);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (G) "Is this person on call anywhere" comes from OnCallReadinessService and
 * from nowhere else.
 *
 * A second answer to that question that disagreed with the readiness page
 * would be worse than no answer at all.
 * ---------------------------------------------------------------------------
 */

describe("responder status is reused, never re-derived", () => {
  test("readiness is asked exactly once, for exactly this user and project", async () => {
    await ruleDeletionImpact();

    expect(readinessForUsers).toHaveBeenCalledTimes(1);

    const userIds: Array<ObjectID> = readinessForUsers.mock
      .calls[0]![0] as Array<ObjectID>;

    expect(userIds).toHaveLength(1);
    expect(userIds[0]!.toString()).toBe(USER_ID.toString());
    expect((readinessForUsers.mock.calls[0]![1] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("the responder set is NEVER resolved here - no escalation, schedule, override or team read", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    await ruleDeletionImpact(RULE_1_ID);

    expect(escalationUserFindBy).not.toHaveBeenCalled();
    expect(escalationTeamFindBy).not.toHaveBeenCalled();
    expect(scheduleLayerUserFindBy).not.toHaveBeenCalled();
    expect(overrideFindBy).not.toHaveBeenCalled();
    expect(teamMemberFindBy).not.toHaveBeenCalled();
  });

  test("reachedVia is carried through verbatim, and named in prose", async () => {
    readinessRows = [
      readiness({
        reachedVia: [ResponderSource.Team, ResponderSource.Override],
      }),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact();

    expect(impact.isOnCallResponder).toBe(true);
    expect(impact.reachedVia).toEqual([
      ResponderSource.Team,
      ResponderSource.Override,
    ]);

    const warning: Array<string> = warningsMatching(impact, "is on call");

    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain("through a team");
    expect(warning[0]).toContain("through an override");
  });

  test("all four sources have prose, none leaks a bare enum value", async () => {
    readinessRows = [
      readiness({
        reachedVia: [
          ResponderSource.Direct,
          ResponderSource.Team,
          ResponderSource.Schedule,
          ResponderSource.Override,
        ],
      }),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact();

    const warning: string = warningsMatching(impact, "is on call")[0]!;

    expect(warning).toContain("directly on an escalation rule");
    expect(warning).toContain("through a team");
    expect(warning).toContain("through a schedule");
    expect(warning).toContain("through an override");
  });

  test("a user on no policy is told so OUT LOUD, not by the absence of a warning", async () => {
    readinessRows = [readiness({ reachedVia: [] })];

    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isOnCallResponder).toBe(false);
    expect(
      warningsMatching(impact, "not on any on-call policy right now"),
    ).toHaveLength(1);
  });

  test("a user on no policy is STILL told what coverage disappears", async () => {
    readinessRows = [readiness({ reachedVia: [] })];

    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    /*
     * They may be added to a policy tomorrow, and the configuration they are
     * deleting today is what will page them then.
     */
    expect(impact.coverageLost).toHaveLength(1);
    expect(
      warningsMatching(impact, "no rule covers Sev1 incidents"),
    ).toHaveLength(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (H) The consequence clause: what actually happens to an uncovered page.
 *
 * "No rule for Sev4" is a shrug. "No rule for Sev4, and those pages are
 * dropped" is a decision. The two possible endings are the project's fallback
 * switch, and this surface must agree with the readiness page about it.
 * ---------------------------------------------------------------------------
 */

describe("the fallback consequence", () => {
  test("with the fallback ON, an uncovered cell falls back", async () => {
    projectRow = project(false);
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isFallbackEnabled).toBe(true);
    expect(
      warningsMatching(impact, "fall back to whatever this user has verified"),
    ).toHaveLength(1);
    expect(warningsMatching(impact, "dropped")).toHaveLength(0);
  });

  test("with the fallback OFF, an uncovered cell is a dropped page and says so", async () => {
    projectRow = project(true);
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isFallbackEnabled).toBe(false);

    const warning: Array<string> = warningsMatching(impact, "are dropped");

    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain(
      "on-call fallback is disabled for this project",
    );
  });

  test("a project row that cannot be read reads as fallback ON, exactly as readiness reads it", async () => {
    projectRow = null;
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isFallbackEnabled).toBe(true);
  });

  test("the fallback switch is read once, for the project asked about", async () => {
    await ruleDeletionImpact();

    expect(projectFindOneById).toHaveBeenCalledTimes(1);

    const call: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = projectFindOneById.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(call.id.toString()).toBe(PROJECT_ID.toString());
    expect(call.select["disableOnCallNotificationFallback"]).toBe(true);
    expect(call.props.isRoot).toBe(true);
  });

  test("one sentence per rule type listing its severities, not one per cell", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID),
      incidentRule(RULE_2_ID, SEV2_ID),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
    );

    const warning: Array<string> = warningsMatching(impact, "no rule covers");

    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain("Sev1, Sev2 incidents");
  });

  test("severities are listed in the project's own order, not alphabetically", async () => {
    /*
     * "Sev1, Sev2" sorts the same both ways and would hide this. "Critical,
     * High, Low" does not: severity order is Critical then High then Low, and
     * alphabetical order is the same by accident, so the fixture uses names
     * whose alphabetical order is the REVERSE of their severity order.
     */
    incidentSeverityRows = [
      incidentSeverity(SEV1_ID, "Urgent"),
      incidentSeverity(SEV2_ID, "Amber"),
    ];

    ruleRows = [
      incidentRule(RULE_1_ID, SEV2_ID),
      incidentRule(RULE_2_ID, SEV1_ID),
    ];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      RULE_1_ID,
      RULE_2_ID,
    );

    expect(warningsMatching(impact, "no rule covers")[0]).toContain(
      "Urgent, Amber incidents",
    );
  });

  test("the severity read asks for the project's severity order", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    await ruleDeletionImpact(RULE_1_ID);

    expect(firstCall(incidentSeverityFindBy).sort).toEqual({
      order: SortOrder.Ascending,
    });
  });

  test("severities are not read at all when nothing is lost", async () => {
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV1_ID, EMAIL_METHOD_ID),
    ];

    await ruleDeletionImpact(RULE_1_ID);

    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
    expect(alertSeverityFindBy).not.toHaveBeenCalled();
  });

  test("only the severity table a lost cell needs is read", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    await ruleDeletionImpact(RULE_1_ID);

    expect(incidentSeverityFindBy).toHaveBeenCalledTimes(1);
    expect(alertSeverityFindBy).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * (I) Row scoping.
 *
 * Permission.CurrentUser is auto-granted to every authenticated caller, so a
 * COLUMN access list can never mean "only my own row". Row scoping comes from
 * the query, and only from the query.
 * ---------------------------------------------------------------------------
 */

describe("row scoping", () => {
  test("the rule read is scoped by BOTH projectId and userId", async () => {
    await ruleDeletionImpact(RULE_1_ID);

    const call: FindByCall = firstCall(ruleFindBy);

    expect(call.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
    expect(call.query["userId"]?.toString()).toBe(USER_ID.toString());
  });

  test("a rule id that belongs to nobody in this scope contributes nothing", async () => {
    /*
     * The ids are intersected with what the SCOPED read returned rather than
     * trusted. A caller passing somebody else's rule id gets an impact that
     * describes nothing, not an impact that describes their rule.
     */
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact = await ruleDeletionImpact(
      new ObjectID("ffffffff-ffff-4fff-8fff-ffffffffffff"),
    );

    expect(impact.rulesDeletedCount).toBe(0);
    expect(impact.coverageLost).toHaveLength(0);
  });

  test("the project the caller asked about is the project everything is read from", async () => {
    await UserNotificationRuleService.getRuleDeletionImpact({
      projectId: OTHER_PROJECT_ID,
      userId: USER_ID,
      notificationRuleIds: [],
    });

    expect(firstCall(ruleFindBy).query["projectId"]?.toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
    expect((readinessForUsers.mock.calls[0]![1] as ObjectID).toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("every read this service makes is a root read with an explicit scope", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    await ruleDeletionImpact(RULE_1_ID);

    expect(firstCall(ruleFindBy).props?.isRoot).toBe(true);
    expect(firstCall(incidentSeverityFindBy).props?.isRoot).toBe(true);
    expect(
      firstCall(incidentSeverityFindBy).query["projectId"]?.toString(),
    ).toBe(PROJECT_ID.toString());
  });
});

/*
 * ---------------------------------------------------------------------------
 * (J) Advisory, never blocking.
 *
 * The delete still happens through the ordinary CRUD path. Nothing here may
 * write, and nothing may refuse a delete that is merely inconvenient - a hook
 * that threw would break a user leaving a project just as surely as it would
 * stop an accident.
 * ---------------------------------------------------------------------------
 */

describe("advisory, not blocking", () => {
  test("a preview writes NOTHING", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    await ruleDeletionImpact(RULE_1_ID);
    await methodDeletionImpact(ReadinessMethodType.SMS, SMS_METHOD_ID);

    expect(ruleCreate).not.toHaveBeenCalled();
    expect(ruleDeleteBy).not.toHaveBeenCalled();
    expect(ruleUpdateOneBy).not.toHaveBeenCalled();
  });

  test("the worst possible impact still RESOLVES - it never throws to stop a delete", async () => {
    projectRow = project(true);
    readinessRows = [
      readiness({
        status: ReadinessStatus.Ready,
        methods: [method(ReadinessMethodType.SMS)],
        reachedVia: [ResponderSource.Direct],
      }),
    ];
    ruleRows = [
      incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID),
      incidentRule(RULE_2_ID, SEV2_ID, SMS_METHOD_ID),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.reachability).toBe(PostDeletionReachability.NotReachable);
    expect(impact.coverageLost).toHaveLength(2);
    expect(impact.warnings.length).toBeGreaterThan(3);
  });

  test("a user who has left the project gets an honest answer, not an exception", async () => {
    /*
     * getReadinessForUsers OMITS a non-member rather than throwing, and this
     * has to stay that way: somebody being removed from a project is one of the
     * legitimate reasons their methods are being deleted, and an admin doing
     * housekeeping must not be handed an error.
     */
    readinessRows = [];
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isOnCallResponder).toBe(false);
    expect(impact.reachability).toBe(PostDeletionReachability.Unknown);
    expect(impact.coverageLost).toHaveLength(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (K) Paging and truncation.
 *
 * A truncated read is not symmetric in its consequences. Unread rules that
 * would have SURVIVED make this over-warn, which costs a moment. Unread rules
 * that would have been DELETED make it under-warn, which is the failure this
 * feature exists to prevent. Either way the caller is told.
 * ---------------------------------------------------------------------------
 */

describe("paging the rule read", () => {
  test("the read is sorted by _id ascending, so OFFSET paging is stable", async () => {
    await ruleDeletionImpact();

    expect(firstCall(ruleFindBy).sort).toEqual({ _id: SortOrder.Ascending });
  });

  test("the read asks for a full page and starts at zero", async () => {
    await ruleDeletionImpact();

    const call: FindByCall = firstCall(ruleFindBy);

    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
  });

  test("a short page ends the read after ONE query", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    await ruleDeletionImpact(RULE_1_ID);

    expect(ruleFindBy).toHaveBeenCalledTimes(1);
  });

  test("a completely empty rule set is not an error", async () => {
    ruleRows = [];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.rulesDeletedCount).toBe(0);
    expect(impact.coverageLost).toHaveLength(0);
    expect(impact.isTruncated).toBe(false);
  });

  test("hitting the page ceiling sets isTruncated, logs, and warns in prose", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];
    ruleReadAlwaysReturnsAFullPage = true;

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isTruncated).toBe(true);
    expect(loggerError).toHaveBeenCalled();
    expect(warningsMatching(impact, "This preview is incomplete")).toHaveLength(
      1,
    );
  });

  test("an untruncated read never claims to be truncated", async () => {
    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID)];

    const impact: NotificationDeletionImpact =
      await ruleDeletionImpact(RULE_1_ID);

    expect(impact.isTruncated).toBe(false);
    expect(warningsMatching(impact, "This preview is incomplete")).toHaveLength(
      0,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * (L) The per-method-service entry points.
 *
 * Each of the seven notification-method services can answer for its own row,
 * which is where the delete is actually initiated from. Each must name its own
 * channel: a service that passed the wrong one would preview the cascade of a
 * method the user is not deleting.
 * ---------------------------------------------------------------------------
 */

describe("the per-method-service entry points", () => {
  test("each service previews its OWN channel", async () => {
    const cases: Array<{
      name: string;
      call: () => Promise<NotificationDeletionImpact>;
      ruleWithThisMethod: UserNotificationRule;
    }> = [
      {
        name: "UserEmailService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserEmailService.getDeletionImpact({
            itemId: SMS_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userEmailId: SMS_METHOD_ID,
        }),
      },
      {
        name: "UserSmsService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserSmsService.getDeletionImpact({
            itemId: SMS_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userSmsId: SMS_METHOD_ID,
        }),
      },
      {
        name: "UserCallService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserCallService.getDeletionImpact({
            itemId: SMS_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userCallId: SMS_METHOD_ID,
        }),
      },
      {
        name: "UserPushService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserPushService.getDeletionImpact({
            itemId: SMS_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userPushId: SMS_METHOD_ID,
        }),
      },
      {
        name: "UserWhatsAppService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserWhatsAppService.getDeletionImpact({
            itemId: WHATSAPP_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userWhatsAppId: WHATSAPP_METHOD_ID,
        }),
      },
      {
        name: "UserTelegramService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserTelegramService.getDeletionImpact({
            itemId: SMS_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userTelegramId: SMS_METHOD_ID,
        }),
      },
      {
        name: "UserWebhookService",
        call: (): Promise<NotificationDeletionImpact> => {
          return UserWebhookService.getDeletionImpact({
            itemId: SMS_METHOD_ID,
            projectId: PROJECT_ID,
          });
        },
        ruleWithThisMethod: rule({
          id: RULE_1_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV1_ID,
          userWebhookId: SMS_METHOD_ID,
        }),
      },
    ];

    for (const one of cases) {
      ruleRows = [one.ruleWithThisMethod];

      const impact: NotificationDeletionImpact = await one.call();

      /*
       * The rule pointing at THIS channel's foreign key is the one that goes.
       * A service naming the wrong channel would find no rule at all here.
       */
      expect(impact.rulesDeletedCount).toBe(1);
      expect(impact.coverageLost).toHaveLength(1);
    }
  });

  test("each service reads its own table, scoped to the project", async () => {
    ruleRows = [];

    await UserEmailService.getDeletionImpact({
      itemId: EMAIL_METHOD_ID,
      projectId: PROJECT_ID,
    });

    expect(emailFindOneBy).toHaveBeenCalledTimes(1);
    expect(smsFindOneBy).not.toHaveBeenCalled();

    const call: FindOneByCall = emailFindOneBy.mock
      .calls[0]![0] as FindOneByCall;

    expect(call.query["_id"]?.toString()).toBe(EMAIL_METHOD_ID.toString());
    expect(call.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a webhook counts as verified without an isVerified column to read", async () => {
    /*
     * The fixture carries no isVerified at all, which is the truth of the
     * model. If presence were not the whole test, deleting the one channel
     * guaranteed to work would look free.
     */
    readinessRows = [
      readiness({ methods: [method(ReadinessMethodType.Webhook)] }),
    ];
    ruleRows = [];

    const impact: NotificationDeletionImpact =
      await UserWebhookService.getDeletionImpact({
        itemId: SMS_METHOD_ID,
        projectId: PROJECT_ID,
      });

    expect(impact.verifiedMethodCountAfterDeletion).toBe(0);
    expect(impact.reachability).toBe(PostDeletionReachability.NotReachable);
  });

  test("the seven services do not read each other's tables", async () => {
    ruleRows = [];

    await UserTelegramService.getDeletionImpact({
      itemId: SMS_METHOD_ID,
      projectId: PROJECT_ID,
    });

    expect(telegramFindOneBy).toHaveBeenCalledTimes(1);
    expect(emailFindOneBy).not.toHaveBeenCalled();
    expect(smsFindOneBy).not.toHaveBeenCalled();
    expect(callFindOneBy).not.toHaveBeenCalled();
    expect(pushFindOneBy).not.toHaveBeenCalled();
    expect(whatsAppFindOneBy).not.toHaveBeenCalled();
    expect(webhookFindOneBy).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * (M) The import cycle.
 *
 * This module and OnCallReadinessService import each other, which is fine as
 * long as neither one READS the other at module-evaluation time. Whichever is
 * evaluated second sees the first's exports still empty, so a top-level
 * `ReadinessMethodType.Push` throws on exactly one of the two load orders and
 * not the other - a crash whose presence depends on which file some unrelated
 * caller happened to import first, and which therefore shows up as an
 * apparently unrelated test suite failing to load at all.
 * ---------------------------------------------------------------------------
 */

describe("the OnCallReadinessService import cycle", () => {
  test("loading readiness FIRST still leaves this module usable", () => {
    jest.isolateModules((): void => {
      expect((): void => {
        /*
         * The order that used to throw: loading readiness pulls in the policy
         * services, which pull in this module, which re-enters readiness while
         * it is still half-evaluated. isolateModules gives both a fresh
         * registry, so the order actually gets re-run rather than served from
         * whatever this file's own imports already cached.
         */
        jest.requireActual("../../../Server/Services/OnCallReadinessService");
        jest.requireActual(
          "../../../Server/Services/UserNotificationRuleService",
        );
      }).not.toThrow();
    });
  });

  test("loading this module FIRST is equally fine", () => {
    jest.isolateModules((): void => {
      expect((): void => {
        jest.requireActual(
          "../../../Server/Services/UserNotificationRuleService",
        );
        jest.requireActual("../../../Server/Services/OnCallReadinessService");
      }).not.toThrow();
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * (N) The whole answer, on a realistic shape.
 *
 * A responder deleting the phone number that carries their entire default
 * configuration - which is what the default rule seeding produces, one rule per
 * (rule type x severity) on the method that was verified.
 * ---------------------------------------------------------------------------
 */

describe("a responder deleting the number their whole configuration hangs off", () => {
  test("the impact names the cascade, the coverage, the handoffs and the silence", async () => {
    readinessRows = [
      readiness({
        status: ReadinessStatus.Ready,
        methods: [method(ReadinessMethodType.SMS)],
        reachedVia: [ResponderSource.Schedule],
      }),
    ];

    ruleRows = [
      rule({
        id: new ObjectID("10000000-0000-4000-8000-000000000001"),
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: new ObjectID("10000000-0000-4000-8000-000000000002"),
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV2_ID,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: new ObjectID("10000000-0000-4000-8000-000000000003"),
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        alertSeverityId: ALERT_SEV1_ID,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: new ObjectID("10000000-0000-4000-8000-000000000004"),
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        userSmsId: SMS_METHOD_ID,
      }),
      rule({
        id: new ObjectID("10000000-0000-4000-8000-000000000005"),
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
        userSmsId: SMS_METHOD_ID,
      }),
    ];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      SMS_METHOD_ID,
    );

    expect(impact.rulesDeletedCount).toBe(5);
    expect(impact.coverageLost).toHaveLength(3);
    expect(impact.handoffNotificationsLost).toHaveLength(2);
    expect(impact.isOnCallResponder).toBe(true);
    expect(impact.reachability).toBe(PostDeletionReachability.NotReachable);
    expect(impact.verifiedMethodCountAfterDeletion).toBe(0);

    expect(impact.warnings[0]).toContain("also deletes 5 notification rules");
    expect(impact.warnings[1]).toContain("last verified notification method");
    expect(impact.warnings[2]).toContain("is on call in this project");
    expect(warningsMatching(impact, "Sev1, Sev2 incidents")).toHaveLength(1);
    expect(warningsMatching(impact, "Alert Sev1 alerts")).toHaveLength(1);
    expect(warningsMatching(impact, "when they go on call")).toHaveLength(1);
    expect(warningsMatching(impact, "when they go off call")).toHaveLength(1);
  });

  test("the same responder deleting a SPARE number is told it costs nothing", async () => {
    const spareSmsId: ObjectID = new ObjectID(
      "20000000-0000-4000-8000-000000000001",
    );

    const spareRow: UserSMS = new UserSMS();
    spareRow.id = spareSmsId;
    spareRow.userId = USER_ID;
    spareRow.isVerified = true;
    smsFindOneBy.mockResolvedValue(spareRow as never);

    readinessRows = [
      readiness({
        methods: [
          method(ReadinessMethodType.SMS),
          method(ReadinessMethodType.Email),
        ],
        reachedVia: [ResponderSource.Schedule],
      }),
    ];

    ruleRows = [incidentRule(RULE_1_ID, SEV1_ID, SMS_METHOD_ID)];

    const impact: NotificationDeletionImpact = await methodDeletionImpact(
      ReadinessMethodType.SMS,
      spareSmsId,
    );

    expect(impact.rulesDeletedCount).toBe(0);
    expect(impact.coverageLost).toHaveLength(0);
    expect(impact.handoffNotificationsLost).toHaveLength(0);
    expect(impact.reachability).toBe(PostDeletionReachability.Reachable);
    expect(warningsMatching(impact, "also deletes")).toHaveLength(0);
    expect(warningsMatching(impact, "no rule covers")).toHaveLength(0);
  });
});
