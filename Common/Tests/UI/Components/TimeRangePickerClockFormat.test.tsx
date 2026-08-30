/** @timezone UTC */
/**
 * The reported bug, exercised through the two pickers that actually sit above
 * the Metrics, Traces and Logs explorers: pick a custom window, and the button
 * summarising it must speak the clock and the timezone the person's computer is
 * set to.
 *
 * It did not. The label was assembled by reading the digits off the Date
 * (`date.getHours().toString().padStart(2, "0")`), which is a 24-hour clock in
 * the browser process's zone and nothing else - so a user on an AM/PM machine
 * picked 2:30 PM in the modal and got a button reading "Mar 1, 14:30", and a
 * user who had set a timezone in User Settings got a button disagreeing with
 * the modal they had just set the window in.
 *
 * These render the real components rather than calling the formatter, because
 * the formatter being right is worth nothing if the button stops reading from
 * it. The timezone is pinned to UTC by the docblock above and the 12/24-hour
 * preference is pinned per test, so the assertions hold on any machine.
 */
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import Timezone from "../../../Types/Timezone";
import LogTimeRangePicker, {
  LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX,
} from "../../../UI/Components/LogsViewer/components/LogTimeRangePicker";
import TelemetryTimeRangePicker, {
  TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An afternoon window, so a 12-hour clock has to do real work: 14:30 becoming
 * "2:30 PM" is the exact translation the bug was skipping.
 */
const AFTERNOON_WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2024-03-01T14:30:00.000Z"),
  new Date("2024-03-01T18:45:00.000Z"),
);

const CUSTOM_AFTERNOON: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: AFTERNOON_WINDOW,
};

interface Surface {
  name: string;
  prefix: string;
  render: (value: RangeStartAndEndDateTime) => void;
}

const SURFACES: Array<Surface> = [
  {
    name: "metrics and traces",
    prefix: TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX,
    render: (value: RangeStartAndEndDateTime): void => {
      render(
        <TelemetryTimeRangePicker
          value={value}
          onChange={() => {
            // The label under test does not depend on the change handler.
          }}
        />,
      );
    },
  },
  {
    name: "logs",
    prefix: LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX,
    render: (value: RangeStartAndEndDateTime): void => {
      render(
        <LogTimeRangePicker
          value={value}
          onChange={() => {
            // The label under test does not depend on the change handler.
          }}
        />,
      );
    },
  },
];

function pin(use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

function buttonText(prefix: string): string {
  return (screen.getByTestId(`${prefix}-button`).textContent || "").trim();
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe.each(SURFACES)(
  "the $name time range picker button",
  (surface: Surface) => {
    describe("on a machine set to a 12-hour clock", () => {
      test("writes the custom window with AM/PM", () => {
        pin(true);
        surface.render(CUSTOM_AFTERNOON);

        expect(buttonText(surface.prefix)).toBe(
          "Mar 1, 2:30 PM – Mar 1, 6:45 PM",
        );
      });

      test("never leaves a bare 24-hour reading on the button", () => {
        pin(true);
        surface.render(CUSTOM_AFTERNOON);

        const label: string = buttonText(surface.prefix);

        expect(label).toContain("PM");
        expect(label).not.toContain("14:30");
        expect(label).not.toContain("18:45");
      });

      test("marks a window that straddles noon AM then PM", () => {
        pin(true);
        surface.render({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T08:00:00.000Z"),
            new Date("2024-03-01T20:00:00.000Z"),
          ),
        });

        expect(buttonText(surface.prefix)).toBe(
          "Mar 1, 8:00 AM – Mar 1, 8:00 PM",
        );
      });

      test("writes a whole day from 12 AM to 11:59 PM", () => {
        pin(true);
        surface.render({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T00:00:00.000Z"),
            new Date("2024-03-01T23:59:00.000Z"),
          ),
        });

        expect(buttonText(surface.prefix)).toBe(
          "Mar 1, 12:00 AM – Mar 1, 11:59 PM",
        );
      });
    });

    describe("on a machine set to a 24-hour clock", () => {
      test("writes the custom window on a 24-hour clock", () => {
        pin(false);
        surface.render(CUSTOM_AFTERNOON);

        expect(buttonText(surface.prefix)).toBe("Mar 1, 14:30 – Mar 1, 18:45");
      });

      test("puts no day period on the button", () => {
        pin(false);
        surface.render(CUSTOM_AFTERNOON);

        expect(buttonText(surface.prefix)).not.toMatch(/AM|PM/);
      });

      test("pads a single-digit hour", () => {
        pin(false);
        surface.render({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T08:00:00.000Z"),
            new Date("2024-03-01T09:05:00.000Z"),
          ),
        });

        expect(buttonText(surface.prefix)).toBe("Mar 1, 08:00 – Mar 1, 09:05");
      });
    });

    describe("timezone", () => {
      test("reads the window in the timezone set in User Settings", () => {
        pin(true);
        OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
        surface.render(CUSTOM_AFTERNOON);

        // 14:30 and 18:45 UTC are 20:00 and 00:15 (next day) at +05:30.
        expect(buttonText(surface.prefix)).toBe(
          "Mar 1, 8:00 PM – Mar 2, 12:15 AM",
        );
      });

      test("rolls the date back when the configured zone is behind UTC", () => {
        pin(false);
        OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);
        surface.render({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2024-03-01T02:00:00.000Z"),
            new Date("2024-03-01T10:00:00.000Z"),
          ),
        });

        // 02:00 UTC is 18:00 the previous evening in Los Angeles (PST).
        expect(buttonText(surface.prefix)).toBe("Feb 29, 18:00 – Mar 1, 02:00");
      });

      test("agrees with the summary inside the modal that set the window", () => {
        /*
         * The two used to disagree outright: the modal summary already went
         * through the timezone- and clock-aware formatter while the button did
         * not, so the same window read two different ways on one screen.
         */
        pin(true);
        OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
        surface.render(CUSTOM_AFTERNOON);

        fireEvent.click(screen.getByTestId(`${surface.prefix}-button`));
        fireEvent.click(screen.getByTestId(`${surface.prefix}-custom-option`));

        const summary: string =
          screen.getByTestId("custom-time-range-summary").textContent || "";

        /*
         * The summary carries seconds and a year the compact button label
         * drops, so compare the parts they both claim: the wall clock.
         */
        expect(summary).toContain("8:00:00 PM");
        expect(summary).toContain("12:15:00 AM");
        expect(buttonText(surface.prefix)).toContain("8:00 PM");
        expect(buttonText(surface.prefix)).toContain("12:15 AM");
      });
    });

    describe("presets are unaffected", () => {
      test("shows the preset's own label on a 12-hour machine", () => {
        pin(true);
        surface.render({ range: TimeRange.PAST_ONE_HOUR });

        expect(buttonText(surface.prefix)).toBe("Past 1 Hour");
      });

      test("shows the preset's own label on a 24-hour machine", () => {
        pin(false);
        surface.render({ range: TimeRange.PAST_ONE_HOUR });

        expect(buttonText(surface.prefix)).toBe("Past 1 Hour");
      });

      test("shows no time at all for a preset", () => {
        pin(true);
        surface.render({ range: TimeRange.PAST_THIRTY_MINS });

        expect(buttonText(surface.prefix)).not.toMatch(/\d{1,2}:\d{2}/);
      });
    });
  },
);

