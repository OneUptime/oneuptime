import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePushNotifications } from "./usePushNotifications";
import * as pushDeviceApi from "../api/pushDevice";
import * as setupModule from "../notifications/setup";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
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
 * the app was next started from scratch. Registration now runs again every
 * time the app comes back from the background.
 */

type AppStateHandler = (state: string) => void;

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

  beforeEach(async () => {
    mockIsAuthenticated = true;
    await AsyncStorage.clear();
    registerSpy().mockClear();
    registerSpy().mockResolvedValue(undefined as never);

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

  test("every return from the background registers again", async () => {
    await renderAndWaitForFirstRegistration();

    await changeAppState(["background", "active"]);
    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });

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

    await changeAppState(["inactive", "active", "inactive", "active"]);
    await settle();

    expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  test("going to the background registers nothing", async () => {
    await renderAndWaitForFirstRegistration();

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
