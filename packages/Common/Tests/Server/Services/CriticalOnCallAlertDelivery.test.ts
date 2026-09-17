import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import logger from "../../../Server/Utils/Logger";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The on-call paging path is the ONLY place in the product allowed to send a
 * notification that overrides a silenced phone, and it may only do so for a
 * device whose owner turned the option on. Both halves of that sentence are
 * load-bearing and neither fails loudly:
 *
 *   - a page that loses the flag arrives silently, and the responder sleeps
 *     through the incident. Nothing logs an error; the page was "delivered".
 *   - a page that gains the flag it should not have wakes somebody who asked
 *     not to be woken, which is how an on-call app gets its notifications
 *     switched off entirely.
 *
 * So this file drives the real delivery half with a real UserPush model and
 * inspects what was actually handed to the sender, for every event type that
 * pages a responder.
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

const DEVICE_TOKEN: string = "ExponentPushToken[test-device]";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

/*
 * deliverNotificationForRule is private, so TypeScript will not let a test name
 * it. It is an ordinary prototype method at runtime and the on-call fallback
 * already calls it with an unsaved rule, so it is reached through a structural
 * cast - the same approach the neighbouring test files use.
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

function userPushDevice(options: {
  isCriticalAlertEnabled?: boolean;
  deviceType?: PushDeviceType;
}): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = PUSH_METHOD_ID.toString();
  userPush.deviceToken = DEVICE_TOKEN;
  userPush.deviceType = options.deviceType ?? PushDeviceType.iOS;
  userPush.isVerified = true;
  userPush.userId = USER_ID;

  if (options.isCriticalAlertEnabled !== undefined) {
    userPush.isCriticalAlertEnabled = options.isCriticalAlertEnabled;
  }

  return userPush;
}

function pushOnlyRule(device: UserPush): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;
  rule.userPush = device;
  rule.userPushId = PUSH_METHOD_ID;

  return rule;
}

/*
 * The delivery half loads the thing being paged about from whichever
 * triggeredBy* id matches the event type, and refuses outright if none of them
 * resolves. So the id has to travel with the event type rather than being set
 * once - a mismatch here fails as "Incident, Alert, Alert Episode, or Incident
 * Episode not found", a long way from the pairing that caused it.
 */
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
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  const eventType: UserNotificationEventType =
    (overrides as { userNotificationEventType?: UserNotificationEventType })
      .userNotificationEventType ?? UserNotificationEventType.IncidentCreated;

  return {
    projectId: PROJECT_ID,
    userNotificationEventType: eventType,
    userNotificationLogId: LOG_ID,
    ...TRIGGER_ID_FOR_EVENT[eventType],
    ...overrides,
  } as ExecuteOptions;
}

function fakeIncident(): Incident {
  return {
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    title: "Checkout is down",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
  } as unknown as Incident;
}

function fakeAlert(): Alert {
  return {
    id: ALERT_ID,
    projectId: PROJECT_ID,
    title: "Disk almost full",
    alertNumber: 7,
    alertNumberWithPrefix: "ALT-7",
  } as unknown as Alert;
}

function fakeAlertEpisode(): AlertEpisode {
  return {
    id: ALERT_EPISODE_ID,
    projectId: PROJECT_ID,
    title: "Disk pressure across the fleet",
    episodeNumber: 3,
  } as unknown as AlertEpisode;
}

function fakeIncidentEpisode(): IncidentEpisode {
  return {
    id: INCIDENT_EPISODE_ID,
    projectId: PROJECT_ID,
    title: "Payments degraded",
    episodeNumber: 4,
  } as unknown as IncidentEpisode;
}

