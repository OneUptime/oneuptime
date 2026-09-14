import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import SegmentedControl from "./SegmentedControl";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { elevation, radius, typography } from "../theme/tokens";

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
 * The two-way switch at the top of the alert and incident lists. It is the
 * only thing on those screens that says WHICH list is underneath - alerts, or
 * the episodes that group them - and the two lists look almost identical once
 * they are populated, so a responder who cannot tell them apart is reading the
 * wrong page without knowing it.
 *
 * Sighted, that answer is carried by a filled background and nothing else. A
 * screen reader cannot read a background, which is why the role and the
 * selected state below are load-bearing rather than decoration: without them
 * VoiceOver and TalkBack announce two plain, unrelated buttons.
 */

type Segments = [
  { key: "alerts"; label: string },
  { key: "episodes"; label: string },
];

const SEGMENTS: Segments = [
  { key: "alerts", label: "Alerts" },
  { key: "episodes", label: "Episodes" },
];

function noop(): void {
  return undefined;
}

/**
 * The control as a screen actually uses it - with a parent that owns the
 * selection and feeds it back down.
 *
 * Driving the real round trip matters here, because the bug this file guards
 * is about what the control ANNOUNCES after a selection changes, and a test
 * that only checks the callback fired would never look at that.
 */
function StatefulSegmentedControl(): React.JSX.Element {
  const [selected, setSelected] = useState<"alerts" | "episodes">("alerts");

  return (
    <SegmentedControl
      segments={SEGMENTS}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

describe("What the control shows", () => {
  test("both segments are labelled", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(screen.getByText("Alerts")).toBeTruthy();
    expect(screen.getByText("Episodes")).toBeTruthy();
  });

  test("the chosen segment is the filled one", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="episodes"
        onSelect={noop}
      />,
    );

    const chosen: ReturnType<typeof screen.getByRole> = screen.getByRole(
      "tab",
      { name: "Episodes" },
    );
    const other: ReturnType<typeof screen.getByRole> = screen.getByRole("tab", {
      name: "Alerts",
    });

    expect(
      (chosen.props.style as { backgroundColor: string }).backgroundColor,
    ).toBe(lightColors.backgroundElevated);
    expect(
      (other.props.style as { backgroundColor: string }).backgroundColor,
    ).toBe("transparent");
  });
});

