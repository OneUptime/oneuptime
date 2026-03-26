import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";

export interface ComponentProps {
  icon?: IconProp | undefined;
  text: string;
  onClick: () => void;
  rightElement?: Array<ReactElement> | ReactElement | undefined;
  className?: string | undefined;
  iconClassName?: string | undefined;
  key: string | number;
}

const MoreMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <a
      key={props.key || Math.random()}
      className={`cursor-pointer group flex items-center px-3 py-2 mx-1 rounded-md text-sm text-gray-700 hover:text-gray-900 hover:bg-indigo-50 transition-colors duration-100 ${props.className}`}
      role="menuitem"
      onClick={() => {
        props.onClick();
      }}
    >
      {props.icon && (
        <Icon
          icon={props.icon}
          className={`mr-2.5 h-4 w-4 text-gray-400 group-hover:text-indigo-500 transition-colors duration-100 ${props.iconClassName}`}
        />
      )}
      <div className="flex w-full justify-between items-center">
        <div className="font-medium">{props.text}</div>
        <div>{props.rightElement}</div>
      </div>
    </a>
  );
};

export default MoreMenuItem;
