import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import FoldedSection, {
  FOLDED_SECTION_TEST_ID,
} from "../../../../UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "../../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
  MORE_SETTINGS_SECTION_TITLE,
} from "../../../../UI/Components/FoldedSection/FoldedSectionTitles";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { computeAccessibleDescription } from "dom-accessibility-api";
import { ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME } from "../../../../UI/Components/Icon/Icon";

/*
 * FoldedSection draws every fold of rarely needed options: a form's More
 * fields, a page's More settings, and every other section a form folds
 * fields into. Two looks:
 *
 *   - More fields is one quiet line. The maintainer, on the card it used to
 *     be (an icon tile, a bold title, a row of pills): "Can we make this
 *     more subtle, this needs to be done across the project for more
 *     fields. Takes up too much real estate right now." So: no frame, no
 *     tile, no pills - a small chevron, "More fields" as a link, and what is
 *     inside after it, "More fields · Description, Labels", the set ones a
 *     shade darker with what they are set to. Open, the fields follow it as
 *     part of the form.
 *   - Every other fold is a card: More settings among a page's cards, and
 *     the sections a form folds that are named for what they hold.
 *
 * Pinned here, for both:
 *   - the header is a real button, named by the title alone, that says
 *     which way it is folded and which body it controls;
 *   - folded, it lists what is inside - a few names, then how many more -
 *     with the set ones saying what they are set to, and the sentences that
 *     say what its defaults do; all of it describes the button for a screen
 *     reader;
 *   - open, the list gives way to the description and the body;
 *   - folded, the body stays mounted but is out of sight and reach.
 */

afterEach(() => {
  cleanup();
});

const DECLARE_ITEMS: Array<FoldedSectionItem> = [
  { key: "declaredAt", title: "Declared At", isSet: false },
  {
    key: "initialState",
    title: "Initial State",
    isSet: true,
    value: "Investigating",
    translateValue: true,
  },
  { key: "labels", title: "Labels", isSet: true, value: "2" },
  {
    key: "isPrivate",
    title: "Private Incident",
    isSet: true,
    value: "On",
    translateValue: true,
  },
];

const NOTHING_SET: Array<FoldedSectionItem> = DECLARE_ITEMS.map(
  (item: FoldedSectionItem): FoldedSectionItem => {
    return { key: item.key, title: item.title, isSet: false };
  },
);

// A form's section named for what it holds: drawn as a card.
const NAMED_SECTION_TITLE: string = "Subscriber Notifications";

function header(name: string = MORE_FIELDS_SECTION_TITLE): HTMLElement {
  return screen.getByRole("button", { name });
}

function body(name?: string): HTMLElement {
  return document.getElementById(header(name).getAttribute("aria-controls")!)!;
}

function fold(): HTMLElement {
  return screen.getByTestId(FOLDED_SECTION_TEST_ID);
}

/*
 * What a screen reader reads after the header's name, spaces evened out:
 * each name is an element of its own, so the reading can put a space on
 * either side of it before the comma between two.
 */
