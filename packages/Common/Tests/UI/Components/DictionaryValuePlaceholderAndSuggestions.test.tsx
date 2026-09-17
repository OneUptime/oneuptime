import DictionaryForm, {
  ComponentProps,
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import Includes from "../../../Types/BaseDatabase/Includes";
import Dictionary from "../../../Types/Dictionary";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What a DictionaryForm row offers the user in its value box comes from exactly
 * two props: `valuePlaceholder` (one hint for the whole form) and
 * `valueSuggestions` (a list per key). There used to be two more —
 * `valuePlaceholders`, a per-key placeholder overriding the form-wide one, and
 * `defaultValueSuggestions`, a list offered on any row whose key had no list of
 * its own. Both existed only for the workflow record editor, which now renders
 * its own schema-driven editor and never mounts this component, so both were
 * removed along with the merging logic behind them.
 *
 * These tests pin what survives that removal, and they are written so that
 * re-introducing either fallback fails them:
 *
 *   - the placeholder is form-wide, so two rows with different keys show the
 *     same hint, and a row shows it whether or not its key is known;
 *   - suggestions are strictly per key, so a key with no list — or an empty
 *     one, or no key typed yet — offers nothing at all rather than falling back
 *     to some other list.
 *
 * Everything else here is the ordinary behaviour of the value box those two
 * props drive: filtering, picking, switching key, the multi-select an
 * "is any of" operator turns the box into, the loading row, and the
 * `onValueSearch` callback that lets a parent refine the list server-side.
 */

const VALUE_PLACEHOLDER: string = "Attribute value";
const KEY_PLACEHOLDER: string = "Attribute key";
const ADD_BUTTON_TITLE: string = "Add Attribute";

const VALUE_SUGGESTIONS: Record<string, Array<string>> = {
  env: ["production", "staging", "development"],
  region: ["us-east-1", "eu-west-2"],
  // A key that is known but has no values to offer yet.
  team: [],
};

interface RenderResult {
  emitted: Array<Dictionary<DictionaryEntryValue>>;
  searches: Array<{ key: string; searchText: string }>;
  lastEmitted: () => Dictionary<DictionaryEntryValue> | undefined;
}

type RenderDictionaryFunction = (
  overrides?: Partial<ComponentProps>,
) => RenderResult;

const renderDictionary: RenderDictionaryFunction = (
  overrides: Partial<ComponentProps> = {},
): RenderResult => {
  const emitted: Array<Dictionary<DictionaryEntryValue>> = [];
  const searches: Array<{ key: string; searchText: string }> = [];

  render(
    <DictionaryForm
      addButtonSuffix="Attribute"
      keyPlaceholder={KEY_PLACEHOLDER}
      valuePlaceholder={VALUE_PLACEHOLDER}
      valueSuggestions={VALUE_SUGGESTIONS}
      onChange={(value: Dictionary<DictionaryEntryValue>) => {
        emitted.push(value);
      }}
      onValueSearch={(key: string, searchText: string) => {
        searches.push({ key: key, searchText: searchText });
      }}
      {...overrides}
    />,
  );

  return {
    emitted: emitted,
    searches: searches,
    lastEmitted: () => {
      return emitted.length > 0 ? emitted[emitted.length - 1] : undefined;
    },
  };
};

/*
 * Rows are the only `items-start` flex containers the form renders, so they are
 * the one stable handle on "this row's inputs" — indexing a flat list of inputs
 * breaks as soon as a row changes shape (a Number row has one autocomplete, a
 * Text row two).
 */
type RowsFunction = () => Array<HTMLElement>;

const rows: RowsFunction = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll<HTMLElement>("div.flex.items-start"),
  );
};

/*
 * AutocompleteTextInput and react-select both report role="combobox", so the
 * only stable way to single out the hand-rolled ones is the listbox they own.
 */
type AutocompletesInRowFunction = (rowIndex: number) => Array<HTMLInputElement>;

const autocompletesInRow: AutocompletesInRowFunction = (
  rowIndex: number,
): Array<HTMLInputElement> => {
  return Array.from(
    rows()[rowIndex]!.querySelectorAll<HTMLInputElement>(
      'input[aria-controls^="autocomplete-suggestions-"]',
    ),
  );
};

type RowInputFunction = (rowIndex?: number) => HTMLInputElement;

const keyInput: RowInputFunction = (rowIndex: number = 0): HTMLInputElement => {
  return autocompletesInRow(rowIndex)[0]!;
};

