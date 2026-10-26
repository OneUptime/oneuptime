import { AppState, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import {
  useCriticalAlerts,
  type CriticalAlertsState,
} from "./useCriticalAlerts";
import * as pushDeviceApi from "../api/pushDevice";
import { getCriticalAlertsEnabled } from "../storage/preferences";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
import { setupNotificationChannels } from "../notifications/setup";
import { NotificationChannelId } from "../notifications/channels";
import { FakeAndroidNotificationChannels } from "../__tests__/fakeAndroidNotificationChannels";
import {
  CriticalAlertSettingsPlace,
  IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS,
} from "../notifications/criticalAlerts";
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
 * The hook is where the three parties to a critical alert are reconciled: the
 * OS capability, the responder's stored choice, and the server that actually
 * stamps the flag onto pages. Each test below is a way those three can
 * disagree, and every one of them has the same worst case - a responder
 * looking at a switch that says "on" while nothing will wake them.
 *
 * The rule the hook enforces, and the reason it re-reads instead of
 * remembering: nothing is shown as ON unless the OS grants it AND the server
 * accepted it.
 */

const DEVICE_TOKEN: string = "ExponentPushToken[handset]";

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function setIsDevice(isDevice: boolean): void {
  (Device as unknown as { isDevice: boolean }).isDevice = isDevice;
}

function grantIos(): void {
  jest
    .spyOn(Notifications, "getPermissionsAsync")
    .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);
  jest
    .spyOn(Notifications, "requestPermissionsAsync")
    .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);
}

function denyIos(): void {
  jest
    .spyOn(Notifications, "getPermissionsAsync")
    .mockResolvedValue({ ios: { allowsCriticalAlerts: false } } as never);
  jest
    .spyOn(Notifications, "requestPermissionsAsync")
    .mockResolvedValue({ ios: { allowsCriticalAlerts: false } } as never);
}

/*
 * What expo-notifications reports on iOS. allowsCriticalAlerts is null when
 * iOS reports critical alerts as not supported: a build without Apple's
 * entitlement, or an entitled build that has not asked yet.
 */
function iosPermissions(
  status: "granted" | "denied",
  allowsCriticalAlerts: boolean | null,
): never {
  return { status: status, ios: { allowsCriticalAlerts } } as never;
}

/*
 * iOS across a request: it reports `beforeRequest` until the app asks for the
 * permission and `afterRequest` from then on, the way a prompt that has just
 * been answered changes what the OS reports.
 */
function simulateIos(
  beforeRequest: never,
  afterRequest: never,
): { getSpy: jest.SpyInstance; requestSpy: jest.SpyInstance } {
  let current: never = beforeRequest;

  const getSpy: jest.SpyInstance = jest
    .spyOn(Notifications, "getPermissionsAsync")
    .mockImplementation(async () => {
      return current;
    });

  const requestSpy: jest.SpyInstance = jest
    .spyOn(Notifications, "requestPermissionsAsync")
    .mockImplementation(async () => {
      current = afterRequest;
      return afterRequest;
    });

  return { getSpy, requestSpy };
}

function serverSpy(): jest.SpyInstance {
  return pushDeviceApi.setCriticalAlertsEnabledOnServer as unknown as jest.SpyInstance;
}

/*
 * What the server was told this phone does with a critical page, in order.
 * The hook tells it on its own whenever that changes - "off" while the OS
 * does not allow critical alerts - so a test of a phone that cannot ring
 * through expects the server to hear "off", and never "on".
 */
function toldServer(): Array<boolean> {
  return serverSpy().mock.calls.map((call: Array<unknown>): boolean => {
    return (call[0] as { isEnabled: boolean }).isEnabled;
  });
}

/*
 * renderHook is asynchronous in @testing-library/react-native v14, and the
 * hook's first useEffect kicks off an async status read - so every test waits
 * for that first pass to land before asserting, rather than racing it.
 */
