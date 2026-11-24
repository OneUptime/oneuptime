import { TIME_ZONE_NOTE_CLASS_NAME } from "./LayerDateTimeFieldElement";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import OneUptimeDate from "Common/Types/Date";
import DayOfWeek from "Common/Types/Day/DayOfWeek";
import IconProp from "Common/Types/Icon/IconProp";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import TimezoneAlias from "Common/Types/TimezoneAlias";
import Typeof from "Common/Types/Typeof";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
} from "Common/UI/Components/Dropdown/Dropdown";
import { writeStandAloneDayName } from "Common/Types/DateLanguage";
// removed InputType.TIME usage in favor of TimePicker
import TimePicker from "Common/UI/Components/TimePicker/Index";
import BasicRadioButtons from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * The days of the week as a weekly window's two day menus list them: each
 * name as the reader's language writes a day in a menu (#7660) - "Lunes"
 * in Spanish, "lundi" in French, "mandag" in Danish, as CLDR has it - drawn
 * as written, so the day picked reads as it is listed.
 */
export const getDayOfWeekMenuOptions: (
  translator: Translator,
) => Array<DropdownOption> = (
  translator: Translator,
): Array<DropdownOption> => {
  return DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek).map(
    (option: DropdownOption): DropdownOption => {
      return {
        ...option,
        label: writeStandAloneDayName({
          name: translator.translateText(option.label) || option.label,
          language: translator.language,
          context: "menu",
        }),
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );
};

export interface ComponentProps {
  error?: string | undefined;
  onChange?: ((value: RestrictionTimes) => void) | undefined;
  value?: RestrictionTimes | undefined;
  /*
   * The schedule's IANA timezone. Restriction wall-clock times are ENFORCED by
   * the engine in this zone, but the TimePicker captures/displays in the
   * viewer's own zone (their User Settings zone, else the browser's). Without
   * reconciling the two, an admin in a different zone silently configured the
   * wrong hours (audit F1). When set, times are entered, displayed and stored
   * as wall-clock in this zone; when omitted, the viewer's zone is used.
   */
  timezone?: string | undefined;
  /*
   * For hours that must hold a window - an on-call rule's working hours
   * (WorkingHours) - rather than a layer's limits: "No Restrictions" is not
   * offered, only times of the day or of the week.
   */
  hidesNoRestrictions?: boolean | undefined;
  /*
   * What the line under the times says of the zone they are in, with a
   * {{timezone}} placeholder: the schedule's, unless the caller says whose
   * (translationKey'd where it is written).
   */
  timezoneNoteTemplate?: string | undefined;
  // The button that adds a weekly window, when "Add Restriction Time" is not its name.
  addWindowTitle?: string | undefined;
  // The addWindowTitle is in the reader's words already, drawn as given (Button's isTitleTranslated).
  isAddWindowTitleTranslated?: boolean | undefined;
}

/*
 * Over each clock: the start and the end of a window, as a form names its
 * fields - quiet and in the reader's words. They were the detail cards'
 * tracked capitals with a dot after them ("FROM: •"), which shouted over a
 * time field.
 */
export const RESTRICTION_TIME_LABEL_CLASS_NAME: string =
  "mb-1 text-xs font-medium text-gray-500";

// One end of a weekly window: its day over its time, as wide as the time.
export const RESTRICTION_WINDOW_END_CLASS_NAME: string = "flex flex-col gap-2";

type CopyRestrictionTimesFunction = (
  value: RestrictionTimes,
) => RestrictionTimes;

/*
 * A copy of the restrictions that shares nothing with the value it was made
 * from, so editing it never changes the caller's object. RestrictionTimes.
 * fromJSON alone does not give that: it hands back an instance it is given,
 * and an instance built from JSON keeps the JSON's day / weekly objects.
 */
const copyRestrictionTimes: CopyRestrictionTimesFunction = (
  value: RestrictionTimes,
): RestrictionTimes => {
  const source: RestrictionTimes = RestrictionTimes.fromJSON(value);
  const copy: RestrictionTimes = new RestrictionTimes();

  copy.restictionType = source.restictionType;
  copy.dayRestrictionTimes = source.dayRestrictionTimes
    ? { ...source.dayRestrictionTimes }
    : null;
  copy.weeklyRestrictionTimes = (source.weeklyRestrictionTimes || []).map(
    (weeklyRestriction: WeeklyResctriction): WeeklyResctriction => {
      return { ...weeklyRestriction };
    },
  );

  return copy;
};

/*
 * The ids of the From: and To: labels over one window's controls, which
 * name them for a screen reader (#7722). Each clock is the shared
 * TimePicker, a group that otherwise falls back to "Time input", and each
 * weekly window's day picker had no name at all: with three weekly windows
 * a screen reader heard six clocks called "Time input" and nothing said
 * which began a window and which ended one. A weekly window's ids carry its
 * place, so two windows never share one.
 */
export const getRestrictionTimeLabelIds: (data: {
  baseId: string;
  // A weekly window's place in the list; left out for the daily window.
  windowIndex?: number | undefined;
}) => { from: string; to: string } = (data: {
  baseId: string;
  windowIndex?: number | undefined;
}): { from: string; to: string } => {
  const prefix: string =
    data.windowIndex === undefined
      ? `${data.baseId}-daily`
      : `${data.baseId}-window-${data.windowIndex}`;

  return { from: `${prefix}-from`, to: `${prefix}-to` };
};

const RestrictionTimesFieldElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelBaseId: string = `restriction-times-${useId()}`;
  const [restrictionTimes, setRestrictionTimes] = useState<
    RestrictionTimes | undefined
  >(props.value ? copyRestrictionTimes(props.value) : undefined);

  useEffect(() => {
    if (props.value) {
      setRestrictionTimes(copyRestrictionTimes(props.value));
    } else {
      setRestrictionTimes(undefined);
    }
  }, [props.value]);

  /*
   * Every edit starts from a copy of the current restrictions, so neither this
   * component's state nor the value the form holds is changed in place.
   */
  const getEditableRestrictionTimes: () => RestrictionTimes =
    (): RestrictionTimes => {
      return restrictionTimes
        ? copyRestrictionTimes(restrictionTimes)
        : new RestrictionTimes();
    };

  /*
   * Display a stored instant in the TimePicker as its wall-clock IN THE SCHEDULE
   * TIMEZONE. The picker reads hours and minutes in the current timezone
   * (OneUptimeDate.getLocalHours), so we hand it a Date whose current-timezone
   * wall clock is the schedule-zone wall-clock. That is why this uses the
   * current-timezone helpers, not the browser-local ones the schedule preview
   * grid needs. Inverse of timePickerValueToStoredDate.
   */
  const storedDateToTimePickerValue: (
    stored: Date | undefined,
  ) => string | undefined = (stored: Date | undefined): string | undefined => {
    if (!stored) {
      return OneUptimeDate.toString(stored as any);
    }
    const display: Date = props.timezone
      ? OneUptimeDate.getLocalDateFromWallClockInTimezone(
          stored,
          props.timezone,
        )
      : stored;
    return OneUptimeDate.toString(display);
  };

  /*
   * Convert a TimePicker onChange value (a wall clock in the current timezone,
   * see OneUptimeDate.getDateWithCustomTime) into the instant to STORE,
   * reinterpreting the entered wall-clock in the schedule timezone so it is
   * enforced exactly as typed (audit F1).
   */
  const timePickerValueToStoredDate: (value: any) => Date = (
    value: any,
  ): Date => {
    let date: Date = OneUptimeDate.getCurrentDate();

    if (value instanceof Date) {
      date = value;
    }

    if (typeof value === Typeof.String) {
      date = OneUptimeDate.fromString(value);
    }

    return props.timezone
      ? OneUptimeDate.getInstantFromLocalWallClockInTimezone(
          date,
          props.timezone,
        )
      : date;
  };

  const getDailyRestriction: GetReactElementFunction = (): ReactElement => {
    // show start time to end time input fields

    const labelIds: { from: string; to: string } = getRestrictionTimeLabelIds({
      baseId: labelBaseId,
    });

    return (
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <div>
          <p id={labelIds.from} className={RESTRICTION_TIME_LABEL_CLASS_NAME}>
            {translator.translateText("From:")}
          </p>
          <TimePicker
            ariaLabelledby={labelIds.from}
            value={storedDateToTimePickerValue(
              restrictionTimes?.dayRestrictionTimes?.startTime,
            )}
            onChange={(value: any) => {
              const date: Date = timePickerValueToStoredDate(value);

              const tempRestrictionTimes: RestrictionTimes =
                getEditableRestrictionTimes();

              if (!tempRestrictionTimes.dayRestrictionTimes) {
                tempRestrictionTimes.dayRestrictionTimes = {
                  startTime: date,
                  endTime: date,
                };
              }

              tempRestrictionTimes.dayRestrictionTimes.startTime = date;

              updateRestrictionTimes(tempRestrictionTimes);
            }}
          />
        </div>
        <div>
          <p id={labelIds.to} className={RESTRICTION_TIME_LABEL_CLASS_NAME}>
            {translator.translateText("To:")}
          </p>
          <TimePicker
            ariaLabelledby={labelIds.to}
            value={storedDateToTimePickerValue(
              restrictionTimes?.dayRestrictionTimes?.endTime,
            )}
            onChange={(value: any) => {
              const date: Date = timePickerValueToStoredDate(value);

              const tempRestrictionTimes: RestrictionTimes =
                getEditableRestrictionTimes();

              if (!tempRestrictionTimes.dayRestrictionTimes) {
                tempRestrictionTimes.dayRestrictionTimes = {
                  startTime: date,
                  endTime: date,
                };
              }

              tempRestrictionTimes.dayRestrictionTimes.endTime = date;

              updateRestrictionTimes(tempRestrictionTimes);
            }}
          />
        </div>
      </div>
    );
  };

  /*
   * Build a default weekly restriction whose timestamps are anchored to the
   * named weekday IN THE SCHEDULE TIMEZONE. The engine enforces the weekday from
   * getDayOfWeek(startTime, tz); the Common default alone lands the timestamp on
   * the right weekday only in the server/browser zone, so near the midnight
   * boundary a differing schedule zone would still enforce the wrong day. We
   * interpret the default 00:00 / 01:00 as schedule-tz wall-clock (mirroring the
   * TimePicker onChange handlers) and move to the target weekday, so the enforced
   * day/time exactly match the dropdown (audit M4). A no-op beyond the Common
   * default when no schedule timezone is set.
   */
  const buildDefaultWeeklyRestriction: () => WeeklyResctriction =
    (): WeeklyResctriction => {
      const startDay: DayOfWeek = DayOfWeek.Sunday;
      const endDay: DayOfWeek = DayOfWeek.Monday;
      const now: Date = OneUptimeDate.getCurrentDate();

      const startTime: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        timePickerValueToStoredDate(
          OneUptimeDate.getDateWithCustomTime({
            hours: 0,
            minutes: 0,
            seconds: 0,
          }),
        ),
        now,
        startDay,
        props.timezone,
      );

      const endTime: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        timePickerValueToStoredDate(
          OneUptimeDate.getDateWithCustomTime({
            hours: 1,
            minutes: 0,
            seconds: 0,
          }),
        ),
        now,
        endDay,
        props.timezone,
      );

      return { startDay, endDay, startTime, endTime };
    };

  const getWeeklyTimeRestrictions: GetReactElementFunction =
    (): ReactElement => {
      return (
        <div>
          {/* A window apart from the next, so each From reads with its To. */}
          <div className="ml-8 space-y-4">
            {/** LIST */}

            {restrictionTimes?.weeklyRestrictionTimes?.map(
              (weeklyRestriction: WeeklyResctriction, i: number) => {
                return (
                  <div key={i} className="flex">
                    <div>
                      {getWeeklyTimeRestriction({
                        weeklyRestriction,
                        windowIndex: i,
                        onChange: (value: WeeklyResctriction) => {
                          const tempRestrictionTimes: RestrictionTimes =
                            getEditableRestrictionTimes();

                          if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                            tempRestrictionTimes.weeklyRestrictionTimes = [];
                          }

                          tempRestrictionTimes.weeklyRestrictionTimes[i] =
                            value;

                          updateRestrictionTimes(tempRestrictionTimes);
                        },
                        onDelete: () => {
                          const tempRestrictionTimes: RestrictionTimes =
                            getEditableRestrictionTimes();

                          if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                            tempRestrictionTimes.weeklyRestrictionTimes = [];
                          }

                          tempRestrictionTimes.weeklyRestrictionTimes.splice(
                            i,
                            1,
                          );

                          updateRestrictionTimes(tempRestrictionTimes);
                        },
                      })}
                    </div>
                  </div>
                );
              },
            )}
          </div>

          {/* Level with the windows above it. */}
          <div className="ml-8 mt-3">
            {/** show add button */}
            <Button
              title={props.addWindowTitle || "Add Restriction Time"}
              isTitleTranslated={
                Boolean(props.addWindowTitle) &&
                props.isAddWindowTitleTranslated
              }
              buttonStyle={ButtonStyleType.NORMAL}
              icon={IconProp.Add}
              onClick={() => {
                const tempRestrictionTimes: RestrictionTimes =
                  getEditableRestrictionTimes();

                if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                  tempRestrictionTimes.weeklyRestrictionTimes = [];
                }

                tempRestrictionTimes.weeklyRestrictionTimes.push(
                  buildDefaultWeeklyRestriction(),
                );

                updateRestrictionTimes(tempRestrictionTimes);
              }}
            />
          </div>
        </div>
      );
    };

  type GetWeeklyRestrictionFunction = (params: {
    weeklyRestriction: WeeklyResctriction;
    // Its place in the list, for the ids of its labels.
    windowIndex: number;
    onChange: (value: WeeklyResctriction) => void;
    onDelete: () => void;
  }) => ReactElement;

  const getWeeklyTimeRestriction: GetWeeklyRestrictionFunction = (params: {
    weeklyRestriction: WeeklyResctriction;
    windowIndex: number;
    onChange: (value: WeeklyResctriction) => void;
    onDelete: () => void;
  }): ReactElement => {
    // show start time to end time input fields

    // Each end's label names its day picker and its clock.
    const labelIds: { from: string; to: string } = getRestrictionTimeLabelIds({
      baseId: labelBaseId,
      windowIndex: params.windowIndex,
    });

    const dayOptions: Array<DropdownOption> =
      getDayOfWeekMenuOptions(translator);

    // The menu's own option for a day, so the day picked reads as listed.
    const dayOption: (day: DayOfWeek) => DropdownOption | undefined = (
      day: DayOfWeek,
    ): DropdownOption | undefined => {
      return dayOptions.find((option: DropdownOption): boolean => {
        return option.value === day;
      });
    };

    /*
     * One window, one row: From and To side by side, each its day over its
     * time, and Delete level with the times. The day picker is as wide as
     * the time under it: it was as wide as its day's name, so its arrow and
     * its clear button wrapped under the day. On a narrow screen To and
     * Delete wrap under From rather than running past the card's edge.
     */
    return (
      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <p id={labelIds.from} className={RESTRICTION_TIME_LABEL_CLASS_NAME}>
            {translator.translateText("From:")}
          </p>
          <div className={RESTRICTION_WINDOW_END_CLASS_NAME}>
            <div>
              <Dropdown
                ariaLabelledby={labelIds.from}
                isClearable={false}
                options={dayOptions}
                value={dayOption(params.weeklyRestriction.startDay)}
                onChange={(value: any) => {
                  const weeklyRestriction: WeeklyResctriction = {
                    ...params.weeklyRestriction,
                    startDay: value,
                  };

                  // move start time to the new start day (in the schedule tz)
                  if (weeklyRestriction.startTime) {
                    weeklyRestriction.startTime =
                      OneUptimeDate.moveDateToTheDayOfWeek(
                        weeklyRestriction.startTime,
                        OneUptimeDate.getCurrentDate(),
                        value,
                        props.timezone,
                      );
                  }
                  params.onChange(weeklyRestriction);
                }}
              />
            </div>
            <div>
              <TimePicker
                ariaLabelledby={labelIds.from}
                value={storedDateToTimePickerValue(
                  params.weeklyRestriction?.startTime,
                )}
                onChange={(value: any) => {
                  const date: Date = timePickerValueToStoredDate(value);

                  /*
                   * move date to the day of the week from the start day, in the
                   * schedule timezone so the weekday boundary matches the engine.
                   */
                  params.onChange({
                    ...params.weeklyRestriction,
                    startTime: OneUptimeDate.moveDateToTheDayOfWeek(
                      date,
                      OneUptimeDate.getCurrentDate(),
                      params.weeklyRestriction.startDay,
                      props.timezone,
                    ),
                  });
                }}
              />
            </div>
          </div>
        </div>
        <div>
          <p id={labelIds.to} className={RESTRICTION_TIME_LABEL_CLASS_NAME}>
            {translator.translateText("To:")}
          </p>
          <div className={RESTRICTION_WINDOW_END_CLASS_NAME}>
            <div>
              <Dropdown
                ariaLabelledby={labelIds.to}
                isClearable={false}
                options={dayOptions}
                value={dayOption(params.weeklyRestriction.endDay)}
                onChange={(value: any) => {
                  const weeklyRestriction: WeeklyResctriction = {
                    ...params.weeklyRestriction,
                    endDay: value,
                  };

                  // move end time to the new end day (in the schedule tz)
                  if (weeklyRestriction.endTime) {
                    weeklyRestriction.endTime =
                      OneUptimeDate.moveDateToTheDayOfWeek(
                        weeklyRestriction.endTime,
                        OneUptimeDate.getCurrentDate(),
                        value,
                        props.timezone,
                      );
                  }
                  params.onChange(weeklyRestriction);
                }}
              />
            </div>
            <div>
              <TimePicker
                ariaLabelledby={labelIds.to}
                value={storedDateToTimePickerValue(
                  params.weeklyRestriction?.endTime,
                )}
                onChange={(value: any) => {
                  const date: Date = timePickerValueToStoredDate(value);

                  /*
                   * move date to the day of the week from the end day, in the
                   * schedule timezone so the weekday boundary matches the engine.
                   */
                  params.onChange({
                    ...params.weeklyRestriction,
                    endTime: OneUptimeDate.moveDateToTheDayOfWeek(
                      date,
                      OneUptimeDate.getCurrentDate(),
                      params.weeklyRestriction.endDay,
                      props.timezone,
                    ),
                  });
                }}
              />
            </div>
          </div>
        </div>

        {/* The row's gap spaces it. */}
        <div>
          <Button
            title="Delete"
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Trash}
            onClick={() => {
              params.onDelete();
            }}
          />
        </div>
      </div>
    );
  };

  type UpdateRestrictionTimesFunction = (
    restrictionTimes: RestrictionTimes,
  ) => void;

  const updateRestrictionTimes: UpdateRestrictionTimesFunction = (
    restrictionTimes: RestrictionTimes,
  ): void => {
    setRestrictionTimes(RestrictionTimes.fromJSON(restrictionTimes.toJSON()));
    if (props.onChange) {
      props.onChange(restrictionTimes);
    }
  };

  return (
    <div>
      <BasicRadioButtons
        onChange={(value: string) => {
          /*
           * BasicRadioButtons also reports its initialValue through onChange,
           * on mount and whenever it changes - e.g. when the form's saved
           * value arrives. That is the type already selected, not the user
           * picking an option, so it must not reset the restrictions to the
           * defaults below. It did, which replaced a layer's saved hours with
           * 00:00-01:00 every time its edit form was opened and saved.
           */
          if (value === (restrictionTimes?.restictionType ?? "")) {
            return;
          }

          const tempRestrictionTimes: RestrictionTimes =
            getEditableRestrictionTimes();

          if (value === RestrictionType.None) {
            // remove all restrictions
            tempRestrictionTimes.removeAllRestrictions();
            updateRestrictionTimes(tempRestrictionTimes);
          } else if (value === RestrictionType.Daily) {
            // remove all restrictions
            tempRestrictionTimes.removeAllRestrictions();
            // add daily restriction
            tempRestrictionTimes.addDefaultDailyRestriction();
            updateRestrictionTimes(tempRestrictionTimes);
          } else if (value === RestrictionType.Weekly) {
            // remove all restrictions
            tempRestrictionTimes.removeAllRestrictions();
            /*
             * Add a weekly restriction whose default day is reconciled to the
             * schedule timezone (audit M4). Using addDefaultWeeklyRestriction()
             * would stamp the Common default whose weekday only matches in the
             * server/browser zone.
             */
            tempRestrictionTimes.restictionType = RestrictionType.Weekly;
            tempRestrictionTimes.dayRestrictionTimes = null;
            tempRestrictionTimes.weeklyRestrictionTimes = [
              buildDefaultWeeklyRestriction(),
            ];
            updateRestrictionTimes(tempRestrictionTimes);
          }
        }}
        initialValue={restrictionTimes?.restictionType}
        /*
         * In the reader's language: the radio draws its titles as given, so
         * they were English in every language, beside a same-time error
         * that names "No Restrictions" in the reader's words.
         */
        options={[
          ...(props.hidesNoRestrictions
            ? []
            : [
                {
                  title:
                    translator.translateText("No Restrictions") ||
                    "No Restrictions",
                  value: RestrictionType.None,
                },
              ]),
          {
            title:
              translator.translateText("Specific Times of the Day") ||
              "Specific Times of the Day",
            value: RestrictionType.Daily,
            children: getDailyRestriction(),
          },
          {
            title:
              translator.translateText("Specific Times of the Week") ||
              "Specific Times of the Week",
            value: RestrictionType.Weekly,
            children: getWeeklyTimeRestrictions(),
          },
        ]}
      />

      {restrictionTimes &&
        restrictionTimes.restictionType !== RestrictionType.None && (
          /*
           * The zone by its current name, as the rotation start and hand-off
           * over it name it ("US/Pacific" reads America/Los_Angeles), so the
           * form names one zone one way.
           */
          <p className={TIME_ZONE_NOTE_CLASS_NAME}>
            {props.timezone
              ? translator.translateTemplate(
                  props.timezoneNoteTemplate ||
                    "These times are in the schedule's timezone: {{timezone}}.",
                  {
                    timezone: TimezoneAlias.getCanonicalTimezone(
                      props.timezone,
                    ),
                  },
                )
              : translator.translateTemplate(
                  "These times are in your local timezone: {{timezone}}.",
                  { timezone: OneUptimeDate.getCurrentTimezoneString() },
                )}
          </p>
        )}

      {props.error && <FieldError message={props.error} announce="none" />}
    </div>
  );
};

export default RestrictionTimesFieldElement;
