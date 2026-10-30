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

// A box's classes: a frame on every side, a shadow, rounded corners.
const BOX_CLASS_NAME: RegExp =
  /(^|\s)(border|shadow(-\w+)?|rounded-(lg|xl|2xl))(\s|$)/;

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
    // Room under a step that another follows; none under the last.
    expect(screen.getByTestId("ai-card-step-investigation-body")).toHaveClass(
      "pb-8",
    );
    cleanup();

    renderStep({ isLast: true });
    expect(screen.queryByTestId("ai-card-step-investigation-rail")).toBeNull();
    expect(
      screen.getByTestId("ai-card-step-investigation-body"),
    ).not.toHaveClass("pb-8");
  });

  /*
   * A report indented past the marks left a 320px phone some 200px of text
   * and a verdict that did not fit: on a phone the body takes the card's
   * width under the mark, as a message of the card's conversation does.
   */
  test("from sm up the body sits under the title, beside the rail; on a phone it takes the card's width, without the rail", () => {
    renderStep({ isLast: false });

    const body: HTMLElement = screen.getByTestId(
      "ai-card-step-investigation-body",
    );
    expect(body).toHaveClass(
      "col-span-2",
      "col-start-1",
      "row-start-2",
      "sm:col-span-1",
      "sm:col-start-2",
    );
    expect(within(body).getByText("What it found.")).toBeVisible();
    // The mark's column reaches down beside the body from sm up only.
    const markColumn: HTMLElement = screen.getByTestId(
      "ai-card-step-investigation-mark",
    ).parentElement as HTMLElement;
    expect(markColumn).toHaveClass("row-start-1", "sm:row-end-3");
    expect(screen.getByTestId("ai-card-step-investigation-rail")).toHaveClass(
      "max-sm:hidden",
    );
    // A pill that wraps under its title keeps to the card's end edge.
    expect(screen.getByTestId("ai-card-step-investigation-status")).toHaveClass(
      "ms-auto",
    );
  });

  test("draws no box of its own", () => {
    renderStep({});

    const step: HTMLElement = screen.getByTestId("ai-card-step-investigation");
    for (const element of [step, ...Array.from(step.querySelectorAll("*"))]) {
      const className: string = element.getAttribute("class") || "";
      expect({
        className,
        box: BOX_CLASS_NAME.test(className),
      }).toEqual({
        className,
        box: false,
      });
    }
  });

  /*
   * A step whose control goes away (Try again, once a fix started) puts the
   * keyboard on its title: given a ref, the title takes the focus from
   * script, never from Tab, and draws no ring of its own.
   */
  test("its title can take the focus from script when the step asks for it, and only then", () => {
    const headingRef: React.RefObject<HTMLHeadingElement | null> =
      React.createRef<HTMLHeadingElement>();

    render(
      <AiCardStep
        number={2}
        title="Remediation"
        status={{ text: "Fixing…", indicator: "live" }}
        statusLabel="Remediation status"
        isLast={true}
        testId="ai-card-step-remediation"
        headingRef={headingRef}
      >
        <p>What it does.</p>
      </AiCardStep>,
    );

    const title: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Remediation",
    });
    expect(headingRef.current).toBe(title);
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title).toHaveClass("focus:outline-none");

    headingRef.current!.focus();
    expect(title).toHaveFocus();

    cleanup();
    renderStep({});
    expect(
      screen.getByRole("heading", { level: 3, name: "Investigation" }),
    ).not.toHaveAttribute("tabindex");
  });
});
