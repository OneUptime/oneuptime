import React from "react";
import { StyleSheet, Text, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import AuthLayout, {
  AUTH_CODE_FIELD_HEIGHT,
  AUTH_CONTROL_HEIGHT,
  AuthDivider,
  AuthLink,
  AuthNotice,
  AuthStep,
  AuthTextField,
} from "./AuthLayout";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";

/*
 * The frame and form controls every sign-in screen is built from. A border,
 * height or colour that drifts here drifts on seven screens at once, and the
 * dark-mode half of that is invisible until somebody is signing in at night.
 */

type Rendered = ReturnType<typeof screen.getByTestId>;

let mockSystemScheme: "light" | "dark" = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead (as ThemeContext.test does).
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockSystemScheme;
    },
  };
});

beforeEach(() => {
  mockSystemScheme = "light";
});

function viewStyle(element: Rendered): ViewStyle {
  return StyleSheet.flatten(element.props.style) as ViewStyle;
}

function textStyle(element: Rendered): TextStyle {
  return StyleSheet.flatten(element.props.style) as TextStyle;
}

/** The bordered row that wraps a field's TextInput. */
function fieldBox(): Rendered {
  return screen.getByTestId("field-box");
}

async function renderInDarkMode(ui: React.ReactElement): Promise<void> {
  mockSystemScheme = "dark";
  await render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("The auth frame", () => {
  test("keeps the final sign-in action above the home indicator on a small phone", async () => {
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 59, bottom: 34, left: 0, right: 0 }}
      >
        <AuthLayout title="Sign in">
          <Text>Final action</Text>
        </AuthLayout>
      </SafeAreaInsetsContext.Provider>,
    );
    const scroll: Rendered = screen.getByTestId("auth-scroll");
    expect(
      scroll.props.contentContainerStyle.paddingBottom,
    ).toBeGreaterThanOrEqual(34 + 40);
    expect(
      scroll.props.contentContainerStyle.paddingTop,
    ).toBeGreaterThanOrEqual(59);
    expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
    expect(scroll.props.keyboardDismissMode).toBe("on-drag");
    expect(screen.getByText("Final action")).toBeTruthy();
  });

  test("makes the full form scrollable while the platform keyboard is open", async () => {
    await render(
      <AuthLayout title="Sign in" description="Continue to your team">
        <Text>Submit</Text>
      </AuthLayout>,
    );
    expect(screen.getByTestId("auth-keyboard")).toBeTruthy();
    expect(
      screen.getByTestId("auth-scroll").props.contentContainerStyle.flexGrow,
    ).toBe(1);
    expect(screen.getByRole("header", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Continue to your team")).toBeTruthy();
    expect(screen.getByTestId("auth-form")).toBeTruthy();
  });

  test("compact login branding avoids a repeated wordmark without reducing safe-area clearance", async () => {
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 59, bottom: 34, left: 0, right: 0 }}
      >
        <AuthLayout title="Welcome back" showBrand compact>
          <Text>Sign In</Text>
        </AuthLayout>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(screen.queryByText("ONEUPTIME")).toBeNull();
    expect(viewStyle(screen.getByTestId("auth-brand")).marginBottom).toBe(24);
    expect(screen.getByRole("image", { name: "OneUptime" })).toBeTruthy();
    const scroll: Rendered = screen.getByTestId("auth-scroll");
    expect(
      scroll.props.contentContainerStyle.paddingTop,
    ).toBeGreaterThanOrEqual(59);
    expect(
      scroll.props.contentContainerStyle.paddingBottom,
    ).toBeGreaterThanOrEqual(34 + 40);
  });

  test("sits on the canvas colour with the wordmark in the primary text colour", async () => {
    await render(
      <AuthLayout title="Welcome back" showBrand compact>
        <Text>Form</Text>
      </AuthLayout>,
    );
    expect(viewStyle(screen.getByTestId("auth-keyboard")).backgroundColor).toBe(
      lightColors.backgroundPrimary,
    );
    const xml: string = (
      screen.getByTestId("auth-brand").children[0] as Rendered
    ).props.xml;
    expect(xml).toContain(`fill="${lightColors.textPrimary}"`);
    expect(xml).toContain(`fill="${lightColors.actionPrimary}"`);
  });

  test("an icon screen shows a tinted tile in the requested tone", async () => {
    await render(
      <AuthLayout
        title="Check your email"
        icon="mail-open-outline"
        iconTone="success"
      >
        <Text>Form</Text>
      </AuthLayout>,
    );
    expect(viewStyle(screen.getByTestId("auth-icon")).backgroundColor).toBe(
      lightColors.statusSuccessBg,
    );
    expect(screen.queryByTestId("auth-brand")).toBeNull();
  });

  test("the centred variant centres the title for a single-action screen", async () => {
    await render(
      <AuthLayout
        title="Unlock your workspace"
        eyebrow="WELCOME BACK"
        description="Use Face ID to unlock"
        icon="lock-closed"
        showBrand
        centered
        compact
      >
        <Text>Unlock</Text>
      </AuthLayout>,
    );
    expect(
      textStyle(screen.getByRole("header", { name: "Unlock your workspace" }))
        .textAlign,
    ).toBe("center");
    expect(textStyle(screen.getByText("Use Face ID to unlock")).textAlign).toBe(
      "center",
    );
    expect(viewStyle(screen.getByTestId("auth-brand")).alignSelf).toBe(
      "center",
    );
    expect(viewStyle(screen.getByTestId("auth-icon")).alignSelf).toBe("center");
  });

  test("dark mode paints the dark canvas and a light wordmark", async () => {
    await renderInDarkMode(
      <AuthLayout title="Welcome back" showBrand compact>
        <Text>Form</Text>
      </AuthLayout>,
    );
    expect(viewStyle(screen.getByTestId("auth-keyboard")).backgroundColor).toBe(
      darkColors.backgroundPrimary,
    );
    const xml: string = (
      screen.getByTestId("auth-brand").children[0] as Rendered
    ).props.xml;
    expect(xml).toContain(`fill="${darkColors.textPrimary}"`);
    expect(xml).not.toContain(`fill="${lightColors.textPrimary}"`);
    expect(screen.getByRole("header", { name: "Welcome back" })).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });
});

