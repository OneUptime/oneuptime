import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import type { Mock } from "jest-mock";
import RangeStartAndEndDateView from "../../../UI/Components/Date/RangeStartAndEndDateView";
import RangeStartAndEndDateEdit, {
  DEFAULT_CHOICE_TEMPLATE,
  DEFAULT_TIME_RANGE_OPTION_TEST_ID,
} from "../../../UI/Components/Date/RangeStartAndEndDateEdit";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The time range picker's "Default (...)" choice (issue #5080): on a
 * dashboard, the quick ranges start with the dashboard's own range - the way
 * back from a range the viewer picked to the one it opens on. Everywhere
 * else the picker is drawn as it was, with no such choice.
 */

type OnChange = (range: RangeStartAndEndDateTime) => void;
type OnDefault = () => void;

const PINNED: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-20T08:00:00.000Z"),
    new Date("2026-10-20T09:00:00.000Z"),
  ),
};

afterEach(() => {
  cleanup();
});

function openPicker(label: string): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: label }));

  return screen.getByRole("radiogroup", { name: "Time range" });
}

function checkedChoices(rail: HTMLElement): Array<string> {
  return within(rail)
    .getAllByRole("radio")
    .filter((radio: HTMLElement) => {
      return radio.getAttribute("aria-checked") === "true";
    })
    .map((radio: HTMLElement) => {
      return (radio.textContent || "").trim();
    });
}

describe("the picker everywhere but a dashboard", () => {
  test("has no Default choice", () => {
    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={() => {}}
      />,
    );

    const rail: HTMLElement = openPicker("Past 1 Hour");

    expect(
      within(rail).queryByTestId(DEFAULT_TIME_RANGE_OPTION_TEST_ID),
    ).toBeNull();
    expect(checkedChoices(rail)).toEqual(["Past 1 Hour"]);
  });

  test("a default without a way back offers nothing: the two go together", () => {
    render(
      <RangeStartAndEndDateEdit
        value={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isDefaultSelected={true}
      />,
    );

    expect(screen.queryByTestId(DEFAULT_TIME_RANGE_OPTION_TEST_ID)).toBeNull();
  });
});

