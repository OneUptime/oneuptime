import { HomeOverviewData } from "./HomeOverviewData";
import { formatRelativeTime, toDate } from "./HomeRelativeTime";
import { HOME_ROW_CARD_BODY_CLASS_NAME } from "./HomeRowCard";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Amber500, Gray500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { COULD_NOT_LOAD_THIS_LIST } from "Common/UI/Components/Table/EmptyTableMessage";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import {
  getPillColors,
  getPillDotStyle,
} from "Common/UI/Components/Pill/PillColors";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What is wrong in the project right now, by name: the open incidents, the
 * open alerts, the monitors that are not operational, the SLOs whose budget
 * is burning and the maintenance in progress. The strip above says how many;
 * this says which, and every row opens the record.
 *
 * The rows are read in Home's one batch (HomeOverviewData): the first few of
 * each kind, most relevant first, with the total beside the kind's name and
 * a "View all" into the full list. Kinds with nothing open are left out, so
 * the card only ever shows what needs someone.
 *
 * On Home the card is as tall as its row, and the column beside it is often
 * taller. A list keeps its rows at the top; a state with nothing to list -
 * all clear, nothing monitored yet, or a list that could not be loaded - is
 * the product's empty state, in the middle of the card.
 */

export enum AttentionGroupKey {
  Incidents = "incidents",
  Alerts = "alerts",
  Monitors = "monitors",
  Slos = "slos",
  Maintenance = "maintenance",
}

export interface AttentionRowTime {
  date: Date;
  // How the time is said: "2 hours ago" alone, or "Ends in 2 hours".
  template?: string | undefined;
}

export interface AttentionRow {
  id: string;
  // What the user named it: drawn as it is, never translated.
  title: string;
  // The number and severity, the monitor type or the budget left.
  subtitle?: string | undefined;
  // The colour of the bar at the row's left edge.
  accentColor: Color;
  pill?: { text: string; color: Color } | undefined;
  time?: AttentionRowTime | undefined;
  to: Route;
}

export interface AttentionGroup {
  key: AttentionGroupKey;
  title: string;
  icon: IconProp;
  iconClassName: string;
  count: number;
  rows: Array<AttentionRow>;
  viewAll: PageMap;
}

export const NEEDS_ATTENTION_TITLE: string = translationKey("Needs attention");

export const ALL_CLEAR_TITLE: string = translationKey(
  "Nothing needs your attention",
);

export const ALL_CLEAR_DESCRIPTION: string = translationKey(
  "There are no open incidents or alerts, every monitor is operational and every SLO is within its error budget.",
);

export const NOTHING_MONITORED_TITLE: string = translationKey(
  "Problems will show up here",
);

export const NOTHING_MONITORED_DESCRIPTION: string = translationKey(
  "Once something is monitored, every open incident, alert and failing check is listed here first.",
);

export const UNAVAILABLE_DESCRIPTION: string = translationKey(
  "Use Try again above to load it.",
);

/*
 * A state with nothing to list - all clear, nothing monitored yet, or a
 * list that could not be loaded - takes the room the card has and sits in
 * its middle: beside a taller column the card is tall, and the state at its
 * top would leave the rest of the card blank under it.
 */
export const CENTERED_STATE_CLASS_NAME: string =
  "flex flex-1 flex-col justify-center border-t border-gray-100 px-5 md:px-6";

const ENDS_TEMPLATE: string = translationKey("Ends {{time}}");
const STARTED_TEMPLATE: string = translationKey("Started {{time}}");

type JoinPartsFunction = (
  parts: Array<string | null | undefined>,
) => string | undefined;

// Names and numbers side by side: "INC-42 · SEV-1". Not a sentence.
const joinParts: JoinPartsFunction = (
  parts: Array<string | null | undefined>,
): string | undefined => {
  const present: Array<string> = parts.filter(
    (part: string | null | undefined): part is string => {
      return Boolean(part && part.trim());
    },
  );

  return present.length > 0 ? present.join(" · ") : undefined;
};

type ColorOfFunction = (
  value: Color | string | null | undefined,
  fallback: Color,
) => Color;

const colorOf: ColorOfFunction = (
  value: Color | string | null | undefined,
  fallback: Color,
): Color => {
  if (!value) {
    return fallback;
  }

  return value instanceof Color ? value : new Color(value.toString());
};

type ViewRouteFunction = (pageMap: PageMap, id: string) => Route;

const viewRoute: ViewRouteFunction = (pageMap: PageMap, id: string): Route => {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: id,
  });
};

