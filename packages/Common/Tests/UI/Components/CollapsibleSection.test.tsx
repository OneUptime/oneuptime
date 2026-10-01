import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CollapsibleSection from "../../../UI/Components/CollapsibleSection/CollapsibleSection";

/*
 * The folding group behind every "Advanced Options", "On-Call" and "Filters"
 * section in the monitor and dashboard forms.
 *
 * Folded, its body stays mounted (the fields keep what was typed) but must be
 * out of the way for everyone: max-h-0 and opacity-0 stop the fields being
 * seen, and `invisible` (visibility: hidden) takes them out of the tab order
 * and away from screen readers. Without it a keyboard user tabbed into
 * "Advanced Options" fields nobody could see.
 */

afterEach(() => {
  cleanup();
});

function header(): HTMLElement {
  return screen.getByRole("button", { name: "Advanced Options" });
}

function body(): HTMLElement {
  const bodyId: string | null = header().getAttribute("aria-controls");

  expect(bodyId).toBeTruthy();

  return document.getElementById(bodyId!)!;
}

function renderSection(
  props: Partial<React.ComponentProps<typeof CollapsibleSection>> = {},
): void {
  render(
    <CollapsibleSection title="Advanced Options" {...props}>
      <input aria-label="Request Timeout" />
    </CollapsibleSection>,
  );
}

describe("CollapsibleSection", () => {
  test("an open section shows its body", () => {
    renderSection();

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(body()).toHaveClass("opacity-100");
    expect(body()).not.toHaveClass("invisible");
    expect(body()).toContainElement(screen.getByLabelText("Request Timeout"));
  });

  test("a section collapsed by default hides its body from sight, keyboard and screen readers", () => {
    renderSection({ defaultCollapsed: true });

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(body()).toHaveClass("max-h-0", "opacity-0", "invisible");
  });

  test("its fields stay mounted while folded, keeping what was typed", () => {
    renderSection();

    fireEvent.change(screen.getByLabelText("Request Timeout"), {
      target: { value: "30" },
    });
    fireEvent.click(header());

    expect(body()).toHaveClass("invisible");
    expect(screen.getByLabelText("Request Timeout")).toHaveValue("30");

    fireEvent.click(header());

    expect(body()).not.toHaveClass("invisible");
    expect(screen.getByLabelText("Request Timeout")).toHaveValue("30");
  });

  test("opens and folds from the keyboard", () => {
    renderSection({ defaultCollapsed: true });

    fireEvent.keyDown(header(), { key: "Enter" });
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(body()).not.toHaveClass("invisible");

    fireEvent.keyDown(header(), { key: " " });
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(body()).toHaveClass("invisible");
  });

  test("reports each toggle to onToggle", () => {
    const onToggle: jest.Mock<(isCollapsed: boolean) => void> = jest.fn();

    renderSection({ onToggle });

    fireEvent.click(header());
    fireEvent.click(header());

    expect(onToggle.mock.calls).toEqual([[true], [false]]);
  });

  test("follows a controlled isCollapsed", () => {
    const { rerender } = render(
      <CollapsibleSection title="Advanced Options" isCollapsed={true}>
        <input aria-label="Request Timeout" />
      </CollapsibleSection>,
    );

    expect(body()).toHaveClass("invisible");

    rerender(
      <CollapsibleSection title="Advanced Options" isCollapsed={false}>
        <input aria-label="Request Timeout" />
      </CollapsibleSection>,
    );

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(body()).not.toHaveClass("invisible");
  });

  test("the badge shows only while folded", () => {
    renderSection({ defaultCollapsed: true, badge: "Configured" });

    expect(header()).toHaveTextContent("Configured");

    fireEvent.click(header());

    expect(header()).not.toHaveTextContent("Configured");
  });

  test("two sections never share an id", () => {
    render(
      <>
        <CollapsibleSection title="On-Call">
          <span>one</span>
        </CollapsibleSection>
        <CollapsibleSection title="Advanced Options">
          <span>two</span>
        </CollapsibleSection>
      </>,
    );

    const controlled: Array<string | null> = screen
      .getAllByRole("button")
      .map((button: HTMLElement): string | null => {
        return button.getAttribute("aria-controls");
      });

    expect(controlled).toHaveLength(2);
    expect(new Set(controlled).size).toBe(2);
  });
});
