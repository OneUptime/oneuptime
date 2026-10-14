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
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import {
  getRepeatClaimKey,
  MAX_NOTIFICATION_REPEATS,
} from "../../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
  getCriticalAlertSoundDefinition,
} from "../../../Types/PushNotification/CriticalAlertSound";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The delivery half of "repeat until acknowledged", and of the alarm a
 * responder chose for their phone.
 *
 * The on-call worker decides WHEN a push rule sends again (NotificationRepeat,
 * pinned in its own tests) and hands executeNotificationRuleItem the repeat's
 * number. From there three things have to hold, and none of them fails
 * loudly:
 *
 *   1. The repeat is claimed on the on-call log under its own key. Claimed
 *      under the rule's id it would find the first push's claim and never be
 *      sent - the second alarm that would have woken somebody, gone.
 *   2. The on-call log's timeline says which repeat went out. Otherwise ten
 *      repeats read as the same push logged eleven times, and nobody looking
 *      at a page afterwards can tell the responder was paged again and again.
 *   3. Every on-call push - first or repeat, for an incident, an alert or
 *      either kind of episode - carries the alarm and the iPhone volume the
 *      device chose. Lost on the way, the page plays the system sound at full
 *      volume instead of the alarm its owner picked.
 *
 * Driven through executeNotificationRuleItem with real models and the senders
 * stubbed, and inspected where the page is handed to the sender.
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

const DEVICE_TOKEN: string = "ExponentPushToken[repeat-device]";

const FIRST_PUSH_STATUS_MESSAGE: string =
  "Sending push notification to device.";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

/*
 * The private delivery half, reached through a structural cast the way the
 * neighbouring delivery tests reach it: an ordinary prototype method at
 * runtime.
 */
interface ServiceInternals {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
}

function internals(): ServiceInternals {
  return UserNotificationRuleService as unknown as ServiceInternals;
}

// The status of a timeline row, snapshotted when it is written.
interface TimelineSnapshot {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  userPushId: string | undefined;
  userNotificationRuleId: string | undefined;
}

function pushDevice(
  data: {
    isCriticalAlertEnabled?: boolean | undefined;
    deviceType?: PushDeviceType | undefined;
    criticalAlertSound?: CriticalAlertSound | undefined;
    criticalAlertVolume?: number | undefined;
  } = {},
): UserPush {
  const device: UserPush = new UserPush();
  device._id = PUSH_METHOD_ID.toString();
  device.deviceToken = DEVICE_TOKEN;
  device.deviceType = data.deviceType || PushDeviceType.iOS;
  device.isVerified = true;
  device.userId = USER_ID;
  device.isCriticalAlertEnabled =
    data.isCriticalAlertEnabled === undefined
      ? true
      : data.isCriticalAlertEnabled;

  if (data.criticalAlertSound !== undefined) {
    device.criticalAlertSound = data.criticalAlertSound;
  }

  if (data.criticalAlertVolume !== undefined) {
    device.criticalAlertVolume = data.criticalAlertVolume;
  }

  return device;
}

// A push rule as executeNotificationRuleItem's read returns it.
function pushRule(
  device: UserPush,
  level: PushNotificationLevel = PushNotificationLevel.Critical,
): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = RULE_ID.toString();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;
  rule.repeatEveryMinutes = 5;
  rule.pushNotificationLevel = level;
  rule.userPush = device;
  rule.userPushId = PUSH_METHOD_ID;

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
  eventType: UserNotificationEventType,
  repeatNumber?: number | undefined,
): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: eventType,
    userNotificationLogId: LOG_ID,
    ...TRIGGER_ID_FOR_EVENT[eventType],
    ...(repeatNumber !== undefined ? { repeatNumber: repeatNumber } : {}),
  } as ExecuteOptions;
}

const PAGING_EVENTS: Array<[string, UserNotificationEventType]> = [
  ["an incident", UserNotificationEventType.IncidentCreated],
  ["an alert", UserNotificationEventType.AlertCreated],
  ["an alert episode", UserNotificationEventType.AlertEpisodeCreated],
  ["an incident episode", UserNotificationEventType.IncidentEpisodeCreated],
];

// What the timeline should say for a push: the first, or repeat n.
function expectedStatusMessage(repeatNumber: number | undefined): string {
  if (repeatNumber && repeatNumber > 0) {
    return `Sending push notification to device again (repeat ${repeatNumber} of 10, until acknowledged).`;
  }

  return FIRST_PUSH_STATUS_MESSAGE;
}

