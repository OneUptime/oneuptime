import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import InvestigationStatusBadge, {
  InvestigationStatusIndicator,
  renderInvestigationStatusIndicator,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationStatusBadge";

/*
 * The AI Investigation card names its state once, in its header, in the same
 * neutral pill for every state (and for the not-started card too). The pill
 * used to change colour with the state, which added one more tinted shape
 * to a card that already had several. Only the small mark in front of the
 * words carries colour now, and what it looks like depends on what it means.
 */

const INDICATORS: Array<InvestigationStatusIndicator> = [
  "live",
  "checking",
  "done",
  "idle",
  "attention",
  "failed",
];

function badge(): HTMLElement {
  return screen.getByLabelText("Investigation status");
}

function markClass(): string {
  return badge().querySelector("svg")?.getAttribute("class") || "";
}

afterEach(() => {
  cleanup();
});

describe("InvestigationStatusBadge", () => {
  test("names the state as text, labelled for the header and marked for its meaning", () => {
    render(<InvestigationStatusBadge text="Completed" indicator="done" />);

    expect(badge()).toHaveTextContent("Completed");
    expect(badge().tagName).toBe("SPAN");
    expect(badge()).toHaveAttribute("data-indicator", "done");
  });

  test("draws the same neutral pill whatever the state", () => {
    const classNames: Array<string> = INDICATORS.map(
      (indicator: InvestigationStatusIndicator): string => {
        const view: ReturnType<typeof render> = render(
          <InvestigationStatusBadge text="State" indicator={indicator} />,
        );
        const className: string = badge().className;
        view.unmount();
        return className;
      },
    );

    expect(new Set(classNames).size).toBe(1);
    expect(classNames[0]).toContain("bg-gray-50");
    expect(classNames[0]).toContain("text-gray-700");
    expect(classNames[0]).toContain("ring-gray-200");
    expect(classNames[0]).toContain("rounded-full");
    expect(classNames[0]).toContain("whitespace-nowrap");
    expect(classNames[0]).not.toMatch(/green|indigo|red|amber|rose|emerald/);
  });

  test("pulses a small dot while the run can still move", () => {
    render(<InvestigationStatusBadge text="Investigating…" indicator="live" />);

    expect(badge().querySelector("svg")).toBeNull();
    const dot: HTMLElement = badge().querySelector(
      "span[aria-hidden='true']",
    ) as HTMLElement;
    expect(dot).not.toBeNull();
    const ping: HTMLElement = dot.firstElementChild as HTMLElement;
    expect(ping).toHaveClass("motion-safe:animate-ping", "bg-indigo-400");
    expect(dot.lastElementChild).toHaveClass("bg-indigo-500");
    // Reduced motion keeps the dot and drops only the ping.
    expect(ping.className).not.toMatch(/(^|\s)animate-ping/);
  });

  test("spins a gray refresh mark while it checks", () => {
    render(<InvestigationStatusBadge text="Checking" indicator="checking" />);

    expect(markClass()).toContain("motion-safe:animate-spin");
    expect(markClass()).toContain("text-gray-400");
  });

  test.each([
    ["done", "text-green-600"],
    ["failed", "text-red-600"],
    ["attention", "text-amber-500"],
    ["idle", "text-gray-400"],
  ] as Array<[InvestigationStatusIndicator, string]>)(
    "marks %s with a %s icon",
    (indicator: InvestigationStatusIndicator, colour: string) => {
      render(<InvestigationStatusBadge text="State" indicator={indicator} />);

      expect(markClass()).toContain(colour);
      expect(markClass()).toContain("h-3.5");
      expect(markClass()).toContain("w-3.5");
      expect(markClass()).not.toContain("animate");
    },
  );

  test("gives every settled state a different mark from a live one", () => {
    for (const indicator of INDICATORS) {
      const view: ReturnType<typeof render> = render(
        renderInvestigationStatusIndicator(indicator),
      );
      const hasIcon: boolean = view.container.querySelector("svg") !== null;
      expect(hasIcon).toBe(indicator !== "live");
      view.unmount();
    }
  });

  test("keeps the mark in front of the words", () => {
    render(
      <InvestigationStatusBadge text="Did not finish" indicator="failed" />,
    );

    const children: Array<Element> = Array.from(badge().children);
    expect(children).toHaveLength(2);
    expect(children[0]!.querySelector("svg")).not.toBeNull();
    expect(children[1]).toHaveTextContent("Did not finish");
  });
});