describe("applying a window from the modal", () => {
  test("re-labels the button on the machine's clock once applied", () => {
    /*
     * End to end: open the picker, pick the custom editor, type a window,
     * apply, and read back what the button now says. This is the path the bug
     * report walks.
     */
    pin(true);

    const emitted: Array<RangeStartAndEndDateTime> = [];
    const prefix: string = TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX;

    const view: { rerender: (ui: React.ReactElement) => void } = render(
      <TelemetryTimeRangePicker
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={(next: RangeStartAndEndDateTime) => {
          emitted.push(next);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId(`${prefix}-button`));
    fireEvent.click(screen.getByTestId(`${prefix}-custom-option`));

    fireEvent.change(screen.getByTestId("custom-time-range-start"), {
      target: { value: "2024-03-01T14:30:00" },
    });
    fireEvent.change(screen.getByTestId("custom-time-range-end"), {
      target: { value: "2024-03-01T18:45:00" },
    });

    fireEvent.click(screen.getByText("Apply"));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.range).toBe(TimeRange.CUSTOM);

    // The parent re-renders the picker with the window it was handed.
    view.rerender(
      <TelemetryTimeRangePicker
        value={emitted[0] as RangeStartAndEndDateTime}
        onChange={() => {
          // Not exercised again.
        }}
      />,
    );

    expect(buttonText(prefix)).toBe("Mar 1, 2:30 PM – Mar 1, 6:45 PM");
  });

  test("re-labels the same applied window on a 24-hour machine", () => {
    pin(false);

    const emitted: Array<RangeStartAndEndDateTime> = [];
    const prefix: string = LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX;

    const view: { rerender: (ui: React.ReactElement) => void } = render(
      <LogTimeRangePicker
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={(next: RangeStartAndEndDateTime) => {
          emitted.push(next);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId(`${prefix}-button`));
    fireEvent.click(screen.getByTestId(`${prefix}-custom-option`));

    fireEvent.change(screen.getByTestId("custom-time-range-start"), {
      target: { value: "2024-03-01T14:30:00" },
    });
    fireEvent.change(screen.getByTestId("custom-time-range-end"), {
      target: { value: "2024-03-01T18:45:00" },
    });

    fireEvent.click(screen.getByText("Apply"));

    view.rerender(
      <LogTimeRangePicker
        value={emitted[0] as RangeStartAndEndDateTime}
        onChange={() => {
          // Not exercised again.
        }}
      />,
    );

    expect(buttonText(prefix)).toBe("Mar 1, 14:30 – Mar 1, 18:45");
  });
});

/*
 * The defect was not a wrong format string - it was a formatter hand-rolled out
 * of Date's own getters, which cannot see either the configured timezone or the
 * machine's clock preference. A rendering test cannot catch that coming back on
 * some future surface, so this reads the source and refuses the idiom outright.
 */
describe("the picker never hand-rolls a date format again", () => {
  const PICKER_SOURCE: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "UI",
      "Components",
      "Date",
      "TimeRangePickerDropdown.tsx",
    ),
    "utf-8",
  );

  test("reads no wall-clock field off the Date itself", () => {
    /*
     * getHours/getMinutes/getDate report the browser process's zone, never the
     * one the user configured, so none of them belongs in a rendered label.
     */
    for (const banned of [
      ".getHours()",
      ".getMinutes()",
      ".getDate()",
      ".getMonth()",
    ]) {
      expect(PICKER_SOURCE).not.toContain(banned);
    }
  });

  test("pins no locale of its own", () => {
    expect(PICKER_SOURCE).not.toContain('"en-US"');
    expect(PICKER_SOURCE).not.toContain("toLocaleString");
    expect(PICKER_SOURCE).not.toContain("toLocaleTimeString");
    expect(PICKER_SOURCE).not.toContain("toLocaleDateString");
  });

  test("hardcodes no hour cycle", () => {
    expect(PICKER_SOURCE).not.toContain("hour12");
  });

  test("goes through the shared timezone- and clock-aware formatter", () => {
    expect(PICKER_SOURCE).toContain(
      "OneUptimeDate.getDateAsLocalShortDateTimeString",
    );
  });
});
