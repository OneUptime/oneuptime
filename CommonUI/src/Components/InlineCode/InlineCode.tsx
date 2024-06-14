import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string | ReactElement;
}

const InlineCode: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span className="font-medium text-xs text-slate-200 bg-slate-700 p-1 pl-2 pr-2 rounded">
      {props.text}
    </span>
  );
};

export default InlineCode;
