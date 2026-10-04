import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { computeAccessibleDescription } from "dom-accessibility-api";
import AdvancedPageSection, {
  ADVANCED_PAGE_SECTION_TEST_ID,
} from "../../../UI/Components/AdvancedPageSection/AdvancedPageSection";
import { foldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SETTINGS_SECTION_TITLE,
} from "../../../UI/Components/FoldedSection/FoldedSectionTitles";

/*
 * "More settings" on a page (UI/Components/AdvancedPageSection): the cards
 * most people never need - an API key's block permissions - folded under
 * one header, the way a form folds its rarely used fields under "More
 * fields". It was called "Advanced", like the form's; both were renamed
 * when the maintainer asked for "something better - like 'more'", and to
 * "show what things are inside it when collapsed". Pinned here:
 *
 *   - it is called More settings, and starts folded;
 *   - folded, the cards in it stay mounted (they load, and can say what they
 *     hold) but are out of sight, the tab order and screen readers;
 *   - folded, its header names the cards in it, and draws the set ones as
 *     chips that say what they are set to - "Block Permissions: 2";
 *   - a page can say what its cards' defaults do in a sentence under them;
 *   - its description says what it is for, under the title once open - and
 *     folded too on a page that names no cards;
 *   - a page that cannot say which card is set says "Configured";
 *   - it is a card of its own on the page, spaced like the cards around it.
 */

afterEach(() => {
  cleanup();
});

function header(): HTMLElement {
  return screen.getByRole("button", { name: MORE_SETTINGS_SECTION_TITLE });
}

function body(): HTMLElement {
  const bodyId: string | null = header().getAttribute("aria-controls");

  expect(bodyId).toBeTruthy();

  return document.getElementById(bodyId!)!;
}