const valueInput: RowInputFunction = (
  rowIndex: number = 0,
): HTMLInputElement => {
  return autocompletesInRow(rowIndex)[1]!;
};

type NumberInputFunction = () => HTMLInputElement;

const numberInput: NumberInputFunction = (): HTMLInputElement => {
  return document.querySelector<HTMLInputElement>('input[type="number"]')!;
};

/*
 * Column order inside a row: key autocomplete, then the operator select when
 * operators are enabled, then the value control. The value control is always
 * the last combobox in the row, whichever shape it currently has.
 */
type RowComboboxesFunction = (rowIndex: number) => Array<HTMLElement>;

const rowComboboxes: RowComboboxesFunction = (
  rowIndex: number,
): Array<HTMLElement> => {
  return Array.from(
    rows()[rowIndex]!.querySelectorAll<HTMLElement>('[role="combobox"]'),
  );
};

type RowComboboxFunction = (rowIndex?: number) => HTMLElement;

const operatorSelect: RowComboboxFunction = (
  rowIndex: number = 0,
): HTMLElement => {
  return rowComboboxes(rowIndex)[1]!;
};

const valueSelect: RowComboboxFunction = (
  rowIndex: number = 0,
): HTMLElement => {
  const comboboxes: Array<HTMLElement> = rowComboboxes(rowIndex);
  return comboboxes[comboboxes.length - 1]!;
};

/*
 * react-select opens on ArrowDown and its options are portalled to
 * document.body, so they are reachable by role from `screen` but never from
 * inside the form's own subtree.
 */
type SelectOptionFunction = (combobox: HTMLElement, optionText: string) => void;