interface Stubs {
  claim: jest.SpyInstance;
  findRule: jest.SpyInstance;
  push: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
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

/*
 * Everything a page reads on its way to the sender, answered without a
 * database. The rule read answers with `rule`, as the select loads it.
 */
function stubPagingPath(
  rule: UserNotificationRule,
  timelineRows: Array<TimelineSnapshot>,
): Stubs {
  silenceLogger();

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
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://dashboard.example.com/alert-episode") as never,
    );

  jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
    id: INCIDENT_EPISODE_ID,
    projectId: PROJECT_ID,
    title: "Payments degraded",
    episodeNumber: 4,
  } as unknown as never);
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://dashboard.example.com/incident-episode") as never,
    );

  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  return {
    claim: jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never),
    findRule: jest
      .spyOn(UserNotificationRuleService, "findOneById")
      .mockResolvedValue(rule as never),
    push: jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined as never),
    timelineCreate: jest
      .spyOn(UserOnCallLogTimelineService, "create")
      .mockImplementation(
        (createBy: unknown): Promise<UserOnCallLogTimeline> => {
          const data: UserOnCallLogTimeline = (
            createBy as { data: UserOnCallLogTimeline }
          ).data;

          // The service writes one instance again and again: copy it now.
          timelineRows.push({
            status: data.status,
            statusMessage: data.statusMessage,
            userPushId: data.userPushId?.toString(),
            userNotificationRuleId: data.userNotificationRuleId?.toString(),
          });

          return Promise.resolve({
            id: TIMELINE_ID,
          } as unknown as UserOnCallLogTimeline);
        },
      ) as unknown as jest.SpyInstance,
  };
}

function sentRequests(push: jest.SpyInstance): Array<PushNotificationRequest> {
  return push.mock.calls.map(
    (call: Array<unknown>): PushNotificationRequest => {
      return call[0] as PushNotificationRequest;
    },
  );
}

describe("a repeat is claimed under its own key", () => {
  let timelineRows: Array<TimelineSnapshot>;
  let stubs: Stubs;

  beforeEach(() => {
    timelineRows = [];
    stubs = stubPagingPath(pushRule(pushDevice()), timelineRows);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10]])(
    "repeat %s is handed to the claim, for this log and this rule",
    async (repeatNumber: number) => {
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(UserNotificationEventType.IncidentCreated, repeatNumber),
      );

      expect(stubs.claim).toHaveBeenCalledTimes(1);

      const claimArg: {
        userOnCallLogId: ObjectID;
        userNotificationRuleId: ObjectID;
        repeatNumber?: number | undefined;
      } = stubs.claim.mock.calls[0]![0] as {
        userOnCallLogId: ObjectID;
        userNotificationRuleId: ObjectID;
        repeatNumber?: number | undefined;
      };

      expect(claimArg.userOnCallLogId.toString()).toBe(LOG_ID.toString());
      expect(claimArg.userNotificationRuleId.toString()).toBe(
        RULE_ID.toString(),
      );
      expect(claimArg.repeatNumber).toBe(repeatNumber);
    },
  );

  test("the first push is handed to the claim with no repeat number, as before", async () => {
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.IncidentCreated),
    );

    expect(
      (stubs.claim.mock.calls[0]![0] as { repeatNumber?: number | undefined })
        .repeatNumber,
    ).toBeUndefined();
  });

  test("a repeat whose claim is lost sends nothing, and reads nothing", async () => {
    /*
     * Another worker already sent this repeat. Going on would page the
     * responder twice for the same repeat - and the loser must stop before
     * it even reads the rule, as a lost first push does.
     */
    stubs.claim.mockResolvedValue(false as never);

    await expect(
      UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(UserNotificationEventType.IncidentCreated, 3),
      ),
    ).resolves.toBeUndefined();

    expect(stubs.findRule).not.toHaveBeenCalled();
    expect(stubs.push).not.toHaveBeenCalled();
    expect(stubs.timelineCreate).not.toHaveBeenCalled();
  });

  test.each(PAGING_EVENTS)(
    "a lost repeat claim for %s sends nothing",
    async (_label: string, eventType: UserNotificationEventType) => {
      stubs.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(eventType, MAX_NOTIFICATION_REPEATS),
      );

      expect(stubs.push).not.toHaveBeenCalled();
      expect(timelineRows).toEqual([]);
    },
  );
});

