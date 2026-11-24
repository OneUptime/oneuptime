import { BUTTON_DISABLED_CLASS_NAME } from "../Button/ButtonStates";
import React, { FunctionComponent, ReactElement, useId } from "react";
import { Placement } from "tippy.js";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import useTranslateValue from "../../Utils/Translation";

export interface ComponentProps {
  icon?: IconProp | undefined;
  text: string;
  /*
   * The text is a name - a state a project named itself - drawn as
   * written, never looked up (Pill.isUserContent). Left out, it is the
   * product's words, looked up in the reader's language.
   */
  isUserContent?: boolean | undefined;
  onClick: () => void;
  rightElement?: Array<ReactElement> | ReactElement | undefined;
  className?: string | undefined;
  iconClassName?: string | undefined;
  isDisabled?: boolean | undefined;
  /*
   * Shown on hover - the place a locked menu item says why it is locked.
   * English, looked up here - unless isTooltipTranslated or
   * isTooltipUserContent says otherwise.
   */
  tooltip?: string | undefined;
  /*
   * The tooltip is in the reader's words already: a permission check's
   * reason (PermissionGate words it), a sentence the page built around a
   * value. Drawn and announced as given, never looked up again (#8586):
   * looked up again, a translation that is itself an English key reads as
   * another word, as the Spanish "Red" (Network) read "Rojo".
   */
  isTooltipTranslated?: boolean | undefined;
  /*
   * The tooltip reads by the same rule as the text (isUserContent): set,
   * it is words someone wrote, drawn as given, never looked up (Tooltip's
   * isTextUserContent, #8067). Words the page put in the reader's language
   * - a permission check's reason - say isTooltipTranslated instead, which
   * the looked-up-once guard holds every caller to.
   */
  isTooltipUserContent?: boolean | undefined;
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
  /*
   * With isChecked: an item that is on or off on its own (a table's "Compact
   * rows"), a menuitemcheckbox, rather than one choice of several.
   */
  isCheckbox?: boolean | undefined;
  dataTestId?: string | undefined;
  /*
   * Actions on what the item is, beside it on its row: a saved view's
   * Rename and Delete beside the view (#6922). Each is a menu item of its
   * own, a button the arrow keys reach after the item, named for a screen
   * reader and in its tooltip - never a control inside the item's button,
   * and never an icon only a mouse can press.
   */
  actions?: Array<MoreMenuItemAction> | undefined;
}

export interface MoreMenuItemAction {
  icon: IconProp;
  /*
   * What it does, with what it does it to, in the reader's words already:
   * "Rename view Errors" (translateTemplate("Rename view {{name}}")). Said
   * by a screen reader and shown in its tooltip, as given.
   */
  label: string;
  onClick: () => void;
  // Red under the pointer and the keys, for an action that deletes.
  isDestructive?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * The row an item with actions is drawn in, and each action's button: a
 * square as tall as the item's text line, quiet until the pointer or the
 * keys reach it, 44px across under a finger.
 */
export const MORE_MENU_ITEM_ROW_CLASS_NAME: string =
  "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-0.5 rounded-md";

export const MORE_MENU_ITEM_ACTION_CLASS_NAME: string =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 focus-visible:outline-none";

/*
 * An item's tooltip opens beside the menu, not over it. Above the item, as
 * tooltips elsewhere open, a locked Delete's reason - the longest tooltips a
 * menu has - covered every item above it while it was read. The menu sits at
 * a row's or a card's right edge, so the left has the room; with none either
 * side (a phone), it opens above or below the item as before.
 */
export const MENU_ITEM_TOOLTIP_PLACEMENT: Placement = "left";

export const MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS: Array<Placement> = [
  "right",
  "top",
  "bottom",
];

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

  // Drawn as given - in the reader's words already, or words someone wrote.
  const isTooltipAsGiven: boolean = Boolean(
    props.isTooltipTranslated || props.isTooltipUserContent,
  );

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
    ? `${BUTTON_DISABLED_CLASS_NAME} focus-visible:outline-none focus-visible:bg-gray-100`
    : isDestructive
      ? "cursor-pointer hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:bg-red-50 focus-visible:text-red-700"
      : "cursor-pointer hover:bg-indigo-50 hover:text-gray-900 focus-visible:outline-none focus-visible:bg-indigo-50 focus-visible:text-gray-900";

  const actions: Array<MoreMenuItemAction> = props.actions || [];

  /*
   * A button shrink-wraps its content whatever its display type, so the width
   * has to be set explicitly or the hover background stops at the end of the
   * label instead of spanning the menu. 100% less the mx-1 on either side. With
   * actions beside it, the row takes that width and the item what the actions
   * leave.
   */
  const boxClassName: string =
    actions.length > 0 ? "min-w-0 flex-1" : "mx-1 w-[calc(100%-0.5rem)]";

