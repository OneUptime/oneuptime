import DictionaryForm, {
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
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
 * DictionaryForm is what "Filter by Attributes" is made of: FormField renders
 * it for every FormFieldSchemaType.Dictionary field, and the only two fields in
 * the app with that type are the attribute filters on the Log and Trace monitor
 * steps — the criteria editor. So a row that misbehaves here misbehaves in
 * exactly one user-visible place, and that place is the monitoring criteria
 * modal.
 *
 * These tests cover the row lifecycle a user actually walks through: add a row,
 * pick a key off the suggestion list, choose an operator and a type, type a
 * value, delete it again. The regressions they pin are the ones that used to
 * take the criteria modal down with them; see the "clearing a Number value"
 * block for the specific defect.
 */

const ATTRIBUTE_KEYS: Array<string> = [
  "{OriginalFormat}",
  "Action",
  "ActionId",
  "ActionName",
  "ActionType",
  "AlreadyCancelled",
];

const ADD_BUTTON_TITLE: string = "Add Filter by Attributes";

/*
 * AutocompleteTextInput and react-select both report role="combobox", so the
 * only stable way to single out the hand-rolled ones is the listbox they own.
 */
type AutocompleteInputsFunction = () => Array<HTMLInputElement>;

const autocompleteInputs: AutocompleteInputsFunction =
  (): Array<HTMLInputElement> => {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[aria-controls^="autocomplete-suggestions-"]',
      ),
    );
  };

type KeyInputFunction = (rowIndex?: number) => HTMLInputElement;

const keyInput: KeyInputFunction = (rowIndex: number = 0): HTMLInputElement => {
  /*
   * A Text row contributes two autocompletes (key and value) and a Number or
   * Boolean row only one (the key), so rows cannot be indexed by a fixed
   * stride. Walking the labelled columns instead survives either shape.
   */
  const keyInputs: Array<HTMLInputElement> = autocompleteInputs().filter(
    (input: HTMLInputElement) => {
      return input.getAttribute("placeholder") !== "Value";
    },
  );

  return keyInputs[rowIndex]!;
};

type NumberInputsFunction = () => Array<HTMLInputElement>;

const numberInputs: NumberInputsFunction = (): Array<HTMLInputElement> => {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="number"]'),
  );
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

type ComboboxesFunction = () => Array<HTMLElement>;

const comboboxes: ComboboxesFunction = (): Array<HTMLElement> => {
  return screen.getAllByRole("combobox");
};

/*
 * Column order inside a row, with operators enabled: key autocomplete,
 * operator select, type select, value. Only the two selects are react-select.
 */
type TypeSelectFunction = () => HTMLElement;

const typeSelect: TypeSelectFunction = (): HTMLElement => {
  return comboboxes()[2]!;
};

type OperatorSelectFunction = () => HTMLElement;

const operatorSelect: OperatorSelectFunction = (): HTMLElement => {
  return comboboxes()[1]!;
};

interface RenderResult {
  emitted: Array<Dictionary<DictionaryEntryValue>>;
  lastEmitted: () => Dictionary<DictionaryEntryValue> | undefined;
}

type RenderRowFunction = (
  initialValue?: Dictionary<DictionaryEntryValue>,
) => RenderResult;

const renderDictionary: RenderRowFunction = (
  initialValue?: Dictionary<DictionaryEntryValue>,
): RenderResult => {
  const emitted: Array<Dictionary<DictionaryEntryValue>> = [];

  render(
    <DictionaryForm
      keys={ATTRIBUTE_KEYS}
      enableOperators={true}
      valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
      addButtonSuffix="Filter by Attributes"
      keyPlaceholder="Key"
      valuePlaceholder="Value"
      initialValue={initialValue || {}}
      onChange={(value: Dictionary<DictionaryEntryValue>) => {
        emitted.push(value);
      }}
    />,
  );

  return {
    emitted: emitted,
    lastEmitted: () => {
      return emitted.length > 0 ? emitted[emitted.length - 1] : undefined;
    },
  };
};

type AddRowFunction = () => void;

const addRow: AddRowFunction = (): void => {
  fireEvent.click(screen.getByText(ADD_BUTTON_TITLE));
};