describe("a repeat through the real claim", () => {
  /*
   * The claim itself left unstubbed, down to the SQL it sends: what the
   * worker's repeat number turns into on the log.
   */
  let timelineRows: Array<TimelineSnapshot>;
  let stubs: Stubs;
  let query: jest.Mock;

  beforeEach(() => {
    timelineRows = [];
    stubs = stubPagingPath(pushRule(pushDevice()), timelineRows);
    stubs.claim.mockRestore();

    query = jest.fn();

    jest.spyOn(UserOnCallLogService, "getRepository").mockReturnValue({
      manager: {
        query,
      },
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function boundClaimKey(): string {
    return (query.mock.calls[0] as [string, Array<unknown>])[1][1] as string;
  }

  test("repeat 3 is claimed under the rule's third repeat key, and sent when the claim is won", async () => {
    query.mockResolvedValue([{ _id: LOG_ID.toString() }]);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.IncidentCreated, 3),
    );

    expect(boundClaimKey()).toBe(getRepeatClaimKey(RULE_ID.toString(), 3));
    expect(stubs.push).toHaveBeenCalledTimes(1);
  });

  test("repeat 3 already on the log is not sent again", async () => {
    // The guarded UPDATE found the key: no row came back.
    query.mockResolvedValue([]);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.IncidentCreated, 3),
    );

    expect(boundClaimKey()).toBe(getRepeatClaimKey(RULE_ID.toString(), 3));
    expect(stubs.findRule).not.toHaveBeenCalled();
    expect(stubs.push).not.toHaveBeenCalled();
  });

  test("the first push is still claimed under the rule's own id", async () => {
    query.mockResolvedValue([{ _id: LOG_ID.toString() }]);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.IncidentCreated),
    );

    expect(boundClaimKey()).toBe(RULE_ID.toString());
    expect(stubs.push).toHaveBeenCalledTimes(1);
  });
});

describe("the on-call log's timeline says which push went out", () => {
  let timelineRows: Array<TimelineSnapshot>;
  let stubs: Stubs;

  beforeEach(() => {
    timelineRows = [];
    stubs = stubPagingPath(pushRule(pushDevice()), timelineRows);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const PUSHES: Array<[string, number | undefined]> = [
    ["the first push", undefined],
    ["repeat 0 - the first push by another name", 0],
    ["repeat 1", 1],
    ["repeat 5", 5],
    ["the tenth and last repeat", MAX_NOTIFICATION_REPEATS],
  ];

  // Every push - first or repeat - for every kind of page.
  const PUSHES_FOR_EVENTS: Array<
    [string, string, UserNotificationEventType, number | undefined]
  > = PAGING_EVENTS.flatMap(
    ([eventLabel, eventType]: [string, UserNotificationEventType]): Array<
      [string, string, UserNotificationEventType, number | undefined]
    > => {
      return PUSHES.map(
        ([pushLabel, repeatNumber]: [string, number | undefined]): [
          string,
          string,
          UserNotificationEventType,
          number | undefined,
        ] => {
          return [pushLabel, eventLabel, eventType, repeatNumber];
        },
      );
    },
  );

  test.each(PUSHES_FOR_EVENTS)(
    "%s for %s",
    async (
      _pushLabel: string,
      _eventLabel: string,
      eventType: UserNotificationEventType,
      repeatNumber: number | undefined,
    ) => {
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(eventType, repeatNumber),
      );

      expect(stubs.push).toHaveBeenCalledTimes(1);
      expect(timelineRows).toEqual([
        {
          status: UserNotificationStatus.Sending,
          statusMessage: expectedStatusMessage(repeatNumber),
          userPushId: PUSH_METHOD_ID.toString(),
          userNotificationRuleId: RULE_ID.toString(),
        },
      ]);
    },
  );

  test("a repeat reads as a repeat - the words a responder's team sees on the log", async () => {
    /*
     * Pinned as written: this sentence is what the on-call log shows for
     * every repeat, and "again", the count and "until acknowledged" are what
     * tell a reader the phone kept ringing and why.
     */
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.AlertCreated, 4),
    );

    expect(timelineRows[0]!.statusMessage).toBe(
      "Sending push notification to device again (repeat 4 of 10, until acknowledged).",
    );
  });

  test("a push that fails after the timeline row is written still marks that row, repeat or not", async () => {
    stubs.push.mockRejectedValue(new Error("Expo is unavailable") as never);

    const timelineUpdate: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "updateOneById",
    );

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.IncidentCreated, 2),
    );

    // The send is not awaited; let its rejection land.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(timelineRows[0]!.statusMessage).toBe(expectedStatusMessage(2));
    expect(timelineUpdate).toHaveBeenCalledTimes(1);
    expect(
      (
        timelineUpdate.mock.calls[0]![0] as {
          data: { status: UserNotificationStatus; statusMessage: string };
        }
      ).data,
    ).toEqual({
      status: UserNotificationStatus.Error,
      statusMessage: "Expo is unavailable",
    });
  });
});

