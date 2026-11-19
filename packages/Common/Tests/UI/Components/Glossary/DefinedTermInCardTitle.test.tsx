import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The word as DefinedTerm draws it, its file there: Card draws it through
 * LazyDefinedTerm, and LazyDefinedTerm.test.tsx holds the word as it is
 * drawn until the file arrives.
 */
jest.mock("../../../../UI/Components/Glossary/LazyDefinedTerm", () => {
  return jest.requireActual("../../../../UI/Components/Glossary/DefinedTerm");
});

import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import Card from "../../../../UI/Components/Card/Card";
import DefinedTerm, {
  DEFINED_TERM_DEFINITION_TEST_ID,
  DEFINED_TERM_READ_MORE_TEST_ID,
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";
import { PRODUCT_TEXT_CLASS_NAME } from "../../../../UI/Utils/ProductText";

/*
 * WITH ITS DEFINITION OPEN, A CARD'S HEADING IS STILL NAMED BY ITS TITLE
 * ALONE (#7594).
 *
 * A card's heading is named by the words inside it. A defined term in it
 * drew its definition beside its word, inside the heading, and the
 * definition is a dialog named by its word: while it showed, Chromium named
 * the Criteria card's heading "Criteria Criteria", and a screen reader's
 * list of headings read it so. The definition is drawn on the page's body
 * now, as every tooltip is (TooltipLayer), never inside the heading - nor
 * inside a box that clips around it (#9863) - and Tab still goes from the
 * word to Read more, then on from the word to what follows the heading
 * (keepTabOrder).
 *
 * jsdom's names (testing-library's) never doubled, so these read what the
 * heading holds: with the definition open, its words are its title's, and
 * the definition is not inside it. A table's heading is held the same in
 * ModelTable/BaseModelTableGlossaryTerm.test.tsx, the Escalation Rules and
 * Rotation layers headings in EscalationRulesEmptyLevel.test.tsx and
 * OnCallLayersSkipFlow.test.tsx, and Chromium's own in
 * packages/E2E/MonitorOverview/CreateMonitor.spec.ts.
 */

const GLOSSARY: unknown = {
  lang: "en",
  entries: [
    {
      id: "criteria",
      term: "Criteria",
      definition: "A monitor's rules: what each check result means.",
    },
    {
      id: "owner",
      term: "Owner",
      definition: "A person or team who answers for a resource.",
    },
    {
      id: "escalation-rule",
      term: "Escalation rule",
      definition: "Who is paged next, and when, if nobody answers.",
    },
  ],
};

const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

afterEach(() => {
  cleanup();
  clearGlossaryReads();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
});

// The glossary's answer to a read: every word here has its definition.
const answerGlossaryReads: () => void = (): void => {
  (globalThis as Record<string, unknown>)["fetch"] = (): Promise<unknown> => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        return Promise.resolve(GLOSSARY);
      },
    });
  };
};

// Presses a heading's word, and waits for its definition to show.
const openDefinition: (word: string) => Promise<HTMLElement> = async (
  word: string,
): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole("button", { name: word }));

  return waitFor((): HTMLElement => {
    const open: HTMLElement = screen.getByRole("dialog", { name: word });

    expect(open).toHaveAttribute("data-state", "visible");
    expect(
      within(open).getByTestId(DEFINED_TERM_DEFINITION_TEST_ID),
    ).toBeInTheDocument();

    return open;
  });
};

const cardHeading: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("card-details-heading");
};

// Whether an open definition is drawn on the page's body (Tippy's root).
const isOnTheBody: (open: HTMLElement) => boolean = (
  open: HTMLElement,
): boolean => {
  return (
    open.closest<HTMLElement>("[data-tippy-root]")?.parentElement ===
    document.body
  );
};

// The words inside a heading - what names it - as one line.
const wordsIn: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
};

// The Criteria card of a monitor's form, as MonitorStep draws it.
const renderCriteriaCard: () => void = (): void => {
  render(
    <Card
      title="Criteria"
      titleGlossaryTerm={GlossaryTerm.Criteria}
      description="When this monitor changes status, declares an incident or creates an alert."
      rightElement={
        <a href="/docs/monitor/criteria-and-statuses">Learn more</a>
      }
    >
      <div>The criteria.</div>
    </Card>,
  );
};

