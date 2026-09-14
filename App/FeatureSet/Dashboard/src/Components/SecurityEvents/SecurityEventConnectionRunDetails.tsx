import React, { FunctionComponent, ReactElement } from "react";
import SecurityEventConnectionRun from "Common/Models/DatabaseModels/SecurityEventConnectionRun";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
  SecurityConnectorTestReport,
} from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import ConnectorTestReportView from "./ConnectorTestReportView";
import {
  connectionEventsRoute,
  connectionTimeTitle,
  connectorCheckStatusLabels,
  connectorProviderTitle,
  formatConnectionDate,
  readSecurityConnectorTestReport,
  readSecurityEventConnectionResult,
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

export interface ComponentProps {
  run: SecurityEventConnectionRun;
}

function checkStatusClassName(
  status: SecurityConnectorCheck["status"],
): string {
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
  const providerTitle: string = connectorProviderTitle(
    result?.provider || report?.provider || "",
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
      {error && (
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
              {providerTitle} returned no matching records for this time range.
              Try a wider range, or use Test connection to see what is available
              to import.
            </p>
          )}
          {!result.complete && run.type !== "test" && (
            <p role="alert" className="text-sm text-amber-700">
              This run did not finish processing every record in the window.
              Review the checks and warnings before retrying.
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
                    return (
                      <li key={`${check.key}-${index}`}>
                        <span className={checkStatusClassName(check.status)}>
                          {check.name}:{" "}
                          {connectorCheckStatusLabels[check.status] ||
                            check.status}
                        </span>
                        <p className="text-gray-600">{check.message}</p>
                        {check.remediation && check.status !== "pass" && (
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
                      <th className="py-2">Created at source (UTC)</th>
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
                              {sample.title || "Untitled"}
                              <div className="text-xs text-gray-500">
                                {sample.id}
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              {sample.severity || "Unknown"}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4">
                              <ConnectionTime
                                value={sample.eventTime}
                                emptyText="Not provided"
                              />
                            </td>
                            <td className="whitespace-nowrap py-2">
                              <ConnectionTime
                                value={sample.createdTime}
                                emptyText="Not provided"
                              />
                            </td>
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
