import { AppState, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import {
  type NotificationPermission,
  toNotificationPermissionState,
  useNotificationPermission,
} from "./useNotificationPermission";
import { NotificationPermissionState } from "../onboarding/getReady";
import { requestPushRegistration } from "./usePushNotifications";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE FIRST STEP: ALLOW NOTIFICATIONS (#7041). What the OS says, read again
 * whenever the app comes back to the front; the system prompt while the OS
 * still may ask, and this app's page in the phone's settings once it may
 * not; and a phone just allowed registers for pushes at once.
 */

jest.mock("./usePushNotifications", () => {
  return {
    requestPushRegistration: jest.fn(),
  };
});

type PermissionAnswer = {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
};

let osAnswer: PermissionAnswer;
let answerAfterPrompt: PermissionAnswer;
let appStateListener: ((state: string) => void) | null;

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function setIsDevice(isDevice: boolean): void {
  (Device as unknown as { isDevice: boolean }).isDevice = isDevice;
}

async function renderPermission(): Promise<{
  result: { current: NotificationPermission };
}> {
  return (await renderHook(() => {
    return useNotificationPermission();
  })) as unknown as { result: { current: NotificationPermission } };
}

beforeEach(() => {
  setPlatform("ios");
  setIsDevice(true);
  osAnswer = { status: "undetermined", canAskAgain: true };
  answerAfterPrompt = { status: "granted", canAskAgain: true };
  appStateListener = null;

  jest
    .spyOn(Notifications, "getPermissionsAsync")
    .mockImplementation((async () => {
      return osAnswer;
    }) as never);
  jest
    .spyOn(Notifications, "requestPermissionsAsync")
    .mockImplementation((async () => {
      osAnswer = answerAfterPrompt;
      return answerAfterPrompt;
    }) as never);
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _type: string,
    listener: (state: string) => void,
  ) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as never);
  (requestPushRegistration as unknown as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the OS says", () => {
  test("allowed, refused for good, or not asked yet", () => {
    expect(
      toNotificationPermissionState({
        status: "granted",
        canAskAgain: true,
      } as never),
    ).toBe(NotificationPermissionState.Granted);
    expect(
      toNotificationPermissionState({
        status: "denied",
        canAskAgain: false,
      } as never),
    ).toBe(NotificationPermissionState.Denied);
    // Android asks a second time after one refusal.
    expect(
      toNotificationPermissionState({
        status: "denied",
        canAskAgain: true,
      } as never),
    ).toBe(NotificationPermissionState.NotAsked);
    expect(
      toNotificationPermissionState({
        status: "undetermined",
        canAskAgain: true,
      } as never),
    ).toBe(NotificationPermissionState.NotAsked);
  });

  test("is read as the step opens", async () => {
    osAnswer = { status: "granted", canAskAgain: true };

    const { result } = await renderPermission();

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.Granted);
    });
  });

  test("is read again when the app comes back to the front: turned on in the phone's settings meanwhile", async () => {
    osAnswer = { status: "denied", canAskAgain: false };

    const { result } = await renderPermission();

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.Denied);
    });

    osAnswer = { status: "granted", canAskAgain: false };

    await act(async () => {
      appStateListener?.("active");
    });

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.Granted);
    });
  });

  test("a simulator or the browser has nothing to allow", async () => {
    setIsDevice(false);

    const { result } = await renderPermission();

    expect(result.current.state).toBe(NotificationPermissionState.Unavailable);

    await act(async () => {
      await result.current.allow();
    });

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("Allow Notifications", () => {
  test("asks with the system prompt, and a phone allowed registers for pushes at once", async () => {
    const { result } = await renderPermission();

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.NotAsked);
    });

    await act(async () => {
      await result.current.allow();
    });

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    expect(result.current.state).toBe(NotificationPermissionState.Granted);
    expect(requestPushRegistration).toHaveBeenCalledTimes(1);
    expect(result.current.isAsking).toBe(false);
  });

  test("refused at the prompt: nothing registers, and the step says so", async () => {
    answerAfterPrompt = { status: "denied", canAskAgain: false };

    const { result } = await renderPermission();

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.NotAsked);
    });

    await act(async () => {
      await result.current.allow();
    });

    expect(result.current.state).toBe(NotificationPermissionState.Denied);
    expect(requestPushRegistration).not.toHaveBeenCalled();
  });

  test("refused for good before: the OS will not ask again, so it opens this app's page in the phone's settings", async () => {
    osAnswer = { status: "denied", canAskAgain: false };

    const { result } = await renderPermission();

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.Denied);
    });

    await act(async () => {
      await result.current.allow();
    });

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test("a prompt that fails reads the OS again rather than guess", async () => {
    (Notifications.requestPermissionsAsync as unknown as jest.Mock)
      .mockReset()
      .mockRejectedValueOnce(new Error("prompt unavailable"));
    osAnswer = { status: "undetermined", canAskAgain: true };

    const { result } = await renderPermission();

    await waitFor(() => {
      expect(result.current.state).toBe(NotificationPermissionState.NotAsked);
    });

    await act(async () => {
      await result.current.allow();
    });

    expect(result.current.state).toBe(NotificationPermissionState.NotAsked);
    expect(result.current.isAsking).toBe(false);
    expect(requestPushRegistration).not.toHaveBeenCalled();
  });
});
