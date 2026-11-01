import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import CollapsibleSection, {
  COLLAPSIBLE_SECTION_BORDERED_FLUSH_ON_PHONES_FRAME_CLASS_NAME,
  COLLAPSIBLE_SECTION_BORDERED_FRAME_CLASS_NAME,
  COLLAPSIBLE_SECTION_CARD_FLUSH_ON_PHONES_FRAME_CLASS_NAME,
  COLLAPSIBLE_SECTION_CARD_FRAME_CLASS_NAME,
} from "../../../UI/Components/CollapsibleSection/CollapsibleSection";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { resolveFrame } from "../../ResponsiveFrame";
import {
  classesWithoutDarkTheme,
  isRemappedForDarkTheme,
} from "../Styles/DarkThemeCoverage";

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

  /*
   * Open, the body was capped at max-h-[5000px] with overflow-hidden: a
   * section taller than that - a long form, many criteria on a phone - lost
   * its end, with nothing to scroll to (FoldedSection's was until #5220).
   * Nothing caps it now; folded, it is out of sight and reach as before.
   */
  test("open, it is as tall as what it holds: no height cap cuts its end off", () => {
    renderSection({ defaultCollapsed: true });

    fireEvent.click(header());

    const heightCaps: Array<string> = Array.from(body().classList).filter(
      (name: string): boolean => {
        return name.startsWith("max-h-");
      },
    );

    expect(heightCaps).toEqual([]);
    expect(body()).toHaveClass("opacity-100", "transition-opacity");
    expect(body()).not.toHaveClass("invisible");

    fireEvent.click(header());

    expect(body()).toHaveClass("max-h-0", "opacity-0", "invisible");
  });

  test("open by default, it carries no height cap either", () => {
    renderSection();

    expect(body().className).not.toContain("max-h-");
    // Opening transitions its opacity only: visibility is not in the list.
    expect(body().className).not.toContain("transition-[max-height");
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
    const onToggle: MockFunction = getJestMockFunction();

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

  test("a badge that does not fit beside the title goes under it", () => {
    /*
     * On a phone, "Advanced" and a summary such as "When no criteria match:
     * Operational" do not fit on one line. The title row wraps, so the
     * badge drops under the title instead of running off the header - and
     * keeps the 8px gap it always had when it does fit.
     */
    renderSection({
      defaultCollapsed: true,
      badge: "When no criteria match: Operational",
    });

    const heading: HTMLElement = screen.getByTestId(
      "collapsible-section-heading",
    );

    expect(heading).toHaveClass("flex", "flex-wrap", "gap-x-2");

    const badge: HTMLElement = screen
      .getByText("When no criteria match: Operational")
      .closest("span.max-w-full")! as HTMLElement;

    expect(badge).not.toBeNull();
    expect(badge.parentElement).toBe(heading);
    // The gap comes from the row now; a margin as well would double it.
    expect(badge).not.toHaveClass("ml-2");
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

/*
 * A folded section can say what is inside it in a line under its title - a
 * form's "Subscriber Notifications" folded to the sentence that says who is
 * told and when - so a reader knows without opening it. It is for the folded
 * state only: open, the fields say it themselves and the description shows.
 */
describe("CollapsibleSection's folded line", () => {
  const SUMMARY: string =
    "Subscribers are notified when it is scheduled, when it starts and when it ends.";

  test("shows under the title while folded, and describes the header", () => {
    renderSection({
      defaultCollapsed: true,
      description: "Shown while open.",
      collapsedDescription: SUMMARY,
    });

    const summary: HTMLElement = screen.getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent(SUMMARY);
    // It wraps on a narrow screen rather than being cut off.
    expect(summary).not.toHaveClass("truncate");
    expect(header()).toHaveAttribute("aria-describedby", summary.id);
    expect(header()).toHaveAccessibleDescription(SUMMARY);
    expect(screen.queryByText("Shown while open.")).toBeNull();
  });

  test("gives way to the description once open, and comes back when folded", () => {
    renderSection({
      defaultCollapsed: true,
      description: "Shown while open.",
      collapsedDescription: SUMMARY,
    });

    fireEvent.click(header());

    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(header()).not.toHaveAttribute("aria-describedby");
    expect(screen.getByText("Shown while open.")).toBeInTheDocument();

    fireEvent.click(header());

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      SUMMARY,
    );
  });

  test("is not drawn when there is nothing to say", () => {
    renderSection({ defaultCollapsed: true });

    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(header()).not.toHaveAttribute("aria-describedby");
  });
});

/*
 * A framed section that is flush on a phone (isFlushOnPhones): a monitor
 * criteria's Filters, Actions and Settings, inside the criteria's box. On a
 * phone it has no frame of its own - rules above and below, no sides, no
 * corners, no shadow - so it can reach out to the sides of the box it is in;
 * from sm up it is the framed section, class for class. Read the way the
 * cascade does (ResponsiveFrame), since jsdom has no stylesheet.
 */
describe("CollapsibleSection flush on a phone", () => {
  const PHONE_WIDTHS: Array<number> = [320, 375, 390, 639];
  const FROM_SM_UP: Array<number> = [640, 768, 1024, 1280];

  function frameOf(): HTMLElement {
    return header().parentElement!;
  }

  test.each(["bordered", "card"] as const)(
    "%s: rules above and below on a phone, nothing at the sides",
    (variant: "bordered" | "card") => {
      renderSection({ variant: variant, isFlushOnPhones: true });

      expect(frameOf()).toHaveClass(
        ...(variant === "card"
          ? COLLAPSIBLE_SECTION_CARD_FLUSH_ON_PHONES_FRAME_CLASS_NAME
          : COLLAPSIBLE_SECTION_BORDERED_FLUSH_ON_PHONES_FRAME_CLASS_NAME
        ).split(" "),
      );

      for (const width of PHONE_WIDTHS) {
        expect([width, resolveFrame(frameOf().className, width)]).toEqual([
          width,
          {
            border: { top: 1, right: 0, bottom: 1, left: 0 },
            radius: {
              topLeft: 0,
              topRight: 0,
              bottomRight: 0,
              bottomLeft: 0,
            },
            shadow: null,
          },
        ]);
      }
    },
  );

  test.each(["bordered", "card"] as const)(
    "%s: from sm up, the framed section it always was",
    (variant: "bordered" | "card") => {
      render(
        <>
          <div data-testid="framed">
            <CollapsibleSection title="Filters" variant={variant}>
              <p>filters</p>
            </CollapsibleSection>
          </div>
          <div data-testid="flush">
            <CollapsibleSection
              title="Actions"
              variant={variant}
              isFlushOnPhones={true}
            >
              <p>actions</p>
            </CollapsibleSection>
          </div>
        </>,
      );

      const framed: HTMLElement = screen.getByTestId("framed")
        .firstElementChild as HTMLElement;
      const flush: HTMLElement = screen.getByTestId("flush")
        .firstElementChild as HTMLElement;

      expect(framed).toHaveClass(
        ...(variant === "card"
          ? COLLAPSIBLE_SECTION_CARD_FRAME_CLASS_NAME
          : COLLAPSIBLE_SECTION_BORDERED_FRAME_CLASS_NAME
        ).split(" "),
      );

      for (const width of FROM_SM_UP) {
        expect([width, resolveFrame(flush.className, width)]).toEqual([
          width,
          resolveFrame(framed.className, width),
        ]);
      }

      // The header's band and the body's padding are the same at every width.
      const framedHeader: HTMLElement = framed.firstElementChild as HTMLElement;
      const flushHeader: HTMLElement = flush.firstElementChild as HTMLElement;

      expect(flushHeader.className).toBe(framedHeader.className);
      expect(
        (flush.lastElementChild!.firstElementChild as HTMLElement).className,
      ).toBe(
        (framed.lastElementChild!.firstElementChild as HTMLElement).className,
      );
    },
  );

  test("the classes it is given still apply: the negative margins that take it to the box's sides", () => {
    renderSection({
      variant: "bordered",
      isFlushOnPhones: true,
      className: "mb-4 -mx-3 sm:mx-0",
    });

    expect(frameOf()).toHaveClass("mb-4", "-mx-3", "sm:mx-0");
  });

  test("a section without a frame has nothing to take away", () => {
    renderSection({ isFlushOnPhones: true });

    expect(frameOf().className.trim()).toBe("");
  });

  test("flush or framed, its frame keeps the dark theme", () => {
    for (const className of [
      COLLAPSIBLE_SECTION_BORDERED_FLUSH_ON_PHONES_FRAME_CLASS_NAME,
      COLLAPSIBLE_SECTION_CARD_FLUSH_ON_PHONES_FRAME_CLASS_NAME,
    ]) {
      expect(classesWithoutDarkTheme(className.split(" "))).toEqual([]);
    }

    expect(isRemappedForDarkTheme("sm:shadow-sm")).toBe(true);
  });
});
