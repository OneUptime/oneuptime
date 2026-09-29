import ActionButtonSchema from "./ActionButtonSchema";
import splitActionButtons, {
  IndexedActionButton,
  isDestructiveActionButton,
  SplitActionButtonsResult,
} from "./SplitActionButtons";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuDivider from "../MoreMenu/Divider";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { ReactElement, useRef, useState } from "react";

/*
 * The actions of one row - a table row, a list card, a state in an ordered
 * list: one button, and a ⋯ menu holding everything else. SplitActionButtons
 * decides which action is which; this only draws the result.
 */

export interface ComponentProps<T extends GenericObject> {
  item: T;
  actionButtons?: Array<ActionButtonSchema<T>> | undefined;
  isMobile?: boolean | undefined;
  /*
   * Alignment of the button and the menu trigger. Rows right-align their
   * actions (the default); a centred card can centre them.
   */
  className?: string | undefined;
  /*
   * What this row is, for the ⋯ trigger's accessible name - "More actions for
   * Monitor: Checkout API" rather than twenty-five identical "More actions" in
   * a screen reader's list of buttons.
   */
  itemLabel?: string | undefined;
}

/*
 * OUTLINE and its hover variants are drawn by a `btn-outline-secondary` class
 * that no stylesheet defines, so they render as bare text. That was tolerable
 * in a strip of buttons; as the row's one button, sat beside a bordered ⋯, it
 * reads as a stray label. The row's button always looks like a button.
 */
const getRowButtonStyle: (style: ButtonStyleType) => ButtonStyleType = (
  style: ButtonStyleType,
): ButtonStyleType => {
  switch (style) {
    case ButtonStyleType.OUTLINE:
    case ButtonStyleType.HOVER_PRIMARY_OUTLINE:
    case ButtonStyleType.HOVER_SUCCESS_OUTLINE:
      return ButtonStyleType.NORMAL;
    case ButtonStyleType.HOVER_DANGER_OUTLINE:
      return ButtonStyleType.DANGER_OUTLINE;
    default:
      return style;
  }
};

type RowActionsFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const RowActions: RowActionsFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [error, setError] = useState<string>("");

  /*
   * Which actions are mid-flight, by their index in props.actionButtons. Held
   * in a ref, as the rows always have: it is read whenever the row renders but
   * never forces a render of its own. Plenty of action handlers navigate away
   * or open a modal without ever calling onCompleteAction, and a spinner that
   * forced its own render would spin on those forever.
   */
  const loadingActionIndexes: React.MutableRefObject<Array<boolean>> = useRef<
    Array<boolean>
  >([]);

  const { primary, moreMenu }: SplitActionButtonsResult<T> =
    splitActionButtons<T>({
      actionButtons: props.actionButtons,
      item: props.item,
      isMobile: props.isMobile,
    });

  if (!primary && moreMenu.length === 0 && !error) {
    return <></>;
  }

  type RunActionFunction = (entry: IndexedActionButton<T>) => void;

  const runAction: RunActionFunction = (
    entry: IndexedActionButton<T>,
  ): void => {
    const { button, index } = entry;

    if (button.disabled || !button.onClick) {
      return;
    }

    loadingActionIndexes.current[index] = true;

    button.onClick(
      props.item,
      () => {
        loadingActionIndexes.current[index] = false;
      },
      (err: Error) => {
        loadingActionIndexes.current[index] = false;
        setError((err as Error).message);
      },
    );
  };

  const hasMenuIcons: boolean = moreMenu.some(
    (entry: IndexedActionButton<T>) => {
      return Boolean(entry.button.icon);
    },
  );

  const menuItems: Array<ReactElement> = [];

  moreMenu.forEach((entry: IndexedActionButton<T>, position: number) => {
    const isDestructive: boolean = isDestructiveActionButton(entry.button);
    const previous: IndexedActionButton<T> | undefined = moreMenu[position - 1];

    // A gap between the everyday actions and the destructive ones below them.
    if (
      isDestructive &&
      previous &&
      !isDestructiveActionButton(previous.button)
    ) {
      menuItems.push(<MoreMenuDivider key={`divider-${entry.index}`} />);
    }

    const title: string =
      translateString(entry.button.title) || entry.button.title;

    menuItems.push(
      <MoreMenuItem
        key={`action-${entry.index}`}
        text={title}
        icon={entry.button.icon}
        isIconSpaceReserved={hasMenuIcons}
        isDestructive={isDestructive}
        isDisabled={entry.button.disabled}
        tooltip={translateString(entry.button.tooltip)}
        onClick={() => {
          runAction(entry);
        }}
      />,
    );
  });

  return (
    <div
      /*
       * Button carries an md:ml-3 of its own, meant for a row of loose
       * buttons. Here the gap does the spacing, and the stray margin would
       * push a centred group off centre.
       */
      className={`flex items-center gap-2 [&_button]:md:ml-0 ${
        props.className || "justify-end"
      }`}
      data-testid="row-actions"
    >
      {error && (
        <div className="text-align-left">
          <ConfirmModal
            title={`Error`}
            description={error}
            submitButtonText={"Close"}
            onSubmit={() => {
              return setError("");
            }}
          />
        </div>
      )}

      {primary && (
        /*
         * Button is w-full below md. Its own content-sized box keeps it the
         * size of its label on every surface - a Table card, a List card and a
         * centred ordered-states item alike - instead of stretching whenever
         * the row's container happens to be a block.
         */
        <div className="shrink-0">
          <Button
            buttonSize={ButtonSize.Small}
            title={primary.button.title}
            icon={primary.button.icon}
            buttonStyle={getRowButtonStyle(primary.button.buttonStyleType)}
            isLoading={loadingActionIndexes.current[primary.index]}
            disabled={primary.button.disabled}
            tooltip={primary.button.tooltip}
            onClick={() => {
              runAction(primary);
            }}
          />
        </div>
      )}

      {menuItems.length > 0 && (
        <MoreMenu
          isMenuPortaled={true}
          ariaLabel={
            props.itemLabel
              ? `${translateString("More actions for") || "More actions for"} ${props.itemLabel}`
              : translateString("More actions") || "More actions"
          }
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              data-testid="row-actions-more-button"
              /*
               * Sized to the Small row button beside it: that button's label
               * is text-base below md and text-sm above, so the trigger's
               * vertical padding steps down at md to keep the two level.
               */
              className="inline-flex shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white px-1.5 py-1.5 md:py-1 text-gray-500 shadow-sm transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <Icon icon={IconProp.EllipsisHorizontal} className="h-5 w-5" />
            </button>
          }
        >
          {menuItems}
        </MoreMenu>
      )}
    </div>
  );
};

export default RowActions;
