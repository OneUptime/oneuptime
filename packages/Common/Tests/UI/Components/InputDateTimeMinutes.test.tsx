import Input, {
  InputType,
  getDateDisplayValue,
} from "../../../UI/Components/Input/Input";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * A DATE AND TIME FIELD SHOWS HOURS AND MINUTES (issue #7593).
 *
 * Add User Override's Starts read "13/11/2026 11:15:52" beside an Ends of
 * "11:17", and a layer's Rotation starts at "11/11/2026 08:00:17", with a
 * seconds column in the browser's picker: the shared Input wrote every
 * datetime-local value with its seconds, and the browser shows and asks for
 * what the value holds. Nobody schedules a shift to the second.
 *
 * Now the field's value is the wall clock to the minute, so the picker has
 * hours and minutes only, and a time picked comes back on the minute. A
 * field compared with telemetry timestamps opts in to seconds
 * (showSecondsForDateTime). Only what is shown loses the seconds: until the
 * person changes the field, Input hands nothing back, so a stored 08:00:17
 * left alone is saved as 08:00:17.
 *
 * The person's zone is User Settings > Timezone; Asia/Kolkata (+05:30)
 * makes a wrong zone or a dropped half hour show.
 */

const TEST_ID: string = "when";

// 11:15:52.345 in Kolkata.
const WITH_SECONDS: string = "2026-11-13T05:45:52.345Z";

/*
 * 11:15:52, as a field stepping by the second holds it. The value given is
 * "2026-11-13T11:15:52"; jsdom, like a browser, keeps it in a normalized
 * form that may add the milliseconds.
 */
const SHOWN_WITH_SECONDS: RegExp = /^2026-11-13T11:15:52(\.000)?$/;

function field(): HTMLInputElement {
  return screen.getByTestId<HTMLInputElement>(TEST_ID);
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
});

describe("what a date and time field shows", () => {
  test("a time with seconds, as a string: hours and minutes only", () => {
    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T11:15");
  });

  test("a time with seconds, as a Date: hours and minutes only", () => {
    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={new Date(WITH_SECONDS) as unknown as string}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T11:15");
  });

  test("as an initial value too", () => {
    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        initialValue={WITH_SECONDS}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T11:15");
  });

  test("asks for no seconds: it has no step, so the browser's picker steps by the minute", () => {
    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        dataTestId={TEST_ID}
      />,
    );

    expect(field()).not.toHaveAttribute("step");
    expect(field()).toHaveAttribute("type", "datetime-local");
  });

  test("is in the person's own zone: the same instant in New York reads 00:45", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T00:45");
  });

  test("a time that comes in later is shown to the minute as well", () => {
    const { rerender } = render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        dataTestId={TEST_ID}
      />,
    );

    rerender(
      <Input
        type={InputType.DATETIME_LOCAL}
        value="2026-11-11T02:30:17.000Z"
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-11T08:00");
  });

  test("the minute is cut, never rounded up: 11:15:59.999 is 11:15", () => {
    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value="2026-11-13T05:45:59.999Z"
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T11:15");
  });

  test("a date field is untouched by any of it", () => {
    render(
      <Input type={InputType.DATE} value={WITH_SECONDS} dataTestId={TEST_ID} />,
    );

    expect(field().value).toBe("2026-11-13");
    expect(field()).not.toHaveAttribute("step");
  });
});

