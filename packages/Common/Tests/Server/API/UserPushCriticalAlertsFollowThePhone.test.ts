import UserPushAPI from "../../../Server/API/UserPushAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import ExpoPushReceiptQueue from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import Incident from "../../../Models/DatabaseModels/Incident";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound from "../../../Types/PushNotification/CriticalAlertSound";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * One phone, from the app's reports to the night it is paged.
 *
 * The device row is the one thing the Dashboard's list, the test
 * notification and every on-call page read. Here it is a real UserPush
 * model, written only by the routes the app calls - a registration of the
 * device the phone already has, and the critical-alerts report - and then
 * paged through the real delivery half and tested through the real
 * test-notification route. What the phone says is what the page does.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000161");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000162",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000163",
);
const RULE_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000164");
const INCIDENT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000165",
);
const LOG_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000166");
const TIMELINE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000167",
);

const PHONE_TOKEN: string = "ExponentPushToken[follow-the-phone-001]";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

interface DeliveryHalf {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
}

function deliveryHalf(): DeliveryHalf {
  return UserNotificationRuleService as unknown as DeliveryHalf;
}

type Answer = { json: JSONObject } | Error;

function request(data: {
  body?: JSONObject;
  params?: Record<string, string>;
}): OneUptimeRequest {
  return {
    params: data.params || {},
    body: data.body || {},
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  } as unknown as OneUptimeRequest;
}

async function callRoute(uri: string, req: OneUptimeRequest): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", uri)
    .handlerFunction(req, res, (err?: unknown): void => {
      failure = err as Error;
    });

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (!failure && errorCalls.length > 0) {
    failure = errorCalls[0]![2] as Error;
  }

  if (failure) {
    return failure;
  }

  return {
    json: (Response.sendJsonObjectResponse as jest.Mock).mock
      .calls[0]![2] as JSONObject,
  };
}