async function renderCriticalAlerts(): Promise<{
  result: { current: CriticalAlertsState };
}> {
  const rendered: { result: { current: CriticalAlertsState } } =
    (await renderHook(() => {
      return useCriticalAlerts();
    })) as unknown as { result: { current: CriticalAlertsState } };

  await waitFor(() => {
    expect(rendered.result.current.statusMessage.length).toBeGreaterThan(0);
  });

  return rendered;
}

describe("useCriticalAlerts on a granted iOS device", () => {
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
    grantIos();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("offers the setting", async () => {
    const { result } = await renderCriticalAlerts();

    expect(result.current.isSupported).toBe(true);
    expect(result.current.isPermissionGranted).toBe(true);
  });

  test("starts off for a device that never opted in", async () => {
    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);
  });

  test("turning it on tells the server", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("turning it on stores the choice for re-registration", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("the switch reads as on afterwards", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(true);
    expect(result.current.error).toBe("");
  });

  test("turning it off again tells the server and clears the stored choice", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });
    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(serverSpy()).toHaveBeenLastCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: false,
    });
    expect(await getCriticalAlertsEnabled()).toBe(false);
    expect(result.current.isEnabled).toBe(false);
  });
});

describe("useCriticalAlerts when the server refuses", () => {
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    grantIos();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the switch does not stay on", async () => {
    /*
     * The whole point of this feature is a phone that rings. A toggle that
     * looks saved but never reached the server is a responder who believes
     * they are covered and is not.
     */
    serverSpy().mockRejectedValue(new Error("network unreachable") as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
  });

  test("the responder is told the setting was not saved", async () => {
    serverSpy().mockRejectedValue(new Error("network unreachable") as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.error.length).toBeGreaterThan(0);
  });

  test("nothing is stored locally, so re-registration does not replay a failed opt-in", async () => {
    serverSpy().mockRejectedValue(new Error("network unreachable") as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(await getCriticalAlertsEnabled()).toBe(false);
  });
});

describe("useCriticalAlerts when the OS has not granted the capability", () => {
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
    denyIos();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the switch refuses to turn on", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
  });

  test("the server is never told the device can do something it cannot", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    // Told what the phone does: off, never on.
    await waitFor(() => {
      expect(toldServer()).toEqual([false]);
    });
  });

  test("the responder is told exactly which OS setting to change", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.error).toContain("Critical Alerts");
  });

  test("it asks the OS before giving up", async () => {
    const requestSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "requestPermissionsAsync",
    );

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(requestSpy).toHaveBeenCalled();
  });
});

describe("useCriticalAlerts on an iOS build without Apple's entitlement", () => {
  /*
   * Every App Store build up to 1.4.0. iOS ignores the request without a
   * prompt or an error, and Settings never gets a Critical Alerts switch for
   * the app - so the old instruction to turn that switch on was one a
   * responder could not follow, however many times they tried.
   */
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
    simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", null),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the setting is still offered, so the explanation has somewhere to appear", async () => {
    const { result } = await renderCriticalAlerts();

    expect(result.current.isSupported).toBe(true);
    expect(result.current.isPermissionGranted).toBe(false);
  });

  test("turning it on asks iOS before giving up", async () => {
    const requestSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "requestPermissionsAsync",
    );

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(requestSpy).toHaveBeenCalledWith({
      ios: expect.objectContaining({ allowCriticalAlerts: true }),
    });
  });

  test("the switch does not turn on and the server is never told it did", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
    await waitFor(() => {
      expect(toldServer()).toEqual([false]);
    });
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("the responder is told to update the app, not to find a switch iOS is not showing", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.error).toContain("Update OneUptime On-Call");
    expect(result.current.error).toContain("no Critical Alerts switch");
    expect(result.current.error).not.toContain("Allow Critical Alerts");
  });
});