  const menuItem: ReactElement = (
    <button
      type="button"
      className={`group flex ${boxClassName} items-center rounded-md px-3 py-2 text-start text-sm transition-colors duration-100 ${colorClassName} ${stateClassName} ${
        props.className || ""
      }`}
      role={
        props.isChecked === undefined
          ? "menuitem"
          : props.isCheckbox
            ? "menuitemcheckbox"
            : "menuitemradio"
      }
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
          className={`me-2.5 h-4 w-4 shrink-0 transition-colors duration-100 ${
            isDestructive
              ? `text-red-500 ${isDisabled ? "" : "group-hover:text-red-600"}`
              : `text-gray-400 ${isDisabled ? "" : "group-hover:text-indigo-500"}`
          } ${props.iconClassName || ""}`}
        />
      )}
      {!props.icon && props.iconElement && (
        <span
          className={`me-2.5 flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-100 ${
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
          className="me-2.5 flex h-4 w-4 shrink-0 items-center justify-center"
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
          <span className="me-2.5 h-4 w-4 shrink-0" aria-hidden="true"></span>
        )}
      <div className="flex w-full justify-between items-center">
        {/*
          A label longer than the menu is wide takes two even lines - "Assign
          to / Someone Else" - rather than leaving its last word alone on the
          second: the menu's width is fixed (MoreMenu's PORTALED_MENU_WIDTH).
        */}
        <div className="font-medium text-balance">
          {props.isUserContent
            ? props.text
            : translateString(props.text) ?? props.text}
        </div>
        <div>{props.rightElement}</div>
      </div>
    </button>
  );

  /*
   * A menu opened with the mouse focuses its first item, and that focus is
   * the script's, not the person's: the item's tooltip waits for the pointer
   * to reach it. Moved to with the keys, it shows at once.
   */
  let item: ReactElement = menuItem;

  if (props.tooltip && isExplainedLock) {
    /*
     * The reason sits outside the button so it describes the item without
     * becoming part of its name - the item is still "Delete", not "Delete You
     * do not have permission to delete this Monitor.".
     */
    /*
     * Pressing it - the only way to ask on a phone, where nothing hovers -
     * shows the reason and keeps it until the item is pressed again or the
     * menu closes.
     */
    item = (
      <>
        <Tooltip
          text={props.tooltip}
          isTextTranslated={props.isTooltipTranslated}
          isTextUserContent={props.isTooltipUserContent}
          isTriggerAlreadyDescribed={true}
          isShownOnKeyboardFocusOnly={true}
          isShownOnPress={true}
          placement={MENU_ITEM_TOOLTIP_PLACEMENT}
          fallbackPlacements={MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS}
        >
          {menuItem}
        </Tooltip>
        <span id={reasonId} className="sr-only">
          {isTooltipAsGiven
            ? props.tooltip
            : translateString(props.tooltip) ?? props.tooltip}
        </span>
      </>
    );
  } else if (props.tooltip) {
    item = (
      <Tooltip
        text={props.tooltip}
        isTextTranslated={props.isTooltipTranslated}
        isTextUserContent={props.isTooltipUserContent}
        isShownOnKeyboardFocusOnly={true}
        placement={MENU_ITEM_TOOLTIP_PLACEMENT}
        fallbackPlacements={MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS}
      >
        {menuItem}
      </Tooltip>
    );
  }

  if (actions.length === 0) {
    return item;
  }

  /*
   * The item and its actions side by side, each a menu item of its own:
   * the row is no control, only where they sit (role="none"), so none is
   * inside another, and the arrow keys walk from the item to each action
   * and on to the next row (MoreMenu's roving focus reads every menu item).
   */
  return (
    <div role="none" className={MORE_MENU_ITEM_ROW_CLASS_NAME}>
      {item}
      {actions.map(
        (action: MoreMenuItemAction, index: number): ReactElement => {
          return (
            <Tooltip
              key={`${action.label}-${index}`}
              text={action.label}
              isTextTranslated={true}
              isShownOnKeyboardFocusOnly={true}
              placement="top"
              fallbackPlacements={["bottom", "left"]}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-label={action.label}
                data-testid={action.dataTestId}
                className={`${MORE_MENU_ITEM_ACTION_CLASS_NAME} ${
                  action.isDestructive
                    ? "hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600"
                    : "hover:bg-indigo-50 hover:text-indigo-600 focus-visible:bg-indigo-50 focus-visible:text-indigo-600"
                }`}
                onClick={() => {
                  action.onClick();
                }}
              >
                <Icon icon={action.icon} className="h-4 w-4" />
              </button>
            </Tooltip>
          );
        },
      )}
    </div>
  );
};

export default MoreMenuItem;
