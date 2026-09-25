import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";
import SpanUtil from "../../../Utils/SpanUtil";
import { formatRelativeTime } from "../../../Utils/ExceptionDetailPresentation";
import {
  ServiceSummary,
  TraceServiceInfo,
  TraceSummary,
  abbreviateId,
  formatDurationNano,
  formatPercent,
  getServiceInfo,
  pluralize,
} from "../../../Utils/TraceDetailPresentation";

export interface ComponentProps {
  traceId: string;
  summary: TraceSummary;
  serviceInfoById: Map<string, TraceServiceInfo>;
  services: Array<ServiceSummary>;
  selectedServiceIds: Array<string>;
  onToggleService: (serviceId: string) => void;
  onClearServices: () => void;
  onShowErrors: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  shareUrl: string;
  isCreatingPerformanceFix: boolean;
  performanceFixRoute: Route | null;
  performanceFixError: string | null;
  onCreatePerformanceFix: () => void;
}

interface Stat {
  label: string;
  value: ReactElement | string;
  testId: string;
  hint?: string | undefined;
}

/*
 * The top of the trace page: what the request was, whether it failed, how
 * long it took and where the time went — with the service chips doubling as
 * the waterfall's service filter.
 */
const TraceHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { summary } = props;
  const rootService: TraceServiceInfo | null = summary.rootSpan
    ? getServiceInfo(props.serviceInfoById, summary.rootSpan.serviceId)
    : null;
  const startedRelative: string | null = summary.startTime
    ? formatRelativeTime(summary.startTime)
    : null;
  const startedAbsolute: string | null = summary.startTime
    ? OneUptimeDate.getDateAsUserFriendlyFormattedString(summary.startTime)
    : null;

  const stats: Array<Stat> = [
    {
      label: "Duration",
      value: formatDurationNano(summary.durationUnixNano),
      testId: "trace-stat-duration",
    },
    {
      label: "Spans",
      value:
        summary.totalSpanCount > summary.loadedSpanCount ? (
          <span>
            {summary.loadedSpanCount.toLocaleString()}
            <span className="ml-1 text-sm font-normal text-gray-500">
              of {summary.totalSpanCount.toLocaleString()}
            </span>
          </span>
        ) : (
          summary.loadedSpanCount.toLocaleString()
        ),
      testId: "trace-stat-spans",
    },
    {
      label: "Services",
      value: summary.serviceCount.toLocaleString(),
      testId: "trace-stat-services",
    },
    {
      label: "Errors",
      value:
        summary.errorCount > 0 ? (
          <button
            type="button"
            className="inline-flex items-baseline gap-1.5 text-red-600 hover:underline"
            onClick={props.onShowErrors}
            title="Show only the spans with an error status"
          >
            {summary.errorCount.toLocaleString()}
            <span className="text-sm font-normal text-red-500">
              {formatPercent(summary.errorRatePercent)} of spans
            </span>
          </button>
        ) : (
          <span className="text-gray-900">0</span>
        ),
      testId: "trace-stat-errors",
    },
    {
      label: "Depth",
      value: summary.maxDepth.toLocaleString(),
      testId: "trace-stat-depth",
      hint: "The deepest chain of nested spans",
    },
  ];

  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="trace-header"
    >
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-lg ${summary.isError ? "bg-red-50" : "bg-emerald-50"}`}
            aria-hidden="true"
          >
            <Icon
              icon={summary.isError ? IconProp.Error : IconProp.CheckCircle}
              className={`h-5 w-5 ${summary.isError ? "text-red-600" : "text-emerald-600"}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  summary.isError
                    ? "bg-red-50 text-red-700 ring-red-600/20"
                    : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                }`}
                data-testid="trace-status"
              >
                {summary.isError
                  ? pluralize(summary.errorCount, "error")
                  : "No errors"}
              </span>
              {summary.rootSpan?.kind && (
                <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/15">
                  {SpanUtil.getSpanKindFriendlyName(summary.rootSpan.kind)}
                </span>
              )}
              {rootService && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-500/15">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: rootService.color }}
                    aria-hidden="true"
                  />
                  {rootService.name}
                </span>
              )}
              {summary.orphanCount > 0 && (
                <span
                  className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20"
                  title="These spans name a parent that has not been received, so they are shown at the top level."
                  data-testid="trace-orphans"
                >
                  {pluralize(summary.orphanCount, "span")} missing a parent
                </span>
              )}
            </div>
            <h2
              className="mt-1.5 break-words text-lg font-semibold leading-snug text-gray-900"
              data-testid="trace-title"
            >
              {summary.rootSpan?.name || "Trace"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <span>Trace</span>
                <code
                  className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700"
                  title={props.traceId}
                  data-testid="trace-id"
                >
                  {abbreviateId(props.traceId)}
                </code>
                <CopyTextButton
                  textToBeCopied={props.traceId}
                  iconOnly={true}
                  size="xs"
                  title="Copy trace ID"
                />
              </span>
              {startedAbsolute && (
                <span
                  className="inline-flex items-center gap-1"
                  title={startedAbsolute}
                >
                  <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
                  Started {startedRelative ? `${startedRelative} · ` : ""}
                  {startedAbsolute}
                </span>
              )}
            </div>
          </div>
        </div>
        {/*
         * Buttons are full width below md; on a phone the AI action takes a
         * row and the two small actions share the next.
         */}
        <div className="grid flex-none grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="col-span-2 sm:col-span-1">
            <Button
              title="Fix performance with AI"
              icon={IconProp.Bolt}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={props.isCreatingPerformanceFix}
              disabled={Boolean(props.performanceFixRoute)}
              tooltip="Analyze this trace's span tree and, when a known performance pattern is found, open an AI pull request that fixes it"
              dataTestId="trace-fix-performance"
              className="md:!ml-0"
              onClick={props.onCreatePerformanceFix}
            />
          </div>
          <CopyTextButton
            textToBeCopied={props.shareUrl}
            size="md"
            variant="ghost"
            label="Copy link"
            copiedLabel="Link copied"
            title="Copy a link to this trace"
            className="w-full !border-gray-300 font-medium !text-gray-700 shadow-sm sm:w-auto"
          />
          <Button
            title="Refresh"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={props.isRefreshing}
            dataTestId="trace-refresh"
            className="md:!ml-0"
            onClick={props.onRefresh}
          />
        </div>
      </div>

      {(props.performanceFixRoute || props.performanceFixError) && (
        <div className="px-5 pb-4">
          {props.performanceFixRoute ? (
            <Alert
              type={AlertType.SUCCESS}
              strongTitle="Performance fix task created"
              title={
                <span>
                  AI will open a pull request grounded in this trace&apos;s span
                  tree.{" "}
                  <Link className="underline" to={props.performanceFixRoute}>
                    View task progress
                  </Link>
                </span>
              }
            />
          ) : (
            <Alert
              type={AlertType.DANGER}
              strongTitle="Could not create the performance fix task"
              title={<span>{props.performanceFixError}</span>}
            />
          )}
        </div>
      )}

      {/* gap-px over a gray ground draws the dividers at any column count. */}
      <dl className="grid grid-cols-2 gap-px border-t border-gray-200 bg-gray-200 sm:grid-cols-5">
        {stats.map((stat: Stat, index: number): ReactElement => {
          return (
            <div
              key={stat.label}
              className={`bg-white px-5 py-3 ${index === stats.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}
              data-testid={stat.testId}
              title={stat.hint}
            >
              <dt className="text-xs font-medium text-gray-500">
                {stat.label}
              </dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
                {stat.value}
              </dd>
            </div>
          );
        })}
      </dl>

      {props.services.length > 0 && (
        <div
          className="border-t border-gray-200 px-5 py-4"
          data-testid="trace-service-breakdown"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-gray-500">
              Time spent by service
              <span className="ml-1 font-normal text-gray-400">
                (self time — click a service to filter the spans)
              </span>
            </div>
            {props.selectedServiceIds.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                onClick={props.onClearServices}
              >
                Show all services
              </button>
            )}
          </div>
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
            role="img"
            aria-label={props.services
              .map((service: ServiceSummary) => {
                return `${service.name} ${formatPercent(service.percent)}`;
              })
              .join(", ")}
          >
            {props.services.map((service: ServiceSummary): ReactElement => {
              const isDimmed: boolean =
                props.selectedServiceIds.length > 0 &&
                !props.selectedServiceIds.includes(service.id);
              return (
                <div
                  key={service.id || "unknown"}
                  className={`h-full transition-opacity ${isDimmed ? "opacity-25" : ""}`}
                  style={{
                    width: `${service.percent}%`,
                    backgroundColor: service.color,
                  }}
                  title={`${service.name}: ${formatDurationNano(service.selfTimeUnixNano)} (${formatPercent(service.percent)})`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {props.services.map((service: ServiceSummary): ReactElement => {
              const isSelected: boolean = props.selectedServiceIds.includes(
                service.id,
              );
              return (
                <button
                  key={service.id || "unknown"}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid="trace-service-chip"
                  className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isSelected
                      ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    props.onToggleService(service.id);
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: service.color }}
                    aria-hidden="true"
                  />
                  <span className="max-w-[12rem] truncate font-medium">
                    {service.name}
                  </span>
                  <span className="tabular-nums text-gray-500">
                    {formatPercent(service.percent)}
                  </span>
                  <span className="max-sm:hidden tabular-nums text-gray-400 sm:inline">
                    {pluralize(service.spanCount, "span")}
                  </span>
                  {service.errorCount > 0 && (
                    <span className="rounded bg-red-50 px-1 font-medium tabular-nums text-red-600">
                      {pluralize(service.errorCount, "error")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default TraceHeader;
