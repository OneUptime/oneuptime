import UserPushService, {
  CriticalAlertChoices,
} from "../../../Server/Services/UserPushService";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import CriticalAlertSound from "../../../Types/PushNotification/CriticalAlertSound";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * restateCriticalAlertChoices is what a phone's registration does to the
 * device it already has: the device takes whether critical pages ring
 * through on the phone, and the alarm and volume, as the phone restates
 * them. Before, a device that was already registered kept what it was
 * created with, so the Dashboard went on reading "On" for a phone whose
 * critical alerts were off.
 *
 * The app registers on every start and every return to it, once per project,
 * so the write is only ever what differs - nothing while nothing changes.
 */

const DEVICE_ID: string = "7f000000-0000-4000-8000-000000000131";

interface UpdateCall {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

function device(overrides: Partial<UserPush> = {}): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = DEVICE_ID;
  userPush.deviceType = PushDeviceType.iOS;
  userPush.isCriticalAlertEnabled = true;
  userPush.criticalAlertSound = CriticalAlertSound.Default;
  userPush.criticalAlertVolume = 100;

  for (const [key, value] of Object.entries(overrides)) {
    (userPush as unknown as Record<string, unknown>)[key] = value;
  }

  return userPush;
}

describe("UserPushService.restateCriticalAlertChoices", () => {
  let updateSpy: jest.SpyInstance;
  let updates: Array<UpdateCall>;

  beforeEach(() => {
    updates = [];

    updateSpy = jest
      .spyOn(UserPushService, "updateOneBy")
      .mockImplementation((updateBy: unknown): Promise<number> => {
        updates.push(updateBy as UpdateCall);
        return Promise.resolve(1);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a phone that turned critical alerts off: the device is turned off, by its id, as root", async () => {
    const choices: CriticalAlertChoices =
      await UserPushService.restateCriticalAlertChoices({
        device: device(),
        stated: { isCriticalAlertEnabled: false },
      });

    expect(updates).toEqual([
      {
        query: { _id: DEVICE_ID },
        data: { isCriticalAlertEnabled: false },
        props: { isRoot: true },
      },
    ]);
    expect(choices).toEqual({
      isCriticalAlertEnabled: false,
      criticalAlertSound: CriticalAlertSound.Default,
      criticalAlertVolume: 100,
    });
  });

  test("a phone that turned them on: the device is turned on", async () => {
    const choices: CriticalAlertChoices =
      await UserPushService.restateCriticalAlertChoices({
        device: device({
          deviceType: PushDeviceType.Android,
          isCriticalAlertEnabled: false,
        }),
        stated: { isCriticalAlertEnabled: true },
      });

    expect(
      updates.map((call: UpdateCall) => {
        return call.data;
      }),
    ).toEqual([{ isCriticalAlertEnabled: true }]);
    expect(choices.isCriticalAlertEnabled).toBe(true);
  });

  test("what the device already holds writes nothing", async () => {
    const choices: CriticalAlertChoices =
      await UserPushService.restateCriticalAlertChoices({
        device: device(),
        stated: {
          isCriticalAlertEnabled: true,
          criticalAlertSound: CriticalAlertSound.Default,
          criticalAlertVolume: 100,
        },
      });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(choices).toEqual({
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.Default,
      criticalAlertVolume: 100,
    });
  });

  test("nothing stated writes nothing, and says what the device holds", async () => {
    const choices: CriticalAlertChoices =
      await UserPushService.restateCriticalAlertChoices({
        device: device({ isCriticalAlertEnabled: false }),
        stated: {},
      });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(choices.isCriticalAlertEnabled).toBe(false);
  });

  test("only what differs is written: the alarm alone", async () => {
    await UserPushService.restateCriticalAlertChoices({
      device: device(),
      stated: {
        isCriticalAlertEnabled: true,
        criticalAlertSound: CriticalAlertSound.SmokeAlarm,
        criticalAlertVolume: 100,
      },
    });

    expect(
      updates.map((call: UpdateCall) => {
        return call.data;
      }),
    ).toEqual([{ criticalAlertSound: CriticalAlertSound.SmokeAlarm }]);
  });

  test("only what differs is written: the volume alone", async () => {
    await UserPushService.restateCriticalAlertChoices({
      device: device(),
      stated: { criticalAlertVolume: 75 },
    });

    expect(
      updates.map((call: UpdateCall) => {
        return call.data;
      }),
    ).toEqual([{ criticalAlertVolume: 75 }]);
  });

  test("everything that differs goes in one write, and the answer is the device after it", async () => {
    const choices: CriticalAlertChoices =
      await UserPushService.restateCriticalAlertChoices({
        device: device({
          isCriticalAlertEnabled: false,
          criticalAlertSound: CriticalAlertSound.Klaxon,
          criticalAlertVolume: 25,
        }),
        stated: {
          isCriticalAlertEnabled: true,
          criticalAlertSound: CriticalAlertSound.Rising,
          criticalAlertVolume: 50,
        },
      });

    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toEqual({
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.Rising,
      criticalAlertVolume: 50,
    });
    expect(choices).toEqual({
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.Rising,
      criticalAlertVolume: 50,
    });
  });

  test("a device read without the flag counts it as off: stating off writes nothing", async () => {
    const userPush: UserPush = device();
    delete (userPush as unknown as Record<string, unknown>)[
      "isCriticalAlertEnabled"
    ];

    await UserPushService.restateCriticalAlertChoices({
      device: userPush,
      stated: { isCriticalAlertEnabled: false },
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a browser's device is never written: no browser can ring through silent mode", async () => {
    const choices: CriticalAlertChoices =
      await UserPushService.restateCriticalAlertChoices({
        device: device({
          deviceType: PushDeviceType.Web,
          isCriticalAlertEnabled: false,
        }),
        stated: {
          isCriticalAlertEnabled: true,
          criticalAlertSound: CriticalAlertSound.Siren,
        },
      });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(choices.isCriticalAlertEnabled).toBe(false);
  });

  test("a device of no known type is not written either", async () => {
    await UserPushService.restateCriticalAlertChoices({
      device: device({ deviceType: "watch" as PushDeviceType }),
      stated: { isCriticalAlertEnabled: false },
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a device read without its id is not written", async () => {
    const userPush: UserPush = device();
    delete (userPush as unknown as Record<string, unknown>)["_id"];

    await UserPushService.restateCriticalAlertChoices({
      device: userPush,
      stated: { isCriticalAlertEnabled: false },
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("only ever writes the three critical alert columns", async () => {
    await UserPushService.restateCriticalAlertChoices({
      device: device({
        isCriticalAlertEnabled: false,
        criticalAlertSound: CriticalAlertSound.Klaxon,
        criticalAlertVolume: 25,
      }),
      stated: {
        isCriticalAlertEnabled: true,
        criticalAlertSound: CriticalAlertSound.Default,
        criticalAlertVolume: 100,
      },
    });

    expect(Object.keys(updates[0]!.data).sort()).toEqual([
      "criticalAlertSound",
      "criticalAlertVolume",
      "isCriticalAlertEnabled",
    ]);
  });
});
