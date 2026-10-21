import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import RecurringFieldElement from "../../../UI/Components/Events/RecurringFieldElement";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The "every N units" field (a workspace summary's How Often, a status page
 * report's How often, an on-call rotation) never changes the value it starts
 * from.
 *
 * Its inputs change the interval they hold in place, and it held the very
 * object it was handed. A form's default - a workspace summary starts on
 * "every week", one object per table - then came back "every 3 weeks" the
 * next time the form opened, after one form had changed it and been closed.
 * It now starts from a copy.
 */

function everyWeek(): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Week;
  recurring.intervalCount = new PositiveNumber(1);
  return recurring;
}

afterEach(() => {
  cleanup();
});

describe("the recurring interval field", () => {
  test("shows the interval it starts from", () => {
    render(<RecurringFieldElement initialValue={everyWeek()} />);

    expect(screen.getByPlaceholderText("1")).toHaveValue(1);
    expect(screen.getByText("Week")).toBeInTheDocument();
  });

  test("leaves the value it was handed as it was, when its count changes", () => {
    const startValue: Recurring = everyWeek();
    const onChange: MockFunction = getJestMockFunction();

    render(
      <RecurringFieldElement
        initialValue={startValue}
        onChange={onChange as unknown as (value: Recurring) => void}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("1"), {
      target: { value: "3" },
    });

    const changed: Recurring = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as Recurring;

    expect(changed.intervalCount.toNumber()).toBe(3);
    expect(changed.intervalType).toBe(EventInterval.Week);
    expect(changed).not.toBe(startValue);
    // The default the next form opens with is still every week.
    expect(startValue.intervalCount.toNumber()).toBe(1);
  });

  test("a second field started from the same value starts on it, untouched by the first", () => {
    const startValue: Recurring = everyWeek();

    const { unmount } = render(
      <RecurringFieldElement initialValue={startValue} />,
    );

    fireEvent.change(screen.getByPlaceholderText("1"), {
      target: { value: "4" },
    });

    unmount();

    render(<RecurringFieldElement initialValue={startValue} />);

    expect(screen.getByPlaceholderText("1")).toHaveValue(1);
  });

  test("starts from an interval handed as JSON too", () => {
    render(
      <RecurringFieldElement
        initialValue={everyWeek().toJSON() as unknown as Recurring}
      />,
    );

    expect(screen.getByPlaceholderText("1")).toHaveValue(1);
    expect(screen.getByText("Week")).toBeInTheDocument();
  });

  test("starts empty without a value, as before", () => {
    render(<RecurringFieldElement />);

    expect(screen.getByPlaceholderText("1")).not.toHaveValue();
  });
});
