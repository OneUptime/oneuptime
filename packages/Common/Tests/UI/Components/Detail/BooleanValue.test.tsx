import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import BooleanValue, {
  BOOLEAN_NO_COLOR,
  BOOLEAN_YES_COLOR,
} from "../../../../UI/Components/Detail/BooleanValue";
import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import Pill, {
  PILL_CLASS_NAME,
  PILL_DOT_CLASS_NAME,
  PillSize,
} from "../../../../UI/Components/Pill/Pill";
import {
  getPillColors,
  PillColors,
} from "../../../../UI/Components/Pill/PillColors";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Color from "../../../../Types/Color";

/*
 * BooleanValue: the green "Yes" or grey "No" pill a details view, and a
 * form's summary step, show for a yes/no value. It was lifted out of
 * Detail's FieldType.Boolean branch so that a summary element of its own -
 * the Declare Incident form's 'Notify Status Page Subscribers', which adds
 * who will be notified under it - can still say whether the box was ticked,
 * exactly as every other box on that step does. Detail draws every boolean
 * with it, so the two never drift apart.
 *
 * It is the product's one pill: a card showing a yes/no beside labels and a
 * choice showed three pill styles (a 14px yes/no, 13px labels, a 12px
 * rounded-corner choice). Now it is Pill's shape, size and colour work,
 * green for Yes and grey for No, top to top on the value's 24px line.
 */

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

function pillOf(container: HTMLElement): HTMLElement {
  const pill: HTMLElement | null = container.querySelector<HTMLElement>(
    "[data-boolean-value]",
  );

  if (!pill) {
    throw new Error("No yes/no pill was drawn");
  }

  return pill;
}

function expectPainted(pill: HTMLElement, color: Color): void {
  const colors: PillColors = getPillColors(color);

  expect(pill).toHaveStyle({
    backgroundColor: colors.light.backgroundColor,
    color: colors.light.textColor,
  });
  expect(pill.style.boxShadow).toBe(
    `inset 0 0 0 1px ${colors.light.ringColor}`,
  );
  // The dark theme's colours ride along for Theme.css's [data-ou-pill] rule.
  expect(pill).toHaveAttribute("data-ou-pill");
  expect(pill.style.getPropertyValue("--ou-pill-dark-bg")).toBe(
    colors.dark.backgroundColor,
  );
  expect(pill.style.getPropertyValue("--ou-pill-dark-text")).toBe(
    colors.dark.textColor,
  );

  const dot: HTMLElement = pill.firstElementChild as HTMLElement;

  expect(dot).toHaveAttribute("aria-hidden", "true");
  expect(dot).toHaveAttribute("data-ou-pill-dot");
  expect(dot.getAttribute("class")).toBe(PILL_DOT_CLASS_NAME);
  expect(dot).toHaveStyle({ backgroundColor: colors.light.dotColor });
}

afterEach(() => {
  cleanup();
});

describe("BooleanValue", () => {
  test("true is a green Yes", () => {
    const { container } = render(<BooleanValue value={true} />);
    const pill: HTMLElement = pillOf(container);

    expect(pill).toHaveAttribute("data-boolean-value", "yes");
    expect(pill.getAttribute("class")).toBe(`${PILL_CLASS_NAME} align-top`);
    expect(pill.style.fontSize).toBe(PillSize.Normal);
    expectPainted(pill, BOOLEAN_YES_COLOR);
    expect(container).toHaveTextContent(/^Yes$/);
  });

  test("false is a grey No", () => {
    const { container } = render(<BooleanValue value={false} />);
    const pill: HTMLElement = pillOf(container);

    expect(pill).toHaveAttribute("data-boolean-value", "no");
    expect(pill.getAttribute("class")).toBe(`${PILL_CLASS_NAME} align-top`);
    expectPainted(pill, BOOLEAN_NO_COLOR);
    expect(container).toHaveTextContent(/^No$/);
  });

  test("is green and grey: the colours a state pill gets", () => {
    expect(BOOLEAN_YES_COLOR.toString().toLowerCase()).toBe("#22c55e");
    expect(BOOLEAN_NO_COLOR.toString().toLowerCase()).toBe("#6b7280");
  });

  test("is the same pill a label is: one shape, one size, one colour work", () => {
    render(
      <div>
        <span data-testid="label">
          <Pill text="Yes" color={BOOLEAN_YES_COLOR} />
        </span>
        <span data-testid="yes-no">
          <BooleanValue value={true} />
        </span>
      </div>,
    );

    const label: HTMLElement = screen
      .getByTestId("label")
      .querySelector<HTMLElement>("[data-testid='pill']")!;
    const yesNo: HTMLElement = pillOf(screen.getByTestId("yes-no"));

    const classesOf: (element: HTMLElement) => Array<string> = (
      element: HTMLElement,
    ): Array<string> => {
      return Array.from(element.classList)
        .filter((name: string) => {
          // align-top seats it on a detail value's line.
          return name !== "align-top";
        })
        .sort();
    };

    expect(classesOf(yesNo)).toEqual(classesOf(label));
    expect(yesNo.style.fontSize).toBe(label.style.fontSize);
    expect(yesNo.style.backgroundColor).toBe(label.style.backgroundColor);
    expect(yesNo.style.color).toBe(label.style.color);
    expect(yesNo.style.boxShadow).toBe(label.style.boxShadow);
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

describe("Detail draws its boolean fields with BooleanValue", () => {
  test.each([
    ["true", true, "yes"],
    ["a truthy string", "yes", "yes"],
    ["false", false, "no"],
    ["undefined", undefined, "no"],
    ["null", null, "no"],
  ])("%s", (_label: string, value: unknown, shown: string) => {
    const container: HTMLElement = renderDetail(value);

    expect(container.querySelectorAll("[data-boolean-value]")).toHaveLength(1);
    expect(pillOf(container)).toHaveAttribute("data-boolean-value", shown);
    expect(pillOf(container)).toHaveTextContent(shown === "yes" ? "Yes" : "No");
  });
});