const incidentRow: (incident: Incident) => AttentionRow = (
  incident: Incident,
): AttentionRow => {
  const id: string = incident._id?.toString() || "";
  const number: string | undefined =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : undefined);
  const date: Date | undefined =
    toDate(incident.declaredAt) || toDate(incident.createdAt);

  return {
    id,
    title: incident.title || "",
    subtitle: joinParts([number, incident.incidentSeverity?.name]),
    accentColor: colorOf(
      incident.incidentSeverity?.color || incident.currentIncidentState?.color,
      Red500,
    ),
    pill: incident.currentIncidentState?.name
      ? {
          text: incident.currentIncidentState.name,
          color: colorOf(incident.currentIncidentState.color, Red500),
        }
      : undefined,
    time: date ? { date } : undefined,
    to: viewRoute(PageMap.INCIDENT_VIEW, id),
  };
};

const alertRow: (alert: Alert) => AttentionRow = (
  alert: Alert,
): AttentionRow => {
  const id: string = alert._id?.toString() || "";
  const number: string | undefined =
    alert.alertNumberWithPrefix ||
    (alert.alertNumber ? `#${alert.alertNumber}` : undefined);
  const date: Date | undefined = toDate(alert.createdAt);

  return {
    id,
    title: alert.title || "",
    subtitle: joinParts([number, alert.alertSeverity?.name]),
    accentColor: colorOf(
      alert.alertSeverity?.color || alert.currentAlertState?.color,
      Amber500,
    ),
    pill: alert.currentAlertState?.name
      ? {
          text: alert.currentAlertState.name,
          color: colorOf(alert.currentAlertState.color, Amber500),
        }
      : undefined,
    time: date ? { date } : undefined,
    to: viewRoute(PageMap.ALERT_VIEW, id),
  };
};

const monitorRow: (monitor: Monitor) => AttentionRow = (
  monitor: Monitor,
): AttentionRow => {
  const id: string = monitor._id?.toString() || "";

  return {
    id,
    title: monitor.name || "",
    subtitle: monitor.monitorType ? monitor.monitorType.toString() : undefined,
    accentColor: colorOf(monitor.currentMonitorStatus?.color, Red500),
    pill: monitor.currentMonitorStatus?.name
      ? {
          text: monitor.currentMonitorStatus.name,
          color: colorOf(monitor.currentMonitorStatus.color, Red500),
        }
      : undefined,
    to: viewRoute(PageMap.MONITOR_VIEW, id),
  };
};

const sloRow: (
  slo: ServiceLevelObjective,
  translator: Translator,
) => AttentionRow = (
  slo: ServiceLevelObjective,
  translator: Translator,
): AttentionRow => {
  const id: string = slo._id?.toString() || "";
  const isExhausted: boolean = slo.sloStatus === SloStatus.BudgetExhausted;
  const remaining: number | undefined =
    typeof slo.errorBudgetRemainingPercentage === "number" &&
    Number.isFinite(slo.errorBudgetRemainingPercentage)
      ? slo.errorBudgetRemainingPercentage
      : undefined;

  let subtitle: string | undefined = undefined;

  if (isExhausted || (remaining !== undefined && remaining <= 0)) {
    subtitle = translator.translateText("No error budget left");
  } else if (remaining !== undefined) {
    subtitle = translator.translateTemplate(
      "{{remaining}} of the error budget left",
      {
        remaining: `${translator.formatNumber(
          Math.round(remaining * 10) / 10,
        )}%`,
      },
    );
  }

  const color: Color = isExhausted ? Red500 : Amber500;

  return {
    id,
    title: slo.name || "",
    subtitle,
    accentColor: color,
    pill: slo.sloStatus ? { text: slo.sloStatus, color } : undefined,
    to: viewRoute(PageMap.SLO_VIEW, id),
  };
};

const maintenanceRow: (event: ScheduledMaintenance) => AttentionRow = (
  event: ScheduledMaintenance,
): AttentionRow => {
  const id: string = event._id?.toString() || "";
  const endsAt: Date | undefined = toDate(event.endsAt);
  const startsAt: Date | undefined = toDate(event.startsAt);

  return {
    id,
    title: event.title || "",
    accentColor: colorOf(
      event.currentScheduledMaintenanceState?.color,
      Gray500,
    ),
    pill: event.currentScheduledMaintenanceState?.name
      ? {
          text: event.currentScheduledMaintenanceState.name,
          color: colorOf(event.currentScheduledMaintenanceState.color, Gray500),
        }
      : undefined,
    time: endsAt
      ? { date: endsAt, template: ENDS_TEMPLATE }
      : startsAt
        ? { date: startsAt, template: STARTED_TEMPLATE }
        : undefined,
    to: viewRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW, id),
  };
};

