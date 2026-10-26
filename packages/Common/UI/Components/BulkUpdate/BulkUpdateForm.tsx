import { GetReactElementFunction } from "../../Types/FunctionTypes";
import { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import ConfirmModal, {
  ComponentProps as ConfirmModalProps,
} from "../Modal/ConfirmModal";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import MoreMenuDivider from "../MoreMenu/Divider";
import { startsNewMenuGroup } from "../ActionButton/ActionMenuGroup";
import ProgressBar, { ProgressBarSize } from "../ProgressBar/ProgressBar";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import { Gray500, Green, Red } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import {
  PluralTemplate,
  TranslatableTerm,
  translatableTerm,
  translationKey,
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

/*
 * The third outcome: items an action looked at and left alone on purpose -
 * a device nothing polls, one already in the state asked for. Neither
 * "succeeded" (nothing was done) nor "failed" (nothing went wrong), so it is
 * a list of its own, each item with the reason it was left.
 */
export const BULK_UNCHANGED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} not changed",
  other: "{{count}} {{itemsName}} not changed",
};

/*
 * The fourth outcome, only when the person stopped a run: the items it never
 * reached. Nothing was done to them.
 */
export const BULK_NOT_STARTED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} not started: you stopped the action",
  other: "{{count}} {{itemsName}} not started: you stopped the action",
};

/*
 * What the progress dialog says while a run goes on. A bulk action runs in
 * this page: closing it stops the rest (the browser asks first), and a Stop
 * leaves what is done as it is.
 */
export const BULK_KEEP_PAGE_OPEN: string = translationKey(
  "Keep this page open until this finishes. You can stop at any time: what is already done stays done.",
);

export const BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE: string = translationKey(
  "Keep this page open until this finishes.",
);

export const BULK_STOPPING: string = translationKey(
  "Stopping. The ones already started are finishing.",
);

// How long a run has left, as estimateBulkTimeLeftInMs works it out.
export const BULK_TIME_LEFT_UNDER_A_MINUTE: string = translationKey(
  "Less than a minute left",
);

export const BULK_TIME_LEFT_MINUTES: PluralTemplate = {
  one: "About {{count}} minute left",
  other: "About {{count}} minutes left",
};

export const BULK_TIME_LEFT_HOURS: PluralTemplate = {
  one: "About {{count}} hour left",
  other: "About {{count}} hours left",
};

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

/*
 * The time-left line for an estimate: under a minute, whole minutes under
 * an hour, whole hours after that. Undefined for no estimate.
 */