describe("useCriticalAlerts after updating to a build with Apple's entitlement", () => {
  /*
   * The responder who reported the missing switch, once on 1.5.0: iOS has
   * never shown them the critical alert prompt, so until the app asks, the
   * setting reads exactly as it did on the old build.
   */
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepting the prompt turns the setting on and tells the server", async () => {
    simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", true),
    );

    const { result } = await renderCriticalAlerts();

    expect(result.current.isPermissionGranted).toBe(false);

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    expect(result.current.isEnabled).toBe(true);
    expect(result.current.isPermissionGranted).toBe(true);
    expect(result.current.error).toBe("");
    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("declining the prompt points at the switch iOS has now added", async () => {
    simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", false),
    );

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
    expect(toldServer()).not.toContain(true);
    expect(result.current.error).toContain(
      "Allow Critical Alerts for OneUptime On-Call in iOS Settings",
    );
  });

  test("allowing it in iOS Settings afterwards clears the instruction, and the switch then turns on", async () => {
    const { getSpy } = simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", false),
    );

    const addListenerSpy: jest.SpyInstance = jest.spyOn(
      AppState,
      "addEventListener",
    );

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.error).toContain("Allow Critical Alerts");

    // The responder flips Critical Alerts on in iOS Settings and comes back.
    getSpy.mockResolvedValue(iosPermissions("granted", true));

    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    await act(async () => {
      handler("active");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("");
      expect(result.current.isPermissionGranted).toBe(true);
    });

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    expect(result.current.isEnabled).toBe(true);
  });
});

describe("useCriticalAlerts on iOS with notifications turned off", () => {
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
    simulateIos(iosPermissions("denied", null), iosPermissions("denied", null));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the responder is told to turn notifications back on first", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
    expect(toldServer()).not.toContain(true);
    expect(result.current.error).toContain("Allow Notifications");
  });
});

describe("useCriticalAlerts when the permission is revoked later", () => {
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a stored opt-in does NOT show as on once iOS stops allowing it", async () => {
    /*
     * The responder turned this on months ago, then revoked the permission in
     * iOS Settings. The stored preference still says true. Showing the switch
     * as on here is the single most dangerous reading in the feature: it tells
     * somebody their phone will wake them when the OS will no longer let it.
     */
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    denyIos();

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isPermissionGranted).toBe(false);
  });

  test("a stored opt-in shows as on while the OS still allows it", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    grantIos();

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
  });
});

/*
 * The switch reads off while iOS Settings turns critical alerts off, and it
 * used to say nothing about why (the maintainer's screenshot): the responder
 * saw their own choice undone with no reason. It says why now, what pages
 * do meanwhile and where to turn them back on - only for a choice the
 * phone's settings undid, never for a switch turned off by choice.
 */
describe("useCriticalAlerts says why the phone's settings turned it off", () => {
  let addListenerSpy: jest.SpyInstance;

  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
    addListenerSpy = jest.spyOn(AppState, "addEventListener");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("chosen, then switched off in iOS Settings: the switch reads off, and says why", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    denyIos();

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.offInPhoneSettings).toEqual({
      message: IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS,
      place: CriticalAlertSettingsPlace.IosAppSettings,
    });
    // Nothing was asked of the responder: an explanation, not an error.
    expect(result.current.error).toBe("");
  });

  test("never chosen: off is the responder's own choice, with nothing to explain", async () => {
    denyIos();

    const { result } = await renderCriticalAlerts();

    expect(result.current.offInPhoneSettings).toBeNull();
  });

  test("chosen and allowed: nothing to explain", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    grantIos();

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    expect(result.current.offInPhoneSettings).toBeNull();
  });

  test("an OS read that failed explains nothing: the phone said nothing", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockRejectedValue(new Error("unavailable") as never);

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.offInPhoneSettings).toBeNull();
  });

  test("its button opens this app's page in iOS Settings", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    denyIos();
    const openSettings: jest.SpyInstance = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.openPhoneSettings();
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  test("turned back on in iOS Settings: coming back to the app clears it, and the switch reads on", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    denyIos();

    const { result } = await renderCriticalAlerts();

    expect(result.current.offInPhoneSettings).not.toBeNull();

    grantIos();
    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    await act(async () => {
      handler("active");
    });

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    expect(result.current.offInPhoneSettings).toBeNull();
  });

  test("turning the switch off by hand clears it: off is now the responder's choice", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    denyIos();

    const { result } = await renderCriticalAlerts();

    expect(result.current.offInPhoneSettings).not.toBeNull();

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.offInPhoneSettings).toBeNull();
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });
});

