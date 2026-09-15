import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import Banner from "./Banner";
import type { StatusTone } from "./StatusPill";
import {
  ThemeProvider,
  darkColors,
  lightColors,
  type ColorTokens,
} from "../theme";
import { radius, spacing } from "../theme/tokens";

/*
 * Inline messages: a warning that SSO is locking a project, an error that a
 * refresh failed, a hint that notifications are off. Warnings and errors must
 * be announced, not just tinted; a tappable banner must be one button with a
 * sensible name; and each tone must pick a default icon that says the same
 * thing as its colour.
 */

let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

afterEach(() => {
  mockSystemScheme = "light";
});

type RenderedElement = ReturnType<typeof screen.getByText>;

interface PressHandlers {
  onResponderGrant?: (event: unknown) => void;
  onResponderRelease?: (event: unknown) => void;
}

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

function flat(element: RenderedElement): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props.style) ?? {}) as ViewStyle &
    TextStyle;
}

function touchEvent(): unknown {
  return {
    nativeEvent: {
      touches: [{ pageX: 100, pageY: 200, identifier: 1 }],
      changedTouches: [{ pageX: 100, pageY: 200, identifier: 1 }],
      pageX: 100,
      pageY: 200,
      timestamp: Date.now(),
    },
    currentTarget: 1,
    persist: (): void => {
      return undefined;
    },
  };
}

/** See Card.test.tsx: fireEvent(el, "pressIn") never reaches Pressable. */
async function holdDown(element: RenderedElement): Promise<void> {
  await act(async (): Promise<void> => {
    (element.props as PressHandlers).onResponderGrant?.(touchEvent());
  });
}

async function letGo(element: RenderedElement): Promise<void> {
  await act(async (): Promise<void> => {
    (element.props as PressHandlers).onResponderRelease?.(touchEvent());
  });
}

function noop(): void {
  return undefined;
}

const TONE_TOKENS: Record<
  StatusTone,
  {
    text: keyof ColorTokens;
    background: keyof ColorTokens;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  neutral: {
    text: "textSecondary",
    background: "backgroundTertiary",
    icon: "information-circle",
  },
  info: {
    text: "statusInfo",
    background: "statusInfoBg",
    icon: "information-circle",
  },
  accent: { text: "actionPrimary", background: "cardAccent", icon: "sparkles" },
  success: {
    text: "statusSuccess",
    background: "statusSuccessBg",
    icon: "checkmark-circle",
  },
  warning: {
    text: "statusWarning",
    background: "statusWarningBg",
    icon: "warning",
  },
  danger: {
    text: "statusError",
    background: "statusErrorBg",
    icon: "alert-circle",
  },
};

const TONES: Array<StatusTone> = Object.keys(TONE_TOKENS) as Array<StatusTone>;

