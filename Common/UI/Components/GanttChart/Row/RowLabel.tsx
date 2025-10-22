import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string | ReactElement;
  description: string | ReactElement;
  isHighlighted?: boolean;
}

const RowLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    // rectangle div with curved corners and text inside in tailwindcss

    <div className="overflow-hidden">
      <div
        className={`truncate overflow-hidden text-sm transition-colors duration-150 ${props.isHighlighted ? "font-semibold text-indigo-700" : "text-gray-600"}`}
      >
        {props.title}
      </div>
      <div
        className={`truncate overflow-hidden text-xs transition-colors duration-150 ${props.isHighlighted ? "text-indigo-500" : "text-gray-500"}`}
      >
        {props.description}
      </div>
    </div>
  );
};

export default RowLabel;
