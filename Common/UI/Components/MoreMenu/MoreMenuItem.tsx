import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";

export interface ComponentProps {
  icon?: IconProp | undefined;
  text: string;
  onClick: () => void;
  rightElement?: Array<ReactElement> | ReactElement | undefined;
}

const MoreMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <a
      className="cursor-pointer group flex items-center px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50"
      role="menuitem"
      onClick={() => {
        props.onClick();
      }}
    >
      {props.icon && (
        <Icon
          icon={props.icon}
          className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500"
        />
      )}
      <div className="flex justify-between">
        <div>{props.text}</div>
        <div>{props.rightElement}</div>
      </div>
    </a>
  );
};

export default MoreMenuItem;
