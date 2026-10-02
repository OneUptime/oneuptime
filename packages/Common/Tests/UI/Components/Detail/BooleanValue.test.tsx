import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import BooleanValue from "../../../../UI/Components/Detail/BooleanValue";
import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * BooleanValue: the green "Yes" or grey "No" pill a details view, and a
 * form's summary step, show for a yes/no value. It was lifted out of
 * Detail's FieldType.Boolean branch so that a summary element of its own -
 * the Declare Incident form's 'Notify Status Page Subscribers', which adds
 * who will be notified under it - can still say whether the box was ticked,
 * exactly as every other box on that step does. Detail must render booleans
 * exactly as it did before.
 */

// What Detail drew for a boolean before the pill was lifted out of it.
const YES_MARKUP: string =
  '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium"><span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>Yes</span>';
const NO_MARKUP: string =
  '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium"><span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>No</span>';

interface Item {
  isOn?: unknown;
}

function renderDetail(value: unknown): HTMLElement {
  const fields: Array<Field<Item>> = [
    {
      key: "isOn",
      title: "Is On",
      fieldType: FieldType.Boolean,
    },
  ];

  const { container } = render(
    <Detail<Item>
      item={{ isOn: value }}
      fields={fields}
      showDetailsInNumberOfColumns={1}
    />,
  );

  return container;
}

afterEach(() => {
  cleanup();
});

describe("BooleanValue", () => {
  test("true is a green Yes", () => {
    const { container } = render(<BooleanValue value={true} />);

    expect(container.innerHTML).toBe(YES_MARKUP);
    expect(container).toHaveTextContent(/^Yes$/);
  });

  test("false is a grey No", () => {
    const { container } = render(<BooleanValue value={false} />);

    expect(container.innerHTML).toBe(NO_MARKUP);
    expect(container).toHaveTextContent(/^No$/);
  });

  test("takes a test id, and has none without one", () => {
    const { getByTestId } = render(
      <BooleanValue value={true} dataTestId="notify-value" />,
    );

    expect(getByTestId("notify-value")).toHaveTextContent("Yes");

    cleanup();

    const { container } = render(<BooleanValue value={false} />);

    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});

describe("Detail draws its boolean fields with BooleanValue, as before", () => {
  test.each([
    ["true", true, YES_MARKUP],
    ["a truthy string", "yes", YES_MARKUP],
    ["false", false, NO_MARKUP],
    ["undefined", undefined, NO_MARKUP],
    ["null", null, NO_MARKUP],
  ])("%s", (_label: string, value: unknown, markup: string) => {
    const container: HTMLElement = renderDetail(value);

    expect(container.innerHTML).toContain(markup);
    expect(container.querySelectorAll(".rounded-full.text-sm")).toHaveLength(1);
  });
});
