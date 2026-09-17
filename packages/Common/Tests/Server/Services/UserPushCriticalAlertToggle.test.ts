import UserPushService from "../../../Server/Services/UserPushService";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * setCriticalAlertEnabledForDeviceToken is how a phone tells the server "wake
 * me through Do Not Disturb". It is keyed on the push TOKEN rather than a row
 * id because one handset owns one UserPush row per project it is registered
 * against, and a responder who flips the switch means it for the phone, not
 * for whichever project they happened to be looking at.
 *
 * The failure this shape exists to prevent is a responder who is loud for one
 * project and silent for another - a distinction no screen offers to make, so
 * nobody would think to check it.
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);
const DEVICE_TOKEN: string = "ExponentPushToken[handset]";

const DEVICE_ONE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_TWO_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function device(id: string, deviceType: PushDeviceType): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = id;
  userPush.deviceType = deviceType;

  return userPush;
}

interface UpdateCall {
  id: string;
  isCriticalAlertEnabled: boolean | undefined;
  isRoot: boolean | undefined;
}

describe("UserPushService.setCriticalAlertEnabledForDeviceToken", () => {
  let findSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let updateCalls: Array<UpdateCall>;

  beforeEach(() => {
    updateCalls = [];

    findSpy = jest.spyOn(UserPushService, "findBy");

    updateSpy = jest.spyOn(UserPushService, "updateOneBy");
    updateSpy.mockImplementation((updateBy: unknown): Promise<number> => {
      const call: {
        query: { _id: string };
        data: { isCriticalAlertEnabled?: boolean };
        props: { isRoot?: boolean };
      } = updateBy as {
        query: { _id: string };
        data: { isCriticalAlertEnabled?: boolean };
        props: { isRoot?: boolean };
      };

      updateCalls.push({
        id: call.query._id,
        isCriticalAlertEnabled: call.data.isCriticalAlertEnabled,
        isRoot: call.props.isRoot,
      });

      return Promise.resolve(1);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("turns the override on for every project the handset is registered against", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.iOS),
      device(DEVICE_TWO_ID, PushDeviceType.iOS),
    ] as never);

    const updated: number =
      await UserPushService.setCriticalAlertEnabledForDeviceToken({
        userId: USER_ID,
        deviceToken: DEVICE_TOKEN,
        isEnabled: true,
      });

    expect(updated).toBe(2);
    expect(
      updateCalls.map((call: UpdateCall) => {
        return call.id;
      }),
    ).toEqual([DEVICE_ONE_ID, DEVICE_TWO_ID]);
    expect(
      updateCalls.every((call: UpdateCall) => {
        return call.isCriticalAlertEnabled === true;
      }),
    ).toBe(true);
  });

  test("turns the override off again", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.Android),
    ] as never);

    await UserPushService.setCriticalAlertEnabledForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      isEnabled: false,
    });

    expect(updateCalls[0]?.isCriticalAlertEnabled).toBe(false);
  });

  test("looks the handset up scoped to its owner, so a token cannot reconfigure somebody else's phone", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.iOS),
    ] as never);

    await UserPushService.setCriticalAlertEnabledForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });

    const query: { userId: ObjectID; deviceToken: string } = (
      findSpy.mock.calls[0]![0] as {
        query: { userId: ObjectID; deviceToken: string };
      }
    ).query;

    expect(query.userId.toString()).toBe(USER_ID.toString());
    expect(query.userId.toString()).not.toBe(OTHER_USER_ID.toString());
    expect(query.deviceToken).toBe(DEVICE_TOKEN);
  });

  test("writes as root, because the column grants update to nobody", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.iOS),
    ] as never);

    await UserPushService.setCriticalAlertEnabledForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });

    expect(updateCalls[0]?.isRoot).toBe(true);
  });

  test("refuses a token that matches no registered device", async () => {
    findSpy.mockResolvedValue([] as never);

    await expect(
      UserPushService.setCriticalAlertEnabledForDeviceToken({
        userId: USER_ID,
        deviceToken: DEVICE_TOKEN,
        isEnabled: true,
      }),
    ).rejects.toThrow(BadDataException);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("refuses a web device - a browser cannot override a phone's ringer", async () => {
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.Web),
    ] as never);

    await expect(
      UserPushService.setCriticalAlertEnabledForDeviceToken({
        userId: USER_ID,
        deviceToken: DEVICE_TOKEN,
        isEnabled: true,
      }),
    ).rejects.toThrow(
      "Critical alerts are only available on iOS and Android devices.",
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("updates only the mobile rows when a token somehow spans device types", async () => {
    /*
     * Not expected in practice - a web subscription blob and an Expo token do
     * not collide - but storing the preference on a web row would read back
     * later as though the browser would ring, which is worse than refusing it.
     */
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.Web),
      device(DEVICE_TWO_ID, PushDeviceType.Android),
    ] as never);

    const updated: number =
      await UserPushService.setCriticalAlertEnabledForDeviceToken({
        userId: USER_ID,
        deviceToken: DEVICE_TOKEN,
        isEnabled: true,
      });

    expect(updated).toBe(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.id).toBe(DEVICE_TWO_ID);
  });

  test("reports how many rows were actually written", async () => {
    /*
     * The count is what tells a caller "this matched nothing" apart from "this
     * saved". updateOneBy returns 0 when the row vanished between the lookup
     * and the write.
     */
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.iOS),
      device(DEVICE_TWO_ID, PushDeviceType.iOS),
    ] as never);

    updateSpy.mockResolvedValueOnce(1 as never);
    updateSpy.mockResolvedValueOnce(0 as never);

    const updated: number =
      await UserPushService.setCriticalAlertEnabledForDeviceToken({
        userId: USER_ID,
        deviceToken: DEVICE_TOKEN,
        isEnabled: true,
      });

    expect(updated).toBe(1);
  });

  test("only ever writes the critical alert column", async () => {
    /*
     * A toggle that also carried, say, isVerified would let the settings
     * screen re-verify a device the user had deliberately unverified.
     */
    findSpy.mockResolvedValue([
      device(DEVICE_ONE_ID, PushDeviceType.iOS),
    ] as never);

    await UserPushService.setCriticalAlertEnabledForDeviceToken({
      userId: USER_ID,
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });

    const data: Record<string, unknown> = (
      updateSpy.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(Object.keys(data)).toEqual(["isCriticalAlertEnabled"]);
  });
});
