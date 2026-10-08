import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { computeAccessibleDescription } from "dom-accessibility-api";
import AdvancedPageSection, {
  ADVANCED_PAGE_SECTION_SECTIONS_TEST_ID,
  ADVANCED_PAGE_SECTION_TEST_ID,
} from "../../../UI/Components/AdvancedPageSection/AdvancedPageSection";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card from "../../../UI/Components/Card/Card";
import { foldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import IconProp from "../../../Types/Icon/IconProp";
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
 *   - it is a card of its own on the page, spaced like the cards around it;
 *   - open, it is ONE card: every card in it is a section of it, with a
 *     divider across the whole card above it and no frame of its own.
 */

afterEach(() => {
  cleanup();
});

// The parts of a box: a shadow, rounded corners, a border all round.
const SHADOW: RegExp = /^shadow(-(sm|md|lg|xl|2xl))?$/;
const ROUNDED: RegExp = /^rounded(-(sm|md|lg|xl|2xl))?$/;
const EDGE: RegExp = /^(border|border-2|ring-1|ring-2)$/;

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

  /*
   * "More Settings should look like one card instead of a card inside of a
   * card, and it should have dividers." Its header is the card; every card
   * in it is a section of that card - a divider across the whole card above
   * it, and no border, rounded corners, shadow or gap of its own.
   */
  describe("is one card, not cards inside a card", () => {
    async function openWithCards(): Promise<UserEvent> {
      render(
        <AdvancedPageSection
          description="Which incidents are investigated, and limits."
          items={[
            foldedSectionItem("Investigation rules"),
            foldedSectionItem("Investigation limits"),
            foldedSectionItem("Daily limits"),
          ]}
        >
          <Card
            title="Investigation rules"
            description="With no rule, every new incident is investigated."
            buttons={[
              {
                title: "Create Investigation Rule",
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Add,
                onClick: (): void => {},
              },
            ]}
          >
            <div data-testid="rules-body">rules</div>
          </Card>
          <Card title="Investigation limits">
            <div>limits</div>
          </Card>
          <Card title="Daily limits">
            <div>daily</div>
          </Card>
        </AdvancedPageSection>,
      );

      const user: UserEvent = userEvent.setup({ delay: null });

      await user.click(header());

      return user;
    }

    function section(): HTMLElement {
      return screen.getByTestId(ADVANCED_PAGE_SECTION_TEST_ID);
    }

    /*
     * Every element in it that draws a box of its own, as a card's frame
     * does: a shadow, or rounded corners on a border all round. A clip
     * (rounded corners alone) and a divider (a top border) are not boxes.
     */
    function framesIn(root: HTMLElement): Array<HTMLElement> {
      return Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
        (element: HTMLElement): boolean => {
          const tokens: Array<string> = Array.from(element.classList);

          const hasShadow: boolean = tokens.some((token: string): boolean => {
            return SHADOW.test(token);
          });
          const isRounded: boolean = tokens.some((token: string): boolean => {
            return ROUNDED.test(token);
          });
          const hasEdge: boolean = tokens.some((token: string): boolean => {
            return EDGE.test(token);
          });

          return hasShadow || (isRounded && hasEdge);
        },
      );
    }

    test("only its own frame is drawn: the cards in it have none", async () => {
      await openWithCards();

      const frames: Array<HTMLElement> = framesIn(section()).filter(
        (element: HTMLElement): boolean => {
          // A button is a control, not a box around content.
          return element.tagName !== "BUTTON" && !element.closest("button");
        },
      );

      expect(frames).toEqual([screen.getByTestId("folded-section")]);
      expect(screen.getByTestId("folded-section")).toHaveClass(
        "rounded-xl",
        "shadow-sm",
        "border",
        "border-gray-200",
      );
    });

    test("each card in it is a section, with a divider across the whole card above it", async () => {
      await openWithCards();

      const sections: Array<HTMLElement> = within(section()).getAllByTestId(
        "card",
      );

      expect(
        sections.map((card: HTMLElement): string | null => {
          return within(card).getByTestId("card-details-heading").textContent;
        }),
      ).toEqual(["Investigation rules", "Investigation limits", "Daily limits"]);

      for (const card of sections) {
        expect(card).toHaveAttribute("data-card-surface", "section");
        expect(card).toHaveClass("border-t", "border-gray-200");
        expect(card).not.toHaveClass("mb-5");
        expect(card).not.toHaveClass("rounded-xl");
        expect(card).not.toHaveClass("shadow-sm");
      }
    });

    test("the sections sit straight under its header, in its body", async () => {
      await openWithCards();

      const sections: HTMLElement = screen.getByTestId(
        ADVANCED_PAGE_SECTION_SECTIONS_TEST_ID,
      );

      expect(body()).toContainElement(sections);
      expect(
        within(sections)
          .getAllByTestId("card")
          .every((card: HTMLElement): boolean => {
            return card.parentElement === sections;
          }),
      ).toBe(true);
    });

    test("its body adds no padding and no rule: the first section's divider is the line under the header", async () => {
      await openWithCards();

      const content: HTMLElement = body().firstElementChild as HTMLElement;

      expect(content.getAttribute("class") || "").toBe("");
      expect(content).toContainElement(
        screen.getByTestId(ADVANCED_PAGE_SECTION_SECTIONS_TEST_ID),
      );
      expect(within(section()).getAllByTestId("card")[0]).toHaveClass(
        "border-t",
      );
    });

    test("its body is rounded with its frame, so the last section ends on the card's curve", async () => {
      await openWithCards();

      expect(body()).toHaveClass("rounded-b-xl", "overflow-hidden");
    });

    test("a section keeps its header actions, at its right edge", async () => {
      await openWithCards();

      const rules: HTMLElement = within(section()).getAllByTestId("card")[0]!;
      const actions: HTMLElement =
        within(rules).getByTestId("card-header-actions");

      expect(actions).toHaveClass("ml-auto", "justify-end");
      expect(
        within(actions).getByRole("button", {
          name: "Create Investigation Rule",
        }),
      ).toBeInTheDocument();
      expect(within(rules).getByTestId("rules-body")).toBeInTheDocument();
    });

    test("folded, the sections stay mounted out of sight, and the header still names them", () => {
      render(
        <AdvancedPageSection
          items={[foldedSectionItem("Investigation rules")]}
          description="Which incidents are investigated."
        >
          <Card title="Investigation rules" />
        </AdvancedPageSection>,
      );

      expect(header()).toHaveAttribute("aria-expanded", "false");
      expect(body()).toHaveClass("max-h-0", "opacity-0", "invisible");
      expect(body()).toContainElement(screen.getByTestId("card"));
      expect(screen.getByTestId("folded-section-contents")).toHaveTextContent(
        "Investigation rules",
      );
    });
  });

  test("takes a test id of its own for a page with more than one", () => {
    renderSection({ dataTestId: "api-key-advanced-section" });

    expect(screen.getByTestId("api-key-advanced-section")).toBeInTheDocument();
    expect(screen.queryByTestId(ADVANCED_PAGE_SECTION_TEST_ID)).toBeNull();
  });
});
