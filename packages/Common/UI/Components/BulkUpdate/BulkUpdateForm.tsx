import { GetReactElementFunction } from "../../Types/FunctionTypes";
import { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import ConfirmModal, {
  ComponentProps as ConfirmModalProps,
} from "../Modal/ConfirmModal";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import MoreMenuDivider from "../MoreMenu/Divider";
import ProgressBar, { ProgressBarSize } from "../ProgressBar/ProgressBar";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import { Green, Red } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import {
  PluralTemplate,
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement } from "react";

/*
 * The bulk-action bar's sentences. The labels are the table's English nouns,
 * translated with the sentence; the count picks the language's plural form.
 */
export const BULK_SELECTED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} Selected",
  other: "{{count}} {{itemsName}} Selected",
};

export const BULK_SUCCEEDED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} succeeded",
  other: "{{count}} {{itemsName}} succeeded",
};

export const BULK_FAILED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} failed",
  other: "{{count}} {{itemsName}} failed",
};

export const BULK_SELECTION_LIMIT: PluralTemplate = {
  one: "Selected {{selected}} of {{count}} matching {{itemName}}. You can only select {{limit}} {{itemsName}} at a time, for performance reasons, so bulk actions will apply to the selected {{selected}} only.",
  other:
    "Selected {{selected}} of {{count}} matching {{itemsName}}. You can only select {{limit}} {{itemsName}} at a time, for performance reasons, so bulk actions will apply to the selected {{selected}} only.",
};

export interface BulkActionFailed<T extends GenericObject> {
  failedMessage: string | ReactElement;
  item: T;
}

export interface ProgressInfo<T extends GenericObject> {
  inProgressItems: Array<T>;
  successItems: Array<T>;
  failed: Array<BulkActionFailed<T>>;
  totalItems: Array<T>;
}

export type OnProgressInfoFunction<T extends GenericObject> = (
  progressInfo: ProgressInfo<T>,
) => void;

export type OnBulkActionStart = () => void;
export type OnBulkActionEnd = () => void;

export interface BulkActionOnClickProps<T extends GenericObject> {
  items: Array<T>;
  onProgressInfo: OnProgressInfoFunction<T>;
  onBulkActionStart: OnBulkActionStart;
  onBulkActionEnd: OnBulkActionEnd;
}

export interface BulkActionButtonSchema<T extends GenericObject> {
  title: string;
  /*
   * Required: every item in the Bulk Actions menu has an icon, as every item
   * in a row's ⋯ menu does (see ActionButtonSchema).
   */
  icon: IconProp;
  buttonStyleType: ButtonStyleType;
  isLoading?: boolean | undefined;
  isVisible?: (items: Array<T>) => boolean | undefined;
  className?: string | undefined;
  onClick: (props: BulkActionOnClickProps<T>) => Promise<void>;
  disabled?: boolean | undefined;
  /* Why the action is unavailable - shown on hover of the locked menu item. */
  tooltip?: string | undefined;
  shortcutKey?: undefined | ShortcutKey;
  confirmMessage?: ((items: Array<T>) => string) | undefined;
  confirmTitle?: ((items: Array<T>) => string) | undefined;
  /*
   * Drawn under confirmMessage: which records the action is about to touch,
   * where the count alone does not say (DeleteItemNames lists them).
   */
  confirmDetails?: ((items: Array<T>) => ReactElement | undefined) | undefined;
  confirmButtonStyleType?: ButtonStyleType;
}

export interface ComponentProps<T extends GenericObject> {
  selectedItems: Array<T>;
  isAllItemsSelected: boolean;
  onSelectAllClick: () => void;
  singularLabel: string;
  pluralLabel: string;
  onClearSelectionClick: () => void;
  buttons: Array<BulkActionButtonSchema<T>>;
  onActionStart?: (() => void) | undefined;
  onActionEnd?: (() => void) | undefined;
  itemToString?: ((item: T) => string) | undefined;
  /*
   * Selecting everything is a multi-request fetch that can fail. Surfacing it
   * here - next to the button the user pressed - keeps the message alive; the
   * table body's own error is wiped by the next refresh.
   */
  errorMessage?: string | undefined;
  isSelectingAllItems?: boolean | undefined;
  /*
   * Set when the selection hit the per-selection ceiling and there are more
   * matching rows than were selected. `totalMatchingItemsCount` is how many
   * rows actually matched, so the warning can name real numbers instead of
   * inferring truncation from the selected count.
   */
  isSelectionTruncated?: boolean | undefined;
  totalMatchingItemsCount?: number | undefined;
}