function description(element: HTMLElement = header()): string {
  return computeAccessibleDescription(element)
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function texts(elements: Array<HTMLElement>): Array<string | null> {
  return elements.map((element: HTMLElement): string | null => {
    return element.textContent;
  });
}

function renderSection(
  props: Partial<React.ComponentProps<typeof FoldedSection>> = {},
): UserEvent {
  render(
    <FoldedSection title={MORE_FIELDS_SECTION_TITLE} {...props}>
      <label>
        Note
        <input aria-label="Note" />
      </label>
    </FoldedSection>,
  );

  return userEvent.setup({ delay: null });
}

function renderCard(
  props: Partial<React.ComponentProps<typeof FoldedSection>> = {},
): UserEvent {
  return renderSection({ title: NAMED_SECTION_TITLE, ...props });
}

describe.each([
  ["More fields, a line", MORE_FIELDS_SECTION_TITLE],
  ["a named section, a card", NAMED_SECTION_TITLE],
])("%s: the header", (_look: string, title: string) => {
  test("is a real button named by the title alone, folded to start with", () => {
    renderSection({ title, items: DECLARE_ITEMS });

    const button: HTMLElement = header(title);

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    // What is inside describes it; it does not lengthen its name.
    expect(button).toHaveAccessibleName(title);
    expect(body(title)).toBeInTheDocument();
    expect(body(title).id).toBe(button.getAttribute("aria-controls"));
  });

  test("opens and folds again on a click, and says so", async () => {
    const onToggle: MockFunction = getJestMockFunction();
    const user: UserEvent = renderSection({
      title,
      items: NOTHING_SET,
      onToggle,
    });

    await user.click(header(title));

    expect(header(title)).toHaveAttribute("aria-expanded", "true");
    expect(body(title)).not.toHaveClass("invisible");
    expect(fold()).toHaveAttribute("data-collapsed", "false");

    await user.click(header(title));

    expect(header(title)).toHaveAttribute("aria-expanded", "false");
    expect(fold()).toHaveAttribute("data-collapsed", "true");
    expect(onToggle.mock.calls).toEqual([[false], [true]]);
  });

  test("opens from the keyboard, as any button does", async () => {
    const user: UserEvent = renderSection({ title, items: NOTHING_SET });

    await user.tab();
    expect(header(title)).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(header(title)).toHaveAttribute("aria-expanded", "true");

    // Open, the field inside is the next stop.
    await user.tab();
    expect(screen.getByLabelText("Note")).toHaveFocus();

    await user.tab({ shift: true });
    await user.keyboard(" ");
    expect(header(title)).toHaveAttribute("aria-expanded", "false");
  });

  test("starts open when told to, and follows a controlled state", () => {
    const { rerender } = render(
      <FoldedSection title={title} isCollapsed={false}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(header(title)).toHaveAttribute("aria-expanded", "true");

    rerender(
      <FoldedSection title={title} isCollapsed={true}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(header(title)).toHaveAttribute("aria-expanded", "false");

    cleanup();

    render(
      <FoldedSection title={title} defaultCollapsed={false}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(header(title)).toHaveAttribute("aria-expanded", "true");
  });

  test("never submits the form it is in", async () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <form
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <FoldedSection title={title}>
          <span>inside</span>
        </FoldedSection>
      </form>,
    );

    await userEvent.setup({ delay: null }).click(header(title));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(header(title)).toHaveAttribute("aria-expanded", "true");
  });

  test("folded, the body stays mounted, out of sight, the tab order and screen readers", async () => {
    const user: UserEvent = renderSection({ title, items: NOTHING_SET });

    expect(body(title)).toHaveClass("max-h-0", "opacity-0", "invisible");
    expect(body(title)).toContainElement(screen.getByLabelText("Note"));

    await user.click(header(title));
    await user.type(screen.getByLabelText("Note"), "Ask the platform team");
    await user.click(header(title));

    expect(body(title)).toHaveClass("invisible");
    expect(screen.getByLabelText("Note")).toHaveValue("Ask the platform team");
  });

  test("the list and the summary give way to the description once open", async () => {
    const user: UserEvent = renderSection({
      title,
      items: DECLARE_ITEMS,
      summary: "Defaults apply.",
      description: "Options most incidents never need.",
    });

    // Folded, the description is not drawn.
    expect(screen.queryByTestId("folded-section-description")).toBeNull();

    await user.click(header(title));

    expect(screen.queryByTestId("folded-section-contents")).toBeNull();
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(screen.getByTestId("folded-section-description")).toHaveTextContent(
      "Options most incidents never need.",
    );
    expect(header(title)).toHaveAccessibleDescription(
      "Options most incidents never need.",
    );

    await user.click(header(title));

    expect(screen.getByTestId("folded-section-contents")).toBeInTheDocument();
    expect(screen.queryByTestId("folded-section-description")).toBeNull();
  });

  test("says nothing after the title when there is nothing to say", () => {
    renderSection({ title });

    expect(screen.queryByTestId("folded-section-contents")).toBeNull();
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(header(title)).not.toHaveAttribute("aria-describedby");
  });

  test("takes a test id of its own", () => {
    renderSection({ title, dataTestId: "monitor-step-more-fields" });

    expect(screen.getByTestId("monitor-step-more-fields")).toBeInTheDocument();
  });
});

describe("More fields is one quiet line", () => {
  test("whatever it is given: no frame, no icon tile, no pills", () => {
    // An icon, an elevated or flush body: a card's, and More fields is no card.
    renderSection({
      items: DECLARE_ITEMS,
      icon: MORE_SECTION_ICON,
      isElevated: true,
      isBodyFlush: true,
      variant: "card",
    });

    expect(fold()).toHaveAttribute("data-variant", "line");
    expect(fold().className).not.toMatch(/\bborder\b|\bbg-white\b|\brounded/);
    expect(fold()).not.toHaveClass("shadow-sm");
    expect(screen.queryByTestId("folded-section-icon")).toBeNull();

    for (const item of screen.getAllByTestId("folded-section-item")) {
      expect(item.className).not.toMatch(/rounded-full|ring-|\bbg-/);
    }
  });

  test("names what it holds after its title, in one sentence: More fields · Description, Labels", () => {
    renderSection({
      items: [
        { key: "description", title: "Description", isSet: false },
        { key: "labels", title: "Labels", isSet: false },
      ],
    });

    expect(header()).toHaveTextContent(
      /^More fields\s*·\s*Description, Labels$/,
    );
    expect(texts(screen.getAllByTestId("folded-section-item"))).toEqual([
      "Description",
      "Labels",
    ]);
    // Read out with the header: the names, a comma between two.
    expect(description()).toBe("Description, Labels");
    // The dot between the title and the list is drawing, not words.
    const dot: HTMLElement = screen.getByText("·");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    // Inside the header, outside the folded body: on screen while folded.
    expect(header()).toContainElement(
      screen.getByTestId("folded-section-contents"),
    );
    expect(body()).not.toContainElement(
      screen.getByTestId("folded-section-contents"),
    );
  });

  test("says what each set one is set to, a shade darker than the names", () => {
    renderSection({ items: DECLARE_ITEMS });

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "folded-section-item",
    );

    expect(texts(items)).toEqual([
      "Declared At",
      "Initial State: Investigating",
      "Labels: 2",
      "Private Incident: On",
    ]);
    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-item-set");
      }),
    ).toEqual(["false", "true", "true", "true"]);

    /*
     * The names are the list's grey; what is set is a shade darker and
     * medium - and still a step quieter than a field's own label
     * (text-gray-700), so "Labels: 2" never reads as a label.
     */
    expect(screen.getByTestId("folded-section-contents")).toHaveClass(
      "text-gray-500",
    );
    expect(items[0]!.className).toBe("");

    for (const item of items.slice(1)) {
      expect(item).toHaveClass("font-medium", "text-gray-600");
      expect(item).not.toHaveClass("text-gray-700");
    }

    expect(description()).toBe(
      "Declared At, Initial State: Investigating, Labels: 2, Private Incident: On",
    );
  });

  test("a set item without a value is its name alone, darker", () => {
    renderSection({
      items: [{ key: "description", title: "Description", isSet: true }],
    });

    const item: HTMLElement = screen.getByTestId("folded-section-item");

    expect(item).toHaveAttribute("data-item-set", "true");
    expect(item).toHaveTextContent(/^Description$/);
    expect(item).toHaveClass("font-medium", "text-gray-600");
  });

  test("keeps a long list short: four names at most, then how many more", () => {
    renderSection({
      items: [
        "Display Name",
        "Description",
        "Show Current Status",
        "Show Uptime Percent",
        "Uptime Precision",
        "Show Status History Chart",
        "Labels",
      ].map((title: string): FoldedSectionItem => {
        return { key: title, title, isSet: false };
      }),
    });

    expect(screen.getAllByTestId("folded-section-item")).toHaveLength(4);
    expect(screen.getByTestId("folded-section-more")).toHaveTextContent(
      "3 more",
    );
    expect(description()).toBe(
      "Display Name, Description, Show Current Status, Show Uptime Percent, 3 more",
    );
  });

  test("what is set takes its places first, and is never counted away", () => {
    renderSection({
      items: [
        { key: "a", title: "Declared At", isSet: false },
        { key: "b", title: "Initial State", isSet: true, value: "Identified" },
        { key: "c", title: "Labels", isSet: true, value: "2" },
        { key: "d", title: "Private Incident", isSet: true, value: "On" },
        { key: "e", title: "Root Cause", isSet: false },
        { key: "f", title: "Remediation Notes", isSet: false },
        { key: "g", title: "Customer Impact", isSet: false },
      ],
    });

    expect(texts(screen.getAllByTestId("folded-section-item"))).toEqual([
      "Declared At",
      "Initial State: Identified",
      "Labels: 2",
      "Private Incident: On",
    ]);
    expect(screen.getByTestId("folded-section-more")).toHaveTextContent(
      "3 more",
    );
  });

  test("each name wraps to the next line whole, its comma with it", () => {
    renderSection({ items: DECLARE_ITEMS.slice(0, 3) });

    const contents: HTMLElement = screen.getByTestId("folded-section-contents");
    const entries: Array<HTMLElement> = Array.from(
      contents.children,
    ) as Array<HTMLElement>;

    expect(entries).toHaveLength(3);

    entries.forEach((entry: HTMLElement, index: number) => {
      // A unit on the line, never wider than it.
      expect(entry).toHaveClass("inline-block", "max-w-full");
      expect(entry).toContainElement(
        screen.getAllByTestId("folded-section-item")[index]!,
      );
      // The comma goes with the name before it; the last has none.
      expect(entry.textContent?.endsWith(",")).toBe(index < 2);
    });

    // The title keeps the dot on its line; the list may start the next.
    const titleAndDot: HTMLElement = screen.getByTestId(
      "folded-section-title",
    ).parentElement!;
    expect(titleAndDot).toHaveClass("whitespace-nowrap");
    expect(titleAndDot).toContainElement(screen.getByText("·"));
  });

  test("how many more is an entry of its own, never cut in two", () => {
    renderSection({
      items: ["A", "B", "C", "D", "E", "F"].map(
        (title: string): FoldedSectionItem => {
          return { key: title, title, isSet: false };
        },
      ),
    });

    const more: HTMLElement = screen.getByTestId("folded-section-more");

    expect(more.parentElement).toHaveClass("inline-block");
    expect(more.parentElement?.textContent).toBe("2 more");
  });

  test("says what its defaults do in a sentence of its own, under the line", () => {
    renderSection({
      items: [
        { key: "description", title: "Description", isSet: false },
        { key: "expiresAt", title: "Expires", isSet: false },
      ],
      summary: "The key expires a year from today.",
    });

    const summary: HTMLElement = screen.getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent("The key expires a year from today.");
    // A line of its own, under the title, inside the header.
    expect(summary).toHaveClass("block", "text-gray-500");
    expect(header()).toContainElement(summary);
    expect(description()).toBe(
      "Description, Expires The key expires a year from today.",
    );
    // It wraps on a phone rather than being cut off.
    expect(summary).toHaveClass("break-words");
  });

  test("a summary can be an element, drawn as it is", () => {
    renderSection({
      summary: <span data-testid="the-summary">When no criteria match.</span>,
    });

    expect(
      within(screen.getByTestId("collapsible-section-summary")).getByTestId(
        "the-summary",
      ),
    ).toHaveTextContent("When no criteria match.");
  });

  test("a badge for a section that knows something is set but not what", () => {
    renderSection({ badge: "Configured" });

    expect(screen.getByTestId("folded-section-badge")).toHaveTextContent(
      "Configured",
    );
    // As a set item reads: what is in force, a shade darker than the names.
    expect(screen.getByTestId("folded-section-badge")).toHaveClass(
      "font-medium",
      "text-gray-600",
    );
    expect(header()).toHaveAccessibleDescription("Configured");
  });

  test("after the names, the badge is the last entry", () => {
    renderSection({
      items: [{ key: "description", title: "Description", isSet: false }],
      badge: "Configured",
    });

    expect(screen.getByTestId("folded-section-contents")).toHaveTextContent(
      "Description, Configured",
    );
  });

  test("open, it says only its title - and its description, after the dot", async () => {
    const user: UserEvent = renderSection({
      items: DECLARE_ITEMS,
      description: "Headers, body and timeouts",
    });

    await user.click(header());

    expect(header()).toHaveTextContent(
      /^More fields\s*·\s*Headers, body and timeouts$/,
    );

    cleanup();

    const userWithout: UserEvent = renderSection({ items: DECLARE_ITEMS });

    await userWithout.click(header());

    expect(header()).toHaveTextContent(/^More fields$/);
    expect(screen.queryByText("·")).toBeNull();
  });

  test("the title is a quiet link: indigo, medium, darker and underlined on hover", () => {
    renderSection({ items: NOTHING_SET });

    expect(screen.getByTestId("folded-section-title")).toHaveClass(
      "font-medium",
      "text-indigo-600",
      "group-hover:text-indigo-800",
      // The cue the dark theme keeps, where both indigos are one colour.
      "group-hover:underline",
      "underline-offset-2",
    );
    expect(header()).toHaveClass(
      "group",
      "text-sm",
      "text-start",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
    );
    // As wide as what it says, not the form: the space beside it is no control.
    expect(header()).toHaveClass("inline-flex", "max-w-full");
    expect(header()).not.toHaveClass("w-full");
  });

  test("the chevron points the way it opens, and turns down once open", async () => {
    const user: UserEvent = renderSection({ items: NOTHING_SET });

    const chevron: () => SVGElement = (): SVGElement => {
      return screen
        .getByTestId("folded-section-chevron")
        .querySelector("svg") as SVGElement;
    };

    expect(screen.getByTestId("folded-section-chevron")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    /*
     * Folded: to the line's end - left on a right-to-left page, where Icon
     * draws a chevron mirrored. Mirrored after its own turn, so once open
     * it points down in either direction; no turn of its own for right to
     * left, which would point it back the wrong way.
     */
    expect(chevron().getAttribute("class")).toContain(
      ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
    );
    expect(chevron().getAttribute("class")).not.toContain("rotate-90");
    expect(chevron().getAttribute("class")).not.toContain("rtl:");
    expect(chevron().getAttribute("class")).toContain(
      "motion-reduce:transition-none",
    );

    await user.click(header());

    expect(chevron().getAttribute("class")).toContain("rotate-90");
    expect(chevron().getAttribute("class")).toContain(
      ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
    );
    expect(chevron().getAttribute("class")).not.toContain("rtl:");
  });

  test("open, its fields follow the line as part of the form: no frame, no padding at the sides, nothing clipped", async () => {
    const user: UserEvent = renderSection({ items: NOTHING_SET });

    const content: HTMLElement = body().firstElementChild as HTMLElement;

    // A gap under the line, and nothing else of its own.
    expect(content.className).toBe("pt-3");

    await user.click(header());

    // An input's focus ring reaches past its edge: nothing cuts it off.
    expect(body()).not.toHaveClass("overflow-hidden", "max-h-0");
    expect(body()).toHaveClass("opacity-100");
  });

  test("a More fields fold asked to be a card is still the line", () => {
    renderSection({ variant: "card", items: NOTHING_SET });

    expect(fold()).toHaveAttribute("data-variant", "line");
  });

  test("another fold can ask for the line", () => {
    renderCard({ variant: "line", items: NOTHING_SET });

    expect(fold()).toHaveAttribute("data-variant", "line");
    expect(header(NAMED_SECTION_TITLE)).toHaveTextContent(
      /^Subscriber Notifications/,
    );
  });
});

