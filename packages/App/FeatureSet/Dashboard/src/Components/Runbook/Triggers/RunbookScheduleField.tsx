import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  DEFAULT_RUNBOOK_SCHEDULE_CHOICE,
  RUNBOOK_SCHEDULE_DAY_ORDER,
  RUNBOOK_SCHEDULE_REPEATS,
  RUNBOOK_SCHEDULE_WEEKDAYS,
  RunbookScheduleChoice,
  RunbookScheduleRepeat,
  getRunbookScheduleCron,
} from "Common/Types/Runbook/RunbookSchedule";
import React, { FunctionComponent, ReactElement, useId } from "react";
import {
  CRON_HINT_EXAMPLE,
  DAY_NAMES,
  DAY_SHORT_NAMES,
  REPEAT_LABELS,
  RunbookTriggersCopy,
  RunbookTriggersTestIds,
  getEveryOptions,
  getMinuteOptions,
} from "./RunbookTriggersCopy";

/*
 * "When it runs", in the schedule dialog: a Repeat menu - every few
 * minutes, every few hours, every day, on days of the week, or a cron
 * expression - and the one or two things that choice needs, on the same
 * row. The dialog holds the choice (RunbookScheduleChoice) and saves the
 * cron it stands for (getRunbookScheduleCron), so switching Repeat back and
 * forth keeps what was picked.
 */

/*
 * What is wrong with the choice is said under it, live, by the dialog's
 * preview (RunbookSchedulePreview), so it is not said here as well.
 */
export interface ComponentProps {
  value: RunbookScheduleChoice;
  onChange: (choice: RunbookScheduleChoice) => void;
}

const pad: (value: number) => string = (value: number): string => {
  return value < 10 ? `0${value}` : `${value}`;
};

const TIME_VALUE: RegExp = /^(\d{1,2}):(\d{2})/;

/*
 * Input's own look, in a fixed-width font: a className given to Input
 * replaces its classes rather than adding to them.
 */
const CRON_INPUT_CLASS_NAME: string =
  "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 font-mono text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";

