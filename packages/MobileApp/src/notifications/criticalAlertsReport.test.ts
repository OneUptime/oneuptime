import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CriticalAlertsChoiceOutcome,
  CriticalAlertsReportOutcome,
  NO_REGISTERED_DEVICE_MESSAGE,
  inCriticalAlertsOrder,
  isCriticalAlertsEffective,
  isNoRegisteredDeviceError,
  readCriticalAlerts,
  reportCriticalAlerts,
  saveCriticalAlertsChoice,
} from "./criticalAlertsReport";
import { CriticalAlertAvailability } from "./criticalAlerts";
import { NotificationChannelId } from "./channels";
import * as pushDeviceApi from "../api/pushDevice";
import {
  getCriticalAlertsEnabled,
  getCriticalAlertsReport,
  setCriticalAlertsReport,
} from "../storage/preferences";
import { PUSH_TOKEN_KEY } from "../hooks/pushTokenUtils";
import { FakeAndroidNotificationChannels } from "../__tests__/fakeAndroidNotificationChannels";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("../api/pushDevice", () => {
  return {
    registerPushDevice: jest.fn(),
    unregisterPushDevice: jest.fn(),
    setCriticalAlertsEnabledOnServer: jest.fn(async () => {
      return undefined;
    }),
  };
});

/*
 * What the server is told about this phone's critical alerts.
 *
 * The maintainer turned critical alerts off and the app showed them off,
 * while the Dashboard went on saying "On" and its test notification claimed
 * to ring through silent mode - the phone showed an ordinary notification.
 * The server was only ever told the switch, and only when it moved; not
 * that the phone's system had stopped allowing critical alerts.
 *
 * These tests hold the rule that fixes it: the server is told what the phone
 * will really do (the responder's switch AND the OS), whenever that changes,
 * once - and the switch and the server never end up disagreeing.
 */

const DEVICE_TOKEN: string = "ExponentPushToken[handset]";
const OTHER_TOKEN: string = "ExponentPushToken[another-handset]";

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function serverSpy(): jest.SpyInstance {
  return pushDeviceApi.setCriticalAlertsEnabledOnServer as unknown as jest.SpyInstance;
}

// What the server was told this phone does with a critical page, in order.
function toldServer(): Array<{ deviceToken: string; isEnabled: boolean }> {
  return serverSpy().mock.calls.map((call: Array<unknown>) => {
    return call[0] as { deviceToken: string; isEnabled: boolean };
  });
}

// iOS, reporting whether critical alerts are allowed for the app.
function iosAllows(allowsCriticalAlerts: boolean | null): jest.SpyInstance {
  return jest.spyOn(Notifications, "getPermissionsAsync").mockResolvedValue({
    status: "granted",
    ios: { allowsCriticalAlerts },
  } as never);
}

// The server's answer for a token it has no device for (UserPushService).
function noRegisteredDevice(): unknown {
  return {
    response: {
      status: 400,
      data: { message: NO_REGISTERED_DEVICE_MESSAGE },
    },
  };
}

async function choose(isChosen: boolean): Promise<void> {
  await AsyncStorage.setItem(
    "oneuptime_critical_alerts_enabled",
    String(isChosen),
  );
}

beforeEach(async () => {
  setPlatform("ios");
  (Device as unknown as { isDevice: boolean }).isDevice = true;
  await AsyncStorage.clear();
  serverSpy().mockReset();
  serverSpy().mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isCriticalAlertsEffective - what the phone will do with a critical page", () => {
  test.each([
    [true, CriticalAlertAvailability.Granted, true],
    [true, CriticalAlertAvailability.Denied, false],
    [true, CriticalAlertAvailability.Unsupported, false],
    [false, CriticalAlertAvailability.Granted, false],
    [false, CriticalAlertAvailability.Denied, false],
    [false, CriticalAlertAvailability.Unsupported, false],
  ])(
    "switch %s, OS %s: rings through = %s",
    (
      isChosen: boolean,
      availability: CriticalAlertAvailability,
      expected: boolean,
    ) => {
      expect(
        isCriticalAlertsEffective({
          isChosen: isChosen,
          availability: availability,
        }),
      ).toBe(expected);
    },
  );
});

