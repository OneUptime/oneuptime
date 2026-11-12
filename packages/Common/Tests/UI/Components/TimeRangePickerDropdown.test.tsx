/** @timezone UTC */
import TimeRangePickerDropdown, {
  CUSTOM_RANGE_OPTION_LABEL,
  TIME_RANGE_LABEL_SEPARATOR,
  TIME_RANGE_PRESET_OPTIONS,
  getTimeRangeButtonLabel,
  renderTimeRangeDetail,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import Timezone from "../../../Types/Timezone";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PREFIX: string = "test-range-picker";
const DROPDOWN_WIDTH_IN_PX: number = 288;

interface Harness {
  emitted: Array<RangeStartAndEndDateTime>;
}

function renderPicker(value: RangeStartAndEndDateTime): Harness {
  const harness: Harness = { emitted: [] };

  render(
    <TimeRangePickerDropdown
      value={value}
      onChange={(next: RangeStartAndEndDateTime) => {
        harness.emitted.push(next);
      }}
      dataTestIdPrefix={PREFIX}
      dropdownWidthInPx={DROPDOWN_WIDTH_IN_PX}
    />,
  );

  return harness;
}

function openDropdown(): void {
  fireEvent.click(screen.getByTestId(`${PREFIX}-button`));
}

function openCustomModal(): void {
  openDropdown();
  fireEvent.click(screen.getByTestId(`${PREFIX}-custom-option`));
}

function getStartInput(): HTMLInputElement {
  return screen.getByTestId("custom-time-range-start") as HTMLInputElement;
}

function getEndInput(): HTMLInputElement {
  return screen.getByTestId("custom-time-range-end") as HTMLInputElement;
}

/*
 * jsdom normalises a `datetime-local` value to minute precision, so compare
 * the instant a field names rather than the string it reports.
 */
function getFieldDate(input: HTMLInputElement): Date {
  return OneUptimeDate.fromDateTimeLocalString(input.value);
}

function minutesBetweenFields(): number {
  return OneUptimeDate.getDifferenceInMinutes(
    getFieldDate(getStartInput()),
    getFieldDate(getEndInput()),
  );
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

/*
 * The custom windows here are in 2024, and a window that is not all in the
 * current year names its years on the button (issue #7124, see
 * TimeRangeButtonYear.test.tsx). These tests are about everything else the
 * label says, so "now" is pinned into 2024, where the label is the short one.
 */
beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date("2024-06-15T12:00:00.000Z"));
});

/*
 * The label writes times the way the machine running the browser writes them,
 * so a test that does not pin the preference reads "Mar 1, 10:00" on a European
 * laptop and "Mar 1, 10:00 AM" on a US one. Pinning it is what lets these
 * assert the digits rather than a regex loose enough to accept the time going
 * missing altogether.
 */
function pin(use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

const CUSTOM_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2024-03-01T10:00:00.000Z"),
    new Date("2024-03-02T13:30:00.000Z"),
  ),
};

