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
 * The word as DefinedTerm draws it: the header draws it through
 * LazyDefinedTerm, and LazyDefinedTerm.test.tsx holds the word as it is
 * drawn until the file arrives.
 */
jest.mock("../../../../UI/Components/Glossary/LazyDefinedTerm", () => {
  return jest.requireActual("../../../../UI/Components/Glossary/DefinedTerm");
});

import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import FacetSectionHeader from "../../../../UI/Components/TelemetryViewer/components/FacetSectionHeader";
import {
  DEFINED_TERM_DEFINITION_TEST_ID,
  DEFINED_TERM_POPOVER_TEST_ID,
  DEFINED_TERM_READ_MORE_TEST_ID,
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import { FacetHelp } from "../../../../UI/Components/TelemetryViewer/FacetHelp";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A FACET'S TITLE CAN BE A DEFINED TERM (#9133).
 *
 * About 180 strings in Traces say "span", and nothing said what one is. The
 * traces explorer's Span Type facet, where the explorer first says it,
 * draws its title as the Glossary's Span. A defined term is a button, and a
 * button cannot hold another, so the title sits beside the fold button, as
 * the (i) does: the fold button keeps its name and its job, and a press on
 * the word opens its definition without folding the section.
 */

const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

afterEach(() => {
  cleanup();
  clearGlossaryReads();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
});

const HELP: FacetHelp = {
  description: "Which spans the list shows.",
  entries: [],
};

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof FacetSectionHeader>> = {},
): MockFunction {
  // No Glossary is served here: the word is drawn without its definition.
  (globalThis as Record<string, unknown>)["fetch"] = jest.fn(() => {
    return Promise.reject(new Error("offline"));
  });

  const onToggle: MockFunction = getJestMockFunction();

  render(
    <FacetSectionHeader
      title="Span Type"
      activeCount={0}
      isExpanded={true}
      controlsId="span-type-body"
      onToggle={onToggle as any}
      titleGlossaryTerm={GlossaryTerm.Span}
      {...overrides}
    />,
  );

  return onToggle;
}

describe("a facet title that is a defined term", () => {
  test("draws the title as the Glossary's term", () => {
    renderHeader();

    const word: HTMLElement = screen.getByTestId(DEFINED_TERM_TEST_ID);

    expect(word).toHaveTextContent("Span Type");
    expect(word).toHaveAttribute("data-glossary-term", GlossaryTerm.Span);
  });

  test("keeps the fold button, named by the title, outside the word's button", () => {
    renderHeader();

    const fold: HTMLElement = screen.getByRole("button", {
      name: "Span Type",
      expanded: true,
    });

    expect(fold).toHaveAttribute("aria-controls", "span-type-body");
    // No button inside a button.
    expect(fold.querySelector("button")).toBeNull();
    expect(fold).not.toContainElement(screen.getByTestId(DEFINED_TERM_TEST_ID));
  });

  test("folds from the fold button, and not from a press on the word", () => {
    const onToggle: MockFunction = renderHeader();

    fireEvent.click(screen.getByTestId(DEFINED_TERM_TEST_ID));
    expect(onToggle).not.toHaveBeenCalled();

    // The word's own popover is open now: the fold button is the one it folds.
    fireEvent.click(
      document.querySelector('[aria-controls="span-type-body"]') as HTMLElement,
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("still shows its count of set values", () => {
    renderHeader({ activeCount: 2 });

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("keeps the (i) beside it when the facet explains itself", () => {
    renderHeader({ help: HELP });

    expect(screen.getByTestId(DEFINED_TERM_TEST_ID)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Span Type", expanded: true }),
    ).toBeInTheDocument();
    // The fold button, the word and the (i): three buttons, none nested.
    const buttons: Array<HTMLElement> = screen.getAllByRole("button");
    expect(buttons.length).toBe(3);
    for (const button of buttons) {
      expect(button.querySelector("button")).toBeNull();
    }
  });

  test("a title with no term is the plain header, with no defined word", () => {
    renderHeader({ titleGlossaryTerm: undefined });

    expect(screen.queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Span Type" }),
    ).toBeInTheDocument();
  });
});

/*
 * ITS DEFINITION IS NEVER CUT OFF BY THE FACET LIST (#9863).
 *
 * The facets sit in a list that scrolls (TelemetryFacetSidebar), 224px wide
 * by default, and the definition is 288px wide: drawn after the title, inside
 * that list, Popper slid it along but could not fit it, and its end was cut
 * off. It is drawn on the page's body now, as every tooltip is
 * (TooltipLayer), and placed against the window.
 */
describe("a facet title's definition, in the facet list", () => {
  const SPAN: unknown = {
    lang: "en",
    entries: [
      {
        id: "span",
        term: "Span",
        definition:
          "One operation inside a trace: a request, a query or a step, with when it started and how long it took.",
      },
    ],
  };

  function renderInFacetList(): void {
    (globalThis as Record<string, unknown>)["fetch"] = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: (): Promise<unknown> => {
          return Promise.resolve(SPAN);
        },
      });
    });

    render(
      // The sidebar's facet list, as TelemetryFacetSidebar draws it.
      <div
        data-testid="facet-list"
        className="flex-1 overflow-y-auto"
        style={{ width: 224, overflowY: "auto" }}
      >
        <FacetSectionHeader
          title="Span Type"
          activeCount={0}
          isExpanded={true}
          controlsId="span-type-body"
          onToggle={getJestMockFunction() as any}
          titleGlossaryTerm={GlossaryTerm.Span}
        />
      </div>,
    );
  }

  async function openDefinition(): Promise<HTMLElement> {
    fireEvent.click(screen.getByTestId(DEFINED_TERM_TEST_ID));

    return waitFor((): HTMLElement => {
      const popover: HTMLElement = screen.getByTestId(
        DEFINED_TERM_POPOVER_TEST_ID,
      );

      expect(
        within(popover).getByTestId(DEFINED_TERM_DEFINITION_TEST_ID),
      ).toBeInTheDocument();

      return popover;
    });
  }

  test("is drawn on the page's body, outside the list and the title", async () => {
    renderInFacetList();

    const popover: HTMLElement = await openDefinition();

    expect(screen.getByTestId("facet-list")).not.toContainElement(popover);
    expect(
      screen.getByTestId("facet-section-defined-title"),
    ).not.toContainElement(popover);
    expect(
      popover.closest<HTMLElement>("[data-tippy-root]")?.parentElement,
    ).toBe(document.body);
  });

  test("still reads in its own type, not in the title's small capitals", async () => {
    renderInFacetList();

    const popover: HTMLElement = await openDefinition();

    expect(popover.closest(".uppercase")).toBeNull();
    expect(popover).toHaveClass("normal-case", "tracking-normal");
  });

  test("still says what the word is, and links the Glossary, for the word that opened it", async () => {
    renderInFacetList();

    const popover: HTMLElement = await openDefinition();

    expect(
      within(popover).getByTestId(DEFINED_TERM_DEFINITION_TEST_ID),
    ).toHaveTextContent("One operation inside a trace");
    expect(
      within(popover).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID),
    ).toHaveAttribute("href", expect.stringContaining("span"));
    // A dialog named by its word, wherever it is drawn.
    expect(screen.getByRole("dialog", { name: "Span Type" })).toContainElement(
      popover,
    );
  });
});
