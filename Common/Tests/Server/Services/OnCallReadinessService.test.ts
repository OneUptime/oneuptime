import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import OnCallReadinessService, {
  IDENTIFIER_MASK,
  MaskedIdentifierKind,
  ReadinessCoverageCell,
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  ReadinessSummary,
  ResponderSource,
  UserReadiness,
  maskIdentifier,
} from "../../../Server/Services/OnCallReadinessService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { FindOperator } from "typeorm";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * OnCallReadinessService answers exactly one question - "can this responder
 * actually be paged?" - and every readiness surface in the product renders what
 * it returns. That makes each of its judgements load-bearing in the most
 * literal sense: a false green is a page that lands nowhere while an admin
 * looks at a table telling them everything is fine.
 *
 * It replaces TeamComplianceService, which answered the same question wrongly
 * in seven separate ways. Six of those seven are structural properties of this
 * service rather than behaviours you would stumble across, so they are pinned
 * here deliberately and each test says which defect it is standing guard over:
 *
 *   - team-scoping (a direct/schedule/override responder was never checked)
 *   - a bare `limit: 100` that silently truncated a real project
 *   - matching on severity alone, so a "when I go off call" rule certified
 *     incident coverage
 *   - counting only four of the seven channels, so a Telegram-only responder
 *     was reported unreachable while the runtime paged them happily
 *   - one findBy per severity per user
 *   - being opt-in and off by default
 *
 * Three further properties are pinned because getting them wrong is silent and
 * expensive rather than merely wrong:
 *
 *   MASKING. Every identifier this service emits is redacted server-side, and
 *   the tests assert on the SERIALIZED summary rather than on the fields a test
 *   author happened to remember - a leak that arrives through a field nobody
 *   listed is exactly the leak that ships.
 *
 *   THE OPT-OUT PREDICATE. `isOptOut` is nullable and was added long after
 *   these rows started existing, so it is NULL on every pre-existing rule. The
 *   naive `isOptOut === false` split would classify every one of them as
 *   neither a rule nor an opt-out and report a fully-configured project as
 *   entirely unready. There is a test whose whole job is to fail if anyone
 *   writes that.
 *
 *   THE SEVERITY MODEL PER RULE TYPE. Incident and incident-episode rules are
 *   scoped by IncidentSeverity, alert and alert-episode by AlertSeverity.
 *   Crossing them produces cells that can never match anything, which is the
 *   exact shape of Gap G - rules that were invisible and unreachable at the
 *   same time.
 *
 * Nothing here touches a database. Every read is a jest.spyOn at the service
 * boundary, and the fixtures are ordinary models, so what is under test is this
 * service's own decision-making.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f",
);

const USER_A_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_B_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_C_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const INCIDENT_SEVERITY_1_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const INCIDENT_SEVERITY_2_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const ALERT_SEVERITY_1_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_SEVERITY_2_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

/*
 * Raw identifiers that must never reach a caller. Each is deliberately
 * distinctive so a substring search over the serialized summary cannot pass by
 * accident, and each has a "revealing middle" that survives no legitimate mask.
 */
const RAW_NOTIFICATION_EMAIL: string = "ada.lovelace@analytical-engine.example";
const RAW_SMS_PHONE: string = "+14155554821";
const RAW_CALL_PHONE: string = "+442071838750";
const RAW_WHATSAPP_PHONE: string = "+61293744000";
const RAW_TELEGRAM_HANDLE: string = "@ada_night_pager";
const RAW_WEBHOOK_NAME: string = "Payments Incident Bridge";
const RAW_WEBHOOK_URL: string =
  "https://hooks.example.com/T0LEAK/B0LEAK/xoxbSUPERSECRETTOKEN";
const RAW_PUSH_DEVICE: string = "Ada iPhone 15 Pro Max";

/** The login email, which the frozen contract says is deliberately NOT masked. */
const USER_A_LOGIN_EMAIL: string = "ada@corp.example.com";

/*
 * Enough of a findBy argument to assert on without importing the FindBy
 * generics. `query` is deliberately a Record so that assertions have to use
 * bracket access and cannot accidentally rely on a typed field that the
 * production code never set.
 */
interface FindByCall {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  sort?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  props?: { isRoot?: boolean } | undefined;
}

interface UserFindByArgument {
  query: { _id?: Includes | undefined };
}

interface TeamMemberFindByArgument {
  query: { teamId?: Includes | undefined; userId?: Includes | undefined };
}

/*
 * The mutable world every spy reads from. Reset wholesale in beforeEach so no
 * test can inherit another's configuration - readiness is a whole-project
 * roll-up and a leaked responder would change a count somewhere far away.
 */
let userDirectory: Array<User> = [];
let membershipRows: Array<TeamMember> = [];
let teamMemberRows: Array<TeamMember> = [];

let policyFindOneById: jest.SpyInstance;
let escalationUserFindBy: jest.SpyInstance;
let escalationTeamFindBy: jest.SpyInstance;
let escalationScheduleFindBy: jest.SpyInstance;
let scheduleLayerUserFindBy: jest.SpyInstance;
let overrideFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let userFindBy: jest.SpyInstance;
let pushFindBy: jest.SpyInstance;
let emailFindBy: jest.SpyInstance;
let smsFindBy: jest.SpyInstance;
let callFindBy: jest.SpyInstance;
let whatsAppFindBy: jest.SpyInstance;
let telegramFindBy: jest.SpyInstance;
let webhookFindBy: jest.SpyInstance;
let notificationRuleFindBy: jest.SpyInstance;
let incidentSeverityFindBy: jest.SpyInstance;
let alertSeverityFindBy: jest.SpyInstance;
let projectFindOneById: jest.SpyInstance;

function makeUser(id: ObjectID, name: string, loginEmail: string): User {
  const user: User = new User();
  user.id = id;
  user.name = new Name(name);
  user.email = new Email(loginEmail);

  return user;
}

function makePolicy(projectId: ObjectID): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = POLICY_ID;
  policy.projectId = projectId;

  return policy;
}

function makeProject(
  overrides: Partial<{
    disableOnCallNotificationFallback: boolean;
    enableSmsNotifications: boolean;
    enableCallNotifications: boolean;
    enableWhatsAppNotifications: boolean;
    enableTelegramNotifications: boolean;
  }> = {},
): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.disableOnCallNotificationFallback =
    overrides.disableOnCallNotificationFallback === true;
  project.enableSmsNotifications = overrides.enableSmsNotifications !== false;
  project.enableCallNotifications = overrides.enableCallNotifications !== false;
  project.enableWhatsAppNotifications =
    overrides.enableWhatsAppNotifications !== false;
  project.enableTelegramNotifications =
    overrides.enableTelegramNotifications !== false;

  return project;
}

function escalationUserRow(
  userId: ObjectID | undefined,
): OnCallDutyPolicyEscalationRuleUser {
  const row: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();

  if (userId) {
    row.userId = userId;
  }

  return row;
}

function escalationTeamRow(
  teamId: ObjectID,
): OnCallDutyPolicyEscalationRuleTeam {
  const row: OnCallDutyPolicyEscalationRuleTeam =
    new OnCallDutyPolicyEscalationRuleTeam();
  row.teamId = teamId;

  return row;
}

function escalationScheduleRow(
  scheduleId: ObjectID,
): OnCallDutyPolicyEscalationRuleSchedule {
  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.onCallDutyPolicyScheduleId = scheduleId;

  return row;
}

function layerUserRow(
  userId: ObjectID,
  scheduleId?: ObjectID | undefined,
): OnCallDutyPolicyScheduleLayerUser {
  const row: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  row.userId = userId;

  /*
   * The schedule id matters only on the user-scoped path, which asks "which
   * schedules is this person on" and then "are any of those attached to a
   * rule". The project-scoped path arrives from the other direction and reads
   * only the userId.
   */
  if (scheduleId) {
    row.onCallDutyPolicyScheduleId = scheduleId;
  }

  return row;
}

function overrideRow(
  routeAlertsToUserId: ObjectID | undefined,
): OnCallDutyPolicyUserOverride {
  const row: OnCallDutyPolicyUserOverride = new OnCallDutyPolicyUserOverride();

  if (routeAlertsToUserId) {
    row.routeAlertsToUserId = routeAlertsToUserId;
  }

  return row;
}

/*
 * A membership row carries its teamId as well as its userId, because the
 * service reads both out of one query: membership IS the cross-project guard,
 * and the teamIds that come back with it are how one user's Team source is
 * resolved without expanding every team in the project into its full roster.
 */
function teamMemberRow(
  userId: ObjectID,
  teamId?: ObjectID | undefined,
): TeamMember {
  const row: TeamMember = new TeamMember();
  row.userId = userId;

  if (teamId) {
    row.teamId = teamId;
  }

  return row;
}

function incidentSeverity(id: ObjectID, name: string): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.id = id;
  severity.name = name;

  return severity;
}

function alertSeverity(id: ObjectID, name: string): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity.id = id;
  severity.name = name;

  return severity;
}

function pushMethod(data: {
  userId: ObjectID;
  deviceName?: string | undefined;
  isVerified: boolean;
}): UserPush {
  const model: UserPush = new UserPush();
  model.userId = data.userId;
  model.isVerified = data.isVerified;

  if (data.deviceName !== undefined) {
    model.deviceName = data.deviceName;
  }

  return model;
}

function emailMethod(data: {
  userId: ObjectID;
  email: string;
  isVerified: boolean;
}): UserEmail {
  const model: UserEmail = new UserEmail();
  model.userId = data.userId;
  model.email = new Email(data.email);
  model.isVerified = data.isVerified;

  return model;
}

function smsMethod(data: {
  userId: ObjectID;
  phone: string;
  isVerified: boolean;
}): UserSMS {
  const model: UserSMS = new UserSMS();
  model.userId = data.userId;
  model.phone = new Phone(data.phone);
  model.isVerified = data.isVerified;

  return model;
}

function callMethod(data: {
  userId: ObjectID;
  phone: string;
  isVerified: boolean;
}): UserCall {
  const model: UserCall = new UserCall();
  model.userId = data.userId;
  model.phone = new Phone(data.phone);
  model.isVerified = data.isVerified;

  return model;
}

function whatsAppMethod(data: {
  userId: ObjectID;
  phone: string;
  isVerified: boolean;
}): UserWhatsApp {
  const model: UserWhatsApp = new UserWhatsApp();
  model.userId = data.userId;
  model.phone = new Phone(data.phone);
  model.isVerified = data.isVerified;

  return model;
}

function telegramMethod(data: {
  userId: ObjectID;
  handle: string;
  isVerified: boolean;
}): UserTelegram {
  const model: UserTelegram = new UserTelegram();
  model.userId = data.userId;
  model.telegramUserHandle = data.handle;
  model.isVerified = data.isVerified;

  return model;
}

/*
 * A webhook fixture that deliberately CARRIES its bearer url, even though the
 * production select must never ask for it. If the select ever widens, the
 * leak assertions downstream see a real credential rather than an undefined.
 */
function webhookMethod(data: {
  userId: ObjectID;
  name: string;
  webhookUrl?: string | undefined;
}): UserWebhook {
  const model: UserWebhook = new UserWebhook();
  model.userId = data.userId;
  model.name = data.name;

  if (data.webhookUrl !== undefined) {
    model.webhookUrl = data.webhookUrl;
  }

  return model;
}

function notificationRule(data: {
  userId: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  isOptOut?: boolean | undefined;
}): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.userId = data.userId;
  rule.ruleType = data.ruleType;

  if (data.incidentSeverityId) {
    rule.incidentSeverityId = data.incidentSeverityId;
  }

  if (data.alertSeverityId) {
    rule.alertSeverityId = data.alertSeverityId;
  }

  if (data.isOptOut !== undefined) {
    rule.isOptOut = data.isOptOut;
  }

  return rule;
}

function firstCall(spy: jest.SpyInstance): FindByCall {
  return spy.mock.calls[0]![0] as FindByCall;
}

function callAt(spy: jest.SpyInstance, index: number): FindByCall {
  return spy.mock.calls[index]![0] as FindByCall;
}

function includedIds(includes: unknown): Array<string> {
  const values: Array<string | ObjectID | number> = (includes as Includes)
    .values as Array<string | ObjectID | number>;

  return values.map((value: string | ObjectID | number): string => {
    return value.toString();
  });
}