describe("On-call push notifications and the critical alert flag", () => {
  let pushSpy: jest.SpyInstance;

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
      .mockResolvedValue({ id: TIMELINE_ID } as unknown as never);

    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident() as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://dashboard.example.com/incident") as never,
      );

    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(fakeAlert() as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://dashboard.example.com/alert") as never,
      );

    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockResolvedValue(fakeAlertEpisode() as never);
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(fakeIncidentEpisode() as never);

    pushSpy = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sentRequest(): PushNotificationRequest {
    expect(pushSpy).toHaveBeenCalledTimes(1);
    return pushSpy.mock.calls[0]![0] as PushNotificationRequest;
  }

  const pagingEvents: Array<[string, UserNotificationEventType]> = [
    ["an incident", UserNotificationEventType.IncidentCreated],
    ["an alert", UserNotificationEventType.AlertCreated],
    ["an alert episode", UserNotificationEventType.AlertEpisodeCreated],
    ["an incident episode", UserNotificationEventType.IncidentEpisodeCreated],
  ];

  describe("a device that opted in is paged as a critical alert", () => {
    test.each(pagingEvents)(
      "%s page overrides silent mode",
      async (_label: string, eventType: UserNotificationEventType) => {
        const rule: UserNotificationRule = pushOnlyRule(
          userPushDevice({ isCriticalAlertEnabled: true }),
        );

        await deliveryHalf().deliverNotificationForRule(
          rule,
          executeOptions({ userNotificationEventType: eventType }),
        );

        expect(sentRequest().message.isCriticalAlert).toBe(true);
      },
    );
  });

  describe("a device that did not opt in is paged normally", () => {
    test.each(pagingEvents)(
      "%s page respects the ringer switch when the flag is false",
      async (_label: string, eventType: UserNotificationEventType) => {
        const rule: UserNotificationRule = pushOnlyRule(
          userPushDevice({ isCriticalAlertEnabled: false }),
        );

        await deliveryHalf().deliverNotificationForRule(
          rule,
          executeOptions({ userNotificationEventType: eventType }),
        );

        expect(sentRequest().message.isCriticalAlert).toBe(false);
      },
    );

    test.each(pagingEvents)(
      "%s page respects the ringer switch when the column was never set",
      async (_label: string, eventType: UserNotificationEventType) => {
        /*
         * Every device registered before this feature shipped reads back as
         * undefined until the migration's default is loaded. Undefined must
         * behave as "off" rather than as "unknown, escalate anyway".
         */
        const rule: UserNotificationRule = pushOnlyRule(userPushDevice({}));

        await deliveryHalf().deliverNotificationForRule(
          rule,
          executeOptions({ userNotificationEventType: eventType }),
        );

        expect(sentRequest().message.isCriticalAlert).toBe(false);
      },
    );
  });

  describe("the flag travels with the page, not instead of it", () => {
    test("the page still carries its title, body and device", async () => {
      const rule: UserNotificationRule = pushOnlyRule(
        userPushDevice({ isCriticalAlertEnabled: true }),
      );

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      const request: PushNotificationRequest = sentRequest();

      expect(request.devices).toEqual([{ token: DEVICE_TOKEN }]);
      expect(request.deviceType).toBe(PushDeviceType.iOS);
      expect(request.message.title).toContain("Checkout is down");
      expect(request.message.body.length).toBeGreaterThan(0);
    });

    test("an Android device gets the flag too", async () => {
      const rule: UserNotificationRule = pushOnlyRule(
        userPushDevice({
          isCriticalAlertEnabled: true,
          deviceType: PushDeviceType.Android,
        }),
      );

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      const request: PushNotificationRequest = sentRequest();

      expect(request.deviceType).toBe(PushDeviceType.Android);
      expect(request.message.isCriticalAlert).toBe(true);
    });

    test("the on-call log timeline still records the push attempt", async () => {
      const rule: UserNotificationRule = pushOnlyRule(
        userPushDevice({ isCriticalAlertEnabled: true }),
      );

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      expect(UserOnCallLogTimelineService.create).toHaveBeenCalled();
    });
  });

  describe("an unverified device is not paged at all", () => {
    test("opting into critical alerts does not bypass verification", async () => {
      /*
       * The critical flag decides HOW a page sounds, never WHETHER it is sent.
       * A device that was never verified must stay silent regardless.
       */
      const device: UserPush = userPushDevice({
        isCriticalAlertEnabled: true,
      });
      device.isVerified = false;

      const rule: UserNotificationRule = pushOnlyRule(device);

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      expect(pushSpy).not.toHaveBeenCalled();
    });
  });
});

describe("The rule select loads the critical alert flag", () => {
  /*
   * An unselected column arrives as undefined, which the delivery half reads
   * as "not opted in". So dropping this field from the select does not error -
   * it silently downgrades every critical page in the product to a normal one.
   * That is a one-line change with no visible symptom until somebody sleeps
   * through an incident, which is exactly the kind of regression a test has to
   * hold.
   */
  let findSpy: jest.SpyInstance;

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
      } as unknown as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("userPush.isCriticalAlertEnabled is selected", async () => {
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(),
    );

    const select: JSONObject = (
      findSpy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    const userPushSelect: JSONObject = select["userPush"] as JSONObject;

    expect(userPushSelect["isCriticalAlertEnabled"]).toBe(true);
  });

  test("the columns the push branch already depended on are still selected", async () => {
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(),
    );

    const select: JSONObject = (
      findSpy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    const userPushSelect: JSONObject = select["userPush"] as JSONObject;

    expect(userPushSelect["deviceToken"]).toBe(true);
    expect(userPushSelect["deviceType"]).toBe(true);
    expect(userPushSelect["isVerified"]).toBe(true);
    expect(userPushSelect["userId"]).toBe(true);
  });
});
