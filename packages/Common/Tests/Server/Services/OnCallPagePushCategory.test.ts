import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import PushNotificationService, {
  ExpoDeliveryOptions,
} from "../../../Server/Services/PushNotificationService";
import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import logger from "../../../Server/Utils/Logger";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import URL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import { ON_CALL_PAGE_PUSH_CATEGORY } from "../../../Types/PushNotification/PushNotificationCategory";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import API, { APIRequestOptions } from "../../../Utils/API";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ACKNOWLEDGE AND ESCALATE UNDER EVERY ON-CALL PAGE'S PUSH.
 *
 * The On-Call app draws two actions under a push of the on-call page
 * category (PushNotificationCategory): Acknowledge, and Escalate. Every page
 * the on-call path sends names it - an incident, an alert, either kind of
 * episode, to an iPhone or an Android phone, critical or not - and the
 * category travels to Expo whichever way the push goes: with the
 * deployment's own Expo access token, or through the push relay, which
 * passes on only a category it knows. A notification that is not a page -
 * an owner's, a note posted - names none, and keeps no buttons.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LOG_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const INCIDENT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const ALERT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const PUSH_METHOD_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const DEVICE_TOKEN: string = "ExponentPushToken[category-on-call-0001]";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

// The delivery half is private; it is an ordinary prototype method at runtime.
interface DeliveryHalf {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
}

function deliveryHalf(): DeliveryHalf {
  return UserNotificationRuleService as unknown as DeliveryHalf;
}

function pushRule(
  deviceType: PushDeviceType,
  isCriticalAlertEnabled: boolean,
): UserNotificationRule {
  const userPush: UserPush = new UserPush();
  userPush._id = PUSH_METHOD_ID.toString();
  userPush.deviceToken = DEVICE_TOKEN;
  userPush.deviceType = deviceType;
  userPush.isVerified = true;
  userPush.userId = USER_ID;
  userPush.isCriticalAlertEnabled = isCriticalAlertEnabled;

  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;
  rule.userPush = userPush;
  rule.userPushId = PUSH_METHOD_ID;
  return rule;
}

const TRIGGER_ID_FOR_EVENT: Record<string, Partial<ExecuteOptions>> = {
  [UserNotificationEventType.IncidentCreated]: {
    triggeredByIncidentId: INCIDENT_ID,
  },
  [UserNotificationEventType.AlertCreated]: {
    triggeredByAlertId: ALERT_ID,
  },
  [UserNotificationEventType.AlertEpisodeCreated]: {
    triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
  },
  [UserNotificationEventType.IncidentEpisodeCreated]: {
    triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
  },
};

const PAGES: Array<
  [string, UserNotificationEventType, PushDeviceType, boolean]
> = [];

for (const [eventName, eventType] of [
  ["an incident", UserNotificationEventType.IncidentCreated],
  ["an alert", UserNotificationEventType.AlertCreated],
  ["an alert episode", UserNotificationEventType.AlertEpisodeCreated],
  ["an incident episode", UserNotificationEventType.IncidentEpisodeCreated],
] as Array<[string, UserNotificationEventType]>) {
  for (const deviceType of [PushDeviceType.iOS, PushDeviceType.Android]) {
    for (const critical of [true, false]) {
      PAGES.push([
        `${eventName} page to ${deviceType === PushDeviceType.iOS ? "an iPhone" : "an Android phone"}${critical ? ", critical" : ""}`,
        eventType,
        deviceType,
        critical,
      ]);
    }
  }
}

describe("every on-call page names the category", () => {
  let pushSpy: SpyInstance<typeof PushNotificationService.sendPushNotification>;

  beforeEach(() => {
    for (const level of ["error", "warn", "info"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }
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
    } as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://dashboard.example.com/incident") as never,
      );
    jest.spyOn(AlertService, "findOneById").mockResolvedValue({
      id: ALERT_ID,
      projectId: PROJECT_ID,
      title: "Disk almost full",
      alertNumber: 7,
      alertNumberWithPrefix: "ALT-7",
    } as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://dashboard.example.com/alert") as never,
      );
    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue({
      id: ALERT_EPISODE_ID,
      projectId: PROJECT_ID,
      title: "Disk pressure across the fleet",
      episodeNumber: 3,
    } as never);
    jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
      id: INCIDENT_EPISODE_ID,
      projectId: PROJECT_ID,
      title: "Payments degraded",
      episodeNumber: 4,
    } as never);

    pushSpy = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(PAGES)(
    "%s: Acknowledge and Escalate under it, on its way to Expo",
    async (
      _name: string,
      eventType: UserNotificationEventType,
      deviceType: PushDeviceType,
      critical: boolean,
    ) => {
      await deliveryHalf().deliverNotificationForRule(
        pushRule(deviceType, critical),
        {
          projectId: PROJECT_ID,
          userNotificationEventType: eventType,
          userNotificationLogId: LOG_ID,
          ...TRIGGER_ID_FOR_EVENT[eventType],
        } as ExecuteOptions,
      );

      expect(pushSpy).toHaveBeenCalledTimes(1);
      const request: PushNotificationRequest = pushSpy.mock
        .calls[0]![0] as PushNotificationRequest;
      expect(request.message.categoryId).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
      expect(
        PushNotificationService.getExpoDeliveryOptions(
          request.message,
          request.deviceType,
        ).categoryId,
      ).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
      // The critical sound and channel are as they were: the category changes nothing else.
      expect(request.message.isCriticalAlert).toBe(critical);
    },
  );

  test("a notification that is not a page - an owner's - names no category", () => {
    const ownerNotification: PushNotificationMessage =
      PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: "https://dashboard.example.com/incident",
        incidentId: INCIDENT_ID.toString(),
        projectId: PROJECT_ID.toString(),
      });

    expect(ownerNotification.categoryId).toBeUndefined();
    expect(
      PushNotificationService.getExpoDeliveryOptions(
        ownerNotification,
        PushDeviceType.iOS,
      ),
    ).not.toHaveProperty("categoryId");
  });
});

