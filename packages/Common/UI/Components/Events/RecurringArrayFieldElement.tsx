import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import React, { FunctionComponent, ReactElement, useState } from "react";
import RecurringFieldElement from "./RecurringFieldElement";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  error?: string | undefined;
  onChange?: ((value: Array<Recurring>) => void) | undefined;
  initialValue?: Array<Recurring> | undefined;
}

const RecurringArrayFieldElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [recurrings, setRecurrings] = useState<Array<Recurring> | undefined>(
    props.initialValue && props.initialValue.length > 0
      ? Recurring.fromJSONArray(props.initialValue)
      : undefined,
  );

  type UpdateRecurringFunction = (recurring: Recurring, index: number) => void;

  const updateRecurrings: UpdateRecurringFunction = (
    recurring: Recurring,
    index: number,
  ): void => {
    const existingRecurrings: Array<Recurring> = [...(recurrings || [])];

    existingRecurrings[index] = recurring;

    setRecurrings(existingRecurrings);

    if (props.onChange) {
      props.onChange(existingRecurrings);
    }
  };

  return (
    <div>
      {recurrings &&
        recurrings.map((recurring: Recurring, index: number) => {
          return (
            <div key={index} className="flex">
              <div className="">
                <RecurringFieldElement
                  initialValue={recurring}
                  onChange={(recurring: Recurring) => {
                    updateRecurrings(recurring, index);
                  }}
                />
              </div>

              <div>
                <Button
                  dataTestId={`delete-${index}`}
                  title="Delete"
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Trash}
                  onClick={() => {
                    const newData: Array<Recurring> = [...(recurrings || [])];
                    newData.splice(index, 1);
                    setRecurrings(newData);
                    props.onChange?.(newData);
                  }}
                />
              </div>
            </div>
          );
        })}

      <div className="flex space-x-3 mt-3 -ml-3">
        <Button
          dataTestId={`add-recurring`}
          title="Add"
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newData: Array<Recurring> = [...(recurrings || [])];

            const recurring: Recurring = new Recurring();
            recurring.intervalCount = new PositiveNumber(1);
            recurring.intervalType = EventInterval.Day;

            newData.push(recurring);
            setRecurrings(newData);
            props.onChange?.(newData);
          }}
        />
      </div>

      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default RecurringArrayFieldElement;