describe("What a screen reader is told", () => {
  test("ARIA aliases preserve exactly one native selected tab after each selection", async () => {
    await render(<StatefulSegmentedControl />);
    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(
      screen.getByRole("tab", { name: "Alerts", selected: true }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Episodes" }));
    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(
      screen.getByRole("tab", { name: "Episodes", selected: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Alerts", selected: false }),
    ).toBeTruthy();
  });
  test("each segment is a tab rather than an anonymous button", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  test("the chosen segment is announced as selected", async () => {
    /*
     * The regression this guards: the selection used to be conveyed by colour
     * alone, so both segments came out of the accessibility tree identical.
     */
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(
      screen.getByRole("tab", { selected: true, name: "Alerts" }),
    ).toBeTruthy();
  });

  test("and the other one is not", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(
      screen.getByRole("tab", { selected: false, name: "Episodes" }),
    ).toBeTruthy();
  });

  test("the announcement follows the selection when it moves", async () => {
    await render(<StatefulSegmentedControl />);

    await fireEvent.press(screen.getByRole("tab", { name: "Episodes" }));

    expect(
      screen.getByRole("tab", { selected: true, name: "Episodes" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { selected: false, name: "Alerts" }),
    ).toBeTruthy();
  });
});

describe("Choosing a segment", () => {
  test("pressing the other segment reports that segment's key", async () => {
    const onSelect: jest.Mock = jest.fn();

    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={onSelect}
      />,
    );

    await fireEvent.press(screen.getByText("Episodes"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("episodes");
  });

  test("pressing the segment already showing reports that same key, not the other one", async () => {
    /*
     * A responder taps the segment they are already on more often than anyone
     * expects - to get back to the top of the list, or because the tap did not
     * register the first time. Reporting the neighbouring key there would
     * swap the list out from under them.
     */
    const onSelect: jest.Mock = jest.fn();

    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={onSelect}
      />,
    );

    await fireEvent.press(screen.getByText("Alerts"));

    expect(onSelect).toHaveBeenCalledWith("alerts");
  });

  test("re-selecting the segment already showing leaves it showing", async () => {
    await render(<StatefulSegmentedControl />);

    await fireEvent.press(screen.getByRole("tab", { name: "Alerts" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Alerts" }));

    expect(
      screen.getByRole("tab", { selected: true, name: "Alerts" }),
    ).toBeTruthy();
  });

  test("pressing back and forth ends up where the last press pointed", async () => {
    await render(<StatefulSegmentedControl />);

    await fireEvent.press(screen.getByRole("tab", { name: "Episodes" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Alerts" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Episodes" }));

    expect(
      screen.getByRole("tab", { selected: true, name: "Episodes" }),
    ).toBeTruthy();
  });

  test("every press is reported, so the parent can react to a repeat", async () => {
    const onSelect: jest.Mock = jest.fn();

    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={onSelect}
      />,
    );

    await fireEvent.press(screen.getByText("Episodes"));
    await fireEvent.press(screen.getByText("Episodes"));

    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

/**
 * The track the tabs sit in. It carries accessibilityRole "tablist" but is
 * deliberately NOT an accessibility element itself - it has to stay a
 * container so VoiceOver and TalkBack can reach the tabs inside it - and
 * getByRole only matches accessibility elements, so it is found by its role
 * prop and checked to be the tabs' parent.
 */
function tablist(): ReturnType<typeof screen.getByRole> {
  const lists: Array<ReturnType<typeof screen.getByRole>> =
    screen.container.queryAll((node: ReturnType<typeof screen.getByRole>) => {
      return node.props.accessibilityRole === "tablist";
    });
  expect(lists).toHaveLength(1);
  for (const tab of screen.getAllByRole("tab")) {
    expect(tab.parent).toBe(lists[0]);
  }
  return lists[0];
}

describe("How the control is drawn", () => {
  test("the segments sit in one tablist on a muted track", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(tablist()).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
      borderRadius: radius.md,
      flexDirection: "row",
    });
    expect(tablist().children).toHaveLength(2);
  });

  test("the chosen segment is raised with the card shadow; the other is flat", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(screen.getByRole("tab", { name: "Alerts" })).toHaveStyle({
      boxShadow: elevation("card", false).boxShadow,
    });
    expect(
      screen.getByRole("tab", { name: "Episodes" }).props.style.boxShadow,
    ).toBeUndefined();
  });

  test("the chosen label is bold primary text; the other is secondary", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    expect(screen.getByText("Alerts")).toHaveStyle({
      color: lightColors.textPrimary,
      fontWeight: "700",
      fontSize: typography.subhead.fontSize,
      lineHeight: typography.subhead.lineHeight,
    });
    expect(screen.getByText("Episodes")).toHaveStyle({
      color: lightColors.textSecondary,
      fontWeight: "500",
    });
  });

  test("every segment is at least a 44pt target and shares the width", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
      />,
    );

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveStyle({ flex: 1 });
      expect(Number(tab.props.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  test("the fill follows the selection when it moves", async () => {
    await render(<StatefulSegmentedControl />);

    await fireEvent.press(screen.getByRole("tab", { name: "Episodes" }));

    expect(screen.getByRole("tab", { name: "Episodes" })).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
    });
    expect(screen.getByRole("tab", { name: "Alerts" })).toHaveStyle({
      backgroundColor: "transparent",
    });
  });

  test("a caller's style adjusts the track without losing it", async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        selected="alerts"
        onSelect={noop}
        style={{ marginHorizontal: 0 }}
      />,
    );

    expect(tablist()).toHaveStyle({
      marginHorizontal: 0,
      backgroundColor: lightColors.backgroundTertiary,
    });
  });

  test("three or more segments all render as tabs", async () => {
    await render(
      <SegmentedControl
        segments={[
          { key: "a", label: "Day" },
          { key: "b", label: "Week" },
          { key: "c", label: "Month" },
        ]}
        selected="b"
        onSelect={noop}
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(
      screen.getByRole("tab", { name: "Week", selected: true }),
    ).toBeTruthy();
  });
});

describe("In dark mode", () => {
  test("the track, fill, labels and shadow use the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <SegmentedControl
          segments={SEGMENTS}
          selected="alerts"
          onSelect={noop}
        />
      </ThemeProvider>,
    );

    expect(tablist()).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
    expect(screen.getByRole("tab", { name: "Alerts" })).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      boxShadow: elevation("card", true).boxShadow,
    });
    expect(screen.getByText("Alerts")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Episodes")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });
});