export const getBulkTimeLeftText: (
  estimatedTimeLeftInMs: number | undefined,
  translator: Translator,
) => string | undefined = (
  estimatedTimeLeftInMs: number | undefined,
  translator: Translator,
): string | undefined => {
  if (
    estimatedTimeLeftInMs === undefined ||
    !Number.isFinite(estimatedTimeLeftInMs) ||
    estimatedTimeLeftInMs < 0
  ) {
    return undefined;
  }

  if (estimatedTimeLeftInMs < MINUTE_IN_MS) {
    return (
      translator.translateText(BULK_TIME_LEFT_UNDER_A_MINUTE) ||
      BULK_TIME_LEFT_UNDER_A_MINUTE
    );
  }

  if (estimatedTimeLeftInMs < HOUR_IN_MS) {
    const minutes: number = Math.max(
      1,
      Math.round(estimatedTimeLeftInMs / MINUTE_IN_MS),
    );

    return translator.translatePlural(BULK_TIME_LEFT_MINUTES, minutes, {
      count: translator.formatNumber(minutes),
    });
  }

  const hours: number = Math.max(
    1,
    Math.round(estimatedTimeLeftInMs / HOUR_IN_MS),
  );

  return translator.translatePlural(BULK_TIME_LEFT_HOURS, hours, {
    count: translator.formatNumber(hours),
  });
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

// An item the action left alone on purpose, and why (BULK_UNCHANGED_COUNT).
export interface BulkActionUnchanged<T extends GenericObject> {
  reason: string | ReactElement;
  item: T;
}

/*
 * The items of a result list that share one reason: their names, in the
 * order they ran, and the reason once.
 */
export interface BulkItemGroup {
  names: Array<string>;
  message: string | ReactElement;
}

/*
 * A result list's items, grouped by the reason given for them, in the order
 * each reason first came up. Reasons are compared as written - the server's
 * words - so two items refused for the same reason share a group and two
 * different refusals never do. A reason drawn as an element can't be
 * compared, and keeps a group of its own.
 */
export const groupItemsByReason: (
  entries: ReadonlyArray<{ name: string; message: string | ReactElement }>,
) => Array<BulkItemGroup> = (
  entries: ReadonlyArray<{ name: string; message: string | ReactElement }>,
): Array<BulkItemGroup> => {
  const groups: Array<BulkItemGroup> = [];
  const groupsByReason: Map<string, BulkItemGroup> = new Map();

  for (const entry of entries) {
    const names: Array<string> = entry.name ? [entry.name] : [];

    if (typeof entry.message !== "string") {
      groups.push({ names: names, message: entry.message });
      continue;
    }

    const group: BulkItemGroup | undefined = groupsByReason.get(entry.message);

    if (group) {
      group.names.push(...names);
      continue;
    }

    const newGroup: BulkItemGroup = { names: names, message: entry.message };
    groupsByReason.set(entry.message, newGroup);
    groups.push(newGroup);
  }

  return groups;
};

export interface ProgressInfo<T extends GenericObject> {
  inProgressItems: Array<T>;
  successItems: Array<T>;
  failed: Array<BulkActionFailed<T>>;
  /*
   * Optional: only an action that can leave an item alone on purpose reports
   * it. Counted towards the progress bar like the other two.
   */
  unchanged?: Array<BulkActionUnchanged<T>> | undefined;
  /*
   * Only in the last report of a run the person stopped: the items it never
   * reached (BULK_NOT_STARTED_COUNT). Nothing was done to them.
   */
  notStartedItems?: Array<T> | undefined;
  // How long the run has left, once it can tell (runBulkAction).
  estimatedTimeLeftInMs?: number | undefined;
  totalItems: Array<T>;
}

export type OnProgressInfoFunction<T extends GenericObject> = (
  progressInfo: ProgressInfo<T>,
) => void;

export interface BulkActionStartOptions {
  /*
   * Whether the run can be stopped part-way (runBulkAction): the progress
   * dialog then offers Stop, which aborts the stopSignal it handed over.
   */
  isStoppable?: boolean | undefined;
}

export type OnBulkActionStart = (
  options?: BulkActionStartOptions | undefined,
) => void;
export type OnBulkActionEnd = () => void;

export interface BulkActionOnClickProps<T extends GenericObject> {
  items: Array<T>;
  onProgressInfo: OnProgressInfoFunction<T>;
  onBulkActionStart: OnBulkActionStart;
  onBulkActionEnd: OnBulkActionEnd;
  /*
   * Aborted when the person presses Stop in the progress dialog: a run
   * starts no more items (runBulkAction). The dialog offers Stop only for a
   * run that said at its start it can stop.
   */
  stopSignal?: AbortSignal | undefined;
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
  /*
   * The kind of action this is (ActionMenuGroup, or a list's own kind): the
   * menu draws a gap where one kind ends and the next begins. Left out, the
   * action sits with its unnamed neighbours, as it always has.
   */
  menuGroup?: string | undefined;
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
  /*
   * The result's words for what happened to each item, when this action has
   * better ones than "succeeded" and "failed": a Delete says "2 Monitors
   * deleted" and "1 Monitor not deleted", which is what the reader is
   * looking for. Plural templates with {{count}}, {{itemName}} and
   * {{itemsName}}, as BULK_SUCCEEDED_COUNT.
   */
  resultLabels?:
    | {
        succeeded: PluralTemplate;
        failed: PluralTemplate;
      }
    | undefined;
  /*
   * Drawn last in the result, once the action has finished: where to go
   * next, when the action made or changed one thing the reader will want
   * to open - the episode the selected alerts were added to, say. Read when
   * the result is drawn, so it can name what the run produced. Nothing is
   * drawn when it returns undefined.
   */
  resultDetails?: (() => ReactElement | undefined) | undefined;
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

  // The action whose run the progress dialog reports, for its words.
  const [runningAction, setRunningAction] =
    React.useState<BulkActionButtonSchema<T> | null>(null);

  // Whether the run can be stopped, and whether the person asked it to.
  const [isStoppable, setIsStoppable] = React.useState<boolean>(false);
  const [isStopping, setIsStopping] = React.useState<boolean>(false);

  // The run's Stop: aborted by the dialog's Stop button.
  const stopControllerRef: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);

  /*
   * A bulk action runs in this page, so closing or reloading it part-way
   * leaves the rest undone. While one runs, the browser asks before the
   * page goes.
   */
  React.useEffect(() => {
    if (!actionInProgress) {
      return;
    }

    const warnBeforeLeaving: (event: BeforeUnloadEvent) => void = (
      event: BeforeUnloadEvent,
    ): void => {
      event.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [actionInProgress]);

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

    // A Stop of its own for every run.
    const stopController: AbortController = new AbortController();
    stopControllerRef.current = stopController;

    const buttonClickObject: BulkActionOnClickProps<T> = {
      items: props.selectedItems,
      stopSignal: stopController.signal,
      onProgressInfo: (info: ProgressInfo<T>) => {
        setProgressInfo(info);
      },
      onBulkActionStart: (options?: BulkActionStartOptions | undefined) => {
        setRunningAction(button);
        setIsStoppable(Boolean(options?.isStoppable));
        setIsStopping(false);
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
    const unchangedItems: Array<BulkActionUnchanged<T>> =
      progressInfo?.unchanged || [];

    if (actionInProgress && progressInfo) {
      const timeLeft: string | undefined = isStopping
        ? undefined
        : getBulkTimeLeftText(progressInfo.estimatedTimeLeftInMs, translator);

      /*
       * What has happened so far, in the words the summary will use: a
       * failure shows up while the run goes on, not only at its end.
       */
      const liveCounts: Array<{
        key: string;
        text: string;
        dotClassName: string;
      }> = [];

      if (progressInfo.successItems.length > 0) {
        liveCounts.push({
          key: "succeeded",
          text: translator.translatePlural(
            runningAction?.resultLabels?.succeeded || BULK_SUCCEEDED_COUNT,
            progressInfo.successItems.length,
            {
              count: translator.formatNumber(progressInfo.successItems.length),
              itemName: itemTerm,
              itemsName: itemsTerm,
            },
          ),
          dotClassName: "bg-green-500",
        });
      }

      if (unchangedItems.length > 0) {
        liveCounts.push({
          key: "unchanged",
          text: translator.translatePlural(
            BULK_UNCHANGED_COUNT,
            unchangedItems.length,
            {
              count: translator.formatNumber(unchangedItems.length),
              itemName: itemTerm,
              itemsName: itemsTerm,
            },
          ),
          dotClassName: "bg-gray-400",
        });
      }

      if (progressInfo.failed.length > 0) {
        liveCounts.push({
          key: "failed",
          text: translator.translatePlural(
            runningAction?.resultLabels?.failed || BULK_FAILED_COUNT,
            progressInfo.failed.length,
            {
              count: translator.formatNumber(progressInfo.failed.length),
              itemName: itemTerm,
              itemsName: itemsTerm,
            },
          ),
          dotClassName: "bg-red-500",
        });
      }

      let note: string = BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE;

      if (isStopping) {
        note = BULK_STOPPING;
      } else if (isStoppable) {
        note = BULK_KEEP_PAGE_OPEN;
      }

      return (
        <div className="space-y-4" data-testid="bulk-action-in-progress">
          <p className="text-sm text-gray-500" data-testid="bulk-action-note">
            {tx(note)}
          </p>
          <ProgressBar
            count={
              progressInfo.successItems.length +
              progressInfo.failed.length +
              unchangedItems.length
            }
            totalCount={progressInfo.totalItems.length}
            suffix={props.pluralLabel}
            size={ProgressBarSize.Small}
          />
          {liveCounts.length > 0 || timeLeft ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-gray-600">
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
                data-testid="bulk-action-live-counts"
              >
                {liveCounts.map(
                  (liveCount: {
                    key: string;
                    text: string;
                    dotClassName: string;
                  }) => {
                    return (
                      <span
                        key={liveCount.key}
                        className="inline-flex items-center gap-1.5"
                        data-testid={`bulk-action-live-${liveCount.key}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${liveCount.dotClassName}`}
                        />
                        {liveCount.text}
                      </span>
                    );
                  },
                )}
              </div>
              {timeLeft ? (
                <span
                  className="text-gray-500"
                  data-testid="bulk-action-time-left"
                >
                  {timeLeft}
                </span>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      );
    }

    if (!actionInProgress && progressInfo) {
      const hasFailures: boolean = progressInfo.failed.length > 0;
      const hasSuccesses: boolean = progressInfo.successItems.length > 0;
      const hasUnchanged: boolean = unchangedItems.length > 0;
      const notStartedItems: Array<T> = progressInfo.notStartedItems || [];
      const resultDetails: ReactElement | undefined =
        runningAction?.resultDetails?.();

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
                <div
                  className="ml-2 text-sm font-medium text-green-800"
                  data-testid="bulk-action-succeeded-count"
                >
                  {translator.translatePlural(
                    runningAction?.resultLabels?.succeeded ||
                      BULK_SUCCEEDED_COUNT,
                    progressInfo.successItems.length,
                    {
                      count: translator.formatNumber(
                        progressInfo.successItems.length,
                      ),
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
                <div
                  className="ml-2 text-sm font-medium text-red-800"
                  data-testid="bulk-action-failed-count"
                >
                  {translator.translatePlural(
                    runningAction?.resultLabels?.failed || BULK_FAILED_COUNT,
                    progressInfo.failed.length,
                    {
                      count: translator.formatNumber(
                        progressInfo.failed.length,
                      ),
                      itemName: itemTerm,
                      itemsName: itemsTerm,
                    },
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Failure details */}
          {hasFailures &&
            renderItemList(
              progressInfo.failed.map((failedItem: BulkActionFailed<T>) => {
                return {
                  item: failedItem.item,
                  message: failedItem.failedMessage,
                };
              }),
              "bulk-action-failed-items",
            )}

          {/*
           * Left alone on purpose, after the failures: those are what to act
           * on first. Its own count and its own list, so a reason never reads
           * as an error.
           */}
          {hasUnchanged && (
            <div
              className="flex items-center rounded-lg bg-gray-50 p-3"
              data-testid="bulk-action-unchanged-count"
            >
              <Icon
                className="h-5 w-5 flex-shrink-0"
                icon={IconProp.Info}
                color={Gray500}
              />
              <div className="ml-2 text-sm font-medium text-gray-800">
                {translator.translatePlural(
                  BULK_UNCHANGED_COUNT,
                  unchangedItems.length,
                  {
                    count: translator.formatNumber(unchangedItems.length),
                    itemName: itemTerm,
                    itemsName: itemsTerm,
                  },
                )}
              </div>
            </div>
          )}
          {hasUnchanged &&
            renderItemList(
              unchangedItems.map((unchanged: BulkActionUnchanged<T>) => {
                return {
                  item: unchanged.item,
                  message: unchanged.reason,
                };
              }),
              "bulk-action-unchanged-items",
            )}

          {/*
           * What a Stop left: a count, not a list - thousands of names that
           * all say the same would bury the failures above.
           */}
          {notStartedItems.length > 0 && (
            <div
              className="flex items-center rounded-lg bg-gray-50 p-3"
              data-testid="bulk-action-not-started-count"
            >
              <Icon
                className="h-5 w-5 flex-shrink-0"
                icon={IconProp.StopCircle}
                color={Gray500}
              />
              <div className="ml-2 text-sm font-medium text-gray-800">
                {translator.translatePlural(
                  BULK_NOT_STARTED_COUNT,
                  notStartedItems.length,
                  {
                    count: translator.formatNumber(notStartedItems.length),
                    itemName: itemTerm,
                    itemsName: itemsTerm,
                  },
                )}
              </div>
            </div>
          )}

          {/* Where to go next, when the action says (resultDetails). */}
          {resultDetails && (
            <div data-testid="bulk-action-result-details">{resultDetails}</div>
          )}
        </div>
      );
    }

    return <></>;
  };

  /*
   * The items, by what happened to them: the names, then why. Items that
   * share a reason are listed together under it once. A bulk Delete the
   * server refuses part of usually refuses for one reason - a permission
   * scoped to a label, the teams every project comes with - and a row per
   * item said that same sentence six times over, in a box that showed three
   * of them and hid the rest below its fold. The failure list and the "not
   * changed" list are the same list with different words.
   */
  type RenderItemListFunction = (
    entries: Array<{ item: T; message: string | ReactElement }>,
    dataTestId: string,
  ) => ReactElement;

  const renderItemList: RenderItemListFunction = (
    entries: Array<{ item: T; message: string | ReactElement }>,
    dataTestId: string,
  ): ReactElement => {
    const groups: Array<BulkItemGroup> = groupItemsByReason(
      entries.map((entry: { item: T; message: string | ReactElement }) => {
        return {
          name: props.itemToString ? props.itemToString(entry.item) : "",
          message: entry.message,
        };
      }),
    );

    return (
      <div
        className="rounded-lg border border-gray-200 overflow-hidden"
        data-testid={dataTestId}
      >
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-200">
          {groups.map((group: BulkItemGroup, i: number) => {
            /*
             * A reason the server gave is English. When the reader's
             * language has its own wording for it - a refusal the Dashboard
             * also shows, such as a monitor's only status event - the list
             * says it in theirs, as the error dialog for one row does.
             */
            const message: string | ReactElement =
              typeof group.message === "string"
                ? translator.translateText(group.message) || group.message
                : group.message;

            return (
              <div
                className="px-4 py-3 text-sm"
                key={i}
                data-testid={`${dataTestId}-group`}
              >
                {group.names.length === 1 ? (
                  <div className="break-words font-medium text-gray-900">
                    {group.names[0]}
                  </div>
                ) : (
                  <></>
                )}
                {group.names.length > 1 ? (
                  <ul className="space-y-0.5">
                    {group.names.map((name: string, j: number) => {
                      return (
                        <li
                          key={j}
                          className="break-words font-medium text-gray-900"
                        >
                          {name}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <></>
                )}
                <div className="text-gray-500 mt-0.5">{message}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /*
   * "In Progress" while it runs; at the end "Stopped" when a Stop left items
   * not started, "Completed" otherwise - a Stop pressed as the last items
   * finished left nothing out, and the run did complete.
   */
  const getProgressTitle: () => string = (): string => {
    if (actionInProgress) {
      return "In Progress";
    }

    if ((progressInfo?.notStartedItems || []).length > 0) {
      return "Stopped";
    }

    return "Completed";
  };

  const getProgressButtonText: () => string = (): string => {
    if (!actionInProgress || !isStoppable) {
      return "Close";
    }

    return isStopping ? "Stopping…" : "Stop";
  };

  const menuChildren: Array<ReactElement> = [];

  safeButtons.forEach((button: BulkActionButtonSchema<T>, index: number) => {
    const previous: BulkActionButtonSchema<T> | undefined =
      safeButtons[index - 1];

    // A gap where one kind of action ends and the next begins.
    if (previous && startsNewMenuGroup(previous.menuGroup, button.menuGroup)) {
      menuChildren.push(
        <MoreMenuDivider key={`bulk-action-group-divider-${index}`} />,
      );
    }

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
                      count: translator.formatNumber(
                        props.selectedItems.length,
                      ),
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

            {/*
             * At the right edge even when the bar wraps, as on a phone: the
             * menu opens leftwards from this button's right edge, and from a
             * button at the left it ran off the screen.
             */}
            <div className="ml-auto flex items-center">
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
          title={getProgressTitle()}
          description={<div>{showProgressInfo()}</div>}
          submitButtonType={ButtonStyleType.NORMAL}
          /*
           * While a run goes on, its one button is Stop - a run that cannot
           * stop keeps Close, unavailable until it ends - and once it has
           * ended, Close.
           */
          disableSubmitButton={actionInProgress && (!isStoppable || isStopping)}
          submitButtonText={getProgressButtonText()}
          /*
           * The focus starts on the dialog, not on Stop: the Enter that
           * confirmed the action, held a moment too long, or one pressed to
           * get on, must not stop the run it just started.
           */
          isInitialFocusOnDialog={true}
          onSubmit={() => {
            if (actionInProgress) {
              if (isStoppable && !isStopping) {
                setIsStopping(true);
                stopControllerRef.current?.abort();
              }
              return;
            }

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
