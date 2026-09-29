import "@testing-library/jest-dom";
import { describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import React from "react";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import Route from "../../../Types/API/Route";

/*
 * Trace/span filter chips carry an optional `openRoute` — a small icon-link
 * out to the trace view. Chips without a resolvable destination must stay
 * plain chips, on both the read-only and the removable rendering paths.
 */

function chip(overrides: Partial<ActiveFilter>): ActiveFilter {
  return {
    facetKey: "traceId",
    value: "trace-1",
    displayKey: "Trace",
    displayValue: "trace-1",
    ...overrides,
  };
}

function renderChips(filters: Array<ActiveFilter>): void {
  render(
    <ActiveFilterChips
      filters={filters}
      onRemove={() => {}}
      onClearAll={() => {}}
    />,
  );
}

describe("ActiveFilterChips open affordance", () => {
  test("a read-only chip with an openRoute renders an icon-link to it", () => {
    renderChips([
      chip({
        readOnly: true,
        openRoute: new Route("/traces/view/trace-1"),
      }),
    ]);

    const link: HTMLElement = screen.getByRole("link", {
      name: "Open trace view",
    });
    expect(link).toHaveAttribute("href", "/traces/view/trace-1");
  });

  test("a removable chip with an openRoute renders the icon-link next to the remove button", () => {
    renderChips([
      chip({
        facetKey: "spanId",
        value: "span-1",
        displayKey: "Span",
        displayValue: "span-1",
        openRoute: new Route("/traces/view/trace-1?spanId=span-1"),
      }),
    ]);

    expect(
      screen.getByRole("link", { name: "Open span view" }),
    ).toHaveAttribute("href", "/traces/view/trace-1?spanId=span-1");
    expect(
      screen.getByRole("button", { name: "Remove Span: span-1" }),
    ).toBeInTheDocument();
  });

  test("chips without an openRoute render no link on either path", () => {
    renderChips([
      chip({ readOnly: true }),
      chip({
        facetKey: "spanId",
        value: "span-1",
        displayKey: "Span",
        displayValue: "span-1",
      }),
    ]);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
