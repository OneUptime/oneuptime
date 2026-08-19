import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, waitFor } from "@testing-library/react-native";
import { usePushNotifications } from "./usePushNotifications";
import * as pushDeviceApi from "../api/pushDevice";
import * as setupModule from "../notifications/setup";
import { setCriticalAlertsEnabled } from "../storage/preferences";
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

jest.mock("./useAuth", () => {
  return {
    useAuth: () => {
      return { isAuthenticated: true };
    },
  };
});

jest.mock("./useProject", () => {
  return {
    useProject: () => {
      return { projectList: [{ _id: "project-1" }, { _id: "project-2" }] };
    },
  };
});

/*
 * Registration is where the responder's choice is RESTATED to the server, and
 * it is the path nobody thinks about.
 *
 * Each project a responder belongs to gets its own UserPush row, and a row
 * created without the flag defaults to off. So a responder who turned critical
 * alerts on last month and joined a new project this morning would be paged
 * loudly for the old projects and silently for the new one - with nothing in
 * any UI to suggest the two differ. Reinstalling the app, or being issued a
 * fresh Expo push token, has the same effect across every project at once.
 */

function registerSpy(): jest.SpyInstance {
  return pushDeviceApi.registerPushDevice as unknown as jest.SpyInstance;
}

describe("Push registration restates the critical alert preference", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    registerSpy().mockClear();
    registerSpy().mockResolvedValue(undefined as never);

    jest
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

  test("sends the stored opt-in for every project", async () => {
    await setCriticalAlertsEnabled(true);

    await renderHook(() => {
      return usePushNotifications(null);
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(2);
    });

    for (const call of registerSpy().mock.calls) {
      expect(
        (call[0] as { isCriticalAlertEnabled: boolean }).isCriticalAlertEnabled,
      ).toBe(true);
    }
  });

  test("sends false when the responder never opted in", async () => {
    await renderHook(() => {
      return usePushNotifications(null);
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalled();
    });

    expect(
      (registerSpy().mock.calls[0]![0] as { isCriticalAlertEnabled: boolean })
        .isCriticalAlertEnabled,
    ).toBe(false);
  });

  test("still registers every project with its token", async () => {
    await setCriticalAlertsEnabled(true);

    await renderHook(() => {
      return usePushNotifications(null);
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(2);
    });

    const projectIds: Array<string> = registerSpy().mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { projectId: string }).projectId;
      },
    );

    expect(projectIds).toEqual(["project-1", "project-2"]);
  });
});
