import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
}

const PlaceholderText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span className="text-gray-400 italic text-sm select-none">
      {props.text}
    </span>
  );
};

export default PlaceholderText;
