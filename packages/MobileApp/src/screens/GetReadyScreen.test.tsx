import React from "react";
import { Platform, StyleSheet } from "react-native";
import { lightColors } from "../theme/colors";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import {
  beforeEach,
  describe,
  expect,
  jest as jestGlobal,
  test,
} from "@jest/globals";
import GetReadyScreen from "./GetReadyScreen";
import {
  GET_READY_TEXT,
  NotificationPermissionState,
} from "../onboarding/getReady";
import { CriticalAlertSettingsPlace } from "../notifications/criticalAlerts";
import type { TestPageFromAppState } from "../hooks/useTestPageFromApp";

/*
 * GET READY FOR ON-CALL (#7041), the screen: three steps in order, the next
 * one marked with the screen's one primary button, each button doing its
 * step, what each step stands at said in a line under it, and Not Now - or
 * Done, once ready - putting the screen away.
 */

const mockGoBack: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockAllow: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockSetEnabled: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockOpenPhoneSettings: jest.Mock =
  jestGlobal.fn() as unknown as jest.Mock;
const mockSend: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockSuccess: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;

const mockNotifications: {
  current: { state: NotificationPermissionState; isAsking: boolean };
} = {
  current: { state: NotificationPermissionState.NotAsked, isAsking: false },
};

const mockCritical: {
  current: {
    isSupported: boolean;
    isEnabled: boolean;
    isBusy: boolean;
    error: string;
    statusMessage: string;
    offInPhoneSettings: {
      title: string;
      message: string;
      place: CriticalAlertSettingsPlace;
      tone: "warning" | "danger";
    } | null;
  };
} = {
  current: {
    isSupported: true,
    isEnabled: false,
    isBusy: false,
    error: "",
    statusMessage: "iOS has not granted critical alerts to this app.",
    offInPhoneSettings: null,
  },
};

const mockTestPage: { current: TestPageFromAppState } = {
  current: { kind: "idle" },
};

const mockProject: { current: { _id: string; name: string } | null } = {
  current: { _id: "project-1", name: "Acme" },
};

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { goBack: mockGoBack };
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        lightImpact: jest.fn(),
        selectionFeedback: jest.fn(),
        successFeedback: mockSuccess,
        errorFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("../hooks/useProject", () => {
  return {
    useProject: () => {
      return { activeProject: mockProject.current };
    },
  };
});

jest.mock("../hooks/useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return "user-1";
    },
  };
});

jest.mock("../hooks/useNotificationPermission", () => {
  return {
    useNotificationPermission: () => {
      return { ...mockNotifications.current, allow: mockAllow };
    },
  };
});

jest.mock("../hooks/useCriticalAlerts", () => {
  return {
    useCriticalAlerts: () => {
      return {
        ...mockCritical.current,
        isPermissionGranted: false,
        setEnabled: mockSetEnabled,
        openPhoneSettings: mockOpenPhoneSettings,
        refresh: jest.fn(),
      };
    },
  };
});

const mockTestPageArgs: Array<unknown> = [];

jest.mock("../hooks/useTestPageFromApp", () => {
  return {
    useTestPageFromApp: (args: unknown) => {
      mockTestPageArgs.push(args);
      return { state: mockTestPage.current, send: mockSend };
    },
  };
});

