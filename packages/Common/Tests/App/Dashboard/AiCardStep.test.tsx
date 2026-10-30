import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import AiCardStep, {
  AI_CARD_STEP_MARK_CLASS_NAMES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiCardStep";
import { InvestigationStatusIndicator } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationStatusBadge";

/*
 * ONE STEP OF THE AI CARD (block 43): "Can you make it in two steps?
 * Investigation would be one step, and remediation would be the other
 * step." Each step is a numbered mark on a rail, its title and its pill on
 * one line, and its body under them - no box: the card is the only frame.
 */

afterEach(() => {
  cleanup();
});

function renderStep(data: {
  number?: number;
  indicator?: InvestigationStatusIndicator;
  isLast?: boolean;
  statusText?: string;
}): void {
  render(
    <AiCardStep
      number={data.number ?? 1}
      title="Investigation"
      status={{
        text: data.statusText || "Completed",
        indicator: data.indicator || "done",
      }}
      statusLabel="Investigation status"
      isLast={data.isLast}
      testId="ai-card-step-investigation"
    >
      <p>What it found.</p>
    </AiCardStep>,
  );
}

describe("AiCardStep", () => {
  test("is a section named by its title, with its pill and its body", () => {
    renderStep({});

    const step: HTMLElement = screen.getByTestId("ai-card-step-investigation");
    expect(step.tagName).toBe("SECTION");
    expect(step).toHaveAccessibleName("Investigation");
    expect(step).toHaveAttribute("data-step", "1");
    expect(step).toHaveAttribute("data-indicator", "done");

    // The title is the card's sub-heading, in the card's one heading style.
    const title: HTMLElement = within(step).getByRole("heading", {
      level: 3,
      name: "Investigation",
    });
    expect(title).toHaveClass("text-sm", "font-semibold", "text-gray-900");

    // The pill, named for screen readers, on the title's line.
    const pill: HTMLElement = within(step).getByLabelText(
      "Investigation status",
    );
    expect(pill).toHaveTextContent("Completed");
    expect(pill).toHaveAttribute("data-indicator", "done");
    expect(
      screen.getByTestId("ai-card-step-investigation-status"),
    ).toContainElement(pill);
    expect(title.parentElement).toBe(
      screen.getByTestId("ai-card-step-investigation-status").parentElement,
    );

    expect(within(step).getByText("What it found.")).toBeVisible();
  });

  test("its mark is a check once the step is done, its number otherwise", () => {
    renderStep({ indicator: "done" });
    const done: HTMLElement = screen.getByTestId(
      "ai-card-step-investigation-mark",
    );
    expect(done).not.toHaveTextContent("1");
    expect(done.querySelector("svg")).not.toBeNull();
    cleanup();

    renderStep({ number: 2, indicator: "live" });
    const live: HTMLElement = screen.getByTestId(
      "ai-card-step-investigation-mark",
    );
    expect(live).toHaveTextContent("2");
    expect(live.querySelector("svg")).toBeNull();
  });

  test.each<[InvestigationStatusIndicator]>([
    ["done"],
    ["live"],
    ["attention"],
    ["failed"],
    ["waiting"],
    ["checking"],
    ["idle"],
  ])(
    "a %s step's mark is tinted for it, and hidden from screen readers",
    (indicator: InvestigationStatusIndicator) => {
      renderStep({ indicator });

      const mark: HTMLElement = screen.getByTestId(
        "ai-card-step-investigation-mark",
      );
      for (const className of AI_CARD_STEP_MARK_CLASS_NAMES[indicator].split(
        " ",
      )) {
        expect(mark).toHaveClass(className);
      }
      expect(mark.closest("[aria-hidden='true']")).not.toBeNull();
    },
  );

  test("the marks only tint: light classes, remapped for the dark theme by Theme.css", () => {
    for (const classNames of Object.values(AI_CARD_STEP_MARK_CLASS_NAMES)) {
      expect(classNames).not.toContain("dark:");
    }
    // Moving, needing the reader and stopped are told apart from waiting.
    expect(AI_CARD_STEP_MARK_CLASS_NAMES.live).not.toBe(
      AI_CARD_STEP_MARK_CLASS_NAMES.waiting,
    );
    expect(AI_CARD_STEP_MARK_CLASS_NAMES.attention).not.toBe(
      AI_CARD_STEP_MARK_CLASS_NAMES.failed,
    );
  });

  test("the rail runs down to the next step, and the last step has none", () => {
    renderStep({ isLast: false });
    expect(
      screen.getByTestId("ai-card-step-investigation-rail"),
    ).toBeInTheDocument();
    cleanup();

    renderStep({ isLast: true });
    expect(screen.queryByTestId("ai-card-step-investigation-rail")).toBeNull();
  });

  test("draws no box of its own", () => {
    renderStep({});

    const step: HTMLElement = screen.getByTestId("ai-card-step-investigation");
    for (const element of [step, ...Array.from(step.querySelectorAll("*"))]) {
      const className: string = element.getAttribute("class") || "";
      expect({
        className,
        box: /(^|\s)(border|shadow(-\w+)?|rounded-(lg|xl|2xl))(\s|$)/.test(
          className,
        ),
      }).toEqual({
        className,
        box: false,
      });
    }
  });
});
