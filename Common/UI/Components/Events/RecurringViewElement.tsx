import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value?: Recurring | undefined;
}

const RecurringViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.value) {
    return <p>-</p>;
  }

  const value: Recurring = Recurring.fromJSON(props.value);

  return (
    <p>
      {value.intervalCount?.toString()}{" "}
      {EventInterval[value.intervalType]?.toString()}
      {value.intervalCount && value.intervalCount.toNumber() > 1 ? "s" : ""}
    </p>
  );
};

export default RecurringViewElement;