describe("every other fold is a card", () => {
  test("a named section, drawn with pills and chips", () => {
    renderCard({ items: DECLARE_ITEMS });

    expect(fold()).toHaveAttribute("data-variant", "card");
    expect(fold()).toHaveClass("rounded-lg", "border", "bg-white");

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "folded-section-item",
    );

    expect(texts(items)).toEqual([
      "Declared At",
      "Initial State: Investigating",
      "Labels: 2",
      "Private Incident: On",
    ]);
    expect(items[0]).toHaveClass("rounded-full", "ring-gray-200");

    for (const chip of items.slice(1)) {
      expect(chip).toHaveClass("bg-indigo-50", "text-indigo-700");
    }

    expect(description(header(NAMED_SECTION_TITLE))).toBe(
      "Declared At, Initial State: Investigating, Labels: 2, Private Incident: On",
    );
  });

  test("its icon tile is grey while nothing inside is set, and tinted once something is", () => {
    renderCard({ items: NOTHING_SET, icon: MORE_SECTION_ICON });

    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-gray-100",
      "text-gray-500",
    );

    cleanup();
    renderCard({ items: DECLARE_ITEMS, icon: MORE_SECTION_ICON });

    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-indigo-50",
      "text-indigo-600",
    );
    // Decorative: the title names the section.
    expect(screen.getByTestId("folded-section-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("a card without an icon has no tile", () => {
    renderCard({});

    expect(screen.queryByTestId("folded-section-icon")).toBeNull();
  });

  test("its chevron turns over when it opens", async () => {
    const user: UserEvent = renderCard({ items: NOTHING_SET });

    const chevron: SVGElement = screen
      .getByTestId("folded-section-chevron")
      .querySelector("svg")!;

    expect(chevron.getAttribute("class")).not.toContain("-rotate-180");
    expect(chevron.getAttribute("class")).toContain("transition-transform");

    await user.click(header(NAMED_SECTION_TITLE));

    expect(
      screen
        .getByTestId("folded-section-chevron")
        .querySelector("svg")!
        .getAttribute("class"),
    ).toContain("-rotate-180");
  });

  test("its header has a focus ring and a hover tint, and does not move without reason", () => {
    renderCard({ items: NOTHING_SET });

    expect(header(NAMED_SECTION_TITLE)).toHaveClass(
      "hover:bg-gray-50",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "text-left",
      "w-full",
    );
    expect(body(NAMED_SECTION_TITLE)).toHaveClass(
      "motion-reduce:transition-none",
    );
  });

  /*
   * A page's More settings that holds one card has no description: open,
   * its header is the title alone, and the card under it says what it is.
   * The title then sits level with the icon tile beside it; with anything
   * under it - the names folded, a description open - it starts at the
   * tile's top edge, its lines running down from there.
   */
  test("its title sits level with the icon tile while nothing is under it", async () => {
    const user: UserEvent = renderSection({
      title: MORE_SETTINGS_SECTION_TITLE,
      icon: MORE_SECTION_ICON,
      isElevated: true,
      items: NOTHING_SET,
    });

    // Folded: the names run under the title, from the tile's top edge.
    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveClass("items-start");
    expect(header(MORE_SETTINGS_SECTION_TITLE)).not.toHaveClass("items-center");

    await user.click(header(MORE_SETTINGS_SECTION_TITLE));

    // Open, with no description: the title alone, level with the tile.
    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveTextContent(
      /^More settings$/,
    );
    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveClass("items-center");
    expect(header(MORE_SETTINGS_SECTION_TITLE)).not.toHaveClass("items-start");
  });

  test("open with a description, the title starts at the tile's top edge, over it", async () => {
    const user: UserEvent = renderSection({
      title: MORE_SETTINGS_SECTION_TITLE,
      icon: MORE_SECTION_ICON,
      isElevated: true,
      items: NOTHING_SET,
      description: "What this fold holds.",
    });

    await user.click(header(MORE_SETTINGS_SECTION_TITLE));

    expect(screen.getByTestId("folded-section-description")).toHaveTextContent(
      "What this fold holds.",
    );
    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveClass("items-start");
    expect(header(MORE_SETTINGS_SECTION_TITLE)).not.toHaveClass("items-center");
  });

  test("folded with only a summary or a badge, the title still starts at the top", () => {
    renderSection({
      title: MORE_SETTINGS_SECTION_TITLE,
      icon: MORE_SECTION_ICON,
      isElevated: true,
      summary: "Every incident is investigated.",
    });

    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveClass("items-start");

    cleanup();
    renderSection({
      title: MORE_SETTINGS_SECTION_TITLE,
      icon: MORE_SECTION_ICON,
      isElevated: true,
      badge: "Configured",
    });

    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveClass("items-start");
  });

  test("on a page, among cards, More settings is a card itself", () => {
    renderSection({
      title: MORE_SETTINGS_SECTION_TITLE,
      icon: MORE_SECTION_ICON,
      isElevated: true,
    });

    expect(fold()).toHaveAttribute("data-variant", "card");
    expect(fold()).toHaveClass("rounded-xl", "shadow-sm", "border");
    expect(header(MORE_SETTINGS_SECTION_TITLE)).toHaveClass("px-5", "md:px-6");
    expect(screen.getByTestId("folded-section-icon")).toBeInTheDocument();
  });

  test("in a form, a named section sits inside the form's own card", () => {
    renderCard({});

    expect(fold()).toHaveClass("rounded-lg", "border");
    expect(fold()).not.toHaveClass("shadow-sm");
    expect(fold()).toHaveAttribute("data-collapsed", "true");
  });

  /*
   * A page's More settings holds cards as its sections (CardSections): each
   * pads itself and draws the divider above it, so the body adds neither,
   * and is rounded with the frame so the last section ends on its curve.
   */
  test("by default the body pads what it holds, under a rule", () => {
    renderCard({ isElevated: true });

    const content: HTMLElement = body(NAMED_SECTION_TITLE)
      .firstElementChild as HTMLElement;

    expect(content).toHaveClass("border-t", "border-gray-200", "px-5", "py-5");
    expect(body(NAMED_SECTION_TITLE)).not.toHaveClass("rounded-b-xl");
    expect(body(NAMED_SECTION_TITLE)).not.toHaveClass("rounded-b-lg");
  });

  test("a flush body adds no padding and no rule: what it holds pads itself", () => {
    renderCard({ isElevated: true, isBodyFlush: true });

    const content: HTMLElement = body(NAMED_SECTION_TITLE)
      .firstElementChild as HTMLElement;

    expect(content.getAttribute("class") || "").toBe("");
    expect(content).toContainElement(screen.getByLabelText("Note"));
  });

  test("a flush body is rounded with the frame and clips to it", () => {
    renderCard({ isElevated: true, isBodyFlush: true });

    expect(body(NAMED_SECTION_TITLE)).toHaveClass(
      "rounded-b-xl",
      "overflow-hidden",
    );
    expect(fold()).toHaveClass("rounded-xl");

    cleanup();
    renderCard({ isBodyFlush: true });

    // A form's fold has the smaller corners, and so does its body.
    expect(body(NAMED_SECTION_TITLE)).toHaveClass(
      "rounded-b-lg",
      "overflow-hidden",
    );
    expect(fold()).toHaveClass("rounded-lg");
  });

  test("a flush body still folds out of sight and reach, and opens", async () => {
    const user: UserEvent = renderCard({
      isElevated: true,
      isBodyFlush: true,
    });

    expect(body(NAMED_SECTION_TITLE)).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );

    await user.click(header(NAMED_SECTION_TITLE));

    expect(header(NAMED_SECTION_TITLE)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(body(NAMED_SECTION_TITLE)).not.toHaveClass("invisible");
    expect(body(NAMED_SECTION_TITLE)).toHaveClass("rounded-b-xl");
  });

  /*
   * A card fold can hold a whole guide: the Microsoft Teams setup guide
   * folded on a self-hosted server's Microsoft Teams page is taller than
   * 5,000 pixels on a desktop and twice that on a phone. Under a
   * max-h-[5000px] (with overflow-hidden, for the rounded corners) its last
   * sections - the AADSTS50194 troubleshooting among them - were cut off,
   * with nothing to scroll to. Open, nothing caps the body's height.
   */
  test.each([
    [
      "an elevated card with a flush body",
      { isElevated: true, isBodyFlush: true },
    ],
    ["a card", {}],
  ])(
    "open, %s is as tall as what it holds: no height cap cuts a long guide off",
    async (
      _look: string,
      props: Partial<React.ComponentProps<typeof FoldedSection>>,
    ) => {
      const user: UserEvent = renderCard(props);

      expect(body(NAMED_SECTION_TITLE)).toHaveClass("max-h-0");

      await user.click(header(NAMED_SECTION_TITLE));

      const heightCaps: Array<string> = (
        body(NAMED_SECTION_TITLE).getAttribute("class") || ""
      )
        .split(" ")
        .filter((name: string): boolean => {
          return name.startsWith("max-h-");
        });

      expect(heightCaps).toEqual([]);
      expect(body(NAMED_SECTION_TITLE)).toHaveClass("opacity-100");

      // Folded again, it is out of sight and reach as before.
      await user.click(header(NAMED_SECTION_TITLE));

      expect(body(NAMED_SECTION_TITLE)).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );
    },
  );
});

