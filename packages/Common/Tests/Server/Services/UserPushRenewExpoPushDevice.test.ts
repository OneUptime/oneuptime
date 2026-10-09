import UserPushService from "../../../Server/Services/UserPushService";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
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
 * UserPushService.renewExpoPushDevice: the mobile app got a new push token
 * on a phone where it kept its data (a phone set up from a backup of the
 * old one) and says which token it had before. The person's device in this
 * project registered with the old token carries the new one from now on,
 * verified, with its rules - nothing is created, and nothing deleted.
 *
 * The queries are pinned: only the caller's own device, in this project,
 * with exactly the old token, and only a phone or tablet - never a browser,
 * whose subscription has its own renewal (replaceWebPushSubscription).
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000601");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000602",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000603",
);

const OLD_TOKEN: string = "ExponentPushToken[renew-old-token-00001]";
const NEW_TOKEN: string = "ExponentPushToken[renew-new-token-00002]";

type Renewal = Parameters<typeof UserPushService.renewExpoPushDevice>[0];

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

describe("UserPushService.renewExpoPushDevice", () => {
  let find: SpyInstance<typeof UserPushService.findOneBy>;
  let update: SpyInstance<typeof UserPushService.updateOneBy>;
  let created: SpyInstance<typeof UserPushService.create>;
  let deleted: SpyInstance<typeof UserPushService.deleteBy>;

  beforeEach(() => {
    find = jest.spyOn(UserPushService, "findOneBy").mockResolvedValue({
      _id: DEVICE_ID.toString(),
      id: DEVICE_ID,
    } as never);

    update = jest.spyOn(UserPushService, "updateOneBy").mockResolvedValue(1);

    created = jest.spyOn(UserPushService, "create");
    deleted = jest.spyOn(UserPushService, "deleteBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("finds the person's own phone in this project with the old token, as root", async () => {
    await UserPushService.renewExpoPushDevice(renewal());

    expect(find).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = find.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(Object.keys(query).sort()).toEqual(
      ["deviceToken", "deviceType", "projectId", "userId"].sort(),
    );
    expect(query["userId"]).toBe(USER_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["deviceToken"]).toBe(OLD_TOKEN);
    // Only a phone or tablet: a browser's subscription is never an Expo token.
    expect(query["deviceType"]).toBeInstanceOf(Includes);
    expect((query["deviceType"] as Includes).values).toEqual([
      PushDeviceType.iOS,
      PushDeviceType.Android,
    ]);
    expect(find.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("gives it the new token, verified, with the name, type and critical-alerts setting the phone has now - and keeps it", async () => {
    const renewed: unknown = await UserPushService.renewExpoPushDevice(
      renewal({
        deviceType: PushDeviceType.Android,
        deviceName: "Pixel 9",
        isCriticalAlertEnabled: false,
      }),
    );

    expect((renewed as { id: ObjectID }).id).toBe(DEVICE_ID);
    expect(update).toHaveBeenCalledTimes(1);

    const call: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    } = update.mock.calls[0]![0] as never;

    /*
     * Still the old token: another registration renewing it a moment
     * earlier leaves this one nothing to do.
     */
    expect(call.query).toEqual({
      _id: DEVICE_ID.toString(),
      userId: USER_ID,
      deviceToken: OLD_TOKEN,
    });
    expect(call.data).toEqual({
      deviceToken: NEW_TOKEN,
      deviceType: PushDeviceType.Android,
      deviceName: "Pixel 9",
      isVerified: true,
      isCriticalAlertEnabled: false,
    });
    // UserPush grants update to nobody: every write to it runs as root.
    expect(call.props).toEqual({ isRoot: true });

    // Renewed in place: its rules stay with it, nothing is made or removed.
    expect(created).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  });

  test("a device that was marked as not receiving notifications is verified again by it", async () => {
    await UserPushService.renewExpoPushDevice(renewal());

    expect(
      (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data[
        "isVerified"
      ],
    ).toBe(true);
  });

  test("no device with the old token here: nothing to renew", async () => {
    find.mockResolvedValue(null);

    expect(await UserPushService.renewExpoPushDevice(renewal())).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  test("renewed a moment ago by another registration: nothing renewed now", async () => {
    update.mockResolvedValue(0);

    expect(await UserPushService.renewExpoPushDevice(renewal())).toBeNull();
  });

  test.each([
    ["the same token", NEW_TOKEN],
    ["no old token", ""],
  ])(
    "%s: nothing to renew, and nothing read",
    async (_name: string, previousDeviceToken: string) => {
      expect(
        await UserPushService.renewExpoPushDevice(
          renewal({ previousDeviceToken: previousDeviceToken }),
        ),
      ).toBeNull();
      expect(find).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );
});
