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
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Each on-call rule now says how its push sounds - Critical or Standard - so a
 * responder can be woken through silent mode for a Sev 1 and paged quietly for
 * a Sev 4. The device's own Critical On-Call Alerts switch still has the last
 * word: a rule can only LOWER what the device allows.
 *
 * Driven through the real delivery half with real models, and inspected at
 * the point the page is handed to the sender - then once more through the
 * payload builder, so "Standard" is shown to reach the phone as an ordinary
 * channel and sound, not just as a false flag on a message object.
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

const DEVICE_TOKEN: string = "ExponentPushToken[level-device]";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

/*
 * The private halves this file drives, reached through a structural cast the
 * way the neighbouring delivery tests reach them: they are ordinary prototype
 * methods at runtime.
 */
interface ServiceInternals {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
  buildUnsavedFallbackRule: (options: {
    projectId: ObjectID;
    userId: ObjectID;
    ruleType: NotificationRuleType;
  }) => UserNotificationRule;
  assertPushNotificationLevelIsKnown: (value: unknown) => void;
  onBeforeCreate: (
    createBy: CreateBy<UserNotificationRule>,
  ) => Promise<unknown>;
  onBeforeUpdate: (
    updateBy: UpdateBy<UserNotificationRule>,
  ) => Promise<unknown>;
  findRowsAndHoldUpdateToThem: (
    updateBy: UpdateBy<UserNotificationRule>,
    select: JSONObject,
  ) => Promise<Array<UserNotificationRule>>;
  findRowsAndHoldDeleteToThem: (
    deleteBy: unknown,
    select: JSONObject,
  ) => Promise<Array<UserNotificationRule>>;
}

function internals(): ServiceInternals {
  return UserNotificationRuleService as unknown as ServiceInternals;
}

function pushDevice(options: {
  isCriticalAlertEnabled: boolean | undefined;
  deviceType: PushDeviceType;
}): UserPush {
  const device: UserPush = new UserPush();
  device._id = PUSH_METHOD_ID.toString();
  device.deviceToken = DEVICE_TOKEN;
  device.deviceType = options.deviceType;
  device.isVerified = true;
  device.userId = USER_ID;

  if (options.isCriticalAlertEnabled !== undefined) {
    device.isCriticalAlertEnabled = options.isCriticalAlertEnabled;
  }

  return device;
}

function pushRule(data: {
  device: UserPush;
  level: PushNotificationLevel | string | undefined;
}): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;
  rule.userPush = data.device;
  rule.userPushId = PUSH_METHOD_ID;

  if (data.level !== undefined) {
    rule.pushNotificationLevel = data.level as PushNotificationLevel;
  }

  return rule;
}

