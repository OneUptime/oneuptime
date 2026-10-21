import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  FOREGROUND_REGISTRATION_INTERVAL_MS,
  usePushNotifications,
} from "./usePushNotifications";
import * as pushDeviceApi from "../api/pushDevice";
import * as setupModule from "../notifications/setup";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
import logger from "../utils/logger";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("../api/pushDevice", () => {
  return {
    registerPushDevice: jest.fn(async () => {
      return undefined;
    }),
    unregisterPushDevice: jest.fn(),
    setCriticalAlertsEnabledOnServer: jest.fn(),
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
 * When Expo says a phone's push token is gone, the server stops sending to
 * the phone and tells its owner - in the device list, the on-call timeline
 * and a failed test notification - to open the mobile app on it. Opening the
 * app registers the phone again: registering asks Expo for the token again,
 * which renews it, and the server verifies the phone again, with its rules.
 *
 * The app registered only when it started. A phone brought back from the
 * background - which is how most people "open" an app - stayed silent until
 * the app was next started from scratch. Registration now runs again when
 * the app comes back from the background, at most once every five minutes,
 * without asking for notification permission again.
 */

type AppStateHandler = (state: string) => void;

const SIX_MINUTES_MS: number = 6 * 60 * 1000;

function registerSpy(): jest.SpyInstance {
  return pushDeviceApi.registerPushDevice as unknown as jest.SpyInstance;
}

/*
 * Long enough for a registration that should not happen to happen: the
 * token and the register call are both answered at once here.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });
}

function registeredProjects(): Array<string> {
  return registerSpy().mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { projectId: string }).projectId;
  });
}

describe("Push registration runs again when the app comes back from the background", () => {
  let addListener: jest.SpyInstance;
  let removeListener: jest.Mock;
  let getToken: jest.SpyInstance;

  // How far the clock has been moved on, on top of the real one.
  let clockOffsetMs: number;

  beforeEach(async () => {
    mockIsAuthenticated = true;
    clockOffsetMs = 0;
    await AsyncStorage.clear();
    registerSpy().mockClear();
    registerSpy().mockResolvedValue(undefined as never);

    const realNow: () => number = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return realNow() + clockOffsetMs;
    });

    removeListener = jest.fn();
    addListener = jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: removeListener } as never);

    getToken = jest
      .spyOn(setupModule, "requestPermissionsAndGetToken")
      .mockResolvedValue("ExponentPushToken[handset]" as never);
    jest
      .spyOn(setupModule, "setupNotificationChannels")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(setupModule, "setupNotificationCategories")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  async function renderAndWaitForFirstRegistration(): Promise<
    Awaited<ReturnType<typeof renderHook>>
  > {
    const view: Awaited<ReturnType<typeof renderHook>> = await renderHook(
      () => {
        return usePushNotifications(null);
      },
    );

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    });

    return view;
  }

  async function changeAppState(states: Array<string>): Promise<void> {
    for (const state of states) {
      await act(async () => {
        appStateHandler()(state);
      });
    }
  }

  // Some time later: past the least time between two registrations.
  function later(): void {
    clockOffsetMs += SIX_MINUTES_MS;
  }

  test("registers every project when the app starts, as before", async () => {
    await renderAndWaitForFirstRegistration();

    expect(registeredProjects()).toEqual(["project-1", "project-2"]);
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe(
      "ExponentPushToken[handset]",
    );
  });

  test("coming back from the background asks Expo for the token again and registers every project again", async () => {
    await renderAndWaitForFirstRegistration();
    expect(getToken).toHaveBeenCalledTimes(1);

    later();
    await changeAppState(["inactive", "background", "active"]);

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });

    // A fresh token from Expo, which is what renews it there.
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(registeredProjects()).toEqual([
      "project-1",
      "project-2",
      "project-1",
      "project-2",
    ]);

    for (const call of registerSpy().mock.calls) {
      expect((call[0] as { deviceToken: string }).deviceToken).toBe(
        "ExponentPushToken[handset]",
      );
    }
  });

  test("the least time between registrations is five minutes", () => {
    expect(FOREGROUND_REGISTRATION_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  /*
   * Switching between apps every few seconds must not send a request per
   * project each time. A phone Expo said was gone loses nothing by it: the
   * registration it needs is the first after the mark.
   */
  test("coming back within five minutes of a registration does not register again", async () => {
    await renderAndWaitForFirstRegistration();

    clockOffsetMs += FOREGROUND_REGISTRATION_INTERVAL_MS - 1000;
    await changeAppState(["background", "active"]);
    await settle();

    expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    expect(getToken).toHaveBeenCalledTimes(1);

    // The same return a little later does.
    clockOffsetMs += 2000;
    await changeAppState(["background", "active"]);

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });
  });

  /*
   * The start of the app asks for notification permission, as it always
   * did. Coming back from the background registers without asking, so
   * switching to the app never brings the prompt back; a permission granted
   * in the system settings meanwhile is still picked up.
   */
  test("only the start of the app asks for notification permission", async () => {
    await renderAndWaitForFirstRegistration();

    later();
    await changeAppState(["background", "active"]);

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });

    expect(getToken.mock.calls).toEqual([
      [{ askForPermission: true }],
      [{ askForPermission: false }],
    ]);
  });

  /*
   * Signing in sends the app to the background: a browser for single
   * sign-on, a mail app for a code. The first registration after it is a
   * sign-in's, and asks for permission like one - otherwise a new user would
   * never be asked, and the phone never registered, until the app restarted.
   */
  test("a return while signed out does not stop the sign-in after it from asking for permission", async () => {
    mockIsAuthenticated = false;

    const view: Awaited<ReturnType<typeof renderHook>> = await renderHook(
      () => {
        return usePushNotifications(null);
      },
    );

    await changeAppState(["background", "active"]);
    await settle();
    expect(getToken).not.toHaveBeenCalled();

    mockIsAuthenticated = true;
    await view.rerender(undefined);

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    });

    expect(getToken.mock.calls).toEqual([[{ askForPermission: true }]]);
  });

  /*
   * Without a token on a return - permission was refused, say - the app does
   * not retry three times five seconds apart as a start does: the next
   * return tries again.
   */
  test("on a return, no token is tried once, not retried", async () => {
    await renderAndWaitForFirstRegistration();

    getToken.mockResolvedValue(null as never);
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    later();
    await changeAppState(["background", "active"]);
    await settle();

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);

    const warnings: Array<string> = warn.mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    );

    // No retry is waiting to run.
    expect(
      warnings.filter((line: string) => {
        return line.includes("retrying");
      }),
    ).toEqual([]);
    expect(warnings).toContain(
      "[PushNotifications] No push token on coming back to the app — the device is registered again when one is available",
    );
  });

  test("every return after five minutes registers again", async () => {
    await renderAndWaitForFirstRegistration();

    later();
    await changeAppState(["background", "active"]);
    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });

    later();
    await changeAppState(["background", "active"]);
    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 3);
    });
  });

  /*
   * iOS reports "inactive" for a Face ID prompt (the app's biometric lock),
   * Control Center or the notification shade. The app never left, and
   * registering on each would send a request per project for nothing.
   */
  test("inactive and back - a Face ID prompt, Control Center - does not register again", async () => {
    await renderAndWaitForFirstRegistration();

    later();
    await changeAppState(["inactive", "active", "inactive", "active"]);
    await settle();

    expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  test("going to the background registers nothing", async () => {
    await renderAndWaitForFirstRegistration();

    later();
    await changeAppState(["inactive", "background"]);
    await settle();

    expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
  });

  test("signed out, coming back from the background registers nothing", async () => {
    mockIsAuthenticated = false;

    await renderHook(() => {
      return usePushNotifications(null);
    });

    await changeAppState(["background", "active"]);
    await settle();

    expect(registerSpy()).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  test("the app state listener is removed when the hook unmounts", async () => {
    const view: Awaited<ReturnType<typeof renderHook>> =
      await renderAndWaitForFirstRegistration();

    await view.unmount();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
