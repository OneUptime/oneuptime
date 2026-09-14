import React from "react";
import { Alert, Appearance, type AlertButton } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import SettingsScreen from "./SettingsScreen";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";

const mockNavigate: jest.Mock = jest.fn();
const mockLogout: jest.Mock = jest.fn();
const mockSetBiometric: jest.Mock = jest.fn();
const mockSetCriticalAlerts: jest.Mock = jest.fn();
const mockSelectionFeedback: jest.Mock = jest.fn();
const mockGetServerUrl: jest.Mock = jest.fn();

interface MockUser {
  name?: string;
  email?: string;
}

const DEFAULT_USER: MockUser = {
  name: "Alex Morgan",
  email: "alex@example.test",
};

const mockAuth: { user: MockUser | null } = { user: DEFAULT_USER };
const mockBiometric: { isAvailable: boolean; isEnabled: boolean } = {
  isAvailable: true,
  isEnabled: false,
};
const mockCriticalAlerts: {
  isSupported: boolean;
  isEnabled: boolean;
  isBusy: boolean;
  error: string;
  statusMessage: string;
} = {
  isSupported: true,
  isEnabled: false,
  isBusy: false,
  error: "",
  statusMessage: "",
};
const mockCalendarFeed: { isAvailable: boolean } = { isAvailable: true };
let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead (as in ThemeContext.test).
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
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
jest.mock("../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return { logout: mockLogout, user: mockAuth.user };
    },
  };
});
jest.mock("../hooks/useBiometric", () => {
  return {
    useBiometric: () => {
      return { ...mockBiometric, setEnabled: mockSetBiometric };
    },
  };
});
jest.mock("../hooks/useCriticalAlerts", () => {
  return {
    useCriticalAlerts: () => {
      return { ...mockCriticalAlerts, setEnabled: mockSetCriticalAlerts };
    },
  };
});
jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return { selectionFeedback: mockSelectionFeedback };
    },
  };
});
jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return mockCalendarFeed;
    },
  };
});
jest.mock("../storage/serverUrl", () => {
  return {
    getServerUrl: () => {
      return mockGetServerUrl();
    },
  };
});
jest.mock("expo-constants", () => {
  return { __esModule: true, default: { expoConfig: { version: "2.7.0" } } };
});

type Element = ReturnType<typeof screen.getByTestId>;

let setColorScheme: jest.SpyInstance | null = null;

beforeEach(async () => {
  mockAuth.user = DEFAULT_USER;
  mockBiometric.isAvailable = true;
  mockBiometric.isEnabled = false;
  mockCriticalAlerts.isSupported = true;
  mockCriticalAlerts.isEnabled = false;
  mockCriticalAlerts.isBusy = false;
  mockCriticalAlerts.error = "";
  mockCriticalAlerts.statusMessage = "";
  mockCalendarFeed.isAvailable = true;
  mockSystemScheme = "light";
  mockGetServerUrl.mockReset();
  mockGetServerUrl.mockResolvedValue("https://team.example.com");
  await AsyncStorage.clear();
  /*
   * The provider mirrors an explicit choice into the native Appearance API,
   * which has no implementation off-device.
   */
  setColorScheme = jest
    .spyOn(Appearance, "setColorScheme")
    .mockImplementation(() => {
      return undefined;
    });
});

afterEach(() => {
  setColorScheme?.mockRestore();
  setColorScheme = null;
});

async function renderInTheme(): Promise<Awaited<ReturnType<typeof render>>> {
  return render(
    <ThemeProvider>
      <SettingsScreen />
    </ThemeProvider>,
  );
}

function textOf(element: Element): string {
  const children: unknown = element.props.children;
  return Array.isArray(children) ? children.join("") : String(children);
}

/* iOS renders RCTSwitch and Android AndroidSwitch; they name colours differently. */
function switchColors(element: Element): {
  thumb: string;
  trackOff: string;
  trackOn: string;
} {
  return {
    thumb: element.props.thumbTintColor,
    trackOff: element.props.tintColor ?? element.props.trackColorForFalse,
    trackOn: element.props.onTintColor ?? element.props.trackColorForTrue,
  };
}

test("project management opens directly from its labeled row", async () => {
  await render(<SettingsScreen />);
  await fireEvent.press(
    screen.getByRole("button", { name: "Manage Projects" }),
  );
  expect(mockNavigate).toHaveBeenCalledWith("ProjectsList");
});