/*
 * The groups with something open, most urgent kind first: incidents affect
 * users, alerts and failing monitors are next, a burning budget after them,
 * and maintenance - planned - last.
 */
export const getAttentionGroups: (
  data: HomeOverviewData,
  translator: Translator,
) => Array<AttentionGroup> = (
  data: HomeOverviewData,
  translator: Translator,
): Array<AttentionGroup> => {
  const groups: Array<AttentionGroup> = [
    {
      key: AttentionGroupKey.Incidents,
      title: translationKey("Active incidents"),
      icon: IconProp.Alert,
      iconClassName: "text-red-600",
      count: data.activeIncidents.count,
      rows: data.activeIncidents.items.map(incidentRow),
      viewAll: PageMap.HOME_ACTIVE_INCIDENTS,
    },
    {
      key: AttentionGroupKey.Alerts,
      title: translationKey("Active alerts"),
      icon: IconProp.ExclaimationCircle,
      iconClassName: "text-amber-600",
      count: data.activeAlerts.count,
      rows: data.activeAlerts.items.map(alertRow),
      viewAll: PageMap.HOME_ACTIVE_ALERTS,
    },
    {
      key: AttentionGroupKey.Monitors,
      title: translationKey("Not operational monitors"),
      icon: IconProp.AltGlobe,
      iconClassName: "text-red-600",
      count: data.notOperationalMonitors.count,
      rows: data.notOperationalMonitors.items.map(monitorRow),
      viewAll: PageMap.HOME_NOT_OPERATIONAL_MONITORS,
    },
    {
      key: AttentionGroupKey.Slos,
      title: translationKey("SLOs at risk"),
      icon: IconProp.Gauge,
      iconClassName: "text-amber-600",
      count: data.slosNeedingAttention.count,
      rows: data.slosNeedingAttention.items.map(
        (slo: ServiceLevelObjective): AttentionRow => {
          return sloRow(slo, translator);
        },
      ),
      viewAll: PageMap.SLOS,
    },
    {
      key: AttentionGroupKey.Maintenance,
      title: translationKey("Ongoing maintenance"),
      icon: IconProp.Clock,
      iconClassName: "text-indigo-600",
      count: data.ongoingMaintenance.count,
      rows: data.ongoingMaintenance.items.map(maintenanceRow),
      viewAll: PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    },
  ];

  return groups.filter((group: AttentionGroup): boolean => {
    return group.count > 0;
  });
};

export interface ComponentProps {
  data: HomeOverviewData | null;
  isLoading: boolean;
  now: Date;
}

