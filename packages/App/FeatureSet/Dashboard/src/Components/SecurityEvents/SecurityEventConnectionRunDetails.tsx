import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
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
  connectorRecordsName,
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
  securityEventConnectionRunDetailsTitles,
  windowMinutesValue,
} from "./SecurityEventConnectionDiagnosticsUtil";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  TemplateValue,
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import readAsWritten from "Common/UI/Components/IsolatedText/ReadAsWritten";
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";

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
  const translator: Translator = useTranslator();

  if (!props.value) {
    const emptyText: string = props.emptyText || translationKey("Never");
    return <span>{translator.translateText(emptyText) || emptyText}</span>;
  }

  const iso: string = new Date(props.value).toISOString();

  return (
    /*
     * "2026-11-11 01:51:25 UTC" is written the same in every language, so it
     * reads left to right on an Arabic or Persian page too: alone in a cell
     * the page's direction put "UTC" first, while the same time inside a
     * sentence read as written.
     */
    <time
      dir="ltr"
      dateTime={iso}
      title={connectionTimeTitle(props.value, translator)}
    >
      {formatConnectionDate(props.value, translator)}
    </time>
  );
};

export interface ConnectionTimeRangeProps {
  start: string | Date | undefined;
  end: string | Date | undefined;
}

/*
 * "start → end", the arrow pointing the way the page reads (DirectionArrow):
 * on an Arabic or Persian page the start stands on the right, so the arrow
 * points left, as those languages' sentences write a window ("{{start}} ←
 * {{end}}"). Each time keeps to one line, so a narrow column breaks the
 * range at the arrow, never inside a time.
 */
export const ConnectionTimeRange: FunctionComponent<
  ConnectionTimeRangeProps