describe("readCriticalAlerts", () => {
  test("on iOS: the switch on and iOS allowing it rings through", async () => {
    await choose(true);
    iosAllows(true);

    expect(await readCriticalAlerts()).toMatchObject({
      isChosen: true,
      isEffective: true,
      status: { availability: CriticalAlertAvailability.Granted },
    });
  });

  test("on iOS: critical alerts turned off in iOS Settings - the switch is still on, but nothing rings through", async () => {
    await choose(true);
    iosAllows(false);

    expect(await readCriticalAlerts()).toMatchObject({
      isChosen: true,
      isEffective: false,
      status: { availability: CriticalAlertAvailability.Denied },
    });
  });

  test("on iOS: the switch off rings nothing through, whatever iOS allows", async () => {
    await choose(false);
    iosAllows(true);

    expect((await readCriticalAlerts()).isEffective).toBe(false);
  });

  test("a phone that never chose has them off", async () => {
    iosAllows(true);

    expect(await readCriticalAlerts()).toMatchObject({
      isChosen: false,
      isEffective: false,
    });
  });

  test("on Android: the chosen alarm's channel decides, not the system sound's", async () => {
    setPlatform("android");
    const android: FakeAndroidNotificationChannels =
      new FakeAndroidNotificationChannels();
    android.install();
    android.grantDoNotDisturbAccess();

    await choose(true);
    await AsyncStorage.setItem("oneuptime_critical_alert_sound", "klaxon");

    expect((await readCriticalAlerts()).isEffective).toBe(true);

    // The responder lets the klaxon's channel stop overriding Do Not Disturb.
    android.userChangesChannel("oncall_critical_klaxon", { bypassDnd: false });

    const reading: Awaited<ReturnType<typeof readCriticalAlerts>> =
      await readCriticalAlerts();

    expect(android.stored(NotificationChannelId.CRITICAL)?.bypassDnd).toBe(
      true,
    );
    expect(reading.isChosen).toBe(true);
    expect(reading.isEffective).toBe(false);
  });

  test("on Android: Do Not Disturb access taken away turns it off", async () => {
    setPlatform("android");
    const android: FakeAndroidNotificationChannels =
      new FakeAndroidNotificationChannels();
    android.install();

    await choose(true);

    expect((await readCriticalAlerts()).isEffective).toBe(false);
  });

  test("says the OS answered when it did", async () => {
    await choose(true);
    iosAllows(false);

    expect((await readCriticalAlerts()).isCertain).toBe(true);
  });

  test("says the OS did not answer when it could not be asked", async () => {
    await choose(true);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockRejectedValue(new Error("native module unavailable") as never);

    expect(await readCriticalAlerts()).toMatchObject({
      isChosen: true,
      isEffective: false,
      isCertain: false,
    });
  });

  test("on a simulator nothing rings through", async () => {
    (Device as unknown as { isDevice: boolean }).isDevice = false;
    await choose(true);
    iosAllows(true);

    expect((await readCriticalAlerts()).isEffective).toBe(false);
  });
});

