import DatabaseConfig from "../../../Server/DatabaseConfig";
import IncomingCallLogItemService from "../../../Server/Services/IncomingCallLogItemService";
import IncomingCallLogService from "../../../Server/Services/IncomingCallLogService";
import IncomingCallMissedCallNotificationService from "../../../Server/Services/IncomingCallMissedCallNotificationService";
import IncomingCallPolicyService from "../../../Server/Services/IncomingCallPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import logger from "../../../Server/Utils/Logger";
import MissedCallNotification from "../../../Server/Utils/IncomingCall/MissedCallNotification";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import IncomingCallStatus from "../../../Types/IncomingCall/IncomingCallStatus";
import { IncomingCallStatusMessage } from "../../../Types/IncomingCall/MissedIncomingCall";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import Timezone from "../../../Types/Timezone";
import IncomingCallLog from "../../../Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "../../../Models/DatabaseModels/IncomingCallLogItem";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Telling an Incoming Call Policy's owners that a call reached nobody
 * (issue #4159): who is told, on which event, with what, and that nothing that
 * goes wrong along the way escapes to the call webhook.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CALL_LOG_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const ALICE: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888881");
const BOB: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888882");
const PROJECT_OWNER: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888889",
);

const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const CALL_LOG_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/incoming-call-policies/${POLICY_ID.toString()}/logs/${CALL_LOG_ID.toString()}`;

const STARTED_AT: Date = new Date("2026-10-01T22:00:00.000Z");

function makeUser(userId: ObjectID, timezone?: Timezone): User {
  const user: User = new User(userId);
  user.name = new Name(`User ${userId.toString().slice(-1)}`);
  user.email = new Email(`${userId.toString()}@acme.test`);
  if (timezone) {
    user.timezone = timezone;
  }
  return user;
}

function makeCallLog(
  overrides: {
    status?: IncomingCallStatus | undefined;
    statusMessage?: string | undefined;
    callerPhoneNumber?: string | undefined;
    policyName?: string | undefined;
  } = {},
): IncomingCallLog {
  const log: IncomingCallLog = new IncomingCallLog(CALL_LOG_ID);
  log.projectId = PROJECT_ID;
  log.incomingCallPolicyId = POLICY_ID;
  // A status passed as undefined means a log with no status at all.
  const status: IncomingCallStatus | undefined =
    "status" in overrides ? overrides.status : IncomingCallStatus.NoAnswer;
  if (status) {
    log.status = status;
  }
  if (overrides.statusMessage) {
    log.statusMessage = overrides.statusMessage;
  }
  if (overrides.callerPhoneNumber !== "") {
    log.callerPhoneNumber = new Phone(
      overrides.callerPhoneNumber || "+14155550999",
    );
  }
  log.routingPhoneNumber = new Phone("+14155550102");
  log.startedAt = STARTED_AT;
  log.endedAt = new Date(STARTED_AT.getTime() + 47_000);

  const project: Project = new Project(PROJECT_ID);
  project.name = "Acme";
  log.project = project;

  const policy: IncomingCallPolicy = new IncomingCallPolicy(POLICY_ID);
  policy.name = overrides.policyName ?? "Support Hotline";
  log.incomingCallPolicy = policy;

  return log;
}

function makeAttempt(data: {
  user: User;
  phone: string;
  ruleName?: string | undefined;
  ruleOrder: number;
  status: IncomingCallStatus;
  startSecond: number;
  endSecond: number;
}): IncomingCallLogItem {
  const item: IncomingCallLogItem = new IncomingCallLogItem(
    ObjectID.generate(),
  );
  item.incomingCallLogId = CALL_LOG_ID;
  item.user = data.user;
  item.userPhoneNumber = new Phone(data.phone);
  item.status = data.status;
  item.startedAt = new Date(STARTED_AT.getTime() + data.startSecond * 1000);
  item.endedAt = new Date(STARTED_AT.getTime() + data.endSecond * 1000);

  const rule: IncomingCallPolicyEscalationRule =
    new IncomingCallPolicyEscalationRule();
  if (data.ruleName !== undefined) {
    rule.name = data.ruleName;
  }
  rule.order = data.ruleOrder;
  item.incomingCallPolicyEscalationRule = rule;

  return item;
}

describe("IncomingCallMissedCallNotificationService", () => {
  let findCallLog: any;
  let findAttempts: any;
  let findOwners: any;
  let getProjectOwners: any;
  let ensureSetting: any;
  let sendUserNotification: any;
  let loggerError: any;
  let loggerWarn: any;

  async function notify(): Promise<void> {
    await IncomingCallMissedCallNotificationService.notifyOwnersOfMissedCall({
      incomingCallLogId: CALL_LOG_ID,
    });
  }

  function recipients(): Array<string> {
    return sendUserNotification.mock.calls.map((call: any): string => {
      return call[0].userId.toString();
    });
  }

  function sentTo(userId: ObjectID): any {
    return sendUserNotification.mock.calls.find((call: any): boolean => {
      return call[0].userId.toString() === userId.toString();
    })?.[0];
  }

  beforeEach(() => {
    findCallLog = jest
      .spyOn(IncomingCallLogService, "findOneById")
      .mockResolvedValue(makeCallLog());

    findAttempts = jest
      .spyOn(IncomingCallLogItemService, "findBy")
      .mockResolvedValue([
        makeAttempt({
          user: makeUser(ALICE),
          phone: "+14155551001",
          ruleName: "Primary on-call",
          ruleOrder: 1,
          status: IncomingCallStatus.NoAnswer,
          startSecond: 3,
          endSecond: 33,
        }),
        makeAttempt({
          user: makeUser(BOB),
          phone: "+14155551002",
          ruleName: "",
          ruleOrder: 2,
          status: IncomingCallStatus.NoAnswer,
          startSecond: 35,
          endSecond: 45,
        }),
      ] as never);

    findOwners = jest
      .spyOn(IncomingCallPolicyService, "findOwners")
      .mockResolvedValue([
        makeUser(ALICE, Timezone.EuropeLondon),
        makeUser(BOB),
      ]);

    getProjectOwners = jest
      .spyOn(ProjectService, "getOwners")
      .mockResolvedValue([makeUser(PROJECT_OWNER)]);

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));

    ensureSetting = jest
      .spyOn(UserNotificationSettingService, "ensureSettingExistsForUser")
      .mockResolvedValue(undefined);

    sendUserNotification = jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockResolvedValue(undefined);

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    loggerWarn = jest.spyOn(logger, "warn").mockImplementation((): void => {});
    loggerError = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("who is told", () => {
    test("every owner of the policy, once each", async () => {
      await notify();

      expect(findOwners).toHaveBeenCalledWith(POLICY_ID);
      expect(recipients()).toEqual([ALICE.toString(), BOB.toString()]);
      expect(getProjectOwners).not.toHaveBeenCalled();
    });

    test("a person listed twice is told once", async () => {
      findOwners.mockResolvedValue([
        makeUser(ALICE),
        makeUser(ALICE),
        makeUser(BOB),
      ]);

      await notify();

      expect(recipients()).toEqual([ALICE.toString(), BOB.toString()]);
    });

    test("the project owners, when the policy has no owners", async () => {
      findOwners.mockResolvedValue([]);

      await notify();

      expect(getProjectOwners).toHaveBeenCalledWith(PROJECT_ID);
      expect(recipients()).toEqual([PROJECT_OWNER.toString()]);
    });

    test("an owner is told they own the policy; a project owner is told why they got it instead", async () => {
      await notify();
      expect(sentTo(ALICE).emailEnvelope.vars["isOwner"]).toBe("true");

      sendUserNotification.mockClear();
      findOwners.mockResolvedValue([]);

      await notify();
      expect(sentTo(PROJECT_OWNER).emailEnvelope.vars).not.toHaveProperty(
        "isOwner",
      );
    });

    test("nobody, with a warning, when neither the policy nor the project has owners", async () => {
      findOwners.mockResolvedValue([]);
      getProjectOwners.mockResolvedValue([]);

      await notify();

      expect(sendUserNotification).not.toHaveBeenCalled();
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("has no owners"),
        expect.objectContaining({
          projectId: PROJECT_ID.toString(),
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallLogId: CALL_LOG_ID.toString(),
        }),
      );
    });

    test("a recipient without an id is skipped", async () => {
      const withoutId: User = new User();
      findOwners.mockResolvedValue([withoutId, makeUser(BOB)]);

      await notify();

      expect(recipients()).toEqual([BOB.toString()]);
    });
  });

  describe("on which event", () => {
    test("each recipient's missed call setting is seeded before the send", async () => {
      const order: Array<string> = [];
      ensureSetting.mockImplementation((data: any): Promise<void> => {
        order.push(`ensure ${data.userId.toString()}`);
        return Promise.resolve();
      });
      sendUserNotification.mockImplementation((data: any): Promise<void> => {
        order.push(`send ${data.userId.toString()}`);
        return Promise.resolve();
      });

      await notify();

      expect(order).toEqual([
        `ensure ${ALICE.toString()}`,
        `send ${ALICE.toString()}`,
        `ensure ${BOB.toString()}`,
        `send ${BOB.toString()}`,
      ]);
      expect(ensureSetting).toHaveBeenCalledWith({
        userId: ALICE,
        projectId: PROJECT_ID,
        eventType:
          NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
      });
    });

    test("it is sent under the missed call event, in the call's project", async () => {
      await notify();

      expect(sentTo(ALICE)).toMatchObject({
        userId: ALICE,
        projectId: PROJECT_ID,
        eventType:
          NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
      });
    });

    test("every channel's message is passed along", async () => {
      await notify();

      const sent: any = sentTo(ALICE);

      expect(sent.emailEnvelope.templateType).toBe(
        EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
      );
      expect(sent.smsMessage.message).toContain("Missed call");
      expect(sent.callRequestMessage.data[0].sayMessage).toContain(
        "Missed call",
      );
      expect(sent.pushNotificationMessage.clickAction).toBe(CALL_LOG_LINK);
      expect(sent.whatsAppMessage.body).toBe(sent.smsMessage.message);
    });
  });

  describe("what it says", () => {
    test("who called, where, why nobody answered, and a link to the call", async () => {
      await notify();

      const sent: any = sentTo(BOB);

      expect(sent.emailEnvelope.subject).toBe(
        "Missed call from +14155550999 to Support Hotline",
      );
      expect(sent.emailEnvelope.vars).toMatchObject({
        policyName: "Support Hotline",
        projectName: "Acme",
        callerPhoneNumber: "+14155550999",
        routingPhoneNumber: "+14155550102",
        result: "Nobody answered",
        incomingCallLogViewLink: CALL_LOG_LINK,
      });
    });

    test("who was rung, in order, with each attempt's rule and result", async () => {
      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars["attempts"]).toEqual([
        {
          position: "1",
          userName: "User 1",
          details:
            "Primary on-call · +14155551001 · No answer after 30 seconds",
        },
        {
          position: "2",
          userName: "User 2",
          details: "Rule 2 · +14155551002 · No answer after 10 seconds",
        },
      ]);
    });

    test("the attempts are read for this call, oldest first", async () => {
      await notify();

      expect(findAttempts).toHaveBeenCalledTimes(1);
      expect(findAttempts.mock.calls[0][0]).toMatchObject({
        query: { incomingCallLogId: CALL_LOG_ID },
        sort: { startedAt: SortOrder.Ascending },
        props: { isRoot: true },
      });
      expect(findAttempts.mock.calls[0][0].select).toMatchObject({
        status: true,
        startedAt: true,
        endedAt: true,
        userPhoneNumber: true,
        user: { name: true, email: true },
        incomingCallPolicyEscalationRule: { name: true, order: true },
      });
    });

    test("the call log is read as root with the policy and project names", async () => {
      await notify();

      expect(findCallLog).toHaveBeenCalledTimes(1);
      expect(findCallLog.mock.calls[0][0]).toMatchObject({
        id: CALL_LOG_ID,
        props: { isRoot: true },
      });
      expect(findCallLog.mock.calls[0][0].select).toMatchObject({
        status: true,
        statusMessage: true,
        callerPhoneNumber: true,
        routingPhoneNumber: true,
        startedAt: true,
        endedAt: true,
        project: { name: true },
        incomingCallPolicy: { name: true },
      });
    });

    test("an attempt by someone with no name falls back to their email", async () => {
      const noName: User = new User(ALICE);
      noName.email = new Email("alice@acme.test");
      findAttempts.mockResolvedValue([
        makeAttempt({
          user: noName,
          phone: "+14155551001",
          ruleName: "Primary",
          ruleOrder: 1,
          status: IncomingCallStatus.NoAnswer,
          startSecond: 0,
          endSecond: 20,
        }),
      ]);

      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars["attempts"]).toEqual([
        expect.objectContaining({ userName: "alice@acme.test" }),
      ]);
    });

    test("each owner sees the call time in their own time zone", async () => {
      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars["callStartedAt"]).toBe(
        OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
          date: STARTED_AT,
          timezones: [Timezone.EuropeLondon],
        }),
      );
      expect(sentTo(BOB).emailEnvelope.vars["callStartedAt"]).toBe(
        OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
          date: STARTED_AT,
          timezones: [],
        }),
      );
    });

    test("a caller who hung up: says how long they waited", async () => {
      findCallLog.mockResolvedValue(
        makeCallLog({ status: IncomingCallStatus.CallerHungUp }),
      );

      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars).toMatchObject({
        result: "Caller hung up before anyone answered",
        explanation:
          "The caller hung up after waiting 47 seconds, before anyone answered.",
      });
    });

    test("nobody available: no attempt list, and the reason", async () => {
      findCallLog.mockResolvedValue(
        makeCallLog({
          status: IncomingCallStatus.Failed,
          statusMessage: IncomingCallStatusMessage.NoOneAvailable,
        }),
      );
      findAttempts.mockResolvedValue([]);

      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars).toMatchObject({
        result: "Nobody was available",
        hasAttempts: "false",
      });
    });

    test("a disabled policy: says so", async () => {
      findCallLog.mockResolvedValue(
        makeCallLog({
          status: IncomingCallStatus.Failed,
          statusMessage: IncomingCallStatusMessage.PolicyDisabled,
        }),
      );
      findAttempts.mockResolvedValue([]);

      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars["result"]).toBe(
        "Policy is disabled",
      );
    });

    test("a caller with no number is named as an unknown number", async () => {
      findCallLog.mockResolvedValue(makeCallLog({ callerPhoneNumber: "" }));

      await notify();

      expect(sentTo(ALICE).emailEnvelope.subject).toBe(
        "Missed call from an unknown number to Support Hotline",
      );
    });

    test("a policy with no name still gets a readable subject", async () => {
      findCallLog.mockResolvedValue(makeCallLog({ policyName: "" }));

      await notify();

      expect(sentTo(ALICE).emailEnvelope.subject).toBe(
        "Missed call from +14155550999 to Incoming Call Policy",
      );
    });

    test("everyone gets the same call log link", async () => {
      await notify();

      const links: Array<string> = sendUserNotification.mock.calls.map(
        (call: any): string => {
          return (call[0].emailEnvelope.vars as JSONObject)[
            "incomingCallLogViewLink"
          ] as string;
        },
      );

      expect(links).toEqual([CALL_LOG_LINK, CALL_LOG_LINK]);
    });
  });

  describe("only missed calls", () => {
    test.each([
      IncomingCallStatus.Completed,
      IncomingCallStatus.Connected,
      IncomingCallStatus.Initiated,
      IncomingCallStatus.Escalated,
      IncomingCallStatus.Ringing,
      undefined,
    ])(
      "a call that is %s tells nobody",
      async (status: IncomingCallStatus | undefined) => {
        findCallLog.mockResolvedValue(makeCallLog({ status }));

        await notify();

        expect(findOwners).not.toHaveBeenCalled();
        expect(getProjectOwners).not.toHaveBeenCalled();
        expect(sendUserNotification).not.toHaveBeenCalled();
        expect(ensureSetting).not.toHaveBeenCalled();
      },
    );

    test.each([
      [IncomingCallStatus.NoAnswer, undefined],
      [IncomingCallStatus.CallerHungUp, undefined],
      [IncomingCallStatus.Failed, IncomingCallStatusMessage.PolicyDisabled],
      [IncomingCallStatus.Failed, IncomingCallStatusMessage.NoOneAvailable],
      [IncomingCallStatus.Failed, undefined],
    ])(
      "a call that ended %s (%s) is a missed call",
      async (status: IncomingCallStatus, statusMessage: string | undefined) => {
        findCallLog.mockResolvedValue(makeCallLog({ status, statusMessage }));

        await notify();

        expect(recipients()).toEqual([ALICE.toString(), BOB.toString()]);
      },
    );

    test("a call log that is gone tells nobody and says why", async () => {
      findCallLog.mockResolvedValue(null);

      await notify();

      expect(sendUserNotification).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("was not found"),
      );
    });
  });

  describe("never fails the call", () => {
    test("one recipient's failure does not cost the others their notification", async () => {
      sendUserNotification.mockImplementation((data: any): Promise<void> => {
        if (data.userId.toString() === ALICE.toString()) {
          return Promise.reject(new Error("no route to Alice"));
        }
        return Promise.resolve();
      });

      await expect(notify()).resolves.toBeUndefined();

      expect(recipients()).toEqual([ALICE.toString(), BOB.toString()]);
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining(`failed to notify user ${ALICE.toString()}`),
        expect.anything(),
      );
    });

    test("a failure seeding one recipient's setting does not stop the others", async () => {
      ensureSetting.mockImplementation((data: any): Promise<void> => {
        if (data.userId.toString() === ALICE.toString()) {
          return Promise.reject(new Error("setting write failed"));
        }
        return Promise.resolve();
      });

      await notify();

      expect(recipients()).toEqual([BOB.toString()]);
    });

    test("a database failure is logged, not thrown", async () => {
      findCallLog.mockRejectedValue(new Error("database is down"));

      await expect(notify()).resolves.toBeUndefined();

      expect(sendUserNotification).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("database is down"),
        expect.objectContaining({ incomingCallLogId: CALL_LOG_ID.toString() }),
      );
    });

    test("an owner lookup failure is logged, not thrown", async () => {
      findOwners.mockRejectedValue(new Error("owner lookup failed"));

      await expect(notify()).resolves.toBeUndefined();

      expect(sendUserNotification).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("owner lookup failed"),
        expect.anything(),
      );
    });
  });

  describe("the call log link", () => {
    test("points at the call in the policy's call log", async () => {
      const link: URL =
        await IncomingCallMissedCallNotificationService.getIncomingCallLogLinkInDashboard(
          {
            projectId: PROJECT_ID,
            incomingCallPolicyId: POLICY_ID,
            incomingCallLogId: CALL_LOG_ID,
          },
        );

      expect(link.toString()).toBe(CALL_LOG_LINK);
    });

    test("matches the template builder's link variable", async () => {
      await notify();

      expect(sentTo(ALICE).emailEnvelope.vars["incomingCallLogViewLink"]).toBe(
        CALL_LOG_LINK,
      );
      expect(MissedCallNotification.EVENT_TYPE).toBe(
        NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
      );
    });
  });
});
