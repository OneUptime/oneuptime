import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement;
  tooltip?: string | undefined;
  isSelected?: boolean | undefined;
}

const ComponentToolbarIconButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let className: string =
    "w-5 h-5 hover:bg-gray-100 rounded cursor-pointer p-0.5 m-0.5";

  if (props.isSelected) {
    className += " bg-gray-200";
  }

  const getButton: GetReactElementFunction = (): ReactElement => {
    return <div className={className}>{props.children}</div>;
  };

  if (props.tooltip) {
    return <Tooltip text={props.tooltip}>{getButton()}</Tooltip>;
  }

  return getButton();
};

export default ComponentToolbarIconButton;