describe("a repeat is the same page, sent again", () => {
  /*
   * A repeat exists to wake somebody the first push did not. It must not be
   * a weaker page: the same device, the same words, the same critical flag
   * and the same alarm.
   */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  for (const [eventLabel, eventType] of PAGING_EVENTS) {
    test(`for ${eventLabel}`, async () => {
      const timelineRows: Array<TimelineSnapshot> = [];
      const stubs: Stubs = stubPagingPath(
        pushRule(
          pushDevice({
            criticalAlertSound: CriticalAlertSound.Siren,
            criticalAlertVolume: 75,
          }),
        ),
        timelineRows,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(eventType),
      );
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(eventType, 6),
      );

      const [firstPush, repeat] = sentRequests(stubs.push);

      expect(repeat).toEqual(firstPush);
      expect(repeat!.message.isCriticalAlert).toBe(true);
      expect(repeat!.message.criticalAlertSound).toBe(CriticalAlertSound.Siren);
      expect(repeat!.message.criticalAlertVolume).toBe(75);

      // Only the timeline tells the two apart.
      expect(
        timelineRows.map((row: TimelineSnapshot): string | undefined => {
          return row.statusMessage;
        }),
      ).toEqual([expectedStatusMessage(undefined), expectedStatusMessage(6)]);
    });
  }
});

describe("every on-call push carries the alarm and volume the device chose", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function deliver(data: {
    device: UserPush;
    eventType: UserNotificationEventType;
    level?: PushNotificationLevel | undefined;
    repeatNumber?: number | undefined;
  }): Promise<PushNotificationRequest> {
    const stubs: Stubs = stubPagingPath(pushRule(data.device, data.level), []);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(data.eventType, data.repeatNumber),
    );

    expect(stubs.push).toHaveBeenCalledTimes(1);

    return sentRequests(stubs.push)[0]!;
  }

  for (const [eventLabel, eventType] of PAGING_EVENTS) {
    test(`${eventLabel}'s page carries the device's chosen alarm and volume`, async () => {
      const request: PushNotificationRequest = await deliver({
        device: pushDevice({
          criticalAlertSound: CriticalAlertSound.Klaxon,
          criticalAlertVolume: 50,
        }),
        eventType: eventType,
      });

      expect(request.message.isCriticalAlert).toBe(true);
      expect(request.message.criticalAlertSound).toBe(
        CriticalAlertSound.Klaxon,
      );
      expect(request.message.criticalAlertVolume).toBe(50);
    });

    test(`${eventLabel}'s repeats carry them too`, async () => {
      const request: PushNotificationRequest = await deliver({
        device: pushDevice({
          criticalAlertSound: CriticalAlertSound.SmokeAlarm,
          criticalAlertVolume: 25,
        }),
        eventType: eventType,
        repeatNumber: MAX_NOTIFICATION_REPEATS,
      });

      expect(request.message.criticalAlertSound).toBe(
        CriticalAlertSound.SmokeAlarm,
      );
      expect(request.message.criticalAlertVolume).toBe(25);
    });

    test(`${eventLabel}'s page to a device that never chose carries no choice, so delivery plays the defaults`, async () => {
      /*
       * Every device registered before the choice existed reads back with
       * neither column set. The page must not invent one.
       */
      const request: PushNotificationRequest = await deliver({
        device: pushDevice(),
        eventType: eventType,
      });

      expect(request.message.criticalAlertSound).toBeUndefined();
      expect(request.message.criticalAlertVolume).toBeUndefined();
    });
  }

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, CriticalAlertSound] => {
        return [definition.title, definition.sound];
      },
    ),
  )(
    "%s: the sound the device stored reaches the page",
    async (_title: string, sound: CriticalAlertSound) => {
      const request: PushNotificationRequest = await deliver({
        device: pushDevice({ criticalAlertSound: sound }),
        eventType: UserNotificationEventType.IncidentCreated,
      });

      expect(request.message.criticalAlertSound).toBe(sound);
    },
  );

  test("an iPhone's critical page plays the chosen file at the chosen volume", async () => {
    const request: PushNotificationRequest = await deliver({
      device: pushDevice({
        deviceType: PushDeviceType.iOS,
        criticalAlertSound: CriticalAlertSound.Rising,
        criticalAlertVolume: 50,
      }),
      eventType: UserNotificationEventType.AlertCreated,
      repeatNumber: 2,
    });

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.iOS,
      );

    expect(delivery.sound).toEqual({
      critical: true,
      name: getCriticalAlertSoundDefinition(CriticalAlertSound.Rising)
        .iosSoundName,
      volume: 0.5,
    });
    expect(delivery.interruptionLevel).toBe("critical");
  });

  test("an Android phone's critical page goes out on the chosen alarm's channel", async () => {
    const request: PushNotificationRequest = await deliver({
      device: pushDevice({
        deviceType: PushDeviceType.Android,
        criticalAlertSound: CriticalAlertSound.Digital,
      }),
      eventType: UserNotificationEventType.IncidentEpisodeCreated,
      repeatNumber: 1,
    });

    expect(
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.Android,
      ).channelId,
    ).toBe(AndroidNotificationChannel.CriticalDigital);
  });

  test("a Standard rule's page carries the choice but plays as an ordinary push", async () => {
    /*
     * The alarm is for critical pages. A rule its owner set to Standard pages
     * quietly whatever alarm the phone chose - the choice travels, and
     * delivery reads it only when the page is critical.
     */
    const request: PushNotificationRequest = await deliver({
      device: pushDevice({
        deviceType: PushDeviceType.Android,
        criticalAlertSound: CriticalAlertSound.Klaxon,
        criticalAlertVolume: 100,
      }),
      eventType: UserNotificationEventType.AlertEpisodeCreated,
      level: PushNotificationLevel.Standard,
    });

    expect(request.message.isCriticalAlert).toBe(false);
    expect(request.message.criticalAlertSound).toBe(CriticalAlertSound.Klaxon);

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.Android,
      );

    expect(delivery.channelId).toBe(AndroidNotificationChannel.High);
    expect(delivery.sound).toBe("default");
    expect(delivery.interruptionLevel).toBeUndefined();
  });

  test("a device that did not opt into critical alerts is not rung through silent mode by its alarm choice", async () => {
    const request: PushNotificationRequest = await deliver({
      device: pushDevice({
        isCriticalAlertEnabled: false,
        deviceType: PushDeviceType.iOS,
        criticalAlertSound: CriticalAlertSound.Siren,
        criticalAlertVolume: 100,
      }),
      eventType: UserNotificationEventType.IncidentCreated,
    });

    expect(request.message.isCriticalAlert).toBe(false);
    expect(
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.iOS,
      ).interruptionLevel,
    ).toBeUndefined();
  });
});