describe("useCriticalAlerts on Android", () => {
  beforeEach(async () => {
    setPlatform("android");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is granted once the channel really bypasses Do Not Disturb", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    const { result } = await renderCriticalAlerts();

    expect(result.current.isPermissionGranted).toBe(true);
  });

  test("turning it on after the grant reaches the server", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("without Do Not Disturb access the responder is pointed at the right screen", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.error).toContain("Do Not Disturb access");
    expect(result.current.isEnabled).toBe(false);
  });

  test("returning to the app re-checks whether access was just granted", async () => {
    /*
     * Android grants this on a system screen, so the app is backgrounded while
     * the decision is made. Coming back to the foreground is the ONLY signal
     * that anything changed - without this the switch stays stuck off until
     * the responder kills and reopens the app.
     */
    const channelSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const addListenerSpy: jest.SpyInstance = jest.spyOn(
      AppState,
      "addEventListener",
    );

    const { result } = await renderCriticalAlerts();

    expect(result.current.isPermissionGranted).toBe(false);

    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    channelSpy.mockResolvedValue({ bypassDnd: true } as never);

    await act(async () => {
      handler("active");
    });

    await waitFor(() => {
      expect(result.current.isPermissionGranted).toBe(true);
    });
  });

  test("the stale permission instruction is cleared once access is granted", async () => {
    /*
     * The responder read "grant Do Not Disturb access", left, granted it, and
     * came back. Leaving that message on screen reads as though granting it
     * did not work.
     */
    const channelSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const addListenerSpy: jest.SpyInstance = jest.spyOn(
      AppState,
      "addEventListener",
    );

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.error).toContain("Do Not Disturb access");

    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    channelSpy.mockResolvedValue({ bypassDnd: true } as never);

    await act(async () => {
      handler("active");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("");
    });
  });

  test("backgrounding does not trigger a re-check", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const addListenerSpy: jest.SpyInstance = jest.spyOn(
      AppState,
      "addEventListener",
    );

    await renderCriticalAlerts();

    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    const channelSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "setNotificationChannelAsync",
    );
    channelSpy.mockClear();

    await act(async () => {
      handler("background");
    });

    expect(channelSpy).not.toHaveBeenCalled();
  });
});

