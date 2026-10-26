import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Color from "../../../../Types/Color";
import { getPillColors } from "../../../../UI/Components/Pill/PillColors";
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

// A coloured badge is a tint of its colour; its dot is the colour itself.
const badgeColor: (badge: HTMLElement) => string = (
  badge: HTMLElement,
): string => {
  return requireElement(badge.querySelector<HTMLElement>("[data-ou-pill-dot]"))
    .style.backgroundColor;
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
    expect(badgeColor(requireElement(badge))).toEqual("rgb(239, 68, 68)");
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
    expect(badgeColor(requireElement(badges[0]))).toEqual("rgb(34, 197, 94)");
    expect(requireElement(badges[1]).textContent).toContain("High");
    expect(badgeColor(requireElement(badges[1]))).toEqual("rgb(239, 68, 68)");
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
    // Uncoloured: the product's indigo, painted as a Pill paints a colour.
    expect(requireElement(badges[1])).toHaveStyle({
      color: getPillColors("#6366f1").light.textColor,
    });
    expect(
      requireElement(badges[1]).getAttribute("data-dropdown-value-color"),
    ).toBeNull();
  });

  /*
   * A value the options no longer offer is still the record's value, as it
   * already was for a multi-select: shown as itself, uncoloured. It used to
   * read as the field's placeholder - "No selection" - which said the value
   * was not set when it was.
   */
  test("shows a single-select value the options no longer offer as itself", () => {
    const container: HTMLElement = renderDetail("Legacy", FieldType.Dropdown);
    const badge: HTMLElement | null = container.querySelector<HTMLElement>(
      '[data-dropdown-value-badge="true"]',
    );

    expect(requireElement(badge).textContent).toContain("Legacy");
    expect(requireElement(badge)).toHaveStyle({
      color: getPillColors("#6366f1").light.textColor,
    });
    expect(container.textContent).not.toContain("No selection");
  });

  test("shows the placeholder for an unset single-select value", () => {
    const container: HTMLElement = renderDetail("", FieldType.Dropdown);

    expect(container.textContent).toContain("No selection");
    expect(
      container.querySelector('[data-dropdown-value-badge="true"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="placeholder-text"]'),
    ).not.toBeNull();
  });

  test("shows the placeholder for an empty multi-select value", () => {
    const container: HTMLElement = renderDetail(
      [],
      FieldType.MultiSelectDropdown,
    );

    expect(
      container.querySelector('[data-testid="placeholder-text"]')?.textContent,
    ).toBe("No selection");
    expect(
      container.querySelector('[data-dropdown-value-badge="true"]'),
    ).toBeNull();
  });
});
