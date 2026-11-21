import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import OnCallDutyPolicyEscalationRuleScheduleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import EscalationRuleReach, {
  PersonRulePath,
  PolicyReachOfPerson,
  RulePathKind,
} from "Common/Server/Utils/OnCall/EscalationRuleReach";
import OnCallHandoffPosts from "Common/Server/Utils/OnCall/OnCallHandoffPosts";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUserGroupSync from "Common/Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import URL from "Common/Types/API/URL";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "Common/Types/SMS/SMS";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
// Registers the job with the RunCron mocked below.
import "../../../../FeatureSet/Workers/Jobs/OnCallDutySchedule/RefreshHandoffTime";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE HAND-OFF TELLS EACH PERSON ONCE FOR EACH POLICY, AS THE WORKER RUNS IT
 * (issue #7969).
 *
 * OnCallDutySchedule:RefreshHandoffTime finds, every minute, the schedules
 * whose roster is due to move on, and refreshes each one
 * (refreshCurrentUserIdAndHandoffTimeInSchedule): it reads the roster as it
 * was, works out the roster now, tells whoever is no longer on call, on
 * call now and next (sendNotificationToUserOnScheduleHandoff), and only then
 * stores the new roster - so a send that fails is sent again the next
 * minute.
 *
 * A policy whose two escalation rules page the schedule told each of them
 * twice. Driven here through the job RunCron registered and the real
 * refresh and hand-off, with the database reads, the roster's working-out
 * (getCurrrentUserIdAndHandoffTimeInSchedule, pinned by its own suites) and
 * the sends stubbed.
 */

/*
 * RunCron schedules nothing here: the job registered as its module is
 * imported is read off its calls below, and run by hand. (jest hoists every
 * jest.mock above the imports.)
 */
jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const JOB_NAME: string = "OnCallDutySchedule:RefreshHandoffTime";

// The job itself, as RefreshHandoffTime registered it.
const runJob: () => Promise<void> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === JOB_NAME;
})![2] as () => Promise<void>;

const PROJECT_ID: ObjectID = new ObjectID(
  "79692222-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "79692222-0000-4000-8000-000000000002",
);
const PAYMENTS: ObjectID = new ObjectID("79692222-0000-4000-8000-000000000003");
const CHECKOUT: ObjectID = new ObjectID("79692222-0000-4000-8000-000000000004");
const CARL: ObjectID = new ObjectID("79692222-0000-4000-8000-0000000000c1");
const ANA: ObjectID = new ObjectID("79692222-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("79692222-0000-4000-8000-0000000000b1");

const NAMES: Record<string, string> = {
  [CARL.toString()]: "Carl",
  [ANA.toString()]: "Ana",
  [BOB.toString()]: "Bob",
};

const YESTERDAY: Date = new Date("2026-11-13T22:50:00.000Z");
const TODAY: Date = new Date("2026-11-14T22:50:00.000Z");
const TOMORROW: Date = new Date("2026-11-15T22:50:00.000Z");
const DAY_AFTER: Date = new Date("2026-11-16T22:50:00.000Z");

// The roster as the schedule stored it: Carl on call until today, Ana next.
function storedSchedule(): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.currentUserIdOnRoster = CARL;
  schedule.rosterStartAt = YESTERDAY;
  schedule.rosterHandoffAt = TODAY;
  schedule.nextUserIdOnRoster = ANA;
  schedule.rosterNextStartAt = TODAY;
  schedule.rosterNextHandoffAt = TOMORROW;
  return schedule;
}

// The roster now: Ana on call until tomorrow, then Bob.
const ROSTER_NOW: {
  currentUserId: ObjectID | null;
  handOffTimeAt: Date | null;
  nextUserId: ObjectID | null;
  nextHandOffTimeAt: Date | null;
  rosterStartAt: Date | null;
  nextRosterStartAt: Date | null;
} = {
  currentUserId: ANA,
  handOffTimeAt: TOMORROW,
  nextUserId: BOB,
  nextHandOffTimeAt: DAY_AFTER,
  rosterStartAt: TODAY,
  nextRosterStartAt: TOMORROW,
};

