import React from "react";
import { StyleSheet, type TextStyle } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import AppText, { type TextTone } from "./AppText";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import type { ColorTokens } from "../theme";
import { typography, type TypographyVariant } from "../theme/tokens";

/*
 * AppText is how the type scale reaches the screen. Its promise is small and
 * easy to break quietly: the variant decides size, line height and weight; the
 * tone decides colour from the theme; an explicit colour beats the tone; and a
 * caller's own style still has the last word.
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

function flatStyleOf(text: string): TextStyle {
  return (StyleSheet.flatten(screen.getByText(text).props.style) ??
    {}) as TextStyle;
}

const TONE_TOKENS: Record<TextTone, keyof ColorTokens> = {
  primary: "textPrimary",
  secondary: "textSecondary",
  tertiary: "textTertiary",
  inverse: "textInverse",
  accent: "actionPrimary",
  danger: "statusError",
  success: "statusSuccess",
  warning: "statusWarning",
};

describe("Defaults", () => {
  test("renders its children as text", async () => {
    await render(<AppText>Acknowledged</AppText>);

    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });

  test("is body copy in the primary text colour", async () => {
    await render(<AppText>Acknowledged</AppText>);

    expect(screen.getByText("Acknowledged")).toHaveStyle({
      ...typography.body,
      color: lightColors.textPrimary,
    });
  });
});

describe("Variants", () => {
  test.each(Object.keys(typography) as Array<TypographyVariant>)(
    "%s takes its size, line height and weight from the type scale",
    async (variant: TypographyVariant) => {
      await render(<AppText variant={variant}>Sample</AppText>);

      const style: TextStyle = flatStyleOf("Sample");
      expect(style.fontSize).toBe(typography[variant].fontSize);
      expect(style.lineHeight).toBe(typography[variant].lineHeight);
      expect(style.fontWeight).toBe(typography[variant].fontWeight);
      expect(style.letterSpacing).toBe(typography[variant].letterSpacing);
    },
  );

  test("overline upper-cases for display without changing the text", async () => {
    await render(<AppText variant="overline">Team members</AppText>);

    expect(screen.getByText("Team members")).toHaveStyle({
      textTransform: "uppercase",
    });
    expect(screen.queryByText("TEAM MEMBERS")).toBeNull();
  });
});

describe("Tones", () => {
  test.each(
    Object.entries(TONE_TOKENS) as Array<[TextTone, keyof ColorTokens]>,
  )(
    "%s uses the %s token",
    async (tone: TextTone, token: keyof ColorTokens) => {
      await render(<AppText tone={tone}>Sample</AppText>);

      expect(flatStyleOf("Sample").color).toBe(lightColors[token]);
    },
  );

  test("an explicit colour wins over the tone, for server-provided state colours", async () => {
    await render(
      <AppText tone="danger" color="#123456">
        Investigating
      </AppText>,
    );

    expect(flatStyleOf("Investigating").color).toBe("#123456");
  });

  test("a caller's style has the last word, even over an explicit colour", async () => {
    await render(
      <AppText
        variant="caption"
        color="#123456"
        style={{ color: "#654321", fontSize: 40 }}
      >
        Override
      </AppText>,
    );

    const style: TextStyle = flatStyleOf("Override");
    expect(style.color).toBe("#654321");
    expect(style.fontSize).toBe(40);
    expect(style.lineHeight).toBe(typography.caption.lineHeight);
  });
});

describe("Weight and alignment", () => {
  test("weight overrides the variant's own weight", async () => {
    await render(
      <AppText variant="body" weight="700">
        Bold
      </AppText>,
    );

    expect(flatStyleOf("Bold").fontWeight).toBe("700");
  });

  test("align sets textAlign", async () => {
    await render(<AppText align="center">Centred</AppText>);

    expect(flatStyleOf("Centred").textAlign).toBe("center");
  });

  test("without weight or align the variant's defaults are left alone", async () => {
    await render(<AppText variant="headline">Plain</AppText>);

    const style: TextStyle = flatStyleOf("Plain");
    expect(style.fontWeight).toBe(typography.headline.fontWeight);
    expect(style.textAlign).toBeUndefined();
  });
});

describe("Text props pass through", () => {
  test("accessibility role, numberOfLines, selectable and testID reach the host text", async () => {
    await render(
      <AppText
        accessibilityRole="header"
        numberOfLines={2}
        selectable
        testID="title"
      >
        Incident 42
      </AppText>,
    );

    const text: ReturnType<typeof screen.getByText> = screen.getByRole(
      "header",
      { name: "Incident 42" },
    );
    expect(text).toHaveProp("numberOfLines", 2);
    expect(text).toHaveProp("selectable", true);
    expect(screen.getByTestId("title")).toBe(text);
  });
});

describe("In dark mode", () => {
  test.each(
    Object.entries(TONE_TOKENS) as Array<[TextTone, keyof ColorTokens]>,
  )(
    "%s uses the dark %s token",
    async (tone: TextTone, token: keyof ColorTokens) => {
      mockSystemScheme = "dark";
      await render(
        <ThemeProvider>
          <AppText tone={tone}>Sample</AppText>
        </ThemeProvider>,
      );

      expect(flatStyleOf("Sample").color).toBe(darkColors[token]);
    },
  );

  test("an explicit colour is not replaced by the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <AppText color="#abcdef">Server colour</AppText>
      </ThemeProvider>,
    );

    expect(flatStyleOf("Server colour").color).toBe("#abcdef");
  });
});