/** Every read the service can make, so a test can count them as one number. */
function everySpy(): Array<jest.SpyInstance> {
  return [
    policyFindOneById,
    escalationUserFindBy,
    escalationTeamFindBy,
    escalationScheduleFindBy,
    scheduleLayerUserFindBy,
    overrideFindBy,
    teamMemberFindBy,
    userFindBy,
    pushFindBy,
    emailFindBy,
    smsFindBy,
    callFindBy,
    whatsAppFindBy,
    telegramFindBy,
    webhookFindBy,
    notificationRuleFindBy,
    incidentSeverityFindBy,
    alertSeverityFindBy,
    projectFindOneById,
  ];
}

function totalQueryCount(): number {
  return everySpy().reduce((sum: number, spy: jest.SpyInstance): number => {
    return sum + spy.mock.calls.length;
  }, 0);
}

/** Every findBy argument the service passed, for the whole-suite invariants. */
function everyFindByCall(): Array<FindByCall> {
  const calls: Array<FindByCall> = [];

  for (const spy of everySpy()) {
    if (spy === policyFindOneById || spy === projectFindOneById) {
      // findOneById takes an id, not a limit; nothing to assert about paging.
      continue;
    }

    for (const call of spy.mock.calls) {
      calls.push(call[0] as FindByCall);
    }
  }

  return calls;
}

function setSeverities(data: {
  incident?: Array<IncidentSeverity> | undefined;
  alert?: Array<AlertSeverity> | undefined;
}): void {
  incidentSeverityFindBy.mockResolvedValue((data.incident || []) as never);
  alertSeverityFindBy.mockResolvedValue((data.alert || []) as never);
}

/** One direct responder on the policy - the simplest shape that pages anyone. */
function attachDirectly(...userIds: Array<ObjectID>): void {
  escalationUserFindBy.mockResolvedValue(
    userIds.map((userId: ObjectID): OnCallDutyPolicyEscalationRuleUser => {
      return escalationUserRow(userId);
    }) as never,
  );
}

function policySummary(): Promise<ReadinessSummary> {
  return OnCallReadinessService.getReadinessForPolicy(POLICY_ID, PROJECT_ID);
}

async function onlyUser(): Promise<UserReadiness> {
  const summary: ReadinessSummary = await policySummary();

  expect(summary.users).toHaveLength(1);

  return summary.users[0]!;
}

function cellFor(
  readiness: UserReadiness,
  ruleType: NotificationRuleType,
  severityId: ObjectID,
): ReadinessCoverageCell {
  const cell: ReadinessCoverageCell | undefined = readiness.coverage.find(
    (candidate: ReadinessCoverageCell): boolean => {
      return (
        candidate.ruleType === ruleType &&
        candidate.severityId?.toString() === severityId.toString()
      );
    },
  );

  if (!cell) {
    throw new Error(
      `No coverage cell for ${ruleType} / ${severityId.toString()}`,
    );
  }

  return cell;
}

function methodTypes(readiness: UserReadiness): Array<string> {
  return readiness.methods.map((method: ReadinessMethod): string => {
    return method.methodType;
  });
}

