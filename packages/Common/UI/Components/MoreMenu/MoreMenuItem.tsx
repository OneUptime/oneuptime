import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";

export interface ComponentProps {
  icon?: IconProp | undefined;
  text: string;
  onClick: () => void;
  rightElement?: Array<ReactElement> | ReactElement | undefined;
  className?: string | undefined;
  iconClassName?: string | undefined;
  isDisabled?: boolean | undefined;
  /*
   * Shown on hover - the place a locked menu item says why it is locked.
   */
  tooltip?: string | undefined;
}

const MoreMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isDisabled: boolean = Boolean(props.isDisabled);

  const menuItem: ReactElement = (
    /*
     * A button shrink-wraps its content whatever its display type, so the width
     * has to be set explicitly or the hover background stops at the end of the
     * label instead of spanning the menu. 100% less the mx-1 on either side.
     */
    <button
      type="button"
      className={`group mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors duration-100 enabled:cursor-pointer enabled:hover:bg-indigo-50 enabled:hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 ${
        isDisabled && props.tooltip ? "pointer-events-none " : ""
      }${props.className || ""}`}
      role="menuitem"
      tabIndex={-1}
      disabled={isDisabled}
      aria-disabled={isDisabled}
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

  if (!props.tooltip) {
    return menuItem;
  }

  /*
   * A disabled control dispatches no pointer events, so the tooltip has to
   * hang off a wrapper that still receives them. Matches what Button does for
   * the same reason - but tabIndex stays -1 here, because MoreMenu drives
   * focus itself with a roving tabindex and a tabbable wrapper would add a
   * stop it does not know about.
   */
  if (isDisabled) {
    return (
      <Tooltip text={props.tooltip}>
        <span className="flex w-full" tabIndex={-1}>
          {menuItem}
        </span>
      </Tooltip>
    );
  }

  return <Tooltip text={props.tooltip}>{menuItem}</Tooltip>;
};

export default MoreMenuItem;
