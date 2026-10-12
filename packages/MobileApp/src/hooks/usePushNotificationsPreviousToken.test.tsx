import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePushNotifications } from "./usePushNotifications";
import * as pushDeviceApi from "../api/pushDevice";
import * as setupModule from "../notifications/setup";
import { PREVIOUS_PUSH_TOKEN_KEY, PUSH_TOKEN_KEY } from "./pushTokenUtils";
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
 * Expo gives the app a new push token on a phone set up from a backup of the
 * old one, while the app's data comes along. Every project's device for this
 * phone was registered with the old token: the app tells each project the
 * token it had before, and the server moves that device - with the rules its
 * owner set up - to the new token. Before, each project got a new device with
 * default rules beside the old one, which was paged until Expo said its token
 * was gone and then showed as "Not receiving notifications" until somebody
 * deleted it.
 *
 * The old token is told to every project, and kept until every project has
 * been told: a registration that failed for one is told again next time.
 */

type AppStateHandler = (state: string) => void;

const OLD_TOKEN: string = "ExponentPushToken[old-handset]";
const NEW_TOKEN: string = "ExponentPushToken[new-handset]";

const SIX_MINUTES_MS: number = 6 * 60 * 1000;

function registerSpy(): jest.SpyInstance {
  return pushDeviceApi.registerPushDevice as unknown as jest.SpyInstance;
}

function registrations(): Array<{
  deviceToken: string;
  projectId: string;
  previousDeviceToken?: string;
}> {
  return registerSpy().mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      deviceToken: string;
      projectId: string;
      previousDeviceToken?: string;
    };
  });
}

describe("A new push token on a phone that kept the app's data", () => {
  let addListener: jest.SpyInstance;
  let clockOffsetMs: number;

  beforeEach(async () => {
    clockOffsetMs = 0;
    await AsyncStorage.clear();
    registerSpy().mockClear();
    registerSpy().mockResolvedValue(undefined as never);

    const realNow: () => number = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return realNow() + clockOffsetMs;
    });

    addListener = jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as never);

    jest
      .spyOn(setupModule, "requestPermissionsAndGetToken")
      .mockResolvedValue(NEW_TOKEN as never);
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

  async function startApp(): Promise<void> {
    await renderHook(() => {
      return usePushNotifications(null);
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(mockProjects.length);
    });
  }

  async function comeBackLater(registrationsBefore: number): Promise<void> {
    const call: Array<unknown> | undefined = addListener.mock.calls.find(
      (args: Array<unknown>) => {
        return args[0] === "change";
      },
    );
    const handler: AppStateHandler = call![1] as AppStateHandler;

    clockOffsetMs += SIX_MINUTES_MS;

    await act(async () => {
      handler("background");
    });
    await act(async () => {
      handler("active");
    });

    await waitFor(() => {
      expect(registerSpy()).toHaveBeenCalledTimes(
        registrationsBefore + mockProjects.length,
      );
    });
  }

  test("every project is told the token it had before, and the new token is kept", async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, OLD_TOKEN);

    await startApp();

    expect(registrations()).toEqual([
      expect.objectContaining({
        deviceToken: NEW_TOKEN,
        projectId: "project-1",
        previousDeviceToken: OLD_TOKEN,
      }),
      expect.objectContaining({
        deviceToken: NEW_TOKEN,
        projectId: "project-2",
        previousDeviceToken: OLD_TOKEN,
      }),
    ]);
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe(NEW_TOKEN);
  });

  test("once every project was told, the next registration has nothing to tell", async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, OLD_TOKEN);

    await startApp();

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(PREVIOUS_PUSH_TOKEN_KEY)).toBeNull();
    });

    await comeBackLater(mockProjects.length);

    for (const registration of registrations().slice(mockProjects.length)) {
      expect(registration.deviceToken).toBe(NEW_TOKEN);
      expect("previousDeviceToken" in registration).toBe(false);
    }
  });

  test("a project that could not be told is told again on the next registration, every project with it", async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, OLD_TOKEN);

    registerSpy()
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("Network Error") as never);

    await startApp();

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(PREVIOUS_PUSH_TOKEN_KEY)).toBe(
        OLD_TOKEN,
      );
    });

    await comeBackLater(mockProjects.length);

    expect(registrations().slice(mockProjects.length)).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        previousDeviceToken: OLD_TOKEN,
      }),
      expect.objectContaining({
        projectId: "project-2",
        previousDeviceToken: OLD_TOKEN,
      }),
    ]);

    // Told everywhere now: forgotten.
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(PREVIOUS_PUSH_TOKEN_KEY)).toBeNull();
    });
  });

  test("an unchanged token has nothing to tell: the registration is what it always was", async () => {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, NEW_TOKEN);

    await startApp();

    for (const registration of registrations()) {
      expect("previousDeviceToken" in registration).toBe(false);
    }
  });

  test("the first registration of a fresh install has nothing to tell", async () => {
    await startApp();

    for (const registration of registrations()) {
      expect("previousDeviceToken" in registration).toBe(false);
    }
    expect(await AsyncStorage.getItem(PREVIOUS_PUSH_TOKEN_KEY)).toBeNull();
  });
});