/*
 * The shipped German wording, read from the Dashboard's de.json: the title,
 * the values of set switches and "N more" are looked up like every string.
 */
describe("in German", () => {
  const de: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "de.json",
      ),
      "utf8",
    ),
  );

  const german: i18n = createInstance();

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: { de: { translation: de } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  function renderInGerman(element: ReactElement): void {
    render(<I18nextProvider i18n={german}>{element}</I18nextProvider>);
  }

  test("the line's names, values and how many more read German", () => {
    renderInGerman(
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        items={[
          {
            key: "isPrivate",
            title: "Private Incident",
            isSet: true,
            value: "On",
            translateValue: true,
          },
          { key: "labels", title: "Labels", isSet: true, value: "2" },
          ...["A", "B", "C", "D", "E", "F"].map(
            (title: string): FoldedSectionItem => {
              return { key: title, title, isSet: false };
            },
          ),
        ]}
      >
        <span>inside</span>
      </FoldedSection>,
    );

    expect(de["More fields"]).toBe("Weitere Felder");

    const button: HTMLElement = screen.getByRole("button", {
      name: de["More fields"] as string,
    });

    expect(button).toBeInTheDocument();
    expect(fold()).toHaveAttribute("data-variant", "line");

    expect(
      texts(
        screen
          .getAllByTestId("folded-section-item")
          .filter((item: HTMLElement): boolean => {
            return item.getAttribute("data-item-set") === "true";
          }),
      ),
    ).toEqual([`${de["Private Incident"]}: ${de["On"]}`, `${de["Labels"]}: 2`]);

    // Two set ones leave two places: "A" and "B", then the other four.
    expect(screen.getByTestId("folded-section-more")).toHaveTextContent(
      "4 weitere",
    );
  });

  test("a page's fold is called More settings, in German too", () => {
    renderInGerman(
      <FoldedSection title={MORE_SETTINGS_SECTION_TITLE}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(de["More settings"]).toBe("Weitere Einstellungen");
    expect(
      screen.getByRole("button", { name: "Weitere Einstellungen" }),
    ).toBeInTheDocument();
    expect(fold()).toHaveAttribute("data-variant", "card");
  });
});

