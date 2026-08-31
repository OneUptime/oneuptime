import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import SegmentedControl from "./SegmentedControl";
import { darkColors } from "../theme";

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
    ).toBe(darkColors.actionPrimary);
    expect(
      (other.props.style as { backgroundColor: string }).backgroundColor,
    ).toBe("transparent");
  });
});

describe("What a screen reader is told", () => {
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
