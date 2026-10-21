import { JSONObject } from "Common/Types/JSON";
import RestrictionTimes, {
  RestrictionType,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours, {
  DEFAULT_WORKDAY_END_HOUR,
  DEFAULT_WORKDAY_START_HOUR,
  SimpleWorkingHours,
} from "Common/Types/OnCallDutyPolicy/WorkingHours";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import RestrictionTimesFieldElement from "../OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import {
  WORKING_HOURS_DAY_NAMES,
  WORKING_HOURS_DAY_SHORT_NAMES,
  WORKING_HOURS_EVERY_DAY,
} from "./WorkingHoursText";

/*
 * THE WORKING HOURS OF AN ON-CALL RULE: THE DAYS, AND FROM WHEN UNTIL WHEN.
 *
 * What most people mean by working hours is the same hours on the days they
 * work, so that is what this asks: a row of day buttons - "Weekdays" and
 * "Every day" pick the usual sets at once - and a start and an end time.
 * Hours that end earlier than they begin end the next day, and say so under
 * the end. The
 * rule keeps them as a schedule layer's restriction times on its zone's
 * clock (WorkingHours.fromSimpleHours), which is what decides when it pages.
 *
 * Hours that are not the same on every day picked - kept through the API,
 * different on Fridays - open in a schedule layer's own editor, which says
 * any hours, rather than being changed by being shown here.
 */

export const WORKING_HOURS_DAYS_LABEL: string = translationKey("Days");
export const WORKING_HOURS_WEEKDAYS_SHORTCUT: string =
  translationKey("Weekdays");
/*
 * "Start Time" and "End Time" rather than "From" and "To": every language
 * the Dashboard speaks already says these two as times of day.
 */
export const WORKING_HOURS_START_LABEL: string = translationKey("Start Time");
export const WORKING_HOURS_END_LABEL: string = translationKey("End Time");
export const WORKING_HOURS_ENDS_NEXT_DAY: string =
  translationKey("Ends the next day");

// For the fallback editor: the line under the hours, and its Add button.
export const WORKING_HOURS_TIMEZONE_NOTE: string = translationKey(
  "These times are in {{timezone}}.",
);
export const ADD_WORKING_HOURS_TITLE: string =
  translationKey("Add Working Hours");

export const WORKING_HOURS_PICKER_TEST_ID: string = "working-hours-picker";

const WEEKDAYS: Array<number> = [0, 1, 2, 3, 4];
const EVERY_DAY: Array<number> = [0, 1, 2, 3, 4, 5, 6];

const pad: (value: number) => string = (value: number): string => {
  return value < 10 ? `0${value}` : `${value}`;
};

// What the picker starts on when the rule has no hours yet.
export const DEFAULT_SIMPLE_WORKING_HOURS: SimpleWorkingHours = {
  days: WEEKDAYS,
  from: `${pad(DEFAULT_WORKDAY_START_HOUR)}:00`,
  to: `${pad(DEFAULT_WORKDAY_END_HOUR)}:00`,
};

export interface ComponentProps {
  value?: RestrictionTimes | JSONObject | null | undefined;
  // The zone the hours are in: the rule's.
  timezone?: string | undefined;
  onChange?: ((value: RestrictionTimes) => void) | undefined;
  error?: string | undefined;
}

/*
 * The hours as the picker shows them: the same hours on the days picked
 * (WorkingHours.toSimpleHours), or what a rule with no hours yet starts on.
 * Hours the picker was left at that never open - no day picked, an end at
 * the start - are shown as they were left, to be put right. Null for hours
 * the picker cannot show: different hours on different days.
 */
