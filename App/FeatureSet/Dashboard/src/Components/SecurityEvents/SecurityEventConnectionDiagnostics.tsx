import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "Common/Models/DatabaseModels/SecurityEventConnectionRun";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import { SecurityConnectorTestReport } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectionRunResult,
  SecurityEventConnectionRunType,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { APP_API_URL } from "Common/UI/Config";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  CONNECTION_TEST_PROGRESS_MESSAGE,
  runConnectionTestRequest,
} from "./ConnectionTestModal";
import ConnectorTestReportView from "./ConnectorTestReportView";
import {
  SECURITY_EVENT_CONNECTION_TEST_ROUTE,
  connectorHealth,
  connectorHealthTooltip,
  connectorNextPoll,
  connectorProviderTitle,
  formatConnectionDate,
  readSecurityEventConnectionResult,
  securityEventConnectionRunLabels,
  validateConnectionRange,
} from "./SecurityEventConnectionDiagnosticsUtil";
import SecurityEventConnectionRunDetails, {
  ConnectionTime,
} from "./SecurityEventConnectionRunDetails";

export interface ComponentProps {
  connection: SecurityEventConnection;
  canRun: boolean;
  disabledReason?: string | undefined;
  onClose: () => void;
  onUpdated: () => void;
  /*
   * "poll" queues a poll as soon as the modal opens (the table's Run now
   * action); "test" runs the synchronous connection test on open.
   */
  initialAction?: "test" | "poll" | undefined;
}

function localDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/*
 * Provider-agnostic twin of GoogleSecOpsDiagnostics. Structure and wording
 * match on purpose so a customer with both families learns one modal.
 *
 * One deliberate difference: Test connection here is synchronous (the API
 * runs it, no worker involved) and its checklist renders inline, so the
 * modal can say "no worker is consuming the queue" in exactly the
 * situation where a queued test would hang forever.
 */