describe("Dictionary — the 'Filter by Attributes' row", () => {
  afterEach(() => {
    cleanup();
  });

  describe("picking a key off the suggestion list", () => {
    test("adding a row renders an empty key, operator, type and value", () => {
      renderDictionary();

      expect(autocompleteInputs()).toHaveLength(0);

      addRow();

      expect(keyInput().value).toBe("");
      expect(screen.getByText("Key")).toBeInTheDocument();
      expect(screen.getByText("Operator")).toBeInTheDocument();
      expect(screen.getByText("Type")).toBeInTheDocument();
      expect(screen.getByText("Value")).toBeInTheDocument();
    });

    test("focusing the key input offers every known attribute key", () => {
      renderDictionary();
      addRow();

      fireEvent.focus(keyInput());

      ATTRIBUTE_KEYS.forEach((attributeKey: string) => {
        expect(screen.getByText(attributeKey)).toBeInTheDocument();
      });
    });

    test("picking a key fills the input and emits it", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.mouseDown(screen.getByText("ActionName"));
      fireEvent.click(screen.getByText("ActionName"));

      expect(keyInput().value).toBe("ActionName");
      expect(rendered.lastEmitted()).toEqual({ ActionName: "" });
    });

    test("typing narrows the suggestions to matching keys", () => {
      renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.change(keyInput(), { target: { value: "ActionN" } });

      expect(screen.getByText("ActionName")).toBeInTheDocument();
      expect(screen.queryByText("AlreadyCancelled")).not.toBeInTheDocument();
    });

    test("a key and a value round-trip into the emitted dictionary", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("ActionName"));

      const valueInput: HTMLInputElement = autocompleteInputs().filter(
        (input: HTMLInputElement) => {
          return input.getAttribute("placeholder") === "Value";
        },
      )[0]!;
      fireEvent.change(valueInput, { target: { value: "checkout" } });

      expect(rendered.lastEmitted()).toEqual({ ActionName: "checkout" });
    });
  });

  /*
   * The regression this file exists for.
   *
   * The Number value input used to `delete newData[index]` when the box was
   * emptied. Two things follow from deleting an array member rather than
   * emptying it, and a user hit both in a row:
   *
   *   1. The row itself disappeared. Someone who cleared a number to retype it
   *      watched the whole filter — key, operator and all — vanish.
   *   2. `delete` leaves a *hole*, and `Array.prototype.map` skips holes while
   *      the spread in `[...data, newItem]` materialises them as `undefined`.
   *      So the next "Add Filter by Attributes" click rendered an `undefined`
   *      row and threw `Cannot read properties of undefined (reading
   *      'operator')`, taking the criteria modal down with it.
   */
  describe("clearing a Number value", () => {
    type AddNumberRowFunction = () => void;

    const addNumberRow: AddNumberRowFunction = (): void => {
      addRow();
      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("ActionId"));
      selectOption(typeSelect(), "Number");
    };

    test("keeps the row instead of deleting it", () => {
      renderDictionary();
      addNumberRow();

      fireEvent.change(numberInputs()[0]!, { target: { value: "5" } });
      expect(numberInputs()).toHaveLength(1);

      fireEvent.change(numberInputs()[0]!, { target: { value: "" } });

      expect(numberInputs()).toHaveLength(1);
      expect(keyInput().value).toBe("ActionId");
    });

    test("drops the key from the emitted dictionary", () => {
      const rendered: RenderResult = renderDictionary();
      addNumberRow();

      fireEvent.change(numberInputs()[0]!, { target: { value: "5" } });
      expect(rendered.lastEmitted()).toEqual({ ActionId: 5 });

      fireEvent.change(numberInputs()[0]!, { target: { value: "" } });

      expect(rendered.lastEmitted()).toEqual({});
    });

    test("does not stop the user retyping a number", () => {
      const rendered: RenderResult = renderDictionary();
      addNumberRow();

      fireEvent.change(numberInputs()[0]!, { target: { value: "5" } });
      fireEvent.change(numberInputs()[0]!, { target: { value: "" } });
      fireEvent.change(numberInputs()[0]!, { target: { value: "42" } });

      expect(rendered.lastEmitted()).toEqual({ ActionId: 42 });
    });

    test("leaves the form able to add another row", () => {
      renderDictionary();
      addNumberRow();

      fireEvent.change(numberInputs()[0]!, { target: { value: "5" } });
      fireEvent.change(numberInputs()[0]!, { target: { value: "" } });

      // This is the click that used to render an `undefined` row and throw.
      addRow();

      expect(keyInput(0).value).toBe("ActionId");
      expect(keyInput(1).value).toBe("");
      expect(screen.getByText(ADD_BUTTON_TITLE)).toBeInTheDocument();
    });

    test("leaves the surviving row deletable", () => {
      renderDictionary();
      addNumberRow();

      fireEvent.change(numberInputs()[0]!, { target: { value: "" } });

      fireEvent.click(screen.getByTestId("delete-ActionId"));

      expect(autocompleteInputs()).toHaveLength(0);
    });
  });

  describe("switching the value type", () => {
    test("an untouched Number row contributes nothing to the dictionary", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("ActionId"));
      selectOption(typeSelect(), "Number");

      /*
       * Switching type blanks the value. Emitting `{ ActionId: "" }` would ship
       * an empty string where the query expects a number.
       */
      expect(rendered.lastEmitted()).toEqual({});
    });

    test("a Boolean row emits a boolean", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("AlreadyCancelled"));
      selectOption(typeSelect(), "Boolean");

      expect(rendered.lastEmitted()).toEqual({ AlreadyCancelled: true });

      selectOption(comboboxes()[3]!, "False");

      expect(rendered.lastEmitted()).toEqual({ AlreadyCancelled: false });
    });

    test("going back to Text restores the value autocomplete", () => {
      renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("ActionId"));

      selectOption(typeSelect(), "Number");
      expect(numberInputs()).toHaveLength(1);

      selectOption(typeSelect(), "Text");
      expect(numberInputs()).toHaveLength(0);
      expect(keyInput().value).toBe("ActionId");
    });
  });

  describe("operators", () => {
    test("a value-less operator hides the value input and emits the operator", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("Action"));

      selectOption(operatorSelect(), "is empty");

      /*
       * "is empty" has nothing to type into, so the value box is inert (the
       * shared Input renders a disabled field as readOnly).
       */
      expect(
        (screen.getByPlaceholderText("is empty") as HTMLInputElement).readOnly,
      ).toBe(true);
      expect(rendered.lastEmitted()!["Action"]).toBeInstanceOf(IsNull);
    });

    test("switching to a multi-value operator resets a scalar value", () => {
      const rendered: RenderResult = renderDictionary();
      addRow();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByText("Action"));

      const valueInput: HTMLInputElement = autocompleteInputs().filter(
        (input: HTMLInputElement) => {
          return input.getAttribute("placeholder") === "Value";
        },
      )[0]!;
      fireEvent.change(valueInput, { target: { value: "checkout" } });
      expect(rendered.lastEmitted()).toEqual({ Action: "checkout" });

      selectOption(operatorSelect(), "is any of");

      /*
       * The scalar has to go: shipping "checkout" where the query now expects
       * a list would be a stale value in the wrong shape.
       */
      const emittedValue: DictionaryEntryValue =
        rendered.lastEmitted()!["Action"]!;
      expect(emittedValue).toBeInstanceOf(Includes);
      expect((emittedValue as Includes).values).toEqual([]);
    });
  });

  describe("several rows", () => {
    test("each row keeps its own key", () => {
      const rendered: RenderResult = renderDictionary();

      addRow();
      fireEvent.focus(keyInput(0));
      fireEvent.click(screen.getByText("Action"));

      addRow();
      fireEvent.focus(keyInput(1));
      fireEvent.click(screen.getByText("ActionType"));

      expect(keyInput(0).value).toBe("Action");
      expect(keyInput(1).value).toBe("ActionType");
      expect(rendered.lastEmitted()).toEqual({ Action: "", ActionType: "" });
    });

    test("deleting the first row leaves the second intact", () => {
      const rendered: RenderResult = renderDictionary();

      addRow();
      fireEvent.focus(keyInput(0));
      fireEvent.click(screen.getByText("Action"));

      addRow();
      fireEvent.focus(keyInput(1));
      fireEvent.click(screen.getByText("ActionType"));

      fireEvent.click(screen.getByTestId("delete-Action"));

      expect(keyInput(0).value).toBe("ActionType");
      expect(rendered.lastEmitted()).toEqual({ ActionType: "" });
    });
  });

  describe("existing filters", () => {
    test("an initial dictionary is rendered as rows", () => {
      renderDictionary({ Action: "checkout", ActionId: 7 });

      expect(keyInput(0).value).toBe("Action");
      expect(keyInput(1).value).toBe("ActionId");
      expect(numberInputs()[0]!.value).toBe("7");
    });

    test("clearing an existing Number filter keeps its row", () => {
      const rendered: RenderResult = renderDictionary({
        Action: "checkout",
        ActionId: 7,
      });

      fireEvent.change(numberInputs()[0]!, { target: { value: "" } });

      expect(keyInput(1).value).toBe("ActionId");
      expect(rendered.lastEmitted()).toEqual({ Action: "checkout" });
    });
  });
});
