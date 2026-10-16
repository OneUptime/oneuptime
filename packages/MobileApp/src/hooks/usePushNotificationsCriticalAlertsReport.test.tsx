import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { AppState, Platform } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  FOREGROUND_REGISTRATION_INTERVAL_MS,
  usePushNotifications,
} from "./usePushNotifications";
import * as pushDeviceApi from "../api/pushDevice";
import * as setupModule from "../notifications/setup";
import { getCriticalAlertsReport } from "../storage/preferences";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("../api/pushDevice", () => {
  return {
    registerPushDevice: jest.fn(async () => {
      return undefined;
    }),
    unregisterPushDevice: jest.fn(),
    setCriticalAlertsEnabledOnServer: jest.fn(async () => {
      return undefined;
    }),
  };
});

let mockIsAuthenticated: boolean = true;

jest.mock("./useAuth", () => {
  return {
    useAuth: () => {
      return { isAuthenticated: mockIsAuthenticated };
    },
  };
});

const mockProjects: Array<{ _id: string }> = [
  { _id: "project-1" },
  { _id: "project-2" },
];

jest.mock("./useProject", () => {
  return {
    useProject: () => {
      return { projectList: mockProjects };
    },
  };
});

/*
 * The app tells the server what the phone will do with a critical page,
 * from the root of the app - not only from the Settings screen, which most
 * people never open. The maintainer's report: critical alerts turned off on
 * the phone, the app showing them off, and the Dashboard still saying "On".
 *
 *   - After every registration the server holds what the phone does: when
 *     each project answered that its device holds it (a server that
 *     restates choices on registration), nothing more is sent; otherwise
 *     (an older server, a project that failed) the phone says it outright,
 *     once, for every device at once.
 *   - Coming back to the app reports a change - critical alerts turned off
 *     or back on in iOS Settings - even when it is too soon to register
 *     again, and sends nothing when nothing changed.
 */

const TOKEN: string = "ExponentPushToken[handset]";
const SIX_MINUTES_MS: number = 6 * 60 * 1000;

type AppStateHandler = (state: string) => void;

function registerSpy(): jest.SpyInstance {
  return pushDeviceApi.registerPushDevice as unknown as jest.SpyInstance;
}

function serverSpy(): jest.SpyInstance {
  return pushDeviceApi.setCriticalAlertsEnabledOnServer as unknown as jest.SpyInstance;
}

// What the server was told through the critical alerts route, in order.
function reported(): Array<boolean> {
  return serverSpy().mock.calls.map((call: Array<unknown>): boolean => {
    return (call[0] as { isEnabled: boolean }).isEnabled;
  });
}

const PROJECT_PLATFORM: string = Platform.OS;

