import PageMap from "../../../Utils/PageMap";
import { OverviewSection } from "../../../Utils/OverviewSection";
import EventStatBar from "../../EventView/EventStatBar";
import EventStatTile from "../../EventView/EventStatTile";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import { MonitorOpenWork, MonitorOpenWorkSide } from "./MonitorOverviewTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MonitorUptimeSummary,
  MonitorUptimeWindowKey,
} from "Common/Types/Monitor/MonitorUptimeSummary";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import MonitorUptimeSummaryUtil, {
  MonitorUptimeCaveat,
  UptimeWindowPresentation,
} from "Common/Utils/Monitor/MonitorUptimeSummaryUtil";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  summary: OverviewSection<MonitorUptimeSummary>;
  /*
   * What every window must add about time it counts but nothing measured
   * (paused, nothing checking, no check completed yet), from
   * MonitorOverviewPresentationUtil.getUptimeCaveat. Null for none.
   */
  caveat: MonitorUptimeCaveat | null;
  openWork: MonitorOpenWork;
  className?: string | undefined;
}

interface TileContent {
  value: string | ReactElement;
  description?: string | undefined;
}

interface UptimeTileDefinition {
  id: string;
  label: string;
  icon: IconProp;
  key: MonitorUptimeWindowKey;
}

const UPTIME_TILES: Array<UptimeTileDefinition> = [
  {
    id: "monitor-uptime-24h",
    label: "Uptime · 24 hours",
    icon: IconProp.CheckCircle,
    key: MonitorUptimeWindowKey.Last24Hours,
  },
  {
    id: "monitor-uptime-7d",
    label: "Uptime · 7 days",
    icon: IconProp.CheckCircle,
    key: MonitorUptimeWindowKey.Last7Days,
  },
  {
    id: "monitor-uptime-30d",
    label: "Uptime · 30 days",
    icon: IconProp.Calendar,
    key: MonitorUptimeWindowKey.Last30Days,
  },
];

const LOADING_TILE: TileContent = {
  value: <Skeleton className="h-6 w-16" />,
};

const getUnknownValue: () => ReactElement = (): ReactElement => {
  return <span className="text-gray-400">—</span>;
};

/*
 * One uptime window. "No data" (nothing was recorded) and "—" (the number
 * could not be read) are different answers and read differently, and
 * neither is ever shown as 100%.
 */
export const getUptimeTileContent: (data: {
  summary: OverviewSection<MonitorUptimeSummary>;
  windowKey: MonitorUptimeWindowKey;
  caveat: MonitorUptimeCaveat | null;
}) => TileContent = (data: {
  summary: OverviewSection<MonitorUptimeSummary>;
  windowKey: MonitorUptimeWindowKey;
  caveat: MonitorUptimeCaveat | null;
}): TileContent => {
  const summary: MonitorUptimeSummary | null = data.summary.value;

  if (!summary) {
    if (data.summary.status === "forbidden") {
      return {
        value: getUnknownValue(),
        description: "No access to status history",
      };
    }

    if (data.summary.status === "error") {
      return {
        value: getUnknownValue(),
        description: "Uptime is unavailable",
      };
    }

    return LOADING_TILE;
  }

  const presentation: UptimeWindowPresentation | null =
    MonitorUptimeSummaryUtil.getWindowPresentation({
      window: MonitorUptimeSummaryUtil.getWindow(summary, data.windowKey),
      downtimeStatusIds: MonitorUptimeSummaryUtil.getDowntimeStatusIds(
        summary.statuses,
      ),
      caveat: data.caveat,
    });

  // A summary without this window cannot vouch for any number.
  if (!presentation) {
    return {
      value: getUnknownValue(),
      description: "Uptime is unavailable",
    };
  }

  return {
    value: (
      <span
        className={
          presentation.kind === "NoData" ? "text-gray-400" : "text-gray-900"
        }
      >
        {presentation.valueText}
      </span>
    ),
    description: presentation.description,
  };
};

/*
 * "Open now": the stat bar's answer to "is anything on fire". A side that
 * could not be read shows "—" in place of its count, never 0. A side whose
 * last refresh failed keeps the count it had and says so: that count may
 * be out of date, so it is never the all-clear.
 */
