import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import PushNotificationService, {
  ExpoDeliveryOptions,
} from "../../../Server/Services/PushNotificationService";
import logger from "../../../Server/Utils/Logger";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
} from "../../../Types/PushNotification/CriticalAlertSound";
import { CRITICAL_ALERT_VOLUME_OPTIONS } from "../../../Types/PushNotification/CriticalAlertVolume";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
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
 * The on-call paging path, from the device row to the push that goes out:
 * the alarm and volume a responder chose for this phone have to reach the
 * page it sends. Nothing fails if they do not - the page is delivered with
 * the system sound at full volume, and the responder who chose a klaxon
 * because the system chime does not wake them sleeps through it.
 *
 * So this drives the real delivery half with a real UserPush row for every
 * event type that pages a responder (each has its own copy of the push
 * branch), and reads what was handed to the sender - then what the sender
 * would make of it on each platform. And the other direction: a page that is
 * not critical - the device opted out, or the rule is Standard - must not
 * pick the alarm up.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LOG_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
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

const DEVICE_TOKEN: string = "ExponentPushToken[sound-on-call-000001]";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

/*
 * deliverNotificationForRule is private, so TypeScript will not let a test
 * name it. It is an ordinary prototype method at runtime, reached through a
 * structural cast as CriticalOnCallAlertDelivery.test.ts does.
 */
interface DeliveryHalf {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
}

function deliveryHalf(): DeliveryHalf {
  return UserNotificationRuleService as unknown as DeliveryHalf;
}

function device(options: {
  deviceType: PushDeviceType;
  isCriticalAlertEnabled: boolean;
  criticalAlertSound?: CriticalAlertSound;
  criticalAlertVolume?: number;
}): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = PUSH_METHOD_ID.toString();
  userPush.deviceToken = DEVICE_TOKEN;
  userPush.deviceType = options.deviceType;
  userPush.isVerified = true;
  userPush.userId = USER_ID;
  userPush.isCriticalAlertEnabled = options.isCriticalAlertEnabled;

  if (options.criticalAlertSound !== undefined) {
    userPush.criticalAlertSound = options.criticalAlertSound;
  }

  if (options.criticalAlertVolume !== undefined) {
    userPush.criticalAlertVolume = options.criticalAlertVolume;
  }

  return userPush;
}

function pushRule(
  userPush: UserPush,
  pushNotificationLevel?: PushNotificationLevel,
): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;
  rule.userPush = userPush;
  rule.userPushId = PUSH_METHOD_ID;

  if (pushNotificationLevel) {
    rule.pushNotificationLevel = pushNotificationLevel;
  }

  return rule;
}

// The id of the thing being paged about travels with its event type.
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

function executeOptions(
  eventType: UserNotificationEventType = UserNotificationEventType.IncidentCreated,
): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: eventType,
    userNotificationLogId: LOG_ID,
    ...TRIGGER_ID_FOR_EVENT[eventType],
  } as ExecuteOptions;
}

const PLATFORMS: Array<[string, PushDeviceType]> = [
  ["iPhone", PushDeviceType.iOS],
  ["Android phone", PushDeviceType.Android],
];

const PAGING_EVENTS: Array<[string, UserNotificationEventType]> = [
  ["an incident", UserNotificationEventType.IncidentCreated],
  ["an alert", UserNotificationEventType.AlertCreated],
  ["an alert episode", UserNotificationEventType.AlertEpisodeCreated],
  ["an incident episode", UserNotificationEventType.IncidentEpisodeCreated],
];

const EVENT_AND_SOUND: Array<
  [string, string, UserNotificationEventType, CriticalAlertSoundDefinition]
> = [];

const EVENT_AND_VOLUME: Array<[string, number, UserNotificationEventType]> = [];

for (const [eventName, eventType] of PAGING_EVENTS) {
  for (const definition of CRITICAL_ALERT_SOUNDS) {
    EVENT_AND_SOUND.push([eventName, definition.sound, eventType, definition]);
  }

  for (const volume of CRITICAL_ALERT_VOLUME_OPTIONS) {
    EVENT_AND_VOLUME.push([eventName, volume, eventType]);
  }
}

