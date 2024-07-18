import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Input, { InputType } from "../Input/Input";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import React, { ReactElement, useEffect } from "react";

export enum StartAndEndDateType {
  Date = "Date",
  DateTime = "DateTime",
}

export interface ComponentProps {
  initialValue?: InBetween | undefined;
  onValueChanged: (value: InBetween | null) => void;
  type: StartAndEndDateType;
}

type DateFilterFunction = (props: ComponentProps) => ReactElement;

const StartAndEndDate: DateFilterFunction = (
  props: ComponentProps,
): ReactElement => {
  const [startDateTime, setStartDateTime] = React.useState<Date | null>(null);
  const [endDateTime, setEndDateTime] = React.useState<Date | null>(null);

  const [startDateError, setStartDateError] = React.useState<string>("");
  const [endDateError, setEndDateError] = React.useState<string>("");

  const [didSetInitialValue, setDidSetInitialValue] =
    React.useState<boolean>(false);

  let inputType: InputType = InputType.TEXT;

  if (props.type === StartAndEndDateType.Date) {
    inputType = InputType.DATE;
  } else if (props.type === StartAndEndDateType.DateTime) {
    inputType = InputType.DATETIME_LOCAL;
  }

  useEffect(() => {
    // prefill the date filter if it is already set

    if (!didSetInitialValue && props.initialValue instanceof InBetween) {
      const inBetween: InBetween = props.initialValue as InBetween;

      if (inBetween.startValue) {
        setStartDateTime(
          OneUptimeDate.fromString(inBetween.startValue as string),
        );
      }

      if (inBetween.endValue) {
        setEndDateTime(OneUptimeDate.fromString(inBetween.endValue as string));
      }

      setDidSetInitialValue(true);
    }
  }, [props.initialValue]);

  useEffect(() => {
    if (startDateTime && endDateTime) {
      // check if start date is after end date

      if (!OneUptimeDate.isAfter(endDateTime, startDateTime)) {
        setStartDateError("Start date should be before end date");
        setEndDateError("End date should be after start date");

        props.onValueChanged && props.onValueChanged(null);

        return;
      }

      const value: InBetween = new InBetween(startDateTime, endDateTime);
      props.onValueChanged && props.onValueChanged(value);

      return;
    }

    if (!startDateTime || !endDateTime) {
      return props.onValueChanged && props.onValueChanged(null);
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

    return (
      props.onValueChanged &&
      props.onValueChanged(new InBetween(startDateTime, endDateTime))
    );
  }, [startDateTime, endDateTime]);

  if (
    props.type === StartAndEndDateType.Date ||
    props.type === StartAndEndDateType.DateTime
  ) {
    return (
      <div>
        <div className="flex space-x-3 mt-1">
          <div className="w-1/2">
            <div className="text-xs text-gray-500">From:</div>
            <div>
              <Input
                error={startDateError}
                onChange={(changedValue: string | Date) => {
                  if (!changedValue) {
                    setStartDateTime(null);
                  }

                  if (
                    changedValue &&
                    (props.type === StartAndEndDateType.Date ||
                      props.type === StartAndEndDateType.DateTime)
                  ) {
                    setStartDateTime(
                      OneUptimeDate.fromString(changedValue as string),
                    );
                  }
                }}
                value={startDateTime || ""}
                placeholder={`Start Date`}
                type={inputType}
              />
            </div>
          </div>
          <div className="w-1/2">
            <div className="text-xs text-gray-500">To:</div>
            <div>
              <Input
                error={endDateError}
                onChange={(changedValue: string | Date) => {
                  if (!changedValue) {
                    setEndDateTime(null);
                  }

                  if (
                    changedValue &&
                    (props.type === StartAndEndDateType.Date ||
                      props.type === StartAndEndDateType.DateTime)
                  ) {
                    setEndDateTime(
                      OneUptimeDate.fromString(changedValue as string),
                    );
                  }
                }}
                value={endDateTime || ""}
                placeholder={`End Date`}
                type={inputType}
              />
            </div>
          </div>
        </div>

        <div className="mt-1 flex space-x-2 -ml-3">
          {props.type === StartAndEndDateType.DateTime && (
            <Button
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 1 hour
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveHours(
                  endDate,
                  -1,
                );

                setStartDateTime(startDate);
                setEndDateTime(endDate);
              }}
              title="1 hour"
            />
          )}

          {props.type === StartAndEndDateType.DateTime && (
            <Button
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                // set it to past 3 hour
                const endDate: Date = OneUptimeDate.getCurrentDate();
                const startDate: Date = OneUptimeDate.addRemoveHours(
                  endDate,
                  -3,
                );

                setStartDateTime(startDate);
                setEndDateTime(endDate);
              }}
              title="3 hours"
            />
          )}

          <Button
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // set it to past 1 day
              const endDate: Date = OneUptimeDate.getCurrentDate();
              const startDate: Date = OneUptimeDate.addRemoveDays(endDate, -1);

              setStartDateTime(startDate);
              setEndDateTime(endDate);
            }}
            title="1 day"
          />

          <Button
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // set it to past 1 week
              const endDate: Date = OneUptimeDate.getCurrentDate();
              const startDate: Date = OneUptimeDate.addRemoveDays(endDate, -7);

              setStartDateTime(startDate);
              setEndDateTime(endDate);
            }}
            title="1 week"
          />

          <Button
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // set it to past 1 week
              const endDate: Date = OneUptimeDate.getCurrentDate();
              const startDate: Date = OneUptimeDate.addRemoveDays(endDate, -14);

              setStartDateTime(startDate);
              setEndDateTime(endDate);
            }}
            title="2 weeks"
          />

          <Button
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // set it to past 1 week
              const endDate: Date = OneUptimeDate.getCurrentDate();
              const startDate: Date = OneUptimeDate.addRemoveDays(endDate, -21);

              setStartDateTime(startDate);
              setEndDateTime(endDate);
            }}
            title="3 weeks"
          />

          <Button
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // set it to past 1 month
              const endDate: Date = OneUptimeDate.getCurrentDate();
              const startDate: Date = OneUptimeDate.addRemoveMonths(
                endDate,
                -1,
              );

              setStartDateTime(startDate);
              setEndDateTime(endDate);
            }}
            title="1 month"
          />

          <Button
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // set it to past 1 month
              const endDate: Date = OneUptimeDate.getCurrentDate();
              const startDate: Date = OneUptimeDate.addRemoveMonths(
                endDate,
                -3,
              );

              setStartDateTime(startDate);
              setEndDateTime(endDate);
            }}
            title="3 months"
          />
        </div>
      </div>
    );
  }

  return <></>;
};

export default StartAndEndDate;
