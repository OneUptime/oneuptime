import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement, useState } from "react";
import { initReactI18next } from "react-i18next";
import type { Mock } from "jest-mock";
import OneUptimeDate from "../../../Types/Date";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours, {
  SimpleWorkingHours,
} from "../../../Types/OnCallDutyPolicy/WorkingHours";
import WorkingHoursPicker, {
  WORKING_HOURS_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker";
import WorkingHoursSummary, {
  OnCallRuleNameCell,
  WORKING_HOURS_ROW_SUMMARY_TEST_ID,
  WORKING_HOURS_SUMMARY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursSummary";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";

/*
 * THE WORKING HOURS OF AN ON-CALL RULE, AS ITS FORM ASKS FOR THEM.
 *
 * The days - a button each, with Weekdays and Every day to pick the usual
 * sets at once - and a start and an end time. Every change hands the form
 * the hours as the rule keeps them, on its zone's clock. Hours that end
 * earlier than they begin end the next day, and say so. A day picked by
 * nobody, or an end at the start, is refused under what it is about. Hours
 * the picker cannot show - different on Fridays, kept through the API -
 * open in a schedule layer's editor instead of being changed by being shown.
 *
 * Under the choice, the sentence says what the rule does; under a rule's
 * name in the rules table, a few words say when it pages.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
};

const ZONE: string = "Europe/London";

// The text as it reads: the ranges' word joiners left out.
function plain(text: string | null | undefined): string {
  return (text || "").replace(/⁠/g, "");
}

function simple(
  value: RestrictionTimes | undefined,
): SimpleWorkingHours | null {
  return WorkingHours.toSimpleHours({ hours: value, timezone: ZONE });
}

type OnChange = Mock<(value: RestrictionTimes) => void>;

// The hours the picker handed on last.
function lastHours(onChange: OnChange): RestrictionTimes | undefined {
  const calls: Array<[value: RestrictionTimes]> = onChange.mock.calls;

  return calls[calls.length - 1]?.[0];
}

function day(index: number): HTMLElement {
  return screen.getByTestId(`${WORKING_HOURS_PICKER_TEST_ID}-day-${index}`);
}

function pressedDays(): Array<number> {
  return [0, 1, 2, 3, 4, 5, 6].filter((index: number): boolean => {
    return day(index).getAttribute("aria-pressed") === "true";
  });
}

// The picker as a form holds it: the value it hands back is shown again.
function Held(props: {
  initial?: RestrictionTimes | undefined;
  onChange: (value: RestrictionTimes) => void;
  error?: string | undefined;
}): ReactElement {
  const [value, setValue] = useState<RestrictionTimes | undefined>(
    props.initial,
  );

  return (
    <WorkingHoursPicker
      value={value}
      timezone={ZONE}
      error={props.error}
      onChange={(next: RestrictionTimes) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

let clock: { mockRestore: () => void } | null = null;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  clock = jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  clock?.mockRestore();
  cleanup();
});

describe("the picker", () => {
  test("a rule with no hours yet starts on Monday to Friday, 09:00 to 17:00", () => {
    const onChange: OnChange = jest.fn<(value: RestrictionTimes) => void>();
    render(<Held onChange={onChange} />);

    expect(pressedDays()).toEqual([0, 1, 2, 3, 4]);
    expect(screen.getByLabelText("Start Time")).toHaveValue("09:00");
    expect(screen.getByLabelText("End Time")).toHaveValue("17:00");
    // Showing the hours changes nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  test("shows the hours the rule has", () => {
    render(
      <Held
        initial={WorkingHours.fromSimpleHours({
          days: [1, 3],
          from: "08:00",
          to: "16:30",
          timezone: ZONE,
        })}
        onChange={jest.fn()}
      />,
    );

    expect(pressedDays()).toEqual([1, 3]);
    expect(screen.getByLabelText("Start Time")).toHaveValue("08:00");
    expect(screen.getByLabelText("End Time")).toHaveValue("16:30");
  });

  test("a day's button says the whole day to a screen reader, and picks and unpicks it", () => {
    const onChange: OnChange = jest.fn<(value: RestrictionTimes) => void>();
    render(<Held onChange={onChange} />);

    expect(day(5)).toHaveAccessibleName("Saturday");
    expect(day(5)).toHaveTextContent("Sat");

    fireEvent.click(day(5));
    expect(pressedDays()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(simple(lastHours(onChange))).toEqual({
      days: [0, 1, 2, 3, 4, 5],
      from: "09:00",
      to: "17:00",
    });

    fireEvent.click(day(0));
    expect(simple(lastHours(onChange))?.days).toEqual([1, 2, 3, 4, 5]);
  });

  test("Weekdays and Every day pick the usual sets at once", () => {
    const onChange: OnChange = jest.fn<(value: RestrictionTimes) => void>();
    render(<Held onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Every day" }));
    expect(pressedDays()).toEqual([0, 1, 2, 3, 4, 5, 6]);

    fireEvent.click(screen.getByRole("button", { name: "Weekdays" }));
    expect(pressedDays()).toEqual([0, 1, 2, 3, 4]);
    expect(simple(lastHours(onChange))?.days).toEqual([0, 1, 2, 3, 4]);
  });

  test("a new time hands the form the new hours; an end before the start ends the next day, and says so", () => {
    const onChange: OnChange = jest.fn<(value: RestrictionTimes) => void>();
    render(<Held onChange={onChange} />);

    expect(screen.queryByText("Ends the next day")).toBeNull();

    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "22:00" },
    });
    fireEvent.change(screen.getByLabelText("End Time"), {
      target: { value: "06:00" },
    });

    expect(simple(lastHours(onChange))).toEqual({
      days: [0, 1, 2, 3, 4],
      from: "22:00",
      to: "06:00",
    });
    expect(screen.getByText("Ends the next day")).toBeVisible();
  });

  test("a time left half typed changes nothing", () => {
    const onChange: OnChange = jest.fn<(value: RestrictionTimes) => void>();
    render(<Held onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "" },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  test("no day picked is said under the days; any other problem, under the times", () => {
    const view: ReturnType<typeof render> = render(
      <Held
        initial={WorkingHours.fromSimpleHours({
          days: [],
          from: "09:00",
          to: "17:00",
          timezone: ZONE,
        })}
        error="Pick at least one day."
        onChange={jest.fn()}
      />,
    );

    const days: HTMLElement = screen.getByRole("group");
    expect(within(days).getByText("Pick at least one day.")).toBeVisible();

    view.unmount();

    render(
      <Held
        initial={WorkingHours.fromSimpleHours({
          days: [0],
          from: "09:00",
          to: "09:00",
          timezone: ZONE,
        })}
        error="Working hours must end at a different time than they start."
        onChange={jest.fn()}
      />,
    );

    expect(
      within(screen.getByRole("group")).queryByTestId("error-message"),
    ).toBeNull();
    expect(
      screen.getByText(
        "Working hours must end at a different time than they start.",
      ),
    ).toBeVisible();
  });

  test("hours that are not the same every day open in a schedule layer's editor instead", () => {
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [0, 1, 2, 3],
      from: "09:00",
      to: "17:00",
      timezone: ZONE,
    });
    hours.weeklyRestrictionTimes = [
      ...hours.weeklyRestrictionTimes,
      ...WorkingHours.fromSimpleHours({
        days: [4],
        from: "09:00",
        to: "15:00",
        timezone: ZONE,
      }).weeklyRestrictionTimes,
    ];

    render(<Held initial={hours} onChange={jest.fn()} />);

    expect(screen.queryByTestId(WORKING_HOURS_PICKER_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("radio", { name: "Specific Times of the Week" }),
    ).toBeChecked();
  });

  test("in German, with the Dashboard's own words", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    render(<Held onChange={jest.fn()} />);

    expect(screen.getByText("Tage")).toBeVisible();
    expect(day(0)).toHaveTextContent("Mo");
    expect(day(0)).toHaveAccessibleName("Montag");
    expect(screen.getByRole("button", { name: "Wochentage" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Jeden Tag" })).toBeVisible();
    expect(screen.getByLabelText("Startzeit")).toHaveValue("09:00");
    expect(screen.getByLabelText("Endzeit")).toHaveValue("17:00");
  });
});

describe("the sentence under the choice", () => {
  const rule: {
    whenToPage: OnCallRuleWhenToPage;
    workingHours: RestrictionTimes;
    workingHoursTimezone: string;
  } = {
    whenToPage: OnCallRuleWhenToPage.WorkingHours,
    workingHours: WorkingHours.getDefaultHours({ timezone: ZONE }),
    workingHoursTimezone: ZONE,
  };

  test("says what the rule does with an alert outside its hours", () => {
    render(<WorkingHoursSummary rule={rule} record={OnCallRuleRecord.Alert} />);

    expect(
      plain(screen.getByTestId(WORKING_HOURS_SUMMARY_TEST_ID).textContent),
    ).toBe(
      "Alerts that match this rule outside Mon–Fri 09:00–17:00 (Europe/London) wait, and paging starts at 09:00.",
    );
  });

  test("a rule that pages right away shows none", () => {
    render(
      <WorkingHoursSummary
        rule={{ ...rule, whenToPage: OnCallRuleWhenToPage.RightAway }}
        record={OnCallRuleRecord.Alert}
      />,
    );

    expect(screen.queryByTestId(WORKING_HOURS_SUMMARY_TEST_ID)).toBeNull();
  });
});

describe("a rule's row in the rules table", () => {
  test("a rule that waits says when it pages under its name", () => {
    render(
      <OnCallRuleNameCell
        name="P3 and P4 alerts: Platform on-call"
        rule={{
          whenToPage: OnCallRuleWhenToPage.WorkingHours,
          workingHours: WorkingHours.getDefaultHours({ timezone: ZONE }),
          workingHoursTimezone: ZONE,
        }}
      />,
    );

    expect(
      screen.getByText("P3 and P4 alerts: Platform on-call"),
    ).toBeVisible();
    expect(
      plain(screen.getByTestId(WORKING_HOURS_ROW_SUMMARY_TEST_ID).textContent),
    ).toBe("Pages only Mon–Fri 09:00–17:00 (Europe/London)");
  });

  test("a rule that pages right away is its name, as it always was", () => {
    const view: ReturnType<typeof render> = render(
      <OnCallRuleNameCell
        name="P1 and P2 alerts: Platform on-call"
        rule={{ whenToPage: OnCallRuleWhenToPage.RightAway }}
      />,
    );

    expect(view.container).toHaveTextContent(
      /^P1 and P2 alerts: Platform on-call$/,
    );
    expect(screen.queryByTestId(WORKING_HOURS_ROW_SUMMARY_TEST_ID)).toBeNull();
  });

  test("each of the four rules tables reads when its rules page, and shows it under the name", () => {
    for (const page of [
      "Pages/Alerts/Settings/AlertOnCallRules.tsx",
      "Pages/Incidents/Settings/IncidentOnCallRules.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, page),
        "utf8",
      );

      // The rule table and the episode table.
      expect(source.match(/<OnCallRuleNameCell /g) || []).toHaveLength(2);
      expect(source.match(/workingHoursTimezone: true/g) || []).toHaveLength(2);
      expect(source.match(/whenToPage: true/g) || []).toHaveLength(2);
      expect(
        source.match(
          /getOnCallRuleActionFields<[A-Za-z]+>\(\s*OnCallRuleRecord\.[A-Za-z]+,?\s*\)/g,
        ) || [],
      ).toHaveLength(2);
    }
  });
});
