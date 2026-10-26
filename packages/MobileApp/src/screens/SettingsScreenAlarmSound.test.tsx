import React from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import SettingsScreen from "./SettingsScreen";
import type { CriticalAlertsState } from "../hooks/useCriticalAlerts";
import {
  setCriticalAlertSound,
  setCriticalAlertVolume,
} from "../storage/preferences";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Alarm sound row under the critical alerts switch: offered only while
 * critical alerts are on - the alarm plays only for critical pages - naming
 * the alarm (and on an iPhone its volume), following a change made on the
 * Alarm sound screen, and opening that screen.
 */

const mockCriticalAlertsState: { current: CriticalAlertsState } = {
  current: {} as CriticalAlertsState,
};

const mockNavigate: jest.Mock = jest.fn();

jest.mock("../hooks/useCriticalAlerts", () => {
  return {
    useCriticalAlerts: () => {
      return mockCriticalAlertsState.current;
    },
  };
});

jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return { isAvailable: false, isChecking: false };
    },
  };
});

jest.mock("../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return { logout: jest.fn() };
    },
  };
});

jest.mock("../hooks/useBiometric", () => {
  return {
    useBiometric: () => {
      return {
        isAvailable: false,
        isEnabled: false,
        biometricType: "Biometrics",
        authenticate: jest.fn(),
        setEnabled: jest.fn(),
      };
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
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

jest.mock("../storage/serverUrl", () => {
  return {
    getServerUrl: async () => {
      return "https://oneuptime.com";
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});

const ORIGINAL_PLATFORM: string = Platform.OS;

function setPlatform(os: "ios" | "android"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function stateWith(
  overrides: Partial<CriticalAlertsState> = {},
): CriticalAlertsState {
  return {
    isSupported: true,
    isPermissionGranted: true,
    isEnabled: true,
    isBusy: false,
    error: "",
    statusMessage: "On-call pages will play a sound even when silenced.",
    offInPhoneSettings: null,
    openPhoneSettings: jest.fn(async () => {
      return undefined;
    }) as unknown as CriticalAlertsState["openPhoneSettings"],
    setEnabled: jest.fn(async () => {
      return undefined;
    }) as unknown as (enabled: boolean) => Promise<void>,
    refresh: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNavigate.mockClear();
  mockCriticalAlertsState.current = stateWith();
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM as "ios" | "android");
});

describe("the Alarm sound row", () => {
  test("is offered while critical alerts are on", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-row-alarm-sound")).toBeTruthy();
    });
    expect(screen.getByText("Alarm sound")).toBeTruthy();
  });

  test("is not offered while they are off: the alarm plays only for critical pages", async () => {
    mockCriticalAlertsState.current = stateWith({ isEnabled: false });

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Critical On-Call Alerts")).toBeTruthy();
    });
    expect(screen.queryByTestId("settings-row-alarm-sound")).toBeNull();
  });

  test("is not offered where critical alerts are not", async () => {
    mockCriticalAlertsState.current = stateWith({ isSupported: false });

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Log Out")).toBeTruthy();
    });
    expect(screen.queryByTestId("settings-row-alarm-sound")).toBeNull();
  });

  test("on an iPhone names the alarm and its volume", async () => {
    setPlatform("ios");
    await setCriticalAlertSound("klaxon");
    await setCriticalAlertVolume(75);

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Klaxon · 75% volume")).toBeTruthy();
    });
  });

  test("on Android names the alarm alone: the phone's alarm volume applies", async () => {
    setPlatform("android");
    await setCriticalAlertSound("smoke_alarm");
    await setCriticalAlertVolume(25);

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Smoke alarm")).toBeTruthy();
    });
    expect(screen.queryByText(/% volume/)).toBeNull();
  });

  test("a phone that never chose names the system sound", async () => {
    setPlatform("ios");

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("System default · 100% volume")).toBeTruthy();
    });
  });

  test("follows a change made on the Alarm sound screen", async () => {
    setPlatform("ios");

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("System default · 100% volume")).toBeTruthy();
    });

    await act(async () => {
      await setCriticalAlertSound("rising");
      await setCriticalAlertVolume(50);
    });

    await waitFor(() => {
      expect(screen.getByText("Rising alarm · 50% volume")).toBeTruthy();
    });
  });

  test("opens the Alarm sound screen", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-row-alarm-sound")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-row-alarm-sound"));

    expect(mockNavigate).toHaveBeenCalledWith("CriticalAlertSound");
  });

  test("tells a screen reader what it is for and what is chosen", async () => {
    setPlatform("ios");
    await setCriticalAlertSound("siren");

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Siren · 100% volume")).toBeTruthy();
    });

    const row: { props: Record<string, unknown> } = screen.getByTestId(
      "settings-row-alarm-sound",
    ) as unknown as { props: Record<string, unknown> };

    expect(row.props["accessibilityRole"]).toBe("button");
    expect(row.props["accessibilityLabel"]).toBe("Alarm sound");
    expect(row.props["accessibilityHint"]).toBe(
      "Choose the sound critical on-call pages play on this phone.",
    );
    expect(row.props["accessibilityValue"]).toEqual({
      text: "Siren · 100% volume",
    });
  });
});
