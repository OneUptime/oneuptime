import UserPushService from "../../../Server/Services/UserPushService";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
} from "../../../Types/PushNotification/CriticalAlertSound";
import { CRITICAL_ALERT_VOLUME_OPTIONS } from "../../../Types/PushNotification/CriticalAlertVolume";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * setCriticalAlertPreferencesForDeviceToken is how a phone tells the server
 * which alarm its critical pages play and, on an iPhone, how loud. Like the
 * critical alerts switch it is keyed on the push TOKEN: one handset owns one
 * UserPush row per project it is registered against, and a responder who
 * picks a klaxon means it for the phone - not for whichever project they
 * happened to be looking at. A phone that is loud for one project and quiet
 * for the next is a distinction no screen offers, so nobody would check it.
 *
 * The write is as narrow as the request: a sound alone keeps the stored
 * volume, a volume alone keeps the stored sound, and neither touches the
 * switch, the device's verification or anything else on the row.
 *
 * renewExpoPushDevice carries the choice over to a phone's new token the
 * same way: written when the phone says, kept when it does not.
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000702",
);
const DEVICE_TOKEN: string = "ExponentPushToken[handset-preferences-01]";

const DEVICE_ONE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_TWO_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE_THREE_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const NOTHING_TO_SET: string =
  "Give a critical alert sound, a critical alert volume, or both.";

function device(id: string, deviceType: PushDeviceType): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = id;
  userPush.deviceType = deviceType;

  return userPush;
}

interface UpdateCall {
  id: string;
  data: Record<string, unknown>;
  isRoot: boolean | undefined;
}

type Preferences = Parameters<
  typeof UserPushService.setCriticalAlertPreferencesForDeviceToken
>[0];

