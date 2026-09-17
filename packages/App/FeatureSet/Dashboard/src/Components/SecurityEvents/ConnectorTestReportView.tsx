import React, { FunctionComponent, ReactElement, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityConnectorCheck,
  SecurityConnectorCheckStatus,
  SecurityConnectorSample,
  SecurityConnectorTestReport,
} from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import {
  ConnectorCheckGroup,
  ConnectorCountRow,
  connectionTimeTitle,
  connectorCheckGroup,
  connectorCheckGroupTitle,
  connectorCheckStatusLabels,
  connectorCountRows,
  connectorProviderTitle,
  connectorTestReportCounts,
  formatConnectionDate,
} from "./SecurityEventConnectionDiagnosticsUtil";

export interface ComponentProps {
  report: SecurityConnectorTestReport;
  /*
   * Overrides the provider title derived from report.provider (its catalog
   * title). Callers pass the title they already show, so the report and the
   * modal around it name the provider the same way.
   */
  providerTitle?: string | undefined;
  /*
   * Renders a "Run again" button in the summary banner. The modal supplies
   * its own in the footer and leaves this unset; inline uses (a form step)
   * pass it so the report can be refreshed without scrolling back.
   */
  onRunAgain?: (() => void) | undefined;
  isRunningAgain?: boolean | undefined;
}

/*
 * Renders one connection test as a checklist rather than a verdict.
 *
 * The question this answers is "connected, but why is nothing imported?",
 * and the answer is always one of three places: the source refused us, the
 * source has nothing to give, or OneUptime's own workers are not running.
 * The three sections below are exactly those three places, in the order a
 * reader should eliminate them.
 */

const GROUP_ORDER: Array<ConnectorCheckGroup> = [
  "provider",
  "availability",
  "platform",
];

interface StatusStyle {
  icon: IconProp;
  iconClassName: string;
  labelClassName: string;
}

const STATUS_STYLES: Record<SecurityConnectorCheckStatus, StatusStyle> = {
  pass: {
    icon: IconProp.CheckCircle,
    iconClassName: "text-green-600",
    labelClassName: "bg-green-50 text-green-800",
  },
  fail: {
    icon: IconProp.Error,
    iconClassName: "text-red-600",
    labelClassName: "bg-red-50 text-red-800",
  },
  warn: {
    icon: IconProp.Alert,
    iconClassName: "text-amber-600",
    labelClassName: "bg-amber-50 text-amber-800",
  },
  skip: {
    icon: IconProp.EmptyCircle,
    iconClassName: "text-gray-400",
    labelClassName: "bg-gray-100 text-gray-700",
  },
};

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

interface CheckRowProps {
  check: SecurityConnectorCheck;
}

