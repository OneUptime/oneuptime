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
  isDisabled?: boolean | undefined;
}

const MoreMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <button
      type="button"
      className={`group mx-1 flex items-center rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors duration-100 enabled:cursor-pointer enabled:hover:bg-indigo-50 enabled:hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 ${props.className || ""}`}
      role="menuitem"
      tabIndex={-1}
      disabled={props.isDisabled}
      aria-disabled={Boolean(props.isDisabled)}
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
    </button>
  );
};

export default MoreMenuItem;