/*
 * The delivery half loads the thing being paged about from whichever
 * triggeredBy* id matches the event type, so the id travels with the type.
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
  eventType: UserNotificationEventType = UserNotificationEventType.IncidentCreated,
): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: eventType,
    userNotificationLogId: LOG_ID,
    ...TRIGGER_ID_FOR_EVENT[eventType],
  } as ExecuteOptions;
}

function silenceLogger(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
}

function stubPagedThings(): void {
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

  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    title: "Checkout is down",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
  } as unknown as never);
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
  } as unknown as never);
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
  } as unknown as never);
  jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
    id: INCIDENT_EPISODE_ID,
    projectId: PROJECT_ID,
    title: "Payments degraded",
    episodeNumber: 4,
  } as unknown as never);
}

const PAGING_EVENTS: Array<[string, UserNotificationEventType]> = [
  ["incident", UserNotificationEventType.IncidentCreated],
  ["alert", UserNotificationEventType.AlertCreated],
  ["alert episode", UserNotificationEventType.AlertEpisodeCreated],
  ["incident episode", UserNotificationEventType.IncidentEpisodeCreated],
];

const MOBILE_DEVICE_TYPES: Array<PushDeviceType> = [
  PushDeviceType.iOS,
  PushDeviceType.Android,
];

describe("an on-call rule's push notification level decides whether its page is critical", () => {
  let pushSpy: jest.SpyInstance;

  beforeEach(() => {
    silenceLogger();
    stubPagedThings();

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

  async function deliver(data: {
    level: PushNotificationLevel | string | undefined;
    isCriticalAlertEnabled: boolean | undefined;
    deviceType: PushDeviceType;
    eventType: UserNotificationEventType;
  }): Promise<PushNotificationRequest> {
    await internals().deliverNotificationForRule(
      pushRule({
        device: pushDevice({
          isCriticalAlertEnabled: data.isCriticalAlertEnabled,
          deviceType: data.deviceType,
        }),
        level: data.level,
      }),
      executeOptions(data.eventType),
    );

    return sentRequest();
  }

  /*
   * The full table: every paging event, both phone platforms, both device
   * states and every way a rule can carry its level.
   */
  const LEVELS: Array<[string, PushNotificationLevel | undefined]> = [
    ["Critical", PushNotificationLevel.Critical],
    ["Standard", PushNotificationLevel.Standard],
    ["unset (read without the column)", undefined],
  ];

  const DEVICE_OPT_IN: Array<[string, boolean | undefined]> = [
    ["opted in", true],
    ["opted out", false],
    ["never asked", undefined],
  ];

  for (const [eventLabel, eventType] of PAGING_EVENTS) {
    for (const deviceType of MOBILE_DEVICE_TYPES) {
      for (const [levelLabel, level] of LEVELS) {
        for (const [deviceLabel, isCriticalAlertEnabled] of DEVICE_OPT_IN) {
          const expected: boolean =
            isCriticalAlertEnabled === true &&
            level !== PushNotificationLevel.Standard;

          test(`${eventLabel} page, ${deviceType} device ${deviceLabel}, rule ${levelLabel}: ${
            expected ? "critical" : "not critical"
          }`, async () => {
            const request: PushNotificationRequest = await deliver({
              level,
              isCriticalAlertEnabled,
              deviceType,
              eventType,
            });

            expect(request.message.isCriticalAlert).toBe(expected);
          });
        }
      }
    }
  }

  test("a Standard rule still sends the page - the level changes how it sounds, never whether", async () => {
    const request: PushNotificationRequest = await deliver({
      level: PushNotificationLevel.Standard,
      isCriticalAlertEnabled: true,
      deviceType: PushDeviceType.iOS,
      eventType: UserNotificationEventType.IncidentCreated,
    });

    expect(request.devices).toEqual([{ token: DEVICE_TOKEN }]);
    expect(request.message.title).toContain("Checkout is down");
    expect(request.message.body.length).toBeGreaterThan(0);
    expect(request.message.isCriticalAlert).toBe(false);
  });

  test("a Standard rule on an opted-in Android phone goes out on the ordinary channel", async () => {
    const request: PushNotificationRequest = await deliver({
      level: PushNotificationLevel.Standard,
      isCriticalAlertEnabled: true,
      deviceType: PushDeviceType.Android,
      eventType: UserNotificationEventType.AlertCreated,
    });

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.Android,
      );

    expect(delivery.channelId).toBe(AndroidNotificationChannel.High);
    expect(delivery.sound).toBe("default");
    expect(delivery.interruptionLevel).toBeUndefined();
  });

  test("a Critical rule on an opted-in Android phone goes out on the critical channel", async () => {
    const request: PushNotificationRequest = await deliver({
      level: PushNotificationLevel.Critical,
      isCriticalAlertEnabled: true,
      deviceType: PushDeviceType.Android,
      eventType: UserNotificationEventType.AlertCreated,
    });

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.Android,
      );

    expect(delivery.channelId).toBe(AndroidNotificationChannel.Critical);
    expect(delivery.interruptionLevel).toBe("critical");
  });

  test("a Standard rule on an opted-in iPhone sends no critical sound and no critical interruption level", async () => {
    const request: PushNotificationRequest = await deliver({
      level: PushNotificationLevel.Standard,
      isCriticalAlertEnabled: true,
      deviceType: PushDeviceType.iOS,
      eventType: UserNotificationEventType.IncidentEpisodeCreated,
    });

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.iOS,
      );

    expect(delivery.sound).toBe("default");
    expect(delivery.interruptionLevel).toBeUndefined();
  });

  test("a Critical rule on an opted-in iPhone sends the critical sound at full volume", async () => {
    const request: PushNotificationRequest = await deliver({
      level: PushNotificationLevel.Critical,
      isCriticalAlertEnabled: true,
      deviceType: PushDeviceType.iOS,
      eventType: UserNotificationEventType.IncidentEpisodeCreated,
    });

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.iOS,
      );

    expect(delivery.sound).toEqual({
      critical: true,
      name: "default",
      volume: PushNotificationService.CRITICAL_ALERT_VOLUME,
    });
    expect(delivery.interruptionLevel).toBe("critical");
  });

  test("a Critical rule cannot make a phone that never opted in ring through silent mode", async () => {
    const request: PushNotificationRequest = await deliver({
      level: PushNotificationLevel.Critical,
      isCriticalAlertEnabled: false,
      deviceType: PushDeviceType.Android,
      eventType: UserNotificationEventType.IncidentCreated,
    });

    expect(
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.Android,
      ).channelId,
    ).toBe(AndroidNotificationChannel.High);
  });

  test("an unverified device is still not paged, whatever its rule's level", async () => {
    for (const level of [
      PushNotificationLevel.Critical,
      PushNotificationLevel.Standard,
    ]) {
      const device: UserPush = pushDevice({
        isCriticalAlertEnabled: true,
        deviceType: PushDeviceType.iOS,
      });
      device.isVerified = false;

      await internals().deliverNotificationForRule(
        pushRule({ device, level }),
        executeOptions(),
      );
    }

    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe("the on-call fallback pages at the default level", () => {
  /*
   * A responder with no rule for a severity is rescued by the fallback, which
   * pages them on whatever verified method they have through an unsaved rule.
   * That rule has no level of its own, so it pages at the default - the same
   * Critical a rule would have had if they had made one.
   */
  let pushSpy: jest.SpyInstance;

  beforeEach(() => {
    silenceLogger();
    stubPagedThings();

    pushSpy = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the unsaved fallback rule carries no level", () => {
    const rule: UserNotificationRule = internals().buildUnsavedFallbackRule({
      projectId: PROJECT_ID,
      userId: USER_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    });

    expect(rule.pushNotificationLevel).toBeUndefined();
  });

  test.each([
    [true, true],
    [false, false],
  ])(
    "a fallback page to a phone whose critical alerts are %s is critical: %s",
    async (isCriticalAlertEnabled: boolean, expected: boolean) => {
      const rule: UserNotificationRule = internals().buildUnsavedFallbackRule({
        projectId: PROJECT_ID,
        userId: USER_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      });

      rule.userPush = pushDevice({
        isCriticalAlertEnabled,
        deviceType: PushDeviceType.iOS,
      });
      rule.userPushId = PUSH_METHOD_ID;

      await internals().deliverNotificationForRule(rule, executeOptions());

      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(
        (pushSpy.mock.calls[0]![0] as PushNotificationRequest).message
          .isCriticalAlert,
      ).toBe(expected);
    },
  );
});

describe("the rule select loads the push notification level", () => {
  /*
   * Unselected, the level reads as undefined, which pages at the default -
   * Critical. A responder who set a severity to Standard would keep being
   * woken through Do Not Disturb, and nothing would say why.
   */
  let findSpy: jest.SpyInstance;

  beforeEach(() => {
    silenceLogger();

    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never);

    jest
      .spyOn(
        internals() as unknown as Record<string, () => Promise<boolean>>,
        "deliverNotificationForRule",
      )
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

  async function ruleSelect(): Promise<JSONObject> {
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(),
    );

    return (findSpy.mock.calls[0]![0] as { select: JSONObject }).select;
  }

  test("pushNotificationLevel is selected on the rule", async () => {
    expect((await ruleSelect())["pushNotificationLevel"]).toBe(true);
  });

  test("the device's own switch is still selected beside it", async () => {
    const userPushSelect: JSONObject = (await ruleSelect())[
      "userPush"
    ] as JSONObject;

    expect(userPushSelect["isCriticalAlertEnabled"]).toBe(true);
    expect(userPushSelect["deviceToken"]).toBe(true);
    expect(userPushSelect["deviceType"]).toBe(true);
    expect(userPushSelect["isVerified"]).toBe(true);
  });

  test("the rule is read as root, so the level is never dropped for want of a permission", async () => {
    await ruleSelect();

    expect(
      (findSpy.mock.calls[0]![0] as { props: { isRoot?: boolean } }).props
        .isRoot,
    ).toBe(true);
  });
});

describe("only a known push notification level is ever stored", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the check itself", () => {
    test.each([
      [PushNotificationLevel.Critical],
      [PushNotificationLevel.Standard],
    ])("accepts %s", (level: PushNotificationLevel) => {
      expect(() => {
        internals().assertPushNotificationLevelIsKnown(level);
      }).not.toThrow();
    });

    test("accepts a write that leaves the level out - the column default applies", () => {
      expect(() => {
        internals().assertPushNotificationLevelIsKnown(undefined);
      }).not.toThrow();
    });

    test.each([
      ["a mis-cased level", "standard"],
      ["a level that does not exist", "Loud"],
      ["an empty string", ""],
      ["null, which the column cannot hold", null],
      ["a number", 0],
      ["a boolean", false],
      ["an object", { level: "Standard" }],
    ])("refuses %s", (_label: string, value: unknown) => {
      expect(() => {
        internals().assertPushNotificationLevelIsKnown(value);
      }).toThrow(BadDataException);
    });

    test("names the levels it accepts, so an API caller can correct the request", () => {
      expect(() => {
        internals().assertPushNotificationLevelIsKnown("Loud");
      }).toThrow("Push notification level must be one of: Critical, Standard.");
    });
  });

  describe("on create", () => {
    function createBy(level: unknown): CreateBy<UserNotificationRule> {
      const rule: UserNotificationRule = new UserNotificationRule();
      rule.projectId = PROJECT_ID;
      rule.userId = USER_ID;
      rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
      rule.notifyAfterMinutes = 0;
      rule.userPushId = PUSH_METHOD_ID;

      if (level !== undefined) {
        (rule as unknown as Record<string, unknown>)["pushNotificationLevel"] =
          level;
      }

      // Root: the ownership checks, which read the database, step aside.
      return {
        data: rule,
        props: { isRoot: true },
      } as CreateBy<UserNotificationRule>;
    }

    /*
     * The project-reference check the base hook runs reads the database; it
     * is answered here, and what is under test is the rule's own hook.
     */
    function stubReferenceCheck(): jest.SpyInstance {
      return jest
        .spyOn(ProjectReferenceCheck, "validateCreate")
        .mockResolvedValue(undefined as never);
    }

    test.each([
      [PushNotificationLevel.Critical],
      [PushNotificationLevel.Standard],
      [undefined],
    ])("a rule with level %s is accepted", async (level: unknown) => {
      stubReferenceCheck();

      await expect(
        internals().onBeforeCreate(createBy(level)),
      ).resolves.toBeDefined();
    });

    test("an accepted level is written as it was sent", async () => {
      stubReferenceCheck();

      const create: CreateBy<UserNotificationRule> = createBy(
        PushNotificationLevel.Standard,
      );

      await internals().onBeforeCreate(create);

      expect(create.data.pushNotificationLevel).toBe(
        PushNotificationLevel.Standard,
      );
    });

    test("a rule with an unknown level is refused", async () => {
      stubReferenceCheck();

      await expect(
        internals().onBeforeCreate(createBy("standard")),
      ).rejects.toThrow(
        "Push notification level must be one of: Critical, Standard.",
      );
    });

    test("a rule with a null level is refused", async () => {
      stubReferenceCheck();

      await expect(internals().onBeforeCreate(createBy(null))).rejects.toThrow(
        BadDataException,
      );
    });

    test("an unknown level is refused before the database is asked anything", async () => {
      const referenceCheck: jest.SpyInstance = stubReferenceCheck();

      await expect(
        internals().onBeforeCreate(createBy("Loud")),
      ).rejects.toThrow(BadDataException);

      expect(referenceCheck).not.toHaveBeenCalled();
    });
  });

  describe("on update", () => {
    function updateBy(patch: JSONObject): UpdateBy<UserNotificationRule> {
      /*
       * Root, with no actor: nothing about the patch needs the affected rows
       * read, so the hook never reaches the database.
       */
      return {
        query: { _id: RULE_ID.toString() },
        data: patch,
        props: { isRoot: true },
      } as unknown as UpdateBy<UserNotificationRule>;
    }

    test.each([
      [PushNotificationLevel.Critical],
      [PushNotificationLevel.Standard],
    ])(
      "changing the level to %s is accepted",
      async (level: PushNotificationLevel) => {
        await expect(
          internals().onBeforeUpdate(
            updateBy({ pushNotificationLevel: level }),
          ),
        ).resolves.toBeDefined();
      },
    );

    test("an update that does not mention the level is untouched by the check", async () => {
      await expect(
        internals().onBeforeUpdate(updateBy({ notifyAfterMinutes: 5 })),
      ).resolves.toBeDefined();
    });

    test.each([
      ["a mis-cased level", "critical"],
      ["a level that does not exist", "Silent"],
      ["null", null],
    ])(
      "changing the level to %s is refused",
      async (_label: string, value: unknown) => {
        await expect(
          internals().onBeforeUpdate(
            updateBy({ pushNotificationLevel: value } as JSONObject),
          ),
        ).rejects.toThrow(BadDataException);
      },
    );

    test("an unknown level is refused before any row is read", async () => {
      const readSpy: jest.SpyInstance = jest.spyOn(
        internals() as unknown as Record<
          string,
          () => Promise<Array<UserNotificationRule>>
        >,
        "findRowsAndHoldUpdateToThem",
      );

      await expect(
        internals().onBeforeUpdate({
          query: { _id: RULE_ID.toString() },
          data: { pushNotificationLevel: "Loud" },
          props: { userId: USER_ID, tenantId: PROJECT_ID },
        } as unknown as UpdateBy<UserNotificationRule>),
      ).rejects.toThrow(BadDataException);

      expect(readSpy).not.toHaveBeenCalled();
    });
  });
});

