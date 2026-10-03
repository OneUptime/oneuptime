import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import AdvancedPageSection, {
  ADVANCED_PAGE_SECTION_TEST_ID,
} from "../../../UI/Components/AdvancedPageSection/AdvancedPageSection";
import { ADVANCED_FORM_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * "Advanced" on a page (UI/Components/AdvancedPageSection): the cards most
 * people never need - an API key's block permissions - folded under one
 * header, the way a form folds its rarely used fields. Pinned here:
 *
 *   - it is called what a form's section is called, and starts folded;
 *   - folded, the cards in it stay mounted (they load, and can say what they
 *     hold) but are out of sight, the tab order and screen readers;
 *   - the header says "Configured" while something in it is set, and only
 *     while folded - open, the cards say it themselves;
 *   - its one-line description says what is in it, folded or open, and
 *     describes the folded header for a screen reader - unless the page
 *     gives a summary of what its cards are set to, which the folded
 *     header says instead;
 *   - it is a block of its own on the page, spaced like a card.
 */

afterEach(() => {
  cleanup();
});

function header(): HTMLElement {
  return screen.getByRole("button", { name: ADVANCED_FORM_SECTION_TITLE });
}

function body(): HTMLElement {
  const bodyId: string | null = header().getAttribute("aria-controls");

  expect(bodyId).toBeTruthy();

  return document.getElementById(bodyId!)!;
}

function renderSection(
  props: Partial<React.ComponentProps<typeof AdvancedPageSection>> = {},
): void {
  render(
    <AdvancedPageSection {...props}>
      <div data-testid="block-permissions-card">
        <button type="button">Add Block Permission</button>
      </div>
    </AdvancedPageSection>,
  );
}

describe("AdvancedPageSection", () => {
  test("is called Advanced, as a form's folded section is", () => {
    renderSection();

    expect(ADVANCED_FORM_SECTION_TITLE).toBe("Advanced");
    expect(header()).toBeInTheDocument();
  });

  test("starts folded, its cards mounted but out of sight and reach", () => {
    renderSection();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(body()).toHaveClass("max-h-0", "opacity-0", "invisible");
    expect(body()).toContainElement(
      screen.getByTestId("block-permissions-card"),
    );
  });

  test("opens and folds again from its header", () => {
    renderSection();

    fireEvent.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(body()).not.toHaveClass("invisible");
    expect(
      screen.getByRole("button", { name: "Add Block Permission" }),
    ).toBeInTheDocument();

    fireEvent.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(body()).toHaveClass("invisible");
  });

  test("opens from the keyboard", () => {
    renderSection();

    fireEvent.keyDown(header(), { key: "Enter" });
    expect(header()).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(header(), { key: " " });
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  test("says Configured while folded when something in it is set", () => {
    renderSection({ isConfigured: true });

    expect(header()).toHaveTextContent("Configured");

    fireEvent.click(header());

    expect(header()).not.toHaveTextContent("Configured");
  });

  test("says nothing of the kind when nothing in it is set", () => {
    renderSection({ isConfigured: false });

    expect(header()).not.toHaveTextContent("Configured");

    cleanup();
    renderSection();

    expect(header()).not.toHaveTextContent("Configured");
  });

  test("says what is in it while folded, without being opened", () => {
    renderSection({
      description: "Block permissions: what this key can never do.",
    });

    expect(header()).toHaveAttribute("aria-expanded", "false");

    const summary: HTMLElement = screen.getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent(
      "Block permissions: what this key can never do.",
    );
    // Read out with the header, not only seen.
    expect(header()).toHaveAttribute("aria-describedby", summary.id);
    // Outside the folded body, so it is on screen.
    expect(body()).not.toContainElement(summary);
  });

  test("still says it once opened, in the header", () => {
    renderSection({
      description: "Block permissions: what this key can never do.",
    });

    fireEvent.click(header());

    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(
      within(header()).getByText(
        "Block permissions: what this key can never do.",
      ),
    ).toBeInTheDocument();
  });

  test("says Configured beside what is in it", () => {
    renderSection({
      description: "Block permissions: what this key can never do.",
      isConfigured: true,
    });

    expect(header()).toHaveTextContent("Configured");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Block permissions: what this key can never do.",
    );
  });

  /*
   * A page can say, while it is folded, what the cards in it are set to -
   * what the defaults do, on the AI settings pages: "Every incident is
   * investigated, whatever its severity, and nothing limits how much
   * OneUptime AI does."
   */
  test("folded, a summary says what its cards are set to, in place of what is in it", () => {
    renderSection({
      description: "Which incidents are investigated, and limits.",
      summary: "Every incident is investigated, and nothing limits AI.",
    });

    const summary: HTMLElement = screen.getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent(
      "Every incident is investigated, and nothing limits AI.",
    );
    expect(header()).not.toHaveTextContent(
      "Which incidents are investigated, and limits.",
    );
    // Read out with the header, like the description it stands in for.
    expect(header()).toHaveAttribute("aria-describedby", summary.id);
  });

  test("open, it says what is in it again, not the summary", () => {
    renderSection({
      description: "Which incidents are investigated, and limits.",
      summary: "Every incident is investigated, and nothing limits AI.",
    });

    fireEvent.click(header());

    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(
      within(header()).getByText(
        "Which incidents are investigated, and limits.",
      ),
    ).toBeInTheDocument();
    expect(header()).not.toHaveTextContent(
      "Every incident is investigated, and nothing limits AI.",
    );
  });

  test("without a summary, folded it says what is in it", () => {
    renderSection({
      description: "Which incidents are investigated, and limits.",
      summary: undefined,
    });

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Which incidents are investigated, and limits.",
    );
  });

  test("a summary can be an element, drawn as it is", () => {
    renderSection({
      description: "Which incidents are investigated, and limits.",
      summary: <span data-testid="the-summary">Every incident.</span>,
    });

    expect(
      within(screen.getByTestId("collapsible-section-summary")).getByTestId(
        "the-summary",
      ),
    ).toHaveTextContent("Every incident.");
  });

  test("with no description, folded says nothing under its title", () => {
    renderSection();

    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(header()).not.toHaveAttribute("aria-describedby");
  });

  test("is a block of its own, spaced like the cards around it", () => {
    renderSection();

    const section: HTMLElement = screen.getByTestId(
      ADVANCED_PAGE_SECTION_TEST_ID,
    );

    expect(section).toHaveClass("mb-5");
    expect(within(section).getByRole("button", { name: "Advanced" })).toBe(
      header(),
    );
  });

  test("frames the cards in it with its own padding, not their page margins", () => {
    renderSection();

    const cards: HTMLElement = screen.getByTestId("block-permissions-card")
      .parentElement as HTMLElement;

    // A card's margin under it is for the next card on the page.
    expect(cards).toHaveClass("[&_[data-testid=card]]:mb-0");
    // Two cards in here still sit a card's gap apart.
    expect(cards).toHaveClass("space-y-5");
    expect(body()).toContainElement(cards);
  });

  test("takes a test id of its own for a page with more than one", () => {
    renderSection({ dataTestId: "api-key-advanced-section" });

    expect(screen.getByTestId("api-key-advanced-section")).toBeInTheDocument();
    expect(screen.queryByTestId(ADVANCED_PAGE_SECTION_TEST_ID)).toBeNull();
  });
});