describe("UserPushService.setCriticalAlertPreferencesForDeviceToken", () => {
  let findSpy: SpyInstance<typeof UserPushService.findBy>;
  let updateSpy: SpyInstance<typeof UserPushService.updateOneBy>;
  let updateCalls: Array<UpdateCall>;

  beforeEach(() => {
    updateCalls = [];

    findSpy = jest
      .spyOn(UserPushService, "findBy")
      .mockResolvedValue([
        device(DEVICE_ONE_ID, PushDeviceType.iOS),
        device(DEVICE_TWO_ID, PushDeviceType.iOS),
      ] as never);

    updateSpy = jest
      .spyOn(UserPushService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: { _id: string };
        data: Record<string, unknown>;
        props: { isRoot?: boolean };
      }): Promise<number> => {
        updateCalls.push({
          id: updateBy.query._id,
          data: { ...updateBy.data },
          isRoot: updateBy.props.isRoot,
        });

        return 1;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function setPreferences(
    preferences: Partial<Preferences>,
  ): Promise<number> {
    return await UserPushService.setCriticalAlertPreferencesForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      ...preferences,
    });
  }

  test("a sound alone is written to every project the handset is registered against, and nothing else", async () => {
    const updated: number = await setPreferences({
      sound: CriticalAlertSound.Klaxon,
    });

    expect(updated).toBe(2);
    expect(updateCalls).toEqual([
      {
        id: DEVICE_ONE_ID,
        data: { criticalAlertSound: CriticalAlertSound.Klaxon },
        isRoot: true,
      },
      {
        id: DEVICE_TWO_ID,
        data: { criticalAlertSound: CriticalAlertSound.Klaxon },
        isRoot: true,
      },
    ]);
  });

  test("a volume alone keeps the stored sound", async () => {
    await setPreferences({ volumePercent: 50 });

    expect(
      updateCalls.map((call: UpdateCall): Record<string, unknown> => {
        return call.data;
      }),
    ).toEqual([{ criticalAlertVolume: 50 }, { criticalAlertVolume: 50 }]);
  });

  test("a sound and a volume are written together, in one write per device", async () => {
    await setPreferences({
      sound: CriticalAlertSound.Siren,
      volumePercent: 75,
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateCalls[0]?.data).toEqual({
      criticalAlertSound: CriticalAlertSound.Siren,
      criticalAlertVolume: 75,
    });
    expect(updateCalls[1]?.data).toEqual(updateCalls[0]?.data);
  });

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [CriticalAlertSound] => {
        return [definition.sound];
      },
    ),
  )("stores %s as itself", async (sound: CriticalAlertSound) => {
    await setPreferences({ sound: sound });

    expect(updateCalls[0]?.data).toEqual({ criticalAlertSound: sound });
  });

  test("choosing the default sound is a choice, written like any other", async () => {
    /*
     * Going back to the system sound has to reach the server too, or a
     * responder who tried the siren and went back would keep the siren.
     */
    await setPreferences({ sound: CriticalAlertSound.Default });

    expect(updateCalls[0]?.data).toEqual({
      criticalAlertSound: CriticalAlertSound.Default,
    });
  });

  test.each(
    CRITICAL_ALERT_VOLUME_OPTIONS.map((volume: number): [number] => {
      return [volume];
    }),
  )("stores %s%% as itself", async (volume: number) => {
    await setPreferences({ volumePercent: volume });

    expect(updateCalls[0]?.data).toEqual({ criticalAlertVolume: volume });
  });

  test.each([
    ["nothing at all", {}],
    ["both left undefined", { sound: undefined, volumePercent: undefined }],
  ])(
    "refuses %s before reading anything",
    async (_label: string, preferences: Partial<Preferences>) => {
      let refusal: unknown = undefined;

      try {
        await setPreferences(preferences);
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(NOTHING_TO_SET);
      expect(findSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("looks the handset up scoped to its owner, as root, so a token cannot reconfigure somebody else's phone", async () => {
    await setPreferences({ sound: CriticalAlertSound.Digital });

    expect(findSpy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    } = findSpy.mock.calls[0]![0] as never;

    expect(Object.keys(findBy.query).sort()).toEqual(
      ["deviceToken", "userId"].sort(),
    );
    expect((findBy.query["userId"] as ObjectID).toString()).toBe(
      USER_ID.toString(),
    );
    expect(findBy.query["deviceToken"]).toBe(DEVICE_TOKEN);
    expect(findBy.select).toEqual({ _id: true, deviceType: true });
    expect(findBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(findBy.skip).toBe(0);
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("writes as root, because the columns grant update to nobody", async () => {
    await setPreferences({ volumePercent: 25 });

    expect(
      updateCalls.every((call: UpdateCall): boolean => {
        return call.isRoot === true;
      }),
    ).toBe(true);
  });

  test("writes each row by its own id", async () => {
    await setPreferences({ volumePercent: 25 });

    for (const call of updateSpy.mock.calls) {
      expect(
        Object.keys((call[0] as { query: Record<string, unknown> }).query),
      ).toEqual(["_id"]);
    }
  });

  test("refuses a token that matches no registered device, and writes nothing", async () => {
    findSpy.mockResolvedValue([] as never);

    await expect(
      setPreferences({ sound: CriticalAlertSound.Siren }),
    ).rejects.toThrow(
      new BadDataException(
        "No registered device was found for this device token.",
      ),
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("refuses a browser - no browser plays a critical alarm - and writes nothing", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.Web),
    ] as never);

    await expect(setPreferences({ volumePercent: 50 })).rejects.toThrow(
      "Critical alerts are only available on iOS and Android devices.",
    );
    await expect(setPreferences({ volumePercent: 50 })).rejects.toBeInstanceOf(
      BadDataException,
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("writes only the mobile rows when a token somehow spans device types", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.Web),
      device(DEVICE_TWO_ID, PushDeviceType.Android),
      device(DEVICE_THREE_ID, PushDeviceType.iOS),
    ] as never);

    const updated: number = await setPreferences({
      sound: CriticalAlertSound.Rising,
    });

    expect(updated).toBe(2);
    expect(
      updateCalls.map((call: UpdateCall): string => {
        return call.id;
      }),
    ).toEqual([DEVICE_TWO_ID, DEVICE_THREE_ID]);
  });

  test("reports how many rows were actually written", async () => {
    /*
     * updateOneBy answers 0 when the row vanished between the lookup and the
     * write; the count is what tells a caller "saved" from "matched nothing".
     */
    updateSpy
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(0 as never);

    expect(await setPreferences({ sound: CriticalAlertSound.Siren })).toBe(1);
  });

  test("never writes the critical alerts switch, the verification or anything else", async () => {
    /*
     * Choosing an alarm is not consent to be woken through Do Not Disturb,
     * and must not re-verify a device its owner unverified.
     */
    await setPreferences({
      sound: CriticalAlertSound.SmokeAlarm,
      volumePercent: 100,
    });

    for (const call of updateCalls) {
      expect(Object.keys(call.data).sort()).toEqual(
        ["criticalAlertSound", "criticalAlertVolume"].sort(),
      );
    }
  });

  test("each call writes what that call was given, never what an earlier one was", async () => {
    await setPreferences({ sound: CriticalAlertSound.Klaxon });
    await setPreferences({ volumePercent: 25 });

    expect(updateCalls[0]?.data).toEqual({
      criticalAlertSound: CriticalAlertSound.Klaxon,
    });
    expect(updateCalls[2]?.data).toEqual({ criticalAlertVolume: 25 });
  });
});

describe("the critical alerts switch shares the preferences' write", () => {
  let findSpy: SpyInstance<typeof UserPushService.findBy>;
  let updateSpy: SpyInstance<typeof UserPushService.updateOneBy>;

  beforeEach(() => {
    findSpy = jest
      .spyOn(UserPushService, "findBy")
      .mockResolvedValue([
        device(DEVICE_ONE_ID, PushDeviceType.Android),
      ] as never);

    updateSpy = jest
      .spyOn(UserPushService, "updateOneBy")
      .mockResolvedValue(1 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("turning critical alerts on or off leaves the chosen sound and volume alone", async () => {
    for (const isEnabled of [true, false]) {
      updateSpy.mockClear();

      await UserPushService.setCriticalAlertEnabledForDeviceToken({
        userId: USER_ID,
        deviceToken: DEVICE_TOKEN,
        isEnabled: isEnabled,
      });

      expect(
        (updateSpy.mock.calls[0]![0] as { data: Record<string, unknown> }).data,
      ).toEqual({ isCriticalAlertEnabled: isEnabled });
    }
  });

  test("both look the handset up the same way", async () => {
    await UserPushService.setCriticalAlertEnabledForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    await UserPushService.setCriticalAlertPreferencesForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      sound: CriticalAlertSound.Klaxon,
    });

    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(findSpy.mock.calls[1]![0]).toEqual(findSpy.mock.calls[0]![0]);
  });

  test.each([
    [
      "a token with no device",
      [],
      "No registered device was found for this device token.",
    ],
    [
      "a browser's token",
      [device(DEVICE_ONE_ID, PushDeviceType.Web)],
      "Critical alerts are only available on iOS and Android devices.",
    ],
  ])(
    "both refuse %s in the same words",
    async (_label: string, devices: Array<UserPush>, message: string) => {
      findSpy.mockResolvedValue(devices as never);

      await expect(
        UserPushService.setCriticalAlertEnabledForDeviceToken({
          userId: USER_ID,
          deviceToken: DEVICE_TOKEN,
          isEnabled: true,
        }),
      ).rejects.toThrow(message);
      await expect(
        UserPushService.setCriticalAlertPreferencesForDeviceToken({
          userId: USER_ID,
          deviceToken: DEVICE_TOKEN,
          volumePercent: 50,
        }),
      ).rejects.toThrow(message);

      expect(updateSpy).not.toHaveBeenCalled();
    },
  );
});

describe("UserPushService.renewExpoPushDevice carries the alarm and volume to the new token", () => {
  const OLD_TOKEN: string = "ExponentPushToken[renew-sound-old-00001]";
  const NEW_TOKEN: string = "ExponentPushToken[renew-sound-new-00002]";
  const RENEWED_ID: ObjectID = new ObjectID(
    "7f000000-0000-4000-8000-000000000703",
  );

  type Renewal = Parameters<typeof UserPushService.renewExpoPushDevice>[0];

  let find: SpyInstance<typeof UserPushService.findOneBy>;
  let update: SpyInstance<typeof UserPushService.updateOneBy>;

  beforeEach(() => {
    find = jest.spyOn(UserPushService, "findOneBy").mockResolvedValue({
      _id: RENEWED_ID.toString(),
      id: RENEWED_ID,
    } as never);

    update = jest.spyOn(UserPushService, "updateOneBy").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renewal(overrides: Partial<Renewal> = {}): Renewal {
    return {
      userId: USER_ID,
      projectId: PROJECT_ID,
      previousDeviceToken: OLD_TOKEN,
      deviceToken: NEW_TOKEN,
      deviceType: PushDeviceType.iOS,
      deviceName: "iPhone 16",
      isCriticalAlertEnabled: true,
      ...overrides,
    };
  }

  function writtenData(): Record<string, unknown> {
    expect(update).toHaveBeenCalledTimes(1);
    return (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
  }

  test("writes the sound and volume the phone registers with now", async () => {
    await UserPushService.renewExpoPushDevice(
      renewal({
        criticalAlertSound: CriticalAlertSound.SmokeAlarm,
        criticalAlertVolume: 50,
      }),
    );

    expect(writtenData()).toEqual({
      deviceToken: NEW_TOKEN,
      deviceType: PushDeviceType.iOS,
      deviceName: "iPhone 16",
      isVerified: true,
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.SmokeAlarm,
      criticalAlertVolume: 50,
    });
  });

  test("keeps the stored sound and volume when the phone does not say", async () => {
    /*
     * An app older than the choice registers without them. Writing the
     * defaults then would quietly reset the alarm a responder chose on the
     * phone this device used to be.
     */
    await UserPushService.renewExpoPushDevice(renewal());

    const data: Record<string, unknown> = writtenData();

    expect(data).not.toHaveProperty("criticalAlertSound");
    expect(data).not.toHaveProperty("criticalAlertVolume");
  });

  test("keeps them when the phone sends them as undefined", async () => {
    await UserPushService.renewExpoPushDevice(
      renewal({
        criticalAlertSound: undefined,
        criticalAlertVolume: undefined,
      }),
    );

    const data: Record<string, unknown> = writtenData();

    expect(data).not.toHaveProperty("criticalAlertSound");
    expect(data).not.toHaveProperty("criticalAlertVolume");
  });

  test("a sound alone is written alone, and the volume kept", async () => {
    await UserPushService.renewExpoPushDevice(
      renewal({ criticalAlertSound: CriticalAlertSound.Siren }),
    );

    const data: Record<string, unknown> = writtenData();

    expect(data["criticalAlertSound"]).toBe(CriticalAlertSound.Siren);
    expect(data).not.toHaveProperty("criticalAlertVolume");
  });

  test("a volume alone is written alone, and the sound kept", async () => {
    await UserPushService.renewExpoPushDevice(
      renewal({ criticalAlertVolume: 25 }),
    );

    const data: Record<string, unknown> = writtenData();

    expect(data["criticalAlertVolume"]).toBe(25);
    expect(data).not.toHaveProperty("criticalAlertSound");
  });

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [CriticalAlertSound] => {
        return [definition.sound];
      },
    ),
  )("%s is carried over as itself", async (sound: CriticalAlertSound) => {
    await UserPushService.renewExpoPushDevice(
      renewal({ criticalAlertSound: sound }),
    );

    expect(writtenData()["criticalAlertSound"]).toBe(sound);
  });

  test("still only takes over a device that no longer receives notifications", async () => {
    /*
     * Carrying the alarm does not widen what a renewal may take over: the
     * lookup is the same, and finding nothing writes nothing.
     */
    find.mockResolvedValue(null);

    expect(
      await UserPushService.renewExpoPushDevice(
        renewal({
          criticalAlertSound: CriticalAlertSound.Klaxon,
          criticalAlertVolume: 75,
        }),
      ),
    ).toBeNull();
    expect(
      (find.mock.calls[0]![0].query as Record<string, unknown>)["isVerified"],
    ).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  test("the same token, or none before it: nothing renewed, nothing written", async () => {
    expect(
      await UserPushService.renewExpoPushDevice(
        renewal({
          previousDeviceToken: NEW_TOKEN,
          criticalAlertSound: CriticalAlertSound.Klaxon,
        }),
      ),
    ).toBeNull();
    expect(find).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
