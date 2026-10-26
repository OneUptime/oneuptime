import ActionButtonSchema, {
  RowActionConfirmation,
} from "./ActionButtonSchema";
import { startsNewMenuGroup } from "./ActionMenuGroup";
import { isShortTitleInName } from "../Button/ShortButtonWords";
import splitActionButtons, {
  ActionButtonLock,
  getActionButtonLock,
  IndexedActionButton,
  isDestructiveActionButton,
  SplitActionButtonsResult,
} from "./SplitActionButtons";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import MoreMenu from "../MoreMenu/MoreMenu";
import { getMoreMenuBareTriggerClassName } from "../MoreMenu/MoreMenuTriggerStyle";
import MoreMenuDivider from "../MoreMenu/Divider";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import GenericObject from "../../../Types/GenericObject";
import { VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { ReactElement, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * The actions of one row - a table row, a list card: one button, and a ⋯ menu
 * holding everything else. SplitActionButtons decides which action is which,
 * and whether it is locked on this row; this only draws the result.
 */

/*
 * Where a row's dialogs - an action's question, an error - are drawn: in
 * the page's body (or the element shown full screen, which hides everything
 * outside it), never inside the row. Drawn in the row, a dialog sat inside
 * the table's sticky Actions cell: its sentences took the cell's no-wrap and
 * ran off its right edge, the other rows' Actions cells were drawn over its
 * backdrop and could still be pressed, and a click on its text reached the
 * row, which opened the record and took the dialog away. The row's click
 * (RowClick) leaves alone a click that lands outside it, as it does for the
 * ⋯ menu, which is drawn in the body too.
 */
export const getRowDialogTarget: () => HTMLElement | null =
  (): HTMLElement | null => {
    if (typeof document === "undefined") {
      return null;
    }

    const fullscreenElement: Element | null = document.fullscreenElement;

    return fullscreenElement instanceof HTMLElement
      ? fullscreenElement
      : document.body;
  };

const drawRowDialog: (dialog: ReactElement) => ReactElement = (
  dialog: ReactElement,
): ReactElement => {
  const target: HTMLElement | null = getRowDialogTarget();

  return target ? createPortal(dialog, target) : dialog;
};

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
 * The row's one button is the plain bordered button whatever outline style
 * its action asked for - every table's row button looks the same - and a
 * destructive one (HOVER_DANGER_OUTLINE) is drawn red, as a destructive
 * action is everywhere else on its own.
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
   * The action whose question is open (getConfirmation), what it asks, and
   * whether the action it confirms is running - the dialog stays open, its
   * button busy, until the action is done, and shows in place why it could
   * not be.
   */
  const [confirming, setConfirming] = useState<{
    entry: IndexedActionButton<T>;
    confirmation: RowActionConfirmation;
  } | null>(null);
  const [isConfirmedActionRunning, setIsConfirmedActionRunning] =
    useState<boolean>(false);
  const [confirmationError, setConfirmationError] = useState<string>("");

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

  const primaryLock: ActionButtonLock | null = primary
    ? getActionButtonLock(primary.button, props.item)
    : null;

  // Its short words, while its name holds them as they are shown.
  const isPrimaryShortened: boolean = Boolean(
    primary &&
      isShortTitleInName({
        title: translateString(primary.button.title),
        shortTitle: translateString(primary.button.rowButtonTitle),
      }),
  );

  if (!primary && moreMenu.length === 0 && !error && !confirming) {
    return <></>;
  }

  type RunActionFunction = (entry: IndexedActionButton<T>) => void;

  /*
   * An action that asks first opens its question; any other runs at once.
   * A locked action does neither.
   */
  const runAction: RunActionFunction = (
    entry: IndexedActionButton<T>,
  ): void => {
    const { button, index } = entry;

    if (getActionButtonLock(button, props.item).isDisabled || !button.onClick) {
      return;
    }

    const confirmation: RowActionConfirmation | undefined =
      button.getConfirmation?.(props.item);

    if (confirmation) {
      setConfirmationError("");
      setIsConfirmedActionRunning(false);
      setConfirming({ entry: entry, confirmation: confirmation });
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

  // The question was answered yes: run the action it asked about.
  const runConfirmedAction: VoidFunction = (): void => {
    if (!confirming || isConfirmedActionRunning) {
      return;
    }

    const { button, index } = confirming.entry;

    loadingActionIndexes.current[index] = true;
    setConfirmationError("");
    setIsConfirmedActionRunning(true);

    button.onClick(
      props.item,
      () => {
        loadingActionIndexes.current[index] = false;
        setIsConfirmedActionRunning(false);
        setConfirming(null);
      },
      (err: Error) => {
        loadingActionIndexes.current[index] = false;
        setIsConfirmedActionRunning(false);
        setConfirmationError(
          (err as Error).message ||
            translateString("Something went wrong. Please try again.") ||
            "Something went wrong. Please try again.",
        );
      },
    );
  };

  const menuItems: Array<ReactElement> = [];

  moreMenu.forEach((entry: IndexedActionButton<T>, position: number) => {
    const isDestructive: boolean = isDestructiveActionButton(entry.button);
    const previous: IndexedActionButton<T> | undefined = moreMenu[position - 1];
    const isPreviousDestructive: boolean = previous
      ? isDestructiveActionButton(previous.button)
      : false;

    /*
     * A gap between the everyday actions and the destructive ones below
     * them, and between two kinds of everyday action (ActionMenuGroup):
     * Acknowledge to Change Severity, then Assign to Me and Add Owner, then
     * Show ID.
     */
    if (
      previous &&
      ((isDestructive && !isPreviousDestructive) ||
        (!isDestructive &&
          !isPreviousDestructive &&
          startsNewMenuGroup(
            previous.button.menuGroup,
            entry.button.menuGroup,
          )))
    ) {
      menuItems.push(<MoreMenuDivider key={`divider-${entry.index}`} />);
    }

    const title: string =
      translateString(entry.button.title) || entry.button.title;

    const lock: ActionButtonLock = getActionButtonLock(
      entry.button,
      props.item,
    );

    /*
     * Every action has an icon (ActionButtonSchema requires one), and the
     * menu always draws it: a list of items is read down its column of
     * icons, and an item without one looked like a missing one.
     */
    menuItems.push(
      <MoreMenuItem
        key={`action-${entry.index}`}
        text={title}
        icon={entry.button.icon}
        isDestructive={isDestructive}
        isDisabled={lock.isDisabled}
        tooltip={translateString(lock.tooltip)}
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
      {error &&
        drawRowDialog(
          <div className="text-align-left" data-testid="row-actions-dialog">
            <ConfirmModal
              title={`Error`}
              description={error}
              submitButtonText={"Close"}
              onSubmit={() => {
                return setError("");
              }}
            />
          </div>,
        )}

      {confirming &&
        drawRowDialog(
          <div className="text-align-left" data-testid="row-actions-dialog">
            <ConfirmModal
              title={confirming.confirmation.title}
              description={confirming.confirmation.description}
              submitButtonText={confirming.confirmation.submitButtonText}
              submitButtonType={confirming.confirmation.submitButtonType}
              isLoading={isConfirmedActionRunning}
              error={confirmationError || undefined}
              onClose={() => {
                // An action already running finishes either way.
                if (isConfirmedActionRunning) {
                  return;
                }

                setConfirming(null);
                setConfirmationError("");
              }}
              onSubmit={runConfirmedAction}
            >
              {confirming.confirmation.details}
            </ConfirmModal>
          </div>,
        )}

      {primary && (
        /*
         * Button is w-full below md. Its own content-sized box keeps it the
         * size of its label on every surface - a Table card and a List card
         * alike - instead of stretching whenever the row's container happens
         * to be a block.
         *
         * The row's button is its label alone. Every action has an icon for
         * the ⋯ menu, where a list of items is read down its icons; one
         * button beside the menu is read by its label, and its icon on every
         * row of a table would only repeat that label 25 times in a column.
         * It also keeps the row's button the same on every table - View and
         * Edit never drew one, a few custom actions did.
         */
        <div className="shrink-0">
          <Button
            buttonSize={ButtonSize.Small}
            title={
              isPrimaryShortened
                ? primary.button.rowButtonTitle
                : primary.button.title
            }
            ariaLabel={isPrimaryShortened ? primary.button.title : undefined}
            buttonStyle={getRowButtonStyle(primary.button.buttonStyleType)}
            isLoading={loadingActionIndexes.current[primary.index]}
            disabled={primaryLock?.isDisabled}
            tooltip={primaryLock?.tooltip}
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
              // A bare ⋯, as MoreMenu draws its own (MoreMenuTriggerStyle).
              className={getMoreMenuBareTriggerClassName(false)}
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
