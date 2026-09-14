import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import GradientButton, { type ButtonVariant } from "./GradientButton";
import {
  ThemeProvider,
  darkColors,
  lightColors,
  type ColorTokens,
} from "../theme";
import { radius, typography } from "../theme/tokens";

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

/*
 * The primary action on the login, backup-code and home screens - the button a
 * responder presses and then waits on.
 *
 * The waiting is the interesting part. While `loading` the label is replaced
 * by a spinner, and a spinner has no text, so the button's accessible NAME
 * disappears at the exact moment the user is most likely to ask what is
 * happening: they press "Sign In", the screen goes quiet, they swipe back to
 * the control and hear "button" with nothing after it. The tests below hold
 * the name in place across every state, and hold the press closed while the
 * button is busy or disabled - a second submit is a second login attempt, a
 * second set of backup codes, a second page.
 */

type Rendered = ReturnType<typeof screen.getByText>;

interface PressHandlers {
  onResponderGrant?: (event: unknown) => void;
  onResponderRelease?: (event: unknown) => void;
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

/**
 * Hold a finger on the button without lifting it. `fireEvent(el, "pressIn")`
 * cannot: Pressable never hands an onPressIn prop to its host view, so the
 * pressed style would never render. The responder handler is what the touch
 * system calls.
 */
async function holdDown(element: Rendered): Promise<void> {
  await act(async (): Promise<void> => {
    (element.props as PressHandlers).onResponderGrant?.(touchEvent());
  });
}

async function letGo(element: Rendered): Promise<void> {
  await act(async (): Promise<void> => {
    (element.props as PressHandlers).onResponderRelease?.(touchEvent());
  });
}

function flat(element: Rendered): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props.style) ?? {}) as ViewStyle &
    TextStyle;
}

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

interface VariantTokens {
  background: keyof ColorTokens | "transparent";
  pressed: keyof ColorTokens;
  content: keyof ColorTokens;
  border?: keyof ColorTokens;
}

/*
 * The design system's button contract, written as token NAMES so the same
 * table checks the light and the dark palette.
 */
const VARIANTS: Record<ButtonVariant, VariantTokens> = {
  primary: {
    background: "actionPrimary",
    pressed: "actionPrimaryPressed",
    content: "textInverse",
  },
  secondary: {
    background: "backgroundElevated",
    pressed: "backgroundTertiary",
    content: "textPrimary",
    border: "borderDefault",
  },
  tonal: {
    background: "cardAccent",
    pressed: "backgroundTertiary",
    content: "actionPrimary",
  },
  destructive: {
    background: "actionDestructive",
    pressed: "actionDestructivePressed",
    content: "textInverse",
  },
  ghost: {
    background: "transparent",
    pressed: "backgroundTertiary",
    content: "actionPrimary",
  },
};

const VARIANT_NAMES: Array<ButtonVariant> = Object.keys(
  VARIANTS,
) as Array<ButtonVariant>;

function tokenValue(
  colors: ColorTokens,
  token: keyof ColorTokens | "transparent",
): string {
  return token === "transparent" ? "transparent" : colors[token];
}

/**
 * The spinner has no text and no label, so there is nothing to query it by
 * except the host element React Native renders it as.
 */
function spinnerCount(): number {
  return screen.container.queryAll((node: Rendered) => {
    return node.type === "ActivityIndicator";
  }).length;
}

