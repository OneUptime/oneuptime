import UserPushService from "../../../Server/Services/UserPushService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PositiveNumber from "../../../Types/PositiveNumber";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "../../../Types/PushNotification/PushNotificationsTurnedOff";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A device can be created straight through the generic create API as well as
 * through registration. Registration only ever stores an alarm and volume it
 * understands; the generic route has to refuse the rest the same way, or a
 * row could claim an alarm no app plays and a volume no page uses.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<unknown>;
};

function create(data: Record<string, unknown>): Promise<unknown> {
  return (UserPushService as unknown as Hooks).onBeforeCreate({
    data: {
      deviceToken: "ExponentPushToken[handset]",
      deviceType: PushDeviceType.iOS,
      projectId: PROJECT_ID,
      ...data,
    },
    props: { userId: USER_ID, tenantId: PROJECT_ID },
  });
}

// What the hook answered: "went on", or the error it threw.
function settle(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => {
      return "went on";
    },
    (error: unknown) => {
      return error;
    },
  );
}

beforeEach(() => {
  jest
    .spyOn(UserPushService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  // Push on for the server: the hook refuses every device while it is off.
  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a device with an alarm sound", () => {
  test.each(["default", "klaxon", "siren", "digital", "smoke_alarm", "rising"])(
    "accepts %s",
    async (sound: string) => {
      expect(await settle(create({ criticalAlertSound: sound }))).toBe(
        "went on",
      );
    },
  );

  test("accepts a device that names no sound: the column's default applies", async () => {
    expect(await settle(create({}))).toBe("went on");
    expect(await settle(create({ criticalAlertSound: null }))).toBe("went on");
  });

  test.each([
    ["an unknown sound", "foghorn"],
    ["the wrong case", "Klaxon"],
    ["a title", "Smoke alarm"],
    ["a file name", "oneuptime_klaxon.wav"],
    ["an empty string", ""],
    ["a number", 3],
  ])(
    "refuses %s, naming the sounds there are",
    async (_label: string, sound: unknown) => {
      const outcome: unknown = await settle(
        create({ criticalAlertSound: sound }),
      );

      expect(outcome).toBeInstanceOf(BadDataException);
      expect((outcome as Error).message).toBe(
        "Critical alert sound must be one of: default, klaxon, siren, digital, smoke_alarm, rising.",
      );
    },
  );

  test("refuses before looking for a duplicate device", async () => {
    const countBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UserPushService,
      "countBy",
    );
    countBy.mockClear();

    await settle(create({ criticalAlertSound: "foghorn" }));

    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("creating a device with an alarm volume", () => {
  test.each([10, 25, 50, 75, 100])("accepts %d%%", async (volume: number) => {
    expect(await settle(create({ criticalAlertVolume: volume }))).toBe(
      "went on",
    );
  });

  test("accepts a device that names no volume", async () => {
    expect(await settle(create({ criticalAlertVolume: null }))).toBe("went on");
  });

  test.each([0, 9, 101, -25, 50.5, Number.NaN, "50"])(
    "refuses %p, saying what it may be",
    async (volume: unknown) => {
      const outcome: unknown = await settle(
        create({ criticalAlertVolume: volume }),
      );

      expect(outcome).toBeInstanceOf(BadDataException);
      expect((outcome as Error).message).toBe(
        "Critical alert volume must be a whole number from 10 to 100.",
      );
    },
  );

  test("a good sound with a bad volume is still refused", async () => {
    const outcome: unknown = await settle(
      create({ criticalAlertSound: "klaxon", criticalAlertVolume: 0 }),
    );

    expect((outcome as Error).message).toContain("Critical alert volume");
  });
});

describe("the checks that were there before still come first", () => {
  test("a missing device token is refused before the alarm is looked at", async () => {
    const outcome: unknown = await settle(
      (UserPushService as unknown as Hooks).onBeforeCreate({
        data: {
          deviceType: PushDeviceType.iOS,
          projectId: PROJECT_ID,
          criticalAlertSound: "foghorn",
        },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      }),
    );

    expect((outcome as Error).message).toBe("Device token is required");
  });
});

describe("creating a device while the server has push turned off", () => {
  test("refuses every device, saying why, through the generic create API too", async () => {
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(true);

    const answer: unknown = await settle(create({}));

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as BadDataException).message).toBe(
      PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
    );
  });

  test("a switch that cannot be read refuses the device too", async () => {
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockRejectedValue(new Error("database is down"));

    const answer: unknown = await settle(create({}));

    expect(answer).toBeInstanceOf(Error);
    expect((answer as Error).message).toBe("database is down");
  });
});
