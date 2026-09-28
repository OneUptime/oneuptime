import TeamComplianceService from "../../../Server/TeamCompliance/TeamComplianceService";
import OnCallReadinessService, {
  ReadinessCoverageCell,
  ReadinessStatus,
  ReadinessSummary,
  UserReadiness,
} from "Common/Server/Services/OnCallReadinessService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamComplianceSettingService from "Common/Server/Services/TeamComplianceSettingService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import UserCallService from "Common/Server/Services/UserCallService";
import UserEmailService from "Common/Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "Common/Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserPushService from "Common/Server/Services/UserPushService";
import UserService from "Common/Server/Services/UserService";
import UserSlackService from "Common/Server/Services/UserSlackService";
import UserSmsService from "Common/Server/Services/UserSmsService";
import UserTelegramService from "Common/Server/Services/UserTelegramService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import UserWhatsAppService from "Common/Server/Services/UserWhatsAppService";
import logger from "Common/Server/Utils/Logger";
import Team from "Common/Models/DatabaseModels/Team";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";
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
 * graph. And a stub makes the DEPENDENCY explicit: this file asserts, once and
 * loudly, that the real class actually exposes the entry points it stubs - see
 * "the batched readiness contract this service depends on" below - rather than
 * letting a jest.spyOn failure in beforeEach take out every test.
 */