describe("an administrator's change to the level is part of the audited snapshot", () => {
  /*
   * When an administrator edits somebody else's rules, the rows are read
   * before the write and handed to the audit log as the "before" picture.
   * Without the level in that read, an administrator quieting a responder's
   * Sev 1 pages would be recorded as changing something from nothing.
   */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the update hook reads the level of the rows it is about to change", async () => {
    const readSpy: jest.SpyInstance = jest
      .spyOn(
        internals() as unknown as Record<
          string,
          () => Promise<Array<UserNotificationRule>>
        >,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([] as never);

    await internals().onBeforeUpdate({
      query: { _id: RULE_ID.toString() },
      data: { pushNotificationLevel: PushNotificationLevel.Standard },
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    } as unknown as UpdateBy<UserNotificationRule>);

    expect(readSpy).toHaveBeenCalledTimes(1);

    const select: JSONObject = readSpy.mock.calls[0]![1] as JSONObject;

    expect(select["pushNotificationLevel"]).toBe(true);
    // Beside the columns that were already part of the picture.
    expect(select["notifyAfterMinutes"]).toBe(true);
    expect(select["isOptOut"]).toBe(true);
    expect(select["userPushId"]).toBe(true);
  });

  test("the delete hook reads the level of the rows it is about to remove", async () => {
    const readSpy: jest.SpyInstance = jest
      .spyOn(
        internals() as unknown as Record<
          string,
          () => Promise<Array<UserNotificationRule>>
        >,
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([] as never);

    await (
      UserNotificationRuleService as unknown as {
        onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
      }
    ).onBeforeDelete({
      query: { _id: RULE_ID.toString() },
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    });

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(
      (readSpy.mock.calls[0]![1] as JSONObject)["pushNotificationLevel"],
    ).toBe(true);
  });
});