describe("AuthTextField", () => {
  function renderField(
    props: Partial<React.ComponentProps<typeof AuthTextField>> = {},
  ): Promise<unknown> {
    return render(
      <AuthTextField
        label="Email"
        icon="mail-outline"
        containerTestID="field-box"
        testID="field-input"
        placeholder="you@example.com"
        {...props}
      />,
    );
  }

  test("has a visible label, the shared height and radius, and names the input", async () => {
    await renderField();

    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBe(
      screen.getByTestId("field-input"),
    );
    expect(viewStyle(fieldBox())).toMatchObject({
      minHeight: AUTH_CONTROL_HEIGHT,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: lightColors.borderDefault,
      backgroundColor: lightColors.backgroundElevated,
    });
    expect(AUTH_CONTROL_HEIGHT).toBe(52);
    expect(radius.md).toBe(12);
  });

  test("an explicit accessibility label wins over the visible label", async () => {
    await renderField({
      label: "Code",
      accessibilityLabel: "Authenticator code",
    });

    expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    expect(screen.queryByLabelText("Code")).toBeNull();
  });

  test("uses theme tokens for placeholder, selection and a light keyboard", async () => {
    await renderField();
    const input: Rendered = screen.getByTestId("field-input");

    expect(input.props.placeholderTextColor).toBe(lightColors.textTertiary);
    expect(input.props.selectionColor).toBe(lightColors.actionPrimary);
    expect(input.props.keyboardAppearance).toBe("light");
    expect(textStyle(input)).toMatchObject({
      color: lightColors.textPrimary,
      minWidth: 0,
      fontSize: 16,
    });
  });

  test("focus draws an action-coloured ring and blur takes it away", async () => {
    const onFocus: jest.Mock = jest.fn();
    const onBlur: jest.Mock = jest.fn();
    await renderField({ onFocus, onBlur });

    await fireEvent(screen.getByTestId("field-input"), "focus");

    expect(viewStyle(fieldBox())).toMatchObject({
      borderWidth: 2,
      borderColor: lightColors.actionPrimary,
    });
    expect(String(viewStyle(fieldBox()).boxShadow)).toContain(
      "rgba(79, 70, 229",
    );
    expect(onFocus).toHaveBeenCalledTimes(1);

    await fireEvent(screen.getByTestId("field-input"), "blur");

    expect(viewStyle(fieldBox())).toMatchObject({
      borderWidth: 1,
      borderColor: lightColors.borderDefault,
    });
    expect(viewStyle(fieldBox()).boxShadow).toBeUndefined();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("the text does not move when the border thickens on focus", async () => {
    await renderField();
    const before: ViewStyle = viewStyle(fieldBox());
    await fireEvent(screen.getByTestId("field-input"), "focus");
    const after: ViewStyle = viewStyle(fieldBox());

    expect(Number(before.paddingLeft) + Number(before.borderWidth)).toBe(
      Number(after.paddingLeft) + Number(after.borderWidth),
    );
  });

  test("an error message outlines the field in red and is announced as an alert", async () => {
    await renderField({
      errorMessage: "Enter the email address on your account.",
    });

    expect(viewStyle(fieldBox())).toMatchObject({
      borderWidth: 2,
      borderColor: lightColors.statusError,
    });
    const alert: Rendered = screen.getByRole("alert");
    expect(alert.props.accessibilityLiveRegion).toBe("polite");
    expect(
      screen.getByText("Enter the email address on your account."),
    ).toHaveStyle({ color: lightColors.statusError });
  });

  test("invalid outlines the field without adding a second message", async () => {
    await renderField({ invalid: true });

    expect(viewStyle(fieldBox()).borderColor).toBe(lightColors.statusError);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a hint is shown only while there is no error", async () => {
    const view: { rerender: (ui: React.ReactElement) => Promise<void> } =
      (await renderField({ hint: "Include https://" })) as {
        rerender: (ui: React.ReactElement) => Promise<void>;
      };
    expect(screen.getByText("Include https://")).toBeTruthy();

    await view.rerender(
      <AuthTextField
        label="Email"
        containerTestID="field-box"
        testID="field-input"
        hint="Include https://"
        errorMessage="Please enter a server URL"
      />,
    );

    expect(screen.queryByText("Include https://")).toBeNull();
    expect(screen.getByText("Please enter a server URL")).toBeTruthy();
  });

  test("a read-only field is visibly muted", async () => {
    await renderField({ editable: false });

    expect(viewStyle(fieldBox()).backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
    expect(textStyle(screen.getByTestId("field-input")).color).toBe(
      lightColors.textSecondary,
    );
    expect(screen.getByTestId("field-input").props.editable).toBe(false);
  });

  test("a revealable secure field starts hidden and toggles with a full-size control", async () => {
    await renderField({
      label: "Password",
      icon: "lock-closed-outline",
      secureTextEntry: true,
      revealable: true,
    });
    await fireEvent.changeText(
      screen.getByTestId("field-input"),
      "fixture-password",
    );

    expect(screen.getByTestId("field-input").props.secureTextEntry).toBe(true);
    const show: Rendered = screen.getByRole("button", {
      name: "Show password",
    });
    expect(viewStyle(show).minWidth).toBeGreaterThanOrEqual(48);
    expect(viewStyle(show).minHeight).toBeGreaterThanOrEqual(48);

    await fireEvent.press(show);
    expect(screen.getByTestId("field-input").props.secureTextEntry).toBe(false);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Hide password" }),
    );
    expect(screen.getByTestId("field-input").props.secureTextEntry).toBe(true);
  });

  test("a secure field without the reveal control never exposes its text", async () => {
    await renderField({ secureTextEntry: true });

    expect(screen.getByTestId("field-input").props.secureTextEntry).toBe(true);
    expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();
  });

  test("the code variant is tall, large and centred, and drops the leading icon", async () => {
    await renderField({
      label: "Six-digit code",
      variant: "code",
      keyboardType: "number-pad",
    });
    const input: Rendered = screen.getByTestId("field-input");

    expect(viewStyle(fieldBox()).minHeight).toBe(AUTH_CODE_FIELD_HEIGHT);
    expect(textStyle(input)).toMatchObject({
      fontSize: 28,
      textAlign: "center",
    });
    expect(Number(textStyle(input).letterSpacing)).toBeGreaterThan(0);
    expect(input.props.keyboardType).toBe("number-pad");
  });

  test("forwards a ref so a screen can move focus between fields", async () => {
    const ref: React.RefObject<{ focus: () => void } | null> =
      React.createRef();
    await render(
      <AuthTextField
        label="Password"
        inputRef={ref as React.Ref<never>}
        testID="field-input"
      />,
    );

    expect(ref.current).toBeTruthy();
    expect(typeof ref.current?.focus).toBe("function");
  });

  test("dark mode uses dark tokens and the dark keyboard", async () => {
    await renderInDarkMode(
      <AuthTextField
        label="Email"
        icon="mail-outline"
        containerTestID="field-box"
        testID="field-input"
        placeholder="you@example.com"
      />,
    );
    const input: Rendered = screen.getByTestId("field-input");

    expect(input.props.keyboardAppearance).toBe("dark");
    expect(input.props.placeholderTextColor).toBe(darkColors.textTertiary);
    expect(textStyle(input).color).toBe(darkColors.textPrimary);
    expect(viewStyle(fieldBox())).toMatchObject({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderDefault,
    });

    await fireEvent(input, "focus");
    expect(viewStyle(fieldBox()).borderColor).toBe(darkColors.actionPrimary);
  });

  test("dark mode errors use the dark error colour", async () => {
    await renderInDarkMode(
      <AuthTextField
        label="Email"
        containerTestID="field-box"
        testID="field-input"
        errorMessage="Email is required."
      />,
    );

    expect(viewStyle(fieldBox()).borderColor).toBe(darkColors.statusError);
    expect(screen.getByText("Email is required.")).toHaveStyle({
      color: darkColors.statusError,
    });
  });
});

describe("AuthNotice", () => {
  test("a danger notice is an accessible alert on the error tint", async () => {
    await render(
      <AuthNotice testID="notice" message="Invalid login." tone="danger" />,
    );

    const notice: Rendered = screen.getByTestId("notice");
    expect(notice.props.accessibilityRole).toBe("alert");
    expect(notice.props.accessible).toBe(true);
    expect(viewStyle(notice).backgroundColor).toBe(lightColors.statusErrorBg);
    expect(screen.getByText("Invalid login.")).toHaveStyle({
      color: lightColors.statusError,
    });
  });

  test("other tones are not alerts, and a live notice is still announced", async () => {
    await render(
      <AuthNotice
        testID="notice"
        message="Preparing a secure sign-in…"
        tone="info"
        live
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    const notice: Rendered = screen.getByTestId("notice");
    expect(notice.props.accessibilityLiveRegion).toBe("polite");
    expect(viewStyle(notice).backgroundColor).toBe(lightColors.statusInfoBg);
  });

  test("uses the dark tints in dark mode", async () => {
    await renderInDarkMode(
      <AuthNotice testID="notice" message="Still locked." tone="warning" />,
    );

    expect(viewStyle(screen.getByTestId("notice")).backgroundColor).toBe(
      darkColors.statusWarningBg,
    );
  });
});

describe("AuthLink, AuthDivider and AuthStep", () => {
  test("a link is a full-size button that honours disabled", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(
      <AuthLink
        label="Forgot password?"
        onPress={onPress}
        testID="link"
        disabled
      />,
    );

    const link: Rendered = screen.getByRole("button", {
      name: "Forgot password?",
    });
    expect(viewStyle(link).minHeight).toBeGreaterThanOrEqual(48);
    expect(link.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(link);
    expect(onPress).not.toHaveBeenCalled();
  });

  test("a disclosure link reports whether it is expanded", async () => {
    await render(
      <AuthLink
        label="New to passkeys?"
        onPress={jest.fn()}
        accessibilityState={{ expanded: true }}
        aria-expanded
      />,
    );

    const link: Rendered = screen.getByRole("button", {
      name: "New to passkeys?",
    });
    expect(link.props.accessibilityState.expanded).toBe(true);
  });

  test("secondary links use the secondary text colour", async () => {
    await render(
      <AuthLink label="Skip for now" tone="secondary" onPress={jest.fn()} />,
    );

    expect(screen.getByText("Skip for now")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test("a divider shows its label between two hairlines", async () => {
    await render(<AuthDivider label="Other ways to sign in" />);

    expect(screen.getByText("Other ways to sign in")).toBeTruthy();
  });

  test("a step is a numbered header with its description", async () => {
    await render(
      <AuthStep
        number={2}
        title="Confirm the setup"
        description="Enter the current six-digit code."
      />,
    );

    expect(
      screen.getByRole("header", { name: "Confirm the setup" }),
    ).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(viewStyle(screen.getByTestId("auth-step-2")).backgroundColor).toBe(
      lightColors.cardAccent,
    );
  });
});