jest.mock("Common/Server/Services/OnCallReadinessService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Services/OnCallReadinessService",
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
 * TeamComplianceService is the READING half of Teams > View > Compliance: it
 * loads what the team's rules need and hands it to TeamComplianceEvaluator,
 * whose judgements are pinned in TeamComplianceEvaluator.test.ts. What this file
 * pins is the reading - and the reading is where this page has been wrong
 * before, in ways that were invisible on the page itself:
 *
 *   - TENANT SCOPING. Every read is `isRoot: true`, because the page reports on
 *     people the reader may not be permitted to read individually. The projectId
 *     in each QUERY is therefore the only tenant boundary there is, and every
 *     read carries it - the team row included, which used to be read by id
 *     alone, so a team id from another project resolved and its members were
 *     described to a caller from outside it.
 *
 *   - TRUNCATION. Members, users and rules are read with LIMIT_PER_PROJECT, never
 *     the old literal 100: the 101st member of a team was not reported
 *     non-compliant, they were absent, and an absent row reads as "no problem".
 *
 *   - FAN-OUT. The number of queries is CONSTANT in the number of members and
 *     severities. The page used to cost one findBy per severity per member, and
 *     then one full readiness resolution per member; each method rule used to be
 *     one existence check per member. Every read is now one batched read for the
 *     whole team (paged only if a single read passes LIMIT_PER_PROJECT rows).
 *
 *   - PAYING ONLY FOR WHAT IS ASKED. Readiness only for on-call rules with no
 *     channel; rules, severities and referenced methods only for on-call rules
 *     WITH a channel; the project row only when a rule relies on a channel the
 *     project can switch off. A disabled or unrecognised rule costs nothing.
 *
 *   - LOADING FAITHFULLY. The rows read are handed on without losing what makes
 *     a verdict: the severity column the rule type dictates, a NULL isOptOut
 *     being a rule rather than an opt-out, a method row's owner and
 *     verification, a selected severity's project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const CRITICAL_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const MAJOR_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000002");
const HIGH_ID: ObjectID = new ObjectID("a5000000-0000-4000-8000-000000000001");

// Enough of a findBy argument to assert on, without importing FindBy generics.
interface CapturedFindBy {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  sort?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  props?: { isRoot?: boolean | undefined } | undefined;
}

interface CapturedFindOneById {
  id: ObjectID;
  select?: Record<string, unknown> | undefined;
  props?: { isRoot?: boolean | undefined } | undefined;
}

interface StubUser {
  id: ObjectID;
  name?: string | undefined;
  email?: string | undefined;
  profilePictureId?: ObjectID | undefined;
}

// A severity as the setting's relation hands it back.
interface StubRelationSeverity {
  _id: string;
  name?: string | undefined;
  color?: Color | undefined;
  order?: number | undefined;
  projectId?: ObjectID | undefined;
}

// A TeamComplianceSetting row as the settings read hands it back.
interface StubSetting {
  _id: string;
  ruleType?: string | undefined;
  enabled?: boolean | undefined;
  notificationChannel?: string | undefined;
  createdAt?: Date | undefined;
  incidentSeverities?: Array<StubRelationSeverity> | undefined;
  alertSeverities?: Array<StubRelationSeverity> | undefined;
}

// A UserNotificationRule row as the rule read hands it back.
interface StubRule {
  _id: string;
  userId: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  isOptOut?: boolean | null | undefined;
  userCallId?: ObjectID | undefined;
  userSmsId?: ObjectID | undefined;
  userPushId?: ObjectID | undefined;
  userEmailId?: ObjectID | undefined;
  userWhatsAppId?: ObjectID | undefined;
  userTelegramId?: ObjectID | undefined;
  userSlackId?: ObjectID | undefined;
  userMicrosoftTeamsId?: ObjectID | undefined;
  userWebhookId?: ObjectID | undefined;
}

// A notification-method row (UserCall, UserPush, ...) as a method read hands it back.
interface StubMethod {
  _id: string;
  userId: ObjectID | string;
  isVerified?: boolean | undefined;
}

const ADA: StubUser = { id: USER_ID, name: "Ada", email: "ada@example.com" };
const GRACE: StubUser = {
  id: OTHER_USER_ID,
  name: "Grace",
  email: "grace@example.com",
};

let settingCounter: number = 0;

function setting(data: {
  ruleType: ComplianceRuleType | string;
  enabled?: boolean | undefined;
  notificationChannel?: ComplianceNotificationChannel | undefined;
  incidentSeverities?: Array<StubRelationSeverity> | undefined;
  alertSeverities?: Array<StubRelationSeverity> | undefined;
  createdAt?: Date | undefined;
}): StubSetting {
  settingCounter++;

  return {
    _id: `5e771000-0000-4000-8000-${settingCounter.toString().padStart(12, "0")}`,
    ruleType: data.ruleType,
    enabled: data.enabled === undefined ? true : data.enabled,
    notificationChannel: data.notificationChannel,
    createdAt:
      data.createdAt || new Date(Date.UTC(2026, 0, 1, 0, 0, settingCounter)),
    incidentSeverities: data.incidentSeverities || [],
    alertSeverities: data.alertSeverities || [],
  };
}

function relationSeverity(
  id: ObjectID,
  name: string,
  order: number,
  projectId: ObjectID = PROJECT_ID,
  color?: Color | undefined,
): StubRelationSeverity {
  return {
    _id: id.toString(),
    name: name,
    order: order,
    projectId: projectId,
    color: color,
  };
}

function projectSeverity(
  id: ObjectID,
  name: string,
  order: number,
): Record<string, unknown> {
  return { _id: id.toString(), name: name, order: order };
}

function coverageCell(data: {
  ruleType: NotificationRuleType;
  severityId?: ObjectID | undefined;
  severityName?: string | undefined;
  hasRule?: boolean | undefined;
  isOptOut?: boolean | undefined;
}): ReadinessCoverageCell {
  return {
    ruleType: data.ruleType,
    severityId: data.severityId,
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
    teams: [],
  };
}

function summaryWith(users: Array<UserReadiness>): ReadinessSummary {
  return {
    projectId: PROJECT_ID,
    onCallDutyPolicyId: undefined,
    readyCount: 0,
    partiallyReadyCount: users.length,
    notReachableCount: 0,
    isFallbackEnabled: true,
    isTruncated: false,
    users: users,
  };
}

function callsOf(spy: jest.SpyInstance): Array<CapturedFindBy> {
  return spy.mock.calls.map((args: Array<unknown>): CapturedFindBy => {
    return args[0] as CapturedFindBy;
  });
}

function firstCall(spy: jest.SpyInstance): CapturedFindBy {
  const call: CapturedFindBy | undefined = callsOf(spy)[0];

  if (!call) {
    throw new Error("Expected the service to have been read at least once");
  }

  return call;
}

// The values an Includes query operator carries, as strings.
function includedIds(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return ((value as Includes).values as Array<unknown>).map(
    (item: unknown): string => {
      return String(item);
    },
  );
}

let userEmailFindBy: jest.SpyInstance;
let userSmsFindBy: jest.SpyInstance;
let userCallFindBy: jest.SpyInstance;
let userPushFindBy: jest.SpyInstance;
let userWhatsAppFindBy: jest.SpyInstance;
let userTelegramFindBy: jest.SpyInstance;
let userSlackFindBy: jest.SpyInstance;
let userMicrosoftTeamsFindBy: jest.SpyInstance;
let userWebhookFindBy: jest.SpyInstance;
let incidentSeverityFindBy: jest.SpyInstance;
let alertSeverityFindBy: jest.SpyInstance;
let notificationRuleFindBy: jest.SpyInstance;
let teamFindOneBy: jest.SpyInstance;
let complianceSettingFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let userFindBy: jest.SpyInstance;
let projectFindOneById: jest.SpyInstance;
let readinessForUser: jest.SpyInstance;
let readinessForUsers: jest.SpyInstance;
let readinessForProject: jest.SpyInstance;
let loggerError: jest.SpyInstance;

function methodSpyFor(
  channel: ComplianceNotificationChannel,
): jest.SpyInstance {
  switch (channel) {
    case ComplianceNotificationChannel.Email:
      return userEmailFindBy;
    case ComplianceNotificationChannel.SMS:
      return userSmsFindBy;
    case ComplianceNotificationChannel.Call:
      return userCallFindBy;
    case ComplianceNotificationChannel.Push:
      return userPushFindBy;
    case ComplianceNotificationChannel.WhatsApp:
      return userWhatsAppFindBy;
    case ComplianceNotificationChannel.Telegram:
      return userTelegramFindBy;
    case ComplianceNotificationChannel.Slack:
      return userSlackFindBy;
    case ComplianceNotificationChannel.MicrosoftTeams:
      return userMicrosoftTeamsFindBy;
    case ComplianceNotificationChannel.Webhook:
      return userWebhookFindBy;
  }
}

function everyMethodSpy(): Array<jest.SpyInstance> {
  return Object.values(ComplianceNotificationChannel).map(
    (channel: ComplianceNotificationChannel): jest.SpyInstance => {
      return methodSpyFor(channel);
    },
  );
}

// Every findBy the compliance path can make (findOneBy / findOneById apart).
function everyFindBySpy(): Array<jest.SpyInstance> {
  return [
    ...everyMethodSpy(),
    incidentSeverityFindBy,
    alertSeverityFindBy,
    notificationRuleFindBy,
    complianceSettingFindBy,
    teamMemberFindBy,
    userFindBy,
  ];
}

function stage(data: {
  settings?: Array<StubSetting> | undefined;
  members?: Array<StubUser> | undefined;
}): void {
  complianceSettingFindBy.mockResolvedValue((data.settings || []) as never);

  const members: Array<StubUser> = data.members || [];

  teamMemberFindBy.mockResolvedValue(
    members.map((member: StubUser, index: number): Record<string, unknown> => {
      return { _id: `tm-${index}`, userId: member.id };
    }) as never,
  );
  userFindBy.mockResolvedValue(members as never);
}

async function read(): Promise<TeamComplianceStatusJSON> {
  return TeamComplianceService.getTeamComplianceStatus(TEAM_ID, PROJECT_ID);
}

function statusOf(
  status: TeamComplianceStatusJSON,
  userId: ObjectID,
): TeamMemberComplianceJSON {
  const found: TeamMemberComplianceJSON | undefined =
    status.userComplianceStatuses.find(
      (candidate: TeamMemberComplianceJSON): boolean => {
        return candidate.userId === userId.toString();
      },
    );

  if (!found) {
    throw new Error(`No status for ${userId.toString()}`);
  }

  return found;
}

function reasonsOf(
  status: TeamComplianceStatusJSON,
  userId: ObjectID,
): Array<string> {
  return statusOf(status, userId).nonCompliantRules.map(
    (issue: TeamComplianceIssueJSON): string => {
      return issue.reason;
    },
  );
}

// The notification-rule reads this service made (they carry a ruleType filter).
function ruleReads(): Array<CapturedFindBy> {
  return callsOf(notificationRuleFindBy);
}

beforeEach(() => {
  /*
   * Call history is cleared explicitly because restoreAllMocks does not do it
   * for the readiness stubs: jest.spyOn returns the EXISTING mock when the
   * property is already a mock function - which the three entry points on the
   * mocked module are - so those spies would otherwise accumulate calls across
   * the file, and "this render made one batched call" would become an assertion
   * about whatever the previous test did.
   */
  jest.clearAllMocks();

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
  userWhatsAppFindBy = jest
    .spyOn(UserWhatsAppService, "findBy")
    .mockResolvedValue([] as never);
  userTelegramFindBy = jest
    .spyOn(UserTelegramService, "findBy")
    .mockResolvedValue([] as never);
  userSlackFindBy = jest
    .spyOn(UserSlackService, "findBy")
    .mockResolvedValue([] as never);
  userMicrosoftTeamsFindBy = jest
    .spyOn(UserMicrosoftTeamsService, "findBy")
    .mockResolvedValue([] as never);
  userWebhookFindBy = jest
    .spyOn(UserWebhookService, "findBy")
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
  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({
      enableCallNotifications: true,
      enableSmsNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
    } as never);
  loggerError = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  /*
   * Readiness reaches the whole team through exactly two entry points: the
   * project-scope summary, and one batched fill for whoever that summary does
   * not cover. getReadinessForUser is stubbed as well precisely so the tests
   * can assert it is NEVER reached - a per-user call surviving anywhere in this
   * path is the defect, not an implementation detail.
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
 * The team row - tenant scoping starts here.
 * -------------------------------------------------------------------------
 */

describe("the team read", () => {
  test("throws BadDataException when the team does not exist, before reading anything else", async () => {
    teamFindOneBy.mockResolvedValue(null as never);

    await expect(read()).rejects.toBeInstanceOf(BadDataException);

    expect(complianceSettingFindBy).not.toHaveBeenCalled();
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(projectFindOneById).not.toHaveBeenCalled();
  });

  test("SECURITY: the team is read by id AND project, in one query, as root", async () => {
    /*
     * Asserting the QUERY rather than the outcome is the point. An
     * implementation that read by id and then compared projectId would pass an
     * outcome test and still be one deleted line away from the hole; a query
     * naming both columns cannot be half-right.
     */
    await read();

    const call: CapturedFindBy = firstCall(teamFindOneBy);

    expect(call.query["_id"]).toBe(TEAM_ID.toString());
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.props?.isRoot).toBe(true);
  });

  test("SECURITY: a team from another project does not resolve, and is not described", async () => {
    teamFindOneBy.mockImplementation(
      (data: CapturedFindBy): Promise<Team | null> => {
        const queriedProjectId: unknown = data.query["projectId"];

        if (
          queriedProjectId &&
          String(queriedProjectId) === PROJECT_ID.toString()
        ) {
          return Promise.resolve({ name: "Platform On-Call" } as Team);
        }

        return Promise.resolve(null);
      },
    );

    await expect(
      TeamComplianceService.getTeamComplianceStatus(TEAM_ID, OTHER_PROJECT_ID),
    ).rejects.toThrow("Team not found");

    // Nothing about the team's members was read on the way to that refusal.
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(userFindBy).not.toHaveBeenCalled();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * The rules, the members and their users.
 * -------------------------------------------------------------------------
 */

describe("the rule, member and user reads", () => {
  test("the team's rules are read with everything the page shows about them, oldest first", async () => {
    await read();

    const call: CapturedFindBy = firstCall(complianceSettingFindBy);

    expect(call.query).toEqual({ teamId: TEAM_ID, projectId: PROJECT_ID });
    expect(call.select).toEqual({
      _id: true,
      ruleType: true,
      enabled: true,
      notificationChannel: true,
      createdAt: true,
      /*
       * projectId on the severities is not decoration: a selected severity is
       * only honoured when it provably belongs to this project.
       */
      incidentSeverities: {
        _id: true,
        name: true,
        color: true,
        order: true,
        projectId: true,
      },
      alertSeverities: {
        _id: true,
        name: true,
        color: true,
        order: true,
        projectId: true,
      },
    });
    expect(call.sort).toEqual({
      createdAt: SortOrder.Ascending,
      _id: SortOrder.Ascending,
    });
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
    expect(call.props?.isRoot).toBe(true);
  });

  test("team members are read with LIMIT_PER_PROJECT, scoped to the team and the project", async () => {
    await read();

    const call: CapturedFindBy = firstCall(teamMemberFindBy);

    /*
     * This used to be the literal 100. The 101st member of a large team was
     * not listed as non-compliant, they were simply absent, and an absent row
     * reads as "no problem here".
     */
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.limit).not.toBe(100);
    expect(call.skip).toBe(0);
    expect(call.query).toEqual({ teamId: TEAM_ID, projectId: PROJECT_ID });
    expect(call.props?.isRoot).toBe(true);
  });

  test("users are read once, for exactly the team's members, with LIMIT_PER_PROJECT", async () => {
    stage({ members: [ADA, GRACE] });

    await read();

    expect(userFindBy).toHaveBeenCalledTimes(1);

    const call: CapturedFindBy = firstCall(userFindBy);
    expect(includedIds(call.query["_id"])).toEqual([
      USER_ID.toString(),
      OTHER_USER_ID.toString(),
    ]);
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.limit).not.toBe(100);
    expect(call.skip).toBe(0);
    expect(call.props?.isRoot).toBe(true);
  });

  test("a membership listed twice asks for the user once and reports them once", async () => {
    complianceSettingFindBy.mockResolvedValue([] as never);
    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: USER_ID },
      { _id: "tm-2", userId: USER_ID },
      { _id: "tm-3", userId: undefined },
    ] as never);
    userFindBy.mockResolvedValue([ADA] as never);

    const status: TeamComplianceStatusJSON = await read();

    expect(includedIds(firstCall(userFindBy).query["_id"])).toEqual([
      USER_ID.toString(),
    ]);
    expect(status.userComplianceStatuses).toHaveLength(1);
  });

  test("members are reported in team-member order, and a member whose user is gone is left out", async () => {
    const carol: StubUser = {
      id: ObjectID.generate(),
      name: "Carol",
      email: "carol@example.com",
    };

    teamMemberFindBy.mockResolvedValue([
      { _id: "tm-1", userId: carol.id },
      { _id: "tm-2", userId: OTHER_USER_ID },
      { _id: "tm-3", userId: ObjectID.generate() },
      { _id: "tm-4", userId: USER_ID },
    ] as never);
    // The user table answers in its own order, and does not know the third member.
    userFindBy.mockResolvedValue([ADA, carol, GRACE] as never);

    const status: TeamComplianceStatusJSON = await read();

    expect(
      status.userComplianceStatuses.map(
        (member: TeamMemberComplianceJSON): string => {
          return member.userName;
        },
      ),
    ).toEqual(["Carol", "Grace", "Ada"]);
  });

  test("a team with no members reads no users and nothing per member, even with rules enabled", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
        setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
        setting({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
      ],
      members: [],
    });

    const status: TeamComplianceStatusJSON = await read();

    expect(userFindBy).not.toHaveBeenCalled();
    expect(userEmailFindBy).not.toHaveBeenCalled();
    expect(readinessForProject).not.toHaveBeenCalled();
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
    expect(alertSeverityFindBy).not.toHaveBeenCalled();
    expect(status.userComplianceStatuses).toEqual([]);
    expect(status.complianceSettings).toHaveLength(3);
  });

  test("a member read that hits the ceiling is logged as an incomplete page", async () => {
    teamMemberFindBy.mockResolvedValue(
      Array.from({ length: LIMIT_PER_PROJECT }, (_: unknown, index: number) => {
        return { _id: `tm-${index}`, userId: ObjectID.generate() };
      }) as never,
    );

    await read();

    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(String(loggerError.mock.calls[0]![0])).toContain("INCOMPLETE");
  });

  test("an ordinary team logs nothing", async () => {
    stage({ members: [ADA, GRACE] });

    await read();

    expect(loggerError).not.toHaveBeenCalled();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * Method rules - ONE read per channel for the whole team.
 * -------------------------------------------------------------------------
 */

describe("method rules", () => {
  const METHOD_RULES: Array<
    [ComplianceRuleType, ComplianceNotificationChannel, string]
  > = [
    [
      ComplianceRuleType.HasNotificationEmailMethod,
      ComplianceNotificationChannel.Email,
      "No verified email address configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationSMSMethod,
      ComplianceNotificationChannel.SMS,
      "No verified phone number configured for SMS notifications",
    ],
    [
      ComplianceRuleType.HasNotificationCallMethod,
      ComplianceNotificationChannel.Call,
      "No verified phone number configured for call notifications",
    ],
    [
      ComplianceRuleType.HasNotificationPushMethod,
      ComplianceNotificationChannel.Push,
      "No verified push notification device configured",
    ],
    [
      ComplianceRuleType.HasNotificationWhatsAppMethod,
      ComplianceNotificationChannel.WhatsApp,
      "No verified WhatsApp number configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationTelegramMethod,
      ComplianceNotificationChannel.Telegram,
      "No verified Telegram account configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationSlackMethod,
      ComplianceNotificationChannel.Slack,
      "No verified Slack account configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
      ComplianceNotificationChannel.MicrosoftTeams,
      "No verified Microsoft Teams account configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationWebhookMethod,
      ComplianceNotificationChannel.Webhook,
      "No webhook configured for notifications",
    ],
  ];

  test.each(METHOD_RULES)(
    "%s: ONE read of the team's verified methods, and each member judged on their own",
    async (
      ruleType: ComplianceRuleType,
      channel: ComplianceNotificationChannel,
      reason: string,
    ) => {
      stage({
        settings: [setting({ ruleType: ruleType })],
        members: [ADA, GRACE],
      });
      methodSpyFor(channel).mockResolvedValue([
        { _id: "method-1", userId: USER_ID },
      ] as never);

      const status: TeamComplianceStatusJSON = await read();

      const spy: jest.SpyInstance = methodSpyFor(channel);
      expect(spy).toHaveBeenCalledTimes(1);

      const call: CapturedFindBy = firstCall(spy);
      const expectedQueryKeys: Array<string> =
        channel === ComplianceNotificationChannel.Webhook
          ? ["projectId", "userId"]
          : ["isVerified", "projectId", "userId"];

      expect(Object.keys(call.query).sort()).toEqual(expectedQueryKeys);
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(includedIds(call.query["userId"])).toEqual([
        USER_ID.toString(),
        OTHER_USER_ID.toString(),
      ]);

      /*
       * An unverified phone number cannot receive a page, so counting one would
       * be a false green. Webhooks have no verification step at all - their
       * table has no such column - so for them owning one is the whole test.
       */
      if (channel !== ComplianceNotificationChannel.Webhook) {
        expect(call.query["isVerified"]).toBe(true);
      }

      expect(call.select).toEqual({ _id: true, userId: true });
      expect(call.sort).toEqual({ _id: SortOrder.Ascending });
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
      expect(call.skip).toBe(0);
      expect(call.props?.isRoot).toBe(true);

      // No other channel's table is asked anything.
      for (const other of everyMethodSpy()) {
        if (other !== spy) {
          expect(other).not.toHaveBeenCalled();
        }
      }

      expect(statusOf(status, USER_ID).isCompliant).toBe(true);
      expect(reasonsOf(status, OTHER_USER_ID)).toEqual([reason]);
    },
  );

  test("two rules on one channel still read it once", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [ADA],
    });

    await read();

    expect(userEmailFindBy).toHaveBeenCalledTimes(1);
  });

  test("a disabled method rule reads nothing and fails nobody", async () => {
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasNotificationSMSMethod,
          enabled: false,
        }),
        setting({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          enabled: false,
        }),
      ],
      members: [ADA],
    });

    const status: TeamComplianceStatusJSON = await read();

    for (const spy of everyMethodSpy()) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(projectFindOneById).not.toHaveBeenCalled();
    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
  });

  test("a method owner given as a plain id string is still matched", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [ADA],
    });
    userEmailFindBy.mockResolvedValue([
      { _id: "email-1", userId: USER_ID.toString() },
    ] as never);

    expect(statusOf(await read(), USER_ID).isCompliant).toBe(true);
  });

  test("a read longer than one page is followed to the end, each page with a fresh query", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [ADA, GRACE],
    });

    // A full first page of somebody else's rows, then Grace on the second page.
    const fullPage: Array<StubMethod> = Array.from(
      { length: LIMIT_PER_PROJECT },
      (_: unknown, index: number): StubMethod => {
        return { _id: `email-${index}`, userId: USER_ID };
      },
    );
    userEmailFindBy
      .mockResolvedValueOnce(fullPage as never)
      .mockResolvedValueOnce([
        { _id: "email-last", userId: OTHER_USER_ID },
      ] as never);

    const status: TeamComplianceStatusJSON = await read();

    const calls: Array<CapturedFindBy> = callsOf(userEmailFindBy);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.skip).toBe(0);
    expect(calls[1]!.skip).toBe(LIMIT_PER_PROJECT);
    expect(calls[1]!.sort).toEqual({ _id: SortOrder.Ascending });
    /*
     * A fresh copy of the query per page: findBy hands it to the permission
     * layer, and a query that accumulated predicates across pages would narrow
     * as it went.
     */
    expect(calls[0]!.query).not.toBe(calls[1]!.query);
    expect(calls[0]!.query).toEqual(calls[1]!.query);

    expect(statusOf(status, OTHER_USER_ID).isCompliant).toBe(true);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * On-call rules with NO channel - readiness, batched for the whole team.
 * -------------------------------------------------------------------------
 */

