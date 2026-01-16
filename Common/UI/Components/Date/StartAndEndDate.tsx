import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Input, { InputType } from "../Input/Input";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import React, { ReactElement, useEffect } from "react";

export enum StartAndEndDateType {
  Date = "Date",
  DateTime = "DateTime",
}

export interface ComponentProps {
  value?: InBetween<Date> | undefined;
  onValueChanged: (value: InBetween<Date> | null) => void;
  type: StartAndEndDateType;
  hideTimeButtons?: boolean | undefined;
}

type DateFilterFunction = (props: ComponentProps) => ReactElement;

const StartAndEndDate: DateFilterFunction = (
  props: ComponentProps,
): ReactElement => {
  const [startDateError, setStartDateError] = React.useState<string>("");
  const [endDateError, setEndDateError] = React.useState<string>("");

  let inputType: InputType = InputType.TEXT;

  if (props.type === StartAndEndDateType.Date) {
    inputType = InputType.DATE;
  } else if (props.type === StartAndEndDateType.DateTime) {
    inputType = InputType.DATETIME_LOCAL;
  }

  const startDateTime: Date | undefined = props.value?.startValue;
  const endDateTime: Date | undefined = props.value?.endValue;

  useEffect(() => {
    if (endDateTime && startDateTime) {
      // check if start date is after end date

      if (!OneUptimeDate.isAfter(endDateTime, startDateTime)) {
        setStartDateError("Start date should be before end date");
        setEndDateError("End date should be after start date");

        return;
      }

      setStartDateError("");
      setEndDateError("");

      return;
    }

    if (startDateTime && !endDateTime) {
      setStartDateError("");
      setEndDateError("End date is required");
    } else if (!startDateTime && endDateTime) {
      setEndDateError("");
      setStartDateError("Start date is required");
    } else {
      setStartDateError("");
      setEndDateError("");
    }
  }, [props.value]);

  // difference between both dates is 60 mins.
  const is1Hour: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMinutes(startDateTime, endDateTime) === 60;

  // difference between both dates is 3 hours.
  const is3Hours: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMinutes(startDateTime, endDateTime) === 180;

  // difference between both dates is 1 day.
  const is1Day: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMinutes(startDateTime, endDateTime) === 1440;

  // difference between both dates is 1 week.
  const is1Week: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMinutes(startDateTime, endDateTime) === 10080;

  // difference between both dates is 2 weeks.
  const is2Weeks: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMinutes(startDateTime, endDateTime) === 20160;

  // difference between both dates is 3 weeks.
  const is3Weeks: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMinutes(startDateTime, endDateTime) === 30240;

  // difference between both dates is 1 month.
  const is1Month: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMonths(startDateTime, endDateTime) === 1;

  // difference between both dates is 3 months.
  const is3Months: boolean | undefined =
    props.type === StartAndEndDateType.DateTime &&
    startDateTime &&
    endDateTime &&
    OneUptimeDate.getDifferenceInMonths(startDateTime, endDateTime) === 3;

  if (
    props.type === StartAndEndDateType.Date ||
    props.type === StartAndEndDateType.DateTime
  ) {
    return (
      <div>
        <div className="flex flex-col md:flex-row md:space-x-3 space-y-3 md:space-y-0 mt-1">
          <div className="w-full md:w-1/2">
            <div className="text-xs text-gray-500">From:</div>
            <div>
              <Input
                error={startDateError}
                onChange={(changedValue: string | Date) => {
                  if (!changedValue) {
                    props.onValueChanged?.(
                      new InBetween<Date>(
                        OneUptimeDate.getCurrentDate(),
                        endDateTime || OneUptimeDate.getCurrentDate(),
                      ),
                    );
                  }

                  if (
                    changedValue &&
                    (props.type === StartAndEndDateType.Date ||
                      props.type === StartAndEndDateType.DateTime)
                  ) {
                    props.onValueChanged?.(
                      new InBetween<Date>(
                        OneUptimeDate.fromString(changedValue as string),
                        endDateTime || OneUptimeDate.getCurrentDate(),
                      ),
                    );
                  }
                }}
                value={startDateTime || ""}
                placeholder={`Start Date`}
                type={inputType}
                showSecondsForDateTime={
                  props.type === StartAndEndDateType.DateTime
                }
              />
            </div>
          </div>
          <div className="w-full md:w-1/2">
            <div className="text-xs text-gray-500">To:</div>
            <div>
              <Input
                error={endDateError}
                onChange={(changedValue: string | Date) => {
                  if (!changedValue) {
                    props.onValueChanged?.(
                      new InBetween<Date>(
                        startDateTime || OneUptimeDate.getCurrentDate(),
                        OneUptimeDate.getCurrentDate(),
                      ),
                    );
                  }

                  if (
                    changedValue &&
                    (props.type === StartAndEndDateType.Date ||
                      props.type === StartAndEndDateType.DateTime)
                  ) {
                    props.onValueChanged?.(
                      new InBetween<Date>(
                        startDateTime || OneUptimeDate.getCurrentDate(),
                        OneUptimeDate.fromString(changedValue as string),
                      ),
                    );
                  }
                }}
                value={endDateTime || ""}
                placeholder={`End Date`}
                type={inputType}
                showSecondsForDateTime={
                  props.type === StartAndEndDateType.DateTime
                }
              />
            </div>
          </div>
        </div>

        {!props.hideTimeButtons && (
          <div className="mt-1 flex space-x-2 -ml-3">
            {props.type === StartAndEndDateType.DateTime && (
              <Button
                buttonStyle={
                  is1Hour ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
                }
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  // set it to past 1 hour
                  const endDate: Date = OneUptimeDate.getCurrentDate();
                  const startDate: Date = OneUptimeDate.addRemoveHours(
                    endDate,
                    -1,
                  );

                  props.onValueChanged?.(
                    new InBetween<Date>(startDate, endDate),
                  );
                }}
                title="1 hour"
              />
            )}

            {props.type === StartAndEndDateType.DateTime && (
              <Button
                buttonStyle={
                  is3Hours ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
                }
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  // set it to past 3 hour
                  const endDate: Date = OneUptimeDate.getCurrentDate();
                  const startDate: Date = OneUptimeDate.addRemoveHours(
                    endDate,
                    -3,
                  );

                  props.onValueChanged?.(
                    new InBetween<Date>(startDate, endDate),
                  );
                }}
                title="3 hours"
                className="hidden md:block"
              />
            )}

            <Button
              buttonStyle={
                is1Day ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
              }
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 day
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveDays(
                  endDate,
                  -1,
                );

                props.onValueChanged?.(new InBetween<Date>(startDate, endDate));
              }}
              title="1 day"
            />

            <Button
              buttonStyle={
                is1Week ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
              }
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 week
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveDays(
                  endDate,
                  -7,
                );

                props.onValueChanged?.(new InBetween<Date>(startDate, endDate));
              }}
              title="1 week"
            />

            <Button
              buttonStyle={
                is2Weeks ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
              }
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 week
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveDays(
                  endDate,
                  -14,
                );

                props.onValueChanged?.(new InBetween<Date>(startDate, endDate));
              }}
              title="2 weeks"
              className="hidden md:block"
            />

            <Button
              buttonStyle={
                is3Weeks ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
              }
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 week
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveDays(
                  endDate,
                  -21,
                );

                props.onValueChanged?.(new InBetween<Date>(startDate, endDate));
              }}
              title="3 weeks"
              className="hidden md:block"
            />

            <Button
              buttonStyle={
                is1Month ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
              }
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 month
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveMonths(
                  endDate,
                  -1,
                );

                props.onValueChanged?.(new InBetween<Date>(startDate, endDate));
              }}
              title="1 month"
              className="hidden md:block"
            />

            <Button
              buttonStyle={
                is3Months ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
              }
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 month
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveMonths(
                  endDate,
                  -3,
                );

                props.onValueChanged?.(new InBetween<Date>(startDate, endDate));
              }}
              title="3 months"
              className="hidden md:block"
            />
          </div>
        )}
      </div>
    );
  }

  return <></>;
};

export default StartAndEndDate;
