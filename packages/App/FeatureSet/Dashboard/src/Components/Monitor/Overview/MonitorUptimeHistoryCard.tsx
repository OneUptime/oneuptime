import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { OverviewSection } from "../../../Utils/OverviewSection";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SloOverviewEmptyState from "../../Slo/SloOverviewEmptyState";
import MonitorStatusDot from "./MonitorStatusDot";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Route from "Common/Types/API/Route";
import { Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate, { Moment } from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "Common/Types/Monitor/MonitorUptimeSummary";
import UptimeBarTooltipIncident from "Common/Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "Common/Types/ObjectID";
import { UptimeStatusDuration } from "Common/Types/StatusPage/UptimeDailyAggregate";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import {
  NO_DATA_BAR_COLOR,
  UptimeBarDaySummary,
} from "Common/UI/Components/Graphs/DayUptimeGraph";
import MonitorUptimeGraph from "Common/UI/Components/MonitorGraphs/Uptime";
import UptimeBarDayModal from "Common/UI/Components/MonitorGraphs/UptimeBarDayModal";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorUptimeSummaryUtil, {
  UptimeWindowPresentation,
} from "Common/Utils/Monitor/MonitorUptimeSummaryUtil";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  summary: OverviewSection<MonitorUptimeSummary>;
  incidents: OverviewSection<Array<UptimeBarTooltipIncident>>;
  monitorCreatedAt?: Date | undefined;
  onRetry: () => void;
}

const CARD_TITLE: string = "Uptime history";
const CARD_DESCRIPTION: string =
  "One bar per day for the last 90 days, in your time zone. Grey bars are days with no data.";

interface StatusModels {
  all: Array<MonitorStatus>;
  downtime: Array<MonitorStatus>;
  byId: Dictionary<MonitorUptimeSummaryStatus>;
}

interface SelectedDay {
  date: Date;
  incidents: Array<UptimeBarTooltipIncident>;
  summary: UptimeBarDaySummary;
}

interface LegendItem {
  key: string;
  name: string;
  color: string;
}

/*
 * The summary ships the project's statuses as plain values; the graph wants
 * MonitorStatus models to name and colour each bucket's durations.
 */
export const toStatusModels: (
  statuses: Array<MonitorUptimeSummaryStatus>,
) => StatusModels = (
  statuses: Array<MonitorUptimeSummaryStatus>,
): StatusModels => {
  const all: Array<MonitorStatus> = [];
  const byId: Dictionary<MonitorUptimeSummaryStatus> = {};

  for (const status of statuses || []) {
    const model: MonitorStatus = new MonitorStatus();
    model._id = status.id.toString();
    model.name = status.name;
    model.isOperationalState = status.isOperationalState;
    model.isOfflineState = status.isOfflineState;

    if (status.priority !== null) {
      model.priority = status.priority;
    }

    // A status with no colour takes the graph's default bar colour.
    if (status.color) {
      model.color = new Color(status.color);
    }

    all.push(model);
    byId[status.id.toString()] = status;
  }

  return {
    all: all,
    downtime: all.filter((status: MonitorStatus) => {
      return !status.isOperationalState;
    }),
    byId: byId,
  };
};

/*
 * The 90-day strip, from the server's per-day aggregate. Days nothing was
 * recorded for are grey and say "No data"; they are never counted as up.
 */
const MonitorUptimeHistoryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const summary: MonitorUptimeSummary | null = props.summary.value;
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const stripRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  /*
   * Memoised on the summary itself, so the graph's day memo is not thrown
   * away every time this card re-renders (opening the day dialog, a poll
   * that did not reload uptime).
   */
  const statusModels: StatusModels = useMemo(() => {
    return toStatusModels(summary?.statuses || []);
  }, [summary]);

  const window90: MonitorUptimeWindowTotal | undefined = useMemo(() => {
    if (!summary) {
      return undefined;
    }

    return (
      MonitorUptimeSummaryUtil.getWindow(
        summary,
        MonitorUptimeWindowKey.Last90Days,
      ) ||
      MonitorUptimeSummaryUtil.sumBuckets({
        key: MonitorUptimeWindowKey.Last90Days,
        buckets: summary.buckets,
        startDate: summary.startDate,
        endDate: summary.endDate,
      })
    );
  }, [summary]);

  const stripKey: string = summary ? summary.monitorId.toString() : "";

  /*
   * On a phone the strip scrolls sideways inside the card. Start it at the
   * right-hand end, so the first thing visible is today, not three months
   * ago.
   */
  useLayoutEffect(() => {
    const strip: HTMLDivElement | null = stripRef.current;

    if (strip) {
      strip.scrollLeft = strip.scrollWidth;
    }
  }, [stripKey]);

  const navigateToIncident: (incidentId: string) => void = (
    incidentId: string,
  ): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, {
        modelId: new ObjectID(incidentId),
      }),
    );
  };

  if (!summary) {
    if (props.summary.status === "forbidden") {
      return (
        <Card title={CARD_TITLE} description={CARD_DESCRIPTION}>
          <SloOverviewEmptyState
            dataTestId="monitor-uptime-forbidden"
            icon={IconProp.Lock}
            title="Uptime history is hidden"
            description="You need permission to read this monitor's status timeline."
          />
        </Card>
      );
    }

    if (props.summary.status === "error") {
      return (
        <Card title={CARD_TITLE} description={CARD_DESCRIPTION}>
          <SloOverviewEmptyState
            dataTestId="monitor-uptime-error"
            icon={IconProp.Alert}
            tone="warning"
            title="Couldn't load uptime history"
            description={props.summary.error}
            actions={
              <Button
                title="Try again"
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                onClick={props.onRetry}
              />
            }
          />
        </Card>
      );
    }

    return (
      <Card title={CARD_TITLE} description={CARD_DESCRIPTION}>
        <div
          data-testid="monitor-uptime-skeleton"
          className="h-20 animate-pulse rounded bg-gray-200"
        />
      </Card>
    );
  }

  const presentation90: UptimeWindowPresentation | null =
    MonitorUptimeSummaryUtil.getWindowPresentation({
      window: window90,
      downtimeStatusIds: MonitorUptimeSummaryUtil.getDowntimeStatusIds(
        summary.statuses,
      ),
      isPausedNow: false,
    });

  let rightElement: ReactElement | undefined = undefined;

  if (presentation90 && presentation90.kind === "NoData") {
    rightElement = (
      <p
        data-testid="monitor-uptime-90d"
        className="text-sm font-medium text-gray-500"
      >
        No data yet
      </p>
    );
  } else if (presentation90) {
    rightElement = (
      <p
        data-testid="monitor-uptime-90d"
        className="text-sm font-semibold tabular-nums text-gray-900"
      >
        {presentation90.valueText}{" "}
        <span className="font-normal text-gray-500">over 90 days</span>
      </p>
    );
  }

  // Only statuses the monitor actually spent time in belong in the legend.
  const legendItems: Array<LegendItem> = [];

  const durations: Array<UptimeStatusDuration> =
    window90?.statusDurations || [];

  for (const duration of durations) {
    if (!(duration.seconds > 0)) {
      continue;
    }

    const statusId: string = duration.monitorStatusId.toString();
    const status: MonitorUptimeSummaryStatus | undefined =
      statusModels.byId[statusId];

    legendItems.push({
      key: statusId,
      name: status?.name || "Unknown status",
      color: status?.color || Green.toString(),
    });
  }

  const monitorCreatedAt: Date | undefined = props.monitorCreatedAt
    ? OneUptimeDate.fromString(props.monitorCreatedAt)
    : undefined;
  const isYoungMonitor: boolean = Boolean(
    monitorCreatedAt &&
      monitorCreatedAt.getTime() > summary.startDate.getTime(),
  );
  const areIncidentMarkersUnavailable: boolean =
    !props.incidents.value &&
    (props.incidents.status === "error" ||
      props.incidents.status === "forbidden");

  return (
    <Card
      title={CARD_TITLE}
      description={CARD_DESCRIPTION}
      rightElement={rightElement}
    >
      <div>
        <div
          ref={stripRef}
          data-testid="monitor-uptime-strip"
          className="overflow-x-auto pb-1"
        >
          <div className="min-w-[36rem] sm:min-w-0">
            <MonitorUptimeGraph
              items={[]}
              uptimeBuckets={summary.buckets}
              monitorStatuses={statusModels.all}
              downtimeMonitorStatuses={statusModels.downtime}
              defaultBarColor={Green}
              startDate={summary.startDate}
              endDate={summary.endDate}
              incidents={props.incidents.value || []}
              onIncidentClick={navigateToIncident}
              onBarClick={(
                date: Date,
                incidents: Array<UptimeBarTooltipIncident>,
                daySummary: UptimeBarDaySummary,
              ) => {
                setSelectedDay({
                  date: date,
                  incidents: incidents,
                  summary: daySummary,
                });
              }}
            />
          </div>
        </div>

        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>{Moment(summary.startDate).format("MMM D")}</span>
          <span>Today</span>
        </div>

        <ul
          aria-label="Legend"
          className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600"
        >
          {legendItems.map((item: LegendItem) => {
            return (
              <li key={item.key} className="inline-flex items-center gap-1.5">
                <MonitorStatusDot color={item.color} />
                {item.name}
              </li>
            );
          })}
          <li className="inline-flex items-center gap-1.5">
            <MonitorStatusDot color={NO_DATA_BAR_COLOR.toString()} />
            No data
          </li>
        </ul>

        <div
          data-testid="monitor-uptime-footnote"
          className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500"
        >
          <p>
            {
              "Downtime counts time in every status that isn't marked operational."
            }
          </p>
          {isYoungMonitor && monitorCreatedAt ? (
            <p className="mt-1">
              {"This monitor was created "}
              <RelativeTime date={monitorCreatedAt} />
              {"; earlier days have no data."}
            </p>
          ) : (
            <></>
          )}
          {areIncidentMarkersUnavailable ? (
            <p className="mt-1">Incident markers are unavailable.</p>
          ) : (
            <></>
          )}
          {summary.isComplete === false ? (
            <p className="mt-1">
              {summary.completeFrom
                ? `History before ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    summary.completeFrom,
                    true,
                  )} is incomplete.`
                : "Part of this history is incomplete."}
            </p>
          ) : (
            <></>
          )}
          {props.summary.refreshError ? (
            <p className="mt-1">
              {`Couldn't refresh the uptime history. ${props.summary.refreshError}`}
            </p>
          ) : (
            <></>
          )}
        </div>

        {selectedDay ? (
          <UptimeBarDayModal
            date={selectedDay.date}
            incidents={selectedDay.incidents}
            uptimePercent={selectedDay.summary.uptimePercent}
            hasEvents={selectedDay.summary.hasEvents}
            statusDurations={selectedDay.summary.statusDurations}
            onIncidentClick={navigateToIncident}
            onClose={() => {
              setSelectedDay(null);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default MonitorUptimeHistoryCard;
