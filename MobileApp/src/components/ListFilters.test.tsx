import React, { useState } from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { act, render, screen, fireEvent } from "@testing-library/react-native";
import { Ionicons } from "@expo/vector-icons";
import ListFilters from "./ListFilters";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius } from "../theme/tokens";

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

/** fireEvent(el, "pressIn") never reaches Pressable's own press state. */
async function holdDown(element: RenderedElement): Promise<void> {
  await act(async (): Promise<void> => {
    (
      element.props as { onResponderGrant: (event: unknown) => void }
    ).onResponderGrant({
      nativeEvent: {
        touches: [{ pageX: 1, pageY: 1, identifier: 1 }],
        changedTouches: [],
      },
      currentTarget: 1,
      persist: (): void => {
        return undefined;
      },
    });
  });
}

const OPTIONS: Array<{
  key: "all" | "active" | "resolved";
  label: string;
  accessibilityLabel: string;
}> = [
  { key: "all", label: "All", accessibilityLabel: "All states" },
  { key: "active", label: "Active", accessibilityLabel: "Active only" },
  { key: "resolved", label: "Resolved", accessibilityLabel: "Resolved only" },
];

function Filters(): React.JSX.Element {
  const [selected, setSelected] = useState<"all" | "active">("all");
  return (
    <ListFilters
      options={[
        { key: "all", label: "All", accessibilityLabel: "All states" },
        { key: "active", label: "Active", accessibilityLabel: "Active only" },
      ]}
      selected={selected}
      onSelect={setSelected}
      resultCount={selected === "all" ? 2 : 1}
      onReset={
        selected === "all"
          ? undefined
          : () => {
              return setSelected("all");
            }
      }
    />
  );
}

test("filter selection is announced, updates the total and can be reset", async () => {
  await render(<Filters />);
  expect(screen.getByRole("button", { name: "All states" })).toHaveProp(
    "accessibilityState",
    { selected: true },
  );
  expect(screen.getByText("2 results")).toHaveProp(
    "accessibilityLiveRegion",
    "polite",
  );
  expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Active only" }));
  expect(screen.getByRole("button", { name: "Active only" })).toHaveProp(
    "accessibilityState",
    { selected: true },
  );
  expect(screen.getByRole("button", { name: "All states" })).toHaveProp(
    "accessibilityState",
    { selected: false },
  );
  expect(screen.getByText("1 result")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByText("2 results")).toBeTruthy();
});

test("unknown totals are not reported as zero matches", async () => {
  await render(
    <ListFilters
      options={[{ key: "all", label: "All", accessibilityLabel: "All states" }]}
      selected="all"
      onSelect={jest.fn()}
    />,
  );
  expect(screen.queryByText(/results?/)).toBeNull();
});