beforeEach(() => {
  /*
   * The caches are static and live for the whole module, so a summary computed
   * by the previous test would be served to this one and every spy assertion
   * would read zero calls. Clearing here rather than in afterEach means a test
   * that deliberately leaves something cached cannot poison the next file
   * either.
   */
  OnCallReadinessService.clearCache();

  userDirectory = [
    makeUser(USER_A_ID, "Ada Lovelace", USER_A_LOGIN_EMAIL),
    makeUser(USER_B_ID, "Grace Hopper", "grace@corp.example.com"),
    makeUser(USER_C_ID, "Katherine Johnson", "katherine@corp.example.com"),
  ];
  membershipRows = [
    teamMemberRow(USER_A_ID, TEAM_ID),
    teamMemberRow(USER_B_ID, TEAM_ID),
    teamMemberRow(USER_C_ID, TEAM_ID),
  ];
  teamMemberRows = [];

  policyFindOneById = jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(makePolicy(PROJECT_ID) as never);

  // Default posture: nothing is attached to anything. Each test opts in.
  escalationUserFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockResolvedValue([] as never);
  escalationTeamFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue([] as never);
  escalationScheduleFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue([] as never);
  scheduleLayerUserFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockResolvedValue([] as never);
  overrideFindBy = jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
    .mockResolvedValue([] as never);

  /*
   * TeamMemberService is asked two structurally different questions - "which of
   * these users is in the project, and in which teams" (userId) and "who is in
   * these teams" (teamId) - so the fake dispatches on the query rather than
   * answering both the same way, which would make the membership guard
   * untestable.
   *
   * The membership answer is FILTERED by the userIds asked for. That is what
   * makes the guard meaningful: a fake that returned somebody else's row for
   * every question would report any user id on earth as a member of the
   * project.
   */
  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((async (
      data: TeamMemberFindByArgument,
    ): Promise<Array<TeamMember>> => {
      if (data.query.teamId) {
        return teamMemberRows;
      }

      const wanted: Set<string> = new Set<string>(
        includedIds(data.query.userId || new Includes([])),
      );

      return membershipRows.filter((row: TeamMember): boolean => {
        return wanted.has(row.userId?.toString() || "");
      });
    }) as never);

  /*
   * The user lookup answers out of a directory filtered by the Includes the
   * service passes. That is what makes the batching tests meaningful: if the
   * service ever asked per user, this fake would still work but the call count
   * would move, which is precisely the regression being guarded.
   */
  userFindBy = jest.spyOn(UserService, "findBy").mockImplementation((async (
    data: UserFindByArgument,
  ): Promise<Array<User>> => {
    const wanted: Set<string> = new Set<string>(
      includedIds(data.query._id || new Includes([])),
    );

    return userDirectory.filter((user: User): boolean => {
      return wanted.has(user.id?.toString() || "");
    });
  }) as never);

  pushFindBy = jest
    .spyOn(UserPushService, "findBy")
    .mockResolvedValue([] as never);
  emailFindBy = jest
    .spyOn(UserEmailService, "findBy")
    .mockResolvedValue([] as never);
  smsFindBy = jest
    .spyOn(UserSmsService, "findBy")
    .mockResolvedValue([] as never);
  callFindBy = jest
    .spyOn(UserCallService, "findBy")
    .mockResolvedValue([] as never);
  whatsAppFindBy = jest
    .spyOn(UserWhatsAppService, "findBy")
    .mockResolvedValue([] as never);
  telegramFindBy = jest
    .spyOn(UserTelegramService, "findBy")
    .mockResolvedValue([] as never);
  webhookFindBy = jest
    .spyOn(UserWebhookService, "findBy")
    .mockResolvedValue([] as never);

  notificationRuleFindBy = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockResolvedValue([] as never);

  incidentSeverityFindBy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([] as never);
  alertSeverityFindBy = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([] as never);

  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(makeProject() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  OnCallReadinessService.clearCache();
});

/*
 * ---------------------------------------------------------------------------
 * (A) maskIdentifier as a pure function.
 *
 * Masking is the one rule in this service that must never be got wrong even
 * slightly, and it is exported as a free function precisely so it can be
 * exercised at this granularity. The interesting cases are all the DEGENERATE
 * ones - a one-character handle, a four-digit number, a string with no "@" that
 * arrived in an email column - because those are where a mask stops hiding
 * anything and nobody notices.
 * ---------------------------------------------------------------------------
 */
describe("maskIdentifier", () => {
  test("the shared mask constant is three bullets, so a look-alike typo is a test failure", () => {
    expect(IDENTIFIER_MASK).toBe("•••");
    expect(IDENTIFIER_MASK).toHaveLength(3);
  });

  describe("email", () => {
    test("keeps one leading character and the whole domain", () => {
      expect(
        maskIdentifier("jane@example.com", MaskedIdentifierKind.Email),
      ).toBe(`j${IDENTIFIER_MASK}@example.com`);
    });

    test("a plus-addressed local part is hidden past its first character", () => {
      const masked: string = maskIdentifier(
        "ops+pager-escalation@example.com",
        MaskedIdentifierKind.Email,
      );

      expect(masked).toBe(`o${IDENTIFIER_MASK}@example.com`);
      expect(masked).not.toContain("pager");
    });

    test("a single-character local part reveals nothing extra", () => {
      expect(maskIdentifier("a@b.co", MaskedIdentifierKind.Email)).toBe(
        `a${IDENTIFIER_MASK}@b.co`,
      );
    });

    test("splits on the LAST @, so a quoted local part cannot smuggle the address through", () => {
      expect(
        maskIdentifier('"weird@local"@example.com', MaskedIdentifierKind.Email),
      ).toBe(`"${IDENTIFIER_MASK}@example.com`);
    });

    test("a value with no @ falls through to the stricter handle rule rather than being guessed at", () => {
      expect(maskIdentifier("notanemail", MaskedIdentifierKind.Email)).toBe(
        `no${IDENTIFIER_MASK}`,
      );
    });

    test("a leading @ with no local part is a handle, not a domain to publish", () => {
      expect(maskIdentifier("@example.com", MaskedIdentifierKind.Email)).toBe(
        `@ex${IDENTIFIER_MASK}`,
      );
    });
  });

  describe("phone", () => {
    test("keeps the country code and the last four digits", () => {
      expect(maskIdentifier("+14155554821", MaskedIdentifierKind.Phone)).toBe(
        `+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`,
      );
    });

    test("a two-digit country code survives, because the rule is 'everything before the last ten'", () => {
      expect(maskIdentifier("+442071838750", MaskedIdentifierKind.Phone)).toBe(
        `+44 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 8750`,
      );
    });

    test("formatting characters are stripped before the digits are counted", () => {
      expect(
        maskIdentifier("+1 (415) 555-4821", MaskedIdentifierKind.Phone),
      ).toBe(`+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`);
    });

    test("a country whose national plan is not ten digits loses a country-code digit, and hides MORE as a result", () => {
      /*
       * +61 2 9374 4000 is eleven digits, and the rule is "everything before
       * the last ten is the country code", so the split lands after "6" rather
       * than after "61". That is the heuristic behaving as documented rather
       * than a defect: it is a parse-free rule, and the digit it gets wrong is
       * one it HIDES. Correctness here is measured in what is concealed, and
       * concealing an extra digit of a country code errs in the safe
       * direction - so this is pinned deliberately, to keep anyone from
       * "fixing" it into a real libphonenumber parse that could round the other
       * way.
       */
      const masked: string = maskIdentifier(
        "+61293744000",
        MaskedIdentifierKind.Phone,
      );

      expect(masked).toBe(`+6 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4000`);
      expect(masked).not.toContain("9374");
    });

    test("a bare national number produces no country code prefix", () => {
      const masked: string = maskIdentifier(
        "4155554821",
        MaskedIdentifierKind.Phone,
      );

      expect(masked).toBe(`${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`);
      expect(masked.startsWith("+")).toBe(false);
    });

    test("fewer than four digits is masked entirely - four digits of a three digit number is the number", () => {
      expect(maskIdentifier("123", MaskedIdentifierKind.Phone)).toBe(
        IDENTIFIER_MASK,
      );
      expect(maskIdentifier("+1", MaskedIdentifierKind.Phone)).toBe(
        IDENTIFIER_MASK,
      );
    });

    test("EXACTLY four digits is masked entirely - the last four of a four-digit value is the value", () => {
      /*
       * The boundary, and the one the original `< 4` got wrong. A four-digit
       * value passed the guard and then had its "last four" revealed, which is
       * all of it: the function returned the identifier in full while looking,
       * on screen and in review, exactly like a mask. Anything at or below the
       * number of digits the mask keeps has to be hidden completely, because a
       * value we cannot hide half of is a value we do not show.
       */
      expect(maskIdentifier("4821", MaskedIdentifierKind.Phone)).toBe(
        IDENTIFIER_MASK,
      );
      // Formatting is stripped before the digits are counted, so this is four.
      expect(maskIdentifier("(48) 21", MaskedIdentifierKind.Phone)).toBe(
        IDENTIFIER_MASK,
      );
      expect(maskIdentifier("0000", MaskedIdentifierKind.Phone)).toBe(
        IDENTIFIER_MASK,
      );
    });

    test("five digits is the shortest value that reveals anything, and reveals only four of them", () => {
      const masked: string = maskIdentifier(
        "54821",
        MaskedIdentifierKind.Phone,
      );

      expect(masked).toBe(`${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`);
      expect(masked.startsWith("5")).toBe(false);
    });

    test("a value with no digits at all is masked entirely", () => {
      expect(maskIdentifier("not-a-phone", MaskedIdentifierKind.Phone)).toBe(
        IDENTIFIER_MASK,
      );
    });
  });

  describe("handle", () => {
    test("keeps the @ sigil and two characters", () => {
      expect(maskIdentifier("@jamesbond", MaskedIdentifierKind.Handle)).toBe(
        `@ja${IDENTIFIER_MASK}`,
      );
    });

    test("a handle without a sigil does not grow one", () => {
      expect(maskIdentifier("jamesbond", MaskedIdentifierKind.Handle)).toBe(
        `ja${IDENTIFIER_MASK}`,
      );
    });

    test("a one-character handle reveals one character, not a padded lie", () => {
      expect(maskIdentifier("j", MaskedIdentifierKind.Handle)).toBe(
        `j${IDENTIFIER_MASK}`,
      );
      expect(maskIdentifier("@j", MaskedIdentifierKind.Handle)).toBe(
        `@j${IDENTIFIER_MASK}`,
      );
    });

    test("a device name is trimmed before it is cut, so leading space is not spent as a revealed character", () => {
      expect(
        maskIdentifier("   Ada iPhone   ", MaskedIdentifierKind.Handle),
      ).toBe(`Ad${IDENTIFIER_MASK}`);
    });

    test("a long device name keeps nothing but its first two characters", () => {
      const masked: string = maskIdentifier(
        RAW_PUSH_DEVICE,
        MaskedIdentifierKind.Handle,
      );

      expect(masked).toBe(`Ad${IDENTIFIER_MASK}`);
      expect(masked).not.toContain("iPhone");
    });
  });

  describe("absent values", () => {
    test.each([
      ["undefined", undefined],
      ["null", null],
      ["empty", ""],
      ["whitespace", "   "],
    ])(
      "%s masks to the bare bullet rather than a blank cell that reads as 'no method'",
      (_label: string, value: string | undefined | null) => {
        expect(maskIdentifier(value, MaskedIdentifierKind.Email)).toBe(
          IDENTIFIER_MASK,
        );
        expect(maskIdentifier(value, MaskedIdentifierKind.Phone)).toBe(
          IDENTIFIER_MASK,
        );
        expect(maskIdentifier(value, MaskedIdentifierKind.Handle)).toBe(
          IDENTIFIER_MASK,
        );
      },
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * (B) Responder resolution.
 *
 * TeamComplianceService was TEAM-SCOPED, which meant the three ways a responder
 * most commonly gets paged - attached directly, reached through a schedule
 * layer, substituted in by an override - were invisible to it. Each of those is
 * a separate test here, and each would have been a silent false green before.
 * ---------------------------------------------------------------------------
 */
describe("responder resolution", () => {
  test("a user attached DIRECTLY to an escalation rule is a responder (team-scoping defect)", async () => {
    attachDirectly(USER_A_ID);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.userId.toString()).toBe(USER_A_ID.toString());
    expect(readiness.reachedVia).toEqual([ResponderSource.Direct]);
  });

  test("a user reached only through a TEAM on an escalation rule is a responder", async () => {
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_B_ID)];

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.userId.toString()).toBe(USER_B_ID.toString());
    expect(readiness.reachedVia).toEqual([ResponderSource.Team]);
  });

  test("a user reached only through a SCHEDULE LAYER is a responder (team-scoping defect)", async () => {
    escalationScheduleFindBy.mockResolvedValue([
      escalationScheduleRow(SCHEDULE_ID),
    ] as never);
    scheduleLayerUserFindBy.mockResolvedValue([
      layerUserRow(USER_C_ID),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.userId.toString()).toBe(USER_C_ID.toString());
    expect(readiness.reachedVia).toEqual([ResponderSource.Schedule]);
  });

  test("a user an OVERRIDE routes pages to is a responder, even attached to nothing else", async () => {
    overrideFindBy.mockResolvedValue([overrideRow(USER_C_ID)] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.userId.toString()).toBe(USER_C_ID.toString());
    expect(readiness.reachedVia).toEqual([ResponderSource.Override]);
  });

  test("a user reached two ways appears ONCE and carries BOTH sources", async () => {
    attachDirectly(USER_A_ID);
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID)];

    const summary: ReadinessSummary = await policySummary();

    expect(summary.users).toHaveLength(1);
    expect(summary.users[0]!.reachedVia).toEqual([
      ResponderSource.Direct,
      ResponderSource.Team,
    ]);
  });

  test("a user reached all four ways carries all four sources in canonical order", async () => {
    attachDirectly(USER_A_ID);
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID)];
    escalationScheduleFindBy.mockResolvedValue([
      escalationScheduleRow(SCHEDULE_ID),
    ] as never);
    scheduleLayerUserFindBy.mockResolvedValue([
      layerUserRow(USER_A_ID),
    ] as never);
    overrideFindBy.mockResolvedValue([overrideRow(USER_A_ID)] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.reachedVia).toEqual([
      ResponderSource.Direct,
      ResponderSource.Team,
      ResponderSource.Schedule,
      ResponderSource.Override,
    ]);
  });

  test("a user attached twice through the same door is still one responder", async () => {
    escalationUserFindBy.mockResolvedValue([
      escalationUserRow(USER_A_ID),
      escalationUserRow(USER_A_ID),
    ] as never);

    const summary: ReadinessSummary = await policySummary();

    expect(summary.users).toHaveLength(1);
    expect(summary.users[0]!.reachedVia).toEqual([ResponderSource.Direct]);
  });

  test("an escalation row with no user, and an override routing to nobody, are ignored rather than crashing", async () => {
    escalationUserFindBy.mockResolvedValue([
      escalationUserRow(undefined),
    ] as never);
    overrideFindBy.mockResolvedValue([overrideRow(undefined)] as never);

    const summary: ReadinessSummary = await policySummary();

    expect(summary.users).toEqual([]);
    expect(summary.readyCount).toBe(0);
    expect(summary.notReachableCount).toBe(0);
  });

  test("every team on the policy is expanded by ONE query, with duplicate team ids collapsed", async () => {
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
      escalationTeamRow(OTHER_TEAM_ID),
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID), teamMemberRow(USER_B_ID)];

    const summary: ReadinessSummary = await policySummary();

    expect(summary.users).toHaveLength(2);

    const memberCalls: Array<FindByCall> = teamMemberFindBy.mock.calls.map(
      (call: Array<unknown>): FindByCall => {
        return call[0] as FindByCall;
      },
    );

    expect(memberCalls).toHaveLength(1);
    expect(includedIds(memberCalls[0]!.query["teamId"])).toEqual([
      TEAM_ID.toString(),
      OTHER_TEAM_ID.toString(),
    ]);
  });

  test("team members are NOT filtered on hasAcceptedInvitation, because the runtime pages them anyway", async () => {
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID)];

    await policySummary();

    const query: Record<string, unknown> = firstCall(teamMemberFindBy).query;

    expect(query["hasAcceptedInvitation"]).toBeUndefined();
    expect(query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
  });

  test("no teams on the policy means the member expansion is never asked for", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();

    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(scheduleLayerUserFindBy).not.toHaveBeenCalled();
  });

  test("the policy scope filters all three escalation reads by policy id", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();

    for (const spy of [
      escalationUserFindBy,
      escalationTeamFindBy,
      escalationScheduleFindBy,
    ]) {
      const query: Record<string, unknown> = firstCall(spy).query;

      expect(query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
      expect(query["onCallDutyPolicyId"]?.toString()).toBe(
        POLICY_ID.toString(),
      );
    }
  });

  test("the project scope drops the policy filter entirely, so a user on ANY policy is included", async () => {
    attachDirectly(USER_A_ID);

    const summary: ReadinessSummary =
      await OnCallReadinessService.getReadinessForProject(PROJECT_ID);

    expect(summary.onCallDutyPolicyId).toBeUndefined();
    expect(summary.projectId.toString()).toBe(PROJECT_ID.toString());

    for (const spy of [
      escalationUserFindBy,
      escalationTeamFindBy,
      escalationScheduleFindBy,
      overrideFindBy,
    ]) {
      expect(firstCall(spy).query["onCallDutyPolicyId"]).toBeUndefined();
    }
  });

  test("overrides are filtered to those that have not ENDED - an expired override pages nobody", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();

    const endsAt: unknown = firstCall(overrideFindBy).query["endsAt"];

    expect(endsAt).toBeInstanceOf(FindOperator);
    expect(
      (endsAt as FindOperator<unknown>).getSql!("override.endsAt"),
    ).toContain(">=");
  });

  test("a GLOBAL override with a null policy id still counts against a specific policy", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();

    const policyFilter: unknown =
      firstCall(overrideFindBy).query["onCallDutyPolicyId"];

    /*
     * equalToOrNull, not equality. Filtering on equality alone would drop every
     * global override, which is the most commonly configured kind - and the
     * substitute they route to is the responder most likely to be silently
     * unreachable.
     */
    expect(policyFilter).toBeInstanceOf(FindOperator);
    expect(
      (policyFilter as FindOperator<unknown>).getSql!(
        "override.onCallDutyPolicyId",
      ),
    ).toContain("IS NULL");
    expect(
      Object.values(
        (policyFilter as FindOperator<unknown>).objectLiteralParameters || {},
      ),
    ).toContain(POLICY_ID.toString());
  });

  test("a responder with no User row is dropped rather than reported as a nameless gap", async () => {
    attachDirectly(USER_A_ID);
    userDirectory = [];

    const summary: ReadinessSummary = await policySummary();

    expect(summary.users).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (C) The status calculation, at every boundary.
 * ---------------------------------------------------------------------------
 */
describe("status", () => {
  beforeEach(() => {
    attachDirectly(USER_A_ID);
  });

  test("zero notification methods is NotReachable, and says so before it says anything else", async () => {
    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.methods).toEqual([]);
    expect(readiness.reasons[0]).toBe(
      "No verified notification method - cannot be paged",
    );
    expect(readiness.reasons[1]).toContain(
      "add and verify a notification method",
    );
  });

  test("methods that exist but are UNVERIFIED are still NotReachable, and are named so the fix is one click", async () => {
    emailFindBy.mockResolvedValue([
      emailMethod({
        userId: USER_A_ID,
        email: RAW_NOTIFICATION_EMAIL,
        isVerified: false,
      }),
    ] as never);
    smsFindBy.mockResolvedValue([
      smsMethod({ userId: USER_A_ID, phone: RAW_SMS_PHONE, isVerified: false }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.reasons[1]).toBe(
      "Added Email, SMS but never verified - unverified methods are never used",
    );
  });

  test("an unverified method is still LISTED, because the UI has to show what to go and verify", async () => {
    emailFindBy.mockResolvedValue([
      emailMethod({
        userId: USER_A_ID,
        email: RAW_NOTIFICATION_EMAIL,
        isVerified: false,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.methods).toHaveLength(1);
    expect(readiness.methods[0]!.isVerified).toBe(false);
  });

  test("NotReachable suppresses the coverage prose but NOT the coverage grid itself", async () => {
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.coverage).toHaveLength(2);
    expect(
      readiness.reasons.some((reason: string): boolean => {
        return reason.includes("No rules for");
      }),
    ).toBe(false);
  });

  test("a WEBHOOK alone is enough to be reachable - it has no verification concept at all", async () => {
    webhookFindBy.mockResolvedValue([
      webhookMethod({ userId: USER_A_ID, name: RAW_WEBHOOK_NAME }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).not.toBe(ReadinessStatus.NotReachable);
    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.methods[0]!.methodType).toBe(ReadinessMethodType.Webhook);
    expect(readiness.methods[0]!.isVerified).toBe(true);
  });

  test("ONE uncovered cell is PartiallyReady - the other three of four cells do not rescue it", async () => {
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
      alert: [alertSeverity(ALERT_SEVERITY_1_ID, "Warning")],
    });
    pushFindBy.mockResolvedValue([
      pushMethod({
        userId: USER_A_ID,
        deviceName: RAW_PUSH_DEVICE,
        isVerified: true,
      }),
    ] as never);
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        alertSeverityId: ALERT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.coverage).toHaveLength(4);
    expect(readiness.status).toBe(ReadinessStatus.PartiallyReady);
    expect(readiness.reasons).toEqual([
      "No rules for Warning alert episodes - pages fall back to Push",
    ]);
  });

  test("every cell covered is Ready, with nothing left to say", async () => {
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
      alert: [alertSeverity(ALERT_SEVERITY_1_ID, "Warning")],
    });
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        alertSeverityId: ALERT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        alertSeverityId: ALERT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.reasons).toEqual([]);
  });

  test("every cell MUTED is Ready too - deliberate silence is not a gap", async () => {
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: true,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: true,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.reasons).toEqual([]);
  });

  test("a mix of covered and muted cells is Ready", async () => {
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: true,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.Ready);
  });

  test("NotReachable wins over an uncovered cell - nothing can reach them, so coverage is moot", async () => {
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });
    telegramFindBy.mockResolvedValue([
      telegramMethod({
        userId: USER_A_ID,
        handle: RAW_TELEGRAM_HANDLE,
        isVerified: false,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
  });

  /*
   * A verified method on a channel the project has switched off is not a way to
   * reach anybody. Status used to be computed from `isVerified` alone, which
   * meant these responders rendered Ready and GREEN while being completely
   * unpageable - the single most dangerous output this service can produce,
   * because the whole point of the table is that a green row can be trusted.
   */
  describe("project channel switches", () => {
    test("verified SMS and Call, both switched off, is NotReachable rather than Ready", async () => {
      projectFindOneById.mockResolvedValue(
        makeProject({
          enableSmsNotifications: false,
          enableCallNotifications: false,
        }) as never,
      );
      smsFindBy.mockResolvedValue([
        smsMethod({
          userId: USER_A_ID,
          phone: RAW_SMS_PHONE,
          isVerified: true,
        }),
      ] as never);
      callFindBy.mockResolvedValue([
        callMethod({
          userId: USER_A_ID,
          phone: RAW_CALL_PHONE,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      expect(readiness.status).toBe(ReadinessStatus.NotReachable);
      expect(readiness.reasons[1]).toBe(
        "Every method they have verified is on SMS, Call, and this project has those channels switched off - that is a project setting, not something this user can fix",
      );
    });

    test("the reason names the channel AND says whose problem it is, because the user cannot fix it", async () => {
      projectFindOneById.mockResolvedValue(
        makeProject({ enableWhatsAppNotifications: false }) as never,
      );
      whatsAppFindBy.mockResolvedValue([
        whatsAppMethod({
          userId: USER_A_ID,
          phone: RAW_WHATSAPP_PHONE,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      /*
       * "Add and verify a notification method" is the WRONG instruction here -
       * they have done that, and doing it again on the same channel changes
       * nothing. The sentence has to send an admin to the project settings.
       */
      expect(readiness.reasons[1]).toContain("WhatsApp");
      expect(readiness.reasons[1]).toContain("project setting");
      expect(
        readiness.reasons.some((reason: string): boolean => {
          return reason.includes("add and verify");
        }),
      ).toBe(false);
    });

    test("the methods are still LISTED - an admin has to see what is stranded", async () => {
      projectFindOneById.mockResolvedValue(
        makeProject({ enableTelegramNotifications: false }) as never,
      );
      telegramFindBy.mockResolvedValue([
        telegramMethod({
          userId: USER_A_ID,
          handle: RAW_TELEGRAM_HANDLE,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      expect(methodTypes(readiness)).toEqual([ReadinessMethodType.Telegram]);
      expect(readiness.methods[0]!.isVerified).toBe(true);
    });

    test("one working channel is enough - a stranded second channel does not make them unreachable", async () => {
      projectFindOneById.mockResolvedValue(
        makeProject({ enableSmsNotifications: false }) as never,
      );
      pushFindBy.mockResolvedValue([
        pushMethod({ userId: USER_A_ID, isVerified: true }),
      ] as never);
      smsFindBy.mockResolvedValue([
        smsMethod({
          userId: USER_A_ID,
          phone: RAW_SMS_PHONE,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      /*
       * And NOTHING is said about the switched-off SMS. Saying it would put a
       * warning sentence on every user in a project that has switched SMS off,
       * attached to people who have nothing wrong with them - which is how a
       * readiness surface teaches admins to stop reading it.
       */
      expect(readiness.status).toBe(ReadinessStatus.Ready);
      expect(readiness.reasons).toEqual([]);
    });

    test.each([
      [
        "Push",
        (): void => {
          pushFindBy.mockResolvedValue([
            pushMethod({ userId: USER_A_ID, isVerified: true }),
          ] as never);
        },
      ],
      [
        "Email",
        (): void => {
          emailFindBy.mockResolvedValue([
            emailMethod({
              userId: USER_A_ID,
              email: RAW_NOTIFICATION_EMAIL,
              isVerified: true,
            }),
          ] as never);
        },
      ],
      [
        "Webhook",
        (): void => {
          webhookFindBy.mockResolvedValue([
            webhookMethod({ userId: USER_A_ID, name: RAW_WEBHOOK_NAME }),
          ] as never);
        },
      ],
    ])(
      "%s has no project switch to be gated by, so every switch being off leaves it usable",
      async (_label: string, give: () => void) => {
        projectFindOneById.mockResolvedValue(
          makeProject({
            enableSmsNotifications: false,
            enableCallNotifications: false,
            enableWhatsAppNotifications: false,
            enableTelegramNotifications: false,
          }) as never,
        );
        give();

        expect((await onlyUser()).status).toBe(ReadinessStatus.Ready);
      },
    );
  });

  test("a project with no severities configured has no cells, so a reachable responder is Ready", async () => {
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.coverage).toEqual([]);
    expect(readiness.status).toBe(ReadinessStatus.Ready);
  });

  test("the user's display name falls back to their login email, then to a placeholder", async () => {
    const nameless: User = new User();
    nameless.id = USER_A_ID;
    nameless.email = new Email(USER_A_LOGIN_EMAIL);

    const anonymous: User = new User();
    anonymous.id = USER_B_ID;

    userDirectory = [nameless, anonymous];
    attachDirectly(USER_A_ID, USER_B_ID);

    const summary: ReadinessSummary = await policySummary();
    const names: Array<string> = summary.users.map(
      (user: UserReadiness): string => {
        return user.userName;
      },
    );

    expect(names).toContain(USER_A_LOGIN_EMAIL);
    expect(names).toContain("Unknown User");
  });
});

/*
 * ---------------------------------------------------------------------------
 * (D) Summary roll-up: counts and ordering.
 * ---------------------------------------------------------------------------
 */
describe("summary roll-up", () => {
  beforeEach(() => {
    attachDirectly(USER_A_ID, USER_B_ID, USER_C_ID);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    /*
     * One responder in each of the three states, so the counts and the sort can
     * be read off the same fixture:
     *   Ada       - verified push, every cell covered  -> Ready
     *   Grace     - verified push, nothing covered     -> PartiallyReady
     *   Katherine - nothing at all                     -> NotReachable
     */
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
      pushMethod({ userId: USER_B_ID, isVerified: true }),
    ] as never);
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);
  });

  test("each status is counted exactly once, and the counts sum to the user list", async () => {
    const summary: ReadinessSummary = await policySummary();

    expect(summary.readyCount).toBe(1);
    expect(summary.partiallyReadyCount).toBe(1);
    expect(summary.notReachableCount).toBe(1);
    expect(
      summary.readyCount +
        summary.partiallyReadyCount +
        summary.notReachableCount,
    ).toBe(summary.users.length);
  });

  test("the most broken responder sorts first - the table is read by somebody looking for a problem", async () => {
    const summary: ReadinessSummary = await policySummary();

    expect(
      summary.users.map((user: UserReadiness): ReadinessStatus => {
        return user.status;
      }),
    ).toEqual([
      ReadinessStatus.NotReachable,
      ReadinessStatus.PartiallyReady,
      ReadinessStatus.Ready,
    ]);
  });

  test("responders of equal status sort by name, so the list is stable between renders", async () => {
    pushFindBy.mockResolvedValue([] as never);

    const summary: ReadinessSummary = await policySummary();

    expect(
      summary.users.map((user: UserReadiness): string => {
        return user.userName;
      }),
    ).toEqual(["Ada Lovelace", "Grace Hopper", "Katherine Johnson"]);
  });

  test("the summary echoes back the scope it was asked about", async () => {
    const summary: ReadinessSummary = await policySummary();

    expect(summary.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(summary.onCallDutyPolicyId?.toString()).toBe(POLICY_ID.toString());
  });
});

/*
 * ---------------------------------------------------------------------------
 * (E) Coverage: the right severity model for the right rule type.
 *
 * Incident and incident-episode rules are scoped by IncidentSeverity; alert and
 * alert-episode by AlertSeverity. Crossing them is not a cosmetic mistake - it
 * produces a cell keyed on an id that the paging path will never present, so
 * the cell can NEVER be satisfied, and a rule written against the wrong column
 * silently covers nothing. That is the exact shape of Gap G.
 * ---------------------------------------------------------------------------
 */
describe("coverage", () => {
  beforeEach(() => {
    attachDirectly(USER_A_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    setSeverities({
      incident: [
        incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1"),
        incidentSeverity(INCIDENT_SEVERITY_2_ID, "Sev2"),
      ],
      alert: [
        alertSeverity(ALERT_SEVERITY_1_ID, "Warning"),
        alertSeverity(ALERT_SEVERITY_2_ID, "Critical"),
      ],
    });
  });

  test("the grid is the four PAGING rule types crossed with their own severity list", async () => {
    const readiness: UserReadiness = await onlyUser();

    expect(readiness.coverage).toHaveLength(8);

    const byRuleType: Map<NotificationRuleType, Array<string>> = new Map<
      NotificationRuleType,
      Array<string>
    >();

    for (const cell of readiness.coverage) {
      const existing: Array<string> = byRuleType.get(cell.ruleType) || [];
      existing.push(cell.severityId?.toString() || "");
      byRuleType.set(cell.ruleType, existing);
    }

    expect(
      byRuleType.get(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toEqual([
      INCIDENT_SEVERITY_1_ID.toString(),
      INCIDENT_SEVERITY_2_ID.toString(),
    ]);
    expect(
      byRuleType.get(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toEqual([
      INCIDENT_SEVERITY_1_ID.toString(),
      INCIDENT_SEVERITY_2_ID.toString(),
    ]);
    expect(byRuleType.get(NotificationRuleType.ON_CALL_EXECUTED_ALERT)).toEqual(
      [ALERT_SEVERITY_1_ID.toString(), ALERT_SEVERITY_2_ID.toString()],
    );
    expect(
      byRuleType.get(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toEqual([ALERT_SEVERITY_1_ID.toString(), ALERT_SEVERITY_2_ID.toString()]);
  });

  test("no alert cell is ever keyed on an incident severity, and vice versa", async () => {
    const readiness: UserReadiness = await onlyUser();

    const incidentIds: Set<string> = new Set<string>([
      INCIDENT_SEVERITY_1_ID.toString(),
      INCIDENT_SEVERITY_2_ID.toString(),
    ]);
    const alertIds: Set<string> = new Set<string>([
      ALERT_SEVERITY_1_ID.toString(),
      ALERT_SEVERITY_2_ID.toString(),
    ]);

    for (const cell of readiness.coverage) {
      const isIncidentRule: boolean =
        cell.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT ||
        cell.ruleType ===
          NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE;
      const id: string = cell.severityId?.toString() || "";

      expect(isIncidentRule ? incidentIds.has(id) : alertIds.has(id)).toBe(
        true,
      );
    }
  });

  test("cells carry the severity NAME, so a reason sentence can say Sev2 rather than a uuid", async () => {
    const readiness: UserReadiness = await onlyUser();

    expect(
      cellFor(
        readiness,
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        ALERT_SEVERITY_2_ID,
      ).severityName,
    ).toBe("Critical");
  });

  test("a rule covers ONLY its own (ruleType, severity) cell", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(
      cellFor(
        readiness,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        INCIDENT_SEVERITY_1_ID,
      ).hasRule,
    ).toBe(true);

    /*
     * The episode cell for the SAME severity is a different cell. Gap F was
     * exactly this: episode pages fired against rules that only ever existed
     * for the non-episode rule type.
     */
    expect(
      cellFor(
        readiness,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        INCIDENT_SEVERITY_1_ID,
      ).hasRule,
    ).toBe(false);
    expect(
      cellFor(
        readiness,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        INCIDENT_SEVERITY_2_ID,
      ).hasRule,
    ).toBe(false);
  });

  test("a handoff rule covers NOTHING, however its severity is set (severity-only matching defect)", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        alertSeverityId: ALERT_SEVERITY_1_ID,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(
      readiness.coverage.every((cell: ReadinessCoverageCell): boolean => {
        return !cell.hasRule && !cell.isOptOut;
      }),
    ).toBe(true);
    expect(readiness.status).toBe(ReadinessStatus.PartiallyReady);
  });

  test("an ALERT rule carrying only an incidentSeverityId covers nothing - it matches no page at runtime either", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(
      readiness.coverage.some((cell: ReadinessCoverageCell): boolean => {
        return cell.hasRule;
      }),
    ).toBe(false);
  });

  test("an INCIDENT rule whose incidentSeverityId is an ALERT severity id matches no cell", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: ALERT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(
      readiness.coverage.some((cell: ReadinessCoverageCell): boolean => {
        return cell.hasRule;
      }),
    ).toBe(false);
  });

  test("a severity-scoped rule with a NULL severity is not coverage - it is the Gap G corpse", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(
      readiness.coverage.some((cell: ReadinessCoverageCell): boolean => {
        return cell.hasRule;
      }),
    ).toBe(false);
    expect(readiness.status).toBe(ReadinessStatus.PartiallyReady);
  });

  test("one user's rules never satisfy another user's cells", async () => {
    attachDirectly(USER_A_ID, USER_B_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
      pushMethod({ userId: USER_B_ID, isVerified: true }),
    ] as never);
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);

    const summary: ReadinessSummary = await policySummary();
    const grace: UserReadiness = summary.users.find(
      (user: UserReadiness): boolean => {
        return user.userId.toString() === USER_B_ID.toString();
      },
    )!;

    expect(
      cellFor(
        grace,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        INCIDENT_SEVERITY_1_ID,
      ).hasRule,
    ).toBe(false);
  });

  test("a severity with no name still produces a usable cell rather than being dropped", async () => {
    const unnamed: IncidentSeverity = new IncidentSeverity();
    unnamed.id = INCIDENT_SEVERITY_1_ID;

    setSeverities({ incident: [unnamed] });

    const readiness: UserReadiness = await onlyUser();

    expect(
      cellFor(
        readiness,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        INCIDENT_SEVERITY_1_ID,
      ).severityName,
    ).toBe("Unnamed Severity");
  });
});

/*
 * ---------------------------------------------------------------------------
 * (F) Opt-out: the nullable column that ruins everything if you test it for
 * `false`.
 * ---------------------------------------------------------------------------
 */
describe("opt-out", () => {
  beforeEach(() => {
    attachDirectly(USER_A_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });
  });

  test("a rule with isOptOut NULL is a REAL rule and counts as coverage", async () => {
    /*
     * THE test this file exists for as much as any other. isOptOut is nullable
     * and was added long after these rows started existing, so it is NULL on
     * every rule in every pre-existing install. The naive `isOptOut === false`
     * split would classify all of them as neither rules nor opt-outs and report
     * a fully-configured project as entirely unready - a red table that teaches
     * admins to ignore red tables.
     */
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();
    const cell: ReadinessCoverageCell = cellFor(
      readiness,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      INCIDENT_SEVERITY_1_ID,
    );

    expect(cell.hasRule).toBe(true);
    expect(cell.isOptOut).toBe(false);
  });

  test("a rule with isOptOut explicitly false is also coverage", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: false,
      }),
    ] as never);

    expect(
      cellFor(
        await onlyUser(),
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        INCIDENT_SEVERITY_1_ID,
      ).hasRule,
    ).toBe(true);
  });

  test("an opt-out row is surfaced as isOptOut and is NOT counted as a rule", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: true,
      }),
    ] as never);

    const cell: ReadinessCoverageCell = cellFor(
      await onlyUser(),
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      INCIDENT_SEVERITY_1_ID,
    );

    expect(cell.isOptOut).toBe(true);
    expect(cell.hasRule).toBe(false);
  });

  test("an opt-out cell is not a gap, so it never appears in a reason sentence", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: true,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.reasons).toEqual([
      "No rules for Sev1 incident episodes - pages fall back to Push",
    ]);
  });

  test("a cell with BOTH an opt-out row and a real rule reports both, and is not a gap", async () => {
    notificationRuleFindBy.mockResolvedValue([
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        isOptOut: true,
      }),
      notificationRule({
        userId: USER_A_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_1_ID,
      }),
    ] as never);

    const cell: ReadinessCoverageCell = cellFor(
      await onlyUser(),
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      INCIDENT_SEVERITY_1_ID,
    );

    expect(cell.hasRule).toBe(true);
    expect(cell.isOptOut).toBe(true);
  });

  test("opt-out rows are read alongside real rules, never filtered out in SQL", async () => {
    await policySummary();

    const call: FindByCall = firstCall(notificationRuleFindBy);

    /*
     * If the query filtered on isOptOut, the "muted" and "nothing configured"
     * cases would collapse into one - and telling them apart is the entire
     * reason the column exists.
     */
    expect(call.query["isOptOut"]).toBeUndefined();
    expect(call.select?.["isOptOut"]).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (G) All seven channels.
 *
 * TeamComplianceService counted call/SMS/email/push only, so a responder whose
 * only method was Telegram, WhatsApp or Webhook was reported non-compliant
 * while the runtime paged them perfectly happily. A false alarm teaches admins
 * to ignore the table, which is worse than no table.
 * ---------------------------------------------------------------------------
 */
describe("notification channels", () => {
  beforeEach(() => {
    attachDirectly(USER_A_ID);
  });

  test("a verified TELEGRAM handle alone makes a responder reachable (four-channel defect)", async () => {
    telegramFindBy.mockResolvedValue([
      telegramMethod({
        userId: USER_A_ID,
        handle: RAW_TELEGRAM_HANDLE,
        isVerified: true,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).not.toBe(ReadinessStatus.NotReachable);
    expect(methodTypes(readiness)).toEqual([ReadinessMethodType.Telegram]);
  });

  test("a verified WHATSAPP number alone makes a responder reachable (four-channel defect)", async () => {
    whatsAppFindBy.mockResolvedValue([
      whatsAppMethod({
        userId: USER_A_ID,
        phone: RAW_WHATSAPP_PHONE,
        isVerified: true,
      }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(readiness.status).not.toBe(ReadinessStatus.NotReachable);
    expect(methodTypes(readiness)).toEqual([ReadinessMethodType.WhatsApp]);
  });

  test("a WEBHOOK alone makes a responder reachable (four-channel defect)", async () => {
    webhookFindBy.mockResolvedValue([
      webhookMethod({ userId: USER_A_ID, name: RAW_WEBHOOK_NAME }),
    ] as never);

    expect((await onlyUser()).status).not.toBe(ReadinessStatus.NotReachable);
  });

  test("all seven channels are read, and listed in fallback-attempt order", async () => {
    pushFindBy.mockResolvedValue([
      pushMethod({
        userId: USER_A_ID,
        deviceName: RAW_PUSH_DEVICE,
        isVerified: true,
      }),
    ] as never);
    emailFindBy.mockResolvedValue([
      emailMethod({
        userId: USER_A_ID,
        email: RAW_NOTIFICATION_EMAIL,
        isVerified: true,
      }),
    ] as never);
    smsFindBy.mockResolvedValue([
      smsMethod({ userId: USER_A_ID, phone: RAW_SMS_PHONE, isVerified: true }),
    ] as never);
    callFindBy.mockResolvedValue([
      callMethod({
        userId: USER_A_ID,
        phone: RAW_CALL_PHONE,
        isVerified: true,
      }),
    ] as never);
    whatsAppFindBy.mockResolvedValue([
      whatsAppMethod({
        userId: USER_A_ID,
        phone: RAW_WHATSAPP_PHONE,
        isVerified: true,
      }),
    ] as never);
    telegramFindBy.mockResolvedValue([
      telegramMethod({
        userId: USER_A_ID,
        handle: RAW_TELEGRAM_HANDLE,
        isVerified: true,
      }),
    ] as never);
    webhookFindBy.mockResolvedValue([
      webhookMethod({ userId: USER_A_ID, name: RAW_WEBHOOK_NAME }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();

    /*
     * Display order IS fallback order, deliberately: the first row an admin
     * reads is the channel a fallback page would actually arrive on.
     */
    expect(methodTypes(readiness)).toEqual([
      ReadinessMethodType.Push,
      ReadinessMethodType.Email,
      ReadinessMethodType.SMS,
      ReadinessMethodType.Call,
      ReadinessMethodType.WhatsApp,
      ReadinessMethodType.Telegram,
      ReadinessMethodType.Webhook,
    ]);
  });

  test("methods belonging to another responder are not attributed to this one", async () => {
    attachDirectly(USER_A_ID, USER_B_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_B_ID, isVerified: true }),
    ] as never);

    const summary: ReadinessSummary = await policySummary();
    const ada: UserReadiness = summary.users.find(
      (user: UserReadiness): boolean => {
        return user.userId.toString() === USER_A_ID.toString();
      },
    )!;

    expect(ada.methods).toEqual([]);
    expect(ada.status).toBe(ReadinessStatus.NotReachable);
  });

  describe("fallback prose", () => {
    beforeEach(() => {
      setSeverities({
        incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
      });
    });

    test("both zero-cost channels are named when the responder has both", async () => {
      pushFindBy.mockResolvedValue([
        pushMethod({ userId: USER_A_ID, isVerified: true }),
      ] as never);
      emailFindBy.mockResolvedValue([
        emailMethod({
          userId: USER_A_ID,
          email: RAW_NOTIFICATION_EMAIL,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      expect(readiness.reasons[0]).toBe(
        "No rules for Sev1 incidents - pages fall back to Push, Email",
      );
    });

    test("a paid channel is named only while the project still has it switched on", async () => {
      smsFindBy.mockResolvedValue([
        smsMethod({
          userId: USER_A_ID,
          phone: RAW_SMS_PHONE,
          isVerified: true,
        }),
      ] as never);

      expect((await onlyUser()).reasons[0]).toBe(
        "No rules for Sev1 incidents - pages fall back to SMS",
      );
    });

    test("a responder whose only channels the project has switched off is NotReachable, not amber", async () => {
      projectFindOneById.mockResolvedValue(
        makeProject({ enableTelegramNotifications: false }) as never,
      );
      telegramFindBy.mockResolvedValue([
        telegramMethod({
          userId: USER_A_ID,
          handle: RAW_TELEGRAM_HANDLE,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      /*
       * Nothing can reach this person. Their method is verified, so a status
       * computed from verification alone would call them Ready - and Ready is a
       * green chip next to a responder no page will ever arrive at. Verified is
       * necessary and not sufficient; usable is verified AND on a channel the
       * project actually sends on.
       */
      expect(readiness.status).toBe(ReadinessStatus.NotReachable);
      expect(readiness.reasons[0]).toBe(
        "No usable notification method - cannot be paged",
      );
      expect(readiness.reasons[1]).toBe(
        "Every method they have verified is on Telegram, and this project has that channel switched off - that is a project setting, not something this user can fix",
      );
    });

    test("with the fallback disabled, an uncovered cell means the page is DROPPED, not delayed", async () => {
      projectFindOneById.mockResolvedValue(
        makeProject({ disableOnCallNotificationFallback: true }) as never,
      );
      pushFindBy.mockResolvedValue([
        pushMethod({ userId: USER_A_ID, isVerified: true }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      expect(readiness.reasons[0]).toBe(
        "No rules for Sev1 incidents - pages are dropped because on-call fallback is disabled for this project",
      );
      expect(
        readiness.reasons.some((reason: string): boolean => {
          return reason.includes("switched off");
        }),
      ).toBe(false);
    });

    test("a missing project row is treated as every paid channel off, never as every channel on", async () => {
      projectFindOneById.mockResolvedValue(null as never);
      smsFindBy.mockResolvedValue([
        smsMethod({
          userId: USER_A_ID,
          phone: RAW_SMS_PHONE,
          isVerified: true,
        }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      /*
       * A project row we could not read must never certify anyone as reachable
       * on a paid channel. Defaulting the switches to "on" would turn a failed
       * read into a green chip, which is the one direction this service is not
       * allowed to be wrong in.
       */
      expect(readiness.status).toBe(ReadinessStatus.NotReachable);
      expect(readiness.reasons[1]).toContain("switched off");
    });

    test("one sentence per rule type, with its missing severities listed rather than one line per cell", async () => {
      setSeverities({
        incident: [
          incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1"),
          incidentSeverity(INCIDENT_SEVERITY_2_ID, "Sev2"),
        ],
        alert: [alertSeverity(ALERT_SEVERITY_1_ID, "Warning")],
      });
      pushFindBy.mockResolvedValue([
        pushMethod({ userId: USER_A_ID, isVerified: true }),
      ] as never);

      const readiness: UserReadiness = await onlyUser();

      expect(readiness.coverage).toHaveLength(6);
      expect(readiness.reasons).toEqual([
        "No rules for Sev1, Sev2 incidents - pages fall back to Push",
        "No rules for Sev1, Sev2 incident episodes - pages fall back to Push",
        "No rules for Warning alerts - pages fall back to Push",
        "No rules for Warning alert episodes - pages fall back to Push",
      ]);
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * (H) Masking, end to end.
 *
 * The assertions here run over the SERIALIZED summary rather than the fields a
 * test author remembered to check, because a leak that arrives through a field
 * nobody listed is exactly the leak that ships.
 * ---------------------------------------------------------------------------
 */
describe("identifier exposure", () => {
  beforeEach(() => {
    attachDirectly(USER_A_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({
        userId: USER_A_ID,
        deviceName: RAW_PUSH_DEVICE,
        isVerified: true,
      }),
    ] as never);
    emailFindBy.mockResolvedValue([
      emailMethod({
        userId: USER_A_ID,
        email: RAW_NOTIFICATION_EMAIL,
        isVerified: true,
      }),
    ] as never);
    smsFindBy.mockResolvedValue([
      smsMethod({ userId: USER_A_ID, phone: RAW_SMS_PHONE, isVerified: true }),
    ] as never);
    callFindBy.mockResolvedValue([
      callMethod({
        userId: USER_A_ID,
        phone: RAW_CALL_PHONE,
        isVerified: true,
      }),
    ] as never);
    whatsAppFindBy.mockResolvedValue([
      whatsAppMethod({
        userId: USER_A_ID,
        phone: RAW_WHATSAPP_PHONE,
        isVerified: true,
      }),
    ] as never);
    telegramFindBy.mockResolvedValue([
      telegramMethod({
        userId: USER_A_ID,
        handle: RAW_TELEGRAM_HANDLE,
        isVerified: true,
      }),
    ] as never);
    webhookFindBy.mockResolvedValue([
      webhookMethod({
        userId: USER_A_ID,
        name: RAW_WEBHOOK_NAME,
        webhookUrl: RAW_WEBHOOK_URL,
      }),
    ] as never);
  });

  test("every emitted identifier is masked, one shape at a time", async () => {
    const readiness: UserReadiness = await onlyUser();
    const masked: Map<string, string> = new Map<string, string>(
      readiness.methods.map((method: ReadinessMethod): [string, string] => {
        return [method.methodType, method.maskedIdentifier];
      }),
    );

    expect(masked.get(ReadinessMethodType.Push)).toBe(`Ad${IDENTIFIER_MASK}`);
    expect(masked.get(ReadinessMethodType.Email)).toBe(
      `a${IDENTIFIER_MASK}@analytical-engine.example`,
    );
    expect(masked.get(ReadinessMethodType.SMS)).toBe(
      `+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`,
    );
    expect(masked.get(ReadinessMethodType.Call)).toBe(
      `+44 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 8750`,
    );
    /*
     * "+6", not "+61" - see the heuristic test above. An eleven-digit
     * Australian number splits one digit early, which hides more than it
     * promises rather than less.
     */
    expect(masked.get(ReadinessMethodType.WhatsApp)).toBe(
      `+6 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4000`,
    );
    expect(masked.get(ReadinessMethodType.Telegram)).toBe(
      `@ad${IDENTIFIER_MASK}`,
    );
    expect(masked.get(ReadinessMethodType.Webhook)).toBe(
      `Pa${IDENTIFIER_MASK}`,
    );
  });

  test("NO raw identifier survives anywhere in the serialized summary", async () => {
    const summary: ReadinessSummary = await policySummary();
    const serialized: string = JSON.stringify(summary);

    /*
     * Whole values first, then the "revealing middle" of each - the part that
     * no legitimate mask can keep - so a partial leak through some future field
     * cannot pass by having merely reordered the string.
     */
    for (const raw of [
      RAW_NOTIFICATION_EMAIL,
      RAW_SMS_PHONE,
      RAW_CALL_PHONE,
      RAW_WHATSAPP_PHONE,
      RAW_TELEGRAM_HANDLE,
      RAW_WEBHOOK_NAME,
      RAW_WEBHOOK_URL,
      RAW_PUSH_DEVICE,
    ]) {
      expect(serialized).not.toContain(raw);
    }

    for (const fragment of [
      "ada.lovelace",
      "4155554",
      "2071838",
      "6129374",
      "night_pager",
      "Incident Bridge",
      "SUPERSECRETTOKEN",
      "iPhone",
    ]) {
      expect(serialized).not.toContain(fragment);
    }
  });

  test("the LOGIN email is deliberately NOT masked - it is already admin-readable everywhere else", async () => {
    const summary: ReadinessSummary = await policySummary();

    expect(summary.users[0]!.userEmail).toBe(USER_A_LOGIN_EMAIL);
    expect(JSON.stringify(summary)).toContain(USER_A_LOGIN_EMAIL);
  });

  test("the webhook read never asks for the bearer url", async () => {
    await policySummary();

    const select: Record<string, unknown> = firstCall(webhookFindBy).select!;

    /*
     * UserWebhook.webhookUrl is a bearer credential - anyone holding a
     * Slack/Discord/Teams hook url can post as the integration - so it must
     * never leave the server on this path. Asserting on the exact select rather
     * than on absence alone means a widened select is a failure even if the new
     * column is not itself the url.
     */
    expect(select).toEqual({ _id: true, userId: true, name: true });
    expect(Object.keys(select)).not.toContain("webhookUrl");
    expect(Object.keys(select)).not.toContain("url");
    expect(Object.keys(select)).not.toContain("secret");
  });

  test("the telegram read never asks for the chat id, which is the addressable target", async () => {
    await policySummary();

    const select: Record<string, unknown> = firstCall(telegramFindBy).select!;

    expect(Object.keys(select)).not.toContain("telegramChatId");
    expect(select["telegramUserHandle"]).toBe(true);
  });

  test("a method with no identifier at all still reports the bare mask, not an empty cell", async () => {
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);

    const readiness: UserReadiness = await onlyUser();
    const push: ReadinessMethod = readiness.methods.find(
      (method: ReadinessMethod): boolean => {
        return method.methodType === ReadinessMethodType.Push;
      },
    )!;

    expect(push.maskedIdentifier).toBe(IDENTIFIER_MASK);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (I) Batching and paging - the N+1 and truncation regression guards.
 * ---------------------------------------------------------------------------
 */
describe("batching and paging", () => {
  function manyUsers(count: number): Array<ObjectID> {
    const ids: Array<ObjectID> = [];

    for (let index: number = 0; index < count; index++) {
      ids.push(
        new ObjectID(
          `c0ffee00-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      );
    }

    return ids;
  }

  test("the query count does not grow with the number of responders OR severities", async () => {
    attachDirectly(USER_A_ID, USER_B_ID);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
      alert: [alertSeverity(ALERT_SEVERITY_1_ID, "Warning")],
    });

    const small: ReadinessSummary = await policySummary();
    const smallQueryCount: number = totalQueryCount();

    expect(small.users).toHaveLength(2);

    jest.clearAllMocks();
    OnCallReadinessService.clearCache();

    const ids: Array<ObjectID> = manyUsers(12);
    userDirectory = ids.map((id: ObjectID, index: number): User => {
      return makeUser(
        id,
        `Responder ${index}`,
        `responder${index}@corp.example.com`,
      );
    });
    attachDirectly(...ids);
    setSeverities({
      incident: [
        incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1"),
        incidentSeverity(INCIDENT_SEVERITY_2_ID, "Sev2"),
        incidentSeverity(
          new ObjectID("d0d0d0d0-0000-4000-8000-000000000001"),
          "Sev3",
        ),
        incidentSeverity(
          new ObjectID("d0d0d0d0-0000-4000-8000-000000000002"),
          "Sev4",
        ),
      ],
      alert: [
        alertSeverity(ALERT_SEVERITY_1_ID, "Warning"),
        alertSeverity(ALERT_SEVERITY_2_ID, "Critical"),
        alertSeverity(
          new ObjectID("e0e0e0e0-0000-4000-8000-000000000001"),
          "Info",
        ),
      ],
    });

    const large: ReadinessSummary = await policySummary();

    expect(large.users).toHaveLength(12);
    expect(large.users[0]!.coverage).toHaveLength(14);

    /*
     * Six times the responders and seven times the severities, and not one
     * extra round trip. TeamComplianceService ran a findBy per severity per
     * user, which is the shape this asserts can never come back.
     */
    expect(totalQueryCount()).toBe(smallQueryCount);
  });

  test("no service is asked anything more than once for a single summary", async () => {
    attachDirectly(USER_A_ID, USER_B_ID, USER_C_ID);
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
      escalationTeamRow(OTHER_TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID), teamMemberRow(USER_B_ID)];
    escalationScheduleFindBy.mockResolvedValue([
      escalationScheduleRow(SCHEDULE_ID),
    ] as never);
    scheduleLayerUserFindBy.mockResolvedValue([
      layerUserRow(USER_C_ID),
    ] as never);
    setSeverities({
      incident: [
        incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1"),
        incidentSeverity(INCIDENT_SEVERITY_2_ID, "Sev2"),
      ],
      alert: [alertSeverity(ALERT_SEVERITY_1_ID, "Warning")],
    });

    await policySummary();

    for (const spy of everySpy()) {
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    }
  });

  test("the per-user reads are ONE query each over the whole responder set", async () => {
    const ids: Array<ObjectID> = manyUsers(5);
    userDirectory = ids.map((id: ObjectID, index: number): User => {
      return makeUser(
        id,
        `Responder ${index}`,
        `responder${index}@corp.example.com`,
      );
    });
    attachDirectly(...ids);

    await policySummary();

    const expected: Array<string> = ids.map((id: ObjectID): string => {
      return id.toString();
    });

    for (const spy of [
      userFindBy,
      pushFindBy,
      emailFindBy,
      smsFindBy,
      callFindBy,
      whatsAppFindBy,
      telegramFindBy,
      webhookFindBy,
      notificationRuleFindBy,
    ]) {
      expect(spy).toHaveBeenCalledTimes(1);
    }

    expect(includedIds(firstCall(userFindBy).query["_id"])).toEqual(expected);

    for (const spy of [
      pushFindBy,
      emailFindBy,
      smsFindBy,
      callFindBy,
      whatsAppFindBy,
      telegramFindBy,
      webhookFindBy,
      notificationRuleFindBy,
    ]) {
      expect(includedIds(firstCall(spy).query["userId"])).toEqual(expected);
    }
  });

  test("every read asks for a full page at a time, never a bare hundred", async () => {
    attachDirectly(USER_A_ID);
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID, TEAM_ID)];
    escalationScheduleFindBy.mockResolvedValue([
      escalationScheduleRow(SCHEDULE_ID),
    ] as never);
    scheduleLayerUserFindBy.mockResolvedValue([
      layerUserRow(USER_A_ID, SCHEDULE_ID),
    ] as never);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
      alert: [alertSeverity(ALERT_SEVERITY_1_ID, "Warning")],
    });

    await policySummary();

    const calls: Array<FindByCall> = everyFindByCall();

    // A guard that asserts over an empty list guards nothing.
    expect(calls.length).toBeGreaterThanOrEqual(15);

    for (const call of calls) {
      /*
       * LIMIT_PER_PROJECT is now a PAGE SIZE rather than a cap: every one of
       * these reads keeps going until a short page comes back (see the paging
       * tests below). The assertion stays because the page size still has to be
       * the shared constant rather than a literal, and because a `limit: 100`
       * reappearing anywhere would be the original truncation defect returning.
       */
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
      expect(call.limit).not.toBe(100);
      expect(call.skip).toBe(0);
      expect(call.props?.isRoot).toBe(true);
    }

    /*
     * And the constant is the shared one rather than a literal that happens to
     * agree with it today.
     */
    expect(LIMIT_PER_PROJECT).toBe(10000);
  });

  test("severities are read in display order so the coverage grid matches the severity screen", async () => {
    attachDirectly(USER_A_ID);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    await policySummary();

    /*
     * Both severity lists are read ascending by `order`, which is the same
     * order the severity settings screen shows. The coverage grid is a table an
     * admin fixes cell by cell, so its columns have to line up with the screen
     * they go to afterwards - a grid sorted by uuid would be unusable without
     * being visibly wrong.
     *
     * `_id` comes after it as a tiebreak rather than instead of it: two
     * severities with the same `order` would otherwise be free to swap places
     * between pages, and a read that pages needs a TOTAL order or it can return
     * one row twice and skip another.
     */
    for (const spy of [incidentSeverityFindBy, alertSeverityFindBy]) {
      const call: FindByCall = firstCall(spy);

      expect(call.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
      expect(call.sort).toEqual({
        order: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      });
    }
  });

  test("EVERY read is sorted with _id last, because OFFSET paging over an unstable order loses rows", async () => {
    attachDirectly(USER_A_ID);
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [teamMemberRow(USER_A_ID, TEAM_ID)];
    escalationScheduleFindBy.mockResolvedValue([
      escalationScheduleRow(SCHEDULE_ID),
    ] as never);
    scheduleLayerUserFindBy.mockResolvedValue([
      layerUserRow(USER_A_ID, SCHEDULE_ID),
    ] as never);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    await policySummary();

    const calls: Array<FindByCall> = everyFindByCall();

    expect(calls.length).toBeGreaterThanOrEqual(15);

    for (const call of calls) {
      /*
       * The database layer's own default is `createdAt DESC`, which is NOT
       * unique - a migration that wrote a project's default notification rules
       * in one transaction gives thousands of rows the same createdAt, and
       * paging through them by OFFSET would then be free to return one row on
       * two pages and another on none. Every read here ends its sort with the
       * primary key for exactly that reason.
       */
      const sortKeys: Array<string> = Object.keys(call.sort || {});

      expect(sortKeys[sortKeys.length - 1]).toBe("_id");
      expect(call.sort?.["_id"]).toBe(SortOrder.Ascending);
    }
  });

  test("every method read is scoped to the project as well as the user", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();

    for (const spy of [
      pushFindBy,
      emailFindBy,
      smsFindBy,
      callFindBy,
      whatsAppFindBy,
      telegramFindBy,
      webhookFindBy,
      notificationRuleFindBy,
    ]) {
      expect(firstCall(spy).query["projectId"]?.toString()).toBe(
        PROJECT_ID.toString(),
      );
    }
  });

  /*
   * -------------------------------------------------------------------------
   * Paging, which is the whole of the truncation fix.
   *
   * A single capped read is not a performance choice, it is a correctness one,
   * and it fails in the worst available direction: the rows past the cap are
   * not reported as missing, they are reported as ABSENT. A responder dropped
   * that way appears in no count, no list and no "needs attention" section,
   * which is byte-for-byte identical to a responder who is fine.
   *
   * These tests are built around a genuinely full page - LIMIT_PER_PROJECT rows
   * back from one call - because that is the only signal a pager has that there
   * might be more, and everything downstream hangs off it.
   * -------------------------------------------------------------------------
   */
  function fullPageOfDirectResponders(
    userId: ObjectID,
  ): Array<OnCallDutyPolicyEscalationRuleUser> {
    const rows: Array<OnCallDutyPolicyEscalationRuleUser> = [];

    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      rows.push(escalationUserRow(userId));
    }

    return rows;
  }

  test("a responder who lands on the SECOND page is still a responder", async () => {
    escalationUserFindBy
      .mockResolvedValueOnce(fullPageOfDirectResponders(USER_A_ID) as never)
      .mockResolvedValueOnce([escalationUserRow(USER_B_ID)] as never);

    const summary: ReadinessSummary = await policySummary();

    expect(escalationUserFindBy).toHaveBeenCalledTimes(2);
    expect(callAt(escalationUserFindBy, 0).skip).toBe(0);
    expect(callAt(escalationUserFindBy, 1).skip).toBe(LIMIT_PER_PROJECT);

    /*
     * Grace is the responder the old single capped read lost. She has no
     * notification method at all, so she is exactly the person the table exists
     * to surface - and the version of this service that stopped at one page
     * would have counted a project containing her as entirely healthy.
     */
    expect(
      summary.users.map((user: UserReadiness): string => {
        return user.userId.toString();
      }),
    ).toEqual([USER_A_ID.toString(), USER_B_ID.toString()]);
    expect(summary.notReachableCount).toBe(2);
    expect(summary.isTruncated).toBe(false);
  }, 60000);

  test("a notification rule that only exists on the SECOND page still counts as coverage", async () => {
    attachDirectly(USER_A_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    /*
     * This is the read that overflows first in real life: rule rows grow as
     * users x rule types x severities x methods, so a few thousand responders
     * is already hundreds of thousands of rows. Under the old single read the
     * users whose rules sorted late were scored against ZERO rules and reported
     * as gaps - a table full of false amber, which teaches admins to ignore
     * amber.
     */
    const filler: Array<UserNotificationRule> = [];

    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      filler.push(
        notificationRule({
          userId: USER_A_ID,
          ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        }),
      );
    }

    notificationRuleFindBy
      .mockResolvedValueOnce(filler as never)
      .mockResolvedValueOnce([
        notificationRule({
          userId: USER_A_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        }),
        notificationRule({
          userId: USER_A_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          incidentSeverityId: INCIDENT_SEVERITY_1_ID,
        }),
      ] as never);

    const readiness: UserReadiness = await onlyUser();

    expect(notificationRuleFindBy).toHaveBeenCalledTimes(2);
    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.reasons).toEqual([]);
  }, 60000);

  test("a read that never runs out is REPORTED as truncated, not quietly cut short", async () => {
    const loggedErrors: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation(((
      message: unknown,
    ): void => {
      loggedErrors.push(String(message));
    }) as never);

    /*
     * A read that returns a full page forever - a paging bug, or a table growing
     * faster than it can be read.
     */
    escalationUserFindBy.mockResolvedValue(
      fullPageOfDirectResponders(USER_A_ID) as never,
    );

    const summary: ReadinessSummary = await policySummary();

    /*
     * Two things have to be true at once, and neither is sufficient alone. It
     * has to STOP - an unbounded loop holding a connection is its own outage -
     * and it has to SAY SO, both to the caller (isTruncated, which the UI can
     * render) and to the operator (a logged error, which is where somebody
     * works out why). A ceiling that only logs is invisible to the admin
     * reading the table; a ceiling that only flags is invisible to whoever has
     * to fix it.
     */
    expect(escalationUserFindBy.mock.calls.length).toBeGreaterThan(1);
    expect(summary.isTruncated).toBe(true);
    expect(
      loggedErrors.some((message: string): boolean => {
        return message.includes("INCOMPLETE");
      }),
    ).toBe(true);

    // And it still returns everything it did manage to read.
    expect(summary.users).toHaveLength(1);
  }, 120000);

  test("an ordinary summary is not flagged as truncated - the flag has to MEAN something", async () => {
    attachDirectly(USER_A_ID);

    expect((await policySummary()).isTruncated).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (J) getReadinessForUser, including its cross-project guard.
 * ---------------------------------------------------------------------------
 */
describe("getReadinessForUser", () => {
  test("answers for a user who is on no policy at all - which is when the mistake is cheap to fix", async () => {
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);

    const readiness: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(readiness.reachedVia).toEqual([]);
    expect(readiness.status).toBe(ReadinessStatus.Ready);
  });

  test("reachedVia says WHY they are on call, resolved from their own memberships", async () => {
    /*
     * The user is in TEAM_ID (their membership row says so) and TEAM_ID is
     * attached to an escalation rule, so they are reached through the team.
     * Note what does NOT happen to establish that: the project's teams are
     * never expanded into their full rosters. The question asked is "is any
     * team THIS user is in attached to a rule", which is answered by two reads
     * keyed on this user, not by resolving the whole project.
     */
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);

    const readiness: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(readiness.reachedVia).toEqual([ResponderSource.Team]);
    expect(
      includedIds(firstCall(escalationTeamFindBy).query["teamId"]),
    ).toEqual([TEAM_ID.toString()]);
  });

  test("a team the user is NOT in does not make them a responder", async () => {
    /*
     * The inverse of the test above, and the one that would catch a targeted
     * resolution that forgot to intersect: OTHER_TEAM_ID is attached to an
     * escalation rule, but this user is only in TEAM_ID.
     */
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(OTHER_TEAM_ID),
    ] as never);

    const readiness: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(readiness.reachedVia).toEqual([]);
  });

  test("a schedule the user is on counts only while that schedule is attached to a rule", async () => {
    scheduleLayerUserFindBy.mockResolvedValue([
      layerUserRow(USER_A_ID, SCHEDULE_ID),
    ] as never);

    const unattached: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(unattached.reachedVia).toEqual([]);

    OnCallReadinessService.clearCache();
    escalationScheduleFindBy.mockResolvedValue([
      escalationScheduleRow(SCHEDULE_ID),
    ] as never);

    const attached: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(attached.reachedVia).toEqual([ResponderSource.Schedule]);
  });

  test("refuses a user who is not a member of the project - User is a GLOBAL model", async () => {
    membershipRows = [];

    await expect(
      OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID),
    ).rejects.toThrow("User is not a member of this project");

    /*
     * And it refuses BEFORE reading anything else, so a caller probing arbitrary
     * user ids learns nothing - not even a name.
     */
    expect(userFindBy).not.toHaveBeenCalled();
    expect(escalationUserFindBy).not.toHaveBeenCalled();
    expect(projectFindOneById).not.toHaveBeenCalled();
  });

  test("the membership check is scoped to the project AND to exactly the users asked about", async () => {
    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    const call: FindByCall = firstCall(teamMemberFindBy);

    expect(call.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
    expect(includedIds(call.query["userId"])).toEqual([USER_A_ID.toString()]);

    /*
     * It reads teamId as well as userId, because that one read is doing two
     * jobs: it is the cross-project guard AND the input to the Team source.
     * Dropping teamId from the select would silently cost a second query per
     * call, which is the N+1 coming back in a smaller coat.
     */
    expect(call.select?.["teamId"]).toBe(true);
    expect(call.select?.["userId"]).toBe(true);
  });

  test("a member with no User row is an error rather than a blank card", async () => {
    userDirectory = [];

    await expect(
      OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID),
    ).rejects.toThrow("User not found");
  });

  test("answers only about the user asked for, even when the project has other responders", async () => {
    attachDirectly(USER_A_ID, USER_B_ID, USER_C_ID);

    const readiness: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_B_ID, PROJECT_ID);

    expect(readiness.userId.toString()).toBe(USER_B_ID.toString());
    expect(includedIds(firstCall(userFindBy).query["_id"])).toEqual([
      USER_B_ID.toString(),
    ]);
  });

  test("does NOT resolve the whole project's responder set just to fill in reachedVia", async () => {
    escalationTeamFindBy.mockResolvedValue([
      escalationTeamRow(TEAM_ID),
    ] as never);
    teamMemberRows = [
      teamMemberRow(USER_A_ID, TEAM_ID),
      teamMemberRow(USER_B_ID, TEAM_ID),
      teamMemberRow(USER_C_ID, TEAM_ID),
    ];

    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    /*
     * This is the amplified N+1 in one assertion. The old shape asked "who does
     * this project page?" - reading every escalation rule, expanding every
     * attached team into its FULL roster and every schedule into its full layer
     * list - and then looked up one user in the answer. On a project of any
     * size that is work proportional to the project, repeated once per user, to
     * produce four booleans.
     *
     * Every read below is keyed on the single user instead, and the roster
     * expansion (a TeamMember read by teamId) never happens at all.
     */
    for (const spy of [escalationUserFindBy, scheduleLayerUserFindBy]) {
      expect(includedIds(firstCall(spy).query["userId"])).toEqual([
        USER_A_ID.toString(),
      ]);
    }

    expect(
      includedIds(firstCall(overrideFindBy).query["routeAlertsToUserId"]),
    ).toEqual([USER_A_ID.toString()]);

    const rosterExpansions: Array<FindByCall> = teamMemberFindBy.mock.calls
      .map((call: Array<unknown>): FindByCall => {
        return call[0] as FindByCall;
      })
      .filter((call: FindByCall): boolean => {
        return Boolean(call.query["teamId"]);
      });

    expect(rosterExpansions).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (J2) getReadinessForUsers - the batch entry point.
 *
 * This exists so that a list-shaped caller (a team roster, a responder table, a
 * row of chips) has something to call that is not `Promise.all(ids.map(...))`.
 * That shape was not a small inefficiency: each call resolved the ENTIRE
 * project's responder set to compute one user's reachedVia, so a forty-member
 * team issued several hundred queries, and one rejection - a member removed
 * between the two reads is enough - threw away the whole page.
 *
 * The property being pinned is CONSTANT COST in the size of the input set. Not
 * "fewer queries", not "faster": the same number, for one user and for five
 * hundred, because every read is one Includes over the whole set.
 * ---------------------------------------------------------------------------
 */
describe("getReadinessForUsers", () => {
  function seedMembers(count: number): Array<ObjectID> {
    const ids: Array<ObjectID> = [];

    for (let index: number = 0; index < count; index++) {
      ids.push(
        new ObjectID(
          `beef0000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      );
    }

    userDirectory = ids.map((id: ObjectID, index: number): User => {
      return makeUser(
        id,
        `Responder ${index}`,
        `responder${index}@corp.example.com`,
      );
    });
    membershipRows = ids.map((id: ObjectID): TeamMember => {
      return teamMemberRow(id, TEAM_ID);
    });

    return ids;
  }

  test("five hundred users cost exactly the same number of queries as one", async () => {
    const one: Array<ObjectID> = seedMembers(1);

    await OnCallReadinessService.getReadinessForUsers(one, PROJECT_ID);

    const costOfOne: number = totalQueryCount();

    expect(costOfOne).toBeGreaterThan(0);

    jest.clearAllMocks();
    OnCallReadinessService.clearCache();

    const many: Array<ObjectID> = seedMembers(500);

    const readiness: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(many, PROJECT_ID);

    expect(readiness).toHaveLength(500);

    /*
     * Five hundred times the users and not one extra round trip. The old
     * fan-out would have issued something like nine thousand.
     */
    expect(totalQueryCount()).toBe(costOfOne);
  }, 60000);

  test("every read is keyed on the users asked about, and no team is ever expanded", async () => {
    const ids: Array<ObjectID> = seedMembers(3);
    const expected: Array<string> = ids.map((id: ObjectID): string => {
      return id.toString();
    });

    await OnCallReadinessService.getReadinessForUsers(ids, PROJECT_ID);

    expect(includedIds(firstCall(teamMemberFindBy).query["userId"])).toEqual(
      expected,
    );
    expect(
      includedIds(firstCall(escalationUserFindBy).query["userId"]),
    ).toEqual(expected);
    expect(
      includedIds(firstCall(scheduleLayerUserFindBy).query["userId"]),
    ).toEqual(expected);
    expect(
      includedIds(firstCall(overrideFindBy).query["routeAlertsToUserId"]),
    ).toEqual(expected);
    expect(includedIds(firstCall(userFindBy).query["_id"])).toEqual(expected);

    for (const spy of [
      pushFindBy,
      emailFindBy,
      smsFindBy,
      callFindBy,
      whatsAppFindBy,
      telegramFindBy,
      webhookFindBy,
      notificationRuleFindBy,
    ]) {
      expect(includedIds(firstCall(spy).query["userId"])).toEqual(expected);
    }
  });

  test("a user who is not a member is OMITTED, not thrown for - one departure must not blank the page", async () => {
    const ids: Array<ObjectID> = seedMembers(3);

    /*
     * Exactly what happens when somebody is removed from a team between the
     * page being requested and this read running. The single-user entry point
     * throws for that user, which is right for a card about one person and
     * catastrophic for a roster: under Promise.all it discards thirty-nine
     * other people's readiness because one person left.
     */
    membershipRows = membershipRows.filter((row: TeamMember): boolean => {
      return row.userId?.toString() !== ids[1]!.toString();
    });

    const readiness: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(ids, PROJECT_ID);

    expect(readiness).toHaveLength(2);
    expect(
      readiness.map((one: UserReadiness): string => {
        return one.userId.toString();
      }),
    ).not.toContain(ids[1]!.toString());
  });

  test("no member of the requested set at all is an empty list rather than an error", async () => {
    const ids: Array<ObjectID> = seedMembers(2);
    membershipRows = [];

    await expect(
      OnCallReadinessService.getReadinessForUsers(ids, PROJECT_ID),
    ).resolves.toEqual([]);

    // And it stops after the membership read rather than reading anything else.
    expect(userFindBy).not.toHaveBeenCalled();
    expect(escalationUserFindBy).not.toHaveBeenCalled();
  });

  test("an empty request asks the database nothing at all", async () => {
    await expect(
      OnCallReadinessService.getReadinessForUsers([], PROJECT_ID),
    ).resolves.toEqual([]);

    expect(totalQueryCount()).toBe(0);
  });

  test("a duplicated user id is answered once", async () => {
    const readiness: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        [USER_A_ID, USER_A_ID, USER_A_ID],
        PROJECT_ID,
      );

    expect(readiness).toHaveLength(1);
    expect(includedIds(firstCall(userFindBy).query["_id"])).toEqual([
      USER_A_ID.toString(),
    ]);
  });

  test("the batch answer for a user is the answer the single call gives", async () => {
    attachDirectly(USER_A_ID);
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    const batch: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        [USER_A_ID, USER_B_ID],
        PROJECT_ID,
      );

    OnCallReadinessService.clearCache();

    const single: UserReadiness =
      await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    const fromBatch: UserReadiness = batch.find(
      (one: UserReadiness): boolean => {
        return one.userId.toString() === USER_A_ID.toString();
      },
    )!;

    expect(fromBatch.status).toBe(single.status);
    expect(fromBatch.reachedVia).toEqual(single.reachedVia);
    expect(fromBatch.reasons).toEqual(single.reasons);
    expect(fromBatch.coverage).toEqual(single.coverage);
  });

  test("results are sorted most-broken-first, the same as a summary", async () => {
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_B_ID, isVerified: true }),
    ] as never);

    const readiness: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        [USER_B_ID, USER_A_ID],
        PROJECT_ID,
      );

    expect(
      readiness.map((one: UserReadiness): ReadinessStatus => {
        return one.status;
      }),
    ).toEqual([ReadinessStatus.NotReachable, ReadinessStatus.Ready]);
  });

  test("a cached user costs no round trip, and only the uncached ones are read", async () => {
    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    jest.clearAllMocks();

    const readiness: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        [USER_A_ID, USER_B_ID],
        PROJECT_ID,
      );

    expect(readiness).toHaveLength(2);

    /*
     * Ada came out of the cache, so the reads that follow ask about Grace
     * alone. A batch that re-read every user whenever one of them was cold
     * would make the cache almost worthless on exactly the list-shaped callers
     * this entry point exists for.
     */
    expect(includedIds(firstCall(teamMemberFindBy).query["userId"])).toEqual([
      USER_B_ID.toString(),
    ]);
    expect(includedIds(firstCall(userFindBy).query["_id"])).toEqual([
      USER_B_ID.toString(),
    ]);
  });

  test("a second identical batch re-queries nothing", async () => {
    await OnCallReadinessService.getReadinessForUsers(
      [USER_A_ID, USER_B_ID],
      PROJECT_ID,
    );

    const countAfterFirst: number = totalQueryCount();

    await OnCallReadinessService.getReadinessForUsers(
      [USER_A_ID, USER_B_ID],
      PROJECT_ID,
    );

    expect(totalQueryCount()).toBe(countAfterFirst);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (J3) The fallback signal on the wire.
 *
 * Every readiness surface wants to tell an admin what a PartiallyReady
 * responder actually costs them, and the honest answer depends on one project
 * switch: with the fallback on, an uncovered severity still reaches the person
 * through their verified methods; with it off, that page is dropped. A UI that
 * cannot tell those apart says "nothing is dropped" at the exact moment
 * something is, which is worse than saying nothing at all.
 * ---------------------------------------------------------------------------
 */
describe("isFallbackEnabled", () => {
  test("true when the project leaves the fallback on", async () => {
    attachDirectly(USER_A_ID);

    expect((await policySummary()).isFallbackEnabled).toBe(true);
  });

  test("false when the project disables it, and the per-user reasons agree", async () => {
    attachDirectly(USER_A_ID);
    projectFindOneById.mockResolvedValue(
      makeProject({ disableOnCallNotificationFallback: true }) as never,
    );
    pushFindBy.mockResolvedValue([
      pushMethod({ userId: USER_A_ID, isVerified: true }),
    ] as never);
    setSeverities({
      incident: [incidentSeverity(INCIDENT_SEVERITY_1_ID, "Sev1")],
    });

    const summary: ReadinessSummary = await policySummary();

    expect(summary.isFallbackEnabled).toBe(false);
    expect(summary.users[0]!.reasons[0]).toBe(
      "No rules for Sev1 incidents - pages are dropped because on-call fallback is disabled for this project",
    );
  });

  test("reported even when the project has no responders yet", async () => {
    projectFindOneById.mockResolvedValue(
      makeProject({ disableOnCallNotificationFallback: true }) as never,
    );

    const summary: ReadinessSummary = await policySummary();

    /*
     * A project with nobody attached is precisely the project somebody is about
     * to attach somebody to, and "pages with no matching rule are dropped here"
     * is the thing they need to know before they do it - not after.
     */
    expect(summary.users).toEqual([]);
    expect(summary.isFallbackEnabled).toBe(false);
  });

  test("the project scope reports it too, not just the policy scope", async () => {
    attachDirectly(USER_A_ID);
    projectFindOneById.mockResolvedValue(
      makeProject({ disableOnCallNotificationFallback: true }) as never,
    );

    const summary: ReadinessSummary =
      await OnCallReadinessService.getReadinessForProject(PROJECT_ID);

    expect(summary.isFallbackEnabled).toBe(false);
    expect(summary.isTruncated).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * (K) The policy guard.
 * ---------------------------------------------------------------------------
 */
describe("getReadinessForPolicy guards", () => {
  test("an unknown policy is an error, not an empty and reassuring summary", async () => {
    policyFindOneById.mockResolvedValue(null as never);

    await expect(policySummary()).rejects.toThrow(
      "On-call duty policy not found",
    );
    expect(escalationUserFindBy).not.toHaveBeenCalled();
  });

  test("a policy from another project is refused, because every read below would return nothing", async () => {
    policyFindOneById.mockResolvedValue(makePolicy(OTHER_PROJECT_ID) as never);

    /*
     * "0 responders, nothing wrong" is the most dangerous possible answer to
     * "is this policy safe to rely on?".
     */
    await expect(policySummary()).rejects.toThrow(
      "On-call duty policy not found",
    );
    expect(escalationUserFindBy).not.toHaveBeenCalled();
  });

  test("a policy row with no projectId at all is refused", async () => {
    const orphan: OnCallDutyPolicy = new OnCallDutyPolicy();
    orphan.id = POLICY_ID;
    policyFindOneById.mockResolvedValue(orphan as never);

    await expect(policySummary()).rejects.toThrow(
      "On-call duty policy not found",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * (L) The cache.
 *
 * 60 seconds, per replica, with no cross-process invalidation - so the TTL is
 * the only guarantee and the keying has to be exactly right. A summary served
 * under the wrong key is a readiness answer for the wrong scope, which is worse
 * than a slow one.
 * ---------------------------------------------------------------------------
 */
describe("cache", () => {
  test("a second call inside the TTL re-queries nothing", async () => {
    attachDirectly(USER_A_ID);

    const first: ReadinessSummary = await policySummary();
    const countAfterFirst: number = totalQueryCount();
    const second: ReadinessSummary = await policySummary();

    expect(totalQueryCount()).toBe(countAfterFirst);
    expect(second).toBe(first);
  });

  test("clearCache forces a recompute, so an admin who just fixed something sees it fixed", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();
    expect(escalationUserFindBy).toHaveBeenCalledTimes(1);

    await policySummary();
    expect(escalationUserFindBy).toHaveBeenCalledTimes(1);

    OnCallReadinessService.clearCache();

    await policySummary();
    expect(escalationUserFindBy).toHaveBeenCalledTimes(2);
  });

  test("clearCache empties the user cache as well as the summary cache", async () => {
    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);
    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(userFindBy).toHaveBeenCalledTimes(1);

    OnCallReadinessService.clearCache();

    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);

    expect(userFindBy).toHaveBeenCalledTimes(2);
  });

  test("the project scope and the policy scope are separate entries", async () => {
    attachDirectly(USER_A_ID);

    await OnCallReadinessService.getReadinessForProject(PROJECT_ID);
    await policySummary();

    expect(escalationUserFindBy).toHaveBeenCalledTimes(2);
    expect(
      firstCall(escalationUserFindBy).query["onCallDutyPolicyId"],
    ).toBeUndefined();
    expect(
      callAt(escalationUserFindBy, 1).query["onCallDutyPolicyId"]?.toString(),
    ).toBe(POLICY_ID.toString());
  });

  test("two policies in one project do not share an entry", async () => {
    attachDirectly(USER_A_ID);

    await policySummary();
    await OnCallReadinessService.getReadinessForPolicy(
      OTHER_POLICY_ID,
      PROJECT_ID,
    );

    expect(escalationUserFindBy).toHaveBeenCalledTimes(2);
  });

  test("the project scope is keyed on the project, so another project is not served this one's answer", async () => {
    attachDirectly(USER_A_ID);

    await OnCallReadinessService.getReadinessForProject(PROJECT_ID);
    await OnCallReadinessService.getReadinessForProject(OTHER_PROJECT_ID);

    expect(escalationUserFindBy).toHaveBeenCalledTimes(2);
    expect(callAt(escalationUserFindBy, 1).query["projectId"]?.toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("two users do not share an entry", async () => {
    await OnCallReadinessService.getReadinessForUser(USER_A_ID, PROJECT_ID);
    await OnCallReadinessService.getReadinessForUser(USER_B_ID, PROJECT_ID);

    expect(userFindBy).toHaveBeenCalledTimes(2);
  });
});
