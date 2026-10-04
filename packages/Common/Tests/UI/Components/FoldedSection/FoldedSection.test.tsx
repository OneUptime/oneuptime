import "@testing-library/jest-dom";
import {
  cleanup,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
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

/*
 * "The advanced section in the form should be called something better -
 * like 'more' or something as such. Please make the UI better as well and
 * show what things are inside it when collapsed (small summary of things).
 * Please make the UI look great." - the maintainer.
 *
 * FoldedSection draws every fold of rarely needed options: a form's More
 * fields, a page's More settings, and every other section a form folds
 * fields into. Pinned here:
 *   - the header is a real button, named by the title, that says which way
 *     it is folded and which body it controls;
 *   - folded, it lists what is inside - a few names, then how many more -
 *     with the set ones as chips that say what they are set to, and the
 *     sentences that say what its defaults do; all of it describes the
 *     button for a screen reader;
 *   - open, the list gives way to the description and the body;
 *   - folded, the body stays mounted but is out of sight and reach;
 *   - it looks the part: an icon tile (tinted while something inside is
 *     set), a chevron that turns, focus and hover states.
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

function header(name: string = MORE_FIELDS_SECTION_TITLE): HTMLElement {
  return screen.getByRole("button", { name });
}

function body(name?: string): HTMLElement {
  return document.getElementById(header(name).getAttribute("aria-controls")!)!;
}

/*
 * What a screen reader reads after the header's name, spaces evened out:
 * each pill is an element of its own, so the reading puts a space on either
 * side of it before the comma between two.
 */
function description(element: HTMLElement = header()): string {
  return computeAccessibleDescription(element)
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function renderSection(
  props: Partial<React.ComponentProps<typeof FoldedSection>> = {},
): UserEvent {
  render(
    <FoldedSection
      title={MORE_FIELDS_SECTION_TITLE}
      icon={MORE_SECTION_ICON}
      {...props}
    >
      <label>
        Note
        <input aria-label="Note" />
      </label>
    </FoldedSection>,
  );

  return userEvent.setup({ delay: null });
}

describe("FoldedSection's header", () => {
  test("is a real button named by the title, folded to start with", () => {
    renderSection({ items: NOTHING_SET });

    const button: HTMLElement = header();

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("More fields");
    expect(body()).toBeInTheDocument();
    expect(body().id).toBe(button.getAttribute("aria-controls"));
  });

  test("opens and folds again on a click, and says so", async () => {
    const onToggle: MockFunction = getJestMockFunction();
    const user: UserEvent = renderSection({ items: NOTHING_SET, onToggle });

    await user.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(body()).not.toHaveClass("invisible");

    await user.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(onToggle.mock.calls).toEqual([[false], [true]]);
  });

  test("opens from the keyboard, as any button does", async () => {
    const user: UserEvent = renderSection({ items: NOTHING_SET });

    await user.tab();
    expect(header()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(header()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  test("starts open when told to, and follows a controlled state", () => {
    const { rerender } = render(
      <FoldedSection title={MORE_FIELDS_SECTION_TITLE} isCollapsed={false}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(header()).toHaveAttribute("aria-expanded", "true");

    rerender(
      <FoldedSection title={MORE_FIELDS_SECTION_TITLE} isCollapsed={true}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(header()).toHaveAttribute("aria-expanded", "false");

    cleanup();

    render(
      <FoldedSection title={MORE_FIELDS_SECTION_TITLE} defaultCollapsed={false}>
        <span>inside</span>
      </FoldedSection>,
    );

    expect(header()).toHaveAttribute("aria-expanded", "true");
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
        <FoldedSection title={MORE_FIELDS_SECTION_TITLE}>
          <span>inside</span>
        </FoldedSection>
      </form>,
    );

    await userEvent.setup({ delay: null }).click(header());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(header()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("folded, it says what is inside", () => {
  test("names the fields it holds, a pill each", () => {
    renderSection({ items: NOTHING_SET });

    const contents: HTMLElement = screen.getByTestId("folded-section-contents");
    const items: Array<HTMLElement> =
      within(contents).getAllByTestId("folded-section-item");

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.textContent;
      }),
    ).toEqual(["Declared At", "Initial State", "Labels", "Private Incident"]);

    for (const item of items) {
      expect(item).toHaveAttribute("data-item-set", "false");
      expect(item).toHaveClass("rounded-full", "ring-gray-200");
    }

    // Read out with the header, a comma between two names.
    expect(description()).toBe(
      "Declared At, Initial State, Labels, Private Incident",
    );
    // Outside the folded body, so it is on screen.
    expect(body()).not.toContainElement(contents);
  });

  test("draws what is set as chips that say what it is set to", () => {
    renderSection({ items: DECLARE_ITEMS });

    const chips: Array<HTMLElement> = screen
      .getAllByTestId("folded-section-item")
      .filter((item: HTMLElement): boolean => {
        return item.getAttribute("data-item-set") === "true";
      });

    expect(
      chips.map((chip: HTMLElement): string | null => {
        return chip.textContent;
      }),
    ).toEqual([
      "Initial State: Investigating",
      "Labels: 2",
      "Private Incident: On",
    ]);

    for (const chip of chips) {
      expect(chip).toHaveClass("bg-indigo-50", "text-indigo-700");
    }

    expect(description()).toBe(
      "Declared At, Initial State: Investigating, Labels: 2, Private Incident: On",
    );
  });

  test("a set item without a value is a chip with its name alone", () => {
    renderSection({
      items: [{ key: "description", title: "Description", isSet: true }],
    });

    const chip: HTMLElement = screen.getByTestId("folded-section-item");

    expect(chip).toHaveAttribute("data-item-set", "true");
    expect(chip).toHaveTextContent(/^Description$/);
  });

  test("keeps a long list small: a few names, then how many more", () => {
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

  test("says what its defaults do in a sentence, under what it holds", () => {
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
    expect(description()).toBe(
      "Description, Expires The key expires a year from today.",
    );
    // The sentence wraps on a phone rather than being cut off.
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
    expect(header()).toHaveAccessibleDescription("Configured");
  });

  test("says nothing under the title when there is nothing to say", () => {
    renderSection({});

    expect(screen.queryByTestId("folded-section-contents")).toBeNull();
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(header()).not.toHaveAttribute("aria-describedby");
  });
});

describe("open, it shows the fields instead", () => {
  test("the list and the summary give way to the description", async () => {
    const user: UserEvent = renderSection({
      items: DECLARE_ITEMS,
      summary: "Defaults apply.",
      description: "Options most incidents never need.",
    });

    // Folded, the description is not drawn.
    expect(screen.queryByTestId("folded-section-description")).toBeNull();

    await user.click(header());

    expect(screen.queryByTestId("folded-section-contents")).toBeNull();
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(screen.getByTestId("folded-section-description")).toHaveTextContent(
      "Options most incidents never need.",
    );
    expect(header()).toHaveAccessibleDescription(
      "Options most incidents never need.",
    );

    await user.click(header());

    expect(screen.getByTestId("folded-section-contents")).toBeInTheDocument();
    expect(screen.queryByTestId("folded-section-description")).toBeNull();
  });

  test("folded, the body stays mounted, out of sight, the tab order and screen readers", async () => {
    const user: UserEvent = renderSection({ items: NOTHING_SET });

    expect(body()).toHaveClass("max-h-0", "opacity-0", "invisible");
    expect(body()).toContainElement(screen.getByLabelText("Note"));

    await user.click(header());
    await user.type(screen.getByLabelText("Note"), "Ask the platform team");
    await user.click(header());

    expect(body()).toHaveClass("invisible");
    expect(screen.getByLabelText("Note")).toHaveValue("Ask the platform team");
  });
});

describe("how it looks", () => {
  test("the icon tile is grey while nothing inside is set, and tinted once something is", () => {
    renderSection({ items: NOTHING_SET });

    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-gray-100",
      "text-gray-500",
    );

    cleanup();
    renderSection({ items: DECLARE_ITEMS });

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

  test("a section without an icon has no tile", () => {
    render(
      <FoldedSection title="Subscriber Notifications">
        <span>inside</span>
      </FoldedSection>,
    );

    expect(screen.queryByTestId("folded-section-icon")).toBeNull();
  });

  test("the chevron turns over when it opens", async () => {
    const user: UserEvent = renderSection({ items: NOTHING_SET });

    const chevron: SVGElement = screen
      .getByTestId("folded-section-chevron")
      .querySelector("svg")!;

    expect(chevron.getAttribute("class")).not.toContain("-rotate-180");
    expect(chevron.getAttribute("class")).toContain("transition-transform");

    await user.click(header());

    expect(
      screen
        .getByTestId("folded-section-chevron")
        .querySelector("svg")!
        .getAttribute("class"),
    ).toContain("-rotate-180");
  });

  test("the header has a focus ring and a hover tint, and does not move without reason", () => {
    renderSection({ items: NOTHING_SET });

    expect(header()).toHaveClass(
      "hover:bg-gray-50",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "text-left",
      "w-full",
    );
    expect(body()).toHaveClass("motion-reduce:transition-none");
  });

  test("on a page, among cards, it is a card itself", () => {
    renderSection({ isElevated: true });

    const section: HTMLElement = screen.getByTestId(FOLDED_SECTION_TEST_ID);

    expect(section).toHaveClass("rounded-xl", "shadow-sm", "border");
    expect(header()).toHaveClass("px-5", "md:px-6");
  });

  test("in a form, it sits inside the form's own card", () => {
    renderSection({});

    const section: HTMLElement = screen.getByTestId(FOLDED_SECTION_TEST_ID);

    expect(section).toHaveClass("rounded-lg", "border");
    expect(section).not.toHaveClass("shadow-sm");
    expect(section).toHaveAttribute("data-collapsed", "true");
  });

  test("takes a test id of its own", () => {
    renderSection({ dataTestId: "monitor-step-more-fields" });

    expect(screen.getByTestId("monitor-step-more-fields")).toBeInTheDocument();
  });
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

  test("the names, the values and how many more read German", () => {
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

    expect(
      screen.getByRole("button", { name: de["More fields"] }),
    ).toBeInTheDocument();
    expect(de["More fields"]).toBe("Weitere Felder");

    const chips: Array<string | null> = screen
      .getAllByTestId("folded-section-item")
      .filter((item: HTMLElement): boolean => {
        return item.getAttribute("data-item-set") === "true";
      })
      .map((item: HTMLElement): string | null => {
        return item.textContent;
      });

    expect(chips).toEqual([
      `${de["Private Incident"]}: ${de["On"]}`,
      `${de["Labels"]}: 2`,
    ]);
    expect(screen.getByTestId("folded-section-more")).toHaveTextContent(
      "2 weitere",
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
  });
});