function setPlatform(os: "ios" | "android"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function textOf(testID: string): string {
  const children: unknown = screen.getByTestId(testID).props.children;

  return Array.isArray(children) ? children.join("") : String(children);
}

// Every button drawn filled in the primary colour.
function primaryButtons(): Array<string> {
  return screen
    .getAllByRole("button")
    .filter((button: ReturnType<typeof screen.getByRole>): boolean => {
      const style: Record<string, unknown> = StyleSheet.flatten(
        button.props.style,
      ) as Record<string, unknown>;

      return style["backgroundColor"] === lightColors.actionPrimary;
    })
    .map((button: ReturnType<typeof screen.getByRole>): string => {
      return String(button.props.testID);
    });
}

beforeEach(() => {
  setPlatform("ios");
  mockNotifications.current = {
    state: NotificationPermissionState.NotAsked,
    isAsking: false,
  };
  mockCritical.current = {
    isSupported: true,
    isEnabled: false,
    isBusy: false,
    error: "",
    statusMessage: "iOS has not granted critical alerts to this app.",
    offInPhoneSettings: null,
  };
  mockTestPage.current = { kind: "idle" };
  mockProject.current = { _id: "project-1", name: "Acme" };
  mockTestPageArgs.length = 0;
  for (const mock of [
    mockGoBack,
    mockAllow,
    mockSetEnabled,
    mockOpenPhoneSettings,
    mockSend,
    mockSuccess,
  ]) {
    mock.mockClear();
  }
});

describe("a new install", () => {
  test("three steps in order, nothing done, notifications next", async () => {
    await render(<GetReadyScreen />);

    expect(textOf("get-ready-heading")).toBe(GET_READY_TEXT.heading);
    expect(screen.getByText("0 of 3 done")).toBeTruthy();
    expect(textOf("get-ready-step-notifications-title")).toBe(
      "Allow notifications",
    );
    expect(textOf("get-ready-step-critical_alerts-title")).toBe(
      "Allow critical alerts",
    );
    expect(textOf("get-ready-step-test_page-title")).toBe(
      "Send yourself a test page",
    );
    // Each says where it stands to a screen reader.
    expect(
      screen.getByTestId("get-ready-step-notifications-title").props
        .accessibilityLabel,
    ).toBe("Step 1: Allow notifications. Next step.");
    expect(
      screen.getByTestId("get-ready-step-critical_alerts-title").props
        .accessibilityLabel,
    ).toBe("Step 2: Allow critical alerts. To do.");
    expect(screen.getByText(GET_READY_TEXT.notNow)).toBeTruthy();
  });

  test("Allow Notifications asks", async () => {
    await render(<GetReadyScreen />);

    await fireEvent.press(
      screen.getByTestId("get-ready-step-notifications-action"),
    );

    expect(mockAllow).toHaveBeenCalledTimes(1);
  });

  test("the test page is sent in the project open, as the person signed in", async () => {
    await render(<GetReadyScreen />);

    expect(mockTestPageArgs[mockTestPageArgs.length - 1]).toEqual({
      projectId: "project-1",
      userId: "user-1",
    });

    await fireEvent.press(
      screen.getByTestId("get-ready-step-test_page-action"),
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("Not Now puts the screen away", async () => {
    await render(<GetReadyScreen />);

    await fireEvent.press(screen.getByTestId("get-ready-close"));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});

describe("notifications turned off in the phone's settings", () => {
  test("says so, and its button opens them", async () => {
    mockNotifications.current = {
      state: NotificationPermissionState.Denied,
      isAsking: false,
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-notifications-detail")).toBe(
      GET_READY_TEXT.notificationsOff,
    );
    expect(textOf("get-ready-step-critical_alerts-detail")).toBe(
      GET_READY_TEXT.criticalNeedsNotifications,
    );

    await fireEvent.press(
      screen.getByTestId("get-ready-step-notifications-action"),
    );

    expect(mockAllow).toHaveBeenCalledTimes(1);
  });
});

describe("ringing through silent mode", () => {
  beforeEach(() => {
    mockNotifications.current = {
      state: NotificationPermissionState.Granted,
      isAsking: false,
    };
  });

  test("is next once notifications are on: Turn On Critical Alerts turns the setting on", async () => {
    await render(<GetReadyScreen />);

    expect(screen.getByText("1 of 3 done")).toBeTruthy();
    expect(
      screen.queryByTestId("get-ready-step-notifications-action"),
    ).toBeNull();

    await fireEvent.press(
      screen.getByTestId("get-ready-step-critical_alerts-action"),
    );

    expect(mockSetEnabled).toHaveBeenCalledWith(true);
  });

  test("Android names it for Do Not Disturb", async () => {
    setPlatform("android");

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-critical_alerts-title")).toBe(
      "Ring through Do Not Disturb",
    );
  });

  test("a refusal says what to do, in the setting's own words", async () => {
    mockCritical.current = {
      ...mockCritical.current,
      error:
        "Android has not granted Do Not Disturb access to this app. Allow it in Settings > Notifications > Do Not Disturb access, then try again.",
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-critical_alerts-detail")).toContain(
      "Do Not Disturb access",
    );
  });

  test("turned off in the phone's settings: why, and the button that opens them", async () => {
    mockCritical.current = {
      ...mockCritical.current,
      offInPhoneSettings: {
        title: "Off in iOS Settings.",
        message:
          "On-call pages will not ring through silent mode or Do Not Disturb. Turn on Critical Alerts under Notifications.",
        place: CriticalAlertSettingsPlace.IosAppSettings,
        tone: "warning",
      },
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-critical_alerts-detail")).toContain(
      "Off in iOS Settings.",
    );

    await fireEvent.press(
      screen.getByTestId("get-ready-step-critical_alerts-action"),
    );

    expect(mockOpenPhoneSettings).toHaveBeenCalledTimes(1);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  test("an app the App Store has to update: no button to a switch that is not there", async () => {
    mockCritical.current = {
      ...mockCritical.current,
      offInPhoneSettings: {
        title: "This version of the app cannot receive critical alerts.",
        message:
          "On-call pages will not ring through silent mode or Do Not Disturb. Update OneUptime On-Call from the App Store.",
        place: CriticalAlertSettingsPlace.AppStore,
        tone: "warning",
      },
    };

    await render(<GetReadyScreen />);

    expect(
      screen.queryByTestId("get-ready-step-critical_alerts-action"),
    ).toBeNull();
  });

  test("a phone that cannot ring through is said so, and not counted", async () => {
    mockCritical.current = {
      ...mockCritical.current,
      isSupported: false,
      statusMessage:
        "Critical alerts are only available on a physical iOS or Android device.",
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-critical_alerts-detail")).toBe(
      GET_READY_TEXT.unavailable,
    );
    expect(screen.getByText("1 of 2 done")).toBeTruthy();
  });
});

describe("the test page", () => {
  beforeEach(() => {
    mockNotifications.current = {
      state: NotificationPermissionState.Granted,
      isAsking: false,
    };
    mockCritical.current = {
      ...mockCritical.current,
      isEnabled: true,
      statusMessage:
        "On-call pages will play a sound even when this device is silenced or in Do Not Disturb.",
    };
  });

  test("while it is sent: the button says so, and cannot be pressed twice", async () => {
    mockTestPage.current = { kind: "sending" };

    await render(<GetReadyScreen />);

    expect(
      screen.getByTestId("get-ready-step-test_page-action").props
        .accessibilityState?.disabled,
    ).toBe(true);
  });

  test("while it pages: how to acknowledge it, and the server's line, with no button", async () => {
    mockTestPage.current = {
      kind: "paging",
      executionLogId: "run-1",
      statusMessage: "Paging Ana Lopez.",
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-test_page-detail")).toBe(
      `${GET_READY_TEXT.waiting} Paging Ana Lopez.`,
    );
    expect(screen.queryByTestId("get-ready-step-test_page-action")).toBeNull();
  });

  test("ended unanswered: the server's words, and Send Another", async () => {
    mockTestPage.current = {
      kind: "ended",
      statusMessage: "Test ended: nobody acknowledged it within 15 minutes.",
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-test_page-detail")).toBe(
      "Test ended: nobody acknowledged it within 15 minutes.",
    );

    await fireEvent.press(
      screen.getByTestId("get-ready-step-test_page-action"),
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("not sent: why, and the button again", async () => {
    mockTestPage.current = {
      kind: "failed",
      message: GET_READY_TEXT.noSeverity,
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-step-test_page-detail")).toBe(
      GET_READY_TEXT.noSeverity,
    );
    expect(textOf("get-ready-step-test_page-action")).toBeDefined();
  });

  test("acknowledged: ready, in the server's words; Done puts the screen away with a cheer", async () => {
    mockTestPage.current = {
      kind: "acknowledged",
      statusMessage:
        "Test page acknowledged by Ana Lopez by push notification after 9 seconds.",
    };

    await render(<GetReadyScreen />);

    expect(textOf("get-ready-heading")).toBe(GET_READY_TEXT.readyTitle);
    expect(textOf("get-ready-intro")).toBe(GET_READY_TEXT.readyMessage);
    expect(screen.getByText("3 of 3 done")).toBeTruthy();
    expect(textOf("get-ready-step-test_page-detail")).toBe(
      "Test page acknowledged by Ana Lopez by push notification after 9 seconds.",
    );
    // No step has anything left to press.
    for (const step of ["notifications", "critical_alerts", "test_page"]) {
      expect(screen.queryByTestId(`get-ready-step-${step}-action`)).toBeNull();
    }

    await act(async () => {
      fireEvent.press(screen.getByTestId("get-ready-close"));
    });

    expect(screen.getByText(GET_READY_TEXT.done)).toBeTruthy();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("one primary button at a time", () => {
  test("the next step's button is the screen's only primary action; Not Now is quiet", async () => {
    await render(<GetReadyScreen />);

    expect(primaryButtons()).toEqual(["get-ready-step-notifications-action"]);
  });

  test("further on, the next step's", async () => {
    mockNotifications.current = {
      state: NotificationPermissionState.Granted,
      isAsking: false,
    };

    await render(<GetReadyScreen />);

    expect(primaryButtons()).toEqual(["get-ready-step-critical_alerts-action"]);
  });

  test("ready: Done, and nothing else", async () => {
    mockNotifications.current = {
      state: NotificationPermissionState.Granted,
      isAsking: false,
    };
    mockCritical.current = { ...mockCritical.current, isEnabled: true };
    mockTestPage.current = {
      kind: "acknowledged",
      statusMessage: GET_READY_TEXT.acknowledgedBefore,
    };

    await render(<GetReadyScreen />);

    expect(primaryButtons()).toEqual(["get-ready-close"]);
  });
});