describe("with its definition open, a card's heading holds its title alone", () => {
  test("a title in words, its word drawn by the card (titleGlossaryTerm)", async () => {
    answerGlossaryReads();
    renderCriteriaCard();

    const open: HTMLElement = await openDefinition("Criteria");

    expect(wordsIn(cardHeading())).toBe("Criteria");
    expect(cardHeading()).not.toContainElement(open);
    // On the page's body, where nothing the card is in can cut it off.
    expect(isOnTheBody(open)).toBe(true);
    expect(screen.getByRole("heading", { name: "Criteria" })).toBe(
      cardHeading(),
    );
  });

  test("a title drawn as more than words, its word drawn by the page (a table's beside its plan's badge, Owners' beside its count)", async () => {
    answerGlossaryReads();
    render(
      <Card
        title={
          <span>
            <DefinedTerm term={GlossaryTerm.Owner}>Owners</DefinedTerm>{" "}
            <span>2</span>
          </span>
        }
      >
        <div>The owners.</div>
      </Card>,
    );

    const closed: string = wordsIn(cardHeading());
    const open: HTMLElement = await openDefinition("Owners");

    expect(closed).toBe("Owners 2");
    expect(wordsIn(cardHeading())).toBe(closed);
    expect(cardHeading()).not.toContainElement(open);
    expect(isOnTheBody(open)).toBe(true);
  });

  test("a heading a page draws itself (Escalation Rules, Rotation layers)", async () => {
    answerGlossaryReads();
    render(
      <div data-testid="section" style={{ overflow: "hidden" }}>
        <h2>
          <DefinedTerm term={GlossaryTerm.EscalationRule}>
            Escalation Rules
          </DefinedTerm>
        </h2>
        <p>Who gets notified when an incident is triggered.</p>
      </div>,
    );

    const open: HTMLElement = await openDefinition("Escalation Rules");
    const heading: HTMLElement = screen.getByRole("heading", { level: 2 });

    expect(wordsIn(heading)).toBe("Escalation Rules");
    expect(heading).not.toContainElement(open);
    // Not cut off by the box that holds the heading either.
    expect(screen.getByTestId("section")).not.toContainElement(open);
    expect(isOnTheBody(open)).toBe(true);
  });

  test("nothing comes between a heading and its description, with or without a defined term open", async () => {
    answerGlossaryReads();
    render(
      <div>
        <Card title="Monitor Target" description="What to check.">
          <div>The target.</div>
        </Card>
        <Card
          title="Criteria"
          titleGlossaryTerm={GlossaryTerm.Criteria}
          description="When this monitor changes status."
        >
          <div>The criteria.</div>
        </Card>
      </div>,
    );

    const [plain, defined] = screen.getAllByTestId("card-details-heading");
    const [plainDescription, definedDescription] =
      screen.getAllByTestId("card-description");

    expect(plain!.nextElementSibling).toBe(plainDescription);
    expect(defined!.nextElementSibling).toBe(definedDescription);

    await openDefinition("Criteria");

    expect(defined!.nextElementSibling).toBe(definedDescription);
  });
});

// Every element Tab stops at, in the page's order, as far as jsdom can tell.
const tabStops: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]",
    ),
  ).filter((element: HTMLElement): boolean => {
    return element.tabIndex >= 0 && !element.hasAttribute("disabled");
  });
};

// Tab, as the keyboard sends it; true when the browser's own move is left to it.
const pressTab: () => boolean = (): boolean => {
  return fireEvent.keyDown(document.activeElement || document.body, {
    key: "Tab",
    code: "Tab",
  });
};

describe("with its definition open, Tab goes from the word to Read more", () => {
  test("then on from the word to what follows the heading: the card's Learn more", async () => {
    answerGlossaryReads();
    renderCriteriaCard();

    const word: HTMLElement = screen.getByTestId(DEFINED_TERM_TEST_ID);

    // The keyboard's focus shows the definition.
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => {
      word.focus();
    });

    const open: HTMLElement = await waitFor((): HTMLElement => {
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Criteria",
      });
      expect(dialog).toHaveAttribute("data-state", "visible");
      return dialog;
    });

    // Tab on the word: Read more, on the body, as if it sat after the word.
    expect(pressTab()).toBe(false);
    expect(
      within(open).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID),
    ).toHaveFocus();

    // Past the definition's last: back to the word, the browser's move left to it...
    let isLeftToTheBrowser: boolean = false;

    for (let press: number = 0; press < 5 && !isLeftToTheBrowser; press++) {
      isLeftToTheBrowser = pressTab();
    }

    expect(isLeftToTheBrowser).toBe(true);
    expect(word).toHaveFocus();

    // ...and the next stop after the word is the card's Learn more.
    const stops: Array<HTMLElement> = tabStops().filter(
      (stop: HTMLElement): boolean => {
        return !stop.closest("[data-tippy-root]");
      },
    );
    const at: number = stops.indexOf(word);

    expect(at).toBeGreaterThanOrEqual(0);
    expect(stops[at + 1]).toBe(
      screen.getByRole("link", { name: "Learn more" }),
    );
  });
});

/*
 * A recording of the first-run pages records the product's own words as
 * written (Utils/ProductText), Create Monitor's among them. A title in words
 * is marked, and its definition was recorded with it while drawn inside the
 * heading. Drawn on the page's body, it still is: the popover carries the
 * mark itself (DefinedTerm.test.tsx).
 */
describe("in a recording of the page", () => {
  test("the definition, drawn on the body, is recorded as written, as the heading is", async () => {
    answerGlossaryReads();
    renderCriteriaCard();

    const open: HTMLElement = await openDefinition("Criteria");
    const marked: string = `.${PRODUCT_TEXT_CLASS_NAME}`;

    expect(cardHeading()).toHaveClass(PRODUCT_TEXT_CLASS_NAME);
    expect(
      within(open).getByTestId(DEFINED_TERM_DEFINITION_TEST_ID).closest(marked),
    ).not.toBeNull();
    expect(
      within(open).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID).closest(marked),
    ).not.toBeNull();
  });
});