describe("useCriticalAlerts on Android, against Android's own channel rules", () => {
  /*
   * The responder's whole round trip, with Android's channel rules in play
   * rather than a mock that flips the answer: the app starts and creates its
   * channels, the responder turns the setting on, is sent to the Do Not
   * Disturb access screen, allows it, and comes back to the app - which is
   * still running.
   *
   * Under the old read-only status check the last step read the bypassDnd
   * false stored at start-up, so the setting stayed off and the screen kept
   * asking for the access just granted, until the app was restarted.
   */
  let android: FakeAndroidNotificationChannels;
  let addListenerSpy: jest.SpyInstance;

  beforeEach(async () => {
    setPlatform("android");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);

    android = new FakeAndroidNotificationChannels();
    android.install();

    // The settings screen the setting opens; the responder acts on it below.
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);

    addListenerSpy = jest.spyOn(AppState, "addEventListener");

    // The app's start, as usePushNotifications runs it.
    await setupNotificationChannels();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function cameBackToTheApp(): Promise<void> {
    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    await act(async () => {
      handler("active");
    });
  }

  test("granting Do Not Disturb access and coming back turns critical alerts on - no restart", async () => {
    const { result } = await renderCriticalAlerts();

    expect(result.current.isPermissionGranted).toBe(false);

    // Turning it on sends the responder to Android's settings...
    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(Linking.sendIntent).toHaveBeenCalledWith(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toContain("Do Not Disturb access");
    // Never "on" before Android let it through.
    expect(toldServer()).not.toContain(true);

    // ...where they allow it, and come back.
    android.grantDoNotDisturbAccess();
    await cameBackToTheApp();

    await waitFor(() => {
      expect(result.current.isPermissionGranted).toBe(true);
    });
    expect(result.current.error).toBe("");

    // Turning it on now reaches the server, and stays on.
    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    expect(result.current.isEnabled).toBe(true);
    expect(android.stored(NotificationChannelId.CRITICAL)?.bypassDnd).toBe(
      true,
    );
  });

  test("a responder who had already turned it on sees it come back on by itself, and so does the server", async () => {
    /*
     * Opted in on this phone before (stored), but the channel was never given
     * the bypass. Once access is granted the setting shows as on again
     * without being toggled. The server was told "off" while Android did not
     * let pages through, so it is told "on" again now - it used to be left
     * as it was, which is how the Dashboard came to say the opposite of the
     * phone.
     */
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);
    await waitFor(() => {
      expect(toldServer()).toEqual([false]);
    });

    android.grantDoNotDisturbAccess();
    await cameBackToTheApp();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    await waitFor(() => {
      expect(toldServer()).toEqual([false, true]);
    });
  });

  test("coming back without granting it leaves the setting off and the instruction up", async () => {
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    await cameBackToTheApp();

    expect(result.current.isPermissionGranted).toBe(false);
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toContain("Do Not Disturb access");
  });

  test("a channel the responder changed before granting stays off - the screen does not claim otherwise", async () => {
    android.userChangesChannel(NotificationChannelId.CRITICAL, {
      sound: "content://siren",
    });

    const { result } = await renderCriticalAlerts();

    android.grantDoNotDisturbAccess();
    await cameBackToTheApp();

    expect(result.current.isPermissionGranted).toBe(false);
    expect(result.current.isEnabled).toBe(false);
  });

  test("switching the bypass off in Android's settings turns the setting off on the next return", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    android.grantDoNotDisturbAccess();

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });

    android.userChangesChannel(NotificationChannelId.CRITICAL, {
      bypassDnd: false,
    });
    await cameBackToTheApp();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(false);
    });
    expect(result.current.isPermissionGranted).toBe(false);
  });
});

describe("useCriticalAlerts when the device is not registered for push", () => {
  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);
    grantIos();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the toggle does not silently succeed with nothing to point at", async () => {
    /*
     * No push token means no device row on the server, so there is nothing to
     * set the flag on. Storing the preference anyway would show an "on" switch
     * backed by no server-side state at all.
     */
    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).not.toHaveBeenCalled();
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toContain("not registered");
  });
});

describe("useCriticalAlerts where the platform cannot support it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setIsDevice(true);
  });

  test("the setting is not offered on a simulator", async () => {
    setPlatform("ios");
    setIsDevice(false);

    const { result } = await renderCriticalAlerts();

    expect(result.current.isSupported).toBe(false);
  });

  test("the setting is not offered on web", async () => {
    setPlatform("web");
    setIsDevice(true);

    const { result } = await renderCriticalAlerts();

    expect(result.current.isSupported).toBe(false);
  });
});