describe("the rule read loads the device's alarm and volume", () => {
  /*
   * Unselected, both read as undefined - the defaults - and nothing errors:
   * every page would quietly play the system sound at full volume.
   */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function userPushSelect(): Promise<JSONObject> {
    const stubs: Stubs = stubPagingPath(pushRule(pushDevice()), []);

    jest
      .spyOn(
        internals() as unknown as Record<string, () => Promise<boolean>>,
        "deliverNotificationForRule",
      )
      .mockResolvedValue(true as never);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.IncidentCreated, 1),
    );

    return (stubs.findRule.mock.calls[0]![0] as { select: JSONObject }).select[
      "userPush"
    ] as JSONObject;
  }

  test("criticalAlertSound and criticalAlertVolume are selected on the device", async () => {
    const select: JSONObject = await userPushSelect();

    expect(select["criticalAlertSound"]).toBe(true);
    expect(select["criticalAlertVolume"]).toBe(true);
  });

  test("beside the columns the push already depended on", async () => {
    const select: JSONObject = await userPushSelect();

    expect(select["deviceToken"]).toBe(true);
    expect(select["deviceType"]).toBe(true);
    expect(select["isVerified"]).toBe(true);
    expect(select["isCriticalAlertEnabled"]).toBe(true);
  });

  test("the repeat number is handed on to the delivery half", async () => {
    const stubs: Stubs = stubPagingPath(pushRule(pushDevice()), []);

    const deliver: jest.SpyInstance = jest
      .spyOn(
        internals() as unknown as Record<string, () => Promise<boolean>>,
        "deliverNotificationForRule",
      )
      .mockResolvedValue(true as never);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(UserNotificationEventType.AlertCreated, 7),
    );

    expect(stubs.findRule).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(
      (deliver.mock.calls[0]![1] as { repeatNumber?: number | undefined })
        .repeatNumber,
    ).toBe(7);
  });
});
