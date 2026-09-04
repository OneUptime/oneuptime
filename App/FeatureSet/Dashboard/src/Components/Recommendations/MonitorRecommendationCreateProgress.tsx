import React, { FunctionComponent, ReactElement } from "react";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorRecommendationCreateRunner, {
  MonitorRecommendationCreateItemProgress,
  MonitorRecommendationCreateItemStatus,
  MonitorRecommendationCreateProgress as CreateProgress,
} from "./MonitorRecommendationCreateRunner";

export interface ComponentProps {
  progress: CreateProgress;
}

/*
 * What the batch is doing, while it does it.
 *
 * Creating eighteen monitors takes the better part of a minute — each one runs
 * label rules, owner rules and workspace notifications server-side, and they
 * run one at a time on purpose. Before this the only feedback was a single
 * line of text that did not appear until the FIRST monitor had landed, so the
 * longest silence in the whole operation was the one at the very start, when
 * the user has just pressed a button and most needs to know it worked.
 *
 * So: a bar for "how far along", a line for "what that means", and a row per
 * monitor for "which one is it on" — the last of which is also the only way to
 * report a partial failure, because the run no longer stops at the first one.
 */
const MonitorRecommendationCreateProgress: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const progress: CreateProgress = props.progress;

  const settledCount: number = progress.createdCount + progress.failedCount;

  type GetRowIconFunction = (
    status: MonitorRecommendationCreateItemStatus,
  ) => ReactElement;

  const getRowIcon: GetRowIconFunction = (
    status: MonitorRecommendationCreateItemStatus,
  ): ReactElement => {
    if (status === MonitorRecommendationCreateItemStatus.Created) {
      return (
        <Icon
          icon={IconProp.CheckCircle}
          className="h-4 w-4 flex-shrink-0 text-green-500"
        />
      );
    }

    if (status === MonitorRecommendationCreateItemStatus.Failed) {
      return (
        <Icon
          icon={IconProp.Error}
          className="h-4 w-4 flex-shrink-0 text-red-500"
        />
      );
    }

    if (status === MonitorRecommendationCreateItemStatus.Creating) {
      return (
        <Icon
          icon={IconProp.Spinner}
          className="h-4 w-4 flex-shrink-0 animate-spin text-indigo-500"
        />
      );
    }

    /*
     * Pending. A hollow ring rather than a greyed tick: a tick shape in any
     * colour reads as "done" at a glance down a list of ticks.
     */
    return (
      <span
        className="h-4 w-4 flex-shrink-0 rounded-full border border-gray-300"
        aria-hidden="true"
      />
    );
  };

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4"
      data-testid="monitor-recommendation-create-progress"
      role="status"
      aria-live="polite"
    >
      <ProgressBar
        count={settledCount}
        totalCount={progress.totalCount}
        suffix="monitors"
        size={ProgressBarSize.Small}
      />

      <p
        className={`mt-3 text-sm ${
          progress.isComplete && progress.failedCount > 0
            ? "text-red-700"
            : "text-gray-600"
        }`}
        data-testid="monitor-recommendation-create-progress-summary"
      >
        {MonitorRecommendationCreateRunner.getSummaryText(progress)}
      </p>

      {/*
       * Capped and scrollable. Eighteen rows inside a panel that also holds
       * the on-call policy, the severity mapping and the owners section would
       * push the submit button off the bottom of the drawer on a laptop.
       */}
      <ul className="mt-3 max-h-48 divide-y divide-gray-100 overflow-y-auto">
        {progress.items.map((item: MonitorRecommendationCreateItemProgress) => {
          return (
            <li
              key={item.recommendationId}
              className="flex items-start gap-2 py-2"
              data-testid={`monitor-recommendation-create-progress-item-${item.recommendationId}`}
            >
              {getRowIcon(item.status)}
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-xs ${
                    item.status ===
                    MonitorRecommendationCreateItemStatus.Pending
                      ? "text-gray-400"
                      : "text-gray-700"
                  }`}
                >
                  {item.name}
                </p>
                {item.errorMessage ? (
                  <p className="mt-0.5 text-xs text-red-600">
                    {item.errorMessage}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default MonitorRecommendationCreateProgress;
