import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEventAttributeColumnPicker, {
  SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID,
  SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_RESULT_LIMIT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeColumnPicker";

/*
 * "Columns" on the security events explorer: which source attributes each
 * row shows as extra chips.
 *
 * The model table this explorer replaced had an "Add Attribute Column"
 * picker; the explorer's chip rows lost it, and a Google SecOps customer
 * asked for it back so their analysts could see the target's first name and
 * office on every detection without opening each one. What is pinned here is
 * the picker as a reader drives it: find a key among thousands, add it,
 * reorder and remove what is there, and get out of the way.
 */

const FIRST_NAME_KEY: string =
  "collectionElements.0.references.0.event.target.user.firstName";
const CITY_KEY: string =
  "collectionElements.0.references.0.event.target.user.personalAddress.city";
const ADDRESS_KEY: string =
  "collectionElements.0.references.0.event.target.user.personalAddress.name";
const PRINCIPAL_FIRST_NAME_KEY: string =
  "collectionElements.0.references.0.event.principal.user.firstName";

const KEYS: Array<string> = [
  PRINCIPAL_FIRST_NAME_KEY,
  CITY_KEY,
  ADDRESS_KEY,
  FIRST_NAME_KEY,
  "device.hostname",
];

function renderPicker(
  props: {
    attributeKeys?: Array<string>;
    selectedKeys?: Array<string>;
    isLoading?: boolean;
    onChange?: (keys: Array<string>) => void;
  } = {},
): void {
  render(
    <SecurityEventAttributeColumnPicker
      attributeKeys={props.attributeKeys || KEYS}
      selectedKeys={props.selectedKeys || []}
      isLoading={props.isLoading}
      onChange={props.onChange || ((): void => {})}
    />,
  );
}

/*
 * The picker is controlled; this is the page around it, so a sequence of
 * clicks can be driven and read back the way the explorer would hold it.
 */
function StatefulPicker(props: {
  initialKeys?: Array<string>;
  attributeKeys?: Array<string>;
  onChange?: (keys: Array<string>) => void;
}): ReactElement {
  const [keys, setKeys] = useState<Array<string>>(props.initialKeys || []);

  return (
    <div>
      <button type="button">Somewhere else on the page</button>
      <SecurityEventAttributeColumnPicker
        attributeKeys={props.attributeKeys || KEYS}
        selectedKeys={keys}
        onChange={(next: Array<string>) => {
          setKeys(next);
          props.onChange?.(next);
        }}
      />
      <output data-testid="chosen">{keys.join("|")}</output>
    </div>
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: /Columns/ });
}

function open(): void {
  fireEvent.click(trigger());
}

function panel(): HTMLElement {
  return screen.getByTestId(
    SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID,
  );
}

function searchBox(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: "Search attributes",
  }) as HTMLInputElement;
}

function search(text: string): void {
  fireEvent.change(searchBox(), { target: { value: text } });
}

function offeredKeys(): Array<string> {
  return within(panel())
    .queryAllByRole("button", { name: /^Add / })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace(/^Add /, "");
    });
}

function chosen(): Array<string> {
  const text: string = screen.getByTestId("chosen").textContent || "";
  return text ? text.split("|") : [];
}

function lastCall(onChange: MockFunction): Array<string> {
  const calls: Array<Array<unknown>> = onChange.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as Array<string>;
}

afterEach(() => {
  cleanup();
});

describe("the toolbar button", () => {
  test("reads Columns, and opens a dialog", () => {
    renderPicker();

    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId(
        SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID,
      ),
    ).toBeNull();

    open();

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(panel()).toHaveAttribute("role", "dialog");
    expect(panel()).toHaveAccessibleName("Attribute columns");
  });

  test("counts the attributes on the rows, and shows no count when there are none", () => {
    renderPicker({ selectedKeys: [FIRST_NAME_KEY, CITY_KEY] });

    expect(trigger()).toHaveTextContent("Columns2");

    cleanup();
    renderPicker();

    expect(trigger()).toHaveTextContent(/^Columns$/);
  });

  test("a second click closes it", () => {
    renderPicker();

    open();
    open();

    expect(
      screen.queryByTestId(
        SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID,
      ),
    ).toBeNull();
  });
});

