import React from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import CriticalAlertSoundScreen from "./CriticalAlertSoundScreen";
import * as pushDeviceApi from "../../api/pushDevice";
import {
  getCriticalAlertSound,
  getCriticalAlertVolume,
} from "../../storage/preferences";
import { PUSH_TOKEN_KEY } from "../../hooks/pushTokenUtils";
import { setupNotificationChannels } from "../../notifications/setup";
import { FakeAndroidNotificationChannels } from "../../__tests__/fakeAndroidNotificationChannels";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../api/pushDevice", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../api/pushDevice",
  );

  return {
    ...actual,
    setCriticalAlertPreferencesOnServer: jest.fn(async () => {
      return undefined;
    }),
  };
});

jest.mock("../../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

/*
 * The Alarm sound screen with its real hook, real storage and the
 * notification layer, only the server stood in for: a tap goes all the way
 * to the request the server would get, and what the phone keeps.
 */

const DEVICE_TOKEN: string = "ExponentPushToken[handset]";
const ORIGINAL_PLATFORM: string = Platform.OS;

function setPlatform(os: "ios" | "android"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function serverSpy(): jest.SpyInstance {
  return pushDeviceApi.setCriticalAlertPreferencesOnServer as unknown as jest.SpyInstance;
}

function isChecked(testID: string): boolean {
  return Boolean(
    (
      screen.getByTestId(testID).props as {
        accessibilityState?: { checked?: boolean };
      }
    ).accessibilityState?.checked,
  );
}

async function renderLoaded(): Promise<void> {
  await render(<CriticalAlertSoundScreen />);

  await waitFor(() => {
    expect(
      screen.getAllByRole("radio").some((element: { props: unknown }) => {
        return Boolean(
          (element.props as { accessibilityState?: { checked?: boolean } })
            .accessibilityState?.checked,
        );
      }),
    ).toBe(true);
  });
}

beforeEach(async () => {
  (Device as unknown as { isDevice: boolean }).isDevice = true;
  await AsyncStorage.clear();
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  serverSpy().mockReset();
  serverSpy().mockResolvedValue(undefined as never);
  (
    Notifications.scheduleNotificationAsync as unknown as jest.SpyInstance
  ).mockClear();
  (
    Notifications.dismissNotificationAsync as unknown as jest.SpyInstance
  ).mockClear();
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM as "ios" | "android");
  jest.restoreAllMocks();
});

describe("on an iPhone", () => {
  beforeEach(() => {
    setPlatform("ios");
  });

  test("choosing the klaxon reaches the server and is kept on the phone", async () => {
    await renderLoaded();

    expect(isChecked("critical-alert-sound-default-select")).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByTestId("critical-alert-sound-klaxon-select"));
    });

    await waitFor(() => {
      expect(isChecked("critical-alert-sound-klaxon-select")).toBe(true);
    });
    expect(isChecked("critical-alert-sound-default-select")).toBe(false);
    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      sound: "klaxon",
    });
    expect(await getCriticalAlertSound()).toBe("klaxon");
  });

  test("a refused change leaves the old sound chosen and says why", async () => {
    serverSpy().mockRejectedValue(new Error("offline") as never);
    await renderLoaded();

    await act(async () => {
      fireEvent.press(screen.getByTestId("critical-alert-sound-siren-select"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("critical-alert-sound-error")).toBeTruthy();
    });
    expect(isChecked("critical-alert-sound-default-select")).toBe(true);
    expect(isChecked("critical-alert-sound-siren-select")).toBe(false);
    expect(await getCriticalAlertSound()).toBe("default");
  });

  test("choosing half volume reaches the server and is kept", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.press(screen.getByTestId("critical-alert-volume-50"));
    });

    await waitFor(() => {
      expect(isChecked("critical-alert-volume-50")).toBe(true);
    });
    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      volume: 50,
    });
    expect(await getCriticalAlertVolume()).toBe(50);
  });

  test("play posts the bundled file as a notification, and stop takes it away", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.press(screen.getByTestId("critical-alert-sound-siren-preview"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("critical-alert-sound-siren-playing"),
      ).toBeTruthy();
    });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ sound: "oneuptime_siren.wav" }),
        trigger: null,
      }),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("critical-alert-sound-siren-preview"));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("critical-alert-sound-siren-playing"),
      ).toBeNull();
    });
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(
      "local-notification-id",
    );
  });
});

describe("on Android", () => {
  let android: FakeAndroidNotificationChannels;

  beforeEach(async () => {
    setPlatform("android");
    android = new FakeAndroidNotificationChannels();
    android.install();
    await setupNotificationChannels();
    android.grantDoNotDisturbAccess();
  });

  test("a sound whose channel is through is chosen without a warning", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.press(
        screen.getByTestId("critical-alert-sound-smoke_alarm-select"),
      );
    });

    await waitFor(() => {
      expect(isChecked("critical-alert-sound-smoke_alarm-select")).toBe(true);
    });
    expect(
      screen.queryByTestId("critical-alert-sound-channel-warning"),
    ).toBeNull();
    expect(screen.queryByTestId("critical-alert-volume-picker")).toBeNull();
  });

  test("a sound whose channel the responder locked is chosen, and the screen warns about it", async () => {
    android.userChangesChannel("oncall_critical_klaxon", { bypassDnd: false });
    await renderLoaded();

    await act(async () => {
      fireEvent.press(screen.getByTestId("critical-alert-sound-klaxon-select"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("critical-alert-sound-channel-warning"),
      ).toBeTruthy();
    });
    expect(isChecked("critical-alert-sound-klaxon-select")).toBe(true);
  });

  test("play posts the notification on the sound's own channel", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.press(
        screen.getByTestId("critical-alert-sound-digital-preview"),
      );
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: { channelId: "oncall_critical_digital" },
      }),
    );
  });
});