describe("the server holds what the phone does, from the root of the app", () => {
  let addListener: jest.SpyInstance;
  let permissions: jest.SpyInstance;
  let clockOffsetMs: number;

  beforeEach(async () => {
    (Platform as unknown as { OS: string }).OS = "ios";
    (Device as unknown as { isDevice: boolean }).isDevice = true;
    mockIsAuthenticated = true;
    clockOffsetMs = 0;
    await AsyncStorage.clear();

    registerSpy().mockReset();
    registerSpy().mockResolvedValue(undefined as never);
    serverSpy().mockReset();
    serverSpy().mockResolvedValue(undefined as never);

    const realNow: () => number = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return realNow() + clockOffsetMs;
    });

    addListener = jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as never);

    // The responder turned it on, and iOS allows it.
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    permissions = jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({
        status: "granted",
        ios: { allowsCriticalAlerts: true },
      } as never);

    jest
      .spyOn(setupModule, "requestPermissionsAndGetToken")
      .mockResolvedValue(TOKEN as never);
    jest
      .spyOn(setupModule, "setupNotificationChannels")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(setupModule, "setupNotificationCategories")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Platform as unknown as { OS: string }).OS = PROJECT_PLATFORM;
  });

  function appStateHandler(): AppStateHandler {
    const call: Array<unknown> | undefined = addListener.mock.calls.find(
      (args: Array<unknown>) => {
        return args[0] === "change";
      },
    );

    expect(call).toBeDefined();

    return call![1] as AppStateHandler;
  }

  async function backToTheApp(): Promise<void> {
    for (const state of ["background", "active"]) {
      await act(async () => {
        appStateHandler()(state);
      });
    }
  }

  // Time for a request that should not be sent to be sent.
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });
  }

  function iosAllows(allowsCriticalAlerts: boolean): void {
    permissions.mockResolvedValue({
      status: "granted",
      ios: { allowsCriticalAlerts },
    } as never);
  }

  async function startTheApp(): Promise<void> {
    await renderHook(() => {
      return usePushNotifications(null);
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    });
    await settle();
  }

  test("every project answered that its device holds what the phone does: nothing more is sent", async () => {
    registerSpy().mockResolvedValue({ isCriticalAlertEnabled: true } as never);

    await startTheApp();

    expect(serverSpy()).not.toHaveBeenCalled();
    // ...and the app notes that the server holds it.
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: TOKEN,
      isEnabled: true,
    });
  });

  test("a server that does not answer (from before it restated choices): the phone says it outright, once", async () => {
    await startTheApp();

    expect(reported()).toEqual([true]);
    expect(serverSpy().mock.calls[0]![0]).toEqual({
      deviceToken: TOKEN,
      isEnabled: true,
    });
  });

  test("a project whose device still holds something else: the phone says it, once, for every device", async () => {
    registerSpy()
      .mockResolvedValueOnce({ isCriticalAlertEnabled: true } as never)
      .mockResolvedValueOnce({ isCriticalAlertEnabled: false } as never);

    await startTheApp();

    expect(reported()).toEqual([true]);
  });

  test("a project that failed to register: the phone says it outright", async () => {
    registerSpy()
      .mockResolvedValueOnce({ isCriticalAlertEnabled: true } as never)
      .mockRejectedValueOnce(new Error("Network Error") as never);

    await startTheApp();

    expect(reported()).toEqual([true]);
  });

  test("iOS refusing critical alerts: registered and reported as off", async () => {
    iosAllows(false);

    await startTheApp();

    for (const call of registerSpy().mock.calls) {
      expect(
        (call[0] as { isCriticalAlertEnabled: boolean }).isCriticalAlertEnabled,
      ).toBe(false);
    }
    expect(reported()).toEqual([false]);
  });

  /*
   * The maintainer's case: critical alerts turned off in iOS Settings and
   * back to the app a minute later - too soon to register again.
   */
  test("turned off in iOS Settings, back to the app within five minutes: the server is told off, without registering again", async () => {
    await startTheApp();
    expect(reported()).toEqual([true]);

    iosAllows(false);
    clockOffsetMs += 60 * 1000;
    await backToTheApp();

    await waitFor(() => {
      expect(reported()).toEqual([true, false]);
    });
    expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
  });

  test("allowed again in iOS Settings: told on again", async () => {
    iosAllows(false);
    await startTheApp();
    expect(reported()).toEqual([false]);

    iosAllows(true);
    await backToTheApp();

    await waitFor(() => {
      expect(reported()).toEqual([false, true]);
    });
  });

  test("back to the app with nothing changed: nothing is sent", async () => {
    await startTheApp();
    expect(reported()).toEqual([true]);

    await backToTheApp();
    await backToTheApp();
    await settle();

    expect(reported()).toEqual([true]);
  });

  test("back after five minutes: the registration says it, and the server is told only what changed", async () => {
    registerSpy().mockResolvedValue({ isCriticalAlertEnabled: true } as never);
    await startTheApp();
    expect(serverSpy()).not.toHaveBeenCalled();

    // Turned off in iOS Settings, and back much later: a registration.
    iosAllows(false);
    registerSpy().mockResolvedValue({ isCriticalAlertEnabled: false } as never);
    clockOffsetMs += SIX_MINUTES_MS;
    await backToTheApp();

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });
    await settle();

    // Every project's device took off in the registration: nothing more.
    for (const call of registerSpy().mock.calls.slice(mockProjects.length)) {
      expect(
        (call[0] as { isCriticalAlertEnabled: boolean }).isCriticalAlertEnabled,
      ).toBe(false);
    }
    expect(serverSpy()).not.toHaveBeenCalled();
    expect(await getCriticalAlertsReport()).toEqual({
      deviceToken: TOKEN,
      isEnabled: false,
    });
  });

  test("inactive and back - a Face ID prompt, Control Center - reports nothing", async () => {
    await startTheApp();

    iosAllows(false);
    for (const state of ["inactive", "active"]) {
      await act(async () => {
        appStateHandler()(state);
      });
    }
    await settle();

    expect(reported()).toEqual([true]);
  });

  test("signed out: coming back reports nothing", async () => {
    mockIsAuthenticated = false;

    await renderHook(() => {
      return usePushNotifications(null);
    });

    await AsyncStorage.setItem("oneuptime_expo_push_token", TOKEN);
    iosAllows(false);
    await backToTheApp();
    await settle();

    expect(registerSpy()).not.toHaveBeenCalled();
    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("no push token: nothing is registered, and nothing is reported", async () => {
    (
      setupModule.requestPermissionsAndGetToken as unknown as jest.SpyInstance
    ).mockResolvedValue(null as never);

    await renderHook(() => {
      return usePushNotifications(null);
    });

    clockOffsetMs += FOREGROUND_REGISTRATION_INTERVAL_MS - 1000;
    await backToTheApp();
    await settle();

    expect(registerSpy()).not.toHaveBeenCalled();
    expect(serverSpy()).not.toHaveBeenCalled();
  });
});