describe("the phone's report decides the page, the test and the list", () => {
  // The one device row, as the database holds it.
  let device: UserPush;
  let sendPush: SpyInstance<
    typeof PushNotificationService.sendPushNotification
  >;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserPushAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Push is on for the whole server (GlobalConfig.disablePushNotifications).
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false);

    device = new UserPush();
    device._id = DEVICE_ID.toString();
    device.userId = USER_ID;
    device.projectId = PROJECT_ID;
    device.deviceName = "iPhone 14 Pro Max";
    device.deviceToken = PHONE_TOKEN;
    device.deviceType = PushDeviceType.iOS;
    device.isVerified = true;
    // Turned on once, as in the maintainer's report.
    device.isCriticalAlertEnabled = true;
    device.criticalAlertSound = CriticalAlertSound.Default;
    device.criticalAlertVolume = 100;

    // The database: reads return the row, writes change it.
    jest.spyOn(UserPushService, "findOneBy").mockImplementation((async () => {
      return device;
    }) as never);
    jest.spyOn(UserPushService, "findOneById").mockImplementation((async () => {
      return device;
    }) as never);
    jest.spyOn(UserPushService, "findBy").mockImplementation((async () => {
      return [device];
    }) as never);
    jest
      .spyOn(UserPushService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: { _id: string };
        data: Record<string, unknown>;
      }) => {
        expect(updateBy.query._id).toBe(DEVICE_ID.toString());
        Object.assign(device, updateBy.data);
        return 1;
      }) as never);

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockResolvedValue(new Set<string>([USER_ID.toString()]));
    jest
      .spyOn(ExpoPushReceiptQueue, "noteTokenRegistered")
      .mockResolvedValue(undefined as never);
    jest.spyOn(TestSendAccess, "assertMaySendTestToSelf").mockResolvedValue({
      props: {
        userId: USER_ID,
        userGlobalAccessPermission: { projectIds: [PROJECT_ID] },
      },
      userId: USER_ID,
    } as never);

    // The paging half's surroundings.
    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never);
    jest
      .spyOn(UserOnCallLogTimelineService, "create")
      .mockResolvedValue({ id: TIMELINE_ID } as never);
    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
      title: "Checkout is down",
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
    } as unknown as Incident as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://dashboard.example.com/incident") as never,
      );

    sendPush = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The phone registers the device it already has, as the app does on start.
  async function phoneRegisters(
    isCriticalAlertEnabled: boolean,
  ): Promise<void> {
    const answer: Answer = await callRoute(
      "/user-push/register",
      request({
        body: {
          deviceToken: PHONE_TOKEN,
          deviceType: PushDeviceType.iOS,
          deviceName: "iPhone 14 Pro Max",
          projectId: PROJECT_ID.toString(),
          isCriticalAlertEnabled: isCriticalAlertEnabled,
        },
      }),
    );

    expect(
      (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
    ).toBe(isCriticalAlertEnabled);
  }

  // The phone reports a change, as the app does on coming back to it.
  async function phoneReports(isEnabled: boolean): Promise<void> {
    const answer: Answer = await callRoute(
      "/user-push/critical-alerts",
      request({
        body: { deviceToken: PHONE_TOKEN, isEnabled: isEnabled },
      }),
    );

    expect(
      (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
    ).toBe(isEnabled);
  }

  // An on-call page from a rule at the default level, Critical.
  async function pageIsCritical(): Promise<boolean> {
    sendPush.mockClear();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = RULE_ID.toString();
    rule.projectId = PROJECT_ID;
    rule.userId = USER_ID;
    rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
    rule.notifyAfterMinutes = 0;
    rule.pushNotificationLevel = PushNotificationLevel.Critical;
    rule.userPush = device;
    rule.userPushId = DEVICE_ID;

    await deliveryHalf().deliverNotificationForRule(rule, {
      projectId: PROJECT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      userNotificationLogId: LOG_ID,
      triggeredByIncidentId: INCIDENT_ID,
    } as ExecuteOptions);

    expect(sendPush).toHaveBeenCalledTimes(1);

    return Boolean(
      (sendPush.mock.calls[0]![0] as PushNotificationRequest).message
        .isCriticalAlert,
    );
  }

  // A test from the Dashboard: what it answered, and what it sent.
  async function testFromTheDashboard(): Promise<{
    answered: unknown;
    sent: boolean;
  }> {
    sendPush.mockClear();

    const answer: Answer = await callRoute(
      "/user-push/:deviceId/test-notification",
      request({ params: { deviceId: DEVICE_ID.toString() } }),
    );

    return {
      answered: (answer as { json: JSONObject }).json["isCriticalAlert"],
      sent: Boolean(
        (sendPush.mock.calls[0]![0] as PushNotificationRequest).message
          .isCriticalAlert,
      ),
    };
  }

  test("before: on, as it was turned on - pages and tests ring through", async () => {
    expect(await pageIsCritical()).toBe(true);
    expect(await testFromTheDashboard()).toEqual({
      answered: true,
      sent: true,
    });
  });

  test("turned off on the phone, and registered again: no page and no test claims to ring through", async () => {
    await phoneRegisters(false);

    expect(device.isCriticalAlertEnabled).toBe(false);
    expect(await pageIsCritical()).toBe(false);
    expect(await testFromTheDashboard()).toEqual({
      answered: false,
      sent: false,
    });
  });

  test("turned off in the phone's own settings, reported on coming back: the same", async () => {
    await phoneReports(false);

    expect(device.isCriticalAlertEnabled).toBe(false);
    expect(await pageIsCritical()).toBe(false);
    expect(await testFromTheDashboard()).toEqual({
      answered: false,
      sent: false,
    });
  });

  test("allowed again and reported: pages ring through again", async () => {
    await phoneReports(false);
    await phoneReports(true);

    expect(await pageIsCritical()).toBe(true);
    expect(await testFromTheDashboard()).toEqual({
      answered: true,
      sent: true,
    });
  });

  test("a registration that says the same as the device writes nothing, and changes nothing", async () => {
    await phoneRegisters(true);

    expect(UserPushService.updateOneBy).not.toHaveBeenCalled();
    expect(await pageIsCritical()).toBe(true);
  });

  test("a rule set to Standard stays quiet whatever the phone reports", async () => {
    await phoneReports(true);

    sendPush.mockClear();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = RULE_ID.toString();
    rule.projectId = PROJECT_ID;
    rule.userId = USER_ID;
    rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
    rule.notifyAfterMinutes = 0;
    rule.pushNotificationLevel = PushNotificationLevel.Standard;
    rule.userPush = device;
    rule.userPushId = DEVICE_ID;

    await deliveryHalf().deliverNotificationForRule(rule, {
      projectId: PROJECT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      userNotificationLogId: LOG_ID,
      triggeredByIncidentId: INCIDENT_ID,
    } as ExecuteOptions);

    expect(
      (sendPush.mock.calls[0]![0] as PushNotificationRequest).message
        .isCriticalAlert,
    ).toBe(false);
  });
});