const selectOption: SelectOptionFunction = (
  combobox: HTMLElement,
  optionText: string,
): void => {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(optionText);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

/*
 * Both the autocomplete menu and react-select's menu report role="option", and
 * only one of them is ever open at a time in these tests.
 */
type OpenOptionsFunction = () => Array<string>;

const openOptions: OpenOptionsFunction = (): Array<string> => {
  return screen.queryAllByRole("option").map((option: HTMLElement) => {
    return option.textContent || "";
  });
};

type AddRowFunction = () => void;

const addRow: AddRowFunction = (): void => {
  fireEvent.click(screen.getByText(ADD_BUTTON_TITLE));
};

type TypeKeyFunction = (key: string, rowIndex?: number) => void;

const typeKey: TypeKeyFunction = (key: string, rowIndex: number = 0): void => {
  fireEvent.change(keyInput(rowIndex), { target: { value: key } });
};

type AddRowWithKeyFunction = (key: string) => void;

const addRowWithKey: AddRowWithKeyFunction = (key: string): void => {
  addRow();
  typeKey(key, rows().length - 1);
};

describe("Dictionary — the value box", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the value placeholder", () => {
    test("shows the form-wide placeholder on a row with a known key", () => {
      renderDictionary();
      addRowWithKey("env");

      expect(valueInput().getAttribute("placeholder")).toBe(VALUE_PLACEHOLDER);
    });

    test("shows it on a row whose key is still blank", () => {
      renderDictionary();
      addRow();

      expect(valueInput().getAttribute("placeholder")).toBe(VALUE_PLACEHOLDER);
    });

    test("shows it on a row whose key has no suggestions of its own", () => {
      renderDictionary();
      addRowWithKey("some.unknown.attribute");

      expect(valueInput().getAttribute("placeholder")).toBe(VALUE_PLACEHOLDER);
    });

    /*
     * The pin for the removed per-key `valuePlaceholders`: the hint is a
     * property of the form, not of the column, so two rows sitting on different
     * keys read exactly the same.
     */
    test("is the same on every row, whatever each row's key is", () => {
      renderDictionary();
      addRowWithKey("env");
      addRowWithKey("region");

      expect(valueInput(0).getAttribute("placeholder")).toBe(VALUE_PLACEHOLDER);
      expect(valueInput(1).getAttribute("placeholder")).toBe(VALUE_PLACEHOLDER);
    });

    test("does not leak into the key input, which keeps its own", () => {
      renderDictionary();
      addRowWithKey("env");

      expect(keyInput().getAttribute("placeholder")).toBe(KEY_PLACEHOLDER);
    });

    test("a Number row uses it too", () => {
      renderDictionary({
        valueTypes: [ValueType.Text, ValueType.Number],
        initialValue: { latency: 200 },
      });

      expect(numberInput().getAttribute("placeholder")).toBe(VALUE_PLACEHOLDER);
    });

    test("an 'is any of' row uses it as the multi-select's placeholder", () => {
      renderDictionary({ enableOperators: true });
      addRowWithKey("env");

      selectOption(operatorSelect(), "is any of");

      expect(screen.getByText(VALUE_PLACEHOLDER)).toBeInTheDocument();
    });

    test("a numeric operator overrides it with 'Number'", () => {
      renderDictionary({ enableOperators: true });
      addRowWithKey("env");

      selectOption(operatorSelect(), ">");

      expect(valueInput().getAttribute("placeholder")).toBe("Number");
    });

    test("a value-less operator labels the inert box with the operator", () => {
      renderDictionary({ enableOperators: true });
      addRowWithKey("env");

      selectOption(operatorSelect(), "is empty");

      const inertInput: HTMLInputElement = screen.getByPlaceholderText(
        "is empty",
      ) as HTMLInputElement;
      expect(inertInput.readOnly).toBe(true);
      expect(screen.queryByPlaceholderText(VALUE_PLACEHOLDER)).toBeNull();
    });

    test("with no placeholder prop the value input simply has none", () => {
      /*
       * Rendered directly rather than through renderDictionary: the prop is
       * declared `valuePlaceholder?: string`, and under
       * exactOptionalPropertyTypes passing an explicit `undefined` is not the
       * same as leaving it off.
       */
      render(
        <DictionaryForm
          addButtonSuffix="Attribute"
          keyPlaceholder={KEY_PLACEHOLDER}
          valueSuggestions={VALUE_SUGGESTIONS}
        />,
      );
      addRowWithKey("env");

      expect(valueInput().getAttribute("placeholder")).toBeNull();
    });
  });

  describe("per-key value suggestions", () => {
    test("focusing the value box offers that key's values", () => {
      renderDictionary();
      addRowWithKey("env");

      fireEvent.focus(valueInput());

      expect(openOptions()).toEqual(["production", "staging", "development"]);
    });

    test("a different key offers a different set", () => {
      renderDictionary();
      addRowWithKey("region");

      fireEvent.focus(valueInput());

      expect(openOptions()).toEqual(["us-east-1", "eu-west-2"]);
    });

    /*
     * The pin for the removed `defaultValueSuggestions`: a key nobody has
     * values for offers nothing, rather than falling back to a form-wide list.
     */
    test("a key with no list of its own offers nothing", () => {
      renderDictionary();
      addRowWithKey("some.unknown.attribute");

      fireEvent.focus(valueInput());

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(openOptions()).toEqual([]);
    });

    test("a key whose list is empty offers nothing", () => {
      renderDictionary();
      addRowWithKey("team");

      fireEvent.focus(valueInput());

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(openOptions()).toEqual([]);
    });

    test("a row with no key yet offers nothing", () => {
      renderDictionary();
      addRow();

      fireEvent.focus(valueInput());

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(openOptions()).toEqual([]);
    });

    test("with no valueSuggestions prop at all, nothing is offered", () => {
      renderDictionary({ valueSuggestions: undefined });
      addRowWithKey("env");

      fireEvent.focus(valueInput());

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(openOptions()).toEqual([]);
    });

    test("typing narrows the list to matching values", () => {
      renderDictionary();
      addRowWithKey("env");

      fireEvent.change(valueInput(), { target: { value: "st" } });

      expect(openOptions()).toEqual(["staging"]);
    });

    test("picking a value fills the box and emits it", () => {
      const rendered: RenderResult = renderDictionary();
      addRowWithKey("env");

      fireEvent.focus(valueInput());
      fireEvent.click(screen.getByText("staging"));

      expect(valueInput().value).toBe("staging");
      expect(rendered.lastEmitted()).toEqual({ env: "staging" });
    });

    test("changing the key swaps the suggestion set", () => {
      renderDictionary();
      addRowWithKey("env");

      fireEvent.focus(valueInput());
      expect(openOptions()).toContain("production");

      typeKey("region");
      fireEvent.focus(valueInput());

      expect(openOptions()).toEqual(["us-east-1", "eu-west-2"]);
    });

    test("changing to a key with no list closes the offer", () => {
      renderDictionary();
      addRowWithKey("env");

      fireEvent.focus(valueInput());
      expect(openOptions()).toContain("production");

      typeKey("some.unknown.attribute");

      expect(openOptions()).toEqual([]);
    });

    test("each row is offered its own key's values", () => {
      renderDictionary();
      addRowWithKey("env");
      addRowWithKey("region");

      fireEvent.focus(valueInput(0));
      expect(openOptions()).toEqual(["production", "staging", "development"]);

      fireEvent.blur(valueInput(0));
      fireEvent.keyDown(valueInput(0), { key: "Escape" });

      fireEvent.focus(valueInput(1));
      expect(openOptions()).toContain("us-east-1");
      expect(openOptions()).not.toContain("production");
    });

    test("suggestions do not stop the user typing a value of their own", () => {
      const rendered: RenderResult = renderDictionary();
      addRowWithKey("env");

      fireEvent.change(valueInput(), { target: { value: "canary" } });

      expect(valueInput().value).toBe("canary");
      expect(rendered.lastEmitted()).toEqual({ env: "canary" });
    });

    test("the key input keeps offering keys, not values", () => {
      renderDictionary({ keys: ["env", "region"] });
      addRow();

      fireEvent.focus(keyInput());

      expect(openOptions()).toEqual(["env", "region"]);
    });
  });

  describe("the multi-select an 'is any of' row turns the value box into", () => {
    test("offers the key's values as its options", () => {
      renderDictionary({ enableOperators: true });
      addRowWithKey("env");

      selectOption(operatorSelect(), "is any of");
      fireEvent.keyDown(valueSelect(), { key: "ArrowDown" });

      expect(openOptions()).toEqual(["production", "staging", "development"]);
    });

    test("offers nothing for a key with no list of its own", () => {
      renderDictionary({ enableOperators: true });
      addRowWithKey("some.unknown.attribute");

      selectOption(operatorSelect(), "is any of");
      fireEvent.keyDown(valueSelect(), { key: "ArrowDown" });

      expect(openOptions()).toEqual([]);
    });

    test("emits the picked values as an Includes", () => {
      const rendered: RenderResult = renderDictionary({
        enableOperators: true,
      });
      addRowWithKey("env");

      selectOption(operatorSelect(), "is any of");
      selectOption(valueSelect(), "production");

      const emittedValue: DictionaryEntryValue =
        rendered.lastEmitted()!["env"]!;
      expect(emittedValue).toBeInstanceOf(Includes);
      expect((emittedValue as Includes).values).toEqual(["production"]);
    });

    test("a picked value becomes a chip and leaves the rest on offer", () => {
      renderDictionary({ enableOperators: true });
      addRowWithKey("env");

      selectOption(operatorSelect(), "is any of");
      selectOption(valueSelect(), "production");

      // The picked value is now a chip, so the menu offers only what is left.
      expect(screen.getByText("production")).toBeInTheDocument();

      fireEvent.keyDown(valueSelect(), { key: "ArrowDown" });

      expect(openOptions()).toEqual(["staging", "development"]);
    });

    test("a stored value that is no longer suggested is still shown", () => {
      /*
       * Saved filters outlive the suggestion list they were picked from — the
       * options are the union of the key's suggestions and whatever the row
       * already holds, so a value the server no longer returns still renders
       * rather than silently vanishing from the user's filter.
       */
      renderDictionary({
        enableOperators: true,
        initialValue: { env: new Includes(["retired-environment"]) },
      });

      expect(screen.getByText("retired-environment")).toBeInTheDocument();
    });
  });

  describe("loading values from the server", () => {
    test("a key being loaded shows the loading row", () => {
      renderDictionary({
        valueSuggestions: {},
        loadingValueKeys: ["env"],
      });
      addRowWithKey("env");

      fireEvent.focus(valueInput());

      expect(screen.getByText("Loading values...")).toBeInTheDocument();
    });

    test("only the row whose key is loading shows it", () => {
      renderDictionary({
        valueSuggestions: {},
        loadingValueKeys: ["env"],
      });
      addRowWithKey("region");

      fireEvent.focus(valueInput());

      expect(screen.queryByText("Loading values...")).not.toBeInTheDocument();
    });

    test("typing a value asks the parent to refine the list", () => {
      const rendered: RenderResult = renderDictionary();
      addRowWithKey("env");

      fireEvent.change(valueInput(), { target: { value: "prod" } });

      expect(rendered.searches).toEqual([{ key: "env", searchText: "prod" }]);
    });

    test("a row with no key does not ask", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.change(valueInput(), { target: { value: "prod" } });

      expect(rendered.searches).toEqual([]);
    });

    test("a numeric operator does not ask — it has no values to narrow", () => {
      const rendered: RenderResult = renderDictionary({
        enableOperators: true,
      });
      addRowWithKey("env");

      selectOption(operatorSelect(), ">");
      fireEvent.change(valueInput(), { target: { value: "500" } });

      expect(rendered.searches).toEqual([]);
    });
  });
});