const CheckRow: FunctionComponent<CheckRowProps> = (
  props: CheckRowProps,
): ReactElement => {
  const [showRemediation, setShowRemediation] = useState<boolean>(
    /*
     * A failed check opens its remediation by default: the reader came here
     * because something is wrong and should not need a second click to see
     * what to do about it. Warnings stay collapsed to keep the list short.
     */
    props.check.status === "fail",
  );
  /*
   * The record is total over the status union, but the project compiles
   * with noUncheckedIndexedAccess; a status the server adds later renders
   * as skipped rather than crashing the checklist.
   */
  const style: StatusStyle =
    STATUS_STYLES[props.check.status] || STATUS_STYLES.skip;
  const remediationId: string = `remediation-${props.check.key}`;
  const duration: string = formatDuration(props.check.durationMs);

  return (
    <li
      data-check-key={props.check.key}
      data-check-status={props.check.status}
      className="flex gap-3 py-3"
    >
      <div className="mt-0.5 shrink-0">
        <Icon
          icon={style.icon}
          size={SizeProp.Regular}
          className={`h-5 w-5 ${style.iconClassName}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {props.check.name}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.labelClassName}`}
          >
            {connectorCheckStatusLabels[props.check.status]}
          </span>
          {duration && (
            <span className="text-xs text-gray-500">{duration}</span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
          {props.check.message}
        </p>
        {props.check.remediation && (
          <div className="mt-2">
            <button
              type="button"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              aria-expanded={showRemediation}
              aria-controls={remediationId}
              onClick={(): void => {
                setShowRemediation((value: boolean): boolean => {
                  return !value;
                });
              }}
            >
              What to do
            </button>
            {showRemediation && (
              <p
                id={remediationId}
                className="mt-1 whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 text-sm text-gray-800"
              >
                {props.check.remediation}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

function summaryTitle(status: SecurityConnectorTestReport["status"]): string {
  if (status === "fail") {
    return "Some checks failed";
  }

  if (status === "warn") {
    return "Passed with warnings";
  }

  return "All checks passed";
}

function summaryClassName(
  status: SecurityConnectorTestReport["status"],
): string {
  if (status === "fail") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (status === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-green-200 bg-green-50 text-green-900";
}

const ConnectorTestReportView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const report: SecurityConnectorTestReport = props.report;
  const providerTitle: string =
    props.providerTitle || connectorProviderTitle(report.provider);

  const grouped: Record<ConnectorCheckGroup, Array<SecurityConnectorCheck>> = {
    provider: [],
    availability: [],
    platform: [],
  };

  for (const check of report.checks) {
    grouped[connectorCheckGroup(check)].push(check);
  }

  /*
   * Flattened so a nested count (Google SecOps' otherScope, the other Data
   * to import choice) reads as labelled rows instead of "[object Object]",
   * and taken from the detections-available check when the connector did
   * not return report.counts.
   */
  const countRows: Array<ConnectorCountRow> = connectorCountRows(
    connectorTestReportCounts(report),
  );
  const samples: Array<SecurityConnectorSample> = report.samples || [];

  /*
   * The report is safe to copy verbatim: testers never place credentials
   * in a check message and the API redacts every error before it lands
   * here. Pretty-printed so it pastes readably into a support ticket.
   */
  const reportJson: string = JSON.stringify(report, null, 2);

  return (
    <div
      role="region"
      aria-label="Connection test report"
      className="space-y-5"
    >
      <div
        role="status"
        data-report-status={report.status}
        className={`rounded-md border p-4 ${summaryClassName(report.status)}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">
              {summaryTitle(report.status)}
            </h3>
            <p className="mt-1 text-sm">{report.summary}</p>
            <p className="mt-2 text-xs opacity-80">
              {providerTitle} · completed{" "}
              <time
                dateTime={report.completedAt}
                title={connectionTimeTitle(report.completedAt)}
              >
                {formatConnectionDate(report.completedAt)}
              </time>
              {formatDuration(report.durationMs)
                ? ` · ${formatDuration(report.durationMs)}`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {props.onRunAgain && (
              <Button
                title="Run again"
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.Refresh}
                disabled={Boolean(props.isRunningAgain)}
                isLoading={Boolean(props.isRunningAgain)}
                onClick={(): void => {
                  props.onRunAgain?.();
                }}
              />
            )}
            <CopyTextButton
              label="Copy report"
              textToBeCopied={reportJson}
              size="sm"
              variant="soft"
            />
          </div>
        </div>
      </div>

      {GROUP_ORDER.map((group: ConnectorCheckGroup): ReactElement | null => {
        const checks: Array<SecurityConnectorCheck> = grouped[group];

        if (checks.length === 0) {
          return null;
        }

        const title: string = connectorCheckGroupTitle(group, providerTitle);

        return (
          <section
            key={group}
            aria-label={title}
            data-check-group={group}
            className="rounded-md border border-gray-200 px-4"
          >
            <h4 className="pt-3 text-sm font-semibold text-gray-900">
              {title}
            </h4>
            <ul role="list" className="divide-y divide-gray-100">
              {checks.map((check: SecurityConnectorCheck): ReactElement => {
                return <CheckRow key={check.key} check={check} />;
              })}
            </ul>
          </section>
        );
      })}

      {countRows.length > 0 && (
        <section
          aria-label="Availability counts"
          className="rounded-md border border-gray-200 p-4"
        >
          <h4 className="text-sm font-semibold text-gray-900">
            Availability counts
          </h4>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    Measure
                  </th>
                  <th scope="col" className="py-2">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {countRows.map((row: ConnectorCountRow): ReactElement => {
                  return (
                    <tr
                      key={row.key}
                      data-count-key={row.key}
                      className="border-b border-gray-100"
                    >
                      <th
                        scope="row"
                        className="py-2 pr-4 font-normal text-gray-700"
                      >
                        {row.label}
                      </th>
                      <td className="py-2 font-medium text-gray-900">
                        {row.value}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {samples.length > 0 && (
        <section
          aria-label="Sample records"
          className="rounded-md border border-gray-200 p-4"
        >
          <h4 className="text-sm font-semibold text-gray-900">
            Sample records
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            A few of the most recent records the source returned. Event time can
            be much earlier than the time the source created the record.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    Record
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Severity
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Created (UTC)
                  </th>
                  <th scope="col" className="py-2">
                    Event time (UTC)
                  </th>
                </tr>
              </thead>
              <tbody>
                {samples.map(
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
                        <td
                          className="whitespace-nowrap py-2 pr-4"
                          title={connectionTimeTitle(sample.createdTime)}
                        >
                          {sample.createdTime
                            ? formatConnectionDate(sample.createdTime)
                            : "Not provided"}
                        </td>
                        <td
                          className="whitespace-nowrap py-2"
                          title={connectionTimeTitle(sample.eventTime)}
                        >
                          {sample.eventTime
                            ? formatConnectionDate(sample.eventTime)
                            : "Not provided"}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default ConnectorTestReportView;