describe("a field that opts in to seconds, as a telemetry range does", () => {
  test("shows the seconds, and steps by one so they can be picked", () => {
    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        showSecondsForDateTime={true}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toMatch(SHOWN_WITH_SECONDS);
    expect(field()).toHaveAttribute("step", "1");
  });

  test("turned on or off later, the field re-reads its value", () => {
    const { rerender } = render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T11:15");

    rerender(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        showSecondsForDateTime={true}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toMatch(SHOWN_WITH_SECONDS);

    rerender(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        showSecondsForDateTime={false}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-13T11:15");
    expect(field()).not.toHaveAttribute("step");
  });

  test("hands back the second picked", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        showSecondsForDateTime={true}
        onChange={onChange}
        dataTestId={TEST_ID}
      />,
    );

    fireEvent.change(field(), { target: { value: "2026-11-13T11:20:05" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-11-13T05:50:05.000Z");
  });
});

describe("what a date and time field hands back", () => {
  test("a time picked is on the minute, in the person's zone", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        onChange={onChange}
        dataTestId={TEST_ID}
      />,
    );

    // What the browser hands back once 11:15 is changed to 09:30.
    fireEvent.change(field(), { target: { value: "2026-11-13T09:30" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-11-13T04:00:00.000Z");
    expect(field().value).toBe("2026-11-13T09:30");
  });

  test("only the hour changed: the seconds it had are gone, not carried over", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value="2026-11-11T02:30:17.000Z"
        onChange={onChange}
        dataTestId={TEST_ID}
      />,
    );

    expect(field().value).toBe("2026-11-11T08:00");

    fireEvent.change(field(), { target: { value: "2026-11-11T09:00" } });

    expect(onChange).toHaveBeenCalledWith("2026-11-11T03:30:00.000Z");
  });

  test("left alone, it hands nothing back: a stored 08:00:17 is saved as it was", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { rerender } = render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value="2026-11-11T02:30:17.000Z"
        onChange={onChange}
        dataTestId={TEST_ID}
      />,
    );

    rerender(
      <Input
        type={InputType.DATETIME_LOCAL}
        value="2026-11-11T02:30:17.000Z"
        onChange={onChange}
        dataTestId={TEST_ID}
      />,
    );
    fireEvent.focus(field());
    fireEvent.blur(field());

    expect(onChange).not.toHaveBeenCalled();
  });

  test("in a form that holds its value, a field left alone keeps the stored seconds; one changed is on the minute", () => {
    const saved: Array<string> = [];

    const Form: () => ReactElement = (): ReactElement => {
      const [startsAt, setStartsAt] = useState<string>(
        "2026-11-11T02:30:17.000Z",
      );

      return (
        <>
          <Input
            type={InputType.DATETIME_LOCAL}
            value={startsAt}
            onChange={setStartsAt}
            dataTestId={TEST_ID}
          />
          <button
            onClick={() => {
              saved.push(startsAt);
            }}
          >
            Save
          </button>
        </>
      );
    };

    render(<Form />);

    fireEvent.click(screen.getByText("Save"));
    expect(saved).toEqual(["2026-11-11T02:30:17.000Z"]);

    fireEvent.change(field(), { target: { value: "2026-11-11T08:05" } });
    fireEvent.click(screen.getByText("Save"));

    expect(saved).toEqual([
      "2026-11-11T02:30:17.000Z",
      "2026-11-11T02:35:00.000Z",
    ]);
    expect(field().value).toBe("2026-11-11T08:05");
  });

  test("cleared, it hands back an empty value", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Input
        type={InputType.DATETIME_LOCAL}
        value={WITH_SECONDS}
        onChange={onChange}
        dataTestId={TEST_ID}
      />,
    );

    fireEvent.change(field(), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("the value a date field shows, worked out", () => {
  test.each([
    [InputType.DATETIME_LOCAL, false, "2026-11-13T11:15"],
    [InputType.DATETIME_LOCAL, undefined, "2026-11-13T11:15"],
    [InputType.DATETIME_LOCAL, true, "2026-11-13T11:15:52"],
    [InputType.DATE, false, "2026-11-13"],
    [InputType.DATE, true, "2026-11-13"],
  ])(
    "a %s field, seconds asked for: %s, shows %s",
    (type: InputType, seconds: boolean | undefined, shown: string) => {
      expect(getDateDisplayValue(WITH_SECONDS, type, seconds)).toBe(shown);
      expect(getDateDisplayValue(new Date(WITH_SECONDS), type, seconds)).toBe(
        shown,
      );
    },
  );

  test("nothing shows nothing", () => {
    expect(getDateDisplayValue("", InputType.DATETIME_LOCAL)).toBe("");
  });

  test("a range or something that is not a time is left to the field", () => {
    expect(
      getDateDisplayValue("2026-11-13 - 2026-11-14", InputType.DATETIME_LOCAL),
    ).toBeUndefined();
    expect(
      getDateDisplayValue(12 as unknown as string, InputType.DATETIME_LOCAL),
    ).toBeUndefined();
  });
});
