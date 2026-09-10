import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "Common/Models/DatabaseModels/GoogleSecOpsConnectionRun";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import {
  GoogleSecOpsRunType,
  GoogleSecOpsRunResult,
} from "Common/Types/SecurityEvent/GoogleSecOpsDiagnostics";
import { APP_API_URL } from "Common/UI/Config";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  formatGoogleSecOpsDate,
  googleSecOpsHealth,
  googleSecOpsNextPoll,
  googleSecOpsRunLabels,
  readGoogleSecOpsResult,
  validateGoogleSecOpsRange,
} from "./GoogleSecOpsDiagnosticsUtil";
import GoogleSecOpsRunDetails from "./GoogleSecOpsRunDetails";

export interface ComponentProps {
  connection: GoogleSecOpsConnection;
  canRun: boolean;
  disabledReason?: string | undefined;
  onClose: () => void;
  onUpdated: () => void;
  initialAction?: "test" | "poll" | undefined;
}

function localDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const GoogleSecOpsDiagnostics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [connection, setConnection] = useState<GoogleSecOpsConnection>(
    props.connection,
  );
  const [runs, setRuns] = useState<Array<GoogleSecOpsConnectionRun>>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pollingRevision, setPollingRevision] = useState<number>(0);
  const [rangePreset, setRangePreset] = useState<string>("24");
  const [startTime, setStartTime] = useState<string>(() => {
    return localDateInput(new Date(Date.now() - 24 * 60 * 60_000));
  });
  const [endTime, setEndTime] = useState<string>(() => {
    return localDateInput(new Date());
  });
  const [confirmImport, setConfirmImport] = useState<boolean>(false);
  const mounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const requestSequence: React.MutableRefObject<number> = useRef<number>(0);
  const initialActionStarted: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const updatedCallback: React.MutableRefObject<() => void> = useRef(
    props.onUpdated,
  );
  updatedCallback.current = props.onUpdated;

  const refreshHistory: () => Promise<boolean> =
    useCallback(async (): Promise<boolean> => {
      const sequence: number = ++requestSequence.current;
      try {
        const [history, freshConnection]: [
          ListResult<GoogleSecOpsConnectionRun>,
          GoogleSecOpsConnection | null,
        ] = await Promise.all([
          ModelAPI.getList<GoogleSecOpsConnectionRun>({
            modelType: GoogleSecOpsConnectionRun,
            query: {
              projectId: props.connection.projectId!,
              googleSecOpsConnectionId: props.connection.id!,
            },
            limit: 20,
            skip: 0,
            sort: { createdAt: SortOrder.Descending },
            select: {
              _id: true,
              googleSecOpsConnectionId: true,
              createdAt: true,
              type: true,
              status: true,
              startedAt: true,
              completedAt: true,
              request: true,
              result: true,
              error: true,
              requestedByUserId: true,
            },
          }),
          ModelAPI.getItem<GoogleSecOpsConnection>({
            modelType: GoogleSecOpsConnection,
            id: props.connection.id!,
            select: {
              _id: true,
              projectId: true,
              name: true,
              createdAt: true,
              isEnabled: true,
              pollIntervalInMinutes: true,
              includeNonAlertingDetections: true,
              lastPolledAt: true,
              lastSuccessfulPollAt: true,
              lastEventIngestedAt: true,
              lastPollResult: true,
              lastError: true,
            },
          }),
        ]);
        if (!mounted.current || sequence !== requestSequence.current) {
          return false;
        }
        setRuns(history.data);
        setHistoryError(null);
        if (freshConnection) {
          setConnection(freshConnection);
        }
        setSelectedRunId((current: string | null): string | null => {
          return history.data.some(
            (run: GoogleSecOpsConnectionRun): boolean => {
              return run.id?.toString() === current;
            },
          )
            ? current
            : history.data[0]?.id?.toString() || null;
        });
        setIsLoading(false);
        return history.data.some((run: GoogleSecOpsConnectionRun): boolean => {
          return run.status === "queued" || run.status === "running";
        });
      } catch (err) {
        if (mounted.current && sequence === requestSequence.current) {
          setHistoryError(API.getFriendlyErrorMessage(err as Error));
          setIsLoading(false);
        }
        return true;
      }
    }, [
      props.connection.id?.toString(),
      props.connection.projectId?.toString(),
    ]);

  const submitRun: (type: GoogleSecOpsRunType) => Promise<void> = async (
    type: GoogleSecOpsRunType,
  ): Promise<void> => {
    if (!props.canRun || isSubmitting) {
      return;
    }
    const hasRange: boolean = type === "preview" || type === "backfill";
    const validationError: string | null = hasRange
      ? validateGoogleSecOpsRange(startTime, endTime)
      : null;
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    setConfirmImport(false);
    setError(null);
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(
            `/google-secops-connection/${props.connection.id!.toString()}/run`,
          ),
          headers: ModelAPI.getCommonHeaders(),
          data: {
            type,
            ...(hasRange
              ? {
                  startTime: new Date(startTime).toISOString(),
                  endTime: new Date(endTime).toISOString(),
                }
              : {}),
          },
        });
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      const runId: unknown = response.data["runId"];
      if (typeof runId !== "string" || !runId) {
        throw new Error(
          "The run was not returned by the server. Refresh run history before trying again.",
        );
      }
      if (!mounted.current) {
        return;
      }
      setSelectedRunId(runId);
      setPollingRevision((value: number): number => {
        return value + 1;
      });
      updatedCallback.current();
    } catch (err) {
      if (mounted.current) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }
    } finally {
      if (mounted.current) {
        setIsSubmitting(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    let stopped: boolean = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh: () => Promise<void> = async (): Promise<void> => {
      const pending: boolean = await refreshHistory();
      if (mounted.current && !stopped) {
        timer = setTimeout(
          () => {
            void refresh();
          },
          pending ? 3000 : 15000,
        );
      }
    };
    void refresh();
    return (): void => {
      stopped = true;
      mounted.current = false;
      requestSequence.current++;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [refreshHistory, pollingRevision]);

  useEffect(() => {
    if (props.initialAction && !initialActionStarted.current) {
      initialActionStarted.current = true;
      void submitRun(props.initialAction);
    }
  }, []);

  const selectedRun: GoogleSecOpsConnectionRun | undefined = runs.find(
    (run: GoogleSecOpsConnectionRun): boolean => {
      return run.id?.toString() === selectedRunId;
    },
  );
  const hasPendingRun: boolean = runs.some(
    (run: GoogleSecOpsConnectionRun): boolean => {
      return run.status === "queued" || run.status === "running";
    },
  );
  const disableActions: boolean =
    !props.canRun ||
    isLoading ||
    isSubmitting ||
    hasPendingRun ||
    Boolean(selectedRunId && !selectedRun);
  const nextPoll: Date | null = googleSecOpsNextPoll(connection);
  const rangeError: string | null = validateGoogleSecOpsRange(
    startTime,
    endTime,
  );

  const setPreset: (value: string) => void = (value: string): void => {
    setRangePreset(value);
    setConfirmImport(false);
    if (value !== "custom") {
      const now: Date = new Date();
      setStartTime(
        localDateInput(new Date(now.getTime() - Number(value) * 60 * 60_000)),
      );
      setEndTime(localDateInput(now));
    }
  };

  return (
    <Modal
      title={`Connection diagnostics: ${connection.name || "Google SecOps"}`}
      description="Check access, inspect what Google returns, and review imports."
      modalWidth={ModalWidth.Large}
      onClose={(): void => {
        updatedCallback.current();
        props.onClose();
      }}
      closeButtonText="Close"
    >
      <div className="space-y-6">
        <section
          aria-label="Scheduled polling"
          className="rounded-md border border-gray-200 p-4"
        >
          <h3 className="text-base font-semibold text-gray-900">
            Scheduled polling
          </h3>
          <p className="mt-1 text-sm text-gray-700">
            {googleSecOpsHealth(connection)} ·{" "}
            {connection.isEnabled
              ? `Enabled, every ${connection.pollIntervalInMinutes || 5} minutes`
              : "Disabled"}
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Last attempt</dt>
              <dd>{formatGoogleSecOpsDate(connection.lastPolledAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Last successful poll</dt>
              <dd>{formatGoogleSecOpsDate(connection.lastSuccessfulPollAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Last event imported</dt>
              <dd>{formatGoogleSecOpsDate(connection.lastEventIngestedAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Next scheduled poll</dt>
              <dd>
                {!connection.isEnabled
                  ? "Paused"
                  : nextPoll
                    ? `${formatGoogleSecOpsDate(nextPoll)} (approximate)`
                    : "Next worker tick"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Scope</dt>
              <dd>
                {connection.includeNonAlertingDetections
                  ? "Alerts and detections"
                  : "Alerts only"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            Enabled controls the schedule. Poll outcomes include Run now; review
            scheduled runs in history to confirm recurring polling. Change the
            scope using Edit connection.
          </p>
        </section>

        <section aria-label="On-demand checks" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              title="Test connection"
              buttonStyle={ButtonStyleType.OUTLINE}
              disabled={disableActions}
              tooltip={props.disabledReason}
              onClick={(): void => {
                void submitRun("test");
              }}
            />
            <Button
              title="Run now"
              buttonStyle={ButtonStyleType.PRIMARY}
              disabled={disableActions}
              tooltip={props.disabledReason}
              onClick={(): void => {
                void submitRun("poll");
              }}
            />
          </div>
          <p className="text-sm text-gray-600">
            Test connection checks credentials and API access. Run now imports
            the next poll window immediately, including when the schedule is
            paused.
          </p>
          {!props.canRun && (
            <p className="text-sm text-gray-500">
              {props.disabledReason ||
                "Only project owners, project administrators, and security administrators can start runs. You can still review run history."}
            </p>
          )}
          {isSubmitting && (
            <p role="status" className="text-sm text-gray-600">
              Starting run…
            </p>
          )}
          {hasPendingRun && (
            <p className="text-sm text-gray-600">
              A run is already queued or running. New actions are available when
              it finishes.
            </p>
          )}
        </section>

        {error && <ErrorMessage message={error} />}
        {historyError && <ErrorMessage message={historyError} />}
        {selectedRun && <GoogleSecOpsRunDetails run={selectedRun} />}
        {!selectedRun && selectedRunId && !error && !historyError && (
          <p role="status" className="text-sm text-gray-600">
            Waiting for the run to appear in history…
          </p>
        )}

        <section
          aria-label="Historical detections"
          className="space-y-3 rounded-md border border-gray-200 p-4"
        >
          <h3 className="text-base font-semibold text-gray-900">
            Find historical detections
          </h3>
          <p className="text-sm text-gray-600">
            Preview a window before importing. First scheduled polls look back
            15 minutes; older detections need a historical import. Choose up to
            7 days per run.
          </p>
          <label
            className="block text-sm font-medium text-gray-700"
            htmlFor="secops-range"
          >
            Time range
          </label>
          <select
            id="secops-range"
            className="block w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
            value={rangePreset}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>): void => {
              setPreset(event.target.value);
            }}
          >
            <option value="1">Last hour</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
            <option value="custom">Custom range</option>
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm text-gray-700"
                htmlFor="secops-start"
              >
                Start (your local time)
              </label>
              <input
                id="secops-start"
                type="datetime-local"
                value={startTime}
                className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm"
                onChange={(
                  event: React.ChangeEvent<HTMLInputElement>,
                ): void => {
                  setStartTime(event.target.value);
                  setRangePreset("custom");
                  setConfirmImport(false);
                }}
              />
            </div>
            <div>
              <label
                className="block text-sm text-gray-700"
                htmlFor="secops-end"
              >
                End (your local time)
              </label>
              <input
                id="secops-end"
                type="datetime-local"
                value={endTime}
                className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm"
                onChange={(
                  event: React.ChangeEvent<HTMLInputElement>,
                ): void => {
                  setEndTime(event.target.value);
                  setRangePreset("custom");
                  setConfirmImport(false);
                }}
              />
            </div>
          </div>
          {rangeError && (
            <p role="alert" className="text-sm text-red-700">
              {rangeError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              title="Preview detections"
              buttonStyle={ButtonStyleType.OUTLINE}
              disabled={disableActions || Boolean(rangeError)}
              onClick={(): void => {
                void submitRun("preview");
              }}
            />
            <Button
              title="Import this time range"
              buttonStyle={ButtonStyleType.OUTLINE}
              disabled={disableActions || Boolean(rangeError)}
              onClick={(): void => {
                setConfirmImport(true);
              }}
            />
          </div>
          {confirmImport && !rangeError && (
            <div
              role="group"
              aria-label="Confirm historical import"
              className="space-y-3 rounded-md bg-indigo-50 p-3 text-sm text-gray-800"
            >
              <p>
                Import{" "}
                {connection.includeNonAlertingDetections
                  ? "alerts and detections"
                  : "alerts"}{" "}
                from {formatGoogleSecOpsDate(new Date(startTime))} to{" "}
                {formatGoogleSecOpsDate(new Date(endTime))} into OneUptime?
                Imported events become available to security rules and monitors.
                Already imported detections are skipped.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  title="Confirm import"
                  buttonStyle={ButtonStyleType.PRIMARY}
                  disabled={disableActions}
                  onClick={(): void => {
                    void submitRun("backfill");
                  }}
                />
                <Button
                  title="Cancel import"
                  buttonStyle={ButtonStyleType.OUTLINE}
                  onClick={(): void => {
                    setConfirmImport(false);
                  }}
                />
              </div>
            </div>
          )}
        </section>

        <section aria-label="Run history" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-900">
              Recent runs
            </h3>
            <Button
              title="Refresh history"
              buttonStyle={ButtonStyleType.LINK}
              onClick={(): void => {
                setError(null);
                void refreshHistory();
              }}
            />
          </div>
          <p className="text-xs text-gray-500">
            The 20 most recent runs, including connection tests and previews.
            Times are shown in UTC.
          </p>
          {isLoading && <p role="status">Loading run history…</p>}
          {!isLoading && runs.length === 0 && (
            <p className="text-sm text-gray-500">
              No runs recorded yet. Older polls may not have diagnostic history.
            </p>
          )}
          {runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-gray-500">
                  <tr>
                    <th className="py-2 pr-3">Run</th>
                    <th className="py-2 pr-3">Started (UTC)</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Returned / imported</th>
                    <th className="py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run: GoogleSecOpsConnectionRun): ReactElement => {
                    const result: GoogleSecOpsRunResult | null =
                      readGoogleSecOpsResult(run.result);
                    return (
                      <tr
                        key={run.id?.toString()}
                        className="border-b border-gray-100"
                      >
                        <td className="py-2 pr-3">
                          {googleSecOpsRunLabels[run.type || "poll"]}
                          <div className="text-xs text-gray-500">
                            {run.requestedByUserId
                              ? "Requested on demand"
                              : "Scheduled"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">
                          {run.startedAt
                            ? formatGoogleSecOpsDate(run.startedAt)
                            : "Not started"}
                        </td>
                        <td className="py-2 pr-3">
                          {run.status === "empty"
                            ? "No detections"
                            : run.status}
                        </td>
                        <td className="py-2 pr-3">
                          {result
                            ? `${result.fetchedCount} / ${result.ingestedCount}`
                            : "—"}
                        </td>
                        <td className="py-2">
                          <Button
                            title="View run"
                            buttonStyle={ButtonStyleType.LINK}
                            onClick={(): void => {
                              setSelectedRunId(run.id!.toString());
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};

export default GoogleSecOpsDiagnostics;