test("filters can still be reset while the result count is unavailable", async () => {
  const onReset: jest.Mock = jest.fn();
  await render(
    <ListFilters
      options={[
        { key: "active", label: "Active", accessibilityLabel: "Active only" },
      ]}
      selected="active"
      onSelect={jest.fn()}
      onReset={onReset}
    />,
  );
  expect(screen.queryByText(/results?/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Reset filters" }));
  expect(onReset).toHaveBeenCalledTimes(1);
});

describe("How the chips are drawn", () => {
  test("chips wrap onto new lines so no filter is hidden past the screen edge", async () => {
    await render(
      <ListFilters options={OPTIONS} selected="all" onSelect={jest.fn()} />,
    );

    expect(screen.getByTestId("list-filter-chips")).toHaveStyle({
      flexDirection: "row",
      flexWrap: "wrap",
    });
    expect(
      screen.container.queryAll((node: RenderedElement) => {
        return node.props.horizontal === true;
      }),
    ).toHaveLength(0);
  });

  test("every chip and the reset control meet the 48 point touch target", async () => {
    await render(
      <ListFilters
        options={OPTIONS}
        selected="all"
        onSelect={jest.fn()}
        onReset={jest.fn()}
      />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveStyle({ minHeight: 48 });
    }
  });

  test("the selected chip is a filled accent pill with a check and inverse label", async () => {
    await render(
      <ListFilters options={OPTIONS} selected="active" onSelect={jest.fn()} />,
    );

    const chip: RenderedElement = screen.getByRole("button", {
      name: "Active only",
    });
    expect(chip).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
      borderColor: lightColors.actionPrimary,
      borderRadius: radius.pill,
    });
    expect(screen.getByText("Active")).toHaveStyle({
      color: lightColors.textInverse,
    });
    const check: RenderedElement = screen.getByText(glyphFor("checkmark"));
    expect(flat(check).color).toBe(lightColors.textInverse);
    expect(check.parent).toBe(chip);
  });

  test("only the selected chip carries the check", async () => {
    await render(
      <ListFilters options={OPTIONS} selected="active" onSelect={jest.fn()} />,
    );

    expect(screen.getAllByText(glyphFor("checkmark"))).toHaveLength(1);
  });

  test("unselected chips are outlined on the card surface with primary text", async () => {
    await render(
      <ListFilters options={OPTIONS} selected="active" onSelect={jest.fn()} />,
    );

    for (const name of ["All states", "Resolved only"]) {
      expect(screen.getByRole("button", { name })).toHaveStyle({
        backgroundColor: lightColors.backgroundElevated,
        borderColor: lightColors.borderDefault,
        borderWidth: 1,
      });
    }
    expect(screen.getByText("All")).toHaveStyle({
      color: lightColors.textPrimary,
    });
  });

  test("holding an unselected chip gives it the muted pressed fill", async () => {
    await render(
      <ListFilters options={OPTIONS} selected="all" onSelect={jest.fn()} />,
    );
    const chip: RenderedElement = screen.getByRole("button", {
      name: "Resolved only",
    });

    await holdDown(chip);

    expect(chip).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
    });
  });

  test("holding the selected chip keeps its accent fill", async () => {
    await render(
      <ListFilters options={OPTIONS} selected="all" onSelect={jest.fn()} />,
    );
    const chip: RenderedElement = screen.getByRole("button", {
      name: "All states",
    });

    await holdDown(chip);

    expect(chip).toHaveStyle({ backgroundColor: lightColors.actionPrimary });
  });

  test("pressing a chip reports its key", async () => {
    const onSelect: jest.Mock = jest.fn();
    await render(
      <ListFilters options={OPTIONS} selected="all" onSelect={onSelect} />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolved only" }),
    );

    expect(onSelect).toHaveBeenCalledWith("resolved");
  });

  test("the reset control is a 44pt accent link", async () => {
    await render(
      <ListFilters
        options={OPTIONS}
        selected="active"
        onSelect={jest.fn()}
        onReset={jest.fn()}
      />,
    );

    const reset: RenderedElement = screen.getByRole("button", {
      name: "Reset filters",
    });
    expect(Number(flat(reset).minHeight)).toBeGreaterThanOrEqual(44);
    expect(screen.getByText("Reset")).toHaveStyle({
      color: lightColors.actionPrimary,
    });
  });

  test("the result count is secondary text", async () => {
    await render(
      <ListFilters
        options={OPTIONS}
        selected="all"
        onSelect={jest.fn()}
        resultCount={0}
      />,
    );

    expect(screen.getByText("0 results")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });
});

describe("In dark mode", () => {
  test("selected and unselected chips use the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <ListFilters options={OPTIONS} selected="active" onSelect={jest.fn()} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Active only" })).toHaveStyle({
      backgroundColor: darkColors.actionPrimary,
    });
    /* A light fill in dark mode needs the dark inverse label. */
    expect(screen.getByText("Active")).toHaveStyle({
      color: darkColors.textInverse,
    });
    expect(screen.getByRole("button", { name: "All states" })).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderDefault,
    });
    expect(screen.getByText("All")).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });
});