describe("useCriticalAlerts on Android answers for the alarm the responder chose", () => {
  /*
   * Each alarm sound pages on a channel of its own. The switch says whether
   * pages will ring through Do Not Disturb, so it has to read the chosen
   * sound's channel: the system sound's channel bypassing tells a responder
   * who picked the klaxon nothing about the klaxon.
   */
  let android: FakeAndroidNotificationChannels;
  let addListenerSpy: jest.SpyInstance;

  beforeEach(async () => {
    setPlatform("android");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockClear();
    serverSpy().mockResolvedValue(undefined as never);

    android = new FakeAndroidNotificationChannels();
    android.install();
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);
    addListenerSpy = jest.spyOn(AppState, "addEventListener");

    await setupNotificationChannels();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function cameBackToTheApp(): Promise<void> {
    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    await act(async () => {
      handler("active");
    });
  }

  test("with the klaxon chosen, a klaxon channel Android will not let through keeps the switch off", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    await AsyncStorage.setItem("oneuptime_critical_alert_sound", "klaxon");
    android.userChangesChannel("oncall_critical_klaxon", {
      sound: "content://ringtone",
    });

    const { result } = await renderCriticalAlerts();

    android.grantDoNotDisturbAccess();
    await cameBackToTheApp();

    // The system sound's channel is through; the klaxon's is not.
    expect(android.stored(NotificationChannelId.CRITICAL)?.bypassDnd).toBe(
      true,
    );
    expect(result.current.isPermissionGranted).toBe(false);
    expect(result.current.isEnabled).toBe(false);
  });

  test("with the siren chosen and access granted, the switch comes back on by itself", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    await AsyncStorage.setItem("oneuptime_critical_alert_sound", "siren");

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);

    android.grantDoNotDisturbAccess();
    await cameBackToTheApp();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    expect(android.stored("oncall_critical_siren")?.bypassDnd).toBe(true);
  });

  test("turning it on with an alarm chosen checks that alarm's channel before telling the server", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alert_sound", "rising");
    android.grantDoNotDisturbAccess();

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
    expect(result.current.isEnabled).toBe(true);
    expect(android.stored("oncall_critical_rising")?.bypassDnd).toBe(true);
  });

  test("a chosen alarm whose channel the responder switched off is refused, without a word to the server", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alert_sound", "digital");
    android.grantDoNotDisturbAccess();

    const { result } = await renderCriticalAlerts();

    android.userChangesChannel("oncall_critical_digital", { bypassDnd: false });

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(toldServer()).not.toContain(true);
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).not.toBe("");
  });
});

/*
 * The maintainer turned critical alerts off. The app showed them off; the
 * Dashboard went on saying "On", and a test sent from it claimed to ring
 * through silent mode while the phone showed an ordinary notification. The
 * switch here showed what the phone would do (the responder's choice AND
 * the OS), but the server was only told when the switch moved.
 *
 * Now the server is told the same thing the switch shows, whenever it
 * changes - and the switch and the server never end up disagreeing.
 */