describe("reportCriticalAlerts - telling the server when what the phone does changes", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  });

  test("tells the server what the phone does, and notes that it did", async () => {
    await choose(true);
    iosAllows(true);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
    ]);
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("the maintainer's phone: critical alerts turned off in iOS Settings - the server is told they are off", async () => {
    await choose(true);
    iosAllows(true);
    await reportCriticalAlerts();

    // Turned off in iOS Settings; the app comes back.
    iosAllows(false);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
      { deviceToken: DEVICE_TOKEN, isEnabled: false },
    ]);
    // The responder's own switch is left as they set it.
    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("allowed again in iOS Settings - the server is told they are on again", async () => {
    await choose(true);
    iosAllows(false);
    await reportCriticalAlerts();

    iosAllows(true);
    await reportCriticalAlerts();

    expect(
      toldServer().map((told: { isEnabled: boolean }): boolean => {
        return told.isEnabled;
      }),
    ).toEqual([false, true]);
  });

  test("nothing changed: nothing is sent - opening the app does not cost a request", async () => {
    await choose(true);
    iosAllows(true);
    await reportCriticalAlerts();

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.AlreadyReported,
    );
    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.AlreadyReported,
    );
    expect(serverSpy()).toHaveBeenCalledTimes(1);
  });

  test("the first report on an install is always sent, off included", async () => {
    iosAllows(false);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: false },
    ]);
  });

  test("a new push token is told, though the token before it was told the same", async () => {
    await setCriticalAlertsReport({
      deviceToken: OTHER_TOKEN,
      isEnabled: false,
    });
    iosAllows(false);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: false },
    ]);
  });

  test("force tells the server even when it was told the same", async () => {
    await choose(true);
    iosAllows(true);
    await reportCriticalAlerts();

    expect(await reportCriticalAlerts({ force: true })).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(serverSpy()).toHaveBeenCalledTimes(2);
  });

  test("a registration whose every device holds what the phone does: noted, nothing sent", async () => {
    await choose(true);
    iosAllows(true);

    expect(await reportCriticalAlerts({ serverHolds: true })).toBe(
      CriticalAlertsReportOutcome.AlreadyReported,
    );
    expect(serverSpy()).not.toHaveBeenCalled();
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("a registration holding what the phone no longer does - the switch moved meanwhile - is corrected", async () => {
    await choose(true);
    iosAllows(true);

    expect(await reportCriticalAlerts({ serverHolds: false })).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
    ]);
  });

  test("what the server holds wins over an old note of what it was told", async () => {
    await setCriticalAlertsReport({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    await choose(true);
    iosAllows(true);

    // The server says it holds off, whatever the note says: it is told.
    await reportCriticalAlerts({ serverHolds: false });

    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
    ]);
  });

  test("no push token yet: nothing is sent, and the registration that gets one tells the server", async () => {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    iosAllows(true);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.NoPushToken,
    );
    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("the server has no device for this token: no error, and the note is forgotten so the next chance tells it", async () => {
    await setCriticalAlertsReport({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    iosAllows(false);
    serverSpy().mockRejectedValueOnce(noRegisteredDevice() as never);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.NotRegistered,
    );
    expect(await getCriticalAlertsReport()).toBeNull();
  });

  test("offline: the report fails quietly, keeps the old note, and the next chance tells the server", async () => {
    await choose(true);
    iosAllows(true);
    await reportCriticalAlerts();

    iosAllows(false);
    serverSpy().mockRejectedValueOnce(new Error("Network Error") as never);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Failed,
    );
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });

    // Back online.
    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Reported,
    );
    expect(toldServer().pop()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: false,
    });
  });

  test("never throws, even when storage cannot be read", async () => {
    /*
     * Once, on the shared stand-in itself: a spy on it would replace the
     * stand-in for every test after this one.
     */
    (AsyncStorage.getItem as unknown as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(reportCriticalAlerts()).resolves.toBe(
      CriticalAlertsReportOutcome.Failed,
    );
    expect(serverSpy()).not.toHaveBeenCalled();
  });

  /*
   * The reviewer's 3am case: the OS could not be asked once, and the cautious
   * "denied" the screen shows would have turned every page ordinary until
   * the app was next opened. Nothing is said on a read that failed.
   */
  test("an OS read that failed is never told: the server keeps what it holds", async () => {
    await choose(true);
    iosAllows(true);
    await reportCriticalAlerts();

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockRejectedValue(new Error("native module unavailable") as never);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Uncertain,
    );
    expect(await reportCriticalAlerts({ force: true })).toBe(
      CriticalAlertsReportOutcome.Uncertain,
    );
    expect(await reportCriticalAlerts({ serverHolds: true })).toBe(
      CriticalAlertsReportOutcome.Uncertain,
    );

    // Only the first report, before the failure, reached the server.
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
    ]);
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("on Android, channels that could be neither written nor read are never told as off", async () => {
    setPlatform("android");
    await choose(true);
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.Uncertain,
    );
    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("the web build has no critical alerts: nothing is read or sent", async () => {
    setPlatform("web");
    const permissions: jest.SpyInstance = iosAllows(true);

    expect(await reportCriticalAlerts()).toBe(
      CriticalAlertsReportOutcome.NotApplicable,
    );
    expect(permissions).not.toHaveBeenCalled();
    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("on Android, Do Not Disturb access taken away is told as off", async () => {
    setPlatform("android");
    const android: FakeAndroidNotificationChannels =
      new FakeAndroidNotificationChannels();
    android.install();
    android.grantDoNotDisturbAccess();
    await choose(true);

    await reportCriticalAlerts();

    android.userChangesChannel(NotificationChannelId.CRITICAL, {
      bypassDnd: false,
    });
    await reportCriticalAlerts();

    expect(
      toldServer().map((told: { isEnabled: boolean }): boolean => {
        return told.isEnabled;
      }),
    ).toEqual([true, false]);
  });
});

describe("one change to the server at a time", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  });

  test("reports asked for at once - the app and the Settings screen both coming back - send once", async () => {
    await choose(true);
    iosAllows(true);

    const outcomes: Array<CriticalAlertsReportOutcome> = await Promise.all([
      reportCriticalAlerts(),
      reportCriticalAlerts(),
      reportCriticalAlerts(),
    ]);

    expect(outcomes).toEqual([
      CriticalAlertsReportOutcome.Reported,
      CriticalAlertsReportOutcome.AlreadyReported,
      CriticalAlertsReportOutcome.AlreadyReported,
    ]);
    expect(serverSpy()).toHaveBeenCalledTimes(1);
  });

  test("a report waiting behind the switch reads the phone after it, so the server never ends on the state from before", async () => {
    iosAllows(true);

    // The server is slow to answer the switch.
    let answerTheSwitch: () => void = (): void => {};
    serverSpy().mockImplementationOnce(() => {
      return new Promise<void>((resolve: () => void) => {
        answerTheSwitch = resolve;
      });
    });

    const saving: Promise<CriticalAlertsChoiceOutcome> =
      saveCriticalAlertsChoice(true);

    // Meanwhile the app comes back to the foreground and reports.
    const reporting: Promise<CriticalAlertsReportOutcome> =
      reportCriticalAlerts();

    // Let both reach as far as they can.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });

    answerTheSwitch();

    expect(await saving).toBe(CriticalAlertsChoiceOutcome.Saved);
    expect(await reporting).toBe(CriticalAlertsReportOutcome.AlreadyReported);

    // On, and only on: not "on" then the stale "off" from before the switch.
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
    ]);
  });

  test("a failed task does not stop the ones after it", async () => {
    const failed: Promise<never> = inCriticalAlertsOrder(
      async (): Promise<never> => {
        throw new Error("boom");
      },
    );

    await expect(failed).rejects.toThrow("boom");

    await expect(
      inCriticalAlertsOrder(async (): Promise<string> => {
        return "still runs";
      }),
    ).resolves.toBe("still runs");
  });

  test("tasks run in the order they were asked for", async () => {
    const order: Array<number> = [];

    await Promise.all(
      [3, 1, 2].map((delay: number, index: number): Promise<void> => {
        return inCriticalAlertsOrder(async (): Promise<void> => {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, delay * 5);
          });
          order.push(index);
        });
      }),
    );

    expect(order).toEqual([0, 1, 2]);
  });
});

