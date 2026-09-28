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
  /*
   * Red text and a red hover, for the items that delete or remove something.
   * The menu is where a table puts those, so they need to read as dangerous
   * without a button border to say so.
   */
  isDestructive?: boolean | undefined;
  /*
   * Keep the icon's gutter even when this item has no icon, so its label lines
   * up with the labels of the items around it that do.
   */
  isIconSpaceReserved?: boolean | undefined;
}

const MoreMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isDisabled: boolean = Boolean(props.isDisabled);
  const isDestructive: boolean = Boolean(props.isDestructive);

  const menuItem: ReactElement = (
    /*
     * A button shrink-wraps its content whatever its display type, so the width
     * has to be set explicitly or the hover background stops at the end of the
     * label instead of spanning the menu. 100% less the mx-1 on either side.
     */
    <button
      type="button"
      className={`group mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-3 py-2 text-left text-sm transition-colors duration-100 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
        isDestructive
          ? "text-red-600 enabled:hover:bg-red-50 enabled:hover:text-red-700"
          : "text-gray-700 enabled:hover:bg-indigo-50 enabled:hover:text-gray-900"
      } ${
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
          className={`mr-2.5 h-4 w-4 shrink-0 transition-colors duration-100 ${
            isDestructive
              ? "text-red-500 group-hover:text-red-600"
              : "text-gray-400 group-hover:text-indigo-500"
          } ${props.iconClassName || ""}`}
        />
      )}
      {!props.icon && props.isIconSpaceReserved && (
        <span className="mr-2.5 h-4 w-4 shrink-0" aria-hidden="true"></span>
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
