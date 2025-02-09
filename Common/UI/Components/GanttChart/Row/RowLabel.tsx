import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string | ReactElement;
  description: string | ReactElement;
}

const RowLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    // rectangle div with curved corners and text inside in tailwindcss

    <div className="overflow-hidden">
      <div className="text-sm text-gray-600 truncate overflow-hidden">
        {props.title}
      </div>
      <div className="text-xs text-gray-500 truncate overflow-hidden">
        {props.description}
      </div>
    </div>
  );
};

export default RowLabel;
