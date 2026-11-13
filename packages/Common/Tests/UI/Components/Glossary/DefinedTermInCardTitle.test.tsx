import "@testing-library/jest-dom";
import {
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
import DefinitionsDrawnAfter from "../../../../UI/Components/Glossary/DefinitionsDrawnAfter";
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
 * list of headings read it so. The definition is drawn right after the
 * heading now (Glossary/DefinitionsDrawnAfter), and Tab still goes from the
 * word to Read more, then on to what follows the heading.
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
    // Right after the heading, before what follows it.
    expect(cardHeading().nextElementSibling).toContainElement(open);
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
    expect(cardHeading().nextElementSibling).toContainElement(open);
  });

  test("a heading a page draws itself, through DefinitionsDrawnAfter", async () => {
    answerGlossaryReads();
    render(
      <div>
        <DefinitionsDrawnAfter>
          <h2>
            <DefinedTerm term={GlossaryTerm.EscalationRule}>
              Escalation Rules
            </DefinedTerm>
          </h2>
        </DefinitionsDrawnAfter>
        <p>Who gets notified when an incident is triggered.</p>
      </div>,
    );

    const open: HTMLElement = await openDefinition("Escalation Rules");
    const heading: HTMLElement = screen.getByRole("heading", { level: 2 });

    expect(wordsIn(heading)).toBe("Escalation Rules");
    expect(heading).not.toContainElement(open);
    expect(heading.nextElementSibling).toContainElement(open);
  });

  test("a heading with no defined term in it is drawn as it was: nothing comes between it and its description", () => {
    render(
      <Card title="Monitor Target" description="What to check.">
        <div>The target.</div>
      </Card>,
    );

    expect(cardHeading().nextElementSibling).toBe(
      screen.getByTestId("card-description"),
    );
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

describe("with its definition open, Tab goes from the word to Read more", () => {
  test("then on to what follows the heading: the card's Learn more", async () => {
    answerGlossaryReads();
    renderCriteriaCard();

    const open: HTMLElement = await openDefinition("Criteria");
    const stops: Array<HTMLElement> = tabStops();
    const at: number = stops.indexOf(screen.getByTestId(DEFINED_TERM_TEST_ID));

    expect(at).toBeGreaterThanOrEqual(0);
    expect(stops.slice(at + 1, at + 3)).toEqual([
      within(open).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID),
      screen.getByRole("link", { name: "Learn more" }),
    ]);
  });
});

/*
 * A recording of the first-run pages records the product's own words as
 * written (Utils/ProductText), Create Monitor's among them. A title in words
 * is marked, and its definition was recorded with it while drawn inside the
 * heading. Drawn after the heading, it still is: the popover carries the
 * mark itself (DefinedTerm.test.tsx).
 */
describe("in a recording of the page", () => {
  test("the definition, drawn after the heading, is recorded as written, as the heading is", async () => {
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
