import React, { FunctionComponent, ReactElement, useId } from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import useTranslateValue from "Common/UI/Utils/Translation";
import SecurityEventSeverityPill, {
  getSeverityColor,
} from "./SecurityEventSeverityPill";
import { CorrelationGraphNode } from "../../Utils/CorrelationGraph";
import { CorrelationConnector } from "../../Utils/SecurityEventCorrelation";

/*
 * The panel docked beside the correlation graph. With nothing selected it
 * lists every class and observable on the canvas — the keyboard and
 * screen-reader path into the graph, since the node cards themselves are not
 * focusable. Selecting a class lists its events; selecting an observable
 * offers the pivots. Purely presentational: the graph owns data and state.
 */

type TranslateFunction = (value: string) => string;

const useT: () => TranslateFunction = (): TranslateFunction => {
  const { translateString } = useTranslateValue();
  return (value: string): string => {
    return translateString(value) || value;
  };
};

// Same neutral the class node card uses, so a list dot matches its card.
const NO_SEVERITY_ACCENT: string = "var(--ou-chart-series-neutral, #64748b)";
const OBSERVABLE_BAR_COLOR: string = "var(--ou-link, #4f46e5)";

const getSeverityAccent: (severity: string | undefined) => string = (
  severity: string | undefined,
): string => {
  if (!severity) {
    return NO_SEVERITY_ACCENT;
  }
  return getSeverityColor(severity).toString();
};

/*
 * Bars are relative to the largest count. A non-zero count keeps a sliver so
 * a class with one event next to one with two hundred is still visible.
 */
const getBarWidth: (count: number, maxCount: number) => string = (
  count: number,
  maxCount: number,
): string => {
  if (count <= 0 || maxCount <= 0) {
    return "0%";
  }
  const percent: number = Math.round((count / maxCount) * 100);
  return `${Math.max(2, Math.min(100, percent))}%`;
};

const getMaxCount: (nodes: Array<CorrelationGraphNode>) => number = (
  nodes: Array<CorrelationGraphNode>,
): number => {
  let max: number = 0;
  for (const node of nodes) {
    max = Math.max(max, node.count || 0);
  }
  return max;
};

const eyebrowClassName: string =
  "text-[11px] font-semibold uppercase tracking-wide text-gray-500";

export interface CorrelateOverviewProps {
  // Already ranked by the caller; rendered in the order given.
  classes: Array<CorrelationGraphNode>;
  observables: Array<CorrelationGraphNode>;
  droppedObservableCount: number;
  countsAreLowerBounds: boolean;
  // A reload is in flight: the lists describe the previous results.
  isStale: boolean;
  onSelectNode: (nodeId: string) => void;
}

