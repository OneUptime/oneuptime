import React, { FunctionComponent, ReactElement } from "react";
import SecurityEventConnectionRun from "Common/Models/DatabaseModels/SecurityEventConnectionRun";
import { JSONObject } from "Common/Types/JSON";
import {
  SecurityConnectorCheck,
  SecurityConnectorCheckStatus,
  SecurityConnectorSample,
  SecurityConnectorTestReport,
} from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  ConnectorAlertingOnlyControl,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import ConnectorTestReportView from "./ConnectorTestReportView";
import {
  ConnectorProviderDetailGroup,
  ConnectorProviderDetailRow,
  connectionEventsRoute,
  connectionTimeTitle,
  connectorCheckStatusLabels,
  connectorProviderDetailGroups,
  connectorProviderTitle,
  connectorSampleEventTime,
  connectorSampleTitle,
  connectorScopeLabel,
  connectorScopeSummary,
  formatConnectionDate,
  formatWindowMinutes,
  normalizeConnectorCheckStatus,
  readConnectorProviderDetails,
  readSecurityConnectorTestReport,
  readSecurityEventConnectionResult,
  readWindowMinutes,
  securityEventConnectionRunLabels,
} from "./SecurityEventConnectionDiagnosticsUtil";

/*
 * A UTC timestamp whose hover text carries the viewer's local time. Every
 * time in the diagnostics modal goes through this so the UTC basis printed
 * on screen and the local basis a reader compares it against are never
 * mixed silently.
 */
export interface ConnectionTimeProps {
  value: string | Date | undefined;
  emptyText?: string | undefined;
}

export const ConnectionTime: FunctionComponent<ConnectionTimeProps> = (
  props: ConnectionTimeProps,
): ReactElement => {
  if (!props.value) {
    return <span>{props.emptyText || "Never"}</span>;
  }

  const iso: string = new Date(props.value).toISOString();

  return (
    <time dateTime={iso} title={connectionTimeTitle(props.value)}>
      {formatConnectionDate(props.value)}
    </time>
  );
};

/*
 * The adaptive catch-up fields a scheduled poll stores on its result. Typed
 * structurally, so a result carried over from the retired Google SecOps
 * connector (which stored the same fields) renders the same notice.
 */
export interface ConnectionWindowProgressResult {
  status: string;
  complete: boolean;
  windowEnd: string;
  chunkMinutes?: number | undefined;
  nextChunkMinutes?: number | undefined;
  forcedAdvance?: boolean | undefined;
}

export function hasConnectionWindowProgress(
  result: ConnectionWindowProgressResult,
): boolean {
  return (
    result.forcedAdvance === true ||
    readWindowMinutes(result.chunkMinutes) !== null ||
    readWindowMinutes(result.nextChunkMinutes) !== null
  );
}

export interface ConnectionWindowProgressProps {
  result: ConnectionWindowProgressResult;
  // Singular noun for what the source imports, e.g. "finding".
  recordName?: string | undefined;
}

/*
 * What a scheduled poll did with a window it could not read in one run.
 * Polling never stays pinned on such a window: it resumes from the last
 * record read, narrows the next window, or, when even one minute holds too
 * much, moves past that minute. The last case loses records until someone
 * imports that minute, so it is an alert with the exact range to import,
 * not one more line in the warnings list.
 */
export const ConnectionWindowProgress: FunctionComponent<
  ConnectionWindowProgressProps
