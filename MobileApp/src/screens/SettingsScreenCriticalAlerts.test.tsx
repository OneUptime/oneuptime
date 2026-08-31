import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import SettingsScreen from "./SettingsScreen";
import type { CriticalAlertsState } from "../hooks/useCriticalAlerts";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The settings screen is where a responder decides to be woken. Two things
 * about it are worth a test rather than a glance:
 *
 *   - the switch must not be OFFERED where the OS cannot honour it. A toggle
 *     that flips and does nothing is worse than no toggle, because the
 *     responder walks away believing they are covered.
 *   - the error text must be SHOWN. On Android it is not a failure message at
 *     all - it is the instruction that tells the responder they still have to
 *     grant Do Not Disturb access. Hiding it strands them on a switch that
 *     will not stay on with no explanation anywhere.
 *
 * The hook itself is covered in useCriticalAlerts.test.tsx; here it is a
 * stand-in whose state each test sets, so the screen's rendering decisions can
 * be driven directly. The `mock` prefix is what lets jest.mock's factory reach
 * it despite hoisting.
 */

const mockCriticalAlertsState: { current: CriticalAlertsState } = {
  current: {} as CriticalAlertsState,
};

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

function stateWith(
  overrides: Partial<CriticalAlertsState> = {},
): CriticalAlertsState {
  return {
    isSupported: true,
    isPermissionGranted: true,
    isEnabled: false,
    isBusy: false,
    error: "",
    statusMessage: "On-call pages will play a sound even when silenced.",
    setEnabled: jest.fn(async () => {
      return undefined;
    }) as unknown as (enabled: boolean) => Promise<void>,
    refresh: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

describe("The critical alerts setting is offered where it can work", () => {
  beforeEach(() => {
    mockCriticalAlertsState.current = stateWith();
  });

  test("the row is shown on a supported device", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Critical On-Call Alerts")).toBeTruthy();
    });
  });

  test("it explains that only on-call pages override silent mode", async () => {
    /*
     * The scope matters. A responder who thinks every OneUptime notification
     * will now ring through Do Not Disturb turns the whole app's notifications
     * off instead.
     */
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/Only urgent on-call notifications override/i),
      ).toBeTruthy();
    });
  });

  test("the row sits under a Notifications heading", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeTruthy();
    });
  });
});

describe("The setting is hidden where the OS cannot honour it", () => {
  beforeEach(() => {
    mockCriticalAlertsState.current = stateWith({ isSupported: false });
  });

  test("no row is rendered on an unsupported device", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.queryByText("Critical On-Call Alerts")).toBeNull();
    });
  });

  test("the Notifications section disappears with it", async () => {
    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.queryByText("Notifications")).toBeNull();
    });
  });
});

describe("What the responder is told", () => {
  test("an error is shown verbatim, because it is the instruction", async () => {
    mockCriticalAlertsState.current = stateWith({
      error:
        "Android has not granted Do Not Disturb access to this app. Allow it in Settings.",
    });

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/Do Not Disturb access to this app/i),
      ).toBeTruthy();
    });
  });

  test("the confirmation is shown once the setting is actually on", async () => {
    mockCriticalAlertsState.current = stateWith({
      isEnabled: true,
      statusMessage: "On-call pages will play a sound even when silenced.",
    });

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/play a sound even when silenced/i)).toBeTruthy();
    });
  });

  test("no confirmation is shown while the setting is off", async () => {
    mockCriticalAlertsState.current = stateWith({
      isEnabled: false,
      statusMessage: "On-call pages will play a sound even when silenced.",
    });

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.queryByText(/play a sound even when silenced/i)).toBeNull();
    });
  });

  test("an error takes precedence over the confirmation", async () => {
    mockCriticalAlertsState.current = stateWith({
      isEnabled: true,
      error: "Could not save this setting.",
      statusMessage: "On-call pages will play a sound even when silenced.",
    });

    await render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Could not save this setting.")).toBeTruthy();
      expect(screen.queryByText(/play a sound even when silenced/i)).toBeNull();
    });
  });
});

describe("Toggling the switch", () => {
  test("asks the hook to turn the setting on", async () => {
    const setEnabled: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    mockCriticalAlertsState.current = stateWith({
      setEnabled: setEnabled as unknown as (enabled: boolean) => Promise<void>,
    });

    await render(<SettingsScreen />);

    const toggle: unknown = await waitFor(() => {
      return screen.getByRole("switch");
    });

    fireEvent(toggle as never, "valueChange", true);

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith(true);
    });
  });

  test("the switch is disabled while a change is in flight", async () => {
    mockCriticalAlertsState.current = stateWith({ isBusy: true });

    await render(<SettingsScreen />);

    const toggle: { props: { disabled?: boolean } } = (await waitFor(() => {
      return screen.getByRole("switch");
    })) as unknown as { props: { disabled?: boolean } };

    expect(toggle.props.disabled).toBe(true);
  });
});
