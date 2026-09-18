import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import IconBadge, { type IconBadgeSize } from "./IconBadge";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { withAlpha } from "../utils/color";

/*
 * An icon on a soft tile of its own colour. The tile is derived from the icon
 * colour with withAlpha, so a server-provided state colour in any shape still
 * produces a valid, visible tile rather than an invalid string.
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

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

function tileStyle(): ViewStyle {
  return (StyleSheet.flatten(screen.getByTestId("badge").props.style) ??
    {}) as ViewStyle;
}

function glyphStyle(name: keyof typeof Ionicons.glyphMap): TextStyle {
  return (StyleSheet.flatten(screen.getByText(glyphFor(name)).props.style) ??
    {}) as TextStyle;
}

describe("What it draws", () => {
  test("the named icon inside the tile", async () => {
    await render(<IconBadge name="pulse" testID="badge" />);

    const glyph: RenderedElement = screen.getByText(glyphFor("pulse"));
    expect(glyph.parent).toBe(screen.getByTestId("badge"));
  });

  test("centres the icon", async () => {
    await render(<IconBadge name="pulse" testID="badge" />);

    expect(tileStyle()).toMatchObject({
      alignItems: "center",
      justifyContent: "center",
    });
  });
});

describe("Sizes", () => {
  const SIZES: Array<[IconBadgeSize, number, number]> = [
    ["sm", 30, 16],
    ["md", 38, 20],
    ["lg", 52, 26],
  ];

  test.each(SIZES)(
    "%s is a %dpt square tile with a %dpt icon",
    async (size: IconBadgeSize, box: number, icon: number) => {
      await render(<IconBadge name="pulse" size={size} testID="badge" />);

      expect(tileStyle().width).toBe(box);
      expect(tileStyle().height).toBe(box);
      expect(glyphStyle("pulse").fontSize).toBe(icon);
    },
  );

  test("defaults to md", async () => {
    await render(<IconBadge name="pulse" testID="badge" />);

    expect(tileStyle().width).toBe(38);
  });

  test("sizes grow from sm to lg, and the icon always fits inside its tile", async () => {
    let previous: number = 0;
    for (const [size] of SIZES) {
      const view: Awaited<ReturnType<typeof render>> = await render(
        <IconBadge name="pulse" size={size} testID="badge" />,
      );
      const box: number = Number(tileStyle().width);
      expect(box).toBeGreaterThan(previous);
      expect(Number(glyphStyle("pulse").fontSize)).toBeLessThan(box);
      previous = box;
      await view.unmount();
    }
  });
});

describe("Shapes", () => {
  test.each(["sm", "md", "lg"] as Array<IconBadgeSize>)(
    "a %s circle is rounded by half its width",
    async (size: IconBadgeSize) => {
      await render(
        <IconBadge name="pulse" size={size} shape="circle" testID="badge" />,
      );

      expect(tileStyle().borderRadius).toBe(Number(tileStyle().width) / 2);
    },
  );

  test("rounded is the default, with a 12pt corner at md and lg", async () => {
    await render(<IconBadge name="pulse" size="lg" testID="badge" />);

    expect(tileStyle().borderRadius).toBe(12);
  });

  test("a small rounded tile tightens its corner so it does not look like a circle", async () => {
    await render(<IconBadge name="pulse" size="sm" testID="badge" />);

    expect(tileStyle().borderRadius).toBe(9);
    expect(Number(tileStyle().borderRadius)).toBeLessThan(
      Number(tileStyle().width) / 2,
    );
  });
});

describe("Colour", () => {
  test("defaults to the accent icon on a 12% accent tile", async () => {
    await render(<IconBadge name="pulse" testID="badge" />);

    expect(glyphStyle("pulse").color).toBe(lightColors.actionPrimary);
    expect(tileStyle().backgroundColor).toBe(
      withAlpha(lightColors.actionPrimary, 0.12),
    );
  });

  test("a colour tints both the icon and the tile", async () => {
    await render(
      <IconBadge name="pulse" color={lightColors.statusError} testID="badge" />,
    );

    expect(glyphStyle("pulse").color).toBe(lightColors.statusError);
    expect(tileStyle().backgroundColor).toBe("rgba(180, 35, 24, 0.12)");
  });

  test("a three-digit colour still produces a valid tile", async () => {
    await render(<IconBadge name="pulse" color="#f00" testID="badge" />);

    expect(tileStyle().backgroundColor).toBe("rgba(255, 0, 0, 0.12)");
  });

  test("an unreadable colour falls back to a grey tile, never an invalid string", async () => {
    await render(
      <IconBadge name="pulse" color="not-a-colour" testID="badge" />,
    );

    expect(tileStyle().backgroundColor).toBe("rgba(156, 163, 175, 0.12)");
  });

  test("an explicit background replaces the derived tint", async () => {
    await render(
      <IconBadge
        name="pulse"
        color={lightColors.statusSuccess}
        background={lightColors.statusSuccessBg}
        testID="badge"
      />,
    );

    expect(tileStyle().backgroundColor).toBe(lightColors.statusSuccessBg);
    expect(glyphStyle("pulse").color).toBe(lightColors.statusSuccess);
  });
});

describe("In dark mode", () => {
  test("the default icon uses the dark accent", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <IconBadge name="pulse" testID="badge" />
      </ThemeProvider>,
    );

    expect(glyphStyle("pulse").color).toBe(darkColors.actionPrimary);
  });

  test("the tile is a stronger 20% tint so it stays visible on dark cards", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <IconBadge name="pulse" color={darkColors.statusError} testID="badge" />
      </ThemeProvider>,
    );

    expect(tileStyle().backgroundColor).toBe(
      withAlpha(darkColors.statusError, 0.2),
    );
  });
});
