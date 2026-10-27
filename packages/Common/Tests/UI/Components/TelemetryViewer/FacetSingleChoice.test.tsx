import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Nothing here reads a zod schema. The Types the sidebar imports build
 * theirs as they load, so they get a stand-in that takes any chain of calls,
 * and the suite loads whatever zod build is installed.
 */
jest.mock("Common/Utils/Schema/Zod", () => {
  const schema: unknown = new Proxy(() => {}, {
    get: (_target: unknown, property: string | symbol): unknown => {
      return property === "then" ? undefined : schema;
    },
    apply: (): unknown => {
      return schema;
    },
  });
  return { __esModule: true, default: schema };
});

import TelemetryFacetSidebar from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "../../../../UI/Components/TelemetryViewer/types";

/*
 * A facet that is a choice of exactly one value (FacetConfig.chosenValue) -
 * the traces explorer's Span Type: Entry spans, Root spans or All spans.
 * Rendered in the real shared sidebar. What is pinned:
 *
 *   - its rows are radio buttons in a radio group named for the facet, the
 *     chosen value checked whether or not a chip names it;
 *   - a click on another value chooses it (through onIncludeFilter, the
 *     explorer's one path in), a click on the chosen one changes nothing,
 *     and no value can be excluded;
 *   - every value is listed, a page's locked scope or not, and the facet's
 *     one line of help shows under its title;
 *   - the header counts a choice only when a chip says it is not the
 *     default; every other facet keeps its checkboxes.
 */

const HELP: string =
  "Entry spans: where a request or message enters a service. Root spans: where a trace starts. All spans: every operation, including database calls and internal steps.";

const SPAN_TYPE: (chosenValue: string) => FacetConfig = (
  chosenValue: string,
): FacetConfig => {
  return {
    key: "spanType",
    title: "Span Type",
    valueDisplayMap: {
      entry: "Entry spans",
      root: "Root spans",
      all: "All spans",
    },
    chosenValue: chosenValue,
    description: HELP,
    priority: 0.5,
  };
};

const STATUS: FacetConfig = {
  key: "statusCode",
  title: "Status",
  valueDisplayMap: { "0": "Unset", "2": "Error" },
  priority: 6,
};

const FACETS: FacetData = {
  spanType: [
    { value: "entry", count: 40 },
    { value: "root", count: 0 },
    { value: "all", count: 1000 },
  ],
  statusCode: [
    { value: "0", count: 900 },
    { value: "2", count: 100 },
  ],
};

interface Rendered {
  include: MockFunction;
  exclude: MockFunction;
  remove: MockFunction;
}

const renderSidebar: (options: {
  chosenValue: string;
  activeFilters?: Array<ActiveFilter>;
  onlyShowValuesInScope?: boolean;
}) => Rendered = (options: {
  chosenValue: string;
  activeFilters?: Array<ActiveFilter>;
  onlyShowValuesInScope?: boolean;
}): Rendered => {
  const include: MockFunction = getJestMockFunction();
  const exclude: MockFunction = getJestMockFunction();
  const remove: MockFunction = getJestMockFunction();

  render(
    <TelemetryFacetSidebar
      facetData={FACETS}
      facetConfigs={[SPAN_TYPE(options.chosenValue), STATUS]}
      isLoading={false}
      activeFilters={options.activeFilters || []}
      onIncludeFilter={include}
      onExcludeFilter={exclude}
      onRemoveFilter={remove}
      onlyShowValuesInScope={options.onlyShowValuesInScope}
    />,
  );

  return { include, exclude, remove };
};

const choiceGroup: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("radiogroup", { name: "Span Type" });
};

const choice: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return within(choiceGroup()).getByRole("radio", { name: name });
};

afterEach(() => {
  cleanup();
});

describe("a choice of one in the facet sidebar", () => {
  test("its values are radio buttons, the chosen one checked though no chip names it", () => {
    renderSidebar({ chosenValue: "entry" });

    expect(choice("Entry spans")).toHaveAttribute("aria-checked", "true");
    expect(choice("Root spans")).toHaveAttribute("aria-checked", "false");
    expect(choice("All spans")).toHaveAttribute("aria-checked", "false");
    expect(within(choiceGroup()).queryAllByRole("checkbox")).toEqual([]);
  });

  test("a click on another value chooses it; a click on the chosen one changes nothing", () => {
    const rendered: Rendered = renderSidebar({ chosenValue: "entry" });

    fireEvent.click(choice("All spans"));
    expect(rendered.include.mock.calls).toEqual([["spanType", "all"]]);

    fireEvent.click(choice("Entry spans"));
    expect(rendered.include.mock.calls).toHaveLength(1);
    expect(rendered.remove).not.toHaveBeenCalled();
  });

  test("no value can be excluded, though the explorer could exclude elsewhere", () => {
    renderSidebar({ chosenValue: "entry" });

    expect(
      within(choiceGroup()).queryAllByRole("button", { name: /^Exclude / }),
    ).toEqual([]);
  });

  test("its one line of help shows under the title", () => {
    renderSidebar({ chosenValue: "root" });

    expect(within(choiceGroup()).getByText(HELP)).toBeInTheDocument();
  });

  test("every value is listed under a page's locked scope, a 0 count too", () => {
    renderSidebar({ chosenValue: "entry", onlyShowValuesInScope: true });

    expect(choice("Root spans")).toBeInTheDocument();
    expect(choice("Entry spans")).toHaveAttribute("aria-checked", "true");
  });

  test("the header counts the choice only when a chip says it is not the default", () => {
    renderSidebar({ chosenValue: "entry" });
    expect(
      within(screen.getByRole("button", { name: /Span Type/ })).queryByText(
        "1",
      ),
    ).toBeNull();
    cleanup();

    renderSidebar({
      chosenValue: "all",
      activeFilters: [
        {
          facetKey: "spanType",
          value: "all",
          displayKey: "Span Type",
          displayValue: "All spans",
        },
      ],
    });
    expect(
      within(screen.getByRole("button", { name: /Span Type/ })).getByText("1"),
    ).toBeInTheDocument();
    expect(choice("All spans")).toHaveAttribute("aria-checked", "true");
  });

  test("every other facet keeps its checkboxes", () => {
    const rendered: Rendered = renderSidebar({ chosenValue: "entry" });

    const error: HTMLElement = screen.getByRole("checkbox", { name: "Error" });
    expect(error).toHaveAttribute("aria-checked", "false");

    fireEvent.click(error);
    expect(rendered.include.mock.calls).toEqual([["statusCode", "2"]]);
    expect(screen.queryAllByRole("radio")).toHaveLength(3);
  });
});
