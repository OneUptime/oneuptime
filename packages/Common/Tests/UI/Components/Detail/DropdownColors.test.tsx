import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Color from "../../../../Types/Color";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

interface DetailItem {
  selection: string | Array<string>;
}

const options: Array<DropdownOption> = [
  {
    label: "Low",
    value: "Low",
    color: new Color("#22c55e"),
  },
  {
    label: "High",
    value: "High",
    color: new Color("#ef4444"),
  },
];

const renderDetail: (
  value: string | Array<string>,
  fieldType: FieldType,
) => HTMLElement = (
  value: string | Array<string>,
  fieldType: FieldType,
): HTMLElement => {
  const fields: Array<Field<DetailItem>> = [
    {
      key: "selection",
      title: "Selection",
      fieldType,
      dropdownOptions: options,
      placeholder: "No selection",
    },
  ];
  const { container } = render(
    <Detail<DetailItem>
      item={{ selection: value }}
      fields={fields}
      showDetailsInNumberOfColumns={1}
    />,
  );

  return container;
};

const requireElement: (
  element: HTMLElement | null | undefined,
) => HTMLElement = (element: HTMLElement | null | undefined): HTMLElement => {
  if (!element) {
    throw new Error("Expected dropdown value badge to be rendered");
  }

  return element;
};

afterEach(() => {
  cleanup();
});

describe("Detail dropdown colors", () => {
  test("renders a single-select value with its option color", () => {
    const container: HTMLElement = renderDetail("High", FieldType.Dropdown);
    const badge: HTMLElement | null = container.querySelector(
      '[data-dropdown-value-badge="true"]',
    );

    expect(requireElement(badge).textContent).toContain("High");
    expect(requireElement(badge).style.backgroundColor).toEqual(
      "rgb(239, 68, 68)",
    );
  });

  test("renders each multi-select value with its own option color", () => {
    const container: HTMLElement = renderDetail(
      ["Low", "High"],
      FieldType.MultiSelectDropdown,
    );
    const badges: Array<HTMLElement> = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-dropdown-value-badge="true"]',
      ),
    );

    expect(badges).toHaveLength(2);
    expect(requireElement(badges[0]).textContent).toContain("Low");
    expect(requireElement(badges[0]).style.backgroundColor).toEqual(
      "rgb(34, 197, 94)",
    );
    expect(requireElement(badges[1]).textContent).toContain("High");
    expect(requireElement(badges[1]).style.backgroundColor).toEqual(
      "rgb(239, 68, 68)",
    );
  });

  test("uses the legacy uncolored badge for an unmatched multi-select value", () => {
    const container: HTMLElement = renderDetail(
      ["Low", "Legacy"],
      FieldType.MultiSelectDropdown,
    );
    const badges: Array<HTMLElement> = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-dropdown-value-badge="true"]',
      ),
    );

    expect(requireElement(badges[1]).textContent).toContain("Legacy");
    expect(requireElement(badges[1]).classList.contains("bg-indigo-50")).toBe(
      true,
    );
  });

  test("continues to show the placeholder for an unknown single-select value", () => {
    const container: HTMLElement = renderDetail("Legacy", FieldType.Dropdown);

    expect(container.textContent).toContain("No selection");
    expect(
      container.querySelector('[data-dropdown-value-badge="true"]'),
    ).toBeNull();
  });
});
