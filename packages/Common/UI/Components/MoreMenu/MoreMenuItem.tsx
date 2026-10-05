import React, { FunctionComponent, ReactElement, useId } from "react";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import useTranslateValue from "../../Utils/Translation";

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
  /*
   * A dot of this colour in the icon's place, for an item that picks a state,
   * a severity or a monitor status: "Change state to" shows each state's
   * colour the way the state dropdowns do. An icon, when given, wins.
   */
  color?: Color | string | undefined;
  /*
   * A mark in the icon's place, coloured like an icon, for an item whose
   * button draws one that is not an icon: the H1 of a text editor's Heading
   * 1. An icon, when given, wins.
   */
  iconElement?: ReactElement | undefined;
  /*
   * For an item that is one choice of several - a feed's sort order. Set to
   * true or false, the item is a menuitemradio whose aria-checked says which
   * choice is in use, so a screen reader hears what the tick on it shows.
   * The tick itself is still the caller's icon, with isIconSpaceReserved
   * keeping the other choices' labels in line. Left unset, the item is an
   * ordinary menuitem.
   */
  isChecked?: boolean | undefined;
  dataTestId?: string | undefined;
}

const MoreMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const isDisabled: boolean = Boolean(props.isDisabled);
  const isDestructive: boolean = Boolean(props.isDestructive);
  const reasonId: string = useId();

  /*
   * A locked item that says why it is locked stays reachable. Table rows now
   * keep their permission-locked actions in the ⋯ menu ("You need the Delete
   * permission"), and a natively disabled button can neither take focus nor
   * show a tooltip on focus - so the explanation would exist for the mouse
   * only. Such an item is aria-disabled instead: MoreMenu's roving focus
   * lands on it, the reason is announced through aria-describedby and shown
   * by the tooltip, and activating it does nothing. A locked item with nothing
   * to say stays natively disabled and is skipped, as before.
   */
  const isExplainedLock: boolean = isDisabled && Boolean(props.tooltip);

  const dotColor: string | undefined =
    props.color?.toString().trim() || undefined;

  const colorClassName: string = isDestructive
    ? "text-red-600"
    : "text-gray-700";

  /*
   * Keyboard focus gets the same highlight as the pointer's hover, so an item
   * reached with the arrow keys looks exactly as active as one under the mouse.
   */
  const stateClassName: string = isDisabled
    ? "cursor-not-allowed opacity-50 focus-visible:outline-none focus-visible:bg-gray-100"
    : isDestructive
      ? "cursor-pointer hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:bg-red-50 focus-visible:text-red-700"
      : "cursor-pointer hover:bg-indigo-50 hover:text-gray-900 focus-visible:outline-none focus-visible:bg-indigo-50 focus-visible:text-gray-900";

  const menuItem: ReactElement = (
    /*
     * A button shrink-wraps its content whatever its display type, so the width
     * has to be set explicitly or the hover background stops at the end of the
     * label instead of spanning the menu. 100% less the mx-1 on either side.
     */
    <button
      type="button"
      className={`group mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-3 py-2 text-left text-sm transition-colors duration-100 ${colorClassName} ${stateClassName} ${
        props.className || ""
      }`}
      role={props.isChecked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={props.isChecked}
      tabIndex={-1}
      disabled={isDisabled && !isExplainedLock}
      aria-disabled={isDisabled}
      aria-describedby={isExplainedLock ? reasonId : undefined}
      data-focusable-when-disabled={isExplainedLock ? "true" : undefined}
      data-testid={props.dataTestId}
      onClick={() => {
        if (isDisabled) {
          return;
        }

        props.onClick();
      }}
    >
      {props.icon && (
        <Icon
          icon={props.icon}
          className={`mr-2.5 h-4 w-4 shrink-0 transition-colors duration-100 ${
            isDestructive
              ? `text-red-500 ${isDisabled ? "" : "group-hover:text-red-600"}`
              : `text-gray-400 ${isDisabled ? "" : "group-hover:text-indigo-500"}`
          } ${props.iconClassName || ""}`}
        />
      )}
      {!props.icon && props.iconElement && (
        <span
          className={`mr-2.5 flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-100 ${
            isDestructive
              ? `text-red-500 ${isDisabled ? "" : "group-hover:text-red-600"}`
              : `text-gray-400 ${isDisabled ? "" : "group-hover:text-indigo-500"}`
          }`}
          aria-hidden="true"
          data-testid="more-menu-item-mark"
        >
          {props.iconElement}
        </span>
      )}
      {!props.icon && !props.iconElement && dotColor && (
        <span
          className="mr-2.5 flex h-4 w-4 shrink-0 items-center justify-center"
          aria-hidden="true"
          data-testid="more-menu-item-color"
        >
          <span
            className="h-2.5 w-2.5 rounded-full border border-gray-200"
            style={{ backgroundColor: dotColor }}
          ></span>
        </span>
      )}
      {!props.icon &&
        !props.iconElement &&
        !dotColor &&
        props.isIconSpaceReserved && (
          <span className="mr-2.5 h-4 w-4 shrink-0" aria-hidden="true"></span>
        )}
      <div className="flex w-full justify-between items-center">
        <div className="font-medium">
          {translateString(props.text) ?? props.text}
        </div>
        <div>{props.rightElement}</div>
      </div>
    </button>
  );

  if (!props.tooltip) {
    return menuItem;
  }

  if (isExplainedLock) {
    /*
     * The reason sits outside the button so it describes the item without
     * becoming part of its name - the item is still "Delete", not "Delete You
     * do not have permission to delete this Monitor.".
     */
    return (
      <>
        <Tooltip text={props.tooltip} isTriggerAlreadyDescribed={true}>
          {menuItem}
        </Tooltip>
        <span id={reasonId} className="sr-only">
          {translateString(props.tooltip) ?? props.tooltip}
        </span>
      </>
    );
  }

  return <Tooltip text={props.tooltip}>{menuItem}</Tooltip>;
};

export default MoreMenuItem;
