import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon, { IconType, SizeProp } from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

// Coerce a (possibly missing) JSON count to a number for arithmetic / totals.
const toCount: (value: unknown) => number = (value: unknown): number => {
  const parsed: number | null = toNumberOrNull(value);
  return parsed === null ? 0 : parsed;
};

const countLabel: (value: unknown) => string = (value: unknown): string => {
  const parsed: number | null = toNumberOrNull(value);
  return parsed === null ? "—" : parsed.toLocaleString();
};

// Pretty-print a failed job's finish time; falls back to a dash when unknown.
const formatTimestamp: (value: unknown) => string = (
  value: unknown,
): string => {
  if (!value || typeof value !== "string") {
    return "—";
  }

  try {
    return OneUptimeDate.getDateAsLocalFormattedString(value, false, false);
  } catch {
    return "—";
  }
};

/*
 * Modal that lazily loads the most-recent failed jobs for a single queue and
 * shows each job's failure reason and (collapsible) stack trace. This is the
 * "more information" an operator needs to act on a non-zero failed count
 * straight from the dashboard, without dropping into the Bull Board inspector.
 */
export interface FailedJobsModalProps {
  queueName: string;
  onClose: () => void;
}

const QueueFailedJobsModal: FunctionComponent<FailedJobsModalProps> = (
  props: FailedJobsModalProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [failedJobs, setFailedJobs] = useState<JSONArray>([]);
  const [expandedJobIndex, setExpandedJobIndex] = useState<number | null>(null);

  const loadFailedJobs: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/admin/health/queues/${props.queueName}/failed-jobs`,
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setFailedJobs((response.data["failedJobs"] || []) as JSONArray);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFailedJobs().catch(() => {
      // handled via setError
    });
  }, []);

  const renderBody: () => ReactElement = (): ReactElement => {
    if (error) {
      return <Alert type={AlertType.DANGER} title={error} />;
    }

    if (failedJobs.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Icon
            icon={IconProp.CheckCircle}
            size={SizeProp.Large}
            className="h-10 w-10 text-green-500"
          />
          <div className="mt-3 text-sm font-medium text-gray-800">
            No failed jobs
          </div>
          <div className="mt-1 text-sm text-gray-500">
            This queue has no recent failures.
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <div className="text-xs text-gray-500">
          Showing the {failedJobs.length} most recent failed{" "}
          {failedJobs.length === 1 ? "job" : "jobs"}. Job payloads are omitted —
          only payload keys are shown.
        </div>
        {failedJobs.map((job: unknown, index: number): ReactElement => {
          const jobObject: JSONObject = job as JSONObject;
          const dataKeys: JSONArray = (jobObject["dataKeys"] ||
            []) as JSONArray;
          const stackTrace: string = String(jobObject["stackTrace"] || "");
          const isExpanded: boolean = expandedJobIndex === index;

          return (
            <div
              key={index}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {String(jobObject["name"] || "unknown")}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-gray-400">
                    #{String(jobObject["id"] || "unknown")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {countLabel(jobObject["attemptsMade"])} attempt
                    {toCount(jobObject["attemptsMade"]) === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTimestamp(jobObject["finishedAt"])}
                  </span>
                </div>
              </div>

              <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {String(jobObject["failedReason"] || "No reason provided")}
              </div>

              {dataKeys.length > 0 ? (
                <div className="mt-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-600">
                    Payload keys:{" "}
                  </span>
                  <span className="font-mono">
                    {dataKeys
                      .map((key: unknown): string => {
                        return String(key);
                      })
                      .join(", ")}
                  </span>
                </div>
              ) : (
                <></>
              )}

              {stackTrace ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    onClick={() => {
                      setExpandedJobIndex(isExpanded ? null : index);
                    }}
                  >
                    <Icon
                      icon={
                        isExpanded
                          ? IconProp.ChevronDown
                          : IconProp.ChevronRight
                      }
                      size={SizeProp.Small}
                      className="h-3.5 w-3.5"
                    />
                    {isExpanded ? "Hide stack trace" : "Show stack trace"}
                  </button>
                  {isExpanded ? (
                    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
                      {stackTrace}
                    </pre>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      title={`Failed jobs · ${props.queueName} queue`}
      description="The most recent jobs this queue's workers failed to process. Use the failure reason and stack trace to diagnose what is wedging the worker."
      icon={IconProp.Error}
      iconType={IconType.Danger}
      modalWidth={ModalWidth.Large}
      isBodyLoading={isLoading}
      submitButtonText="Refresh"
      submitButtonStyleType={ButtonStyleType.NORMAL}
      onSubmit={() => {
        setIsLoading(true);
        loadFailedJobs().catch(() => {
          // handled via setError
        });
      }}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      {renderBody()}
    </Modal>
  );
};

/*
 * The "Background queues" section of the instance health page: a cross-queue
 * summary, a per-queue breakdown with a health indicator, and a drill-in to the
 * recent failed jobs for any queue that is reporting failures.
 */
export interface ComponentProps {
  queues: JSONArray;
  isRefreshing: boolean;
  onRefresh: () => void;
}

const BackgroundQueues: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);

  const queues: JSONArray = props.queues;

  // Cross-queue roll-ups for the summary tiles (errored queues contribute 0).
  const totals: {
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
  } = queues.reduce(
    (
      acc: {
        waiting: number;
        active: number;
        failed: number;
        delayed: number;
      },
      queue: unknown,
    ): {
      waiting: number;
      active: number;
      failed: number;
      delayed: number;
    } => {
      const queueObject: JSONObject = queue as JSONObject;

      if (queueObject["error"]) {
        return acc;
      }

      return {
        waiting: acc.waiting + toCount(queueObject["waiting"]),
        active: acc.active + toCount(queueObject["active"]),
        failed: acc.failed + toCount(queueObject["failed"]),
        delayed: acc.delayed + toCount(queueObject["delayed"]),
      };
    },
    { waiting: 0, active: 0, failed: 0, delayed: 0 },
  );

  const renderSummaryTile: (
    label: string,
    value: number,
    isAlert: boolean,
  ) => ReactElement = (
    label: string,
    value: number,
    isAlert: boolean,
  ): ReactElement => {
    return (
      <div
        className={`rounded-lg border p-3 ${
          isAlert && value > 0
            ? "border-red-200 bg-red-50"
            : "border-gray-200 bg-white"
        }`}
      >
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            isAlert && value > 0 ? "text-red-600" : "text-gray-900"
          }`}
        >
          {value.toLocaleString()}
        </div>
      </div>
    );
  };

  const renderQueueStatus: (queueObject: JSONObject) => ReactElement = (
    queueObject: JSONObject,
  ): ReactElement => {
    if (queueObject["error"]) {
      return (
        <Statusbubble text="Unavailable" color={Red} shouldAnimate={false} />
      );
    }

    const failed: number = toCount(queueObject["failed"]);

    if (failed > 0) {
      return (
        <Statusbubble
          text={`${failed.toLocaleString()} failing`}
          color={Red}
          shouldAnimate={false}
        />
      );
    }

    return <Statusbubble text="Healthy" color={Green} shouldAnimate={true} />;
  };

  return (
    <Card
      title="Background queues"
      description="Job backlog and failures across the queue workers. A growing backlog or a non-zero failed count means workers are unhealthy — drill into a queue to read its failed job logs."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          buttonSize: ButtonSize.Small,
          isLoading: props.isRefreshing,
          onClick: () => {
            props.onRefresh();
          },
        },
      ]}
    >
      <div>
        {/* Cross-queue summary */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {renderSummaryTile("Waiting", totals.waiting, false)}
          {renderSummaryTile("Active", totals.active, false)}
          {renderSummaryTile("Delayed", totals.delayed, false)}
          {renderSummaryTile("Failed", totals.failed, true)}
        </div>

        {/* Per-queue breakdown */}
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-4 font-medium">Queue</th>
                <th className="py-2 px-4 font-medium">Status</th>
                <th className="py-2 px-4 font-medium tabular-nums">Waiting</th>
                <th className="py-2 px-4 font-medium tabular-nums">Active</th>
                <th className="py-2 px-4 font-medium tabular-nums">
                  Completed
                </th>
                <th className="py-2 px-4 font-medium tabular-nums">Failed</th>
                <th className="py-2 px-4 font-medium tabular-nums">Delayed</th>
                <th className="py-2 px-4 font-medium tabular-nums">Total</th>
                <th className="py-2 pl-4 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {queues.map((queue: unknown, index: number): ReactElement => {
                const queueObject: JSONObject = queue as JSONObject;
                const queueName: string = String(queueObject["name"]);

                if (queueObject["error"]) {
                  return (
                    <tr key={index}>
                      <td className="py-3 pr-4 font-medium text-gray-800">
                        {queueName}
                      </td>
                      <td className="py-3 px-4">
                        {renderQueueStatus(queueObject)}
                      </td>
                      <td
                        className="py-3 px-4 italic text-gray-400"
                        colSpan={7}
                      >
                        Stats unavailable — could not reach the queue.
                      </td>
                    </tr>
                  );
                }

                const failed: number = toCount(queueObject["failed"]);

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="py-3 pr-4 font-medium text-gray-800">
                      {queueName}
                    </td>
                    <td className="py-3 px-4">
                      {renderQueueStatus(queueObject)}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-gray-700">
                      {countLabel(queueObject["waiting"])}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-gray-700">
                      {countLabel(queueObject["active"])}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-gray-700">
                      {countLabel(queueObject["completed"])}
                    </td>
                    <td
                      className={`py-3 px-4 tabular-nums ${
                        failed > 0
                          ? "font-semibold text-red-600"
                          : "text-gray-700"
                      }`}
                    >
                      {countLabel(queueObject["failed"])}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-gray-700">
                      {countLabel(queueObject["delayed"])}
                    </td>
                    <td className="py-3 px-4 tabular-nums font-medium text-gray-900">
                      {countLabel(queueObject["total"])}
                    </td>
                    <td className="py-3 pl-4 text-right">
                      {failed > 0 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          onClick={() => {
                            setSelectedQueue(queueName);
                          }}
                        >
                          <Icon
                            icon={IconProp.Eye}
                            size={SizeProp.Small}
                            className="h-3.5 w-3.5"
                          />
                          View failures
                        </button>
                      ) : (
                        <></>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedQueue ? (
        <QueueFailedJobsModal
          queueName={selectedQueue}
          onClose={() => {
            setSelectedQueue(null);
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default BackgroundQueues;