const isDangerStyle: (style: ButtonStyleType) => boolean = (
  style: ButtonStyleType,
): boolean => {
  return (
    style === ButtonStyleType.DANGER ||
    style === ButtonStyleType.DANGER_OUTLINE ||
    style === ButtonStyleType.HOVER_DANGER_OUTLINE
  );
};

const BulkUpdateForm: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();
  // The bar writes the table's labels as given: "2 Monitors succeeded".
  const itemTerm: TranslatableTerm = translatableTerm(props.singularLabel);
  const itemsTerm: TranslatableTerm = translatableTerm(props.pluralLabel);
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [confirmModalProps, setConfirmModalProps] =
    React.useState<ConfirmModalProps | null>(null);

  const [progressInfo, setProgressInfo] =
    React.useState<ProgressInfo<T> | null>(null);
  const [showProgressInfoModal, setShowProgressInfoModal] =
    React.useState<boolean>(false);

  const [actionInProgress, setActionInProgress] =
    React.useState<boolean>(false);

  if (props.selectedItems.length === 0) {
    return <></>;
  }

  const visibleButtons: Array<BulkActionButtonSchema<T>> = (
    props.buttons || []
  ).filter((button: BulkActionButtonSchema<T>) => {
    if (button.isVisible) {
      return button.isVisible(props.selectedItems) !== false;
    }
    return true;
  });

  const safeButtons: Array<BulkActionButtonSchema<T>> = visibleButtons.filter(
    (b: BulkActionButtonSchema<T>) => {
      return !isDangerStyle(b.buttonStyleType);
    },
  );

  const dangerButtons: Array<BulkActionButtonSchema<T>> = visibleButtons.filter(
    (b: BulkActionButtonSchema<T>) => {
      return isDangerStyle(b.buttonStyleType);
    },
  );

  const triggerButtonClick: (button: BulkActionButtonSchema<T>) => void = (
    button: BulkActionButtonSchema<T>,
  ): void => {
    if (button.disabled) {
      return;
    }

    const buttonClickObject: BulkActionOnClickProps<T> = {
      items: props.selectedItems,
      onProgressInfo: (info: ProgressInfo<T>) => {
        setProgressInfo(info);
      },
      onBulkActionStart: () => {
        setShowProgressInfoModal(true);
        setProgressInfo({
          inProgressItems: props.selectedItems,
          successItems: [],
          failed: [],
          totalItems: props.selectedItems,
        });
        setActionInProgress(true);
        if (props.onActionStart) {
          props.onActionStart();
        }
      },
      onBulkActionEnd: () => {
        setActionInProgress(false);
      },
    };

    if (button.confirmMessage) {
      setConfirmModalProps({
        title: button.confirmTitle
          ? button.confirmTitle(props.selectedItems)
          : tx("Confirm"),
        description: button.confirmMessage(props.selectedItems),
        children: button.confirmDetails?.(props.selectedItems),
        submitButtonType: button.confirmButtonStyleType,
        submitButtonText: button.title,
        onClose: () => {
          setConfirmModalProps(null);
        },
        onSubmit: async () => {
          await button.onClick(buttonClickObject);
        },
      });
      return;
    }

    if (button.onClick) {
      void button.onClick(buttonClickObject);
    }
  };

  const renderMenuItem: (
    button: BulkActionButtonSchema<T>,
    index: number,
  ) => ReactElement = (
    button: BulkActionButtonSchema<T>,
    index: number,
  ): ReactElement => {
    const isDanger: boolean = isDangerStyle(button.buttonStyleType);
    const isDisabled: boolean = Boolean(button.disabled);

    let itemClassName: string = "";
    let iconClassName: string = "";

    if (!isDisabled && isDanger) {
      itemClassName = "text-red-700 hover:text-red-800 hover:bg-red-50";
      iconClassName = "text-red-400 group-hover:text-red-500";
    }

    return (
      <MoreMenuItem
        key={`bulk-action-${index}`}
        text={button.title}
        icon={button.icon}
        className={itemClassName}
        iconClassName={iconClassName}
        isDisabled={isDisabled}
        tooltip={button.tooltip}
        onClick={() => {
          triggerButtonClick(button);
        }}
      />
    );
  };

  const showProgressInfo: GetReactElementFunction = (): ReactElement => {
    if (actionInProgress && progressInfo) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            {tx(
              "Please wait while the bulk action is being performed. This may take a moment.",
            )}
          </p>
          <ProgressBar
            count={
              progressInfo.successItems.length + progressInfo.failed.length
            }
            totalCount={progressInfo.totalItems.length}
            suffix={props.pluralLabel}
            size={ProgressBarSize.Small}
          />
        </div>
      );
    }

    if (!actionInProgress && progressInfo) {
      const hasFailures: boolean = progressInfo.failed.length > 0;
      const hasSuccesses: boolean = progressInfo.successItems.length > 0;

      return (
        <div className="space-y-4">
          {/* Summary counts */}
          <div className="flex flex-col space-y-3">
            {hasSuccesses && (
              <div className="flex items-center rounded-lg bg-green-50 p-3">
                <Icon
                  className="h-5 w-5 flex-shrink-0"
                  icon={IconProp.CheckCircle}
                  color={Green}
                />
                <div className="ml-2 text-sm font-medium text-green-800">
                  {translator.translatePlural(
                    BULK_SUCCEEDED_COUNT,
                    progressInfo.successItems.length,
                    {
                      count: String(progressInfo.successItems.length),
                      itemName: itemTerm,
                      itemsName: itemsTerm,
                    },
                  )}
                </div>
              </div>
            )}
            {hasFailures && (
              <div className="flex items-center rounded-lg bg-red-50 p-3">
                <Icon
                  className="h-5 w-5 flex-shrink-0"
                  icon={IconProp.Close}
                  color={Red}
                />
                <div className="ml-2 text-sm font-medium text-red-800">
                  {translator.translatePlural(
                    BULK_FAILED_COUNT,
                    progressInfo.failed.length,
                    {
                      count: String(progressInfo.failed.length),
                      itemName: itemTerm,
                      itemsName: itemsTerm,
                    },
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Failure details */}
          {hasFailures && (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-200">
                {progressInfo.failed.map(
                  (failedItem: BulkActionFailed<T>, i: number) => {
                    const itemName: string = props.itemToString
                      ? props.itemToString(failedItem.item)
                      : "";

                    return (
                      <div className="px-4 py-3 text-sm" key={i}>
                        {itemName && (
                          <div className="font-medium text-gray-900">
                            {itemName}
                          </div>
                        )}
                        <div className="text-gray-500 mt-0.5">
                          {failedItem.failedMessage}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    return <></>;
  };

  const menuChildren: Array<ReactElement> = [];

  safeButtons.forEach((button: BulkActionButtonSchema<T>, index: number) => {
    menuChildren.push(renderMenuItem(button, index));
  });

  if (safeButtons.length > 0 && dangerButtons.length > 0) {
    menuChildren.push(<MoreMenuDivider key="bulk-action-divider" />);
  }

  dangerButtons.forEach((button: BulkActionButtonSchema<T>, index: number) => {
    menuChildren.push(renderMenuItem(button, safeButtons.length + index));
  });

  /*
   * Driven by what the fetch actually reported rather than by
   * `selectedItems.length === LIMIT_PER_PROJECT`, which both cried wolf on a
   * project holding exactly the ceiling and stayed silent whenever a partial
   * selection came back one row short of it.
   */
  const showLimitWarning: boolean = Boolean(props.isSelectionTruncated);

  const totalMatchingItemsCount: number =
    props.totalMatchingItemsCount || props.selectedItems.length;

  return (
    <div>
      <div>
        <div className="mt-5 mb-5 bg-gray-50 rounded-xl p-4 border-2 border-gray-100">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/** Selected Count Badge */}
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 border border-indigo-100">
                <Icon
                  icon={IconProp.CheckCircle}
                  className="h-4 w-4 text-indigo-600"
                />
                <span>
                  {/*
                   * The singular when there is one of them. The badge is the
                   * one sentence in this bar that is always on screen, and
                   * "1 resources Selected" reads as a bug in the count.
                   */}
                  {translator.translatePlural(
                    BULK_SELECTED_COUNT,
                    props.selectedItems.length,
                    {
                      count: String(props.selectedItems.length),
                      itemName: itemTerm,
                      itemsName: itemsTerm,
                    },
                  )}
                </span>
              </div>

              {/** Divider */}
              <div className="h-6 w-px bg-gray-300 mx-1" />

              {/** Select All Button */}
              {!props.isAllItemsSelected && (
                <button
                  type="button"
                  disabled={props.isSelectingAllItems}
                  onClick={() => {
                    if (props.isSelectingAllItems) {
                      // the fetch is paged, so it must not be re-entrant.
                      return;
                    }
                    props.onSelectAllClick();
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-150 select-none ${
                    props.isSelectingAllItems
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700"
                  }`}
                >
                  <Icon
                    icon={
                      props.isSelectingAllItems
                        ? IconProp.Spinner
                        : IconProp.CheckCircle
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span>
                    {translator.translateTemplate(
                      props.isSelectingAllItems
                        ? "Selecting All {{itemsName}}..."
                        : "Select All {{itemsName}}",
                      { itemsName: itemsTerm },
                    )}
                  </span>
                </button>
              )}

              {/** Clear Selection Button */}
              <button
                type="button"
                onClick={() => {
                  props.onClearSelectionClick();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-red-50 hover:border-red-300 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-150 cursor-pointer select-none"
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                <span>{tx("Clear Selection")}</span>
              </button>
            </div>

            <div className="flex items-center">
              {menuChildren.length > 0 && (
                <MoreMenu
                  elementToBeShownInsteadOfButton={
                    <div className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-150 cursor-pointer select-none">
                      <Icon
                        icon={IconProp.Bolt}
                        className="h-4 w-4 text-gray-500"
                      />
                      <span>{tx("Bulk Actions")}</span>
                      <Icon
                        icon={IconProp.ChevronDown}
                        className="h-3.5 w-3.5 text-gray-400 ml-0.5"
                      />
                    </div>
                  }
                >
                  {menuChildren}
                </MoreMenu>
              )}
            </div>
          </div>

          {showLimitWarning && (
            <div className="mt-2 text-xs text-gray-500">
              {translator.translatePlural(
                BULK_SELECTION_LIMIT,
                totalMatchingItemsCount,
                {
                  selected: translator.formatNumber(props.selectedItems.length),
                  limit: translator.formatNumber(LIMIT_PER_PROJECT),
                  itemName: itemTerm,
                  itemsName: itemsTerm,
                },
              )}
            </div>
          )}

          {props.errorMessage && (
            <div
              role="alert"
              className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {props.errorMessage}
            </div>
          )}
        </div>
      </div>

      {confirmModalProps && (
        <ConfirmModal
          {...confirmModalProps}
          onSubmit={() => {
            confirmModalProps.onSubmit();
            setConfirmModalProps(null);
          }}
        />
      )}

      {showProgressInfoModal && progressInfo && (
        <ConfirmModal
          title={actionInProgress ? "In Progress" : "Completed"}
          description={<div>{showProgressInfo()}</div>}
          submitButtonType={ButtonStyleType.NORMAL}
          disableSubmitButton={actionInProgress}
          submitButtonText="Close"
          onSubmit={() => {
            setShowProgressInfoModal(false);
            if (props.onActionEnd) {
              props.onActionEnd();
            }
          }}
        />
      )}
    </div>
  );
};

export default BulkUpdateForm;
