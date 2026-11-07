import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import CompactLoader from "Common/UI/Components/ComponentLoader/CompactLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import MessageQueueTopologyExplorer from "./MessageQueueTopologyExplorer";
import useMessageQueueTopology, {
  MessageQueueTopologyLoad,
} from "./UseMessageQueueTopology";

/*
 * The Queues topology with its controls: the range it covers (the past hour
 * by default, as on a queue's Overview), a refresh, and what to say while it
 * loads or when it could not be read. The Queues product's Topology page
 * and a queue's own Topology tab are both this, the tab anchored on its
 * queue.
 */

export const MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE: RangeStartAndEndDateTime =
  {
    range: TimeRange.PAST_ONE_HOUR,
  };

export interface ComponentProps {
  anchorQueueId?: string | undefined;
}

const MessageQueueTopologyPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE,
  );
  const load: MessageQueueTopologyLoad = useMessageQueueTopology(timeRange);
  const isBusy: boolean = load.status === "loading" || load.isRefreshing;

  return (
    <div className="space-y-5" data-testid="message-queue-topology-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <details className="relative text-xs text-gray-500">
          <summary className="cursor-pointer rounded text-gray-500 hover:text-gray-800 focus:ring-2 focus:ring-indigo-500">
            {translator.translateText("What is shown · About this data")}
          </summary>
          <p className="mt-2 max-w-xl leading-5">
            {translator.translateText(
              "Every queue you can see, and the services seen publishing to it or consuming from it in the selected range, counted from their OpenTelemetry messaging spans exactly as each queue's Producers and Consumers cards count them. Backlog, consumer lag and dead letters come from your broker's metrics, when they reach OneUptime.",
            )}
          </p>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          {load.error && load.data ? (
            <span
              className="text-xs text-amber-700"
              role="status"
              data-testid="message-queue-topology-refresh-failed"
            >
              {translator.translateText(
                "Could not refresh. Showing the last map.",
              )}
            </span>
          ) : (
            <></>
          )}
          <TelemetryTimeRangePicker value={timeRange} onChange={setTimeRange} />
          <button
            type="button"
            data-testid="message-queue-topology-refresh"
            aria-label={translator.translateText("Refresh topology") || ""}
            title={
              load.loadedAt
                ? translator.translateTemplate("Last refreshed {{time}}", {
                    time: OneUptimeDate.getDateAsLocalFormattedString(
                      load.loadedAt,
                    ),
                  })
                : undefined
            }
            disabled={isBusy}
            className={`rounded-lg border border-gray-200 bg-white p-2 text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${getHandDrawnButtonStateClassName(
              {
                isBusy: isBusy,
                hoverClassName: "hover:bg-gray-50",
              },
            )}`}
            onClick={load.reload}
          >
            <Icon icon={IconProp.Refresh} className="h-4 w-4" />
          </button>
        </div>
      </div>

      {load.status === "error" ? (
        <div
          role="alert"
          className="rounded-xl border border-gray-200 bg-white p-6"
          data-testid="message-queue-topology-error"
        >
          <ErrorMessage message={load.error} />
          <button
            type="button"
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            onClick={load.reload}
          >
            {translator.translateText("Try again")}
          </button>
        </div>
      ) : load.status === "loading" || !load.data || !load.window ? (
        <div
          role="status"
          aria-live="polite"
          className="my-16 flex flex-col items-center"
          data-testid="message-queue-topology-loading"
        >
          <CompactLoader />
          <p className="text-sm text-gray-500">
            {translator.translateText("Loading the message flow…")}
          </p>
        </div>
      ) : (
        <MessageQueueTopologyExplorer
          data={load.data}
          window={load.window}
          anchorQueueId={props.anchorQueueId}
        />
      )}
    </div>
  );
};

export default MessageQueueTopologyPage;