describe("getTimeRangeButtonLabel", () => {
  test("uses the preset label for a preset range", () => {
    expect(getTimeRangeButtonLabel({ range: TimeRange.PAST_THIRTY_MINS })).toBe(
      "Past 30 Minutes",
    );
  });

  test("falls back to the raw range when there is no preset label", () => {
    expect(getTimeRangeButtonLabel({ range: TimeRange.CUSTOM })).toBe(
      TimeRange.CUSTOM,
    );
  });

  test("summarises a custom range as a start–end pair", () => {
    pin(false);

    expect(getTimeRangeButtonLabel(CUSTOM_RANGE)).toBe(
      "Mar 1, 10:00 – Mar 2, 13:30",
    );
  });

  /*
   * The bug these cover: the label was built by reading the digits off the
   * Date - `date.getHours().toString().padStart(2, "0")` - so it was always a
   * 24-hour clock in the browser process's own zone. A user whose computer is
   * set to AM/PM picked an afternoon window and got "Mar 1, 14:30" back, and a
   * user with a timezone set in User Settings got a label that disagreed with
   * the modal they had just picked the window in.
   */
  describe("clock format", () => {
    test("writes both ends with AM/PM on a 12-hour machine", () => {
      pin(true);

      expect(getTimeRangeButtonLabel(CUSTOM_RANGE)).toBe(
        "Mar 1, 10:00 AM – Mar 2, 1:30 PM",
      );
    });

    test("writes both ends on a 24-hour clock on a 24-hour machine", () => {
      pin(false);

      const label: string = getTimeRangeButtonLabel(CUSTOM_RANGE);

      expect(label).toBe("Mar 1, 10:00 – Mar 2, 13:30");
      expect(label).not.toMatch(/AM|PM/);
    });

    test("marks a morning start AM and an afternoon end PM", () => {
      pin(true);

      expect(
        getTimeRangeButtonLabel({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T09:15:00.000Z"),
            new Date("2024-03-01T17:45:00.000Z"),
          ),
        }),
      ).toBe("Mar 1, 9:15 AM – Mar 1, 5:45 PM");
    });

    test("writes a midnight-to-noon window as 12 AM to 12 PM", () => {
      pin(true);

      expect(
        getTimeRangeButtonLabel({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T00:00:00.000Z"),
            new Date("2024-03-01T12:00:00.000Z"),
          ),
        }),
      ).toBe("Mar 1, 12:00 AM – Mar 1, 12:00 PM");
    });

    test("keeps the en dash separator on both clocks", () => {
      pin(true);
      expect(getTimeRangeButtonLabel(CUSTOM_RANGE)).toContain(" – ");

      pin(false);
      expect(getTimeRangeButtonLabel(CUSTOM_RANGE)).toContain(" – ");
    });

    test("leaves preset labels untouched by the clock preference", () => {
      pin(true);
      const on12Hour: string = getTimeRangeButtonLabel({
        range: TimeRange.PAST_ONE_HOUR,
      });

      pin(false);
      const on24Hour: string = getTimeRangeButtonLabel({
        range: TimeRange.PAST_ONE_HOUR,
      });

      expect(on12Hour).toBe("Past 1 Hour");
      expect(on24Hour).toBe("Past 1 Hour");
    });
  });

  describe("timezone", () => {
    test("reads the window in the timezone configured in User Settings", () => {
      pin(true);
      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

      // 10:00 and 13:30 UTC are 15:30 and 19:00 at +05:30.
      expect(getTimeRangeButtonLabel(CUSTOM_RANGE)).toBe(
        "Mar 1, 3:30 PM – Mar 2, 7:00 PM",
      );
    });

    test("moves the date too when the configured zone crosses midnight", () => {
      pin(false);
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      expect(
        getTimeRangeButtonLabel({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T02:00:00.000Z"),
            new Date("2024-03-01T06:00:00.000Z"),
          ),
        }),
      ).toBe("Feb 29, 21:00 – Mar 1, 01:00");
    });

    test("relabels the same window when the configured zone changes", () => {
      pin(false);

      OneUptimeDate.setUserTimezone(Timezone.UTC);
      const inUtc: string = getTimeRangeButtonLabel(CUSTOM_RANGE);

      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
      const inKolkata: string = getTimeRangeButtonLabel(CUSTOM_RANGE);

      expect(inUtc).toBe("Mar 1, 10:00 – Mar 2, 13:30");
      expect(inKolkata).toBe("Mar 1, 15:30 – Mar 2, 19:00");
    });
  });
});