test("makes account identity distinct from grouped project and server settings", async () => {
  await render(<SettingsScreen />);
  const account: ReturnType<typeof within> = within(
    screen.getByTestId("settings-account-identity"),
  );
  expect(account.getByText("Alex Morgan")).toBeTruthy();
  expect(account.getByText("alex@example.test").props.selectable).toBe(true);
  const workspace: ReturnType<typeof within> = within(
    screen.getByTestId("settings-workspace-section"),
  );
  expect(
    workspace.getByRole("button", { name: "Manage Projects" }),
  ).toBeTruthy();
  expect(workspace.getByText("Server URL")).toBeTruthy();
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

describe("The account card", () => {
  function avatar(): Element {
    return screen.getByTestId("settings-account-avatar", {
      includeHiddenElements: true,
    });
  }

  test("shows the initials of the first and last name on a filled avatar", async () => {
    await render(<SettingsScreen />);

    const initials: Element = within(avatar()).getByText("AM", {
      includeHiddenElements: true,
    });
    expect(avatar()).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
      borderRadius: 28,
    });
    expect(initials).toHaveStyle({ color: lightColors.textInverse });
  });

  test("keeps the initials out of the screen reader, which reads the name instead", async () => {
    await render(<SettingsScreen />);

    expect(avatar().props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    expect(avatar().props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByText("AM")).toBeNull();
  });

  test("uses the first and last of several names", async () => {
    mockAuth.user = { name: "Mary Jane Watson", email: "mj@example.test" };
    await render(<SettingsScreen />);

    expect(
      within(avatar()).getByText("MW", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  test("uses one letter for a one-word name", async () => {
    mockAuth.user = { name: "  alex  ", email: "alex@example.test" };
    await render(<SettingsScreen />);

    expect(
      within(avatar()).getByText("A", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  test("skips leading punctuation in a name", async () => {
    mockAuth.user = { name: "(Ops) team", email: "ops@example.test" };
    await render(<SettingsScreen />);

    expect(
      within(avatar()).getByText("OT", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  test("falls back to the email's local part when there is no name", async () => {
    mockAuth.user = { name: "", email: "jordan.lee@example.test" };
    await render(<SettingsScreen />);

    const account: ReturnType<typeof within> = within(
      screen.getByTestId("settings-account-identity"),
    );
    expect(account.getByText("Your account")).toBeTruthy();
    expect(account.getByText("jordan.lee@example.test")).toBeTruthy();
    expect(
      within(avatar()).getByText("JL", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  test("shows a person icon and neutral copy when the user is not known yet", async () => {
    mockAuth.user = null;
    await render(<SettingsScreen />);

    const account: ReturnType<typeof within> = within(
      screen.getByTestId("settings-account-identity"),
    );
    expect(account.getByText("Your account")).toBeTruthy();
    expect(account.getByText("Signed in to OneUptime")).toBeTruthy();
    expect(
      within(avatar()).queryByText(/^[A-Z]{1,2}$/, {
        includeHiddenElements: true,
      }),
    ).toBeNull();
  });

  test("sits on a card surface from the theme", async () => {
    await render(<SettingsScreen />);

    expect(screen.getByTestId("settings-account-identity")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
    });
  });
});

describe("Settings groups", () => {
  function headers(): Array<string> {
    return screen.getAllByRole("header").map(textOf);
  }

  test("every group is offered, in order, when the device supports it all", async () => {
    await render(<SettingsScreen />);

    expect(headers()).toEqual([
      "Settings",
      "Workspace",
      "Appearance",
      "Notifications",
      "Security",
      "On-Call",
      "Account",
    ]);
  });

  test("Security disappears on a device without biometrics", async () => {
    mockBiometric.isAvailable = false;
    await render(<SettingsScreen />);

    expect(headers()).not.toContain("Security");
    expect(screen.queryByLabelText("Biometrics Login")).toBeNull();
    expect(screen.queryByTestId("settings-section-security")).toBeNull();
  });

  test("Notifications disappears where critical alerts cannot work", async () => {
    mockCriticalAlerts.isSupported = false;
    await render(<SettingsScreen />);

    expect(headers()).not.toContain("Notifications");
    expect(screen.queryByTestId("settings-section-notifications")).toBeNull();
    expect(screen.queryByLabelText("Critical On-Call Alerts")).toBeNull();
  });

  test("On-Call disappears on a server without calendar feeds", async () => {
    mockCalendarFeed.isAvailable = false;
    await render(<SettingsScreen />);

    expect(headers()).not.toContain("On-Call");
    expect(screen.queryByTestId("settings-row-calendar-feed")).toBeNull();
  });

  test("Workspace, Appearance and Account are always there", async () => {
    mockBiometric.isAvailable = false;
    mockCriticalAlerts.isSupported = false;
    mockCalendarFeed.isAvailable = false;
    await render(<SettingsScreen />);

    expect(headers()).toEqual([
      "Settings",
      "Workspace",
      "Appearance",
      "Account",
    ]);
  });

  test("the calendar feed row opens its screen", async () => {
    await render(<SettingsScreen />);

    await fireEvent.press(
      within(screen.getByTestId("settings-section-oncall")).getByRole(
        "button",
        { name: "Calendar feed" },
      ),
    );

    expect(mockNavigate).toHaveBeenCalledWith("OnCallCalendarFeed");
  });

  test("the server address shows a placeholder until it has been read, and can be selected", async () => {
    let release: (url: string) => void = (): void => {
      return undefined;
    };
    mockGetServerUrl.mockReturnValue(
      new Promise<string>((resolve: (url: string) => void): void => {
        release = resolve;
      }),
    );
    await render(<SettingsScreen />);

    expect(screen.getByText("Loading server…")).toBeTruthy();
    expect(screen.getByText("Loading server…").props.selectable).toBe(true);

    await act(async (): Promise<void> => {
      release("https://late.example.com");
      await Promise.resolve();
    });

    expect(await screen.findByText("https://late.example.com")).toBeTruthy();
    expect(screen.queryByText("Loading server…")).toBeNull();
    expect(screen.getByText("https://late.example.com").props.selectable).toBe(
      true,
    );
  });

  test("the footer credits the community under the version", async () => {
    await render(<SettingsScreen />);

    expect(
      within(screen.getByTestId("settings-footer")).getByText(
        "Built with care by the open source community.",
      ),
    ).toBeTruthy();
  });
});

describe("Logging out", () => {
  test("is styled as destructive and explains what it does", async () => {
    await render(<SettingsScreen />);

    const account: ReturnType<typeof within> = within(
      screen.getByTestId("settings-section-account"),
    );
    expect(account.getByText("Log Out")).toHaveStyle({
      color: lightColors.actionDestructive,
    });
    expect(
      account.getByRole("button", { name: "Log Out" }).props.accessibilityHint,
    ).toBe("Sign out of this device.");
  });

  test("the confirmation says what will happen", async () => {
    const alert: jest.SpyInstance = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => {
        return undefined;
      });
    try {
      await render(<SettingsScreen />);
      await fireEvent.press(screen.getByRole("button", { name: "Log Out" }));

      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0]?.[0]).toBe("Log out of OneUptime?");
      expect(alert.mock.calls[0]?.[1]).toBe(
        "You will need to sign in again to access your workspace.",
      );
      const buttons: Array<AlertButton> = alert.mock.calls[0]?.[2];
      expect(
        buttons.find((button: AlertButton) => {
          return button.text === "Log Out";
        })?.style,
      ).toBe("destructive");
    } finally {
      alert.mockRestore();
    }
  });

  test("cancelling the confirmation keeps the session", async () => {
    const alert: jest.SpyInstance = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => {
        return undefined;
      });
    try {
      await render(<SettingsScreen />);
      await fireEvent.press(screen.getByRole("button", { name: "Log Out" }));

      const buttons: Array<AlertButton> = alert.mock.calls[0]?.[2];
      buttons
        .find((button: AlertButton) => {
          return button.text === "Cancel";
        })
        ?.onPress?.();

      expect(mockLogout).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
});

describe("Switches", () => {
  test("take their off colours from the light palette", async () => {
    await render(<SettingsScreen />);

    expect(switchColors(screen.getByLabelText("Biometrics Login"))).toEqual({
      thumb: lightColors.backgroundElevated,
      trackOff: lightColors.borderDefault,
      trackOn: lightColors.actionPrimary,
    });
  });

  test("use the filled-control label colour for the thumb when on", async () => {
    mockBiometric.isEnabled = true;
    mockCriticalAlerts.isEnabled = true;
    await render(<SettingsScreen />);

    expect(switchColors(screen.getByLabelText("Biometrics Login")).thumb).toBe(
      lightColors.textInverse,
    );
    expect(
      switchColors(screen.getByLabelText("Critical On-Call Alerts")).thumb,
    ).toBe(lightColors.textInverse);
  });

  test("follow the dark palette in dark mode", async () => {
    mockSystemScheme = "dark";
    await renderInTheme();

    expect(switchColors(screen.getByLabelText("Biometrics Login"))).toEqual({
      thumb: darkColors.textSecondary,
      trackOff: darkColors.borderDefault,
      trackOn: darkColors.actionPrimary,
    });
  });

  test("turning biometrics on gives haptic confirmation, turning it off does not", async () => {
    await render(<SettingsScreen />);

    await fireEvent(
      screen.getByLabelText("Biometrics Login"),
      "valueChange",
      true,
    );
    expect(mockSelectionFeedback).toHaveBeenCalledTimes(1);

    await fireEvent(
      screen.getByLabelText("Biometrics Login"),
      "valueChange",
      false,
    );
    expect(mockSetBiometric).toHaveBeenLastCalledWith(false);
    expect(mockSelectionFeedback).toHaveBeenCalledTimes(1);
  });
});

describe("Critical alert status under the Notifications group", () => {
  test("an error is a danger-toned alert footnote", async () => {
    mockCriticalAlerts.error = "Allow Do Not Disturb access in Settings.";
    await render(<SettingsScreen />);

    const footnote: ReturnType<typeof within> = within(
      screen.getByTestId("settings-critical-alerts-error"),
    );
    const message: Element = footnote.getByRole("alert", {
      name: "Allow Do Not Disturb access in Settings.",
    });
    expect(message).toHaveStyle({
      color: lightColors.statusError,
      fontSize: 13,
    });
    expect(message.props.accessibilityLiveRegion).toBe("polite");
  });

  test("a confirmation is a success-toned footnote once the setting is on", async () => {
    mockCriticalAlerts.isEnabled = true;
    mockCriticalAlerts.statusMessage = "Pages will ring through silent mode.";
    await render(<SettingsScreen />);

    const footnote: Element = within(
      screen.getByTestId("settings-critical-alerts-status"),
    ).getByText("Pages will ring through silent mode.");
    expect(footnote).toHaveStyle({ color: lightColors.statusSuccess });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the footnote sits inside the Notifications section, after the group", async () => {
    mockCriticalAlerts.error = "Could not save this setting.";
    await render(<SettingsScreen />);

    expect(
      within(screen.getByTestId("settings-section-notifications")).getByText(
        "Could not save this setting.",
      ),
    ).toBeTruthy();
  });

  test("nothing is shown while the setting is off and healthy", async () => {
    mockCriticalAlerts.statusMessage = "Pages will ring through silent mode.";
    await render(<SettingsScreen />);

    expect(screen.queryByTestId("settings-critical-alerts-error")).toBeNull();
    expect(screen.queryByTestId("settings-critical-alerts-status")).toBeNull();
  });
});

describe("Appearance", () => {
  function radio(name: string): Element {
    return screen.getByRole("radio", { name });
  }

  function checkedStates(): Record<string, boolean> {
    return {
      System: radio("System").props.accessibilityState.checked,
      Light: radio("Light").props.accessibilityState.checked,
      Dark: radio("Dark").props.accessibilityState.checked,
    };
  }

  test("offers System, Light and Dark as a labelled radio group", async () => {
    await renderInTheme();

    const group: Element = screen.getByTestId("settings-appearance");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    expect(group.props.accessibilityLabel).toBe("Appearance");
    expect(
      within(screen.getByTestId("settings-section-appearance"))
        .getAllByRole("radio")
        .map((element: Element) => {
          return element.props.accessibilityLabel;
        }),
    ).toEqual(["System", "Light", "Dark"]);
    expect(radio("System").props.accessibilityHint).toBe(
      "Match your device's light or dark setting.",
    );
    expect(
      screen.getByRole("radio", { name: "Dark", checked: false }),
    ).toBeTruthy();
  });

  test("follows the system by default", async () => {
    await renderInTheme();

    expect(checkedStates()).toEqual({
      System: true,
      Light: false,
      Dark: false,
    });
    expect(
      screen.getByText("System follows your device's light or dark setting."),
    ).toBeTruthy();
  });

  test("renders a saved choice as selected", async () => {
    await AsyncStorage.setItem("oneuptime_appearance", "dark");
    await renderInTheme();

    await waitFor(() => {
      expect(checkedStates()).toEqual({
        System: false,
        Light: false,
        Dark: true,
      });
    });
    expect(screen.getByTestId("settings-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
  });

  test("choosing Dark switches the palette, selects it and saves it", async () => {
    await renderInTheme();

    await fireEvent.press(radio("Dark"));

    expect(checkedStates()).toEqual({
      System: false,
      Light: false,
      Dark: true,
    });
    expect(
      screen.getByRole("radio", { name: "Dark", checked: true }),
    ).toBeTruthy();
    expect(screen.getByTestId("settings-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
    expect(setColorScheme).toHaveBeenCalledWith("dark");
    expect(mockSelectionFeedback).toHaveBeenCalledTimes(1);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("oneuptime_appearance")).toBe("dark");
    });
  });

  test("choosing Light overrides a dark device", async () => {
    mockSystemScheme = "dark";
    await renderInTheme();
    expect(screen.getByTestId("settings-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });

    await fireEvent.press(radio("Light"));

    expect(checkedStates()).toEqual({
      System: false,
      Light: true,
      Dark: false,
    });
    expect(screen.getByTestId("settings-scroll")).toHaveStyle({
      backgroundColor: lightColors.backgroundPrimary,
    });
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("oneuptime_appearance")).toBe("light");
    });
  });

  test("choosing System again follows the device and forgets the override", async () => {
    mockSystemScheme = "dark";
    await AsyncStorage.setItem("oneuptime_appearance", "light");
    await renderInTheme();
    await waitFor(() => {
      expect(checkedStates().Light).toBe(true);
    });

    await fireEvent.press(radio("System"));

    expect(checkedStates()).toEqual({
      System: true,
      Light: false,
      Dark: false,
    });
    expect(screen.getByTestId("settings-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
    expect(setColorScheme).toHaveBeenLastCalledWith("unspecified");
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("oneuptime_appearance")).toBeNull();
    });
  });

  test("the choice survives the screen being closed and opened again", async () => {
    const first: Awaited<ReturnType<typeof render>> = await renderInTheme();
    await fireEvent.press(radio("Dark"));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("oneuptime_appearance")).toBe("dark");
    });
    await first.unmount();

    await renderInTheme();

    await waitFor(() => {
      expect(checkedStates()).toEqual({
        System: false,
        Light: false,
        Dark: true,
      });
    });
  });

  test("tapping the option that is already selected changes nothing", async () => {
    await renderInTheme();
    setColorScheme?.mockClear();

    await fireEvent.press(radio("System"));

    expect(checkedStates().System).toBe(true);
    expect(setColorScheme).not.toHaveBeenCalled();
    expect(mockSelectionFeedback).not.toHaveBeenCalled();
  });

  test("the selected option is outlined in the action colour of the current palette", async () => {
    await renderInTheme();

    expect(screen.getByTestId("settings-appearance-system")).toHaveStyle({
      borderColor: lightColors.actionPrimary,
      backgroundColor: lightColors.cardAccent,
    });
    expect(screen.getByTestId("settings-appearance-dark")).toHaveStyle({
      borderColor: lightColors.borderSubtle,
      backgroundColor: lightColors.backgroundElevated,
    });

    await fireEvent.press(radio("Dark"));

    expect(screen.getByTestId("settings-appearance-dark")).toHaveStyle({
      borderColor: darkColors.actionPrimary,
      backgroundColor: darkColors.cardAccent,
    });
    expect(screen.getByTestId("settings-appearance-system")).toHaveStyle({
      borderColor: darkColors.borderSubtle,
      backgroundColor: darkColors.backgroundElevated,
    });
  });

  test("the option labels change weight and colour with selection", async () => {
    await renderInTheme();

    expect(
      within(screen.getByTestId("settings-appearance-system")).getByText(
        "System",
      ),
    ).toHaveStyle({ color: lightColors.actionPrimary, fontWeight: "700" });
    expect(
      within(screen.getByTestId("settings-appearance-light")).getByText(
        "Light",
      ),
    ).toHaveStyle({ color: lightColors.textPrimary, fontWeight: "500" });
  });

  test("a dark device paints the whole screen from the dark palette", async () => {
    mockSystemScheme = "dark";
    await renderInTheme();

    expect(screen.getByTestId("settings-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
    expect(screen.getByTestId("settings-account-identity")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
    expect(
      within(screen.getByTestId("settings-account-identity")).getByText(
        "Alex Morgan",
      ),
    ).toHaveStyle({ color: darkColors.textPrimary });
  });
});
