import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import type {
  DropdownOption,
  DropdownOptionGroup,
} from "../../../UI/Components/Dropdown/Dropdown";
import type Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import type FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  WHEN_TO_PAGE_DESCRIPTIONS,
  WHEN_TO_PAGE_TITLE,
  WHEN_TO_PAGE_TITLES,
  WORKING_HOURS_DESCRIPTION,
  WORKING_HOURS_TIMEZONE_DESCRIPTION,
  WORKING_HOURS_TIMEZONE_NOTE,
  getOnCallRuleActionFields,
  getWorkingHoursFoldedValue,
  getWorkingHoursProblem,
  isWorkingHoursRule,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/EventRuleForm";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import WorkingHoursPicker from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker";
import WorkingHoursSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursSummary";
import moment from "moment-timezone";

/*
 * WHEN AN ON-CALL RULE PAGES, ON ITS FORM.
 *
 * Under More fields, with the description: "When should this rule page?" -
 * Right away, as rules always have, or Only during working hours. Picking
 * working hours fills in Monday to Friday, 09:00 to 17:00, in the reader's
 * own time zone, and shows both to change: the days and two times, then the
 * zone. Under the choice, one sentence says what will happen. A rule that
 * pages right away adds nothing to the folded More fields line; one that
 * waits shows its hours there. Changing the zone keeps the hours on the
 * clock. Hours that never open cannot be saved.
 */

type Values = Record<string, unknown>;

const LONDON: string = "Europe/London";
const NEW_YORK: string = "America/New_York";

function fields(): Array<Field<Values>> {
  return getOnCallRuleActionFields<Values>(OnCallRuleRecord.Alert);
}

