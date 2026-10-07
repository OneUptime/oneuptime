import React from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import SettingsScreen from "./SettingsScreen";
import * as pushDeviceApi from "../api/pushDevice";
import { PUSH_TOKEN_KEY } from "../hooks/pushTokenUtils";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The iOS critical alert setting as the responder sees it, through the real
 * hook and the real OS checks. Only iOS itself and the server are stand-ins.
 *
 * App Store builds up to 1.4.0 lacked Apple's critical alerts entitlement, so
 * iOS never offered them critical alerts and never added a Critical Alerts
 * switch to Settings. Turning the in-app setting on still told the responder
 * to allow Critical Alerts in iOS Settings - a switch they could not find,
 * however they rearranged their notification rules. These tests pin what the
 * screen says in each state iOS can be in.
 *
 * iOS-only, like SettingsScreenCriticalAlerts.test.tsx: the switch is found by
 * role, which @testing-library/react-native only matches on iOS.
 */

jest.mock("../api/pushDevice", () => {
  return {
    registerPushDevice: jest.fn(),
    unregisterPushDevice: jest.fn(),
    setCriticalAlertsEnabledOnServer: jest.fn(async () => {
      return undefined;
    }),
  };
});

jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return { isAvailable: true, isChecking: false };
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
      return { navigate: jest.fn() };
    },
  };
});

const DEVICE_TOKEN: string = "ExponentPushToken[handset]";

/*
 * allowsCriticalAlerts is null when iOS reports critical alerts as not
 * supported: a build without the entitlement, or an entitled build that has
 * not asked yet.
 */
function iosPermissions(
  status: "granted" | "denied",
  allowsCriticalAlerts: boolean | null,
): never {
  return { status: status, ios: { allowsCriticalAlerts } } as never;
}

// iOS reports `beforeRequest` until the app asks, and `afterRequest` after.
function simulateIos(beforeRequest: never, afterRequest: never): void {
  let current: never = beforeRequest;

  jest
    .spyOn(Notifications, "getPermissionsAsync")
    .mockImplementation(async () => {
      return current;
    });

  jest
    .spyOn(Notifications, "requestPermissionsAsync")
    .mockImplementation(async () => {
      current = afterRequest;
      return afterRequest;
    });
}

function serverSpy(): jest.SpyInstance {
  return pushDeviceApi.setCriticalAlertsEnabledOnServer as unknown as jest.SpyInstance;
}

type SwitchElement = { props: { value?: boolean } };

async function turnCriticalAlertsOn(): Promise<void> {
  await render(<SettingsScreen />);

  const toggle: unknown = await waitFor(() => {
    return screen.getByRole("switch");
  });

  fireEvent(toggle as never, "valueChange", true);
}

function criticalAlertsSwitch(): SwitchElement {
  return screen.getByRole("switch") as unknown as SwitchElement;
}

beforeEach(async () => {
  (Platform as unknown as { OS: string }).OS = "ios";
  (Device as unknown as { isDevice: boolean }).isDevice = true;
  await AsyncStorage.clear();
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  serverSpy().mockClear();
  serverSpy().mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("On an iOS build without Apple's critical alerts entitlement", () => {
  beforeEach(() => {
    simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", null),
    );
  });

  test("the screen says this version cannot get critical alerts and to update it", async () => {
    await turnCriticalAlertsOn();

    await waitFor(() => {
      expect(screen.getByTestId("settings-critical-alerts-error")).toBeTruthy();
      expect(screen.getByText(/Update OneUptime On-Call/)).toBeTruthy();
    });
  });

  test("the screen does not send the responder to a switch iOS is not showing", async () => {
    await turnCriticalAlertsOn();

    await waitFor(() => {
      expect(screen.getByTestId("settings-critical-alerts-error")).toBeTruthy();
    });

    expect(screen.queryByText(/Allow Critical Alerts/)).toBeNull();
  });

  test("the switch stays off and the server is never told it is on", async () => {
    await turnCriticalAlertsOn();

    await waitFor(() => {
      expect(screen.getByTestId("settings-critical-alerts-error")).toBeTruthy();
    });

    expect(criticalAlertsSwitch().props.value).toBe(false);
    expect(serverSpy()).not.toHaveBeenCalled();
  });
});

describe("After updating to a build that carries the entitlement", () => {
  test("allowing critical alerts at the iOS prompt turns the setting on", async () => {
    simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", true),
    );

    await turnCriticalAlertsOn();

    await waitFor(() => {
      expect(
        screen.getByTestId("settings-critical-alerts-status"),
      ).toBeTruthy();
    });

    expect(
      screen.getByText(/play a sound even when this device is silenced/),
    ).toBeTruthy();
    expect(criticalAlertsSwitch().props.value).toBe(true);
    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      isEnabled: true,
    });
  });

  test("declining the iOS prompt points to the Critical Alerts switch iOS now shows", async () => {
    simulateIos(
      iosPermissions("granted", null),
      iosPermissions("granted", false),
    );

    await turnCriticalAlertsOn();

    await waitFor(() => {
      expect(
        screen.getByText(
          /Allow Critical Alerts for OneUptime On-Call in iOS Settings/,
        ),
      ).toBeTruthy();
    });

    expect(screen.queryByText(/Update OneUptime On-Call/)).toBeNull();
    expect(criticalAlertsSwitch().props.value).toBe(false);
  });
});

describe("With notifications turned off for the app", () => {
  test("the screen says to turn notifications back on first", async () => {
    simulateIos(iosPermissions("denied", null), iosPermissions("denied", null));

    await turnCriticalAlertsOn();

    await waitFor(() => {
      expect(screen.getByText(/Turn on Allow Notifications/)).toBeTruthy();
    });

    expect(screen.queryByText(/Update OneUptime On-Call/)).toBeNull();
    expect(serverSpy()).not.toHaveBeenCalled();
  });
});