describe("saveCriticalAlertsChoice - the responder moved the switch", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  });

  test("on: the server is told first, then the phone keeps it, and notes the server has it", async () => {
    const setItem: jest.Mock = AsyncStorage.setItem as unknown as jest.Mock;
    setItem.mockClear();

    expect(await saveCriticalAlertsChoice(true)).toBe(
      CriticalAlertsChoiceOutcome.Saved,
    );

    // Each write's turn among every mocked call, by the key it wrote.
    const turnOf: (key: string) => number = (key: string): number => {
      const index: number = setItem.mock.calls.findIndex(
        (call: Array<unknown>): boolean => {
          return call[0] === key;
        },
      );

      expect(index).toBeGreaterThan(-1);

      return setItem.mock.invocationCallOrder[index]!;
    };

    const server: number = serverSpy().mock.invocationCallOrder[0]!;

    expect(server).toBeLessThan(turnOf("oneuptime_critical_alerts_enabled"));
    expect(turnOf("oneuptime_critical_alerts_enabled")).toBeLessThan(
      turnOf("oneuptime_critical_alerts_reported"),
    );
  });

  test("on, saved: the switch, the note and the server all say on", async () => {
    await saveCriticalAlertsChoice(true);

    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: true },
    ]);
    expect(await getCriticalAlertsEnabled()).toBe(true);
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("off, saved: the switch, the note and the server all say off", async () => {
    await choose(true);

    expect(await saveCriticalAlertsChoice(false)).toBe(
      CriticalAlertsChoiceOutcome.Saved,
    );
    expect(toldServer()).toEqual([
      { deviceToken: DEVICE_TOKEN, isEnabled: false },
    ]);
    expect(await getCriticalAlertsEnabled()).toBe(false);
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: false,
    });
  });

  test("a failed request throws, and the phone keeps what is still in force", async () => {
    await choose(true);
    await setCriticalAlertsReport({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    serverSpy().mockRejectedValueOnce(new Error("Network Error") as never);

    await expect(saveCriticalAlertsChoice(false)).rejects.toThrow(
      "Network Error",
    );
    expect(await getCriticalAlertsEnabled()).toBe(true);
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("off with no push token yet: kept on the phone, nothing sent - nothing on the server disagrees", async () => {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    await choose(true);

    expect(await saveCriticalAlertsChoice(false)).toBe(
      CriticalAlertsChoiceOutcome.SavedOnThisPhone,
    );
    expect(serverSpy()).not.toHaveBeenCalled();
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("on with no push token yet: not kept - a switch backed by no device", async () => {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);

    expect(await saveCriticalAlertsChoice(true)).toBe(
      CriticalAlertsChoiceOutcome.NotRegistered,
    );
    expect(serverSpy()).not.toHaveBeenCalled();
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("off when the server has no device for this phone: kept on the phone, and the old note forgotten", async () => {
    await choose(true);
    await setCriticalAlertsReport({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    serverSpy().mockRejectedValueOnce(noRegisteredDevice() as never);

    expect(await saveCriticalAlertsChoice(false)).toBe(
      CriticalAlertsChoiceOutcome.SavedOnThisPhone,
    );
    expect(await getCriticalAlertsEnabled()).toBe(false);
    expect(await getCriticalAlertsReport()).toBeNull();
  });

  test("on when the server has no device for this phone: not kept", async () => {
    serverSpy().mockRejectedValueOnce(noRegisteredDevice() as never);

    expect(await saveCriticalAlertsChoice(true)).toBe(
      CriticalAlertsChoiceOutcome.NotRegistered,
    );
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });
});

describe("isNoRegisteredDeviceError", () => {
  test("the server's answer for a token it has no device for", () => {
    expect(isNoRegisteredDeviceError(noRegisteredDevice())).toBe(true);
  });

  test.each([
    [
      "another refusal",
      {
        response: {
          status: 400,
          data: { message: "isEnabled must be either true or false." },
        },
      },
    ],
    [
      "the same words with another status",
      {
        response: {
          status: 500,
          data: { message: NO_REGISTERED_DEVICE_MESSAGE },
        },
      },
    ],
    ["a network error", new Error("Network Error")],
    ["an answer with no body", { response: { status: 400 } }],
    ["nothing", null],
    ["undefined", undefined],
  ])("not %s", (_name: string, error: unknown) => {
    expect(isNoRegisteredDeviceError(error)).toBe(false);
  });
});
