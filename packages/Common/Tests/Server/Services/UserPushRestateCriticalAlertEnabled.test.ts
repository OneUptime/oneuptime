import UserPushService from "../../../Server/Services/UserPushService";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import CriticalAlertSound from "../../../Types/PushNotification/CriticalAlertSound";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * restateCriticalAlertEnabled is what a phone's registration does to the
 * device it already has: the device takes whether critical pages ring
 * through on the phone, as the phone restates it. Before, a device that was
 * already registered kept what it was created with, so the Dashboard went on
 * reading "On" for a phone whose critical alerts were off.
 *
 * The app registers on every start and every return to it, once per project,
 * so the write happens only when the value differs - nothing while nothing
 * changes - and only the switch: the alarm and volume of a device the phone
 * already has are the critical-alert-preferences route's to change.
 */

const DEVICE_ID: string = "7f000000-0000-4000-8000-000000000131";

interface UpdateCall {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

function device(overrides: Record<string, unknown> = {}): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = DEVICE_ID;
  userPush.deviceType = PushDeviceType.iOS;
  userPush.isCriticalAlertEnabled = true;
  userPush.criticalAlertSound = CriticalAlertSound.Klaxon;
  userPush.criticalAlertVolume = 25;

  for (const [key, value] of Object.entries(overrides)) {
    (userPush as unknown as Record<string, unknown>)[key] = value;
  }

  return userPush;
}

describe("UserPushService.restateCriticalAlertEnabled", () => {
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
    const isEnabled: boolean =
      await UserPushService.restateCriticalAlertEnabled({
        device: device(),
        isCriticalAlertEnabled: false,
      });

    expect(updates).toEqual([
      {
        query: { _id: DEVICE_ID },
        data: { isCriticalAlertEnabled: false },
        props: { isRoot: true },
      },
    ]);
    expect(isEnabled).toBe(false);
  });

  test("a phone that turned them on: the device is turned on", async () => {
    const isEnabled: boolean =
      await UserPushService.restateCriticalAlertEnabled({
        device: device({
          deviceType: PushDeviceType.Android,
          isCriticalAlertEnabled: false,
        }),
        isCriticalAlertEnabled: true,
      });

    expect(
      updates.map((call: UpdateCall): Record<string, unknown> => {
        return call.data;
      }),
    ).toEqual([{ isCriticalAlertEnabled: true }]);
    expect(isEnabled).toBe(true);
  });

  test.each([[true], [false]])(
    "what the device already holds (%s) writes nothing",
    async (isEnabled: boolean) => {
      expect(
        await UserPushService.restateCriticalAlertEnabled({
          device: device({ isCriticalAlertEnabled: isEnabled }),
          isCriticalAlertEnabled: isEnabled,
        }),
      ).toBe(isEnabled);
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("nothing stated - an app that does not know, or could not ask the OS - writes nothing, and says what the device holds", async () => {
    expect(
      await UserPushService.restateCriticalAlertEnabled({
        device: device({ isCriticalAlertEnabled: true }),
        isCriticalAlertEnabled: undefined,
      }),
    ).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a device read without the flag counts it as off: stating off writes nothing", async () => {
    const userPush: UserPush = device();
    delete (userPush as unknown as Record<string, unknown>)[
      "isCriticalAlertEnabled"
    ];

    expect(
      await UserPushService.restateCriticalAlertEnabled({
        device: userPush,
        isCriticalAlertEnabled: false,
      }),
    ).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a browser's device is never written: no browser can ring through silent mode", async () => {
    expect(
      await UserPushService.restateCriticalAlertEnabled({
        device: device({
          deviceType: PushDeviceType.Web,
          isCriticalAlertEnabled: false,
        }),
        isCriticalAlertEnabled: true,
      }),
    ).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a device of no known type is not written either", async () => {
    await UserPushService.restateCriticalAlertEnabled({
      device: device({ deviceType: "watch" }),
      isCriticalAlertEnabled: false,
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a device read without its id is not written", async () => {
    const userPush: UserPush = device();
    delete (userPush as unknown as Record<string, unknown>)["_id"];

    await UserPushService.restateCriticalAlertEnabled({
      device: userPush,
      isCriticalAlertEnabled: false,
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  /*
   * A registration reads the alarm and volume once, before it tells each
   * project in turn: restating them could put back an alarm the responder
   * changed meanwhile on the critical-alert-preferences route.
   */
  test("only ever writes the switch: the device's alarm and volume are left as they are", async () => {
    await UserPushService.restateCriticalAlertEnabled({
      device: device(),
      isCriticalAlertEnabled: false,
    });

    expect(Object.keys(updates[0]!.data)).toEqual(["isCriticalAlertEnabled"]);
  });

  test("a write that fails is not hidden: the route decides what to do about it", async () => {
    updateSpy.mockRejectedValueOnce(new Error("Database not connected"));

    await expect(
      UserPushService.restateCriticalAlertEnabled({
        device: device(),
        isCriticalAlertEnabled: false,
      }),
    ).rejects.toThrow("Database not connected");
  });
});