function attachment(data: {
  policyId: ObjectID;
  policyName: string;
  ruleName: string;
  order: number;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = data.policyId;
  policy.name = data.policyName;

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = ObjectID.generate();
  rule.name = data.ruleName;
  rule.order = data.order;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.name = "Primary";

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.onCallDutyPolicyId = data.policyId;
  row.pageNextInRotation = false;
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.onCallDutyPolicySchedule = schedule;
  return row;
}

const PAYMENTS_FIRST_LINE: OnCallDutyPolicyEscalationRuleSchedule = attachment({
  policyId: PAYMENTS,
  policyName: "Payments",
  ruleName: "First line",
  order: 1,
});
const PAYMENTS_ESCALATE: OnCallDutyPolicyEscalationRuleSchedule = attachment({
  policyId: PAYMENTS,
  policyName: "Payments",
  ruleName: "Escalate",
  order: 2,
});
const CHECKOUT_FIRST_LINE: OnCallDutyPolicyEscalationRuleSchedule = attachment({
  policyId: CHECKOUT,
  policyName: "Checkout",
  ruleName: "First line",
  order: 1,
});

// What one sendUserNotification sent: one of each of the person's channels.
interface Sent {
  person: string;
  eventType: NotificationSettingEventType;
  policyId: string;
  email: EmailEnvelope;
  sms: SMSMessage;
  call: CallRequestMessage;
  push: PushNotificationMessage;
}

let sent: Array<Sent>;
let stored: Array<Record<string, unknown>>;
let timeLogsStarted: Array<string>;
// Who is a member of the project: everyone the hand-off names, unless a test says otherwise.
let memberUserIds: Array<ObjectID>;

function tellSummary(): Array<string> {
  return sent.map((message: Sent): string => {
    return `${message.person}: ${message.eventType} (${
      message.policyId === PAYMENTS.toString() ? "Payments" : "Checkout"
    })`;
  });
}

async function tick(): Promise<void> {
  await runJob();
}

function scheduleIsDue(): void {
  // The first of the job's three reads: a roster whose hand-off has come.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findAllBy")
    .mockResolvedValueOnce([storedSchedule()] as never)
    .mockResolvedValue([] as never);
}

function attachedRows(
  rows: Array<OnCallDutyPolicyEscalationRuleSchedule>,
): void {
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue(rows as never);
}

beforeEach(() => {
  sent = [];
  stored = [];
  timeLogsStarted = [];
  memberUserIds = [CARL, ANA, BOB];

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);

  // No lock to be had: the refresh goes on without one, as it does then.
  jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no Redis here"));
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
    .mockImplementation((async () => {
      return storedSchedule();
    }) as never);
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "getCurrrentUserIdAndHandoffTimeInSchedule",
    )
    .mockResolvedValue(ROSTER_NOW as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
    .mockImplementation((async (data: { data: Record<string, unknown> }) => {
      stored.push(data.data);
    }) as never);
  jest
    .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
    .mockResolvedValue(undefined as never);

  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockImplementation((async (_projectId: ObjectID, policyId: ObjectID) => {
      return URL.fromString(
        `https://oneuptime.test/dashboard/on-call-duty/policies/${policyId.toString()}`,
      );
    }) as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      onCallPolicyId: ObjectID;
      emailEnvelope: EmailEnvelope;
      smsMessage: SMSMessage;
      callRequestMessage: CallRequestMessage;
      pushNotificationMessage: PushNotificationMessage;
    }) => {
      sent.push({
        person: NAMES[data.userId.toString()] || "?",
        eventType: data.eventType,
        policyId: data.onCallPolicyId.toString(),
        email: data.emailEnvelope,
        sms: data.smsMessage,
        call: data.callRequestMessage,
        push: data.pushNotificationMessage,
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockImplementation((async (data: {
      onCallDutyPolicyEscalationRuleId: ObjectID;
    }) => {
      timeLogsStarted.push(data.onCallDutyPolicyEscalationRuleId.toString());
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest.spyOn(OnCallHandoffPosts, "post").mockResolvedValue(undefined as never);

  // Nothing on the policies pages whoever's shift ended but the schedule.
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
      return new Set<string>(
        data.userIds
          .filter((userId: ObjectID): boolean => {
            return memberUserIds.some((member: ObjectID): boolean => {
              return member.toString() === userId.toString();
            });
          })
          .map((userId: ObjectID): string => {
            return userId.toString().toLowerCase();
          }),
      );
    }) as never);
  jest
    .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
    .mockResolvedValue(new Map() as PolicyReachOfPerson);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OnCallDutySchedule:RefreshHandoffTime, at a hand-off", () => {
  test("REGRESSION: a policy whose two rules page the schedule tells each person once, then stores the roster", async () => {
    scheduleIsDue();
    attachedRows([PAYMENTS_FIRST_LINE, PAYMENTS_ESCALATE]);

    await tick();

    // It was six: each of them once for First line and again for Escalate.
    expect(tellSummary()).toEqual([
      `Carl: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER} (Payments)`,
      `Ana: ${NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER} (Payments)`,
      `Bob: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER} (Payments)`,
    ]);

    // One send is one email, one text, one call and one push.
    for (const message of sent) {
      expect(message.email.subject).toMatch(/on-call for Payments$/);
      expect(message.sms.message).toContain("Payments");
      expect(message.call.data).toHaveLength(1);
      expect(message.push.body).toContain("Payments");
    }

    // Ana is on call for both rules: a time log for each.
    expect(timeLogsStarted).toEqual([
      PAYMENTS_FIRST_LINE.onCallDutyPolicyEscalationRule!.id!.toString(),
      PAYMENTS_ESCALATE.onCallDutyPolicyEscalationRule!.id!.toString(),
    ]);

    // The new roster is stored once everybody is told.
    expect(stored).toHaveLength(1);
    expect(String(stored[0]!["currentUserIdOnRoster"])).toBe(ANA.toString());
    expect(String(stored[0]!["nextUserIdOnRoster"])).toBe(BOB.toString());
  });

  test("two policies that page the schedule each tell each person once", async () => {
    scheduleIsDue();
    attachedRows([PAYMENTS_FIRST_LINE, PAYMENTS_ESCALATE, CHECKOUT_FIRST_LINE]);

    await tick();

    expect(tellSummary()).toEqual([
      `Carl: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER} (Payments)`,
      `Ana: ${NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER} (Payments)`,
      `Bob: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER} (Payments)`,
      `Carl: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER} (Checkout)`,
      `Ana: ${NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER} (Checkout)`,
      `Bob: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER} (Checkout)`,
    ]);
    expect(timeLogsStarted).toHaveLength(3);
    expect(stored).toHaveLength(1);
  });

  test("a send that fails stores no roster, and the next minute tells everybody once more - once each", async () => {
    scheduleIsDue();
    attachedRows([PAYMENTS_FIRST_LINE, PAYMENTS_ESCALATE]);

    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockRejectedValueOnce(new Error("the notification service is down"));

    await tick();

    // The refresh failed before it stored anything, and the job went on.
    expect(stored).toEqual([]);
    expect(logger.error).toHaveBeenCalled();

    // The next minute the roster is still the old one: they are told again.
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findAllBy")
      .mockResolvedValueOnce([storedSchedule()] as never)
      .mockResolvedValue([] as never);

    await tick();

    expect(
      sent.map((message: Sent): string => {
        return message.person;
      }),
    ).toEqual(["Carl", "Ana", "Bob"]);
    expect(stored).toHaveLength(1);
  });

  /*
   * The hand-off speaks for the policy as a whole (#10556): a shift ending
   * says nothing of a policy that still pages the person, and someone only
   * invited is told nothing and logged nowhere.
   */
  test("REGRESSION: a shift ending for someone a rule of the policy still names tells them nothing of it", async () => {
    scheduleIsDue();
    attachedRows([PAYMENTS_FIRST_LINE, PAYMENTS_ESCALATE, CHECKOUT_FIRST_LINE]);

    // Carl is named on another rule of Payments; Checkout pages him by nothing else.
    const named: PersonRulePath = {
      kind: RulePathKind.Person,
      rowId: ObjectID.generate().toString(),
      createdAt: null,
      teamId: null,
      scheduleId: null,
      policyId: PAYMENTS,
      ruleId: ObjectID.generate(),
    };
    jest
      .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
      .mockResolvedValue(
        new Map([[PAYMENTS.toString().toLowerCase(), [named]]]),
      );

    await tick();

    expect(tellSummary()).toEqual([
      `Ana: ${NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER} (Payments)`,
      `Bob: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER} (Payments)`,
      `Carl: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER} (Checkout)`,
      `Ana: ${NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER} (Checkout)`,
      `Bob: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER} (Checkout)`,
    ]);
    expect(stored).toHaveLength(1);
  });

  test("REGRESSION: someone only invited coming on call is told nothing and logged nowhere", async () => {
    scheduleIsDue();
    attachedRows([PAYMENTS_FIRST_LINE, PAYMENTS_ESCALATE]);
    memberUserIds = [CARL, BOB];

    await tick();

    // It was "Ana: now on call", and a time log for each rule.
    expect(tellSummary()).toEqual([
      `Carl: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER} (Payments)`,
      `Bob: ${NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER} (Payments)`,
    ]);
    expect(timeLogsStarted).toEqual([]);
    // The roster still moves on: Ana is on it, and paged once she joins.
    expect(String(stored[0]!["currentUserIdOnRoster"])).toBe(ANA.toString());
  });

  test("a roster that did not move tells nobody and stores nothing", async () => {
    scheduleIsDue();
    attachedRows([PAYMENTS_FIRST_LINE, PAYMENTS_ESCALATE]);

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "getCurrrentUserIdAndHandoffTimeInSchedule",
      )
      .mockResolvedValue({
        currentUserId: CARL,
        handOffTimeAt: TODAY,
        nextUserId: ANA,
        nextHandOffTimeAt: TOMORROW,
        rosterStartAt: YESTERDAY,
        nextRosterStartAt: TODAY,
      } as never);

    await tick();

    expect(sent).toEqual([]);
    expect(stored).toEqual([]);
  });
});