function field(
  column: string,
  from: Array<Field<Values>> = fields(),
): Field<Values> {
  const found: Field<Values> | undefined = from.find(
    (candidate: Field<Values>): boolean => {
      return Object.keys(candidate.field || {})[0] === column;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

function asValues(values: Values): FormValues<Values> {
  return values as FormValues<Values>;
}

// What a field's onChange hands the form, if anything.
function changed(
  onChange: Field<Values>["onChange"],
  value: unknown,
  current: Values,
): Values | null {
  let next: Values | null = null;

  onChange!(value, asValues(current), (values: FormValues<Values>): void => {
    next = values as Values;
  });

  return next;
}

function windowsOnTheClock(
  hours: RestrictionTimes,
  timezone: string,
): Array<string> {
  return hours.weeklyRestrictionTimes.map(
    (window: WeeklyResctriction): string => {
      return `${moment.tz(window.startTime, timezone).format("ddd HH:mm")}-${moment
        .tz(window.endTime, timezone)
        .format("HH:mm")}`;
    },
  );
}

// The folded line's hours read on a 24-hour clock, whatever the machine prefers.
let clock: { mockRestore: () => void } | null = null;

beforeEach(() => {
  clock = jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  clock?.mockRestore();
});

// The text as it reads: the ranges' word joiners left out.
function plain(text: string | null | undefined): string | null | undefined {
  return typeof text === "string" ? text.replace(/\u2060/g, "") : text;
}

describe("the fields", () => {
  test("ask when to page, then the hours and the zone, all folded with the description", () => {
    const keys: Array<string> = fields().map((item: Field<Values>): string => {
      return Object.keys(item.field || {})[0] || "";
    });

    expect(keys.slice(keys.indexOf("description"))).toEqual([
      "description",
      "whenToPage",
      "aiHoldTimeInMinutes",
      "workingHours",
      "workingHoursTimezone",
    ]);

    // One build of the form: the fold is one section object, shared.
    const built: Array<Field<Values>> = fields();
    const description: Field<Values> = field("description", built);

    for (const column of [
      "whenToPage",
      "aiHoldTimeInMinutes",
      "workingHoursTimezone",
      "workingHours",
    ]) {
      expect(field(column, built).collapsibleSection).toBe(
        description.collapsibleSection,
      );
      expect(field(column, built).stepId).toBe("on-call");
    }
  });

  test("asks when the rule should page, in answers that each say what they mean - the third, for alert and incident rules, lets OneUptime AI try first", () => {
    const whenToPage: Field<Values> = field("whenToPage");

    expect(whenToPage.title).toBe("When should this rule page?");
    expect(WHEN_TO_PAGE_TITLE).toBe("When should this rule page?");
    expect(whenToPage.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(whenToPage.radioButtonOptions).toEqual([
      {
        title: "Right away",
        description: "Page as soon as this rule matches.",
        value: OnCallRuleWhenToPage.RightAway,
      },
      {
        title: "Only during working hours",
        description: "Outside working hours, wait and page when they begin.",
        value: OnCallRuleWhenToPage.WorkingHours,
      },
      {
        title: "After OneUptime AI tries",
        description:
          "OneUptime AI looks first and fixes what it may. If it hasn't resolved this in time, page as usual.",
        value: OnCallRuleWhenToPage.AfterOneUptimeAI,
      },
    ]);
    expect(WHEN_TO_PAGE_TITLES[OnCallRuleWhenToPage.RightAway]).toBe(
      "Right away",
    );
    expect(WHEN_TO_PAGE_DESCRIPTIONS[OnCallRuleWhenToPage.WorkingHours]).toBe(
      "Outside working hours, wait and page when they begin.",
    );
  });

  test("the zone and the hours are there - and asked for - only for working hours", () => {
    const workingHours: Values = {
      whenToPage: OnCallRuleWhenToPage.WorkingHours,
    };
    const rightAway: Values = { whenToPage: OnCallRuleWhenToPage.RightAway };

    for (const column of ["workingHoursTimezone", "workingHours"]) {
      const item: Field<Values> = field(column);
      const required: (values: FormValues<Values>) => boolean =
        item.required as (values: FormValues<Values>) => boolean;

      expect(item.showIf!(asValues(workingHours))).toBe(true);
      expect(item.showIf!(asValues(rightAway))).toBe(false);
      expect(item.showIf!(asValues({}))).toBe(false);
      expect(required(asValues(workingHours))).toBe(true);
      expect(required(asValues(rightAway))).toBe(false);
    }
  });

  test("the zone is picked from the zones OneUptime knows, and says what it is for", () => {
    const zone: Field<Values> = field("workingHoursTimezone");

    expect(zone.title).toBe("Timezone");
    expect(zone.description).toBe(WORKING_HOURS_TIMEZONE_DESCRIPTION);
    expect(zone.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(
      (zone.dropdownOptions || []).some(
        (option: DropdownOption | DropdownOptionGroup): boolean => {
          return "value" in option && option.value === LONDON;
        },
      ),
    ).toBe(true);
  });

  test("the hours are the days and two times, in the rule's zone", () => {
    const hours: Field<Values> = field("workingHours");

    expect(hours.title).toBe("Working Hours");
    expect(hours.description).toBe(WORKING_HOURS_DESCRIPTION);
    expect(hours.fieldType).toBe(FormFieldSchemaType.CustomComponent);

    const defaultHours: RestrictionTimes = WorkingHours.getDefaultHours({
      timezone: LONDON,
    });
    const element: {
      type: unknown;
      props: Record<string, unknown>;
    } = hours.getCustomElement!(
      asValues({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHoursTimezone: LONDON,
        workingHours: defaultHours,
      }),
      { error: "Pick at least one day." },
    ) as unknown as { type: unknown; props: Record<string, unknown> };

    expect(element.type).toBe(WorkingHoursPicker);
    expect(element.props["timezone"]).toBe(LONDON);
    expect(element.props["value"]).toBe(defaultHours);
    expect(element.props["error"]).toBe("Pick at least one day.");
    // Hours a schedule layer's editor shows still say which zone they are in.
    expect(WORKING_HOURS_TIMEZONE_NOTE).toBe(
      "These times are in {{timezone}}.",
    );
  });

  test("under the choice, one sentence says what will happen, naming the rule's records", () => {
    const values: Values = {
      whenToPage: OnCallRuleWhenToPage.WorkingHours,
      workingHoursTimezone: LONDON,
      workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
    };

    for (const record of [
      OnCallRuleRecord.Alert,
      OnCallRuleRecord.Incident,
      OnCallRuleRecord.AlertEpisode,
      OnCallRuleRecord.IncidentEpisode,
    ]) {
      const footer: { type: unknown; props: Record<string, unknown> } = field(
        "whenToPage",
        getOnCallRuleActionFields<Values>(record),
      ).getFooterElement!(asValues(values)) as unknown as {
        type: unknown;
        props: Record<string, unknown>;
      };

      expect(footer.type).toBe(WorkingHoursSummary);
      expect(footer.props["record"]).toBe(record);
      expect(footer.props["rule"]).toEqual(values);
    }
  });
});

describe("the folded More fields line", () => {
  test("a rule that pages right away adds nothing to it", () => {
    const rightAway: FormValues<Values> = asValues({
      whenToPage: OnCallRuleWhenToPage.RightAway,
    });

    for (const column of [
      "whenToPage",
      "workingHours",
      "workingHoursTimezone",
    ]) {
      expect(field(column).isListedWhileFolded!(rightAway)).toBe(false);
    }
  });

  test("a rule that waits names its hours there, once: Working Hours: Mon–Fri 09:00–17:00", () => {
    const waits: FormValues<Values> = asValues({
      whenToPage: OnCallRuleWhenToPage.WorkingHours,
      workingHoursTimezone: LONDON,
      workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
    });

    expect(field("whenToPage").isListedWhileFolded!(waits)).toBe(false);
    expect(field("workingHoursTimezone").isListedWhileFolded!(waits)).toBe(
      false,
    );
    expect(field("workingHours").isListedWhileFolded!(waits)).toBe(true);
    expect(plain(field("workingHours").getFoldedValue!(waits))).toBe(
      "Mon–Fri 09:00–17:00",
    );
  });

  test("hours not set yet read as the choice itself; a rule that pages right away, as nothing", () => {
    expect(
      getWorkingHoursFoldedValue({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
      }),
    ).toBe("Only during working hours");
    expect(
      getWorkingHoursFoldedValue({
        whenToPage: OnCallRuleWhenToPage.RightAway,
      }),
    ).toBeNull();
  });
});

describe("picking Only during working hours", () => {
  const onChange: Field<Values>["onChange"] = field("whenToPage").onChange;

  test("fills in Monday to Friday, 09:00 to 17:00, in the reader's own zone", () => {
    const next: Values | null = changed(
      onChange,
      OnCallRuleWhenToPage.WorkingHours,
      { name: "Page Platform on-call" },
    );
    const zone: string = OneUptimeDate.getCurrentTimezone().toString();

    expect(next).not.toBeNull();
    expect(next!["name"]).toBe("Page Platform on-call");
    expect(next!["workingHoursTimezone"]).toBe(zone);

    const hours: RestrictionTimes = next!["workingHours"] as RestrictionTimes;

    expect(hours.restictionType).toBe(RestrictionType.Weekly);
    expect(windowsOnTheClock(hours, zone)).toEqual([
      "Mon 09:00-17:00",
      "Tue 09:00-17:00",
      "Wed 09:00-17:00",
      "Thu 09:00-17:00",
      "Fri 09:00-17:00",
    ]);
  });

  test("keeps the hours and the zone a rule already has", () => {
    expect(
      changed(onChange, OnCallRuleWhenToPage.WorkingHours, {
        workingHoursTimezone: NEW_YORK,
        workingHours: WorkingHours.getDefaultHours({ timezone: NEW_YORK }),
      }),
    ).toBeNull();
  });

  test("keeps the zone a rule already has, filling in only the hours", () => {
    const next: Values | null = changed(
      onChange,
      OnCallRuleWhenToPage.WorkingHours,
      { workingHoursTimezone: NEW_YORK },
    );

    expect(next!["workingHoursTimezone"]).toBe(NEW_YORK);
    expect(
      windowsOnTheClock(next!["workingHours"] as RestrictionTimes, NEW_YORK)[0],
    ).toBe("Mon 09:00-17:00");
  });

  test("picking Right away changes nothing else", () => {
    expect(
      changed(onChange, OnCallRuleWhenToPage.RightAway, {
        workingHoursTimezone: NEW_YORK,
      }),
    ).toBeNull();
  });
});

describe("changing the zone", () => {
  const onChange: Field<Values>["onChange"] = field(
    "workingHoursTimezone",
  ).onChange;

  test("keeps the hours on the clock: 09:00 to 17:00 stays 09:00 to 17:00", () => {
    const next: Values | null = changed(onChange, NEW_YORK, {
      whenToPage: OnCallRuleWhenToPage.WorkingHours,
      workingHoursTimezone: LONDON,
      workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
    });

    expect(
      windowsOnTheClock(next!["workingHours"] as RestrictionTimes, NEW_YORK),
    ).toEqual([
      "Mon 09:00-17:00",
      "Tue 09:00-17:00",
      "Wed 09:00-17:00",
      "Thu 09:00-17:00",
      "Fri 09:00-17:00",
    ]);
  });

  test("to the zone it is in, or from none, moves nothing", () => {
    expect(
      changed(onChange, LONDON, {
        workingHoursTimezone: LONDON,
        workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
      }),
    ).toBeNull();
    expect(
      changed(onChange, LONDON, {
        workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
      }),
    ).toBeNull();
  });
});

describe("hours that cannot be saved", () => {
  test("a rule that pages right away has none", () => {
    expect(getWorkingHoursProblem({ whenToPage: "Right Away" })).toBeNull();
    expect(isWorkingHoursRule({ whenToPage: "Right Away" })).toBe(false);
  });

  test("no day picked, or an end at the start, are refused in the picker's words", () => {
    const refuse: (data: {
      days: Array<number>;
      from: string;
      to: string;
    }) => string | null = (data: {
      days: Array<number>;
      from: string;
      to: string;
    }): string | null => {
      return getWorkingHoursProblem({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHoursTimezone: LONDON,
        workingHours: WorkingHours.fromSimpleHours({
          ...data,
          timezone: LONDON,
        }),
      });
    };

    expect(refuse({ days: [], from: "09:00", to: "17:00" })).toBe(
      "Pick at least one day.",
    );
    expect(refuse({ days: [0, 1], from: "09:00", to: "09:00" })).toBe(
      "Working hours must end at a different time than they start.",
    );
    expect(refuse({ days: [0, 1], from: "22:00", to: "06:00" })).toBeNull();
  });

  test("working hours with none set, or no zone, are refused in the reader's words", () => {
    expect(
      getWorkingHoursProblem({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHoursTimezone: LONDON,
      }),
    ).toBe("Set the working hours to page in.");
    expect(
      getWorkingHoursProblem({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
      }),
    ).toBe("Choose the time zone the working hours are in.");
  });

  test("the form refuses them through the field itself", () => {
    expect(
      field("workingHours").customValidation!(
        asValues({
          whenToPage: OnCallRuleWhenToPage.WorkingHours,
          workingHoursTimezone: LONDON,
        }),
      ),
    ).toBe("Set the working hours to page in.");
  });

  test("hours that open, in a zone OneUptime knows, are saved", () => {
    expect(
      getWorkingHoursProblem({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHoursTimezone: LONDON,
        workingHours: WorkingHours.getDefaultHours({ timezone: LONDON }),
      }),
    ).toBeNull();
  });
});
