import React, { FunctionComponent, ReactElement } from "react";
import GoogleSecOpsConnectionRun from "Common/Models/DatabaseModels/GoogleSecOpsConnectionRun";
import {
  GoogleSecOpsRunResult,
  GoogleSecOpsDiagnosticCheck,
  GoogleSecOpsDetectionSample,
} from "Common/Types/SecurityEvent/GoogleSecOpsDiagnostics";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import {
  formatGoogleSecOpsDate,
  googleSecOpsEventsRoute,
  googleSecOpsRunLabels,
  readGoogleSecOpsResult,
} from "./GoogleSecOpsDiagnosticsUtil";

export interface ComponentProps {
  run: GoogleSecOpsConnectionRun;
}

const GoogleSecOpsRunDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const run: GoogleSecOpsConnectionRun = props.run;
  const result: GoogleSecOpsRunResult | null = readGoogleSecOpsResult(
    run.result,
  );
  const status: string = run.status || "queued";
  const error: string | undefined = run.error || result?.error;

  return (
    <section
      aria-label="Run details"
      className="space-y-4 rounded-md border border-gray-200 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">
          {googleSecOpsRunLabels[run.type || "poll"]} details
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
              result,
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
            ? "Running — checking Google SecOps. Results update automatically."
            : `Result: ${status === "empty" ? "No detections returned" : status.charAt(0).toUpperCase() + status.slice(1)}`}
      </p>
      {status === "queued" &&
        run.createdAt &&
        Date.now() - new Date(run.createdAt).getTime() > 120_000 && (
          <p className="text-sm text-amber-700">
            This run has been waiting for more than 2 minutes. Check that a
            worker is available.
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
        typeof run.request?.["startTime"] === "string" &&
        typeof run.request?.["endTime"] === "string" && (
          <p className="text-sm text-gray-600">
            Requested window:{" "}
            {formatGoogleSecOpsDate(run.request["startTime"] as string)} →{" "}
            {formatGoogleSecOpsDate(run.request["endTime"] as string)}
          </p>
        )}
      {result && (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Requested window (UTC)</dt>
              <dd>
                {formatGoogleSecOpsDate(result.windowStart)} →{" "}
                {formatGoogleSecOpsDate(result.windowEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Scope used</dt>
              <dd>
                {result.includeNonAlertingDetections
                  ? "Alerts and detections"
                  : "Alerts only"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Completed</dt>
              <dd>{formatGoogleSecOpsDate(result.completedAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Duration</dt>
              <dd>{(result.durationMs / 1000).toFixed(1)} seconds</dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                ["Returned by Google", result.fetchedCount],
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
              This checks credentials and access to Google SecOps. It does not
              import events or confirm that scheduled polling is working.
            </p>
          )}
          {run.type === "preview" && (
            <p className="text-sm text-gray-600">
              Preview reads Google SecOps without importing events or changing
              scheduled polling.
            </p>
          )}
          {result.status === "empty" && (
            <p className="text-sm text-gray-600">
              Google returned no matching detections for this scope and time
              range. Try a wider range or check whether the rule creates alerts.
            </p>
          )}
          {!result.complete && run.type !== "test" && (
            <p role="alert" className="text-sm text-amber-700">
              This run did not finish processing every detection in the window.
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
                    check: GoogleSecOpsDiagnosticCheck,
                    index: number,
                  ): ReactElement => {
                    return (
                      <li key={index}>
                        <span
                          className={
                            check.status === "failed"
                              ? "font-medium text-red-700"
                              : "font-medium text-green-700"
                          }
                        >
                          {check.name}: {check.status}
                        </span>
                        <p className="text-gray-600">{check.message}</p>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          )}
          {result.samples.length > 0 && (
            <div>
              <h4 className="text-sm font-medium">Detection samples</h4>
              <p className="mt-1 text-xs text-gray-500">
                Detection time can be earlier than the time Google created the
                detection. Samples may cover only part of the result.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-200 text-gray-500">
                    <tr>
                      <th className="py-2 pr-4">Rule</th>
                      <th className="py-2 pr-4">Detection time (UTC)</th>
                      <th className="py-2 pr-4">Created in Google (UTC)</th>
                      <th className="py-2">Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.samples.map(
                      (
                        sample: GoogleSecOpsDetectionSample,
                        index: number,
                      ): ReactElement => {
                        return (
                          <tr
                            key={`${sample.id}-${index}`}
                            className="border-b border-gray-100"
                          >
                            <td className="max-w-xs break-words py-2 pr-4">
                              {sample.ruleName || "Unnamed rule"}
                              <div className="text-xs text-gray-500">
                                {sample.id}
                              </div>
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4">
                              {sample.detectionTime
                                ? formatGoogleSecOpsDate(sample.detectionTime)
                                : "Not provided"}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4">
                              {sample.createdTime
                                ? formatGoogleSecOpsDate(sample.createdTime)
                                : "Not provided"}
                            </td>
                            <td className="py-2">
                              {sample.isAlert === undefined
                                ? "Unknown"
                                : sample.isAlert
                                  ? "Yes"
                                  : "No"}
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
                to={googleSecOpsEventsRoute(
                  result,
                  run.googleSecOpsConnectionId?.toString(),
                )}
              >
                View events in this time range
              </Link>
              <p className="mt-1 text-gray-500">
                Opens the event-time range of these detections, including
                detections created later.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default GoogleSecOpsRunDetails;