describe("getExpoDeliveryOptions carries only a category the server knows", () => {
  function message(
    overrides: Partial<PushNotificationMessage>,
  ): PushNotificationMessage {
    return {
      title: "Incident INC-42: Checkout is down",
      body: "A new incident has been created.",
      ...overrides,
    };
  }

  test.each([
    [PushDeviceType.iOS, true],
    [PushDeviceType.iOS, false],
    [PushDeviceType.Android, true],
    [PushDeviceType.Android, false],
  ])(
    "%s, critical %s: the page's category, and the delivery otherwise as before",
    (deviceType: PushDeviceType, critical: boolean) => {
      const withCategory: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          message({
            isCriticalAlert: critical,
            categoryId: ON_CALL_PAGE_PUSH_CATEGORY,
          }),
          deviceType,
        );
      const without: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          message({ isCriticalAlert: critical }),
          deviceType,
        );

      expect(withCategory).toEqual({
        ...without,
        categoryId: ON_CALL_PAGE_PUSH_CATEGORY,
      });
      expect(without).not.toHaveProperty("categoryId");
    },
  );

  test("an id the server does not know never reaches Expo", () => {
    for (const categoryId of ["INCIDENT_ACTIONS", "on_call_page", ""]) {
      expect(
        PushNotificationService.getExpoDeliveryOptions(
          message({ categoryId }),
          PushDeviceType.Android,
        ),
      ).not.toHaveProperty("categoryId");
    }
  });
});

describe("the category travels whichever way the push goes", () => {
  let expoMessages: Array<ExpoPushMessage>;
  let relayPosts: Array<APIRequestOptions>;

  beforeEach(() => {
    expoMessages = [];
    relayPosts = [];
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false);
    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async (messages: Array<ExpoPushMessage>) => {
        expoMessages.push(...messages);
        return [{ status: "ok", id: "receipt-1" }];
      }) as never);
    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ) => {
      relayPosts.push(options);
      return new HTTPResponse(200, { success: true } as JSONObject, {});
    }) as never);
    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);
    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1 as never);
    for (const level of ["error", "warn", "info"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function send(categoryId?: string): Promise<void> {
    await PushNotificationService.sendPushNotification(
      {
        devices: [{ token: DEVICE_TOKEN, name: "Pixel 8" }],
        message: {
          title: "Incident INC-42: Checkout is down",
          body: "A new incident has been created.",
          ...(categoryId ? { categoryId } : {}),
        },
        deviceType: PushDeviceType.Android,
      },
      { projectId: PROJECT_ID },
    );
  }

  test("with the deployment's own Expo access token: on the message Expo is sent", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    await send(ON_CALL_PAGE_PUSH_CATEGORY);
    await send();

    expect(expoMessages).toHaveLength(2);
    expect(expoMessages[0]!.categoryId).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
    expect(expoMessages[1]).not.toHaveProperty("categoryId");
    expect(relayPosts).toHaveLength(0);
  });

  test("through the push relay: in what the server posts to it", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    await send(ON_CALL_PAGE_PUSH_CATEGORY);
    await send();

    expect(relayPosts).toHaveLength(2);
    expect((relayPosts[0]!.data as JSONObject)["categoryId"]).toBe(
      ON_CALL_PAGE_PUSH_CATEGORY,
    );
    expect(relayPosts[1]!.data as JSONObject).not.toHaveProperty("categoryId");
    expect(expoMessages).toHaveLength(0);
  });

  test("the relay passes on a category it knows, and leaves out one it does not - the page still goes", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    await PushNotificationService.sendRelayPushNotification({
      to: DEVICE_TOKEN,
      title: "Incident INC-42: Checkout is down",
      body: "A new incident has been created.",
      categoryId: ON_CALL_PAGE_PUSH_CATEGORY,
    });
    await PushNotificationService.sendRelayPushNotification({
      to: DEVICE_TOKEN,
      title: "Incident INC-42: Checkout is down",
      body: "A new incident has been created.",
      categoryId: "SOMETHING_ELSE",
    });

    expect(expoMessages).toHaveLength(2);
    expect(expoMessages[0]!.categoryId).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
    expect(expoMessages[1]).not.toHaveProperty("categoryId");
  });
});