export const getOpenNowTileContent: (data: {
  monitorId: ObjectID;
  openWork: MonitorOpenWork;
  translator: Translator;
}) => TileContent = (data: {
  monitorId: ObjectID;
  openWork: MonitorOpenWork;
  translator: Translator;
}): TileContent => {
  const translator: Translator = data.translator;
  const incidents: OverviewSection<MonitorOpenWorkSide> =
    data.openWork.incidents;
  const alerts: OverviewSection<MonitorOpenWorkSide> = data.openWork.alerts;

  const isLoading: (
    section: OverviewSection<MonitorOpenWorkSide>,
  ) => boolean = (section: OverviewSection<MonitorOpenWorkSide>): boolean => {
    return !section.value && section.status === "loading";
  };

  if (isLoading(incidents) || isLoading(alerts)) {
    return LOADING_TILE;
  }

  const incidentCount: number | null = incidents.value
    ? incidents.value.count
    : null;
  const alertCount: number | null = alerts.value ? alerts.value.count : null;
  const isIncidentsStale: boolean = Boolean(
    incidents.value && incidents.refreshError,
  );
  const isAlertsStale: boolean = Boolean(alerts.value && alerts.refreshError);

  if (
    incidentCount === 0 &&
    alertCount === 0 &&
    !isIncidentsStale &&
    !isAlertsStale
  ) {
    return {
      value: <span className="text-emerald-700">{translator.translateText("Nothing open")}</span>,
      description: "No unresolved incidents or alerts",
    };
  }

  // English translation keys, translated as the description is drawn.
  const notes: Array<string> = [];

  if (isIncidentsStale && isAlertsStale) {
    notes.push(translationKey("Couldn't refresh · showing earlier counts"));
  } else if (isIncidentsStale) {
    notes.push(translationKey("Couldn't refresh incidents · showing the earlier count"));
  } else if (isAlertsStale) {
    notes.push(translationKey("Couldn't refresh alerts · showing the earlier count"));
  }

  const isIncidentsForbidden: boolean =
    !incidents.value && incidents.status === "forbidden";
  const isAlertsForbidden: boolean =
    !alerts.value && alerts.status === "forbidden";

  if (isIncidentsForbidden && isAlertsForbidden) {
    notes.push(translationKey("Incidents and alerts hidden: no access"));
  } else if (isIncidentsForbidden) {
    notes.push(translationKey("Incidents hidden: no access"));
  } else if (isAlertsForbidden) {
    notes.push(translationKey("Alerts hidden: no access"));
  }

  if (!incidents.value && incidents.status === "error") {
    notes.push(translationKey("Couldn't load open incidents"));
  }

  if (!alerts.value && alerts.status === "error") {
    notes.push(translationKey("Couldn't load open alerts"));
  }

  const incidentsPart: ReactElement =
    incidentCount === null ? (
      <span>
        <TranslatedSentence
          template="{{count}} incidents"
          slots={{ count: getUnknownValue() }}
        />
      </span>
    ) : (
      <Link
        to={getMonitorPageRoute({
          pageMap: PageMap.MONITOR_VIEW_INCIDENTS,
          monitorId: data.monitorId,
        })}
        className={`hover:underline ${
          incidentCount > 0 ? "text-red-700" : "text-gray-900"
        }`}
      >
        {translator.translatePlural(
          { one: "{{count}} incident", other: "{{count}} incidents" },
          incidentCount,
        )}
      </Link>
    );

  const alertsPart: ReactElement =
    alertCount === null ? (
      <span>
        <TranslatedSentence
          template="{{count}} alerts"
          slots={{ count: getUnknownValue() }}
        />
      </span>
    ) : (
      <Link
        to={getMonitorPageRoute({
          pageMap: PageMap.MONITOR_VIEW_ALERTS,
          monitorId: data.monitorId,
        })}
        className={`hover:underline ${
          alertCount > 0 ? "text-amber-700" : "text-gray-900"
        }`}
      >
        {translator.translatePlural(
          { one: "{{count}} alert", other: "{{count}} alerts" },
          alertCount,
        )}
      </Link>
    );

  return {
    value: (
      <span data-testid="monitor-open-now-value">
        {incidentsPart}
        {" · "}
        {alertsPart}
      </span>
    ),
    description:
      notes.length > 0
        ? notes
            .map((note: string): string => {
              return translator.translateText(note) || note;
            })
            .join(" · ")
        : "Unresolved on this monitor",
  };
};

/*
 * The four headline numbers under the hero: uptime over three rolling
 * windows and what is open right now. Always four cells, whatever the
 * sections say, so the row never changes shape between loads.
 */
const MonitorOverviewStatBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const openNow: TileContent = getOpenNowTileContent({
    monitorId: props.monitorId,
    openWork: props.openWork,
    translator: translator,
  });

  return (
    <EventStatBar
      columns={4}
      ariaLabel="Uptime and open work"
      className={props.className}
    >
      {UPTIME_TILES.map((tile: UptimeTileDefinition) => {
        const content: TileContent = getUptimeTileContent({
          summary: props.summary,
          windowKey: tile.key,
          caveat: props.caveat,
        });

        return (
          <EventStatTile
            key={tile.id}
            variant="segment"
            id={tile.id}
            label={tile.label}
            icon={tile.icon}
            value={content.value}
            description={content.description}
          />
        );
      })}
      <EventStatTile
        key="monitor-open-now"
        variant="segment"
        id="monitor-open-now"
        label="Open now"
        icon={IconProp.Alert}
        value={openNow.value}
        description={openNow.description}
      />
    </EventStatBar>
  );
};

export default MonitorOverviewStatBar;