const SecurityEventConnectionDiagnostics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [connection, setConnection] = useState<SecurityEventConnection>(
    props.connection,
  );
  const [runs, setRuns] = useState<Array<SecurityEventConnectionRun>>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testReport, setTestReport] =
    useState<SecurityConnectorTestReport | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
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

  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(connection.provider);
  const providerTitle: string = connectorProviderTitle(
    connection.provider || "",
  );
  const recordName: string = definition?.importedRecordName || "record";

  const refreshHistory: () => Promise<boolean> =
    useCallback(async (): Promise<boolean> => {
      const sequence: number = ++requestSequence.current;
      try {
        const [history, freshConnection]: [
          ListResult<SecurityEventConnectionRun>,
          SecurityEventConnection | null,
        ] = await Promise.all([
          ModelAPI.getList<SecurityEventConnectionRun>({
            modelType: SecurityEventConnectionRun,
            query: {
              projectId: props.connection.projectId!,
              securityEventConnectionId: props.connection.id!,
            },
            limit: 20,
            skip: 0,
            sort: { createdAt: SortOrder.Descending },
            select: {
              _id: true,
              securityEventConnectionId: true,
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
          /*
           * `secrets` is never selected: the column is write-only on the
           * model and this modal has no use for it.
           */
          ModelAPI.getItem<SecurityEventConnection>({
            modelType: SecurityEventConnection,
            id: props.connection.id!,
            select: {
              _id: true,
              projectId: true,
              name: true,
              provider: true,
              createdAt: true,
              isEnabled: true,
              pollIntervalInMinutes: true,
              alertingOnly: true,
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
            (run: SecurityEventConnectionRun): boolean => {
              return run.id?.toString() === current;
            },
          )
            ? current
            : history.data[0]?.id?.toString() || null;
        });
        setIsLoading(false);
        return history.data.some((run: SecurityEventConnectionRun): boolean => {
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

  const runTest: () => Promise<void> = async (): Promise<void> => {
    if (!props.canRun || isTesting) {
      return;
    }
    setIsTesting(true);
    /*
     * A new test replaces the last outcome: a failed re-run must not leave
     * the previous checklist on screen next to its error.
     */
    setTestReport(null);
    setTestError(null);
    try {
      const report: SecurityConnectorTestReport =
        await runConnectionTestRequest({
          route: SECURITY_EVENT_CONNECTION_TEST_ROUTE,
          body: { connectionId: props.connection.id!.toString() },
        });
      if (!mounted.current) {
        return;
      }
      setTestReport(report);
      // The API records the test as a run row; show it in history now.
      setPollingRevision((value: number): number => {
        return value + 1;
      });
      updatedCallback.current();
    } catch (err) {
      if (mounted.current) {
        setTestError(API.getFriendlyErrorMessage(err as Error));
      }
    } finally {
      if (mounted.current) {
        setIsTesting(false);
      }
    }
  };

  const submitRun: (
    type: SecurityEventConnectionRunType,
  ) => Promise<void> = async (
    type: SecurityEventConnectionRunType,
  ): Promise<void> => {
    if (!props.canRun || isSubmitting) {
      return;
    }
    const hasRange: boolean = type === "preview" || type === "backfill";
    const validationError: string | null = hasRange
      ? validateConnectionRange(startTime, endTime)
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
            `/security-event-connection/${props.connection.id!.toString()}/run`,
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
      if (props.initialAction === "test") {
        void runTest();
      } else {
        void submitRun(props.initialAction);
      }
    }
  }, []);

  const selectedRun: SecurityEventConnectionRun | undefined = runs.find(
    (run: SecurityEventConnectionRun): boolean => {
      return run.id?.toString() === selectedRunId;
    },
  );
  const hasPendingRun: boolean = runs.some(
    (run: SecurityEventConnectionRun): boolean => {
      return run.status === "queued" || run.status === "running";
    },
  );
  const disableActions: boolean =
    !props.canRun ||
    isLoading ||
    isSubmitting ||
    hasPendingRun ||
    Boolean(selectedRunId && !selectedRun);
  const nextPoll: Date | null = connectorNextPoll(connection);
  const rangeError: string | null = validateConnectionRange(startTime, endTime);
  const health: string = connectorHealth(connection);

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
      title={`Connection diagnostics: ${connection.name || providerTitle}`}
      description={`Check access, inspect what ${providerTitle} returns, and review imports. Times are shown in UTC; hover a time for your local clock.`}
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
            <span title={connectorHealthTooltip(health)}>{health}</span> ·{" "}
            {connection.isEnabled
              ? `Enabled, every ${connection.pollIntervalInMinutes || 5} minutes`
              : "Disabled"}
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Provider</dt>
              <dd>{providerTitle}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Last attempt (UTC)</dt>
              <dd>
                <ConnectionTime value={connection.lastPolledAt} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Last successful poll (UTC)</dt>
              <dd>
                <ConnectionTime value={connection.lastSuccessfulPollAt} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Last event imported (UTC)</dt>
              <dd>
                <ConnectionTime value={connection.lastEventIngestedAt} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Next scheduled poll (UTC)</dt>
              <dd>
                {!connection.isEnabled ? (
                  "Paused"
                ) : nextPoll ? (
                  <>
                    <ConnectionTime value={nextPoll} /> (approximate)
                  </>
                ) : (
                  "Next worker tick"
                )}
              </dd>
            </div>
            {definition?.supportsAlertingOnlyToggle && (
              <div>
                <dt className="text-gray-500">Scope</dt>
                <dd>
                  {connection.alertingOnly === false
                    ? "Alerts and detections"
                    : "Alerts only"}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            Enabled controls the schedule. Poll outcomes include Run now; review
            scheduled runs in history to confirm recurring polling. Change
            settings using Edit connection.
          </p>
        </section>

        <section aria-label="On-demand checks" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              title="Test connection"
              buttonStyle={ButtonStyleType.OUTLINE}
              disabled={!props.canRun || isTesting}
              isLoading={isTesting}
              tooltip={props.disabledReason}
              onClick={(): void => {
                void runTest();
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
            Test connection checks access to {providerTitle}, what it has
            available to import, and whether OneUptime&apos;s workers and
            scheduler are running. It runs immediately and imports nothing. Run
            now imports the next poll window immediately, including when the
            schedule is paused.
          </p>
          {!props.canRun && (
            <p className="text-sm text-gray-500">
              {props.disabledReason ||
                "Only project owners, project administrators, and security administrators can start runs. You can still review run history."}
            </p>
          )}
          {isTesting && (
            <p role="status" className="text-sm text-gray-600">
              {CONNECTION_TEST_PROGRESS_MESSAGE}
            </p>
          )}
          {testError && !isTesting && <ErrorMessage message={testError} />}
          {testReport && !isTesting && (
            <ConnectorTestReportView
              report={testReport}
              providerTitle={providerTitle}
            />
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
        {selectedRun && <SecurityEventConnectionRunDetails run={selectedRun} />}
        {!selectedRun && selectedRunId && !error && !historyError && (
          <p role="status" className="text-sm text-gray-600">
            Waiting for the run to appear in history…
          </p>
        )}

        <section
          aria-label="Historical records"
          className="space-y-3 rounded-md border border-gray-200 p-4"
        >
          <h3 className="text-base font-semibold text-gray-900">
            Find historical {recordName}s
          </h3>
          <p className="text-sm text-gray-600">
            Preview a window before importing. The first scheduled poll looks
            back 24 hours; older {recordName}s need a historical import. Choose
            up to 7 days per run.
          </p>
          <label
            className="block text-sm font-medium text-gray-700"
            htmlFor="security-event-connection-range"
          >
            Time range
          </label>
          <select
            id="security-event-connection-range"
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
                htmlFor="security-event-connection-start"
              >
                Start (your local time)
              </label>
              <input
                id="security-event-connection-start"
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
                htmlFor="security-event-connection-end"
              >
                End (your local time)
              </label>
              <input
                id="security-event-connection-end"
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
              title="Preview records"
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
                Import {recordName}s from{" "}
                {formatConnectionDate(new Date(startTime))} to{" "}
                {formatConnectionDate(new Date(endTime))} into OneUptime?
                Imported events become available to security rules and monitors.
                Already imported {recordName}s are skipped.
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
            Times are shown in UTC; hover a time for your local clock.
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
                  {runs.map((run: SecurityEventConnectionRun): ReactElement => {
                    const result: SecurityEventConnectionRunResult | null =
                      run.type === "test"
                        ? null
                        : readSecurityEventConnectionResult(run.result);
                    return (
                      <tr
                        key={run.id?.toString()}
                        className="border-b border-gray-100"
                      >
                        <td className="py-2 pr-3">
                          {securityEventConnectionRunLabels[run.type || "poll"]}
                          <div className="text-xs text-gray-500">
                            {run.requestedByUserId
                              ? "Requested on demand"
                              : "Scheduled"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">
                          <ConnectionTime
                            value={run.startedAt}
                            emptyText="Not started"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          {run.status === "empty" ? "No records" : run.status}
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

export default SecurityEventConnectionDiagnostics;
