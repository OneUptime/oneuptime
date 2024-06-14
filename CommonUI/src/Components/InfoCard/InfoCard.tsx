import FieldLabelElement from "../Detail/FieldLabel";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  value: string | ReactElement;
  className?: string;
  textClassName?: string;
}

const InfoCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className={`rounded-md bg-white shadow-md p-5 ${props.className || ""}`}
    >
      <div>
        <FieldLabelElement title={props.title} />
      </div>
      <div className={props.textClassName || ""}>{props.value}</div>
    </div>
  );
};

export default InfoCard;