describe("on a dashboard", () => {
  test("the quick ranges start with the dashboard's own, named after it", () => {
    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={() => {}}
      />,
    );

    const rail: HTMLElement = openPicker("Past 1 Day");
    const radios: Array<HTMLElement> = within(rail).getAllByRole("radio");

    expect(DEFAULT_CHOICE_TEMPLATE).toBe("Default ({{value}})");
    expect(radios[0]).toHaveTextContent("Default (Past 1 Day)");
    expect(radios[0]).toBe(
      within(rail).getByTestId(DEFAULT_TIME_RANGE_OPTION_TEST_ID),
    );
    // The presets follow, then Custom: one more choice than before.
    expect(
      radios.map((radio: HTMLElement) => {
        return (radio.textContent || "").trim();
      }),
    ).toEqual([
      "Default (Past 1 Day)",
      "Past 5 Minutes",
      "Past 15 Minutes",
      "Past 30 Minutes",
      "Past 1 Hour",
      "Past 2 Hours",
      "Past 3 Hours",
      "Past 1 Day",
      "Past 2 Days",
      "Past 1 Week",
      "Past 2 Weeks",
      "Past 1 Month",
      "Past 3 Months",
      "Custom range",
    ]);
  });

  test("while the viewer is on the default, it is the choice ticked - not the preset it names", () => {
    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={() => {}}
      />,
    );

    const rail: HTMLElement = openPicker("Past 1 Day");

    expect(checkedChoices(rail)).toEqual(["Default (Past 1 Day)"]);
    // Its preview says what it is.
    expect(
      screen.getByText(
        "The time range this dashboard opens on, relative to now.",
      ),
    ).toBeInTheDocument();
  });

  test("while the viewer has a range of their own, that range is ticked", () => {
    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={false}
        onDefaultRangeSelect={() => {}}
      />,
    );

    expect(checkedChoices(openPicker("Past 1 Day"))).toEqual(["Past 1 Day"]);
  });

  test("while a custom range is shown, Custom range is ticked", () => {
    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={PINNED}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /GMT|UTC|2026/ }));

    expect(
      checkedChoices(screen.getByRole("radiogroup", { name: "Time range" })),
    ).toEqual(["Custom range"]);
  });

  test("picking Default goes back to it at once, and closes the picker", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    const onDefault: Mock<OnDefault> = jest.fn<OnDefault>();

    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_TWO_HOURS }}
        onChange={onChange}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={false}
        onDefaultRangeSelect={onDefault}
      />,
    );

    const rail: HTMLElement = openPicker("Past 2 Hours");

    fireEvent.click(within(rail).getByText("Default (Past 1 Day)"));

    expect(onDefault).toHaveBeenCalledTimes(1);
    // Not a pick of the range it names: that would be remembered as the viewer's own.
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("radiogroup", { name: "Time range" }),
    ).not.toBeInTheDocument();
  });

  test("Apply, while the picker is on the default, keeps the viewer on it", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    const onDefault: Mock<OnDefault> = jest.fn<OnDefault>();

    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={onChange}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={onDefault}
      />,
    );

    openPicker("Past 1 Day");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onDefault).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a preset is a pick of the viewer's own, applied at once", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    const onDefault: Mock<OnDefault> = jest.fn<OnDefault>();

    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={onChange}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={onDefault}
      />,
    );

    fireEvent.click(within(openPicker("Past 1 Day")).getByText("Past 1 Week"));

    expect(onChange).toHaveBeenCalledWith({ range: TimeRange.PAST_ONE_WEEK });
    expect(onDefault).not.toHaveBeenCalled();
  });

  test("a preset equal to the default is still the viewer's own pick", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={onChange}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={() => {}}
      />,
    );

    fireEvent.click(
      within(openPicker("Past 1 Day")).getAllByText("Past 1 Day")[0]!,
    );

    expect(onChange).toHaveBeenCalledWith({ range: TimeRange.PAST_ONE_DAY });
  });

  test("moving to Custom range in the picker leaves the default unticked", () => {
    render(
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_DAY }}
        onChange={() => {}}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={true}
        onDefaultRangeSelect={() => {}}
      />,
    );

    const rail: HTMLElement = openPicker("Past 1 Day");

    fireEvent.click(within(rail).getByText("Custom range"));

    expect(checkedChoices(rail)).toEqual(["Custom range"]);
  });
});

describe("the view, as a dashboard drives it", () => {
  // A dashboard's shell: the viewer's range, and the dashboard's default.
  const Shell: FunctionComponent = (): ReactElement => {
    const [range, setRange] = useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_TWO_HOURS,
    });
    const [isOnDefault, setIsOnDefault] = useState<boolean>(false);

    return (
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={range}
        onChange={(next: RangeStartAndEndDateTime) => {
          setRange(next);
          setIsOnDefault(false);
        }}
        defaultRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultRange={isOnDefault}
        onDefaultRangeSelect={() => {
          setRange({ range: TimeRange.PAST_ONE_DAY });
          setIsOnDefault(true);
        }}
      />
    );
  };

  test("back to the default and away again, the button naming the range each time", () => {
    render(<Shell />);

    fireEvent.click(
      within(openPicker("Past 2 Hours")).getByText("Default (Past 1 Day)"),
    );

    expect(screen.getByRole("button", { name: "Past 1 Day" })).toBeVisible();
    expect(checkedChoices(openPicker("Past 1 Day"))).toEqual([
      "Default (Past 1 Day)",
    ]);

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Time range" })).getByText(
        "Past 3 Months",
      ),
    );

    expect(screen.getByRole("button", { name: "Past 3 Months" })).toBeVisible();
    expect(checkedChoices(openPicker("Past 3 Months"))).toEqual([
      "Past 3 Months",
    ]);
  });
});