function description(): string {
  return computeAccessibleDescription(header())
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function chips(): Array<string> {
  return screen
    .queryAllByTestId("folded-section-item")
    .filter((item: HTMLElement): boolean => {
      return item.getAttribute("data-item-set") === "true";
    })
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function renderSection(
  props: Partial<React.ComponentProps<typeof AdvancedPageSection>> = {},
): UserEvent {
  render(
    <AdvancedPageSection {...props}>
      <div data-testid="block-permissions-card">
        <button type="button">Add Block Permission</button>
      </div>
    </AdvancedPageSection>,
  );

  return userEvent.setup({ delay: null });
}

describe("AdvancedPageSection", () => {
  test("is called More settings - a page's fold, as More fields is a form's", () => {
    renderSection();

    expect(MORE_SETTINGS_SECTION_TITLE).toBe("More settings");
    expect(MORE_SETTINGS_SECTION_TITLE).not.toBe(MORE_FIELDS_SECTION_TITLE);
    expect(header()).toBeInTheDocument();
    expect(header().tagName).toBe("BUTTON");
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
  });

  test("starts folded, its cards mounted but out of sight and reach", () => {
    renderSection();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(body()).toHaveClass("max-h-0", "opacity-0", "invisible");
    expect(body()).toContainElement(
      screen.getByTestId("block-permissions-card"),
    );
  });

  test("opens and folds again from its header", async () => {
    const user: UserEvent = renderSection();

    await user.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(body()).not.toHaveClass("invisible");
    expect(
      screen.getByRole("button", { name: "Add Block Permission" }),
    ).toBeInTheDocument();

    await user.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(body()).toHaveClass("invisible");
  });

  test("opens from the keyboard", async () => {
    const user: UserEvent = renderSection();

    header().focus();
    await user.keyboard("{Enter}");
    expect(header()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  test("folded, it names the cards in it", () => {
    renderSection({
      description: "Block permissions: what this key can never do.",
      items: [foldedSectionItem("Block Permissions")],
    });

    const contents: HTMLElement = screen.getByTestId("folded-section-contents");

    expect(contents).toHaveTextContent("Block Permissions");
    expect(chips()).toEqual([]);
    // Read out with the header.
    expect(description()).toBe("Block Permissions");
    // Outside the folded body, so it is on screen.
    expect(body()).not.toContainElement(contents);
    // The description waits for the section to open.
    expect(header()).not.toHaveTextContent(
      "Block permissions: what this key can never do.",
    );
  });

  test("folded, a set card is a chip that says what it is set to", () => {
    renderSection({
      items: [
        foldedSectionItem("Block Permissions", {
          key: "blockPermissions",
          isSet: true,
          value: "2",
        }),
      ],
    });

    expect(chips()).toEqual(["Block Permissions: 2"]);
    expect(description()).toBe("Block Permissions: 2");
    // A set card tints the icon tile.
    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-indigo-50",
    );
    // The chip says it; no "Configured" beside it.
    expect(screen.queryByTestId("folded-section-badge")).toBeNull();
  });

  test("a set card says Configured no more, even when the page also says so", () => {
    renderSection({
      isConfigured: true,
      items: [foldedSectionItem("IP Allowlist", { isSet: true, value: "3" })],
    });

    expect(chips()).toEqual(["IP Allowlist: 3"]);
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("open, it says what it is for, under its title", async () => {
    const user: UserEvent = renderSection({
      description: "Block permissions: what this key can never do.",
      items: [foldedSectionItem("Block Permissions")],
    });

    await user.click(header());

    expect(screen.queryByTestId("folded-section-contents")).toBeNull();
    expect(
      within(header()).getByText(
        "Block permissions: what this key can never do.",
      ),
    ).toBeInTheDocument();
  });

  /*
   * A page can say, while it is folded, what the cards in it are set to -
   * what the defaults do, on the AI settings pages: "Every incident is
   * investigated, whatever its severity, and nothing limits how much
   * OneUptime AI does."
   */
  test("folded, a summary says what its cards' defaults do, under their names", () => {
    renderSection({
      description: "Which incidents are investigated, and limits.",
      items: [
        foldedSectionItem("Which incidents are investigated"),
        foldedSectionItem("Investigation limits"),
        foldedSectionItem("Daily limits"),
      ],
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
    expect(description()).toBe(
      "Which incidents are investigated, Investigation limits, Daily limits Every incident is investigated, and nothing limits AI.",
    );
  });

  test("open, it says what it is for again, not the summary", async () => {
    const user: UserEvent = renderSection({
      description: "Which incidents are investigated, and limits.",
      summary: "Every incident is investigated, and nothing limits AI.",
    });

    await user.click(header());

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

  test("a page that names no cards says what is in it while folded, as before", () => {
    renderSection({
      description: "Block permissions: what this key can never do.",
    });

    const summary: HTMLElement = screen.getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent(
      "Block permissions: what this key can never do.",
    );
    expect(header()).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(summary.id),
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

  test("a page that cannot say which card is set says Configured, folded only", async () => {
    const user: UserEvent = renderSection({ isConfigured: true });

    expect(screen.getByTestId("folded-section-badge")).toHaveTextContent(
      "Configured",
    );

    await user.click(header());

    expect(header()).not.toHaveTextContent("Configured");
  });

  test("says nothing of the kind when nothing in it is set", () => {
    renderSection({ isConfigured: false });

    expect(header()).not.toHaveTextContent("Configured");

    cleanup();
    renderSection();

    expect(header()).not.toHaveTextContent("Configured");
  });

  test("with nothing to say, folded says nothing under its title", () => {
    renderSection();

    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(screen.queryByTestId("folded-section-contents")).toBeNull();
    expect(header()).not.toHaveAttribute("aria-describedby");
  });

  test("is a card of its own, spaced like the cards around it", () => {
    renderSection();

    const section: HTMLElement = screen.getByTestId(
      ADVANCED_PAGE_SECTION_TEST_ID,
    );

    expect(section).toHaveClass("mb-5");
    expect(within(section).getByRole("button", { name: "More settings" })).toBe(
      header(),
    );
    // A card among cards: rounded like them, with their shadow.
    expect(within(section).getByTestId("folded-section")).toHaveClass(
      "rounded-xl",
      "shadow-sm",
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
