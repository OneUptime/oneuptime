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
import React, { ReactElement } from "react";

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
  icon?: undefined | IconProp;
  buttonStyleType: ButtonStyleType;
  isLoading?: boolean | undefined;
  isVisible?: (items: Array<T>) => boolean | undefined;
  className?: string | undefined;
  onClick: (props: BulkActionOnClickProps<T>) => Promise<void>;
  disabled?: boolean | undefined;
  shortcutKey?: undefined | ShortcutKey;
  confirmMessage?: ((items: Array<T>) => string) | undefined;
  confirmTitle?: ((items: Array<T>) => string) | undefined;
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
          : "Confirm",
        description: button.confirmMessage(props.selectedItems),
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

    if (isDisabled) {
      itemClassName = "opacity-50 cursor-not-allowed hover:bg-transparent";
    } else if (isDanger) {
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
            Please wait while the bulk action is being performed. This may take
            a moment.
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
                  {progressInfo.successItems.length}{" "}
                  {progressInfo.successItems.length === 1
                    ? props.singularLabel
                    : props.pluralLabel}{" "}
                  succeeded
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
                  {progressInfo.failed.length}{" "}
                  {progressInfo.failed.length === 1
                    ? props.singularLabel
                    : props.pluralLabel}{" "}
                  failed
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

  const showLimitWarning: boolean =
    props.isAllItemsSelected &&
    props.selectedItems.length === LIMIT_PER_PROJECT;

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
                  {props.selectedItems.length} {props.pluralLabel} Selected
                </span>
              </div>

              {/** Divider */}
              <div className="h-6 w-px bg-gray-300 mx-1" />

              {/** Select All Button */}
              {!props.isAllItemsSelected && (
                <button
                  type="button"
                  onClick={() => {
                    props.onSelectAllClick();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-150 cursor-pointer select-none"
                >
                  <Icon icon={IconProp.CheckCircle} className="h-3.5 w-3.5" />
                  <span>Select All {props.pluralLabel}</span>
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
                <span>Clear Selection</span>
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
                      <span>Bulk Actions</span>
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
              You can only select {LIMIT_PER_PROJECT} {props.pluralLabel} at a
              time. This is for performance reasons.
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
