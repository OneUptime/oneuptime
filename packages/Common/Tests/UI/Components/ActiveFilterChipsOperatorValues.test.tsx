import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  buildDictionaryValue,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";

/*
 * The reported crash, at the exact component that threw it.
 *
 * A log monitor's attribute filters are pinned into the logs preview as
 * read-only chips. Once the filter rows gained an operator dropdown, every
 * operator except `=` stored an operator *object* as the value, and the chip
 * rendered that value straight into a <span>. React answers an object child
 * by throwing:
 *
 *   Objects are not valid as a React child (found: object with keys {_values})
 *
 * `{_values}` is an `Includes` — the "is any of" operator. Because the
 * preview lives inside the Edit Monitor modal, the throw took the whole form
 * down to an error card and the Save button with it.
 *
 * `ActiveFilter.displayValue` is typed `string`, so these tests deliberately
 * cast an object in: the chips are built from query objects that reach the
 * viewer through `as` casts, which is how the untyped value got here in the
 * first place. The component must not be the thing that breaks.
 */

afterEach(() => {
  cleanup();
});

function chipWithValue(
  value: unknown,
  overrides: Partial<ActiveFilter> = {},
): ActiveFilter {
  const filter: ActiveFilter = {
    facetKey: "attributes.logtype",
    value: value as string,
    displayKey: "logtype",
    displayValue: value as string,
    readOnly: true,
    ...overrides,
  };

  return filter;
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

describe("ActiveFilterChips given operator-valued filters", () => {
  test("an Includes value renders instead of throwing — the reported crash", () => {
    expect(() => {
      renderChips([chipWithValue(new Includes(["web"]))]);
    }).not.toThrow();

    expect(screen.getByText("logtype:")).toBeInTheDocument();
    expect(screen.getByText("is any of web")).toBeInTheDocument();
  });

  test("a Search value renders as readable text", () => {
    renderChips([chipWithValue(new Search<string>("web"))]);

    expect(screen.getByText("contains web")).toBeInTheDocument();
  });

  test("the object never reaches the DOM as [object Object]", () => {
    renderChips([chipWithValue(new Includes(["web", "api"]))]);

    expect(document.body.textContent).not.toContain("[object Object]");
    expect(document.body.textContent).toContain("is any of web, api");
  });

  test("the tooltip is text too, not a stringified object", () => {
    renderChips([chipWithValue(new Search<string>("web"))]);

    const chip: HTMLElement | null = document.querySelector(
      "[title*='applied filter']",
    );

    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("title")).toBe(
      "logtype: contains web (applied filter)",
    );
  });

  test("removable chips survive an operator value as well as read-only ones", () => {
    /*
     * The two rendering paths are separate branches in the component; the
     * removable one also builds a "Remove ..." tooltip out of the value.
     */
    expect(() => {
      renderChips([chipWithValue(new Includes(["web"]), { readOnly: false })]);
    }).not.toThrow();

    expect(screen.getByText("is any of web")).toBeInTheDocument();

    const removeButton: HTMLElement | null =
      document.querySelector("[title^='Remove ']");

    expect(removeButton!.getAttribute("title")).toBe(
      "Remove logtype: is any of web",
    );
  });

  test("clicking Remove hands the handler a string, not the operator object", () => {
    /*
     * Rendering is only half the backstop. `value` is what the viewer deletes
     * out of its Set<string> of applied filters
     * (DashboardLogsViewer.handleRemoveFilter), so an object here renders a
     * perfectly good chip that then cannot be removed — Set.delete(object) on
     * a set of strings is a silent no-op.
     */
    const removed: Array<[string, unknown]> = [];

    render(
      <ActiveFilterChips
        filters={[chipWithValue(new Includes(["web"]), { readOnly: false })]}
        onRemove={(facetKey: string, value: string) => {
          removed.push([facetKey, value]);
        }}
        onClearAll={() => {}}
      />,
    );

    fireEvent.click(document.querySelector("[title^='Remove ']")!);

    expect(removed).toHaveLength(1);
    expect(removed[0]![0]).toBe("attributes.logtype");
    expect(typeof removed[0]![1]).toBe("string");
    expect(removed[0]![1]).toBe("is any of web");
  });

  test("an ordinary string chip's remove argument is untouched", () => {
    const removed: Array<unknown> = [];

    render(
      <ActiveFilterChips
        filters={[
          {
            facetKey: "severityText",
            value: "Error",
            displayKey: "Severity",
            displayValue: "Error",
          },
        ]}
        onRemove={(_facetKey: string, value: string) => {
          removed.push(value);
        }}
        onClearAll={() => {}}
      />,
    );

    fireEvent.click(document.querySelector("[title^='Remove ']")!);

    expect(removed).toEqual(["Error"]);
  });

  test.each(
    DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
      (option: DictionaryFilterOperatorOption) => {
        return [option.operator, option] as [
          DictionaryFilterOperator,
          DictionaryFilterOperatorOption,
        ];
      },
    ),
  )(
    "a chip built from the %s operator renders",
    (
      operator: DictionaryFilterOperator,
      option: DictionaryFilterOperatorOption,
    ) => {
      /*
       * Steve reported it on the operators he happened to try. The defect was
       * in all of them, so walk the whole dropdown.
       */
      const stored: DictionaryEntryValue = buildDictionaryValue({
        operator,
        rawValue: option.expectsNumericValue ? "5" : "web",
        rawValues: ["web", "api"],
      });

      expect(() => {
        renderChips([chipWithValue(stored)]);
      }).not.toThrow();

      expect(document.body.textContent).not.toContain("[object Object]");
    },
  );

  test("ordinary string chips are untouched", () => {
    renderChips([
      {
        facetKey: "severityText",
        value: "Error",
        displayKey: "Severity",
        displayValue: "Error",
      },
    ]);

    expect(screen.getByText("Severity:")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});
