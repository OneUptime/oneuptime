import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import StatusPill, { getToneColors, type StatusTone } from "./StatusPill";
import {
  ThemeProvider,
  darkColors,
  darkTheme,
  lightColors,
  lightTheme,
  type ColorTokens,
} from "../theme";
import { radius, typography } from "../theme/tokens";

/*
 * A compact status label. The word carries the meaning; the colour and the
 * optional dot only repeat it, so the tests hold the text in place first and
 * then check each tone lands on its token pair.
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

const TONES: Record<
  StatusTone,
  { text: keyof ColorTokens; background: keyof ColorTokens }
> = {
  neutral: { text: "textSecondary", background: "backgroundTertiary" },
  danger: { text: "statusError", background: "statusErrorBg" },
  warning: { text: "statusWarning", background: "statusWarningBg" },
  success: { text: "statusSuccess", background: "statusSuccessBg" },
  info: { text: "statusInfo", background: "statusInfoBg" },
  accent: { text: "actionPrimary", background: "cardAccent" },
};

function flat(testIDOrText: {
  props: { style?: unknown };
}): ViewStyle & TextStyle {
  return (StyleSheet.flatten(testIDOrText.props.style as ViewStyle) ??
    {}) as ViewStyle & TextStyle;
}

describe("getToneColors", () => {
  test.each(Object.keys(TONES) as Array<StatusTone>)(
    "%s maps to its text and background tokens in both palettes",
    (tone: StatusTone) => {
      expect(getToneColors(lightTheme, tone)).toEqual({
        text: lightColors[TONES[tone].text],
        background: lightColors[TONES[tone].background],
      });
      expect(getToneColors(darkTheme, tone)).toEqual({
        text: darkColors[TONES[tone].text],
        background: darkColors[TONES[tone].background],
      });
    },
  );
});

describe("What the pill shows", () => {
  test("its label, on one line", async () => {
    await render(<StatusPill label="Acknowledged" />);

    expect(screen.getByText("Acknowledged")).toHaveProp("numberOfLines", 1);
  });

  test("a fully rounded pill that hugs its content", async () => {
    await render(<StatusPill label="Acknowledged" testID="pill" />);

    expect(screen.getByTestId("pill")).toHaveStyle({
      borderRadius: radius.pill,
      alignSelf: "flex-start",
      flexDirection: "row",
    });
  });

  test("defaults to the neutral tone", async () => {
    await render(<StatusPill label="Muted" testID="pill" />);

    expect(screen.getByTestId("pill")).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
    });
    expect(screen.getByText("Muted")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test.each(Object.keys(TONES) as Array<StatusTone>)(
    "the %s tone paints the label and the pill from its token pair",
    async (tone: StatusTone) => {
      await render(<StatusPill label="State" tone={tone} testID="pill" />);

      expect(screen.getByTestId("pill")).toHaveStyle({
        backgroundColor: lightColors[TONES[tone].background],
      });
      expect(screen.getByText("State")).toHaveStyle({
        color: lightColors[TONES[tone].text],
        fontWeight: "600",
      });
    },
  );

  test("a caller's style is merged after the pill's own", async () => {
    await render(
      <StatusPill label="State" testID="pill" style={{ marginLeft: 8 }} />,
    );

    expect(screen.getByTestId("pill")).toHaveStyle({
      marginLeft: 8,
      borderRadius: radius.pill,
    });
  });
});

describe("The leading dot", () => {
  test("absent unless a dot colour is given", async () => {
    await render(<StatusPill label="State" testID="pill" />);

    expect(screen.queryByTestId("pill-dot")).toBeNull();
    expect(screen.getByTestId("pill").children).toHaveLength(1);
  });

  test("drawn before the label in the given colour", async () => {
    await render(
      <StatusPill label="Investigating" dotColor="#FF8800" testID="pill" />,
    );

    const dot: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("pill-dot");
    expect(dot).toHaveStyle({ backgroundColor: "#FF8800" });
    expect(screen.getByTestId("pill").children[0]).toBe(dot);
  });

  test("is a circle: 8pt at md, 6pt at sm", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <StatusPill label="State" dotColor="#FF8800" testID="pill" />,
    );
    const md: ViewStyle = flat(screen.getByTestId("pill-dot"));
    expect(md.width).toBe(8);
    expect(md.height).toBe(8);
    expect(Number(md.borderRadius)).toBeGreaterThanOrEqual(
      Number(md.width) / 2,
    );
    await view.unmount();

    await render(
      <StatusPill label="State" dotColor="#FF8800" size="sm" testID="pill" />,
    );
    const sm: ViewStyle = flat(screen.getByTestId("pill-dot"));
    expect(sm.width).toBe(6);
    expect(sm.height).toBe(6);
    expect(Number(sm.borderRadius)).toBeGreaterThanOrEqual(
      Number(sm.width) / 2,
    );
  });

  test("the dot does not replace the tone: the word keeps its readable colour", async () => {
    await render(
      <StatusPill
        label="Resolved"
        tone="success"
        dotColor="#00FF00"
        testID="pill"
      />,
    );

    expect(screen.getByText("Resolved")).toHaveStyle({
      color: lightColors.statusSuccess,
    });
  });

  test("a dot without a testID renders without inventing one", async () => {
    await render(<StatusPill label="State" dotColor="#FF8800" />);

    expect(screen.getByText("State")).toBeTruthy();
    expect(screen.queryByTestId("undefined-dot")).toBeNull();
  });
});

describe("Sizes", () => {
  test("md uses the footnote type and roomier padding", async () => {
    await render(<StatusPill label="State" testID="pill" />);

    expect(screen.getByText("State")).toHaveStyle({
      fontSize: typography.footnote.fontSize,
      lineHeight: typography.footnote.lineHeight,
    });
    expect(screen.getByTestId("pill")).toHaveStyle({
      paddingHorizontal: 10,
      paddingVertical: 4,
    });
  });

  test("sm uses the caption type and tighter padding", async () => {
    await render(<StatusPill label="State" size="sm" testID="pill" />);

    expect(screen.getByText("State")).toHaveStyle({
      fontSize: typography.caption.fontSize,
      lineHeight: typography.caption.lineHeight,
    });
    expect(screen.getByTestId("pill")).toHaveStyle({
      paddingHorizontal: 8,
      paddingVertical: 2,
    });
  });
});

describe("In dark mode", () => {
  test.each(Object.keys(TONES) as Array<StatusTone>)(
    "the %s tone uses its dark token pair",
    async (tone: StatusTone) => {
      mockSystemScheme = "dark";
      await render(
        <ThemeProvider>
          <StatusPill label="State" tone={tone} testID="pill" />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("pill")).toHaveStyle({
        backgroundColor: darkColors[TONES[tone].background],
      });
      expect(screen.getByText("State")).toHaveStyle({
        color: darkColors[TONES[tone].text],
      });
    },
  );
});
