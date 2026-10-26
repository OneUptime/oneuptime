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

/*
 * What the server was told this phone does with a critical page, in order:
 * "off" while iOS does not allow critical alerts, never "on".
 */
function toldServer(): Array<boolean> {
  return serverSpy().mock.calls.map((call: Array<unknown>): boolean => {
    return (call[0] as { isEnabled: boolean }).isEnabled;
  });
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
    await waitFor(() => {
      expect(toldServer()).toEqual([false]);
    });
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

/*
 * The maintainer's screenshot: the switch off on this screen while the
 * Dashboard still said "On". Critical alerts turned off since - in iOS
 * Settings, here - leave the responder's choice on but nothing ringing
 * through; the screen shows the switch off, and the server is told the same.
 */
describe("Critical alerts turned off in iOS Settings since they were turned on", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    await AsyncStorage.setItem(
      "oneuptime_critical_alerts_reported",
      JSON.stringify({ deviceToken: DEVICE_TOKEN, isEnabled: true }),
    );
    simulateIos(
      iosPermissions("granted", false),
      iosPermissions("granted", false),
    );
  });

  test("the switch reads off, and the server is told off", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByRole("switch")).toBeTruthy();
    });

    expect(criticalAlertsSwitch().props.value).toBe(false);
    await waitFor(() => {
      expect(serverSpy()).toHaveBeenCalledWith({
        deviceToken: DEVICE_TOKEN,
        isEnabled: false,
      });
    });

    // No alarm to choose while nothing rings through, and no error: nobody asked.
    expect(screen.queryByTestId("settings-row-alarm-sound")).toBeNull();
    expect(screen.queryByTestId("settings-critical-alerts-error")).toBeNull();
  });

  test("the footnote under the switch says iOS Settings turned it off, and opens them", async () => {
    await render(<SettingsScreen />);

    const lead: ReturnType<typeof screen.getByTestId> =
      await screen.findByTestId(
        "settings-critical-alerts-off-in-phone-settings-title",
      );

    expect(lead).toHaveTextContent("Off in iOS Settings.", { exact: false });
    expect(
      screen.getByText(/Turn on Critical Alerts under Notifications\./),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open iOS Settings" }),
    ).toBeTruthy();
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
    expect(toldServer()).not.toContain(true);
  });
});