const NeedsAttention: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const groups: Array<AttentionGroup> = props.data
    ? getAttentionGroups(props.data, translator)
    : [];

  const totalOpen: number = groups.reduce(
    (total: number, group: AttentionGroup): number => {
      return group.key === AttentionGroupKey.Maintenance
        ? total
        : total + group.count;
    },
    0,
  );

  const renderTime: (time: AttentionRowTime) => ReactElement = (
    time: AttentionRowTime,
  ): ReactElement => {
    const relative: string = formatRelativeTime({
      date: time.date,
      now: props.now,
      language: translator.language,
    });

    return (
      <span
        data-testid="home-attention-row-time"
        title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          time.date,
        )}
        className="whitespace-nowrap"
      >
        {time.template
          ? translator.translateTemplate(time.template, { time: relative })
          : relative}
      </span>
    );
  };

  const renderRow: (row: AttentionRow, groupKey: string) => ReactElement = (
    row: AttentionRow,
    groupKey: string,
  ): ReactElement => {
    return (
      <li key={row.id}>
        <AppLink
          to={row.to}
          className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:px-6"
        >
          <span
            data-testid={`home-attention-row-${groupKey}`}
            data-id={row.id}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <span
              aria-hidden="true"
              data-ou-pill-dot=""
              className="h-9 w-1 flex-none rounded-full"
              style={getPillDotStyle(getPillColors(row.accentColor))}
            ></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-900">
                {row.title || translator.translateText("Untitled")}
              </span>
              {row.subtitle || row.time ? (
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
                  {row.subtitle ? (
                    <span className="truncate">{row.subtitle}</span>
                  ) : (
                    <></>
                  )}
                  {row.subtitle && row.time ? (
                    <span aria-hidden="true">·</span>
                  ) : (
                    <></>
                  )}
                  {row.time ? renderTime(row.time) : <></>}
                </span>
              ) : (
                <></>
              )}
            </span>
            {row.pill ? (
              <span className="max-sm:hidden flex-none sm:inline-flex">
                <Pill
                  text={row.pill.text}
                  color={row.pill.color}
                  size={PillSize.Small}
                />
              </span>
            ) : (
              <></>
            )}
          </span>
          <Icon
            icon={IconProp.ChevronRight}
            className="h-4 w-4 flex-none text-gray-400"
          />
        </AppLink>
      </li>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      /*
       * Under the same divider as every state that follows it, so the
       * header does not gain a line when the list arrives.
       */
      return (
        <div
          data-testid="home-attention-loading"
          className="space-y-1 border-t border-gray-100 py-2"
        >
          {[0, 1, 2].map((index: number): ReactElement => {
            return (
              <div
                key={index}
                className="flex items-center gap-3 px-5 py-3 md:px-6"
              >
                <span className="h-9 w-1 flex-none rounded-full bg-gray-200"></span>
                <span className="flex-1 space-y-2">
                  <span className="block h-4 w-2/3 animate-pulse rounded bg-gray-100"></span>
                  <span className="block h-3 w-1/3 animate-pulse rounded bg-gray-100"></span>
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    if (!props.data) {
      return (
        <div
          data-testid="home-attention-unavailable"
          className={CENTERED_STATE_CLASS_NAME}
        >
          <TableEmptyState
            kind={TableEmptyStateKind.Error}
            title={COULD_NOT_LOAD_THIS_LIST}
            description={UNAVAILABLE_DESCRIPTION}
            isCompact={true}
            dataTestId="home-attention-unavailable-state"
          />
        </div>
      );
    }

    if (groups.length === 0) {
      const isNothingMonitored: boolean = props.data.totalMonitors === 0;

      return (
        <div
          data-testid="home-attention-empty"
          data-state={isNothingMonitored ? "nothing-monitored" : "all-clear"}
          className={CENTERED_STATE_CLASS_NAME}
        >
          <TableEmptyState
            kind={
              isNothingMonitored
                ? TableEmptyStateKind.Empty
                : TableEmptyStateKind.AllClear
            }
            icon={isNothingMonitored ? IconProp.Inbox : undefined}
            title={
              isNothingMonitored ? NOTHING_MONITORED_TITLE : ALL_CLEAR_TITLE
            }
            description={
              isNothingMonitored
                ? NOTHING_MONITORED_DESCRIPTION
                : ALL_CLEAR_DESCRIPTION
            }
            isCompact={true}
            dataTestId="home-attention-empty-state"
          />
        </div>
      );
    }

    return (
      <div
        data-testid="home-attention-groups"
        className="divide-y divide-gray-100 border-t border-gray-100"
      >
        {groups.map((group: AttentionGroup): ReactElement => {
          const hidden: number = Math.max(0, group.count - group.rows.length);

          return (
            <section
              key={group.key}
              data-testid={`home-attention-group-${group.key}`}
              aria-label={translator.translateText(group.title) || group.title}
            >
              <div className="flex items-center justify-between gap-3 bg-gray-50 px-5 py-2 md:px-6">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    icon={group.icon}
                    className={`h-4 w-4 flex-none ${group.iconClassName}`}
                  />
                  <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {translator.translateText(group.title)}
                  </h3>
                  <span
                    data-testid={`home-attention-group-${group.key}-count`}
                    className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700 ring-1 ring-inset ring-gray-200"
                  >
                    {translator.formatNumber(group.count)}
                  </span>
                </div>
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[group.viewAll] as Route,
                  )}
                  className="flex-none text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  <span
                    data-testid={`home-attention-group-${group.key}-view-all`}
                  >
                    {hidden > 0
                      ? translator.translateTemplate("View all {{count}}", {
                          count: translator.formatNumber(group.count),
                        })
                      : translator.translateText("View all")}
                  </span>
                </AppLink>
              </div>
              <ul className="divide-y divide-gray-100">
                {group.rows.map((row: AttentionRow): ReactElement => {
                  return renderRow(row, group.key);
                })}
              </ul>
            </section>
          );
        })}
      </div>
    );
  };

  return (
    <div data-testid="home-needs-attention">
      {/*
       * As tall as Home's row: beside a taller column, a list keeps its
       * rows at the top with room under them, and a state with nothing to
       * list sits in the middle (CENTERED_STATE_CLASS_NAME).
       */}
      <Card
        fillHeight={true}
        title={NEEDS_ATTENTION_TITLE}
        description="What is open in this project right now, most urgent first. Open a row to respond."
        rightElement={
          props.data && totalOpen > 0 ? (
            <span
              data-testid="home-attention-total"
              className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-red-700 ring-1 ring-inset ring-red-200"
            >
              {translator.translatePlural(
                { one: "{{count}} open", other: "{{count}} open" },
                totalOpen,
              )}
            </span>
          ) : undefined
        }
        bodyClassName={HOME_ROW_CARD_BODY_CLASS_NAME}
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default NeedsAttention;