describe("What a banner shows", () => {
  test("the message, on a rounded tinted surface", async () => {
    await render(<Banner message="Notifications are off." testID="banner" />);

    expect(screen.getByText("Notifications are off.")).toBeTruthy();
    expect(screen.getByTestId("banner")).toHaveStyle({
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
  });

  test("defaults to the info tone", async () => {
    await render(<Banner message="Heads up" testID="banner" />);

    expect(screen.getByTestId("banner")).toHaveStyle({
      backgroundColor: lightColors.statusInfoBg,
    });
    expect(screen.getByText(glyphFor("information-circle"))).toBeTruthy();
  });

  test.each(TONES)(
    "the %s tone uses its token pair and its own default icon",
    async (tone: StatusTone) => {
      await render(<Banner tone={tone} message="Message" testID="banner" />);

      const { text, background, icon } = TONE_TOKENS[tone];
      expect(screen.getByTestId("banner")).toHaveStyle({
        backgroundColor: lightColors[background],
      });
      expect(screen.getByText("Message")).toHaveStyle({
        color: lightColors[text],
      });
      expect(flat(screen.getByText(glyphFor(icon))).color).toBe(
        lightColors[text],
      );
    },
  );

  test("an explicit icon replaces the tone's default", async () => {
    await render(
      <Banner tone="danger" icon="lock-closed" message="SSO required" />,
    );

    expect(screen.getByText(glyphFor("lock-closed"))).toBeTruthy();
    expect(screen.queryByText(glyphFor("alert-circle"))).toBeNull();
  });

  test("with a title, the title takes the tone colour and the message turns secondary", async () => {
    await render(
      <Banner
        tone="warning"
        title="Sign-in required"
        message="This project uses SSO."
      />,
    );

    expect(screen.getByText("Sign-in required")).toHaveStyle({
      color: lightColors.statusWarning,
      fontWeight: "600",
    });
    expect(screen.getByText("This project uses SSO.")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test("a caller's style is merged after the surface", async () => {
    await render(
      <Banner message="Message" testID="banner" style={{ marginBottom: 20 }} />,
    );

    expect(screen.getByTestId("banner")).toHaveStyle({
      marginBottom: 20,
      borderRadius: radius.lg,
    });
  });
});

describe("What a screen reader is told", () => {
  test.each(["danger", "warning"] as Array<StatusTone>)(
    "a %s banner announces its message as an alert",
    async (tone: StatusTone) => {
      await render(<Banner tone={tone} message="Could not refresh." />);

      expect(
        screen.getByRole("alert", { name: "Could not refresh." }),
      ).toBeTruthy();
    },
  );

  test.each(["neutral", "info", "accent", "success"] as Array<StatusTone>)(
    "a %s banner is not an alert",
    async (tone: StatusTone) => {
      await render(<Banner tone={tone} message="All good." />);

      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  test("a warning with a title still announces the message as the alert", async () => {
    await render(
      <Banner tone="warning" title="Offline" message="Showing cached data." />,
    );

    expect(
      screen.getByRole("alert", { name: "Showing cached data." }),
    ).toBeTruthy();
  });
});

describe("A banner with an action", () => {
  test("shows a named action button that runs onAction", async () => {
    const onAction: jest.Mock = jest.fn();
    await render(
      <Banner
        tone="warning"
        message="Notifications are off."
        actionLabel="Turn on"
        onAction={onAction}
      />,
    );

    const action: RenderedElement = screen.getByRole("button", {
      name: "Turn on",
    });
    expect(screen.getByText("Turn on")).toHaveStyle({
      color: lightColors.statusWarning,
      fontWeight: "700",
    });
    await fireEvent.press(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test("the action keeps a usable touch height and hit slop", async () => {
    await render(
      <Banner message="Message" actionLabel="Retry" onAction={noop} />,
    );

    const action: RenderedElement = screen.getByRole("button", {
      name: "Retry",
    });
    expect(Number(flat(action).minHeight)).toBeGreaterThanOrEqual(36);
    expect(action.props.hitSlop).toBe(8);
  });

  test("no action without both a label and a handler", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <Banner message="Message" actionLabel="Retry" />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
    await view.unmount();

    await render(<Banner message="Message" onAction={noop} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("A tappable banner", () => {
  test("is one button named from its title and message", async () => {
    await render(
      <Banner
        tone="accent"
        title="New on-call shift"
        message="Starts at 18:00."
        onPress={noop}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "New on-call shift. Starts at 18:00.",
      }),
    ).toBeTruthy();
  });

  test("without a title its name is the message alone", async () => {
    await render(<Banner message="Open settings" onPress={noop} />);

    expect(screen.getByRole("button", { name: "Open settings" })).toBeTruthy();
  });

  test("an explicit label wins", async () => {
    await render(
      <Banner
        message="Open settings"
        accessibilityLabel="Notification settings"
        onPress={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Notification settings" }),
    ).toBeTruthy();
  });

  test("pressing it runs onPress", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(<Banner message="Open settings" onPress={onPress} />);

    await fireEvent.press(screen.getByRole("button"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("shows a chevron in the tone colour", async () => {
    await render(<Banner tone="danger" message="Open" onPress={noop} />);

    expect(flat(screen.getByText(glyphFor("chevron-forward"))).color).toBe(
      lightColors.statusError,
    );
  });

  test("a static banner has no chevron", async () => {
    await render(<Banner tone="danger" message="Static" />);

    expect(screen.queryByText(glyphFor("chevron-forward"))).toBeNull();
  });

  test("a tappable danger banner is a button rather than a nested alert", async () => {
    /*
     * The whole surface is one accessibility element, so an alert role on the
     * text inside it would never be reached separately.
     */
    await render(<Banner tone="danger" message="Open" onPress={noop} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });

  test("dims while held and recovers after release, keeping its surface", async () => {
    await render(
      <Banner tone="info" message="Open" onPress={noop} testID="banner" />,
    );
    const banner: RenderedElement = screen.getByTestId("banner");

    expect(banner).toHaveStyle({
      opacity: 1,
      backgroundColor: lightColors.statusInfoBg,
    });

    await holdDown(banner);
    expect(banner).toHaveStyle({
      opacity: 0.8,
      backgroundColor: lightColors.statusInfoBg,
      borderRadius: radius.lg,
    });

    await letGo(banner);
    await waitFor(() => {
      expect(screen.getByTestId("banner")).toHaveStyle({ opacity: 1 });
    });
  });
});

describe("In dark mode", () => {
  test.each(TONES)(
    "the %s tone uses its dark token pair",
    async (tone: StatusTone) => {
      mockSystemScheme = "dark";
      await render(
        <ThemeProvider>
          <Banner tone={tone} message="Message" testID="banner" />
        </ThemeProvider>,
      );

      const { text, background, icon } = TONE_TOKENS[tone];
      expect(screen.getByTestId("banner")).toHaveStyle({
        backgroundColor: darkColors[background],
      });
      expect(screen.getByText("Message")).toHaveStyle({
        color: darkColors[text],
      });
      expect(flat(screen.getByText(glyphFor(icon))).color).toBe(
        darkColors[text],
      );
    },
  );
});