> = (props: ConnectionTimeRangeProps): ReactElement => {
  return (
    <span>
      <span className="whitespace-nowrap">
        <ConnectionTime value={props.start} /> <DirectionArrow />
      </span>{" "}
      <span className="whitespace-nowrap">
        <ConnectionTime value={props.end} />
      </span>
    </span>
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
  /*
   * What the source imports, more than one of them, in English: a key of
   * CONNECTOR_RECORDS_NAMES ("detections"). Each sentence names it in its
   * own language.
   */
  recordsName?: string | undefined;
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
  const translator: Translator = useTranslator();
  const result: ConnectionWindowProgressResult = props.result;

  if (!hasConnectionWindowProgress(result)) {
    return null;
  }

  const records: TemplateValue = translatableTerm(
    props.recordsName || "records",
    { inSentence: true },
  );
  const chunk: number | null = readWindowMinutes(result.chunkMinutes);
  const next: number | null = readWindowMinutes(result.nextChunkMinutes);
  const forced: boolean = result.forcedAdvance === true;
  const unread: boolean = !result.complete && result.status !== "failed";
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
            <dt className="text-gray-500">
              {translator.translateText("Window read by this poll")}
            </dt>
            <dd>{formatWindowMinutes(chunk, translator)}</dd>
          </div>
        )}
        {next !== null && (
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Next scheduled poll reads")}
            </dt>
            <dd>
              {next === chunk
                ? translator.translateTemplate("{{window}}, the same length", {
                    window: windowMinutesValue(next),
                  })
                : translator.translateTemplate("Up to {{window}}", {
                    window: windowMinutesValue(next),
                  })}
            </dd>
          </div>
        )}
      </dl>
      {forced && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
        >
          <h4 className="font-medium">
            {translator.translateText("Polling moved past one minute")}
          </h4>
          <p>
            {translator.translateTemplate(
              "More {{records}} were created in one minute than one poll can read. Polling moved past that minute so newer {{records}} keep arriving; the {{records}} from it that this poll did not read were not imported.",
              { records },
            )}
          </p>
          {hasWindowEnd ? (
            <p>
              <TranslatedSentence
                template="To recover them, use Import this time range under Find historical {{records}} for {{start}} → {{end}}. Any already imported are skipped."
                values={{ records }}
                slots={{
                  start: <ConnectionTime value={skippedStart} />,
                  end: <ConnectionTime value={windowEnd} />,
                }}
              />
            </p>
          ) : (
            <p>
              {translator.translateTemplate(
                "To recover them, use Import this time range under Find historical {{records}} on the minute named in the warnings. Any already imported are skipped.",
                { records },
              )}
            </p>
          )}
        </div>
      )}
      {!forced && unread && chunk !== null && next !== null && next < chunk && (
        <p role="alert" className="text-sm text-amber-700">
          {translator.translateTemplate(
            "This window held more {{records}} than one poll can read, so the cursor stayed where it was. The next scheduled poll reads a window of {{window}} from the same starting point and widens it again as polls complete.",
            { records, window: windowMinutesValue(next) },
          )}
        </p>
      )}
      {!forced &&
        unread &&
        chunk !== null &&
        next !== null &&
        next >= chunk && (
          <p role="alert" className="text-sm text-amber-700">
            {translator.translateTemplate(
              "This poll stopped before the end of its window and moved the cursor to the last record it read. The next scheduled poll continues from there with a window of {{window}}.",
              { window: windowMinutesValue(next) },
            )}
          </p>
        )}
      {result.status === "failed" && next !== null && (
        <p className="text-sm text-gray-600">
          {translator.translateText(
            "A failed poll does not change the window: the next scheduled poll retries from the same starting point.",
          )}
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

/*
 * The line a run's status reads as: "Result: Success". A status the server
 * adds later is shown as stored, capitalised.
 */
const RUN_RESULT_STATUS_LABELS: Record<string, string> = {
  success: translationKey("Success"),
  empty: translationKey("No records returned"),
  partial: translationKey("Partial"),
  failed: translationKey("Failed"),
};

const SecurityEventConnectionRunDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
  const recordsName: string = connectorRecordsName(definition);
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
      translator,
    );
  // Only a source that says which records are alerts gets the column.
  const showAlertColumn: boolean = Boolean(
    result?.samples.some((sample: SecurityConnectorSample): boolean => {
      return typeof sample.isAlert === "boolean";
    }),
  );

  /*
   * The sample records' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a record gives way, a severity or a time never.
   */
  const sampleColumns: ResizableColumns = useResizableColumns({
    tableKey: "security-connection-run-samples-table",
    columns: [
      { id: "record", cellNumber: 1 },
      { id: "severity", cellNumber: 2 },
      { id: "eventTime", cellNumber: 3 },
      { id: "createdAtSource", cellNumber: 4 },
      ...(showAlertColumn ? [{ id: "alert", cellNumber: 5 }] : []),
    ],
  });

  // Each header names its column, and its resize edge, in the reader's words.
  const recordTitle: string = translator.translateText("Record") || "Record";
  const severityTitle: string =
    translator.translateText("Severity") || "Severity";
  const eventTimeTitle: string =
    translator.translateText("Event time (UTC)") || "Event time (UTC)";
  const createdAtSourceTitle: string =
    translator.translateText("Created at source (UTC)") ||
    "Created at source (UTC)";
  const alertTitle: string = translator.translateText("Alert") || "Alert";

  const resultStatusEnglish: string | undefined =
    RUN_RESULT_STATUS_LABELS[status];
  const resultStatusLabel: string = resultStatusEnglish
    ? translator.translateText(resultStatusEnglish) || resultStatusEnglish
    : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;

  let statusLine: string = translator.translateTemplate("Result: {{status}}", {
    status: resultStatusLabel,
  });

  if (status === "queued") {
    statusLine =
      translator.translateText(
        "Queued — waiting for a worker. You can close this window and return to run history.",
      ) || "";
  } else if (status === "running") {
    statusLine = providerTitle
      ? translator.translateTemplate(
          "Running — checking {{provider}}. Results update automatically.",
          { provider: providerTitle },
        )
      : translator.translateText(
          "Running — checking the source. Results update automatically.",
        ) || "";
  }

  const statTiles: Array<[string, string | number]> = result
    ? [
        [
          translator.translateTemplate("Returned by {{provider}}", {
            provider: providerTitle,
          }),
          result.fetchedCount,
        ],
        [
          translator.translateText("Imported into OneUptime") ||
            "Imported into OneUptime",
          result.ingestedCount,
        ],
        [
          translator.translateText("Already imported") || "Already imported",
          run.type === "test" || run.type === "preview"
            ? translator.translateText("Not checked") || "Not checked"
            : result.duplicateCount,
        ],
        [
          translator.translateText("Rejected") || "Rejected",
          result.rejectedCount,
        ],
        [translator.translateText("Failed") || "Failed", result.failedCount],
      ]
    : [];

  return (
    <section
      aria-label={translator.translateText("Run details")}
      className="space-y-4 rounded-md border border-gray-200 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">
          {translator.translateText(
            securityEventConnectionRunDetailsTitles[run.type || "poll"],
          )}
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
        {statusLine}
      </p>
      {status === "queued" &&
        run.createdAt &&
        Date.now() - new Date(run.createdAt).getTime() > 120_000 && (
          <p className="text-sm text-amber-700">
            {translator.translateText(
              "This run has been waiting for more than 2 minutes. Use Test connection to check whether a worker is consuming the queue.",
            )}
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
            <TranslatedSentence
              template="Requested window: {{start}} → {{end}}"
              slots={{
                start: (
                  <ConnectionTime value={run.request["startTime"] as string} />
                ),
                end: (
                  <ConnectionTime value={run.request["endTime"] as string} />
                ),
              }}
            />
          </p>
        )}
      {report && <ConnectorTestReportView report={report} />}
      {result && (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Requested window (UTC)")}
              </dt>
              <dd>
                <ConnectionTimeRange
                  start={result.windowStart}
                  end={result.windowEnd}
                />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Provider")}
              </dt>
              <dd>{providerTitle}</dd>
            </div>
            {showScope && (
              <div>
                <dt className="text-gray-500">
                  {translator.translateText(connectorScopeLabel(definition))}
                </dt>
                <dd>
                  {translator.translateText(
                    connectorScopeSummary(
                      definition,
                      includeNonAlerting !== true,
                    ),
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Completed (UTC)")}
              </dt>
              <dd>
                <ConnectionTime value={result.completedAt} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Duration")}
              </dt>
              <dd>
                {translator.translateTemplate("{{seconds}} seconds", {
                  seconds: (result.durationMs / 1000).toLocaleString(
                    getReaderNumberLocale(),
                    { minimumFractionDigits: 1, maximumFractionDigits: 1 },
                  ),
                })}
              </dd>
            </div>
          </dl>
          <ConnectionWindowProgress result={result} recordsName={recordsName} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {statTiles.map(
              ([label, value]: [string, string | number]): ReactElement => {
                return (
                  <div key={label} className="rounded-md bg-gray-50 p-3">
                    {/*
                     * A count in the tile's large figure; a word in its
                     * place ("Not checked") is quieter, on the same line
                     * height, so the tiles stay level.
                     */}
                    {typeof value === "number" ? (
                      <div className="text-xl font-semibold text-gray-900">
                        {value.toLocaleString(getReaderNumberLocale())}
                      </div>
                    ) : (
                      <div className="text-sm font-medium leading-7 text-gray-500">
                        {value}
                      </div>
                    )}
                    <div className="text-xs text-gray-600">{label}</div>
                  </div>
                );
              },
            )}
          </div>
          {detailGroups.length > 0 && (
            <section
              aria-label={translator.translateText("Provider details")}
              className="text-sm"
            >
              <h4 className="mb-2 text-sm font-medium">
                {translator.translateText("Provider details")}
              </h4>
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
              {translator.translateTemplate(
                "This checks credentials and access to {{provider}}. It does not import events or confirm that scheduled polling is working.",
                { provider: providerTitle },
              )}
            </p>
          )}
          {run.type === "preview" && (
            <p className="text-sm text-gray-600">
              {translator.translateTemplate(
                "Preview reads {{provider}} without importing events or changing scheduled polling.",
                { provider: providerTitle },
              )}
            </p>
          )}
          {result.status === "empty" && (
            <p className="text-sm text-gray-600">
              {translator.translateTemplate(
                "{{provider}} returned no matching records for this time range. Try a wider range, or use Test connection to see what is available to import.",
                { provider: providerTitle },
              )}
              {scopeControl && includeNonAlerting === false && (
                <>
                  {" "}
                  {translator.translateTemplate(
                    "Only {{alerting}} are imported with this {{control}} selection; select {{nonAlerting}} to import the rest.",
                    {
                      alerting: translatableTerm(scopeControl.alertingLabel, {
                        inSentence: true,
                      }),
                      control: translatableTerm(scopeControl.title),
                      nonAlerting: translatableTerm(
                        scopeControl.nonAlertingLabel,
                      ),
                    },
                  )}
                </>
              )}
            </p>
          )}
          {!result.complete &&
            run.type !== "test" &&
            !hasConnectionWindowProgress(result) && (
              <p role="alert" className="text-sm text-amber-700">
                {run.type === "preview" || run.type === "backfill"
                  ? translator.translateText(
                      "This run did not finish processing every record in the window. Choose a shorter time range to read the rest; records already imported are skipped.",
                    )
                  : translator.translateText(
                      "This run did not finish processing every record in the window. Review the checks and warnings before retrying.",
                    )}
              </p>
            )}
          {result.warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <h4 className="font-medium">
                {translator.translateText("Warnings")}
              </h4>
              <ul className="mt-1 list-disc space-y-1 ps-5">
                {result.warnings.map(
                  (warning: string, index: number): ReactElement => {
                    // Written by the server in English: read as written.
                    return (
                      <li
                        key={index}
                        className="whitespace-pre-wrap break-words"
                      >
                        {readAsWritten(warning, translator.language)}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          )}
          {result.checks.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">
                {translator.translateText("Connection checks")}
              </h4>
              <ul className="space-y-2 text-sm">
                {result.checks.map(
                  (
                    check: SecurityConnectorCheck,
                    index: number,
                  ): ReactElement => {
                    const status: string = normalizeConnectorCheckStatus(
                      check.status,
                    );
                    const statusLabel: string | undefined =
                      connectorCheckStatusLabels[
                        status as SecurityConnectorCheckStatus
                      ];
                    return (
                      <li key={`${check.key}-${index}`}>
                        <span className={checkStatusClassName(status)}>
                          {readAsWritten(check.name, translator.language)}:{" "}
                          {statusLabel
                            ? translator.translateText(statusLabel)
                            : status}
                        </span>
                        <p className="text-gray-600">
                          {readAsWritten(check.message, translator.language)}
                        </p>
                        {check.remediation && status !== "pass" && (
                          <p className="text-gray-800">
                            {readAsWritten(
                              check.remediation,
                              translator.language,
                            )}
                          </p>
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
              <h4 className="text-sm font-medium">
                {translator.translateText("Sample records")}
              </h4>
              <p className="mt-1 text-xs text-gray-500">
                {translator.translateTemplate(
                  "Event time can be earlier than the time {{provider}} created the record. Samples may cover only part of the result.",
                  { provider: providerTitle },
                )}
              </p>
              <div className="mt-2 overflow-x-auto">
                {sampleColumns.styles}
                <table
                  className={`${sampleColumns.getTableWidthClassName("min-w-full")} text-start text-sm`}
                  {...sampleColumns.tableAttributes}
                >
                  <thead className="border-b border-gray-200 text-gray-500">
                    <tr>
                      <ResizableHeaderCell
                        className="py-2 pe-4"
                        resize={sampleColumns.getResize(
                          "record",
                          recordTitle,
                          ColumnWidthKind.Name,
                        )}
                      >
                        <span>{recordTitle}</span>
                      </ResizableHeaderCell>
                      <ResizableHeaderCell
                        className="py-2 pe-4"
                        resize={sampleColumns.getResize(
                          "severity",
                          severityTitle,
                          ColumnWidthKind.Whole,
                        )}
                      >
                        <span>{severityTitle}</span>
                      </ResizableHeaderCell>
                      <ResizableHeaderCell
                        className="py-2 pe-4"
                        resize={sampleColumns.getResize(
                          "eventTime",
                          eventTimeTitle,
                          ColumnWidthKind.Whole,
                        )}
                      >
                        <span>{eventTimeTitle}</span>
                      </ResizableHeaderCell>
                      <ResizableHeaderCell
                        className={showAlertColumn ? "py-2 pe-4" : "py-2"}
                        resize={sampleColumns.getResize(
                          "createdAtSource",
                          createdAtSourceTitle,
                          ColumnWidthKind.Whole,
                        )}
                      >
                        <span>{createdAtSourceTitle}</span>
                      </ResizableHeaderCell>
                      {showAlertColumn && (
                        <ResizableHeaderCell
                          className="py-2"
                          resize={sampleColumns.getResize(
                            "alert",
                            alertTitle,
                            ColumnWidthKind.Whole,
                          )}
                        >
                          <span>{alertTitle}</span>
                        </ResizableHeaderCell>
                      )}
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
                            <td className="max-w-xs break-words py-2 pe-4">
                              {connectorSampleTitle(sample) ||
                                translator.translateText("Untitled")}
                              <div className="text-xs text-gray-500">
                                {sample.id}
                              </div>
                            </td>
                            <td className="py-2 pe-4">
                              {sample.severity ||
                                translator.translateText("Unknown")}
                            </td>
                            <td className="whitespace-nowrap py-2 pe-4">
                              <ConnectionTime
                                value={connectorSampleEventTime(sample)}
                                emptyText={translationKey("Not provided")}
                              />
                            </td>
                            <td
                              className={
                                showAlertColumn
                                  ? "whitespace-nowrap py-2 pe-4"
                                  : "whitespace-nowrap py-2"
                              }
                            >
                              <ConnectionTime
                                value={sample.createdTime}
                                emptyText={translationKey("Not provided")}
                              />
                            </td>
                            {showAlertColumn && (
                              <td className="py-2">
                                {sample.isAlert === undefined
                                  ? translator.translateText("Unknown")
                                  : sample.isAlert
                                    ? translator.translateText("Yes")
                                    : translator.translateText("No")}
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
                {translator.translateText("View events in this time range")}
              </Link>
              <p className="mt-1 text-gray-500">
                {translator.translateText(
                  "Opens the event-time range of these records, including records created later.",
                )}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default SecurityEventConnectionRunDetails;