describe("The ordinary button", () => {
  test("shows its label", async () => {
    await render(<GradientButton label="Sign In" onPress={jest.fn()} />);

    expect(screen.getByText("Sign In")).toBeTruthy();
  });

  test("is a button with that label as its name", async () => {
    await render(<GradientButton label="Sign In" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  test("pressing it runs the action once", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<GradientButton label="Sign In" onPress={onPress} />);

    await fireEvent.press(screen.getByRole("button", { name: "Sign In" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("shows no spinner while it is idle", async () => {
    await render(<GradientButton label="Sign In" onPress={jest.fn()} />);

    expect(spinnerCount()).toBe(0);
  });

  test("an icon is not read out as part of the name", async () => {
    /*
     * Ionicons renders its glyph as a Text node holding a private-use
     * character. Left to compose its name from its children, the button is
     * announced as that character followed by the label - a screen reader
     * says something unpronounceable and then "Sign In".
     */
    await render(
      <GradientButton
        label="Sign In"
        icon="log-in-outline"
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
    expect(screen.getByText("Sign In")).toBeTruthy();
  });

  test("a testID is carried through, for the callers whose label changes", async () => {
    await render(
      <GradientButton
        label="Generate Backup Codes"
        testID="generate-backup-codes"
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByTestId("generate-backup-codes")).toBeTruthy();
  });
});

describe("While the action is in flight", () => {
  test.each(["primary", "secondary"] as const)(
    "%s exposes matching web and native asynchronous state",
    async (variant: "primary" | "secondary") => {
      await render(
        <GradientButton
          label="Continue"
          variant={variant}
          loading
          onPress={jest.fn()}
        />,
      );
      const control: ReturnType<typeof screen.getByRole> = screen.getByRole(
        "button",
        { name: "Continue" },
      );
      expect(control).toBeDisabled();
      expect(control).toBeBusy();
      expect(control.props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      });
    },
  );

  test("the spinner replaces the label on screen", async () => {
    await render(
      <GradientButton label="Sign In" loading={true} onPress={jest.fn()} />,
    );

    expect(spinnerCount()).toBe(1);
    expect(screen.queryByText("Sign In")).toBeNull();
  });

  test("but the button keeps its name", async () => {
    /*
     * The regression this guards. With the label gone from the tree there is
     * nothing left for a screen reader to read out, and the control the user
     * is waiting on becomes an unlabelled button - findable here only because
     * the name is stated on the Pressable rather than left to its children.
     */
    await render(
      <GradientButton label="Sign In" loading={true} onPress={jest.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  test("and it cannot be pressed again", async () => {
    /*
     * A second press is a second login attempt, or a second set of backup
     * codes that invalidates the set the user is looking at.
     */
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton label="Sign In" loading={true} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign In" }));

    expect(onPress).not.toHaveBeenCalled();
  });

  test("it is announced as disabled while it is busy", async () => {
    await render(
      <GradientButton label="Sign In" loading={true} onPress={jest.fn()} />,
    );

    expect(
      screen.getByRole("button", { name: "Sign In", disabled: true }),
    ).toBeTruthy();
  });
});

describe("When the button is disabled", () => {
  test("it still shows and is still named", async () => {
    await render(
      <GradientButton label="Continue" disabled={true} onPress={jest.fn()} />,
    );

    expect(screen.getByText("Continue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  test("it is announced as disabled rather than merely dimmed", async () => {
    /*
     * The visual signal is opacity, which no screen reader reports.
     */
    await render(
      <GradientButton label="Continue" disabled={true} onPress={jest.fn()} />,
    );

    expect(
      screen.getByRole("button", { name: "Continue", disabled: true }),
    ).toBeTruthy();
  });

  test("pressing it does nothing", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton label="Continue" disabled={true} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    expect(onPress).not.toHaveBeenCalled();
  });

  test("pressing it twice still does nothing", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton label="Continue" disabled={true} onPress={onPress} />,
    );

    const button: Rendered = screen.getByRole("button", { name: "Continue" });
    await fireEvent.press(button);
    await fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("The secondary variant", () => {
  test("shows its label and runs its action", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton
        label="Use a backup code"
        variant="secondary"
        onPress={onPress}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Use a backup code" }),
    );

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("keeps its name while loading, just as the primary does", async () => {
    await render(
      <GradientButton
        label="Use a backup code"
        variant="secondary"
        loading={true}
        onPress={jest.fn()}
      />,
    );

    expect(screen.queryByText("Use a backup code")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use a backup code" }),
    ).toBeTruthy();
  });

  test("is closed to presses while loading", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton
        label="Use a backup code"
        variant="secondary"
        loading={true}
        onPress={onPress}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Use a backup code" }),
    );

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("How each variant is painted", () => {
  test.each(VARIANT_NAMES)(
    "%s uses its background, label and border tokens",
    async (variant: ButtonVariant) => {
      await render(
        <GradientButton
          label="Acknowledge"
          icon="checkmark"
          variant={variant}
          onPress={jest.fn()}
        />,
      );

      const tokens: VariantTokens = VARIANTS[variant];
      const button: Rendered = screen.getByRole("button", {
        name: "Acknowledge",
      });
      expect(button).toHaveStyle({
        backgroundColor: tokenValue(lightColors, tokens.background),
        borderWidth: tokens.border ? 1 : 0,
        opacity: 1,
      });
      if (tokens.border) {
        expect(button).toHaveStyle({ borderColor: lightColors[tokens.border] });
      }
      expect(screen.getByText("Acknowledge")).toHaveStyle({
        color: lightColors[tokens.content],
        fontWeight: "600",
      });
      expect(flat(screen.getByText(glyphFor("checkmark"))).color).toBe(
        lightColors[tokens.content],
      );
    },
  );

  test("primary is the default variant", async () => {
    await render(<GradientButton label="Save" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
    });
  });

  test("the spinner takes the variant's content colour", async () => {
    await render(
      <GradientButton
        label="Save"
        variant="tonal"
        loading
        onPress={jest.fn()}
      />,
    );

    const spinner: Rendered = screen.container.queryAll((node: Rendered) => {
      return node.type === "ActivityIndicator";
    })[0];
    expect(spinner.props.color).toBe(lightColors.actionPrimary);
  });
});

describe("Pressed feedback", () => {
  test.each(VARIANT_NAMES)(
    "%s swaps to its pressed fill while held and back after release",
    async (variant: ButtonVariant) => {
      const onPress: jest.Mock = jest.fn();
      await render(
        <GradientButton label="Page" variant={variant} onPress={onPress} />,
      );
      const button: Rendered = screen.getByRole("button", { name: "Page" });
      const tokens: VariantTokens = VARIANTS[variant];

      await holdDown(button);
      expect(button).toHaveStyle({
        backgroundColor: lightColors[tokens.pressed],
        borderRadius: radius.md,
      });

      await letGo(button);
      expect(onPress).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Page" })).toHaveStyle({
          backgroundColor: tokenValue(lightColors, tokens.background),
        });
      });
    },
  );

  test("a disabled button shows no pressed fill", async () => {
    await render(<GradientButton label="Page" disabled onPress={jest.fn()} />);
    const button: Rendered = screen.getByRole("button", { name: "Page" });

    await holdDown(button);

    expect(button).toHaveStyle({ backgroundColor: lightColors.actionPrimary });
  });
});

describe("Disabled and loading appearance", () => {
  test.each([
    ["disabled", { disabled: true }],
    ["loading", { loading: true }],
  ] as Array<[string, { disabled?: boolean; loading?: boolean }]>)(
    "a %s button is dimmed but keeps its fill",
    async (
      _label: string,
      props: { disabled?: boolean; loading?: boolean },
    ) => {
      await render(
        <GradientButton label="Page" onPress={jest.fn()} {...props} />,
      );

      expect(screen.getByRole("button", { name: "Page" })).toHaveStyle({
        opacity: 0.55,
        backgroundColor: lightColors.actionPrimary,
      });
    },
  );
});

describe("Sizes", () => {
  test("md is a 50pt target with callout text and an 18pt icon", async () => {
    await render(
      <GradientButton label="Save" icon="save" onPress={jest.fn()} />,
    );

    const button: Rendered = screen.getByRole("button", { name: "Save" });
    expect(flat(button).minHeight).toBe(50);
    expect(flat(button).borderRadius).toBe(radius.md);
    expect(screen.getByText("Save")).toHaveStyle({
      fontSize: typography.callout.fontSize,
      lineHeight: typography.callout.lineHeight,
    });
    expect(flat(screen.getByText(glyphFor("save"))).fontSize).toBe(18);
  });

  test("sm is a compact control that still meets the 44pt minimum, with subhead text and a 16pt icon", async () => {
    await render(
      <GradientButton label="Save" icon="save" size="sm" onPress={jest.fn()} />,
    );

    const button: Rendered = screen.getByRole("button", { name: "Save" });
    expect(flat(button).minHeight).toBe(44);
    expect(Number(flat(button).paddingHorizontal)).toBeLessThan(18);
    expect(screen.getByText("Save")).toHaveStyle({
      fontSize: typography.subhead.fontSize,
      lineHeight: typography.subhead.lineHeight,
    });
    expect(flat(screen.getByText(glyphFor("save"))).fontSize).toBe(16);
  });

  test("the label always has a line height, so descenders are not clipped", async () => {
    for (const size of ["md", "sm"] as const) {
      const view: Awaited<ReturnType<typeof render>> = await render(
        <GradientButton label="Paging" size={size} onPress={jest.fn()} />,
      );
      const style: TextStyle = flat(screen.getByText("Paging"));
      expect(Number(style.lineHeight)).toBeGreaterThanOrEqual(
        Number(style.fontSize),
      );
      await view.unmount();
    }
  });

  test("a caller's style is applied after the button's own", async () => {
    await render(
      <GradientButton
        label="Save"
        onPress={jest.fn()}
        style={{ marginTop: 12, borderRadius: 999 }}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({
      marginTop: 12,
      borderRadius: 999,
      backgroundColor: lightColors.actionPrimary,
    });
  });
});

describe("In dark mode", () => {
  test.each(VARIANT_NAMES)(
    "%s uses the dark palette for its fill and label",
    async (variant: ButtonVariant) => {
      mockSystemScheme = "dark";
      await render(
        <ThemeProvider>
          <GradientButton label="Page" variant={variant} onPress={jest.fn()} />
        </ThemeProvider>,
      );

      const tokens: VariantTokens = VARIANTS[variant];
      expect(screen.getByRole("button", { name: "Page" })).toHaveStyle({
        backgroundColor: tokenValue(darkColors, tokens.background),
      });
      expect(screen.getByText("Page")).toHaveStyle({
        color: darkColors[tokens.content],
      });
    },
  );

  test("the primary label is the DARK inverse text, because dark-mode fills are light", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <GradientButton label="Acknowledge" onPress={jest.fn()} />
      </ThemeProvider>,
    );

    const color: TextStyle["color"] = flat(
      screen.getByText("Acknowledge"),
    ).color;
    expect(color).toBe(darkColors.textInverse);
    expect(color).not.toBe(lightColors.textInverse);
  });

  test("the dark pressed fill is the lighter pressed action colour", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <GradientButton label="Page" onPress={jest.fn()} />
      </ThemeProvider>,
    );
    const button: Rendered = screen.getByRole("button", { name: "Page" });

    await holdDown(button);

    expect(button).toHaveStyle({
      backgroundColor: darkColors.actionPrimaryPressed,
    });
  });
});