describe("on-call rules for any channel", () => {
  test("the whole team's coverage costs ONE project-scope readiness pass when it covers everyone", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
      ],
      members: [ADA, GRACE],
    });
    readinessForProject.mockResolvedValue(
      summaryWith([
        readinessWith(
          [
            coverageCell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severityId: CRITICAL_ID,
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
              severityId: CRITICAL_ID,
              severityName: "Critical",
            }),
          ],
          OTHER_USER_ID,
        ),
      ]) as never,
    );

    const status: TeamComplianceStatusJSON = await read();

    expect(readinessForProject).toHaveBeenCalledTimes(1);
    expect(readinessForProject.mock.calls[0]).toEqual([PROJECT_ID]);
    expect(readinessForUsers).not.toHaveBeenCalled();
    expect(readinessForUser).not.toHaveBeenCalled();

    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
    expect(reasonsOf(status, OTHER_USER_ID)).toEqual([
      "Missing notification rules for incident severities: Critical",
    ]);
  });

  test("members the summary does not cover are filled in by ONE batched call, never one per member", async () => {
    stage({
      settings: [setting({ ruleType: ComplianceRuleType.HasAlertOnCallRules })],
      members: [ADA, GRACE],
    });
    readinessForProject.mockResolvedValue(summaryWith([]) as never);
    readinessForUsers.mockResolvedValue([
      readinessWith(
        [
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityId: HIGH_ID,
            severityName: "Page",
          }),
        ],
        USER_ID,
      ),
      readinessWith(
        [
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityId: HIGH_ID,
            severityName: "Page",
            hasRule: true,
          }),
        ],
        OTHER_USER_ID,
      ),
    ] as never);

    const status: TeamComplianceStatusJSON = await read();

    expect(readinessForUsers).toHaveBeenCalledTimes(1);
    expect(readinessForUser).not.toHaveBeenCalled();
    expect(
      (readinessForUsers.mock.calls[0]![0] as Array<ObjectID>).map(
        (userId: ObjectID): string => {
          return userId.toString();
        },
      ),
    ).toEqual([USER_ID.toString(), OTHER_USER_ID.toString()]);
    expect(readinessForUsers.mock.calls[0]![1]).toEqual(PROJECT_ID);

    // Keyed back by the id each answer carries, not by position.
    expect(reasonsOf(status, USER_ID)).toEqual([
      "Missing notification rules for alert severities: Page",
    ]);
    expect(statusOf(status, OTHER_USER_ID).isCompliant).toBe(true);
  });

  test("only the members the summary MISSED are batched", async () => {
    stage({
      settings: [setting({ ruleType: ComplianceRuleType.HasAlertOnCallRules })],
      members: [ADA, GRACE],
    });
    readinessForProject.mockResolvedValue(
      summaryWith([readinessWith([], USER_ID)]) as never,
    );
    readinessForUsers.mockResolvedValue([
      readinessWith([], OTHER_USER_ID),
    ] as never);

    await read();

    expect(
      (readinessForUsers.mock.calls[0]![0] as Array<ObjectID>).map(
        (userId: ObjectID): string => {
          return userId.toString();
        },
      ),
    ).toEqual([OTHER_USER_ID.toString()]);
  });

  test("a member the batch cannot resolve is reported UNCHECKED, and the rest of the page still renders", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
      ],
      members: [ADA, GRACE],
    });
    readinessForUsers.mockResolvedValue([readinessWith([], USER_ID)] as never);

    const status: TeamComplianceStatusJSON = await read();

    expect(status.userComplianceStatuses).toHaveLength(2);
    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
    expect(reasonsOf(status, OTHER_USER_ID)).toEqual([
      "Could not check incident notification rules for this user - they may no longer be a member of this project",
    ]);
    expect(readinessForUser).not.toHaveBeenCalled();
  });

  test("readiness for people outside the team is ignored", async () => {
    const stranger: ObjectID = ObjectID.generate();

    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
      ],
      members: [ADA],
    });
    readinessForProject.mockResolvedValue(
      summaryWith([readinessWith([], stranger)]) as never,
    );
    readinessForUsers.mockResolvedValue([
      readinessWith([], stranger),
      readinessWith([], USER_ID),
    ] as never);

    const status: TeamComplianceStatusJSON = await read();

    expect(status.userComplianceStatuses).toHaveLength(1);
    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
  });

  test.each<[ComplianceRuleType, NotificationRuleType, string]>([
    [
      ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      "incident episode",
    ],
    [
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      "alert episode",
    ],
  ])(
    "%s is answered from the episode cells of the same readiness pass",
    async (
      ruleType: ComplianceRuleType,
      notificationRuleType: NotificationRuleType,
      subject: string,
    ) => {
      stage({ settings: [setting({ ruleType: ruleType })], members: [ADA] });
      readinessForProject.mockResolvedValue(
        summaryWith([
          readinessWith([
            coverageCell({
              ruleType: notificationRuleType,
              severityId: CRITICAL_ID,
              severityName: "Critical",
            }),
          ]),
        ]) as never,
      );

      const status: TeamComplianceStatusJSON = await read();

      expect(reasonsOf(status, USER_ID)).toEqual([
        `Missing notification rules for ${subject} severities: Critical`,
      ]);
      expect(readinessForProject).toHaveBeenCalledTimes(1);
    },
  );

  test("a rule scoped to severities checks only those cells - the scope comes from the rule's own relation", async () => {
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [relationSeverity(MAJOR_ID, "Major", 2)],
        }),
      ],
      members: [ADA],
    });
    readinessForProject.mockResolvedValue(
      summaryWith([
        readinessWith([
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            severityId: CRITICAL_ID,
            severityName: "Critical",
          }),
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            severityId: MAJOR_ID,
            severityName: "Major",
          }),
        ]),
      ]) as never,
    );

    expect(reasonsOf(await read(), USER_ID)).toEqual([
      "Missing notification rules for incident severities: Major",
    ]);
  });

  test("SECURITY: a severity from another project in the rule's relation is ignored, not trusted", async () => {
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [
            relationSeverity(MAJOR_ID, "Their Sev1", 1, OTHER_PROJECT_ID),
          ],
        }),
      ],
      members: [ADA],
    });
    readinessForProject.mockResolvedValue(
      summaryWith([
        readinessWith([
          coverageCell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            severityId: CRITICAL_ID,
            severityName: "Critical",
          }),
        ]),
      ]) as never,
    );

    const status: TeamComplianceStatusJSON = await read();
    const rule: TeamComplianceRuleJSON = status.complianceSettings[0]!;

    expect(rule.severities).toEqual([]);
    expect(rule.appliesToAllSeverities).toBe(true);
    expect(JSON.stringify(status)).not.toContain("Their Sev1");
    expect(reasonsOf(status, USER_ID)).toEqual([
      "Missing notification rules for incident severities: Critical",
    ]);
  });

  test("any number of any-channel rules share one readiness pass, and read no rules or severities of their own", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
        setting({ ruleType: ComplianceRuleType.HasAlertOnCallRules }),
        setting({ ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules }),
        setting({ ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules }),
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [relationSeverity(CRITICAL_ID, "Critical", 1)],
        }),
      ],
      members: [ADA, GRACE],
    });

    await read();

    expect(readinessForProject).toHaveBeenCalledTimes(1);
    expect(readinessForUsers).toHaveBeenCalledTimes(1);
    expect(readinessForUser).not.toHaveBeenCalled();
    /*
     * Which channels make a rule count is readiness's judgement, made once for
     * all nine channels, so this path reads no channel column - and no
     * severity list - of its own.
     */
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
    expect(alertSeverityFindBy).not.toHaveBeenCalled();
    expect(projectFindOneById).not.toHaveBeenCalled();
  });

  test.each<[string, Array<StubSetting>]>([
    ["no rule at all", []],
    [
      "only method rules",
      [setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod })],
    ],
    [
      "only a disabled on-call rule",
      [
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: false,
        }),
      ],
    ],
    [
      "only on-call rules with a channel",
      [
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ],
    ],
    [
      "only an unrecognised rule type",
      [setting({ ruleType: "HasCarrierPigeon" })],
    ],
  ])(
    "readiness is not computed at all with %s",
    async (_label: string, settings: Array<StubSetting>) => {
      stage({ settings: settings, members: [ADA] });

      await read();

      expect(readinessForProject).not.toHaveBeenCalled();
      expect(readinessForUsers).not.toHaveBeenCalled();
      expect(readinessForUser).not.toHaveBeenCalled();
    },
  );
});

