import LogSearchBar, {
  isLogSearchFieldAlias,
  resolveLogSearchField,
} from "../../../UI/Components/LogsViewer/components/LogSearchBar";
import TelemetrySearchBar, {
  resolveTelemetrySearchField,
} from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchBar";
import { SEARCH_SUGGESTIONS_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchSuggestions";
import { INHERITED_PROPERTY_NAME_SPELLINGS } from "../../Helpers/InheritedNames";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A field typed before the colon is looked up twice: among the bar's
 * aliases (level -> severityText), and in the values suggested for each
 * field. Both were plain objects read by what somebody typed, so a field
 * named after something every object inherits answered with a function:
 * `constructor:` drew Object's constructor as the list of values - the
 * dropdown called map() on it and the whole explorer broke - and
 * `constructor:x` broke it on filter(). Logs, traces, exceptions, metrics
 * and Security Events all draw one of these two bars.
 *
 * A typed field is the bar's own alias, or the name as typed, an
 * attribute's; only the values suggested for that very field are offered.
 */

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  fieldAliasMap?: Record<string, string> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
}

const BARS: Array<{
  name: string;
  Bar: React.ComponentType<SearchBarProps>;
}> = [
  {
    name: "the logs search bar",
    Bar: LogSearchBar as unknown as React.ComponentType<SearchBarProps>,
  },
  {
    name: "the explorers' search bar",
    Bar: TelemetrySearchBar as unknown as React.ComponentType<SearchBarProps>,
  },
];

// What each bar suggests for the severity, by the field its alias reads.
const VALUE_SUGGESTIONS: Record<string, Array<string>> = {
  severityText: ["error", "warning"],
  env: ["production", "staging"],
};

// The explorers' bar takes its page's aliases (the logs bar has its own).
const EXPLORER_ALIASES: Record<string, string> = {
  level: "severityText",
};

afterEach(() => {
  cleanup();
});

function renderBar(
  Bar: React.ComponentType<SearchBarProps>,
  value: string,
): {
  input: HTMLElement;
  onSubmit: MockFunction;
  onFieldValueSelect: MockFunction;
} {
  const onSubmit: MockFunction = getJestMockFunction();
  const onFieldValueSelect: MockFunction = getJestMockFunction();

  render(
    <Bar
      value={value}
      onChange={getJestMockFunction() as unknown as (value: string) => void}
      onSubmit={onSubmit as unknown as () => void}
      valueSuggestions={VALUE_SUGGESTIONS}
      fieldAliasMap={EXPLORER_ALIASES}
      onFieldValueSelect={
        onFieldValueSelect as unknown as (
          fieldKey: string,
          value: string,
        ) => void
      }
    />,
  );

  const input: HTMLElement = screen.getByRole("textbox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });

  return { input, onSubmit, onFieldValueSelect };
}

// The value rows the dropdown offers, as drawn.
function offeredValues(): Array<string> {
  const dropdown: HTMLElement | null = screen.queryByTestId(
    SEARCH_SUGGESTIONS_TEST_ID,
  );

  if (!dropdown) {
    return [];
  }

  // Each row is a button: the field in front, then the value it offers.
  return Array.from(dropdown.querySelectorAll("button")).map(
    (row: Element): string => {
      const parts: Array<Element> = Array.from(row.querySelectorAll("span"));

      return (parts[parts.length - 1]?.textContent || "").trim();
    },
  );
}

describe.each(BARS)(
  "$name: fields named after what every object inherits",
  ({ Bar }: { Bar: React.ComponentType<SearchBarProps> }) => {
    test("such a field has no values to suggest, typed with @ or without, with a value begun or not - and the bar is still drawn", () => {
      for (const name of INHERITED_PROPERTY_NAME_SPELLINGS) {
        for (const value of [`@${name}:`, `@${name}:e`, `${name}:`]) {
          renderBar(Bar, value);

          expect({ value, offered: offeredValues() }).toEqual({
            value,
            offered: [],
          });
          expect(screen.getByRole("textbox")).toHaveValue(value);

          cleanup();
        }
      }
    });

    test("Enter on such a field hands it on as typed, an attribute filter of that name", () => {
      for (const name of INHERITED_PROPERTY_NAME_SPELLINGS) {
        const { input, onFieldValueSelect } = renderBar(Bar, `@${name}:x`);

        fireEvent.keyDown(input, { key: "Enter" });

        expect(onFieldValueSelect).toHaveBeenCalledTimes(1);
        expect(onFieldValueSelect).toHaveBeenCalledWith(name, "x");

        cleanup();
      }
    });

    test("the bar's own alias still offers its field's values, in any case", () => {
      for (const value of ["level:", "LEVEL:", "@level:"]) {
        renderBar(Bar, value);

        expect({ value, offered: offeredValues() }).toEqual({
          value,
          offered: ["error", "warning"],
        });

        cleanup();
      }

      renderBar(Bar, "@env:pro");

      expect(offeredValues()).toEqual(["production"]);
    });
  },
);

describe("the typed field each bar resolves", () => {
  test("the logs bar: its five aliases in any case, every other name as typed", () => {
    expect(
      ["severity", "LEVEL", "Service", "trace", "span"].map(
        resolveLogSearchField,
      ),
    ).toEqual([
      "severityText",
      "severityText",
      "primaryEntityId",
      "traceId",
      "spanId",
    ]);
    expect(resolveLogSearchField("requestId")).toBe("requestId");

    for (const name of INHERITED_PROPERTY_NAME_SPELLINGS) {
      expect({
        name,
        field: resolveLogSearchField(name),
        isAlias: isLogSearchFieldAlias(name),
      }).toEqual({ name, field: name, isAlias: false });
    }
  });

  test("the explorers' bar: the page's aliases in any case, every other name as typed", () => {
    expect(resolveTelemetrySearchField("Level", EXPLORER_ALIASES)).toBe(
      "severityText",
    );
    expect(resolveTelemetrySearchField("http.method", EXPLORER_ALIASES)).toBe(
      "http.method",
    );

    for (const name of INHERITED_PROPERTY_NAME_SPELLINGS) {
      expect({
        name,
        field: resolveTelemetrySearchField(name, EXPLORER_ALIASES),
        withNoAliases: resolveTelemetrySearchField(name, {}),
      }).toEqual({ name, field: name, withNoAliases: name });
    }
  });
});
