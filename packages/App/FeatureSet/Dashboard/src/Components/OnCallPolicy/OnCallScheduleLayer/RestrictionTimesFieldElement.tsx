import OneUptimeDate from "Common/Types/Date";
import DayOfWeek from "Common/Types/Day/DayOfWeek";
import IconProp from "Common/Types/Icon/IconProp";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import Typeof from "Common/Types/Typeof";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Dropdown from "Common/UI/Components/Dropdown/Dropdown";
// removed InputType.TIME usage in favor of TimePicker
import TimePicker from "Common/UI/Components/TimePicker/Index";
import BasicRadioButtons from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  error?: string | undefined;
  onChange?: ((value: RestrictionTimes) => void) | undefined;
  value?: RestrictionTimes | undefined;
  /*
   * The schedule's IANA timezone. Restriction wall-clock times are ENFORCED by
   * the engine in this zone, but the TimePicker captures/displays in the
   * viewer's browser zone. Without reconciling the two, an admin in a different
   * zone silently configured the wrong hours (audit F1). When set, times are
   * entered, displayed and stored as wall-clock in this zone; when omitted, the
   * legacy browser-local behavior is preserved.
   */
  timezone?: string | undefined;
}

const RestrictionTimesFieldElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [restrictionTimes, setRestrictionTimes] = useState<
    RestrictionTimes | undefined
  >(props.value ? RestrictionTimes.fromJSON(props.value) : undefined);

  useEffect(() => {
    if (props.value) {
      setRestrictionTimes(RestrictionTimes.fromJSON(props.value));
    } else {
      setRestrictionTimes(undefined);
    }
  }, [props.value]);

  /*
   * Display a stored instant in the TimePicker as its wall-clock IN THE SCHEDULE
   * TIMEZONE (the picker itself renders in browser-local time, so we hand it a
   * local Date carrying the schedule-zone wall-clock). Inverse of
   * timePickerValueToStoredDate.
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
   * Convert a TimePicker onChange value (a browser-local wall-clock) into the
   * instant to STORE, reinterpreting the entered wall-clock in the schedule
   * timezone so it is enforced exactly as typed (audit F1).
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

    return (
      <div className="flex space-x-3">
        <div>
          <FieldLabelElement title="From:" />
          <TimePicker
            value={storedDateToTimePickerValue(
              restrictionTimes?.dayRestrictionTimes?.startTime,
            )}
            onChange={(value: any) => {
              const date: Date = timePickerValueToStoredDate(value);

              let tempRestrictionTimes: RestrictionTimes | undefined =
                restrictionTimes;

              if (!tempRestrictionTimes) {
                tempRestrictionTimes = new RestrictionTimes();
              }

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
          <FieldLabelElement title="To:" />
          <TimePicker
            value={storedDateToTimePickerValue(
              restrictionTimes?.dayRestrictionTimes?.endTime,
            )}
            onChange={(value: any) => {
              const date: Date = timePickerValueToStoredDate(value);

              let tempRestrictionTimes: RestrictionTimes | undefined =
                restrictionTimes;

              if (!tempRestrictionTimes) {
                tempRestrictionTimes = new RestrictionTimes();
              }

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
          <div className="ml-8">
            {/** LIST */}

            {restrictionTimes?.weeklyRestrictionTimes?.map(
              (weeklyRestriction: WeeklyResctriction, i: number) => {
                return (
                  <div key={i} className="flex">
                    <div>
                      {getWeeklyTimeRestriction({
                        weeklyRestriction,
                        onChange: (value: WeeklyResctriction) => {
                          let tempRestrictionTimes:
                            | RestrictionTimes
                            | undefined = restrictionTimes;

                          if (!tempRestrictionTimes) {
                            tempRestrictionTimes = new RestrictionTimes();
                          }

                          if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                            tempRestrictionTimes.weeklyRestrictionTimes = [];
                          }

                          tempRestrictionTimes.weeklyRestrictionTimes[i] =
                            value;

                          updateRestrictionTimes(tempRestrictionTimes);
                        },
                        onDelete: () => {
                          let tempRestrictionTimes:
                            | RestrictionTimes
                            | undefined = restrictionTimes;

                          if (!tempRestrictionTimes) {
                            tempRestrictionTimes = new RestrictionTimes();
                          }

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

          <div className="ml-5 mt-3">
            {/** show add button */}
            <Button
              title="Add Restriction Time"
              buttonStyle={ButtonStyleType.NORMAL}
              icon={IconProp.Add}
              onClick={() => {
                let tempRestrictionTimes: RestrictionTimes | undefined =
                  restrictionTimes;

                if (!tempRestrictionTimes) {
                  tempRestrictionTimes = new RestrictionTimes();
                }

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
    onChange: (value: WeeklyResctriction) => void;
    onDelete: () => void;
  }) => ReactElement;

  const getWeeklyTimeRestriction: GetWeeklyRestrictionFunction = (params: {
    weeklyRestriction: WeeklyResctriction;
    onChange: (value: WeeklyResctriction) => void;
    onDelete: () => void;
  }): ReactElement => {
    // show start time to end time input fields

    return (
      <div className="flex space-x-3 mt-2">
        <div>
          <FieldLabelElement title="From:" />
          <div className="space-x-3 flex">
            <div>
              <Dropdown
                options={DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek)}
                value={DropdownUtil.getDropdownOptionFromEnumForValue(
                  DayOfWeek,
                  params.weeklyRestriction.startDay,
                )}
                onChange={(value: any) => {
                  params.weeklyRestriction.startDay = value;

                  // move start time to the new start day (in the schedule tz)
                  if (params.weeklyRestriction.startTime) {
                    params.weeklyRestriction.startTime =
                      OneUptimeDate.moveDateToTheDayOfWeek(
                        params.weeklyRestriction.startTime,
                        OneUptimeDate.getCurrentDate(),
                        value,
                        props.timezone,
                      );
                  }
                  params.onChange(params.weeklyRestriction);
                }}
              />
            </div>
            <div>
              <TimePicker
                value={storedDateToTimePickerValue(
                  params.weeklyRestriction?.startTime,
                )}
                onChange={(value: any) => {
                  const date: Date = timePickerValueToStoredDate(value);

                  /*
                   * move date to the day of the week from the start day, in the
                   * schedule timezone so the weekday boundary matches the engine.
                   */
                  params.weeklyRestriction.startTime =
                    OneUptimeDate.moveDateToTheDayOfWeek(
                      date,
                      OneUptimeDate.getCurrentDate(),
                      params.weeklyRestriction.startDay,
                      props.timezone,
                    );

                  params.onChange(params.weeklyRestriction);
                }}
              />
            </div>
          </div>
        </div>
        <div className="ml-5">
          <FieldLabelElement title="To:" />
          <div className="space-x-3 flex">
            <div>
              <Dropdown
                options={DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek)}
                value={DropdownUtil.getDropdownOptionFromEnumForValue(
                  DayOfWeek,
                  params.weeklyRestriction.endDay,
                )}
                onChange={(value: any) => {
                  params.weeklyRestriction.endDay = value;

                  // move end time to the new end day (in the schedule tz)
                  if (params.weeklyRestriction.endTime) {
                    params.weeklyRestriction.endTime =
                      OneUptimeDate.moveDateToTheDayOfWeek(
                        params.weeklyRestriction.endTime,
                        OneUptimeDate.getCurrentDate(),
                        value,
                        props.timezone,
                      );
                  }
                  params.onChange(params.weeklyRestriction);
                }}
              />
            </div>
            <div>
              <TimePicker
                value={storedDateToTimePickerValue(
                  params.weeklyRestriction?.endTime,
                )}
                onChange={(value: any) => {
                  const date: Date = timePickerValueToStoredDate(value);

                  /*
                   * move date to the day of the week from the end day, in the
                   * schedule timezone so the weekday boundary matches the engine.
                   */
                  params.weeklyRestriction.endTime =
                    OneUptimeDate.moveDateToTheDayOfWeek(
                      date,
                      OneUptimeDate.getCurrentDate(),
                      params.weeklyRestriction.endDay,
                      props.timezone,
                    );

                  params.onChange(params.weeklyRestriction);
                }}
              />
            </div>
          </div>
        </div>

        <div className="mt-8">
          {/* Dellete Button */}
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
          let tempRestrictionTimes: RestrictionTimes | undefined =
            restrictionTimes;

          if (!tempRestrictionTimes) {
            tempRestrictionTimes = new RestrictionTimes();
          }

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
        options={[
          {
            title: "No Restrictions",
            value: RestrictionType.None,
          },
          {
            title: "Specific Times of the Day",
            value: RestrictionType.Daily,
            children: getDailyRestriction(),
          },
          {
            title: "Specific Times of the Week",
            value: RestrictionType.Weekly,
            children: getWeeklyTimeRestrictions(),
          },
        ]}
      />

      {restrictionTimes &&
        restrictionTimes.restictionType !== RestrictionType.None && (
          <p className="mt-2 text-xs text-gray-400">
            {props.timezone
              ? `These times are in the schedule's timezone: ${props.timezone}.`
              : `These times are in your local timezone: ${OneUptimeDate.getCurrentTimezoneString()}.`}
          </p>
        )}

      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default RestrictionTimesFieldElement;