/*
 * ------------------------------------------------------------------------- *
 * On-call rules WITH a channel - rules, severities and the methods the rules
 * point at, each read once for the whole team.
 * -------------------------------------------------------------------------
 */

describe("on-call rules for one channel", () => {
  const CALL_ID: ObjectID = new ObjectID(
    "ca110000-0000-4000-8000-000000000001",
  );

  function callForCritical(): StubSetting {
    return setting({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [relationSeverity(CRITICAL_ID, "Critical", 1)],
    });
  }

  function adaCallRule(overrides: Partial<StubRule> = {}): StubRule {
    return {
      _id: "rule-ada-call",
      userId: USER_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: CRITICAL_ID,
      userCallId: CALL_ID,
      ...overrides,
    };
  }

  function stageCallRule(data: {
    rules: Array<StubRule>;
    methods: Array<StubMethod>;
    settings?: Array<StubSetting> | undefined;
  }): void {
    stage({
      settings: data.settings || [callForCritical()],
      members: [ADA, GRACE],
    });
    incidentSeverityFindBy.mockResolvedValue([
      projectSeverity(CRITICAL_ID, "Critical", 1),
      projectSeverity(MAJOR_ID, "Major", 2),
    ] as never);
    notificationRuleFindBy.mockResolvedValue(data.rules as never);
    userCallFindBy.mockResolvedValue(data.methods as never);
  }

  test("the project's severities are read once, for the kind needed only, most severe first", async () => {
    stageCallRule({ rules: [], methods: [] });

    await read();

    expect(incidentSeverityFindBy).toHaveBeenCalledTimes(1);
    expect(alertSeverityFindBy).not.toHaveBeenCalled();

    const call: CapturedFindBy = firstCall(incidentSeverityFindBy);
    expect(call.query).toEqual({ projectId: PROJECT_ID });
    expect(call.select).toEqual({ _id: true, name: true, order: true });
    expect(call.sort).toEqual({ order: SortOrder.Ascending });
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
    expect(call.props?.isRoot).toBe(true);
  });

  test("an alert channel rule reads the alert severities, and both kinds are read when both are needed", async () => {
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
      ],
      members: [ADA],
    });

    await read();

    expect(alertSeverityFindBy).toHaveBeenCalledTimes(1);
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();

    jest.clearAllMocks();
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
        callForCritical(),
      ],
      members: [ADA],
    });

    await read();

    expect(alertSeverityFindBy).toHaveBeenCalledTimes(1);
    expect(incidentSeverityFindBy).toHaveBeenCalledTimes(1);
  });

  test("ONE rule read for the team: the rule types needed, and the columns that judge them", async () => {
    stageCallRule({ rules: [], methods: [] });

    await read();

    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    expect(Object.keys(call.query).sort()).toEqual([
      "projectId",
      "ruleType",
      "userId",
    ]);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(includedIds(call.query["userId"])).toEqual([
      USER_ID.toString(),
      OTHER_USER_ID.toString(),
    ]);
    expect(includedIds(call.query["ruleType"])).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    ]);
    expect(call.select).toEqual({
      _id: true,
      userId: true,
      ruleType: true,
      incidentSeverityId: true,
      alertSeverityId: true,
      isOptOut: true,
      userCallId: true,
    });
    expect(call.sort).toEqual({ _id: SortOrder.Ascending });
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
    expect(call.props?.isRoot).toBe(true);
  });

  test("several channel rules still share ONE rule read, selecting each channel's column and no other", async () => {
    stage({
      settings: [
        callForCritical(),
        setting({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
        setting({
          ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ],
      members: [ADA, GRACE],
    });

    await read();

    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    expect(includedIds(call.query["ruleType"])).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    ]);
    expect(call.select).toEqual({
      _id: true,
      userId: true,
      ruleType: true,
      incidentSeverityId: true,
      alertSeverityId: true,
      isOptOut: true,
      userCallId: true,
      userPushId: true,
    });
  });

  const CHANNEL_COLUMNS: Array<
    [ComplianceNotificationChannel, keyof StubRule]
  > = [
    [ComplianceNotificationChannel.Call, "userCallId"],
    [ComplianceNotificationChannel.SMS, "userSmsId"],
    [ComplianceNotificationChannel.Push, "userPushId"],
    [ComplianceNotificationChannel.Email, "userEmailId"],
    [ComplianceNotificationChannel.WhatsApp, "userWhatsAppId"],
    [ComplianceNotificationChannel.Telegram, "userTelegramId"],
    [ComplianceNotificationChannel.Slack, "userSlackId"],
    [ComplianceNotificationChannel.MicrosoftTeams, "userMicrosoftTeamsId"],
    [ComplianceNotificationChannel.Webhook, "userWebhookId"],
  ];

  test.each(CHANNEL_COLUMNS)(
    "%s: the rule's %s column is followed to ONE read of the method rows it points at",
    async (channel: ComplianceNotificationChannel, column: keyof StubRule) => {
      const methodId: ObjectID = ObjectID.generate();
      const graceMethodId: ObjectID = ObjectID.generate();

      stage({
        settings: [
          setting({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: channel,
            incidentSeverities: [relationSeverity(CRITICAL_ID, "Critical", 1)],
          }),
        ],
        members: [ADA, GRACE],
      });
      incidentSeverityFindBy.mockResolvedValue([
        projectSeverity(CRITICAL_ID, "Critical", 1),
      ] as never);
      notificationRuleFindBy.mockResolvedValue([
        {
          _id: "rule-ada",
          userId: USER_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: CRITICAL_ID,
          [column]: methodId,
        },
        // The same method referenced twice is asked for once.
        {
          _id: "rule-ada-again",
          userId: USER_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: CRITICAL_ID,
          [column]: methodId,
        },
        {
          _id: "rule-grace",
          userId: OTHER_USER_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: CRITICAL_ID,
          [column]: graceMethodId,
        },
      ] as never);
      methodSpyFor(channel).mockResolvedValue([
        { _id: methodId.toString(), userId: USER_ID, isVerified: true },
        {
          _id: graceMethodId.toString(),
          userId: OTHER_USER_ID,
          isVerified: false,
        },
      ] as never);

      const status: TeamComplianceStatusJSON = await read();

      expect(firstCall(notificationRuleFindBy).select?.[column]).toBe(true);

      const spy: jest.SpyInstance = methodSpyFor(channel);
      expect(spy).toHaveBeenCalledTimes(1);

      const call: CapturedFindBy = firstCall(spy);
      expect(Object.keys(call.query).sort()).toEqual(["_id", "projectId"]);
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(includedIds(call.query["_id"])).toEqual([
        methodId.toString(),
        graceMethodId.toString(),
      ]);
      expect(call.select).toEqual(
        channel === ComplianceNotificationChannel.Webhook
          ? { _id: true, userId: true }
          : { _id: true, userId: true, isVerified: true },
      );
      expect(call.sort).toEqual({ _id: SortOrder.Ascending });
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
      expect(call.props?.isRoot).toBe(true);

      expect(statusOf(status, USER_ID).isCompliant).toBe(true);

      /*
       * Grace's method is unverified. For every channel but webhooks that is
       * exactly what she is told; a webhook has no verification, so hers
       * covers her.
       */
      if (channel === ComplianceNotificationChannel.Webhook) {
        expect(statusOf(status, OTHER_USER_ID).isCompliant).toBe(true);
      } else {
        expect(reasonsOf(status, OTHER_USER_ID)[0]).toContain(
          "points at an unverified",
        );
      }
    },
  );

  test("the method read is skipped when no rule points at a method on the channel", async () => {
    stageCallRule({
      rules: [
        adaCallRule({ userCallId: undefined, userEmailId: CALL_ID }),
        adaCallRule({ _id: "opt-out", userCallId: undefined, isOptOut: true }),
      ],
      methods: [],
    });

    const status: TeamComplianceStatusJSON = await read();

    expect(userCallFindBy).not.toHaveBeenCalled();
    expect(userEmailFindBy).not.toHaveBeenCalled();
    expect(reasonsOf(status, USER_ID)).toEqual([
      "Opted out of incident notifications for: Critical",
    ]);
  });

  test("a rule with a NULL isOptOut is a rule, not an opt-out - legacy rows are all like this", async () => {
    stageCallRule({
      rules: [adaCallRule({ isOptOut: null })],
      methods: [{ _id: CALL_ID.toString(), userId: USER_ID, isVerified: true }],
    });

    expect(statusOf(await read(), USER_ID).isCompliant).toBe(true);
  });

  test("an explicit isOptOut: false is a rule too", async () => {
    stageCallRule({
      rules: [adaCallRule({ isOptOut: false })],
      methods: [{ _id: CALL_ID.toString(), userId: USER_ID, isVerified: true }],
    });

    expect(statusOf(await read(), USER_ID).isCompliant).toBe(true);
  });

  test("an opt-out does not satisfy a channel rule", async () => {
    stageCallRule({
      rules: [adaCallRule({ userCallId: undefined, isOptOut: true })],
      methods: [],
    });

    expect(reasonsOf(await read(), USER_ID)).toEqual([
      "Opted out of incident notifications for: Critical",
    ]);
  });

  test.each<[string, Array<StubMethod>]>([
    [
      "unverified",
      [{ _id: CALL_ID.toString(), userId: USER_ID, isVerified: false }],
    ],
    [
      "owned by somebody else",
      [{ _id: CALL_ID.toString(), userId: OTHER_USER_ID, isVerified: true }],
    ],
    ["not found in this project", []],
  ])(
    "a rule whose method is %s is reported as pointing at an unverified number",
    async (_label: string, methodRows: Array<StubMethod>) => {
      stageCallRule({ rules: [adaCallRule()], methods: methodRows });

      expect(reasonsOf(await read(), USER_ID)).toEqual([
        "The Call rule for incident severities Critical points at an unverified phone number for calls",
      ]);
    },
  );

  test("rows of other rule types, other people or the other severity column cover nothing", async () => {
    /*
     * The read filters on rule type already; these rows are what a careless
     * in-memory fold would still count. The tests of the real route stub every
     * notification-rule read with one list, so this path must not trust the
     * query alone.
     */
    stageCallRule({
      rules: [
        adaCallRule({ ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL }),
        adaCallRule({ ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT }),
        adaCallRule({
          incidentSeverityId: undefined,
          alertSeverityId: CRITICAL_ID,
        }),
        adaCallRule({ userId: ObjectID.generate() }),
      ],
      methods: [{ _id: CALL_ID.toString(), userId: USER_ID, isVerified: true }],
    });

    expect(reasonsOf(await read(), USER_ID)).toEqual([
      "No Call rule for incident severities: Critical",
    ]);
  });

  test("reasons use the project's current severity names and order, not the rule's copy", async () => {
    stageCallRule({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ],
      rules: [],
      methods: [],
    });
    incidentSeverityFindBy.mockResolvedValue([
      projectSeverity(MAJOR_ID, "Sev2", 2),
      projectSeverity(CRITICAL_ID, "Sev1", 1),
    ] as never);

    expect(reasonsOf(await read(), USER_ID)).toEqual([
      "No Call rule for incident severities: Sev1, Sev2",
    ]);
  });

  test("channel rules never consult readiness", async () => {
    stageCallRule({ rules: [], methods: [] });

    await read();

    expect(readinessForProject).not.toHaveBeenCalled();
    expect(readinessForUsers).not.toHaveBeenCalled();
  });

  test("an any-channel rule and a channel rule together: one readiness pass AND one rule read", async () => {
    stage({
      settings: [
        callForCritical(),
        setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
      ],
      members: [ADA, GRACE],
    });

    await read();

    expect(readinessForProject).toHaveBeenCalledTimes(1);
    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);
    expect(ruleReads()[0]!.select?.["userCallId"]).toBe(true);
  });

  test("a disabled channel rule reads nothing", async () => {
    stage({
      settings: [{ ...callForCritical(), enabled: false }],
      members: [ADA],
    });

    await read();

    expect(notificationRuleFindBy).not.toHaveBeenCalled();
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
    expect(userCallFindBy).not.toHaveBeenCalled();
    expect(projectFindOneById).not.toHaveBeenCalled();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * The project's channel switches - read only when a rule relies on one.
 * -------------------------------------------------------------------------
 */

describe("project channel switches", () => {
  test("a Call rule reads the project's call switch, and only it, as root", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
      ],
      members: [ADA],
    });

    await read();

    expect(projectFindOneById).toHaveBeenCalledTimes(1);

    const call: CapturedFindOneById = projectFindOneById.mock
      .calls[0]![0] as CapturedFindOneById;
    expect(call.id).toBe(PROJECT_ID);
    expect(call.select).toEqual({ _id: true, enableCallNotifications: true });
    expect(call.props?.isRoot).toBe(true);
  });

  test("every switch an enabled rule relies on is read in ONE project read", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationSMSMethod }),
        setting({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
        setting({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Telegram,
        }),
        setting({
          ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
          enabled: false,
        }),
      ],
      members: [ADA],
    });

    await read();

    expect(projectFindOneById).toHaveBeenCalledTimes(1);
    expect(
      (projectFindOneById.mock.calls[0]![0] as CapturedFindOneById).select,
    ).toEqual({
      _id: true,
      enableCallNotifications: true,
      enableSmsNotifications: true,
      enableTelegramNotifications: true,
    });
  });

  test("a switched-off channel is a warning on the rule, not a failure of its members", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
      ],
      members: [ADA],
    });
    userCallFindBy.mockResolvedValue([
      { _id: "call-1", userId: USER_ID },
    ] as never);
    projectFindOneById.mockResolvedValue({
      enableCallNotifications: false,
    } as never);

    const status: TeamComplianceStatusJSON = await read();

    expect(status.complianceSettings[0]!.warnings).toEqual([
      "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. Turn them on in Project Settings > Notification Settings.",
    ]);
    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
  });

  test("a switched-on channel warns about nothing", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
      ],
      members: [ADA],
    });

    expect((await read()).complianceSettings[0]!.warnings).toEqual([]);
  });

  test("a project row that cannot be read is reported as switched off - the answer that gets it looked at", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationSMSMethod }),
      ],
      members: [ADA],
    });
    projectFindOneById.mockResolvedValue(null as never);

    expect((await read()).complianceSettings[0]!.warnings).toHaveLength(1);
  });

  test("the warning is computed even for a team with no members - it is about the rule", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
      ],
      members: [],
    });
    projectFindOneById.mockResolvedValue({
      enableCallNotifications: false,
    } as never);

    expect((await read()).complianceSettings[0]!.warnings).toHaveLength(1);
  });

  test.each<[string, Array<StubSetting>]>([
    [
      "Push, Email, Slack, Microsoft Teams and webhook rules",
      [
        setting({ ruleType: ComplianceRuleType.HasNotificationPushMethod }),
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
        setting({ ruleType: ComplianceRuleType.HasNotificationSlackMethod }),
        setting({
          ruleType: ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
        }),
        setting({ ruleType: ComplianceRuleType.HasNotificationWebhookMethod }),
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
      ],
    ],
    [
      "on-call rules for any channel",
      [setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules })],
    ],
    [
      "disabled Call and SMS rules",
      [
        setting({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          enabled: false,
        }),
        setting({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.SMS,
          enabled: false,
        }),
      ],
    ],
    [
      "an unrecognised rule",
      [
        setting({
          ruleType: "HasCarrierPigeon",
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ],
    ],
  ])(
    "the project is not read for %s",
    async (_label: string, settings: Array<StubSetting>) => {
      stage({ settings: settings, members: [ADA] });

      await read();

      expect(projectFindOneById).not.toHaveBeenCalled();
    },
  );
});

