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
      className={`rounded-xl bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 ${props.className || ""}`}
    >
      <div className="mb-2">
        <FieldLabelElement title={props.title} />
      </div>
      <div className={props.textClassName || "text-gray-900"}>
        {props.value}
      </div>
    </div>
  );
};

export default InfoCard;