describe("TimeRangePickerDropdown", () => {
  describe("test ids", () => {
    test("namespaces every test id with the given prefix", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(screen.getByTestId(`${PREFIX}-button`)).toBeInTheDocument();

      openDropdown();

      expect(screen.getByTestId(`${PREFIX}-dropdown`)).toBeInTheDocument();
      expect(screen.getByTestId(`${PREFIX}-custom-option`)).toBeInTheDocument();
    });
  });

  describe("presets", () => {
    test("lists every preset plus the custom entry", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      const labels: Array<string> = Array.from(
        screen.getByTestId(`${PREFIX}-dropdown`).querySelectorAll("button"),
      ).map((button: HTMLButtonElement): string => {
        return (button.textContent || "").trim();
      });

      expect(labels).toEqual([
        ...TIME_RANGE_PRESET_OPTIONS.map(
          (option: { label: string }): string => {
            return option.label;
          },
        ),
        CUSTOM_RANGE_OPTION_LABEL,
      ]);
    });

    test("emits a preset without any absolute window attached", () => {
      const harness: Harness = renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.click(screen.getByText("Past 2 Days"));

      expect(harness.emitted).toEqual([{ range: TimeRange.PAST_TWO_DAYS }]);
    });

    test("closes the dropdown after picking a preset", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.click(screen.getByText("Past 2 Days"));

      expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
    });

    test("switching back to a preset from a custom range drops the window", () => {
      const harness: Harness = renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2024-03-01T10:00:00.000Z"),
          new Date("2024-03-01T13:00:00.000Z"),
        ),
      });
      openDropdown();

      fireEvent.click(screen.getByText("Past 1 Hour"));

      expect(harness.emitted).toEqual([{ range: TimeRange.PAST_ONE_HOUR }]);
    });
  });

  describe("custom range modal", () => {
    test("is not mounted until the custom entry is clicked", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      expect(screen.queryByTestId("custom-time-range-modal")).toBeNull();
    });

    test("opens on the custom entry and closes the dropdown behind it", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
      expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
    });

    test("seeds from the absolute bounds of the selected preset", () => {
      renderPicker({ range: TimeRange.PAST_THREE_HOURS });
      openCustomModal();

      expect(minutesBetweenFields()).toBe(180);
    });

    test("seeds from the active custom range when there is one", () => {
      const start: Date = new Date("2024-03-01T10:00:00.000Z");
      const end: Date = new Date("2024-03-01T13:00:00.000Z");

      renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      });
      openCustomModal();

      expect(getFieldDate(getStartInput()).getTime()).toBe(start.getTime());
      expect(getFieldDate(getEndInput()).getTime()).toBe(end.getTime());
    });

    test("falls back to the preset bounds when a custom range has no window", () => {
      renderPicker({ range: TimeRange.CUSTOM });
      openCustomModal();

      expect(getStartInput().value).not.toBe("");
      expect(getEndInput().value).not.toBe("");
    });

    test("emits a custom range when the modal is applied", () => {
      const harness: Harness = renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.change(getStartInput(), {
        target: { value: "2024-03-01T08:00:00" },
      });
      fireEvent.change(getEndInput(), {
        target: { value: "2024-03-01T09:30:00" },
      });
      fireEvent.click(screen.getByText("Apply"));

      expect(harness.emitted).toHaveLength(1);
      expect(harness.emitted[0]!.range).toBe(TimeRange.CUSTOM);
      expect(
        OneUptimeDate.toDateTimeLocalString(
          harness.emitted[0]!.startAndEndDate!.startValue,
        ),
      ).toBe("2024-03-01T08:00:00");
      expect(
        OneUptimeDate.toDateTimeLocalString(
          harness.emitted[0]!.startAndEndDate!.endValue,
        ),
      ).toBe("2024-03-01T09:30:00");
    });

    test("unmounts the modal once a range is applied", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.click(screen.getByText("Apply"));

      expect(screen.queryByTestId("custom-time-range-modal")).toBeNull();
    });

    test("emits nothing when the modal is cancelled", () => {
      const harness: Harness = renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.change(getStartInput(), {
        target: { value: "2024-03-01T08:00:00" },
      });
      fireEvent.click(screen.getByText("Cancel"));

      expect(harness.emitted).toHaveLength(0);
      expect(screen.queryByTestId("custom-time-range-modal")).toBeNull();
    });

    test("discards abandoned edits when reopened", () => {
      renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2024-03-01T10:00:00.000Z"),
          new Date("2024-03-01T13:00:00.000Z"),
        ),
      });

      openCustomModal();
      fireEvent.change(getStartInput(), {
        target: { value: "2024-03-01T01:00:00" },
      });
      fireEvent.click(screen.getByText("Cancel"));

      openCustomModal();

      expect(getFieldDate(getStartInput()).getTime()).toBe(
        new Date("2024-03-01T10:00:00.000Z").getTime(),
      );
    });

    test("re-seeds from the preset selected since it was last opened", () => {
      renderPicker({ range: TimeRange.PAST_THREE_HOURS });

      openCustomModal();
      expect(minutesBetweenFields()).toBe(180);
      fireEvent.click(screen.getByText("Cancel"));

      cleanup();
      renderPicker({ range: TimeRange.PAST_ONE_DAY });
      openCustomModal();

      expect(minutesBetweenFields()).toBe(1440);
    });
  });

  describe("click outside", () => {
    test("closes the dropdown on an outside mousedown", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
    });

    test("leaves the custom modal alone on an outside mousedown", () => {
      /*
       * The native date picker a `datetime-local` field opens renders outside
       * this component. While the editor lived in the dropdown, clicking a day
       * in that popup tore the whole panel down mid-edit.
       */
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.mouseDown(document.body);

      expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
    });
  });
});

/*
 * Ranges anchored on what the page is about (issue #5954: "Around the
 * start" of an incident), listed above the presets under a heading of
 * their own. A page that hands none sees the picker it always saw.
 */