const RunbookScheduleField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();
  const choice: RunbookScheduleChoice = props.value;

  const change: (patch: Partial<RunbookScheduleChoice>) => void = (
    patch: Partial<RunbookScheduleChoice>,
  ): void => {
    const next: RunbookScheduleChoice = { ...choice, ...patch };

    // Every N minutes and every N hours step differently: start each at its own default.
    if (patch.repeat && patch.repeat !== choice.repeat) {
      if (patch.repeat === RunbookScheduleRepeat.Minutes) {
        next.every = DEFAULT_RUNBOOK_SCHEDULE_CHOICE.every;
      }

      if (patch.repeat === RunbookScheduleRepeat.Hours) {
        next.every = 1;
      }

      // A cron of your own starts from the schedule picked so far.
      if (patch.repeat === RunbookScheduleRepeat.Cron && !choice.cron) {
        next.cron = getRunbookScheduleCron(choice);
      }
    }

    props.onChange(next);
  };

  const label: (text: string, forId: string) => ReactElement = (
    text: string,
    forId: string,
  ): ReactElement => {
    return (
      <label
        htmlFor={forId}
        className="mb-1 block text-xs font-medium text-gray-700"
      >
        {translator.translateText(text)}
      </label>
    );
  };

  const repeatOptions: Array<DropdownOption> = RUNBOOK_SCHEDULE_REPEATS.map(
    (repeat: RunbookScheduleRepeat): DropdownOption => {
      return { value: repeat, label: REPEAT_LABELS[repeat] };
    },
  );

  const timeInput: ReactElement = (
    <div>
      {label(RunbookTriggersCopy.atLabel, `${id}-time`)}
      <Input
        id={`${id}-time`}
        type={InputType.TIME}
        value={`${pad(choice.hour)}:${pad(choice.minute)}`}
        dataTestId={`${RunbookTriggersTestIds.scheduleField}-time`}
        onChange={(value: string) => {
          const match: RegExpMatchArray | null = value.match(TIME_VALUE);

          if (!match) {
            return;
          }

          change({
            hour: Math.min(23, parseInt(match[1]!, 10)),
            minute: Math.min(59, parseInt(match[2]!, 10)),
          });
        }}
      />
    </div>
  );

  const getEverySelect: () => ReactElement = (): ReactElement => {
    const options: Array<DropdownOption> = getEveryOptions(
      translator,
      choice.repeat,
    ).map((option: { value: number; label: string }): DropdownOption => {
      return { value: option.value, label: option.label };
    });

    return (
      <div>
        {label(RunbookTriggersCopy.everyLabel, `${id}-every`)}
        <Dropdown
          id={`${id}-every`}
          ariaLabel={translator.translateText(RunbookTriggersCopy.everyLabel)}
          options={options}
          value={
            options.find((option: DropdownOption) => {
              return option.value === choice.every;
            }) || options[0]
          }
          isClearable={false}
          dataTestId={`${RunbookTriggersTestIds.scheduleField}-every`}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (typeof value === "number") {
              change({ every: value });
            }
          }}
        />
      </div>
    );
  };

  const getMinuteSelect: () => ReactElement = (): ReactElement => {
    const options: Array<DropdownOption> = getMinuteOptions(choice.minute).map(
      (minute: number): DropdownOption => {
        return { value: minute, label: `:${pad(minute)}` };
      },
    );

    return (
      <div>
        {label(RunbookTriggersCopy.atMinuteLabel, `${id}-minute`)}
        <Dropdown
          id={`${id}-minute`}
          ariaLabel={translator.translateText(
            RunbookTriggersCopy.atMinuteLabel,
          )}
          options={options}
          value={options.find((option: DropdownOption) => {
            return option.value === choice.minute;
          })}
          isClearable={false}
          dataTestId={`${RunbookTriggersTestIds.scheduleField}-minute`}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (typeof value === "number") {
              change({ minute: value });
            }
          }}
        />
      </div>
    );
  };

  const toggleDay: (day: number) => void = (day: number): void => {
    change({
      days: choice.days.includes(day)
        ? choice.days.filter((picked: number) => {
            return picked !== day;
          })
        : [...choice.days, day].sort((a: number, b: number) => {
            return a - b;
          }),
    });
  };

  const getDays: () => ReactElement = (): ReactElement => {
    return (
      <div role="group" aria-labelledby={`${id}-days`}>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
          <span
            id={`${id}-days`}
            className="block text-xs font-medium text-gray-700"
          >
            {translator.translateText(RunbookTriggersCopy.onDaysLabel)}
          </span>
          <span className="flex gap-3 text-xs">
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              data-testid={`${RunbookTriggersTestIds.scheduleField}-weekdays`}
              onClick={() => {
                change({ days: [...RUNBOOK_SCHEDULE_WEEKDAYS] });
              }}
            >
              {translator.translateText(RunbookTriggersCopy.weekdaysShortcut)}
            </button>
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              data-testid={`${RunbookTriggersTestIds.scheduleField}-every-day`}
              onClick={() => {
                change({ days: [0, 1, 2, 3, 4, 5, 6] });
              }}
            >
              {translator.translateText(RunbookTriggersCopy.everyDayShortcut)}
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {RUNBOOK_SCHEDULE_DAY_ORDER.map((day: number) => {
            const isPicked: boolean = choice.days.includes(day);

            return (
              <button
                key={day}
                type="button"
                aria-pressed={isPicked}
                // The whole name, so a screen reader says "Monday", not "Mon".
                aria-label={translator.translateText(DAY_NAMES[day]!)}
                title={translator.translateText(DAY_NAMES[day]!)}
                data-testid={`${RunbookTriggersTestIds.scheduleField}-day-${day}`}
                className={`rounded-md border px-0 py-1.5 text-xs font-medium transition-colors ${
                  isPicked
                    ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                onClick={() => {
                  toggleDay(day);
                }}
              >
                {translator.translateText(DAY_SHORT_NAMES[day]!)}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const getCron: () => ReactElement = (): ReactElement => {
    return (
      <div>
        {label(RunbookTriggersCopy.cronLabel, `${id}-cron`)}
        <Input
          id={`${id}-cron`}
          value={choice.cron}
          placeholder="0 9 * * 1-5"
          className={CRON_INPUT_CLASS_NAME}
          dataTestId={`${RunbookTriggersTestIds.scheduleField}-cron`}
          onChange={(value: string) => {
            change({ cron: value });
          }}
        />
        <p className="mt-1 text-xs text-gray-500">
          <TranslatedSentence
            template={RunbookTriggersCopy.cronHint}
            slots={{
              // One line: an expression broken after "0" reads as two.
              example: (
                <code className="whitespace-nowrap font-mono text-gray-700">
                  {CRON_HINT_EXAMPLE}
                </code>
              ),
            }}
          />
        </p>
      </div>
    );
  };

  /*
   * What the choice needs, beside Repeat on a two-column row: every few
   * hours wraps its minute past the hour onto a row of its own rather than
   * squeeze three menus into one. A cron expression gets the whole width,
   * under a Repeat menu that has the whole width too.
   */
  const getDetails: () => ReactElement = (): ReactElement => {
    switch (choice.repeat) {
      case RunbookScheduleRepeat.Minutes:
        return getEverySelect();
      case RunbookScheduleRepeat.Hours:
        return (
          <>
            {getEverySelect()}
            {getMinuteSelect()}
          </>
        );
      case RunbookScheduleRepeat.Daily:
      case RunbookScheduleRepeat.Weekly:
        return timeInput;
      case RunbookScheduleRepeat.Cron:
      default:
        return <></>;
    }
  };

  const isCron: boolean = choice.repeat === RunbookScheduleRepeat.Cron;

  return (
    <div
      className="space-y-3"
      data-testid={RunbookTriggersTestIds.scheduleField}
      data-repeat={choice.repeat}
    >
      <div
        className={`grid grid-cols-1 gap-3 ${isCron ? "" : "sm:grid-cols-2"}`}
      >
        <div>
          {label(RunbookTriggersCopy.repeatLabel, `${id}-repeat`)}
          <Dropdown
            id={`${id}-repeat`}
            ariaLabel={translator.translateText(
              RunbookTriggersCopy.repeatLabel,
            )}
            options={repeatOptions}
            value={repeatOptions.find((option: DropdownOption) => {
              return option.value === choice.repeat;
            })}
            isClearable={false}
            dataTestId={`${RunbookTriggersTestIds.scheduleField}-repeat`}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "string") {
                change({ repeat: value as RunbookScheduleRepeat });
              }
            }}
          />
        </div>
        {getDetails()}
      </div>
      {choice.repeat === RunbookScheduleRepeat.Weekly ? getDays() : <></>}
      {isCron ? getCron() : <></>}
    </div>
  );
};

export default RunbookScheduleField;
