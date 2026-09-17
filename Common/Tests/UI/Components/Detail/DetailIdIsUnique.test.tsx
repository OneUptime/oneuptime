import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import Detail, { DetailStyle } from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";

/*
 * The id names the detail, so exactly one element may carry it. It used to be
 * stamped on every row, which is invalid HTML and made `#id` ambiguous: an
 * anchor or getElementById reached only the first row, and a Playwright
 * locator resolved to one element per field and failed strict mode. That is
 * how the SLO settings E2E found it - "#slo-settings-objective resolved to 3
 * elements" - on a card whose only crime was having three fields.
 */

interface TestItem {
  targetPercentage: string;
  windowDays: string;
  burnRate: string;
}

const item: TestItem = {
  targetPercentage: "99.9%",
  windowDays: "Rolling 30-day window",
  burnRate: "2x",
};

const fields: Array<Field<TestItem>> = [
  { key: "targetPercentage", title: "Target" },
  { key: "windowDays", title: "Window" },
  { key: "burnRate", title: "Burn Rate" },
];

describe("Detail id", (): void => {
  afterEach((): void => {
    cleanup();
  });

  test("puts the id on one element, not on every field", (): void => {
    const { container } = render(
      <Detail<TestItem>
        id="slo-settings-objective"
        item={item}
        fields={fields}
      />,
    );

    expect(
      container.querySelectorAll('[id="slo-settings-objective"]'),
    ).toHaveLength(1);
  });

  test("still holds every field's value inside that one element", (): void => {
    const { container } = render(
      <Detail<TestItem>
        id="slo-settings-objective"
        item={item}
        fields={fields}
      />,
    );

    const detail: HTMLElement | null = container.querySelector<HTMLElement>(
      '[id="slo-settings-objective"]',
    );

    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent("99.9%");
    expect(detail).toHaveTextContent("Rolling 30-day window");
    expect(detail).toHaveTextContent("2x");
  });

  test("stays unique in the compact style too", (): void => {
    const { container } = render(
      <Detail<TestItem>
        id="slo-settings-objective"
        item={item}
        fields={fields}
        style={DetailStyle.Compact}
      />,
    );

    expect(
      container.querySelectorAll('[id="slo-settings-objective"]'),
    ).toHaveLength(1);
  });
});
