import React from "react";
import { StyleSheet, Text, type ViewStyle } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import Card, { type CardVariant } from "./Card";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";

/*
 * Card is the surface grouped content sits on, and the tappable card is the
 * row of every response list. It is also where "styles do not load on some
 * pages" lived: the pressable card is styled with a Pressable style callback,
 * and NativeWind's JSX runtime used to drop those callbacks on device, leaving
 * cards with no background, padding or radius. The regression block at the
 * bottom renders that exact shape through the real component and checks the
 * resolved style reaches the host view.
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
 * Hold a finger on the element without lifting it.
 *
 * `fireEvent(el, "pressIn")` cannot do this: Pressable never passes an
 * onPressIn prop to its host view, so fireEvent finds nothing to call and the
 * pressed style is never rendered. The responder handler Pressability installs
 * on the host is what the touch system calls, so that is what is called here.
 */
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

function flat(element: RenderedElement): ViewStyle {
  return (StyleSheet.flatten(element.props.style) ?? {}) as ViewStyle;
}

function noop(): void {
  return undefined;
}

describe("A static card", () => {
  test("renders its children inside a plain view, not a button", async () => {
    await render(
      <Card testID="card">
        <Text>On call now</Text>
      </Card>,
    );

    expect(screen.getByText("On call now")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("card")).not.toHaveProp("onResponderGrant");
  });

  test("the elevated default: card background, subtle border, 16pt radius, card shadow", async () => {
    await render(
      <Card testID="card">
        <Text>Body</Text>
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.lg,
      boxShadow: elevation("card", false).boxShadow,
    });
  });

  test("outlined keeps the border but drops the shadow", async () => {
    await render(
      <Card testID="card" variant="outlined">
        <Text>Body</Text>
      </Card>,
    );

    const style: ViewStyle = flat(screen.getByTestId("card"));
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderWidth).toBe(1);
    expect(style.boxShadow).toBeUndefined();
  });

  test("tinted uses the soft accent and no border or shadow", async () => {
    await render(
      <Card testID="card" variant="tinted">
        <Text>Body</Text>
      </Card>,
    );

    const style: ViewStyle = flat(screen.getByTestId("card"));
    expect(style.backgroundColor).toBe(lightColors.cardAccent);
    expect(style.borderWidth).toBe(0);
    expect(style.boxShadow).toBeUndefined();
  });

  test("tinted takes a caller's tint, e.g. a status background", async () => {
    await render(
      <Card testID="card" variant="tinted" tint={lightColors.statusErrorBg}>
        <Text>Body</Text>
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveStyle({
      backgroundColor: lightColors.statusErrorBg,
    });
  });

  test("a tint is ignored by the non-tinted variants", async () => {
    await render(
      <Card testID="card" variant="elevated" tint="#ff0000">
        <Text>Body</Text>
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
    });
  });

  test("padding can be changed, including to zero for edge-to-edge content", async () => {
    await render(
      <Card testID="card" padding={0}>
        <Text>Body</Text>
      </Card>,
    );

    expect(flat(screen.getByTestId("card")).padding).toBe(0);
  });

  test("a caller's style is merged after the surface and wins", async () => {
    await render(
      <Card testID="card" style={{ marginTop: 12, borderRadius: 0 }}>
        <Text>Body</Text>
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveStyle({
      marginTop: 12,
      borderRadius: 0,
      backgroundColor: lightColors.backgroundElevated,
    });
  });

  test("an accessibility role and label can still be given", async () => {
    await render(
      <Card accessibilityRole="summary" accessibilityLabel="Shift summary">
        <Text>Body</Text>
      </Card>,
    );

    expect(screen.getByLabelText("Shift summary")).toHaveProp(
      "accessibilityRole",
      "summary",
    );
  });
});

