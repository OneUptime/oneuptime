import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import SettingsScreen from "./SettingsScreen";

/*
 * The "Calendar feed" row on Settings is the second door to the feed screen
 * (the first is the on-call tab). Two things about it are worth a test: it
 * pushes the screen on THIS stack rather than jumping tabs, and it is not
 * offered at all on a server that predates calendar feeds - a row that opens
 * a "not supported" message is a row that should not be there.
 */

const mockCalendarFeed: {
  current: { isAvailable: boolean; isChecking: boolean };
} = { current: { isAvailable: true, isChecking: false } };

const mockNavigate: jest.Mock = jest.fn();

jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return mockCalendarFeed.current;
    },
  };
});

jest.mock("../hooks/useCriticalAlerts", () => {
  return {
    useCriticalAlerts: () => {
      return {
        isSupported: false,
        isPermissionGranted: false,
        isEnabled: false,
        isBusy: false,
        error: "",
        statusMessage: "",
        setEnabled: jest.fn(),
        refresh: jest.fn(),
      };
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

describe("SettingsScreen calendar feed row", () => {
  beforeEach(() => {
    mockCalendarFeed.current = { isAvailable: true, isChecking: false };
    mockNavigate.mockClear();
  });

  test("offers the row under an On-Call section", async () => {
    await render(<SettingsScreen />);

    expect(screen.getByTestId("settings-section-oncall")).toBeTruthy();
    expect(screen.getByText("Calendar feed")).toBeTruthy();
    expect(screen.getByText(/Subscribe to your on-call shifts/)).toBeTruthy();
  });

  test("pushes the feed screen on the settings stack", async () => {
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId("settings-row-calendar-feed"));

    expect(mockNavigate).toHaveBeenCalledWith("OnCallCalendarFeed");
  });

  test("hides the whole section on a server without calendar feeds", async () => {
    mockCalendarFeed.current = { isAvailable: false, isChecking: false };

    await render(<SettingsScreen />);

    expect(screen.queryByTestId("settings-section-oncall")).toBeNull();
    expect(screen.queryByText("Calendar feed")).toBeNull();

    /* The neighbouring sections are still there. */
    expect(screen.getByText("Manage Projects")).toBeTruthy();
  });

  test("shows the row while the check is still running", async () => {
    mockCalendarFeed.current = { isAvailable: true, isChecking: true };

    await render(<SettingsScreen />);

    expect(screen.getByTestId("settings-row-calendar-feed")).toBeTruthy();
  });
});
