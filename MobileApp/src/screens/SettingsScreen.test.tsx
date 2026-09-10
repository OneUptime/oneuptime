import React from "react";
import { Alert, type AlertButton } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import SettingsScreen from "./SettingsScreen";

const mockNavigate: jest.Mock = jest.fn();
const mockLogout: jest.Mock = jest.fn();
const mockSetBiometric: jest.Mock = jest.fn();
const mockSetCriticalAlerts: jest.Mock = jest.fn();

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});
jest.mock("../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return { logout: mockLogout };
    },
  };
});
jest.mock("../hooks/useBiometric", () => {
  return {
    useBiometric: () => {
      return {
        isAvailable: true,
        isEnabled: false,
        setEnabled: mockSetBiometric,
      };
    },
  };
});
jest.mock("../hooks/useCriticalAlerts", () => {
  return {
    useCriticalAlerts: () => {
      return {
        isSupported: true,
        isEnabled: false,
        isBusy: false,
        setEnabled: mockSetCriticalAlerts,
      };
    },
  };
});
jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return { selectionFeedback: jest.fn() };
    },
  };
});
jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return { isAvailable: true };
    },
  };
});
jest.mock("../storage/serverUrl", () => {
  return {
    getServerUrl: async () => {
      return "https://team.example.com";
    },
  };
});
jest.mock("expo-constants", () => {
  return { __esModule: true, default: { expoConfig: { version: "2.7.0" } } };
});

test("project management opens directly from its labeled row", async () => {
  await render(<SettingsScreen />);
  await fireEvent.press(
    screen.getByRole("button", { name: "Manage Projects" }),
  );
  expect(mockNavigate).toHaveBeenCalledWith("ProjectsList");
});

test("both device security and urgent alert toggles have accessible names on each platform", async () => {
  await render(<SettingsScreen />);
  await fireEvent(
    screen.getByLabelText("Biometrics Login"),
    "valueChange",
    true,
  );
  await fireEvent(
    screen.getByLabelText("Critical On-Call Alerts"),
    "valueChange",
    true,
  );
  expect(mockSetBiometric).toHaveBeenCalledWith(true);
  expect(mockSetCriticalAlerts).toHaveBeenCalledWith(true);
});

test("an accidental logout tap requires a clear confirmation", async () => {
  const alert: jest.SpyInstance = jest
    .spyOn(Alert, "alert")
    .mockImplementation(() => {
      return undefined;
    });
  try {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Log Out" }));
    expect(mockLogout).not.toHaveBeenCalled();
    const buttons: Array<AlertButton> | undefined = alert.mock.calls[0]?.[2];
    expect(
      buttons?.find((button: AlertButton) => {
        return button.text === "Cancel";
      })?.style,
    ).toBe("cancel");
    buttons
      ?.find((button: AlertButton) => {
        return button.text === "Log Out";
      })
      ?.onPress?.();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  } finally {
    alert.mockRestore();
  }
});

test("server details are readable without claiming unverified connectivity or a hard-coded version", async () => {
  await render(<SettingsScreen />);
  expect(await screen.findByText("https://team.example.com")).toBeTruthy();
  expect(screen.queryByText("Online")).toBeNull();
  expect(screen.getByText("OneUptime · Version 2.7.0")).toBeTruthy();
});

test("the final settings rows can scroll fully above a device with a home indicator", async () => {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 59, bottom: 34, left: 0, right: 0 }}
    >
      <SettingsScreen />
    </SafeAreaInsetsContext.Provider>,
  );
  expect(
    screen.getByTestId("settings-scroll").props.contentContainerStyle
      .paddingBottom,
  ).toBeGreaterThanOrEqual(34 + 72 + 40);
});
