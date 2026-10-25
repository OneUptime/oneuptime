import React from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import QuickActionTile from "./QuickActionTile";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { spacing } from "../theme/tokens";

/*
 * The on-call overview's two big shortcuts. Beside a detail pane, the tile
 * whose screen is open on the right is marked, like a selected row, and the
 * tiles lose their forward chevron.
 */

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return { lightImpact: jest.fn() };
    },
  };
});

beforeEach(() => {
  mockColorScheme = "light";
});

type RenderedElement = ReturnType<typeof screen.getByRole>;

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

function tile(): RenderedElement {
  return screen.getByRole("button", {
    name: "Who's on call. See the team roster",
  });
}

function tileStyle(): Record<string, unknown> {
  return (StyleSheet.flatten(tile().props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

function draw(
  props: Partial<React.ComponentProps<typeof QuickActionTile>> = {},
): React.JSX.Element {
  return (
    <QuickActionTile
      label="Who's on call"
      sublabel="See the team roster"
      iconName="people-outline"
      onPress={jest.fn()}
      {...props}
    />
  );
}

describe("A quick action tile", () => {
  test("on a phone: not selected, with a chevron, as before", async () => {
    await render(draw());

    expect(tile()).not.toBeSelected();
    expect(screen.getByText(glyphFor("chevron-forward"))).toBeTruthy();
    expect(tileStyle()).toMatchObject({
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: lightColors.borderSubtle,
    });
  });

  test("beside a detail pane showing its screen: selected, on the accent", async () => {
    await render(draw({ selected: true, showChevron: false }));

    expect(tile()).toBeSelected();
    expect(screen.queryByText(glyphFor("chevron-forward"))).toBeNull();
    expect(tileStyle()).toMatchObject({
      padding: spacing.lg - 1,
      borderWidth: 2,
      borderColor: lightColors.actionPrimary,
      backgroundColor: lightColors.cardAccent,
    });
  });

  test("in dark mode, from the dark palette", async () => {
    mockColorScheme = "dark";
    await render(<ThemeProvider>{draw({ selected: true })}</ThemeProvider>);

    expect(tileStyle()).toMatchObject({
      borderColor: darkColors.actionPrimary,
      backgroundColor: darkColors.cardAccent,
    });
  });

  test("still does what it says when pressed", async () => {
    const onPress: jest.Mock<() => void> = jest.fn<() => void>();
    await render(draw({ onPress }));

    await fireEvent.press(tile());

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
