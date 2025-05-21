import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value?: Recurring | undefined;
  postfix?: string | undefined;
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
      {props.postfix || ""}
    </p>
  );
};

export default RecurringViewElement;