/*
 * ------------------------------------------------------------------------- *
 * The shape of the whole render: constant query count, root reads, tenant
 * scoping, limits.
 * -------------------------------------------------------------------------
 */

describe("the whole render", () => {
  // One of every kind of rule, all enabled.
  function everyKindOfRule(
    incidentSeverities: Array<StubRelationSeverity>,
  ): Array<StubSetting> {
    return [
      setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      setting({ ruleType: ComplianceRuleType.HasNotificationSMSMethod }),
      setting({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
      setting({ ruleType: ComplianceRuleType.HasNotificationPushMethod }),
      setting({ ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod }),
      setting({ ruleType: ComplianceRuleType.HasNotificationTelegramMethod }),
      setting({ ruleType: ComplianceRuleType.HasNotificationSlackMethod }),
      setting({
        ruleType: ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
      }),
      setting({ ruleType: ComplianceRuleType.HasNotificationWebhookMethod }),
      setting({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
      setting({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
      }),
      setting({
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: incidentSeverities,
      }),
      setting({
        ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Webhook,
      }),
    ];
  }

  interface RenderScale {
    members: number;
    severities: number;
  }

  // Stage a team and project of the given size, where everybody has a rule for everything.
  function stageAtScale(scale: RenderScale): void {
    const members: Array<StubUser> = Array.from(
      { length: scale.members },
      (_: unknown, index: number): StubUser => {
        return {
          id: ObjectID.generate(),
          name: `Member ${index}`,
          email: `member${index}@example.com`,
        };
      },
    );
    const incident: Array<ObjectID> = Array.from(
      { length: scale.severities },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );
    const alert: Array<ObjectID> = Array.from(
      { length: scale.severities },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    stage({
      settings: everyKindOfRule(
        incident.map((id: ObjectID, index: number): StubRelationSeverity => {
          return relationSeverity(id, `Sev${index}`, index);
        }),
      ),
      members: members,
    });

    incidentSeverityFindBy.mockResolvedValue(
      incident.map((id: ObjectID, index: number): Record<string, unknown> => {
        return projectSeverity(id, `Sev${index}`, index);
      }) as never,
    );
    alertSeverityFindBy.mockResolvedValue(
      alert.map((id: ObjectID, index: number): Record<string, unknown> => {
        return projectSeverity(id, `Alert${index}`, index);
      }) as never,
    );

    const rules: Array<StubRule> = [];
    const methods: Array<StubMethod> = [];

    for (const member of members) {
      const methodId: ObjectID = ObjectID.generate();
      methods.push({
        _id: methodId.toString(),
        userId: member.id,
        isVerified: true,
      });

      for (const severityId of incident) {
        rules.push({
          _id: ObjectID.generate().toString(),
          userId: member.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          incidentSeverityId: severityId,
          userCallId: methodId,
        });
      }

      for (const severityId of alert) {
        rules.push({
          _id: ObjectID.generate().toString(),
          userId: member.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: severityId,
          userPushId: methodId,
        });
        rules.push({
          _id: ObjectID.generate().toString(),
          userId: member.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
          alertSeverityId: severityId,
          userWebhookId: methodId,
        });
      }
    }

    notificationRuleFindBy.mockResolvedValue(rules as never);

    for (const spy of everyMethodSpy()) {
      spy.mockResolvedValue(methods as never);
    }

    readinessForProject.mockResolvedValue(
      summaryWith(
        members.map((member: StubUser): UserReadiness => {
          return readinessWith([], member.id);
        }),
      ) as never,
    );
  }

  function readCounts(): Array<number> {
    return [
      ...everyFindBySpy(),
      teamFindOneBy,
      projectFindOneById,
      readinessForProject,
      readinessForUsers,
      readinessForUser,
    ].map((spy: jest.SpyInstance): number => {
      return spy.mock.calls.length;
    });
  }

  test("the number of reads does not grow with the members or the severities", async () => {
    /*
     * The N+1, in every form this page has had it: one findBy per severity per
     * member, one readiness resolution per member, one existence check per
     * member per method rule. The proof is comparative: the same rules over
     * six times the members and six times the severities must cost exactly the
     * same reads, service by service.
     */
    stageAtScale({ members: 1, severities: 1 });
    const small: TeamComplianceStatusJSON = await read();
    const smallCounts: Array<number> = readCounts();

    jest.clearAllMocks();

    stageAtScale({ members: 6, severities: 6 });
    const large: TeamComplianceStatusJSON = await read();

    expect(readCounts()).toEqual(smallCounts);

    // And it is a real render: everybody is set up, so everybody passes.
    expect(small.userComplianceStatuses).toHaveLength(1);
    expect(large.userComplianceStatuses).toHaveLength(6);
    for (const status of large.userComplianceStatuses) {
      expect(status.nonCompliantRules).toEqual([]);
    }
    expect(large.complianceSettings).toHaveLength(13);
  });

  test("every read is root, every tenant-scoped read carries this project, and none is capped at 100", async () => {
    stageAtScale({ members: 3, severities: 2 });

    await read();

    let readsInspected: number = 0;

    for (const spy of everyFindBySpy()) {
      for (const call of callsOf(spy)) {
        readsInspected++;

        expect(call.props?.isRoot).toBe(true);
        expect(call.limit).toBe(LIMIT_PER_PROJECT);
        expect(call.limit).not.toBe(100);

        /*
         * Root reads make the projectId in the QUERY the only tenant boundary
         * there is. User rows are the one exception: they have no project, and
         * are read only by the ids this project's own memberships name.
         */
        if (spy !== userFindBy) {
          expect(String(call.query["projectId"])).toBe(PROJECT_ID.toString());
        }
      }
    }

    // Guards the guard: an assertion over a handful of reads proves little.
    expect(readsInspected).toBeGreaterThanOrEqual(15);

    const team: CapturedFindBy = firstCall(teamFindOneBy);
    expect(team.props?.isRoot).toBe(true);
    expect(team.query["projectId"]).toBe(PROJECT_ID);

    const project: CapturedFindOneById = projectFindOneById.mock
      .calls[0]![0] as CapturedFindOneById;
    expect(project.id).toBe(PROJECT_ID);
    expect(project.props?.isRoot).toBe(true);
  });

  test("no enabled rules: every member is compliant without a single lookup beyond the team", async () => {
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasNotificationEmailMethod,
          enabled: false,
        }),
      ],
      members: [ADA],
    });

    const status: TeamComplianceStatusJSON = await read();

    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
    for (const spy of everyMethodSpy()) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(notificationRuleFindBy).not.toHaveBeenCalled();
    expect(readinessForProject).not.toHaveBeenCalled();
    expect(projectFindOneById).not.toHaveBeenCalled();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * What comes back. The judgements are TeamComplianceEvaluator.test.ts; what is
 * pinned here is that the rows read arrive in the payload intact.
 * -------------------------------------------------------------------------
 */

describe("the assembled status", () => {
  test("returns the TeamComplianceStatusJSON wire shape: ids as strings, an ISO timestamp", async () => {
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [ADA],
    });

    const before: number = Date.now();
    const status: TeamComplianceStatusJSON = await read();
    const after: number = Date.now();

    expect(status.teamId).toBe(TEAM_ID.toString());
    expect(status.teamName).toBe("Platform On-Call");
    expect(new Date(status.evaluatedAt).toISOString()).toBe(status.evaluatedAt);
    expect(new Date(status.evaluatedAt).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(new Date(status.evaluatedAt).getTime()).toBeLessThanOrEqual(after);
    expect(statusOf(status, USER_ID).userId).toBe(USER_ID.toString());
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
  });

  test("a team row with no name is Unknown Team", async () => {
    teamFindOneBy.mockResolvedValue({} as Team);

    expect((await read()).teamName).toBe("Unknown Team");
  });

  test("rules are listed oldest first, even when the rows arrive in another order", async () => {
    const newest: StubSetting = setting({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
    const oldest: StubSetting = setting({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const middle: StubSetting = setting({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    stage({ settings: [newest, oldest, middle], members: [] });

    expect(
      (await read()).complianceSettings.map(
        (rule: TeamComplianceRuleJSON): string => {
          return rule.settingId;
        },
      ),
    ).toEqual([oldest._id, middle._id, newest._id]);
  });

  test("a rule's severities arrive named, coloured (as hex) and most severe first", async () => {
    stage({
      settings: [
        setting({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [
            relationSeverity(MAJOR_ID, "Major", 2, PROJECT_ID),
            relationSeverity(
              CRITICAL_ID,
              "Critical",
              1,
              PROJECT_ID,
              new Color("#9f1239"),
            ),
          ],
        }),
      ],
      members: [],
    });

    const rule: TeamComplianceRuleJSON = (await read()).complianceSettings[0]!;

    expect(rule.notificationChannel).toBe(ComplianceNotificationChannel.Call);
    expect(rule.severityKind).toBe("Incident");
    expect(rule.appliesToAllSeverities).toBe(false);
    expect(rule.severities).toEqual([
      { id: CRITICAL_ID.toString(), name: "Critical", color: "#9f1239" },
      { id: MAJOR_ID.toString(), name: "Major" },
    ]);
  });

  test("an unset enabled flag is reported as disabled", async () => {
    stage({
      settings: [
        {
          ...setting({
            ruleType: ComplianceRuleType.HasNotificationEmailMethod,
          }),
          enabled: undefined,
        },
      ],
      members: [ADA],
    });

    const status: TeamComplianceStatusJSON = await read();

    expect(status.complianceSettings[0]!.enabled).toBe(false);
    expect(userEmailFindBy).not.toHaveBeenCalled();
  });

  test("an unrecognised rule type in the database is listed with a warning and checked against nobody", async () => {
    stage({
      settings: [setting({ ruleType: "HasCarrierPigeon" })],
      members: [ADA],
    });

    const status: TeamComplianceStatusJSON = await read();

    expect(status.complianceSettings[0]!.ruleType).toBe("HasCarrierPigeon");
    expect(status.complianceSettings[0]!.warnings).toEqual([
      "This rule type is not recognised, so it is not checked.",
    ]);
    expect(statusOf(status, USER_ID).isCompliant).toBe(true);
  });

  test("names fall back to the email, then to Unknown User; the picture id is carried as a string", async () => {
    const pictureId: ObjectID = ObjectID.generate();

    stage({
      members: [
        {
          id: USER_ID,
          email: "nameless@example.com",
          profilePictureId: pictureId,
        },
        { id: OTHER_USER_ID },
      ],
    });

    const status: TeamComplianceStatusJSON = await read();

    expect(statusOf(status, USER_ID).userName).toBe("nameless@example.com");
    expect(statusOf(status, USER_ID).userProfilePictureId).toBe(
      pictureId.toString(),
    );
    expect(statusOf(status, OTHER_USER_ID).userName).toBe("Unknown User");
    expect(statusOf(status, OTHER_USER_ID).userEmail).toBe("");
    expect("userProfilePictureId" in statusOf(status, OTHER_USER_ID)).toBe(
      false,
    );
  });

  test("a failed read is not dressed up as a verdict - the error propagates", async () => {
    /*
     * A member whose data is merely absent is handled where that absence has
     * meaning. A query that FAILS is an infrastructure fault, and turning it
     * into "every member is non-compliant" would present a database outage as
     * forty people misconfiguring their phones.
     */
    stage({
      settings: [
        setting({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [ADA],
    });
    userEmailFindBy.mockRejectedValue(new Error("connection reset") as never);

    await expect(read()).rejects.toThrow("connection reset");
  });
});

describe("the batched readiness contract this service depends on", () => {
  test("exists on the real service", () => {
    /*
     * The readiness service is stubbed for every other test in this file, which
     * would happily keep passing if the entry points it stubs were renamed.
     * This is the one assertion made against the REAL class.
     */
    const actual: { default: Record<string, unknown> } = jest.requireActual(
      "Common/Server/Services/OnCallReadinessService",
    );

    expect(typeof actual.default["getReadinessForProject"]).toBe("function");
    expect(typeof actual.default["getReadinessForUsers"]).toBe("function");
  });
});
