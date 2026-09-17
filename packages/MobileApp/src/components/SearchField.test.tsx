import React, { useState } from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Ionicons } from "@expo/vector-icons";
import SearchField from "./SearchField";
import { ThemeProvider, darkColors, lightColors } from "../theme";
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

type RenderedElement = ReturnType<typeof screen.getByText>;

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

function flat(element: RenderedElement): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props.style) ?? {}) as ViewStyle &
    TextStyle;
}

/** The bordered box around the icon, input and clear button. */
function fieldBox(label: string): RenderedElement {
  return screen.getByLabelText(label).parent as RenderedElement;
}

function Search(): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <SearchField
      value={value}
      onChangeText={setValue}
      placeholder="Search incidents"
    />
  );
}

test("search is named, accepts text and clears without losing the input", async () => {
  await render(<Search />);
  const input: ReturnType<typeof screen.getByLabelText> =
    screen.getByLabelText("Search incidents");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  await fireEvent.changeText(input, "checkout latency");
  expect(input).toHaveProp("value", "checkout latency");
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(input).toHaveProp("value", "");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});

test("an explicit accessible label describes what is searched", async () => {
  await render(
    <SearchField
      value=""
      onChangeText={jest.fn()}
      placeholder="Name or ID"
      accessibilityLabel="Find a monitor"
    />,
  );
  expect(screen.getByLabelText("Find a monitor")).toHaveProp(
    "autoCorrect",
    false,
  );
});

describe("How the field is drawn", () => {
  test("at rest: a 48pt card-coloured box with the default border and a muted icon", async () => {
    await render(<Search />);

    expect(fieldBox("Search incidents")).toHaveStyle({
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: lightColors.backgroundElevated,
      borderWidth: 1,
      borderColor: lightColors.borderDefault,
    });
    expect(flat(screen.getByText(glyphFor("search"))).color).toBe(
      lightColors.textTertiary,
    );
  });

  test("the input uses callout text in the primary colour, with a tertiary placeholder", async () => {
    await render(<Search />);

    const input: RenderedElement = screen.getByLabelText("Search incidents");
    expect(input).toHaveStyle({
      fontSize: typography.callout.fontSize,
      lineHeight: typography.callout.lineHeight,
      color: lightColors.textPrimary,
    });
    expect(input).toHaveProp("placeholderTextColor", lightColors.textTertiary);
    expect(input).toHaveProp("selectionColor", lightColors.actionPrimary);
    expect(input).toHaveProp("keyboardAppearance", "light");
    expect(input).toHaveProp("returnKeyType", "search");
  });

  test("focus draws a 2pt accent border and tints the icon, without shifting the content", async () => {
    await render(<Search />);
    const input: RenderedElement = screen.getByLabelText("Search incidents");
    const restingPadding: number = Number(
      flat(fieldBox("Search incidents")).paddingLeft,
    );

    await fireEvent(input, "focus");

    const focused: ViewStyle = flat(fieldBox("Search incidents"));
    expect(focused.borderWidth).toBe(2);
    expect(focused.borderColor).toBe(lightColors.actionPrimary);
    /* One extra point of border is taken back out of the padding. */
    expect(Number(focused.paddingLeft) + Number(focused.borderWidth)).toBe(
      restingPadding + 1,
    );
    expect(flat(screen.getByText(glyphFor("search"))).color).toBe(
      lightColors.actionPrimary,
    );

    await fireEvent(input, "blur");

    expect(fieldBox("Search incidents")).toHaveStyle({
      borderWidth: 1,
      borderColor: lightColors.borderDefault,
    });
  });

  test("the placeholder defaults to Search and names the field", async () => {
    await render(<SearchField value="" onChangeText={jest.fn()} />);

    expect(screen.getByLabelText("Search")).toHaveProp("placeholder", "Search");
  });

  test("the clear button is a 44pt target", async () => {
    await render(<SearchField value="db" onChangeText={jest.fn()} />);

    const clear: RenderedElement = screen.getByRole("button", {
      name: "Clear search",
    });
    expect(flat(clear).minWidth).toBeGreaterThanOrEqual(44);
    expect(flat(clear).minHeight).toBeGreaterThanOrEqual(44);
  });

  test("a testID reaches the input itself", async () => {
    await render(
      <SearchField value="" onChangeText={jest.fn()} testID="search-input" />,
    );

    expect(screen.getByTestId("search-input")).toBe(
      screen.getByLabelText("Search"),
    );
  });
});

describe("In dark mode", () => {
  test("the box, text and keyboard follow the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <SearchField value="" onChangeText={jest.fn()} placeholder="Find" />
      </ThemeProvider>,
    );

    const input: RenderedElement = screen.getByLabelText("Find");
    expect(input).toHaveProp("keyboardAppearance", "dark");
    expect(input).toHaveProp("placeholderTextColor", darkColors.textTertiary);
    expect(input).toHaveStyle({ color: darkColors.textPrimary });
    expect(fieldBox("Find")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderDefault,
    });
  });
});