describe("A pressable card", () => {
  test("is a button named by its label and hint", async () => {
    await render(
      <Card
        onPress={noop}
        accessibilityLabel="Incident 42"
        accessibilityHint="Opens the incident"
      >
        <Text>Incident 42</Text>
      </Card>,
    );

    const button: RenderedElement = screen.getByRole("button", {
      name: "Incident 42",
    });
    expect(button).toHaveProp("accessibilityHint", "Opens the incident");
  });

  test("pressing it runs onPress once", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(
      <Card onPress={onPress}>
        <Text>Incident 42</Text>
      </Card>,
    );

    await fireEvent.press(screen.getByRole("button"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a caller's role replaces the default button role", async () => {
    await render(
      <Card onPress={noop} accessibilityRole="link" accessibilityLabel="Docs">
        <Text>Docs</Text>
      </Card>,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Docs" })).toBeTruthy();
  });

  test("disabled is announced and does not run onPress", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(
      <Card onPress={onPress} disabled accessibilityLabel="Incident 42">
        <Text>Incident 42</Text>
      </Card>,
    );

    const button: RenderedElement = screen.getByRole("button", {
      name: "Incident 42",
    });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test("an enabled card is not announced as disabled", async () => {
    await render(
      <Card onPress={noop} accessibilityLabel="Incident 42">
        <Text>Incident 42</Text>
      </Card>,
    );

    expect(screen.getByRole("button", { name: "Incident 42" })).toBeEnabled();
  });

  test("holding it down gives a muted fill and a slight press-in", async () => {
    await render(
      <Card onPress={noop} testID="card">
        <Text>Incident 42</Text>
      </Card>,
    );
    const card: RenderedElement = screen.getByTestId("card");

    expect(flat(card).backgroundColor).toBe(lightColors.backgroundElevated);
    expect(flat(card).transform).toBeUndefined();

    await holdDown(card);

    expect(card).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
      transform: [{ scale: 0.99 }],
      borderRadius: radius.lg,
    });
  });

  test("letting go restores the resting surface and runs onPress", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(
      <Card onPress={onPress} testID="card">
        <Text>Incident 42</Text>
      </Card>,
    );
    const card: RenderedElement = screen.getByTestId("card");

    await holdDown(card);
    await letGo(card);

    expect(onPress).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(flat(screen.getByTestId("card")).backgroundColor).toBe(
        lightColors.backgroundElevated,
      );
    });
  });

  test("a caller's style still wins while pressed", async () => {
    await render(
      <Card onPress={noop} testID="card" style={{ backgroundColor: "#010203" }}>
        <Text>Incident 42</Text>
      </Card>,
    );
    const card: RenderedElement = screen.getByTestId("card");

    await holdDown(card);

    expect(flat(card).backgroundColor).toBe("#010203");
  });
});

describe("Regression: Pressable style callbacks reach the host view", () => {
  /*
   * The bug was invisible to every assertion that only looked for text: the
   * card rendered its children, it just had no surface. So these look at the
   * host view's resolved style, which is what the native side paints.
   */
  test.each(["elevated", "outlined", "tinted"] as const)(
    "a pressable %s card's host view carries its background, radius and padding",
    async (variant: CardVariant) => {
      await render(
        <Card onPress={noop} variant={variant} accessibilityLabel="Row">
          <Text>Row</Text>
        </Card>,
      );

      const host: RenderedElement = screen.getByRole("button", { name: "Row" });
      expect(typeof host.type).toBe("string");

      const style: ViewStyle = flat(host);
      expect(style.backgroundColor).toEqual(expect.any(String));
      expect(style.backgroundColor).not.toBe("transparent");
      expect(style.borderRadius).toBe(radius.lg);
      expect(style.padding).toBe(spacing.lg);
    },
  );

  test("the style prop on the host is resolved, not the callback itself", async () => {
    await render(
      <Card onPress={noop} accessibilityLabel="Row">
        <Text>Row</Text>
      </Card>,
    );

    expect(
      typeof screen.getByRole("button", { name: "Row" }).props.style,
    ).not.toBe("function");
  });
});

describe("In dark mode", () => {
  test("the surface and border come from the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <Card testID="card">
          <Text>Body</Text>
        </Card>
      </ThemeProvider>,
    );

    expect(screen.getByTestId("card")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
    });
  });

  test("the elevated shadow is the softer dark one", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <Card testID="card">
          <Text>Body</Text>
        </Card>
      </ThemeProvider>,
    );

    const shadow: ViewStyle["boxShadow"] = flat(
      screen.getByTestId("card"),
    ).boxShadow;
    expect(shadow).toBe(elevation("card", true).boxShadow);
    expect(shadow).not.toBe(elevation("card", false).boxShadow);
  });

  test("tinted defaults to the dark soft accent", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <Card testID="card" variant="tinted">
          <Text>Body</Text>
        </Card>
      </ThemeProvider>,
    );

    expect(screen.getByTestId("card")).toHaveStyle({
      backgroundColor: darkColors.cardAccent,
    });
  });

  test("the pressed fill is the dark muted surface", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <Card testID="card" onPress={noop}>
          <Text>Body</Text>
        </Card>
      </ThemeProvider>,
    );
    const card: RenderedElement = screen.getByTestId("card");

    await holdDown(card);

    expect(card).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
  });
});