describe("ranges anchored on the page", () => {
  const AROUND_START_WINDOW: InBetween<Date> = new InBetween<Date>(
    new Date("2026-11-05T05:14:00.000Z"),
    new Date("2026-11-05T06:14:00.000Z"),
  );

  interface MomentsHarness extends Harness {
    selected: Array<string>;
  }

  function renderWithMoments(input: {
    value: RangeStartAndEndDateTime;
    selectedId: string | null;
    presetOptions?: typeof TIME_RANGE_PRESET_OPTIONS | undefined;
  }): MomentsHarness {
    const harness: MomentsHarness = { emitted: [], selected: [] };

    render(
      <TimeRangePickerDropdown
        value={input.value}
        onChange={(next: RangeStartAndEndDateTime) => {
          harness.emitted.push(next);
        }}
        dataTestIdPrefix={PREFIX}
        dropdownWidthInPx={DROPDOWN_WIDTH_IN_PX}
        presetOptions={input.presetOptions}
        moments={{
          heading: "Around this incident",
          presetsHeading: "Relative to now",
          options: [
            {
              id: "around-start",
              label: "Around the start",
              detail: "Nov 5, 05:14 – Nov 5, 06:14",
            },
            { id: "hour-before", label: "The hour before it started" },
          ],
          selectedId: input.selectedId,
          onSelect: (id: string) => {
            harness.selected.push(id);
          },
        }}
      />,
    );

    return harness;
  }

  test("the selected one is named on the button, with the window it covers as the tooltip", () => {
    renderWithMoments({
      value: { range: TimeRange.CUSTOM, startAndEndDate: AROUND_START_WINDOW },
      selectedId: "around-start",
    });

    const button: HTMLElement = screen.getByTestId(`${PREFIX}-button`);

    expect(button).toHaveTextContent("Around the start");
    expect(button).toHaveAttribute("title", "Nov 5, 05:14 – Nov 5, 06:14");
  });

  test("they are listed first, each with what it covers, then the presets relative to now", () => {
    renderWithMoments({
      value: { range: TimeRange.CUSTOM, startAndEndDate: AROUND_START_WINDOW },
      selectedId: "around-start",
    });
    openDropdown();

    const text: string =
      screen.getByTestId(`${PREFIX}-dropdown`).textContent || "";

    expect(text.indexOf("Around this incident")).toBe(0);
    expect(text.indexOf("Around the start")).toBeLessThan(
      text.indexOf("Relative to now"),
    );
    expect(text).toContain("Nov 5, 05:14 – Nov 5, 06:14");
    expect(text.indexOf("Relative to now")).toBeLessThan(
      text.indexOf("Past 5 Minutes"),
    );
  });

  test("the selected one is marked, and no preset or Custom Range with it", () => {
    renderWithMoments({
      value: { range: TimeRange.CUSTOM, startAndEndDate: AROUND_START_WINDOW },
      selectedId: "around-start",
    });
    openDropdown();

    expect(screen.getByTestId(`${PREFIX}-moment-around-start`)).toHaveClass(
      "text-indigo-700",
    );
    expect(screen.getByTestId(`${PREFIX}-moment-hour-before`)).not.toHaveClass(
      "text-indigo-700",
    );
    expect(screen.getByTestId(`${PREFIX}-custom-option`)).not.toHaveClass(
      "text-indigo-700",
    );
  });

  test("picking one tells the page and closes the list, and changes no range itself", () => {
    const harness: MomentsHarness = renderWithMoments({
      value: { range: TimeRange.CUSTOM, startAndEndDate: AROUND_START_WINDOW },
      selectedId: "around-start",
    });
    openDropdown();

    fireEvent.click(screen.getByTestId(`${PREFIX}-moment-hour-before`));

    expect(harness.selected).toEqual(["hour-before"]);
    expect(harness.emitted).toEqual([]);
    expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
  });

  test("with none selected, a preset relative to now is marked and named as usual", () => {
    renderWithMoments({
      value: { range: TimeRange.PAST_ONE_DAY },
      selectedId: null,
    });

    expect(screen.getByTestId(`${PREFIX}-button`)).toHaveTextContent(
      "Past 1 Day",
    );

    openDropdown();

    expect(
      within(screen.getByTestId(`${PREFIX}-dropdown`)).getByText("Past 1 Day"),
    ).toHaveClass("text-indigo-700");
    expect(screen.getByTestId(`${PREFIX}-moment-around-start`)).not.toHaveClass(
      "text-indigo-700",
    );
  });

  test("with none selected, a custom window is named by its dates and Custom Range is marked", () => {
    renderWithMoments({
      value: { range: TimeRange.CUSTOM, startAndEndDate: AROUND_START_WINDOW },
      selectedId: null,
    });

    expect(screen.getByTestId(`${PREFIX}-button`)).toHaveTextContent(
      getTimeRangeButtonLabel({
        range: TimeRange.CUSTOM,
        startAndEndDate: AROUND_START_WINDOW,
      }),
    );

    openDropdown();

    expect(screen.getByTestId(`${PREFIX}-custom-option`)).toHaveClass(
      "text-indigo-700",
    );
  });

  test("only the presets the page offers are listed", () => {
    renderWithMoments({
      value: { range: TimeRange.PAST_ONE_HOUR },
      selectedId: null,
      presetOptions: TIME_RANGE_PRESET_OPTIONS.filter(
        (option: (typeof TIME_RANGE_PRESET_OPTIONS)[number]) => {
          return option.range === TimeRange.PAST_ONE_HOUR;
        },
      ),
    });
    openDropdown();

    const dropdown: HTMLElement = screen.getByTestId(`${PREFIX}-dropdown`);

    expect(within(dropdown).getByText("Past 1 Hour")).toBeVisible();
    expect(within(dropdown).queryByText("Past 5 Minutes")).toBeNull();
    expect(screen.getByTestId(`${PREFIX}-custom-option`)).toBeVisible();
  });

  test("an empty list of them is no list: the picker is the plain one", () => {
    render(
      <TimeRangePickerDropdown
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={() => {
          return undefined;
        }}
        dataTestIdPrefix={PREFIX}
        dropdownWidthInPx={DROPDOWN_WIDTH_IN_PX}
        moments={{
          heading: "Around this incident",
          presetsHeading: "Relative to now",
          options: [],
          selectedId: null,
          onSelect: () => {
            return undefined;
          },
        }}
      />,
    );
    openDropdown();

    const dropdown: HTMLElement = screen.getByTestId(`${PREFIX}-dropdown`);

    expect(within(dropdown).queryByText("Around this incident")).toBeNull();
    expect(within(dropdown).queryByText("Relative to now")).toBeNull();
    expect(within(dropdown).getByText("Past 1 Hour")).toHaveClass(
      "text-indigo-700",
    );
  });

  /*
   * The window under a moment's name is longer than the dropdown's line in
   * Russian, Arabic, Korean or Chinese, whose dates are longer than English
   * ones. Written as one run of text it broke wherever the line ran out, and
   * left a time ("05:44"), an "AM" ("ص") or part of one ("午05:44") alone
   * on the next line. It breaks between its two ends now, and nowhere else.
   */
  test("a window breaks between its two ends and nowhere else, and reads the same", () => {
    renderWithMoments({
      value: { range: TimeRange.CUSTOM, startAndEndDate: AROUND_START_WINDOW },
      selectedId: "around-start",
    });
    openDropdown();

    const detail: HTMLElement = screen.getByTestId(
      `${PREFIX}-moment-around-start`,
    ).lastElementChild as HTMLElement;
    const ends: Array<Element> = Array.from(detail.children);

    expect(detail.textContent).toBe("Nov 5, 05:14 – Nov 5, 06:14");
    expect(
      ends.map((end: Element): string | null => {
        return end.textContent;
      }),
    ).toEqual(["Nov 5, 05:14 –", "Nov 5, 06:14"]);

    for (const end of ends) {
      expect(end).toHaveClass("whitespace-nowrap");
    }
  });

  test("a window that is not two ends is written as it comes", () => {
    for (const detail of ["Since the start", "a – b – c"]) {
      render(<p data-testid="detail">{renderTimeRangeDetail(detail)}</p>);

      expect(screen.getByTestId("detail").textContent).toBe(detail);
      expect(screen.getByTestId("detail").children).toHaveLength(0);

      cleanup();
    }
  });
});

/*
 * A moment's window is a custom range's label (MetricInvestigationTimePicker
 * writes it with getTimeRangeButtonLabel), so it splits into its two ends in
 * every language the Dashboard is in: no language's date holds the dash that
 * stands between them.
 */
describe("a custom range's label splits into its two ends in every language", () => {
  const LAST_YEAR: RangeStartAndEndDateTime = {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date("2023-11-04T05:44:00.000Z"),
      new Date("2023-11-05T17:44:00.000Z"),
    ),
  };

  afterEach(() => {
    setDateDisplayLanguage(null);
    forgetRememberedDateTexts();
  });

  test.each(["en", ...DASHBOARD_LANGUAGES])("%s", (language: string) => {
    setDateDisplayLanguage(language);

    for (const use12HourFormat of [true, false]) {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(use12HourFormat);

      const label: string = getTimeRangeButtonLabel(LAST_YEAR);

      expect(label.split(TIME_RANGE_LABEL_SEPARATOR)).toHaveLength(2);

      render(<p data-testid="detail">{renderTimeRangeDetail(label)}</p>);

      expect(screen.getByTestId("detail").textContent).toBe(label);
      expect(screen.getByTestId("detail").children).toHaveLength(2);

      cleanup();
    }
  });
});