describe("useCriticalAlerts tells the server what the phone will do", () => {
  // The server's answer for a token it has no device for (UserPushService).
  const NO_DEVICE: unknown = {
    response: {
      status: 400,
      data: {
        message: "No registered device was found for this device token.",
      },
    },
  };

  let getSpy: jest.SpyInstance;
  let addListenerSpy: jest.SpyInstance;

  beforeEach(async () => {
    setPlatform("ios");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockReset();
    serverSpy().mockResolvedValue(undefined as never);

    getSpy = jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", true));
    jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", true));

    addListenerSpy = jest.spyOn(AppState, "addEventListener");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function cameBackToTheApp(): Promise<void> {
    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    await act(async () => {
      handler("active");
    });
  }

  test("critical alerts turned off in iOS Settings: the switch reads off, and the server is told off", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    getSpy.mockResolvedValue(iosPermissions("granted", false));

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(false);
    await waitFor(() => {
      expect(serverSpy()).toHaveBeenCalledWith({
        deviceToken: DEVICE_TOKEN,
        isEnabled: false,
      });
    });

    // The responder's own choice is kept, for when iOS allows it again.
    expect(await getCriticalAlertsEnabled()).toBe(true);
    // Nothing was asked of the responder, so nothing is shown as an error.
    expect(result.current.error).toBe("");
  });

  test("turned off in iOS Settings while the app was open in the background: coming back tells the server", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(toldServer()).toEqual([true]);
    });
    expect(result.current.isEnabled).toBe(true);

    getSpy.mockResolvedValue(iosPermissions("granted", false));
    await cameBackToTheApp();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(false);
    });
    await waitFor(() => {
      expect(toldServer()).toEqual([true, false]);
    });
  });

  test("allowed again in iOS Settings: the switch comes back on, and so does the server", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    getSpy.mockResolvedValue(iosPermissions("granted", false));

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(toldServer()).toEqual([false]);
    });

    getSpy.mockResolvedValue(iosPermissions("granted", true));
    await cameBackToTheApp();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    await waitFor(() => {
      expect(toldServer()).toEqual([false, true]);
    });
  });

  test("what the server was already told is not told again: opening Settings costs no request", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    await AsyncStorage.setItem(
      "oneuptime_critical_alerts_reported",
      JSON.stringify({ deviceToken: DEVICE_TOKEN, isEnabled: true }),
    );

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    await cameBackToTheApp();
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("the switch moved: the server is told once - coming back does not tell it again", async () => {
    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(toldServer()).toEqual([false]);
    });

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(toldServer()).toEqual([false, true]);

    await cameBackToTheApp();
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(toldServer()).toEqual([false, true]);
    expect(result.current.isEnabled).toBe(true);
  });

  test("turned off with no push token yet: off, kept off on the phone, and no error - nothing on the server disagrees", async () => {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");

    const { result } = await renderCriticalAlerts();

    expect(result.current.isEnabled).toBe(true);

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toBe("");
    expect(await getCriticalAlertsEnabled()).toBe(false);
    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("turned off when the server has no device for this phone: off, kept off, no error", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    serverSpy().mockRejectedValue(NO_DEVICE as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toBe("");
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("turned on when the server has no device for this phone: off, and the screen says the phone is not registered", async () => {
    serverSpy().mockRejectedValue(NO_DEVICE as never);

    const { result } = await renderCriticalAlerts();

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toContain("not registered");
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("turned off while offline: the switch stays on with the error - the phone still rings through, and the server still says so", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    await AsyncStorage.setItem(
      "oneuptime_critical_alerts_reported",
      JSON.stringify({ deviceToken: DEVICE_TOKEN, isEnabled: true }),
    );
    serverSpy().mockRejectedValue(new Error("Network Error") as never);

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.isEnabled).toBe(true);
    expect(result.current.error).toContain("Could not save this setting");
    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("a report the server could not take shows no error: nobody asked for it, and it is tried again", async () => {
    getSpy.mockResolvedValue(iosPermissions("granted", false));
    serverSpy().mockRejectedValueOnce(new Error("Network Error") as never);

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(serverSpy()).toHaveBeenCalledTimes(1);
    });
    expect(result.current.error).toBe("");

    // Back online, back to the app: told.
    await cameBackToTheApp();

    await waitFor(() => {
      expect(serverSpy()).toHaveBeenCalledTimes(2);
    });
    expect(toldServer()).toEqual([false, false]);
  });
});

describe("useCriticalAlerts on Android tells the server when Do Not Disturb access goes", () => {
  let android: FakeAndroidNotificationChannels;
  let addListenerSpy: jest.SpyInstance;

  beforeEach(async () => {
    setPlatform("android");
    setIsDevice(true);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    serverSpy().mockReset();
    serverSpy().mockResolvedValue(undefined as never);

    android = new FakeAndroidNotificationChannels();
    android.install();
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);
    addListenerSpy = jest.spyOn(AppState, "addEventListener");

    await setupNotificationChannels();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the bypass switched off in Android's settings: the switch and the server both turn off", async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    android.grantDoNotDisturbAccess();

    const { result } = await renderCriticalAlerts();

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    await waitFor(() => {
      expect(toldServer()).toEqual([true]);
    });

    android.userChangesChannel(NotificationChannelId.CRITICAL, {
      bypassDnd: false,
    });

    const handler: (state: string) => void = addListenerSpy.mock
      .calls[0]![1] as (state: string) => void;

    await act(async () => {
      handler("active");
    });

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(false);
    });
    await waitFor(() => {
      expect(toldServer()).toEqual([true, false]);
    });
  });
});
