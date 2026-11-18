import ActionButtonSchema, {
  RowActionConfirmation,
} from "./ActionButtonSchema";
import { startsNewMenuGroup } from "./ActionMenuGroup";
import RowActionDialogs from "./RowActionDialogs";
import RowActionsStore, { RowActionOpener } from "./RowActionsStore";
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
import MoreMenu from "../MoreMenu/MoreMenu";
import { getMoreMenuBareTriggerClassName } from "../MoreMenu/MoreMenuTriggerStyle";
import MoreMenuDivider from "../MoreMenu/Divider";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  ReactElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * The actions of one row - a table row, a list card: one button, and a ⋯ menu
 * holding everything else. SplitActionButtons decides which action is which,
 * and whether it is locked on this row; this only draws the result.
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
  /*
   * Where what these actions open - an action's question, an error, the ⋯
   * menu - is kept: by the table the row is in (RowActionsStore), under
   * this key, and the table draws the dialogs, outside its rows. A table
   * draws every row again as it changes how it fits (rows, folded, cards),
   * and a row that kept them itself lost them then (#9513). Without both,
   * the row keeps its own, as a List's card does.
   */
  store?: RowActionsStore<T> | undefined;
  rowKey?: string | undefined;
}

// The key a row's actions keep their own store under: the only row in it.
const OWN_ROW_KEY: string = "row";

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
  const translator: Translator = useTranslator();

  /*
   * What these actions have open - an action's question, an error, the ⋯
   * menu - and which of them are running: kept by the table the row is in,
   * or by the row itself, in a store of its own (RowActionsStore), whose
   * dialogs it then draws (RowActionDialogs).
   */
  const [ownStore] = useState<RowActionsStore<T>>(() => {
    return new RowActionsStore<T>();
  });

  const isKeptByTable: boolean = Boolean(
    props.store && props.rowKey !== undefined,
  );
  const store: RowActionsStore<T> =
    isKeptByTable && props.store ? props.store : ownStore;
  const rowKey: string =
    isKeptByTable && props.rowKey !== undefined ? props.rowKey : OWN_ROW_KEY;

  /*
   * Which actions are mid-flight, by their index in props.actionButtons:
   * read whenever the row renders but never a reason of its own to render
   * it, as the rows always have. Plenty of action handlers navigate away or
   * open a modal without ever calling onCompleteAction, and a spinner that
   * forced its own render would spin on those forever. Kept with the rest,
   * so a row drawn again by a change of fit still shows an action running.
   */
  const loadingActionIndexes: Array<boolean> =
    store.getLoadingActionIndexes(rowKey);

  // The row's button's box, and its ⋯: what a dialog gives the focus back to.
  const rowButtonBoxRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const moreButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  /*
   * Focuses what opened a dialog - the row's button, or its ⋯ - or the
   * other when the row no longer draws it (a phone's card leaves out the
   * actions marked hideOnMobile).
   */
  const focusOpener: (openedFrom: RowActionOpener) => boolean = useCallback(
    (openedFrom: RowActionOpener): boolean => {
      const rowButton: HTMLButtonElement | null =
        rowButtonBoxRef.current?.querySelector("button") || null;
      const moreButton: HTMLButtonElement | null = moreButtonRef.current;
      const target: HTMLElement | null =
        openedFrom === RowActionOpener.Menu
          ? moreButton || rowButton
          : rowButton || moreButton;

      if (!target || !target.isConnected) {
        return false;
      }

      target.focus();

      return true;
    },
    [],
  );

  /*
   * Drawn: the store knows the row is, and how to give the focus back to
   * it. A layout effect, so that a row drawn again by a change of fit
   * says so in the commit that takes the old one away (RowActionsStore).
   */
  useLayoutEffect(() => {
    return store.drawRow(rowKey, focusOpener);
  }, [store, rowKey, focusOpener]);

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

  /*
   * A ⋯ menu this row does not draw now - every action it held left out,
   * as a phone's card leaves out those marked hideOnMobile - is closed: it
   * does not open by itself when the row draws one again.
   */
  const hasMoreMenu: boolean = moreMenu.length > 0;

  useLayoutEffect(() => {
    if (!hasMoreMenu) {
      store.setMenuOpen(rowKey, false);
    }
  }, [hasMoreMenu, store, rowKey]);

  // The row's own dialogs, when no table keeps them.
  const ownDialogs: ReactElement | null = isKeptByTable ? null : (
    <RowActionDialogs<T> store={ownStore} />
  );

  if (!primary && !hasMoreMenu) {
    return <>{ownDialogs}</>;
  }

  type RunActionFunction = (
    entry: IndexedActionButton<T>,
    openedFrom: RowActionOpener,
  ) => void;

  /*
   * An action that asks first opens its question; any other runs at once.
   * A locked action does neither.
   */
  const runAction: RunActionFunction = (
    entry: IndexedActionButton<T>,
    openedFrom: RowActionOpener,
  ): void => {
    const { button, index } = entry;

    if (getActionButtonLock(button, props.item).isDisabled || !button.onClick) {
      return;
    }

    const confirmation: RowActionConfirmation | undefined =
      button.getConfirmation?.(props.item);

    /*
     * Asked about this row as it is now, and answered on it: the question
     * holds the row it names (RowActionDialogs).
     */
    if (confirmation) {
      store.openQuestion({
        rowKey: rowKey,
        item: props.item,
        action: entry,
        confirmation: confirmation,
        openedFrom: openedFrom,
      });
      return;
    }

    loadingActionIndexes[index] = true;

    button.onClick(
      props.item,
      () => {
        loadingActionIndexes[index] = false;
      },
      (err: Error) => {
        loadingActionIndexes[index] = false;

        // An error with no words opens nothing, as it never has.
        const message: string = (err as Error).message;

        if (message) {
          store.openError({
            rowKey: rowKey,
            message: message,
            openedFrom: openedFrom,
          });
        }
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
        // Both translated above: drawn as given, never looked up again.
        text={title}
        isUserContent={true}
        icon={entry.button.icon}
        isDestructive={isDestructive}
        isDisabled={lock.isDisabled}
        tooltip={translateString(lock.tooltip)}
        isTooltipTranslated={true}
        onClick={() => {
          runAction(entry, RowActionOpener.Menu);
        }}
      />,
    );
  });

  return (
    <div
      /* The gap spaces the buttons: a Button has no margin of its own. */
      className={`flex items-center gap-2 ${props.className || "justify-end"}`}
      data-testid="row-actions"
    >
      {ownDialogs}

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
        <div className="shrink-0" ref={rowButtonBoxRef}>
          <Button
            buttonSize={ButtonSize.Small}
            title={
              isPrimaryShortened
                ? primary.button.rowButtonTitle
                : primary.button.title
            }
            ariaLabel={isPrimaryShortened ? primary.button.title : undefined}
            buttonStyle={getRowButtonStyle(primary.button.buttonStyleType)}
            isLoading={loadingActionIndexes[primary.index]}
            disabled={primaryLock?.isDisabled}
            tooltip={primaryLock?.tooltip}
            onClick={() => {
              runAction(primary, RowActionOpener.Button);
            }}
          />
        </div>
      )}

      {menuItems.length > 0 && (
        <MoreMenu
          isMenuPortaled={true}
          /*
           * Open again on this row when the table draws it again with its
           * menu open - a change of how the table fits (RowActionsStore).
           */
          isInitiallyOpen={store.isMenuOpen(rowKey)}
          onOpenChange={(isOpen: boolean) => {
            store.setMenuOpen(rowKey, isOpen);
          }}
          /*
           * One sentence around the row's name, in the reader's words and
           * their order here - Japanese puts the name first - never English's
           * order with the name tacked on (#8076); without a name, English,
           * for the menu to look up (#7790).
           */
          ariaLabel={
            props.itemLabel
              ? translator.translateTemplate("More actions for {{name}}", {
                  name: props.itemLabel,
                })
              : "More actions"
          }
          isAriaLabelTranslated={Boolean(props.itemLabel)}
          elementToBeShownInsteadOfButton={
            <button
              ref={moreButtonRef}
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
