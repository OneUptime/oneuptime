import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  requestPushRegistration,
  usePushNotifications,
} from "./usePushNotifications";
import * as pushDeviceApi from "../api/pushDevice";
import * as setupModule from "../notifications/setup";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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
 * REGISTERING AGAIN ON REQUEST (#7041). The first steps' Allow
 * Notifications asks for the permission; a phone just allowed registers
 * for pushes at once - every project, asking again where the OS still may,
 * as the app's start does - so a test page sent the next moment reaches
 * it, without restarting the app.
 */

function registerSpy(): jest.SpyInstance {
  return pushDeviceApi.registerPushDevice as unknown as jest.SpyInstance;
}

let getToken: jest.SpyInstance;

beforeEach(async () => {
  mockIsAuthenticated = true;
  await AsyncStorage.clear();
  registerSpy().mockClear();
  registerSpy().mockResolvedValue(undefined as never);

  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: jest.fn() } as never);

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

describe("a registration asked for", () => {
  test("registers every project again, asking for the permission as the app's start does", async () => {
    await renderHook(() => {
      return usePushNotifications(null);
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    });

    await act(async () => {
      requestPushRegistration();
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length * 2);
    });

    expect(getToken).toHaveBeenLastCalledWith({ askForPermission: true });
  });

  test("with nobody signed in, registers nothing", async () => {
    mockIsAuthenticated = false;

    await renderHook(() => {
      return usePushNotifications(null);
    });

    await act(async () => {
      requestPushRegistration();
    });

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    expect(registerSpy()).not.toHaveBeenCalled();
  });

  test("with no hook mounted, asking does nothing and throws nothing", () => {
    expect(() => {
      requestPushRegistration();
    }).not.toThrow();
  });

  test("a hook that is gone no longer listens", async () => {
    const view: Awaited<ReturnType<typeof renderHook>> = await renderHook(
      () => {
        return usePushNotifications(null);
      },
    );

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    });

    await view.unmount();
    registerSpy().mockClear();

    await act(async () => {
      requestPushRegistration();
    });

    expect(registerSpy()).not.toHaveBeenCalled();
  });
});
