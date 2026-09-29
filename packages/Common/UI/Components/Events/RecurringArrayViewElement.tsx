import Recurring from "../../../Types/Events/Recurring";
import React, { FunctionComponent, ReactElement } from "react";
import RecurringViewElement from "./RecurringViewElement";

export interface ComponentProps {
  value?: Array<Recurring> | undefined;
  postfix?: string | undefined;
  noItemsMessage?: string | undefined;
}

const RecurringArrayViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.value) {
    return <p>-</p>;
  }

  const items: Array<Recurring> = Recurring.fromJSONArray(props.value);

  return (
    <div className="space-y-2">
      {items &&
        items.length > 0 &&
        items.map((item: Recurring, index: number) => {
          return (
            <RecurringViewElement
              key={index}
              value={item}
              postfix={props.postfix}
            />
          );
        })}
      {(!items || items.length === 0) && <p>{props.noItemsMessage || "-"}</p>}
    </div>
  );
};

export default RecurringArrayViewElement;