describe("what is shown on the rows", () => {
  test("with nothing chosen, says how to add one", () => {
    renderPicker();
    open();

    expect(panel()).toHaveTextContent("None yet");
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  test("lists each chosen key by its chip label, with the full key beneath", () => {
    renderPicker({ selectedKeys: [FIRST_NAME_KEY, CITY_KEY] });
    open();

    const list: HTMLElement = within(panel()).getByRole("list", {
      name: "Attributes shown on rows",
    });
    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("user.firstName");
    expect(items[0]).toHaveTextContent(FIRST_NAME_KEY);
    expect(items[1]).toHaveTextContent("personalAddress.city");
    expect(items[1]).toHaveTextContent(CITY_KEY);
  });

  test("Remove takes one off, and leaves the rest in order", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderPicker({
      selectedKeys: [FIRST_NAME_KEY, CITY_KEY, ADDRESS_KEY],
      onChange: onChange as unknown as (keys: Array<string>) => void,
    });
    open();

    fireEvent.click(screen.getByRole("button", { name: `Remove ${CITY_KEY}` }));

    expect(lastCall(onChange)).toEqual([FIRST_NAME_KEY, ADDRESS_KEY]);
  });

  test("Up and Down reorder, and cannot step off either end", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderPicker({
      selectedKeys: [FIRST_NAME_KEY, CITY_KEY, ADDRESS_KEY],
      onChange: onChange as unknown as (keys: Array<string>) => void,
    });
    open();

    expect(
      screen.getByRole("button", { name: `Move ${FIRST_NAME_KEY} up` }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `Move ${ADDRESS_KEY} down` }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: `Move ${CITY_KEY} up` }),
    );
    expect(lastCall(onChange)).toEqual([CITY_KEY, FIRST_NAME_KEY, ADDRESS_KEY]);

    fireEvent.click(
      screen.getByRole("button", { name: `Move ${CITY_KEY} down` }),
    );
    expect(lastCall(onChange)).toEqual([FIRST_NAME_KEY, ADDRESS_KEY, CITY_KEY]);
  });

  test("Clear all empties the list", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderPicker({
      selectedKeys: [FIRST_NAME_KEY, CITY_KEY],
      onChange: onChange as unknown as (keys: Array<string>) => void,
    });
    open();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(lastCall(onChange)).toEqual([]);
  });

  test("two chosen keys that end the same are labelled apart", () => {
    renderPicker({ selectedKeys: [FIRST_NAME_KEY, PRINCIPAL_FIRST_NAME_KEY] });
    open();

    expect(panel()).toHaveTextContent("target.user.firstName");
    expect(panel()).toHaveTextContent("principal.user.firstName");
  });
});