> = (props: ConnectionWindowProgressProps): ReactElement | null => {
  const result: ConnectionWindowProgressResult = props.result;

  if (!hasConnectionWindowProgress(result)) {
    return null;
  }

  const recordName: string = props.recordName || "record";
  const chunk: number | null = readWindowMinutes(result.chunkMinutes);
  const next: number | null = readWindowMinutes(result.nextChunkMinutes);
  const forced: boolean = result.forcedAdvance === true;
  const unread: boolean = !result.complete && result.status !== "failed";
  const recordTitle: string = `${recordName.charAt(0).toUpperCase()}${recordName.slice(1)}`;
  const windowEnd: Date = new Date(result.windowEnd);
  const hasWindowEnd: boolean = Number.isFinite(windowEnd.getTime());
  /*
   * The skipped minute ends at windowEnd. chunkMinutes is rounded up, so
   * this start can be a few seconds before the cursor; a slightly wider
   * import range is harmless because imports skip stored records.
   */
  const skippedStart: Date = new Date(
    windowEnd.getTime() - Math.max(1, chunk || 1) * 60_000,
  );

  return (
    <div className="space-y-3" data-testid="poll-window-progress">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {chunk !== null && (
          <div>
            <dt className="text-gray-500">Window read by this poll</dt>
            <dd>{formatWindowMinutes(chunk)}</dd>
          </div>
        )}
        {next !== null && (
          <div>
            <dt className="text-gray-500">Next scheduled poll reads</dt>
            <dd>
              {next === chunk
                ? `${formatWindowMinutes(next)}, the same length`
                : `Up to ${formatWindowMinutes(next)}`}
            </dd>
          </div>
        )}
      </dl>
      {forced && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
        >
          <h4 className="font-medium">Polling moved past one minute</h4>
          <p>
            More {recordName}s were created in one minute than one poll can
            read. Polling moved past that minute so newer {recordName}s keep
            arriving; the {recordName}s from it that this poll did not read were
            not imported.
          </p>
          {hasWindowEnd ? (
            <p>
              To recover them, use Import this time range under Find historical{" "}
              {recordName}s for <ConnectionTime value={skippedStart} /> →{" "}
              <ConnectionTime value={windowEnd} />. {recordTitle}s already
              imported are skipped.
            </p>
          ) : (
            <p>
              To recover them, use Import this time range under Find historical{" "}
              {recordName}s on the minute named in the warnings. {recordTitle}s
              already imported are skipped.
            </p>
          )}
        </div>
      )}
      {!forced && unread && chunk !== null && next !== null && next < chunk && (
        <p role="alert" className="text-sm text-amber-700">
          This window held more {recordName}s than one poll can read, so the
          cursor stayed where it was. The next scheduled poll reads a window of{" "}
          {formatWindowMinutes(next)} from the same starting point and widens it
          again as polls complete.
        </p>
      )}
      {!forced &&
        unread &&
        chunk !== null &&
        next !== null &&
        next >= chunk && (
          <p role="alert" className="text-sm text-amber-700">
            This poll stopped before the end of its window and moved the cursor
            to the last {recordName} it read. The next scheduled poll continues
            from there with a window of {formatWindowMinutes(next)}.
          </p>
        )}
      {result.status === "failed" && next !== null && (
        <p className="text-sm text-gray-600">
          A failed poll does not change the window: the next scheduled poll
          retries from the same starting point.
        </p>
      )}
    </div>
  );
};

export interface ComponentProps {
  run: SecurityEventConnectionRun;
  /*
   * The parent connection's provider, used when the stored result does not
   * name one (a run carried over from the retired Google SecOps connector).
   */
  provider?: string | undefined;
}

function checkStatusClassName(status: string): string {
  switch (status) {
    case "fail":
      return "font-medium text-red-700";
    case "warn":
      return "font-medium text-amber-700";
    case "skip":
      return "font-medium text-gray-500";
    default:
      return "font-medium text-green-700";
  }
}

const SecurityEventConnectionRunDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const run: SecurityEventConnectionRun = props.run;
  const status: string = run.status || "queued";
  /*
   * Two shapes live in `result`: a synchronous Test connection stores the
   * checklist report, every worker run stores a run result. Read the
   * report first because its `status` values ("pass") are not run statuses.
   */
  const report: SecurityConnectorTestReport | null =
    run.type === "test" ? readSecurityConnectorTestReport(run.result) : null;
  const result: SecurityEventConnectionRunResult | null = report
    ? null
    : readSecurityEventConnectionResult(run.result);
  const error: string | undefined = run.error || result?.error;
  const provider: string =
    result?.provider || report?.provider || props.provider || "";
  const providerTitle: string = connectorProviderTitle(provider);
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(provider);
  const recordName: string = definition?.importedRecordName || "record";
  const scopeControl: ConnectorAlertingOnlyControl | undefined =
    definition?.supportsAlertingOnlyToggle
      ? definition.alertingOnlyControl
      : undefined;
  const providerDetails: JSONObject | undefined = result
    ? readConnectorProviderDetails(result)
    : undefined;
  const includeNonAlerting: unknown =
    providerDetails?.["includeNonAlertingDetections"];
  /*
   * What this run imported, in the provider's own words ("Data to import:
   * Alerts only"), when the connector recorded it. Shown as that line rather
   * than repeated as a raw detail below.
   */
  const showScope: boolean =
    Boolean(scopeControl) && typeof includeNonAlerting === "boolean";
  const detailGroups: Array<ConnectorProviderDetailGroup> =
    connectorProviderDetailGroups(
      providerDetails,
      showScope ? ["includeNonAlertingDetections"] : [],
    );
  // Only a source that says which records are alerts gets the column.
  const showAlertColumn: boolean = Boolean(
    result?.samples.some((sample: SecurityConnectorSample): boolean => {
      return typeof sample.isAlert === "boolean";
    }),
  );

  return (
    <section
      aria-label="Run details"
      className="space-y-4 rounded-md border border-gray-200 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">
          {securityEventConnectionRunLabels[run.type || "poll"]} details
        </h3>
        <CopyTextButton
          label="Copy diagnostics"
          textToBeCopied={JSON.stringify(
            {
              runId: run.id?.toString(),
              type: run.type,
              status,
              startedAt: run.startedAt,
              completedAt: run.completedAt,
              request: run.request,
              result: report || result,
              error,
            },
            null,
            2,
          )}
          size="sm"
          variant="soft"
        />
      </div>
      <p role="status" className="text-sm text-gray-700">
        {status === "queued"
          ? "Queued — waiting for a worker. You can close this window and return to run history."
          : status === "running"
            ? `Running — checking ${providerTitle || "the source"}. Results update automatically.`
            : `Result: ${status === "empty" ? "No records returned" : status.charAt(0).toUpperCase() + status.slice(1)}`}
      </p>
      {status === "queued" &&
        run.createdAt &&
        Date.now() - new Date(run.createdAt).getTime() > 120_000 && (
          <p className="text-sm text-amber-700">
            This run has been waiting for more than 2 minutes. Use Test
            connection to check whether a worker is consuming the queue.
          </p>
        )}
      {/*
       * A failed synchronous test stores its summary as the run error; the
       * report banner below already shows it, so it is not repeated here.
       */}
      {error && !report && (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words rounded-md bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {!result &&
        !report &&
        typeof run.request?.["startTime"] === "string" &&
        typeof run.request?.["endTime"] === "string" && (
          <p className="text-sm text-gray-600">
            Requested window:{" "}
            <ConnectionTime value={run.request["startTime"] as string} /> →{" "}
            <ConnectionTime value={run.request["endTime"] as string} />
          </p>
        )}
      {report && <ConnectorTestReportView report={report} />}
      {result && (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Requested window (UTC)</dt>
              <dd>
                <ConnectionTime value={result.windowStart} /> →{" "}
                <ConnectionTime value={result.windowEnd} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Provider</dt>
              <dd>{providerTitle}</dd>
            </div>
            {showScope && (
              <div>
                <dt className="text-gray-500">
                  {connectorScopeLabel(definition)}
                </dt>
                <dd>
                  {connectorScopeSummary(
                    definition,
                    includeNonAlerting !== true,
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Completed (UTC)</dt>
              <dd>
                <ConnectionTime value={result.completedAt} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Duration</dt>
              <dd>{(result.durationMs / 1000).toFixed(1)} seconds</dd>
            </div>
          </dl>
          <ConnectionWindowProgress result={result} recordName={recordName} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                [`Returned by ${providerTitle}`, result.fetchedCount],
                ["Imported into OneUptime", result.ingestedCount],
                [
                  "Already imported",
                  run.type === "test" || run.type === "preview"
                    ? "Not checked"
                    : result.duplicateCount,
                ],
                ["Rejected", result.rejectedCount],
                ["Failed", result.failedCount],
              ] as Array<[string, string | number]>
            ).map(([label, value]: [string, string | number]): ReactElement => {
              return (
                <div key={label} className="rounded-md bg-gray-50 p-3">
                  <div className="text-xl font-semibold text-gray-900">
                    {value.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-600">{label}</div>
                </div>
              );
            })}
          </div>
          {detailGroups.length > 0 && (
            <section aria-label="Provider details" className="text-sm">
              <h4 className="mb-2 text-sm font-medium">Provider details</h4>
              <div className="space-y-3">
                {detailGroups.map(
                  (group: ConnectorProviderDetailGroup): ReactElement => {
                    return (
                      <div key={group.key || "general"}>
                        {group.title && (
                          <h5 className="text-xs font-medium text-gray-700">
                            {group.title}
                          </h5>
                        )}
                        <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          {group.rows.map(
                            (row: ConnectorProviderDetailRow): ReactElement => {
                              return (
                                <div key={row.key} data-detail-key={row.key}>
                                  <dt className="text-gray-500">{row.label}</dt>
                                  <dd>{row.value}</dd>
                                </div>
                              );
                            },
                          )}
                        </dl>
                      </div>
                    );
                  },
                )}
              </div>
            </section>
          )}
          {run.type === "test" && (
            <p className="text-sm text-gray-600">
              This checks credentials and access to {providerTitle}. It does not
              import events or confirm that scheduled polling is working.
            </p>
          )}
          {run.type === "preview" && (
            <p className="text-sm text-gray-600">
              Preview reads {providerTitle} without importing events or changing
              scheduled polling.
            </p>
          )}
          {result.status === "empty" && (
            <p className="text-sm text-gray-600">
              {`${providerTitle} returned no matching records for this time range. Try a wider range, or use Test connection to see what is available to import.${
                scopeControl && includeNonAlerting === false
                  ? ` Only ${scopeControl.alertingLabel.toLowerCase()} are imported with this ${scopeControl.title} selection; select ${scopeControl.nonAlertingLabel} to import the rest.`
                  : ""
              }`}
            </p>
          )}
          {!result.complete &&
            run.type !== "test" &&
            !hasConnectionWindowProgress(result) && (
              <p role="alert" className="text-sm text-amber-700">
                This run did not finish processing every record in the window.
                {run.type === "preview" || run.type === "backfill"
                  ? " Choose a shorter time range to read the rest; records already imported are skipped."
                  : " Review the checks and warnings before retrying."}
              </p>
            )}
          {result.warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <h4 className="font-medium">Warnings</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {result.warnings.map(
                  (warning: string, index: number): ReactElement => {
                    return (
                      <li
                        key={index}
                        className="whitespace-pre-wrap break-words"
                      >
                        {warning}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          )}
          {result.checks.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Connection checks</h4>
              <ul className="space-y-2 text-sm">
                {result.checks.map(
                  (
                    check: SecurityConnectorCheck,
                    index: number,
                  ): ReactElement => {
                    const status: string = normalizeConnectorCheckStatus(
                      check.status,
                    );
                    return (
                      <li key={`${check.key}-${index}`}>
                        <span className={checkStatusClassName(status)}>
                          {check.name}:{" "}
                          {connectorCheckStatusLabels[
                            status as SecurityConnectorCheckStatus
                          ] || status}
                        </span>
                        <p className="text-gray-600">{check.message}</p>
                        {check.remediation && status !== "pass" && (
                          <p className="text-gray-800">{check.remediation}</p>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          )}
          {result.samples.length > 0 && (
            <div>
              <h4 className="text-sm font-medium">Sample records</h4>
              <p className="mt-1 text-xs text-gray-500">
                Event time can be earlier than the time {providerTitle} created
                the record. Samples may cover only part of the result.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-200 text-gray-500">
                    <tr>
                      <th className="py-2 pr-4">Record</th>
                      <th className="py-2 pr-4">Severity</th>
                      <th className="py-2 pr-4">Event time (UTC)</th>
                      <th className={showAlertColumn ? "py-2 pr-4" : "py-2"}>
                        Created at source (UTC)
                      </th>
                      {showAlertColumn && <th className="py-2">Alert</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.samples.map(
                      (
                        sample: SecurityConnectorSample,
                        index: number,
                      ): ReactElement => {
                        return (
                          <tr
                            key={`${sample.id}-${index}`}
                            className="border-b border-gray-100"
                          >
                            <td className="max-w-xs break-words py-2 pr-4">
                              {connectorSampleTitle(sample) || "Untitled"}
                              <div className="text-xs text-gray-500">
                                {sample.id}
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              {sample.severity || "Unknown"}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4">
                              <ConnectionTime
                                value={connectorSampleEventTime(sample)}
                                emptyText="Not provided"
                              />
                            </td>
                            <td
                              className={
                                showAlertColumn
                                  ? "whitespace-nowrap py-2 pr-4"
                                  : "whitespace-nowrap py-2"
                              }
                            >
                              <ConnectionTime
                                value={sample.createdTime}
                                emptyText="Not provided"
                              />
                            </td>
                            {showAlertColumn && (
                              <td className="py-2">
                                {sample.isAlert === undefined
                                  ? "Unknown"
                                  : sample.isAlert
                                    ? "Yes"
                                    : "No"}
                              </td>
                            )}
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {(result.ingestedCount > 0 || result.duplicateCount > 0) && (
            <div className="text-sm">
              <Link
                className="font-medium text-indigo-600 hover:text-indigo-800"
                to={connectionEventsRoute(
                  result,
                  run.securityEventConnectionId?.toString(),
                )}
              >
                View events in this time range
              </Link>
              <p className="mt-1 text-gray-500">
                Opens the event-time range of these records, including records
                created later.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default SecurityEventConnectionRunDetails;
