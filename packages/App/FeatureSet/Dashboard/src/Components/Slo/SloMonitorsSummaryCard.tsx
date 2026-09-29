import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewActionLink from "./SloOverviewActionLink";
import SloOverviewEmptyState from "./SloOverviewEmptyState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import StackedProgressBar, {
  StackedProgressBarSegment,
} from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  getSloMonitorStatusSummary,
  SloMonitorStatusInput,
  SloMonitorStatusRow,
  SloMonitorStatusSegment,
  SloMonitorStatusSummary,
  SloMonitorStatusTone,
} from "Common/Utils/Slo/SloMonitorStatusSummary";
import { getSloMonitorCountText } from "Common/Utils/Slo/SloOverviewText";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  sloId: ObjectID;
  monitorIds: Array<ObjectID>;
  // Rules can exist and match nothing; the empty state says which case this is.
  monitorRuleCount: number;
  enabledMonitorRuleCount: number;
  // Bumped by the page's poll: monitor statuses change between evaluations.
  refreshToken: number;
}

/** Enough to show what needs attention; the Monitors page has the rest. */
export const SLO_OVERVIEW_MAX_MONITOR_ROWS: number = 6;

/*
 * Semantic colours for the distribution bar, as literal classes. Monitor
 * statuses are project-defined, so the bar groups by what a status means
 * (operational / offline / something in between) while each row below keeps
 * the status's own name and colour.
 */
const SEGMENT_COLOR_CLASS: Record<SloMonitorStatusTone, string> = {
  [SloMonitorStatusTone.Operational]: "bg-emerald-500",
  [SloMonitorStatusTone.Degraded]: "bg-amber-500",
  [SloMonitorStatusTone.Offline]: "bg-red-500",
  [SloMonitorStatusTone.Unknown]: "bg-gray-400",
  [SloMonitorStatusTone.Paused]: "bg-gray-300",
};

type ToStatusInputFunction = (monitor: Monitor) => SloMonitorStatusInput;

const toStatusInput: ToStatusInputFunction = (
  monitor: Monitor,
): SloMonitorStatusInput => {
  return {
    id: monitor._id?.toString() || "",
    name: monitor.name || "Unnamed monitor",
    statusName: monitor.currentMonitorStatus?.name,
    statusColor: monitor.currentMonitorStatus?.color,
    isOperationalState: monitor.currentMonitorStatus?.isOperationalState,
    isOfflineState: monitor.currentMonitorStatus?.isOfflineState,
    statusPriority: monitor.currentMonitorStatus?.priority,
    isMonitoringPaused: Boolean(
      monitor.disableActiveMonitoring ||
        monitor.disableActiveMonitoringBecauseOfManualIncident ||
        monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent,
    ),
  };
};

/*
 * The monitors this SLO measures, and how they are doing right now.
 *
 * The old overview listed attached monitors as a comma-separated row of
 * links in the details card — nothing about whether any of them was down,
 * which is the first thing anyone opening an SLO in trouble wants to know.
 * This card shows the status distribution as one bar, then the monitors
 * that need attention first, then a link to the full Monitors page.
 *
 * A monitor with active monitoring disabled reads "Paused": the SLO worker
 * ignores it, so its stale last status is not a signal.
 */
const SloMonitorsSummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(
    props.monitorIds.length > 0,
  );
  const [error, setError] = useState<string>("");
  const [retryTick, setRetryTick] = useState<number>(0);

  /*
   * Keyed on the ids' values, not the array's identity: the page rebuilds
   * the array on every poll, and refetching on identity would double the
   * requests.
   */
  const monitorIdsKey: string = props.monitorIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort()
    .join(",");

  useEffect(() => {
    if (props.monitorIds.length === 0) {
      setMonitors([]);
      setError("");
      setIsLoading(false);
      return undefined;
    }

    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            _id: new Includes(props.monitorIds),
          },
          select: {
            _id: true,
            name: true,
            currentMonitorStatus: {
              name: true,
              color: true,
              isOperationalState: true,
              isOfflineState: true,
              priority: true,
            },
            disableActiveMonitoring: true,
            disableActiveMonitoringBecauseOfManualIncident: true,
            disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        });

        if (!cancelled) {
          setMonitors(result.data);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // load() records its own error.
    });

    return () => {
      cancelled = true;
    };
  }, [monitorIdsKey, props.refreshToken, retryTick]);

  const monitorsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
    { modelId: props.sloId },
  );

  const monitorRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_MONITOR_RULES] as Route,
    { modelId: props.sloId },
  );

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (props.monitorIds.length === 0) {
      if (props.monitorRuleCount > 0) {
        return (
          <SloOverviewEmptyState
            dataTestId="slo-monitors-empty-rules-match-nothing"
            icon={IconProp.Filter}
            tone="warning"
            title="Your monitor rules match no monitors yet"
            description={
              props.enabledMonitorRuleCount > 0
                ? "This SLO has monitor rules, but no monitor in this project matches them. Check the rules, or give the monitors this SLO should measure the names or labels the rules look for."
                : "Every monitor rule on this SLO is disabled, so no monitors are attached. Enable a rule, or add monitors by hand."
            }
            actions={
              <SloOverviewActionLink
                variant="primary"
                title="Review monitor rules"
                icon={IconProp.Filter}
                to={monitorRulesRoute}
              />
            }
          />
        );
      }

      return (
        <SloOverviewEmptyState
          dataTestId="slo-monitors-empty"
          icon={IconProp.AltGlobe}
          tone="warning"
          title="This SLO is not measuring any monitors"
          description="An SLO measures uptime from its monitors. Pick them by hand, or add a rule that attaches every monitor matching a name, description or label — including ones created later."
          actions={
            <>
              <SloOverviewActionLink
                variant="primary"
                title="Add monitors"
                icon={IconProp.Add}
                to={monitorsRoute}
              />
              <SloOverviewActionLink
                variant="secondary"
                title="Create a monitor rule"
                icon={IconProp.Filter}
                to={monitorRulesRoute}
              />
            </>
          }
        />
      );
    }

    if (isLoading && monitors.length === 0) {
      return (
        <div
          role="status"
          aria-label="Loading monitors"
          className="space-y-3 motion-safe:animate-pulse"
        >
          <div className="h-2.5 w-full rounded-full bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
          <div className="h-4 w-1/2 rounded bg-gray-100"></div>
          <div className="h-4 w-3/5 rounded bg-gray-100"></div>
        </div>
      );
    }

    if (error && monitors.length === 0) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setRetryTick((tick: number) => {
              return tick + 1;
            });
          }}
        />
      );
    }

    const summary: SloMonitorStatusSummary = getSloMonitorStatusSummary(
      monitors.map(toStatusInput),
    );

    const segments: Array<StackedProgressBarSegment> = summary.segments.map(
      (segment: SloMonitorStatusSegment): StackedProgressBarSegment => {
        return {
          value: segment.count,
          label: segment.label,
          color: SEGMENT_COLOR_CLASS[segment.tone],
          tooltip: `${segment.label}: ${getSloMonitorCountText(segment.count)}`,
        };
      },
    );

    let summaryText: string = `All ${getSloMonitorCountText(summary.total)} operational`;

    if (summary.total === 1 && summary.needsAttentionCount === 0) {
      summaryText = "The monitor is operational";
    }

    if (summary.needsAttentionCount > 0) {
      summaryText = `${summary.needsAttentionCount} of ${getSloMonitorCountText(summary.total)} need${
        summary.needsAttentionCount === 1 ? "s" : ""
      } attention`;
    } else if (summary.pausedCount === summary.total) {
      summaryText = "Every monitor is paused";
    } else if (summary.pausedCount > 0) {
      summaryText = `${summary.total - summary.pausedCount} operational, ${summary.pausedCount} paused`;
    }

    const visibleRows: Array<SloMonitorStatusRow> = summary.rows.slice(
      0,
      SLO_OVERVIEW_MAX_MONITOR_ROWS,
    );

    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            data-testid="slo-monitors-summary-text"
            className={`text-sm font-medium ${
              summary.needsAttentionCount > 0 ? "text-red-700" : "text-gray-700"
            }`}
          >
            {summaryText}
          </p>
          {props.enabledMonitorRuleCount > 0 ? (
            <SloOverviewActionLink
              title={`Kept in sync by ${props.enabledMonitorRuleCount} monitor rule${
                props.enabledMonitorRuleCount === 1 ? "" : "s"
              }`}
              icon={IconProp.Filter}
              to={monitorRulesRoute}
            />
          ) : (
            <></>
          )}
        </div>

        <StackedProgressBar
          className="mt-3"
          heightClassName="h-2.5"
          segments={segments}
          showLegend={true}
        />

        <ul
          aria-label="Monitors measured by this SLO"
          className="mt-4 divide-y divide-gray-100 border-t border-gray-100"
        >
          {visibleRows.map((row: SloMonitorStatusRow) => {
            return (
              <li
                key={row.id}
                data-testid="slo-monitor-row"
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <Link
                  className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_VIEW] as Route,
                    { modelId: new ObjectID(row.id) },
                  )}
                >
                  {row.name}
                </Link>
                <span className="flex flex-shrink-0 items-center">
                  {row.tone === SloMonitorStatusTone.Paused ? (
                    <StatusBadge text="Paused" type={StatusBadgeType.Neutral} />
                  ) : (
                    <Statusbubble
                      text={row.statusLabel}
                      color={row.statusColor || Gray500}
                      shouldAnimate={false}
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {summary.total > visibleRows.length ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <SloOverviewActionLink
              title={`View all ${getSloMonitorCountText(summary.total)}`}
              icon={IconProp.ArrowRight}
              to={monitorsRoute}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Monitors"
      description="The monitors this SLO measures, most urgent first."
      rightElement={
        <SloOverviewActionLink title="Manage monitors" to={monitorsRoute} />
      }
    >
      {getBody()}
    </Card>
  );
};

export default SloMonitorsSummaryCard;
