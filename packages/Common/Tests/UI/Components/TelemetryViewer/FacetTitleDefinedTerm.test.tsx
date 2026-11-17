import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { DEFINED_TERM_TEST_ID } from "../../../../UI/Components/Glossary/DefinedTerm";
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