/*
 * The line's commas are words on screen now - the card's pills needed
 * none - so they are written the way the reader's script writes a list:
 * the ideographic comma, with no space after it, in Japanese and Chinese,
 * the Arabic comma in Persian (Utils/ListSeparator).
 */
describe("in Japanese, Chinese and Persian, the line is punctuated their way", () => {
  function readLocale(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Locales",
          `${language}.json`,
        ),
        "utf8",
      ),
    );
  }

  const instances: Map<string, i18n> = new Map<string, i18n>();

  beforeAll(async () => {
    for (const language of ["ja", "zh-CN", "fa"]) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        resources: { [language]: { translation: readLocale(language) } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances.set(language, instance);
    }
  });

  function renderIn(language: string, element: ReactElement): void {
    render(
      <I18nextProvider i18n={instances.get(language)!}>
        {element}
      </I18nextProvider>,
    );
  }

  // Declared At, three set ones, then three more names.
  const LONG_ITEMS: Array<FoldedSectionItem> = [
    ...DECLARE_ITEMS,
    { key: "description", title: "Description", isSet: false },
    { key: "rootCause", title: "Root Cause", isSet: false },
    { key: "remediationNotes", title: "Remediation Notes", isSet: false },
  ];

  test.each([
    ["ja", "、", ""],
    ["zh-CN", "、", ""],
    ["fa", "،", " "],
  ])(
    "%s: names, values and how many more, each with the separator its script writes",
    (language: string, mark: string, space: string) => {
      const locale: Record<string, string> = readLocale(language);

      renderIn(
        language,
        <FoldedSection title={MORE_FIELDS_SECTION_TITLE} items={LONG_ITEMS}>
          <span>inside</span>
        </FoldedSection>,
      );

      const entries: Array<string> = [
        locale["Declared At"]!,
        `${locale["Initial State"]}: ${locale["Investigating"]}`,
        `${locale["Labels"]}: 2`,
        `${locale["Private Incident"]}: ${locale["On"]}`,
        // The count as the language writes it: ۳ in Persian.
        locale["{{count}} more"]!.replace(
          "{{count}}",
          (3).toLocaleString(language),
        ),
      ];

      for (const entry of entries) {
        expect(entry).not.toContain("undefined");
      }

      const contents: HTMLElement = screen.getByTestId(
        "folded-section-contents",
      );

      // On screen: the mark after every entry but the last, then the space.
      expect(contents.textContent).toBe(entries.join(`${mark}${space}`));
      expect(contents.textContent).not.toContain(",");

      // Each entry still wraps whole, its mark with it.
      const units: Array<Element> = Array.from(contents.children);

      expect(units).toHaveLength(entries.length);

      units.forEach((unit: Element, index: number) => {
        expect(unit).toHaveClass("inline-block");
        expect(unit.textContent).toBe(
          index < entries.length - 1
            ? `${entries[index]}${mark}`
            : entries[index],
        );
      });
    },
  );

  test("names a locale has not translated keep their English commas", () => {
    renderIn(
      "ja",
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        items={[
          { key: "tier", title: "Customer Tier", isSet: false },
          { key: "impact", title: "Customer Impact", isSet: false },
        ]}
      >
        <span>inside</span>
      </FoldedSection>,
    );

    // The title is Japanese; the names, and so their list, are English.
    expect(readLocale("ja")["More fields"]).toBe("その他の項目");
    expect(
      screen.getByRole("button", { name: "その他の項目" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("folded-section-contents").textContent).toBe(
      "Customer Tier, Customer Impact",
    );
  });

  test("a card reads its pills out with the same separator", () => {
    renderIn(
      "ja",
      <FoldedSection title={NAMED_SECTION_TITLE} items={DECLARE_ITEMS}>
        <span>inside</span>
      </FoldedSection>,
    );

    const separators: Array<string | null> = Array.from(
      screen
        .getByTestId("folded-section-contents")
        .querySelectorAll(".sr-only"),
    ).map((element: Element): string | null => {
      return element.textContent;
    });

    expect(separators).toEqual(["、", "、", "、"]);
  });
});
