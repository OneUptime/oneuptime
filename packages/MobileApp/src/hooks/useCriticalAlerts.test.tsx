import { AppState, Platform } from "react-native";
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

    expect(serverSpy()).not.toHaveBeenCalled();
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
    expect(serverSpy()).not.toHaveBeenCalled();
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
    expect(serverSpy()).not.toHaveBeenCalled();
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
    expect(serverSpy()).not.toHaveBeenCalled();
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
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    const { result } = await renderCriticalAlerts();

    expect(result.current.isPermissionGranted).toBe(true);
  });

  test("turning it on after the grant reaches the server", async () => {
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
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
      .spyOn(Notifications, "getNotificationChannelAsync")
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
      .spyOn(Notifications, "getNotificationChannelAsync")
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
      .spyOn(Notifications, "getNotificationChannelAsync")
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
      .spyOn(Notifications, "getNotificationChannelAsync")
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
      "getNotificationChannelAsync",
    );
    channelSpy.mockClear();

    await act(async () => {
      handler("background");
    });

    expect(channelSpy).not.toHaveBeenCalled();
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