describe("an on-call page carries the alarm and volume its device chose", () => {
  let pushSpy: SpyInstance<typeof PushNotificationService.sendPushNotification>;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

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

  async function page(
    rule: UserNotificationRule,
    eventType: UserNotificationEventType = UserNotificationEventType.IncidentCreated,
  ): Promise<PushNotificationRequest> {
    await deliveryHalf().deliverNotificationForRule(
      rule,
      executeOptions(eventType),
    );

    expect(pushSpy).toHaveBeenCalledTimes(1);

    return pushSpy.mock.calls[0]![0] as PushNotificationRequest;
  }

  function deliveredAs(request: PushNotificationRequest): ExpoDeliveryOptions {
    return PushNotificationService.getExpoDeliveryOptions(
      request.message,
      request.deviceType,
    );
  }

  test.each(EVENT_AND_SOUND)(
    "%s page to an Android phone that chose %s rings on that sound's channel",
    async (
      _event: string,
      _sound: string,
      eventType: UserNotificationEventType,
      definition: CriticalAlertSoundDefinition,
    ) => {
      const request: PushNotificationRequest = await page(
        pushRule(
          device({
            deviceType: PushDeviceType.Android,
            isCriticalAlertEnabled: true,
            criticalAlertSound: definition.sound,
          }),
        ),
        eventType,
      );

      expect(request.message.isCriticalAlert).toBe(true);
      expect(request.message.criticalAlertSound).toBe(definition.sound);
      expect(deliveredAs(request).channelId).toBe(definition.androidChannelId);
    },
  );

  test.each(EVENT_AND_SOUND)(
    "%s page to an iPhone that chose %s names that sound's file",
    async (
      _event: string,
      _sound: string,
      eventType: UserNotificationEventType,
      definition: CriticalAlertSoundDefinition,
    ) => {
      const request: PushNotificationRequest = await page(
        pushRule(
          device({
            deviceType: PushDeviceType.iOS,
            isCriticalAlertEnabled: true,
            criticalAlertSound: definition.sound,
            criticalAlertVolume: 100,
          }),
        ),
        eventType,
      );

      expect(request.message.criticalAlertSound).toBe(definition.sound);
      expect(deliveredAs(request).sound).toEqual({
        critical: true,
        name: definition.iosSoundName,
        volume: 1,
      });
    },
  );

  test.each(EVENT_AND_VOLUME)(
    "%s page to an iPhone set to %s%% plays at that volume",
    async (
      _event: string,
      volume: number,
      eventType: UserNotificationEventType,
    ) => {
      const request: PushNotificationRequest = await page(
        pushRule(
          device({
            deviceType: PushDeviceType.iOS,
            isCriticalAlertEnabled: true,
            criticalAlertSound: CriticalAlertSound.Rising,
            criticalAlertVolume: volume,
          }),
        ),
        eventType,
      );

      expect(request.message.criticalAlertVolume).toBe(volume);
      expect(deliveredAs(request).sound).toEqual({
        critical: true,
        name: "oneuptime_rising.wav",
        volume: volume / 100,
      });
    },
  );

  test.each(PAGING_EVENTS)(
    "%s page to a device read without the columns plays the system sound at full volume, as before",
    async (_event: string, eventType: UserNotificationEventType) => {
      /*
       * A row read before the migration's defaults are loaded - or by a
       * select that left the columns out - carries neither. That must page
       * exactly as every critical page did before sounds could be chosen.
       */
      const request: PushNotificationRequest = await page(
        pushRule(
          device({
            deviceType: PushDeviceType.Android,
            isCriticalAlertEnabled: true,
          }),
        ),
        eventType,
      );

      expect(request.message.criticalAlertSound).toBeUndefined();
      expect(request.message.criticalAlertVolume).toBeUndefined();
      expect(deliveredAs(request)).toEqual({
        channelId: AndroidNotificationChannel.Critical,
        sound: { critical: true, name: "default", volume: 1 },
        priority: "high",
        interruptionLevel: "critical",
      });
    },
  );

  test.each(PAGING_EVENTS)(
    "%s page to a device with critical alerts off ignores the alarm it once chose",
    async (_event: string, eventType: UserNotificationEventType) => {
      /*
       * Switching critical alerts off keeps the chosen alarm stored for when
       * they are turned on again - and it must not make an ordinary page
       * ring a klaxon through Do Not Disturb in the meantime.
       */
      const request: PushNotificationRequest = await page(
        pushRule(
          device({
            deviceType: PushDeviceType.Android,
            isCriticalAlertEnabled: false,
            criticalAlertSound: CriticalAlertSound.Klaxon,
            criticalAlertVolume: 50,
          }),
        ),
        eventType,
      );

      expect(request.message.isCriticalAlert).toBe(false);
      expect(deliveredAs(request)).toEqual({
        channelId: AndroidNotificationChannel.High,
        sound: "default",
        priority: "high",
      });
    },
  );

  test.each(PLATFORMS)(
    "a Standard rule's page to an opted-in %s follows the phone's own settings, not the chosen alarm",
    async (_platform: string, deviceType: PushDeviceType) => {
      const request: PushNotificationRequest = await page(
        pushRule(
          device({
            deviceType: deviceType,
            isCriticalAlertEnabled: true,
            criticalAlertSound: CriticalAlertSound.SmokeAlarm,
            criticalAlertVolume: 25,
          }),
          PushNotificationLevel.Standard,
        ),
      );

      expect(request.message.isCriticalAlert).toBe(false);
      expect(deliveredAs(request).sound).toBe("default");
      expect(deliveredAs(request).interruptionLevel).toBeUndefined();
      expect(deliveredAs(request).channelId).toBe(
        deviceType === PushDeviceType.Android
          ? AndroidNotificationChannel.High
          : "default",
      );
    },
  );

  test("a Critical rule's page to an opted-in phone plays the chosen alarm", async () => {
    const request: PushNotificationRequest = await page(
      pushRule(
        device({
          deviceType: PushDeviceType.Android,
          isCriticalAlertEnabled: true,
          criticalAlertSound: CriticalAlertSound.SmokeAlarm,
        }),
        PushNotificationLevel.Critical,
      ),
    );

    expect(deliveredAs(request).channelId).toBe(
      AndroidNotificationChannel.CriticalSmokeAlarm,
    );
  });

  test("the page still goes to the device's token, with its title", async () => {
    const request: PushNotificationRequest = await page(
      pushRule(
        device({
          deviceType: PushDeviceType.iOS,
          isCriticalAlertEnabled: true,
          criticalAlertSound: CriticalAlertSound.Siren,
          criticalAlertVolume: 75,
        }),
      ),
    );

    expect(request.devices).toEqual([{ token: DEVICE_TOKEN }]);
    expect(request.deviceType).toBe(PushDeviceType.iOS);
    expect(request.message.title).toContain("Checkout is down");
  });
});

describe("the rule select loads the alarm and volume", () => {
  /*
   * An unselected column arrives as undefined, which the delivery path reads
   * as "never chose" - so dropping either from the select does not error, it
   * silently pages every device with the system sound at full volume.
   */
  let findSpy: SpyInstance<typeof UserNotificationRuleService.findOneById>;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never);

    jest
      .spyOn(deliveryHalf(), "deliverNotificationForRule")
      .mockResolvedValue(true as never);

    findSpy = jest
      .spyOn(UserNotificationRuleService, "findOneById")
      .mockResolvedValue({
        id: RULE_ID,
        _id: RULE_ID.toString(),
        userId: USER_ID,
      } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("userPush.criticalAlertSound and userPush.criticalAlertVolume are selected", async () => {
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(),
    );

    const select: JSONObject = (
      findSpy.mock.calls[0]![0] as unknown as { select: JSONObject }
    ).select;

    const userPushSelect: JSONObject = select["userPush"] as JSONObject;

    expect(userPushSelect["criticalAlertSound"]).toBe(true);
    expect(userPushSelect["criticalAlertVolume"]).toBe(true);
    // Beside the switch that decides whether they are used at all.
    expect(userPushSelect["isCriticalAlertEnabled"]).toBe(true);
  });
});