describe("finding an attribute to add", () => {
  test("offers every key the project has sent, and focuses the search", () => {
    renderPicker();
    open();

    expect(offeredKeys()).toEqual(KEYS);
    expect(searchBox()).toHaveFocus();
  });

  test("keys already on the rows are not offered again", () => {
    renderPicker({ selectedKeys: [FIRST_NAME_KEY] });
    open();

    expect(offeredKeys()).not.toContain(FIRST_NAME_KEY);
    expect(offeredKeys()).toHaveLength(KEYS.length - 1);
  });

  test("the search matches every word, in any order and any case", () => {
    renderPicker();
    open();

    search("FirstName target");

    expect(offeredKeys()).toEqual([FIRST_NAME_KEY]);

    search("personaladdress");

    expect(offeredKeys()).toEqual([CITY_KEY, ADDRESS_KEY]);
  });

  test("Add puts the key on the rows, after the ones already there", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderPicker({
      selectedKeys: [CITY_KEY],
      onChange: onChange as unknown as (keys: Array<string>) => void,
    });
    open();

    fireEvent.click(
      screen.getByRole("button", { name: `Add ${FIRST_NAME_KEY}` }),
    );

    expect(lastCall(onChange)).toEqual([CITY_KEY, FIRST_NAME_KEY]);
  });

  test("Enter adds the top match and clears the search for the next one", () => {
    render(<StatefulPicker />);
    open();

    search("personaladdress");
    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(chosen()).toEqual([CITY_KEY]);
    expect(searchBox().value).toBe("");
  });

  test("Enter with nothing typed and nothing to offer does nothing", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderPicker({
      attributeKeys: [],
      onChange: onChange as unknown as (keys: Array<string>) => void,
    });
    open();

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * The server's key list is sampled from recent events and capped, so an
   * attribute can exist without being offered. Its exact key still works.
   */
  test("an exact key that is not in the list can still be added", () => {
    const onChange: MockFunction = getJestMockFunction();
    const unlisted: string =
      "collectionElements.1.references.0.event.target.user.firstName";

    renderPicker({
      onChange: onChange as unknown as (keys: Array<string>) => void,
    });
    open();

    search(`  ${unlisted}  `);

    expect(panel()).toHaveTextContent("Add this exact key as a column.");

    fireEvent.click(screen.getByRole("button", { name: `Add ${unlisted}` }));

    expect(lastCall(onChange)).toEqual([unlisted]);
  });

  test("Enter never adds the typed text itself — an unlisted key takes its own Add click", () => {
    const unlisted: string = "network.dns.questions.0.name";

    render(<StatefulPicker />);
    open();

    search(unlisted);
    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(chosen()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: `Add ${unlisted}` }));

    expect(chosen()).toEqual([unlisted]);
  });

  test("a search phrase that matches nothing is not added by Enter", () => {
    render(<StatefulPicker />);
    open();

    search("target user firstname nope");
    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(chosen()).toEqual([]);
    expect(searchBox().value).toBe("target user firstname nope");
  });

  /*
   * "firstName" + Enter means "the first-name attribute", not a new key
   * called firstName that no event will ever carry.
   */
  test("a half-typed search is never offered up as a key of its own", () => {
    render(<StatefulPicker />);
    open();

    search("target.user.firstName");

    expect(panel()).not.toHaveTextContent("Add this exact key");
    expect(offeredKeys()).toEqual([FIRST_NAME_KEY]);

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(chosen()).toEqual([FIRST_NAME_KEY]);
  });

  test("typing a key that is listed offers it once, not twice", () => {
    renderPicker();
    open();

    search(FIRST_NAME_KEY);

    expect(offeredKeys()).toEqual([FIRST_NAME_KEY]);
    expect(panel()).not.toHaveTextContent("Add this exact key");
  });

  test("a key already on the rows is not offered as an exact key either", () => {
    renderPicker({ selectedKeys: [FIRST_NAME_KEY] });
    open();

    search(FIRST_NAME_KEY);

    expect(offeredKeys()).toEqual([]);
    expect(panel()).toHaveTextContent("No attribute matches that search.");
  });

  test("lists a slice of a long key list, and says it is a slice", () => {
    const manyKeys: Array<string> = Array.from(
      { length: 120 },
      (_value: unknown, index: number): string => {
        return `collectionElements.0.references.0.event.target.user.attribute.labels.${index}`;
      },
    );

    renderPicker({ attributeKeys: manyKeys });
    open();

    expect(offeredKeys()).toHaveLength(
      SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_RESULT_LIMIT,
    );
    expect(panel()).toHaveTextContent(
      `Showing ${SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_RESULT_LIMIT} of 120 matching attributes`,
    );

    search("labels.11");

    // labels.11 and labels.110 through labels.119.
    expect(offeredKeys()).toHaveLength(11);
    expect(panel()).not.toHaveTextContent("Showing");
  });

  test("says so while the key list is loading", () => {
    renderPicker({ attributeKeys: [], isLoading: true });
    open();

    expect(panel()).toHaveTextContent("Loading attributes...");
  });

  test("says so when no event has sent an attribute yet", () => {
    renderPicker({ attributeKeys: [] });
    open();

    expect(panel()).toHaveTextContent(
      "No attributes seen on recent events yet.",
    );
  });
});

describe("a whole round trip", () => {
  test("add, reorder and remove, and the page ends up holding the result", () => {
    render(<StatefulPicker />);
    open();

    fireEvent.click(
      screen.getByRole("button", { name: `Add ${FIRST_NAME_KEY}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: `Add ${CITY_KEY}` }));
    fireEvent.click(screen.getByRole("button", { name: `Add ${ADDRESS_KEY}` }));

    expect(chosen()).toEqual([FIRST_NAME_KEY, CITY_KEY, ADDRESS_KEY]);

    fireEvent.click(
      screen.getByRole("button", { name: `Move ${ADDRESS_KEY} up` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${FIRST_NAME_KEY}` }),
    );

    expect(chosen()).toEqual([ADDRESS_KEY, CITY_KEY]);
    expect(trigger()).toHaveTextContent("Columns2");
  });

  test("clicking inside the panel keeps it open", () => {
    render(<StatefulPicker />);
    open();

    fireEvent.click(
      screen.getByRole("button", { name: `Add ${FIRST_NAME_KEY}` }),
    );

    expect(panel()).toBeInTheDocument();
  });
});

describe("getting out of the way", () => {
  test("Escape closes it and hands focus back to the button", () => {
    render(<StatefulPicker />);
    open();

    fireEvent.keyDown(searchBox(), { key: "Escape" });

    expect(
      screen.queryByTestId(
        SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID,
      ),
    ).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  test("a click elsewhere on the page closes it", () => {
    render(<StatefulPicker />);
    open();

    fireEvent.mouseDown(
      screen.getByRole("button", { name: "Somewhere else on the page" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Somewhere else on the page" }),
    );

    expect(
      screen.queryByTestId(
        SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID,
      ),
    ).toBeNull();
  });
});