export const CorrelateOverview: FunctionComponent<CorrelateOverviewProps> = (
  props: CorrelateOverviewProps,
): ReactElement => {
  const t: TranslateFunction = useT();
  const plus: string = props.countsAreLowerBounds ? "+" : "";
  const maxClassCount: number = getMaxCount(props.classes);
  const maxObservableCount: number = getMaxCount(props.observables);
  const classesHeadingId: string = useId();
  const observablesHeadingId: string = useId();
  const rowClassName: string = `w-full rounded-md px-2 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
    props.isStale ? "cursor-default" : "hover:bg-gray-50"
  }`;

  return (
    <div
      data-testid="correlate-overview"
      className={`grid gap-x-8 gap-y-5 p-4 md:px-5 lg:grid-cols-2 ${
        props.isStale ? "opacity-60" : ""
      }`}
    >
      <section>
        <h3
          id={classesHeadingId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          {t("Event classes")}
        </h3>
        <ul
          role="list"
          aria-labelledby={classesHeadingId}
          className="mt-2 space-y-0.5"
        >
          {props.classes.map(
            (node: CorrelationGraphNode, index: number): ReactElement => {
              const accent: string = getSeverityAccent(node.worstSeverity);
              const count: number = node.count || 0;
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    data-testid={`correlate-overview-class-${index}`}
                    disabled={props.isStale}
                    className={rowClassName}
                    onClick={() => {
                      props.onSelectNode(node.id);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        data-testid={`correlate-overview-class-dot-${index}`}
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: accent }}
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900"
                        title={node.label}
                      >
                        {node.label}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">
                        {node.worstSeverity || t("No severity")}
                      </span>
                      <span className="min-w-[2.5rem] shrink-0 text-right text-sm font-semibold tabular-nums text-gray-700">
                        {count}
                        {plus}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-1 rounded-full bg-gray-100"
                    >
                      <span
                        data-testid={`correlate-overview-class-bar-${index}`}
                        className="block h-1 rounded-full"
                        style={{
                          width: getBarWidth(count, maxClassCount),
                          background: accent,
                        }}
                      />
                    </span>
                  </button>
                </li>
              );
            },
          )}
        </ul>
      </section>

      <section>
        <h3
          id={observablesHeadingId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          {t("Co-occurring observables")}
        </h3>
        {props.observables.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            {t("No co-occurring observables in these events.")}
          </p>
        ) : (
          <ul
            role="list"
            aria-labelledby={observablesHeadingId}
            className="mt-2 grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
          >
            {props.observables.map(
              (node: CorrelationGraphNode, index: number): ReactElement => {
                const count: number = node.count || 0;
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      data-testid={`correlate-overview-observable-${index}`}
                      disabled={props.isStale}
                      className={rowClassName}
                      onClick={() => {
                        props.onSelectNode(node.id);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-sm text-gray-900"
                          title={node.label}
                        >
                          {node.label}
                        </span>
                        <span className="min-w-[2.5rem] shrink-0 text-right text-sm font-semibold tabular-nums text-gray-700">
                          {count}
                          {plus}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-1 block h-1 rounded-full bg-gray-100"
                      >
                        <span
                          data-testid={`correlate-overview-observable-bar-${index}`}
                          className="block h-1 rounded-full"
                          style={{
                            width: getBarWidth(count, maxObservableCount),
                            background: OBSERVABLE_BAR_COLOR,
                          }}
                        />
                      </span>
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        )}
        {props.droppedObservableCount > 0 && (
          <p
            data-testid="correlate-overview-dropped"
            className="mt-2 text-xs text-gray-500"
          >
            {props.droppedObservableCount}{" "}
            {t("less frequent observables not shown")}
          </p>
        )}
      </section>

      <p className="text-xs text-gray-500 lg:col-span-2">
        {t("Select a node or a row to see its details.")}
      </p>
    </div>
  );
};

export interface CorrelateClassEventsPanelProps {
  className: string;
  // The class's events, newest first.
  events: Array<SecurityEvent>;
  worstSeverity?: OcsfSeverity | undefined;
  countIsLowerBound: boolean;
  canFilterToClass: boolean;
  showOrModeNote: boolean;
  rowLimit: number;
  onFilterToClass: () => void;
  onClose: () => void;
  onOpenEvent: (event: SecurityEvent) => void;
}

export const CorrelateClassEventsPanel: FunctionComponent<
  CorrelateClassEventsPanelProps
> = (props: CorrelateClassEventsPanelProps): ReactElement => {
  const t: TranslateFunction = useT();
  const eventCount: number = props.events.length;
  const headingId: string = useId();
  const visibleEvents: Array<SecurityEvent> = props.events.slice(
    0,
    Math.max(0, props.rowLimit),
  );

  return (
    <div data-testid="correlate-drilldown">
      <div className="sticky top-0 z-10 space-y-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={eyebrowClassName}>{t("Event class")}</p>
            <h4
              id={headingId}
              className="truncate text-sm font-semibold text-gray-900"
              title={props.className}
            >
              {props.className}
            </h4>
          </div>
          <Button
            dataTestId="correlate-drilldown-close"
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.Close}
            ariaLabel={t("Close")}
            onClick={props.onClose}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.worstSeverity ? (
            <SecurityEventSeverityPill
              size={PillSize.Small}
              severityName={props.worstSeverity}
            />
          ) : (
            <span className="text-xs text-gray-500">{t("No severity")}</span>
          )}
          {/* The only "matching event" text in the panel; tests rely on it. */}
          <p
            data-testid="correlate-drilldown-count"
            className="text-xs text-gray-600"
          >
            {eventCount}
            {props.countIsLowerBound ? "+" : ""}{" "}
            {t(eventCount === 1 ? "matching event" : "matching events")}
          </p>
        </div>
        {props.canFilterToClass ? (
          <div className="[&_button]:ml-0">
            <Button
              dataTestId="correlate-drilldown-filter-class"
              title="Filter to this class"
              icon={IconProp.Filter}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              onClick={props.onFilterToClass}
            />
          </div>
        ) : (
          props.showOrModeNote && (
            <p
              data-testid="correlate-drilldown-or-note"
              className="text-xs text-gray-500"
            >
              {t("Class filters apply only when matching all conditions.")}
            </p>
          )
        )}
      </div>

      <ul
        role="list"
        aria-labelledby={headingId}
        className="divide-y divide-gray-100"
      >
        {visibleEvents.map(
          (event: SecurityEvent, index: number): ReactElement => {
            const principal: string =
              event.principalUser || event.principalHost || "";
            return (
              <li key={event._id?.toString() || index}>
                <button
                  type="button"
                  data-testid={`correlate-drilldown-event-${index}`}
                  className="block w-full px-4 py-2.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                  onClick={() => {
                    props.onOpenEvent(event);
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <SecurityEventSeverityPill
                      size={PillSize.Small}
                      severityName={event.severityName}
                    />
                    {event.time ? (
                      <span
                        className="text-xs text-gray-500"
                        title={OneUptimeDate.getDateAsLocalFormattedString(
                          event.time,
                        )}
                      >
                        {OneUptimeDate.fromNow(new Date(event.time))}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">-</span>
                    )}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm text-gray-900">
                    {event.message || "-"}
                  </span>
                  {principal.length > 0 && (
                    <span className="mt-0.5 block truncate font-mono text-xs text-gray-500">
                      {principal}
                    </span>
                  )}
                </button>
              </li>
            );
          },
        )}
      </ul>

      {eventCount > props.rowLimit && (
        <p
          data-testid="correlate-drilldown-cap"
          className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500"
        >
          {t(
            "Only the 50 most recent events are listed. Narrow the filter or time range to see the rest.",
          )}
        </p>
      )}
    </div>
  );
};

export interface CorrelateObservableClass {
  // The class node id (`class:<name>`).
  id: string;
  name: string;
  worstSeverity?: OcsfSeverity | undefined;
  // Events in this class that mention the observable (the edge count).
  count: number;
}

export interface CorrelateObservablePivotPanelProps {
  value: string;
  eventCount: number;
  countIsLowerBound: boolean;
  classes: Array<CorrelateObservableClass>;
  connector: CorrelationConnector;
  canExclude: boolean;
  onFocus: () => void;
  onAdd: () => void;
  onExclude: () => void;
  onSelectClass: (classNodeId: string) => void;
  onDismiss: () => void;
}

interface PivotActionProps {
  testId: string;
  icon: IconProp;
  title: string;
  hint: string;
  isDanger?: boolean | undefined;
  onClick: () => void;
}

const PivotAction: FunctionComponent<PivotActionProps> = (
  props: PivotActionProps,
): ReactElement => {
  return (
    <button
      type="button"
      data-testid={props.testId}
      className="flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      onClick={() => {
        props.onClick();
      }}
    >
      <span
        aria-hidden="true"
        data-testid={`${props.testId}-icon`}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          props.isDanger
            ? "bg-red-50 text-red-600"
            : "bg-indigo-50 text-indigo-600"
        }`}
      >
        <Icon icon={props.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">
          {props.title}
        </span>
        <span className="block text-xs text-gray-500">{props.hint}</span>
      </span>
    </button>
  );
};

export const CorrelateObservablePivotPanel: FunctionComponent<
  CorrelateObservablePivotPanelProps
> = (props: CorrelateObservablePivotPanelProps): ReactElement => {
  const t: TranslateFunction = useT();
  const seenInHeadingId: string = useId();

  return (
    <div data-testid="correlate-observable-actions" className="space-y-4 p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className={`flex-1 ${eyebrowClassName}`}>{t("Observable")}</p>
          <Button
            dataTestId="correlate-action-dismiss"
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.Close}
            ariaLabel={t("Clear selection")}
            onClick={props.onDismiss}
          />
        </div>
        <div className="flex items-start gap-1.5">
          {/* Its own text is exactly the value; tests look it up by text. */}
          <p
            data-testid="correlate-observable-value"
            className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-gray-900"
          >
            {props.value}
          </p>
          <CopyTextButton
            textToBeCopied={props.value}
            iconOnly={true}
            size="xs"
            title={t("Copy value")}
            className="mt-0.5 shrink-0"
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div
          data-testid="correlate-observable-fact-events"
          className="rounded-lg bg-gray-50 px-3 py-2"
        >
          <dt className="text-[11px] text-gray-500">{t("Events")}</dt>
          <dd className="text-lg font-semibold tabular-nums text-gray-900">
            {props.eventCount}
            {props.countIsLowerBound ? "+" : ""}
          </dd>
        </div>
        <div
          data-testid="correlate-observable-fact-classes"
          className="rounded-lg bg-gray-50 px-3 py-2"
        >
          <dt className="text-[11px] text-gray-500">{t("Event classes")}</dt>
          <dd className="text-lg font-semibold tabular-nums text-gray-900">
            {props.classes.length}
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <p className={eyebrowClassName}>{t("Pivot")}</p>
        <PivotAction
          testId="correlate-action-focus"
          icon={IconProp.ViewfinderCircle}
          title={t("Correlate on this")}
          hint={t("Start a new graph centred on this observable.")}
          onClick={props.onFocus}
        />
        <PivotAction
          testId="correlate-action-add"
          icon={IconProp.Add}
          title={t("Add to filter")}
          hint={
            props.connector === "or"
              ? t("Also include events that mention it.")
              : t("Keep only events that also mention it.")
          }
          onClick={props.onAdd}
        />
        {props.canExclude && (
          <PivotAction
            testId="correlate-action-exclude"
            icon={IconProp.MinusCircle}
            title={t("Exclude from results")}
            hint={t("Hide events that mention it.")}
            isDanger={true}
            onClick={props.onExclude}
          />
        )}
      </div>

      {props.classes.length > 0 && (
        <div>
          <p id={seenInHeadingId} className={eyebrowClassName}>
            {t("Seen in")}
          </p>
          {/* Class names only — the value must stay unique in this panel. */}
          <ul
            role="list"
            aria-labelledby={seenInHeadingId}
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {props.classes.map(
              (
                observableClass: CorrelateObservableClass,
                index: number,
              ): ReactElement => {
                return (
                  <li key={observableClass.id} className="min-w-0">
                    <button
                      type="button"
                      data-testid={`correlate-observable-class-${index}`}
                      title={observableClass.name}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      onClick={() => {
                        props.onSelectClass(observableClass.id);
                      }}
                    >
                      <span
                        aria-hidden="true"
                        data-testid={`correlate-observable-class-dot-${index}`}
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: getSeverityAccent(
                            observableClass.worstSeverity,
                          ),
                        }}
                      />
                      <span className="min-w-0 truncate">
                        {observableClass.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-500">
                        {observableClass.count}
                      </span>
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
