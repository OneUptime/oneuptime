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
 *   - its one-line description shows while it is open;
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

  test("shows its description while open", () => {
    renderSection({
      description: "Block permissions: what this key can never do.",
    });

    expect(
      screen.queryByText("Block permissions: what this key can never do."),
    ).toBeNull();

    fireEvent.click(header());

    expect(
      screen.getByText("Block permissions: what this key can never do."),
    ).toBeInTheDocument();
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