export const readSimpleWorkingHours: (
  value: RestrictionTimes | JSONObject | null | undefined,
  timezone: string | undefined,
) => SimpleWorkingHours | null = (
  value: RestrictionTimes | JSONObject | null | undefined,
  timezone: string | undefined,
): SimpleWorkingHours | null => {
  // A zone not picked yet reads the hours on UTC's clock, to tell their shape.
  const zone: string = WorkingHours.isKnownTimezone(timezone)
    ? timezone!
    : "UTC";
  const parsed: SimpleWorkingHours | null = WorkingHours.toSimpleHours({
    hours: value,
    timezone: zone,
  });

  if (parsed) {
    return parsed;
  }

  const hours: RestrictionTimes | null = WorkingHours.toRestrictionTimes(value);

  if (!hours || hours.restictionType === RestrictionType.None) {
    return { ...DEFAULT_SIMPLE_WORKING_HOURS };
  }

  if (
    hours.restictionType !== RestrictionType.Weekly ||
    WorkingHours.getSpans({ hours: hours, timezone: zone }).length > 0
  ) {
    return null;
  }

  // Hours that never open: each window ends when it starts.
  const windows: Array<{ day: number; clock: string }> = [];

  for (const window of hours.weeklyRestrictionTimes || []) {
    const start: { day: number; clock: string } | null = WorkingHours.readClock(
      window.startTime,
      zone,
    );

    if (!start) {
      return null;
    }

    windows.push(start);
  }

  if (windows.length === 0) {
    return {
      days: [],
      from: DEFAULT_SIMPLE_WORKING_HOURS.from,
      to: DEFAULT_SIMPLE_WORKING_HOURS.to,
    };
  }

  const clocks: Set<string> = new Set<string>(
    windows.map((window: { clock: string }): string => {
      return window.clock;
    }),
  );

  if (clocks.size !== 1) {
    return null;
  }

  const clock: string = windows[0]!.clock;

  return {
    days: Array.from(
      new Set<number>(
        windows.map((window: { day: number }): number => {
          return window.day;
        }),
      ),
    ).sort((a: number, b: number): number => {
      return a - b;
    }),
    from: clock,
    to: clock,
  };
};

const isSameHours: (a: SimpleWorkingHours, b: SimpleWorkingHours) => boolean = (
  a: SimpleWorkingHours,
  b: SimpleWorkingHours,
): boolean => {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.days.length === b.days.length &&
    a.days.every((day: number, index: number): boolean => {
      return b.days[index] === day;
    })
  );
};

const WorkingHoursPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();

  const parsed: SimpleWorkingHours | null = WorkingHours.toSimpleHours({
    hours: props.value,
    timezone: props.timezone,
  });

  /*
   * Which editor the hours open in is settled when they are first shown:
   * hours that change while being edited - a day unticked, the end moved to
   * the start for a moment - stay in the picker.
   */
  const [shown] = useState<SimpleWorkingHours | null>(
    (): SimpleWorkingHours | null => {
      return readSimpleWorkingHours(props.value, props.timezone);
    },
  );
  const isSimple: boolean = shown !== null;

  const [draft, setDraft] = useState<SimpleWorkingHours>(
    shown || DEFAULT_SIMPLE_WORKING_HOURS,
  );

  // Hours changed from outside - another zone, the form reset - are shown.
  useEffect(() => {
    if (parsed && !isSameHours(parsed, draft)) {
      setDraft(parsed);
    }
  }, [parsed?.days.join(","), parsed?.from, parsed?.to]);

  if (!isSimple) {
    return (
      <RestrictionTimesFieldElement
        error={props.error}
        onChange={props.onChange}
        value={WorkingHours.toRestrictionTimes(props.value) || undefined}
        timezone={props.timezone}
        hidesNoRestrictions={true}
        timezoneNoteTemplate={WORKING_HOURS_TIMEZONE_NOTE}
        addWindowTitle={ADD_WORKING_HOURS_TITLE}
      />
    );
  }

  const change: (patch: Partial<SimpleWorkingHours>) => void = (
    patch: Partial<SimpleWorkingHours>,
  ): void => {
    const next: SimpleWorkingHours = { ...draft, ...patch };

    setDraft(next);
    props.onChange?.(
      WorkingHours.fromSimpleHours({ ...next, timezone: props.timezone }),
    );
  };

  const toggleDay: (day: number) => void = (day: number): void => {
    change({
      days: draft.days.includes(day)
        ? draft.days.filter((picked: number): boolean => {
            return picked !== day;
          })
        : [...draft.days, day].sort((a: number, b: number): number => {
            return a - b;
          }),
    });
  };

  // The error goes under what it is about: the days, or the two times.
  const isDaysProblem: boolean = draft.days.length === 0;
  const errorLine: ReactElement = (
    <p data-testid="error-message" className="mt-1.5 text-sm text-red-400">
      {props.error}
    </p>
  );

  const from: number | null = WorkingHours.parseClock(draft.from);
  const to: number | null = WorkingHours.parseClock(draft.to);
  const endsNextDay: boolean = from !== null && to !== null && to < from;

  const timeField: (data: {
    which: "from" | "to";
    label: string;
    note?: string | undefined;
  }) => ReactElement = (data: {
    which: "from" | "to";
    label: string;
    note?: string | undefined;
  }): ReactElement => {
    const inputId: string = `${id}-${data.which}`;

    return (
      <div className="min-w-0">
        <label
          htmlFor={inputId}
          className="mb-1 block text-xs font-medium text-gray-700"
        >
          {translator.translateText(data.label)}
        </label>
        <Input
          id={inputId}
          type={InputType.TIME}
          value={draft[data.which]}
          dataTestId={`${WORKING_HOURS_PICKER_TEST_ID}-${data.which}`}
          onChange={(value: string) => {
            if (WorkingHours.parseClock(value) === null) {
              return;
            }

            change({ [data.which]: value.trim().slice(0, 5) });
          }}
        />
        {data.note ? (
          <p
            className="mt-1 text-xs text-gray-500"
            data-testid={`${WORKING_HOURS_PICKER_TEST_ID}-next-day`}
          >
            {translator.translateText(data.note)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div
      className="max-w-md space-y-4"
      data-testid={WORKING_HOURS_PICKER_TEST_ID}
    >
      <div role="group" aria-labelledby={`${id}-days`}>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span
            id={`${id}-days`}
            className="block text-xs font-medium text-gray-700"
          >
            {translator.translateText(WORKING_HOURS_DAYS_LABEL)}
          </span>
          <span className="flex flex-wrap gap-x-3 text-xs">
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              data-testid={`${WORKING_HOURS_PICKER_TEST_ID}-weekdays`}
              onClick={() => {
                change({ days: [...WEEKDAYS] });
              }}
            >
              {translator.translateText(WORKING_HOURS_WEEKDAYS_SHORTCUT)}
            </button>
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              data-testid={`${WORKING_HOURS_PICKER_TEST_ID}-every-day`}
              onClick={() => {
                change({ days: [...EVERY_DAY] });
              }}
            >
              {translator.translateText(WORKING_HOURS_EVERY_DAY)}
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {EVERY_DAY.map((day: number) => {
            const isPicked: boolean = draft.days.includes(day);
            const dayName: string = translator.translateText(
              WORKING_HOURS_DAY_NAMES[day]!,
            )!;

            return (
              <button
                key={day}
                type="button"
                aria-pressed={isPicked}
                // The whole name, so a screen reader says "Monday", not "Mon".
                aria-label={dayName}
                title={dayName}
                data-testid={`${WORKING_HOURS_PICKER_TEST_ID}-day-${day}`}
                className={`min-w-0 truncate rounded-md border px-0.5 py-1.5 text-xs font-medium transition-colors ${
                  isPicked
                    ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                onClick={() => {
                  toggleDay(day);
                }}
              >
                {translator.translateText(WORKING_HOURS_DAY_SHORT_NAMES[day]!)}
              </button>
            );
          })}
        </div>
        {props.error && isDaysProblem ? errorLine : <></>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {timeField({ which: "from", label: WORKING_HOURS_START_LABEL })}
        {timeField({
          which: "to",
          label: WORKING_HOURS_END_LABEL,
          note: endsNextDay ? WORKING_HOURS_ENDS_NEXT_DAY : undefined,
        })}
      </div>
      {props.error && !isDaysProblem ? errorLine : <></>}
    </div>
  );
};

export default WorkingHoursPicker;
