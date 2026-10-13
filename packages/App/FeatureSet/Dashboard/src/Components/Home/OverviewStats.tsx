import { HomeCounts } from "./HomeOverviewData";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The five numbers under Home's health headline: what is open right now, one
 * cell per kind, each opening the list it counts.
 *
 * The counts come in from Home's one parallel batch (HomeOverviewData), which
 * also feeds the headline and the attention list, so the strip makes no
 * request of its own.
 */

export interface ComponentProps {
  // Null while the first load is in flight.
  counts: HomeCounts | null;
  isLoading: boolean;
}

/*
 * A cell about something the project has not set up yet. "All operational"
 * over zero monitors reads as though monitors were watching and found nothing
 * wrong, which is exactly the wrong impression to give someone who has not
 * created one. Such a cell says so instead, and opens the place to fix it.
 */
interface NotSetUpState {
  isNotSetUp: boolean;
  label: string;
  pageMap: PageMap;
}

export enum StatTileTone {
  Attention = "attention",
  Warning = "warning",
  AllClear = "all-clear",
  NotSetUp = "not-set-up",
}

export interface StatTile {
  key: string;
  label: string;
  count: number;
  tone: StatTileTone;
  statusLabel: string;
  statusIcon: IconProp;
  // Where the cell opens.
  pageMap: PageMap;
}

interface StatTileDefinition {
  key: string;
  label: string;
  pageMap: PageMap;
  count: (counts: HomeCounts) => number;
  // Shown when the count is above zero.
  attentionLabel: string;
  attentionTone: StatTileTone;
  attentionIcon: IconProp;
  // Shown when the count is zero.
  allClearLabel: string;
  notSetUp?: ((counts: HomeCounts) => NotSetUpState) | undefined;
}

// The copy the cells show, exported so tests read the same strings.
export const NO_MONITORS_YET_LABEL: string = "No monitors yet";
export const NO_SLOS_YET_LABEL: string = "No SLOs yet";

const STAT_TILE_DEFINITIONS: Array<StatTileDefinition> = [
  {
    key: "active-incidents",
    label: "Active incidents",
    pageMap: PageMap.HOME_ACTIVE_INCIDENTS,
    count: (counts: HomeCounts): number => {
      return counts.activeIncidents;
    },
    attentionLabel: "Needs attention",
    attentionTone: StatTileTone.Attention,
    attentionIcon: IconProp.Alert,
    allClearLabel: "All clear",
  },
  {
    key: "active-alerts",
    label: "Active alerts",
    pageMap: PageMap.HOME_ACTIVE_ALERTS,
    count: (counts: HomeCounts): number => {
      return counts.activeAlerts;
    },
    attentionLabel: "Needs attention",
    attentionTone: StatTileTone.Attention,
    attentionIcon: IconProp.Alert,
    allClearLabel: "All clear",
  },
  {
    key: "not-operational-monitors",
    label: "Not operational monitors",
    pageMap: PageMap.HOME_NOT_OPERATIONAL_MONITORS,
    count: (counts: HomeCounts): number => {
      return counts.notOperationalMonitors;
    },
    attentionLabel: "Needs attention",
    attentionTone: StatTileTone.Attention,
    attentionIcon: IconProp.Error,
    allClearLabel: "All operational",
    /*
     * The Monitors list, not the create form: its empty state offers the
     * Create Monitor button behind the same permission gate as its header,
     * while the form would open for someone who cannot submit it.
     */
    notSetUp: (counts: HomeCounts): NotSetUpState => {
      return {
        isNotSetUp: counts.totalMonitors === 0,
        label: NO_MONITORS_YET_LABEL,
        pageMap: PageMap.MONITORS,
      };
    },
  },
  {
    key: "ongoing-maintenance",
    label: "Ongoing maintenance",
    pageMap: PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    count: (counts: HomeCounts): number => {
      return counts.ongoingMaintenance;
    },
    attentionLabel: "In progress",
    attentionTone: StatTileTone.Warning,
    attentionIcon: IconProp.Clock,
    allClearLabel: "None ongoing",
  },
  {
    key: "slos-needing-attention",
    label: "SLOs at risk",
    pageMap: PageMap.SLOS,
    count: (counts: HomeCounts): number => {
      return counts.slosNeedingAttention;
    },
    attentionLabel: "Budget burning",
    attentionTone: StatTileTone.Warning,
    attentionIcon: IconProp.Gauge,
    allClearLabel: "Budgets healthy",
    notSetUp: (counts: HomeCounts): NotSetUpState => {
      return {
        isNotSetUp: counts.totalSlos === 0,
        label: NO_SLOS_YET_LABEL,
        pageMap: PageMap.SLOS,
      };
    },
  },
];

// The keys of the cells, in the order they are drawn.
export const STAT_TILE_KEYS: Array<string> = STAT_TILE_DEFINITIONS.map(
  (definition: StatTileDefinition): string => {
    return definition.key;
  },
);

// What each cell says for these counts. Pure, for the tests.
export const getStatTiles: (counts: HomeCounts) => Array<StatTile> = (
  counts: HomeCounts,
): Array<StatTile> => {
  return STAT_TILE_DEFINITIONS.map(
    (definition: StatTileDefinition): StatTile => {
      const count: number = Math.max(0, definition.count(counts) || 0);
      const notSetUp: NotSetUpState | undefined = definition.notSetUp?.(counts);

      if (notSetUp?.isNotSetUp) {
        return {
          key: definition.key,
          label: definition.label,
          count: count,
          tone: StatTileTone.NotSetUp,
          statusLabel: notSetUp.label,
          statusIcon: IconProp.Add,
          pageMap: notSetUp.pageMap,
        };
      }

      if (count > 0) {
        return {
          key: definition.key,
          label: definition.label,
          count: count,
          tone: definition.attentionTone,
          statusLabel: definition.attentionLabel,
          statusIcon: definition.attentionIcon,
          pageMap: definition.pageMap,
        };
      }

      return {
        key: definition.key,
        label: definition.label,
        count: count,
        tone: StatTileTone.AllClear,
        statusLabel: definition.allClearLabel,
        statusIcon: IconProp.CheckCircle,
        pageMap: definition.pageMap,
      };
    },
  );
};

const STATUS_CLASS_NAME: Record<StatTileTone, string> = {
  [StatTileTone.Attention]: "text-red-600",
  [StatTileTone.Warning]: "text-amber-600",
  [StatTileTone.AllClear]: "text-emerald-600",
  [StatTileTone.NotSetUp]: "text-gray-500",
};

const COUNT_CLASS_NAME: Record<StatTileTone, string> = {
  [StatTileTone.Attention]: "text-red-600",
  [StatTileTone.Warning]: "text-amber-600",
  [StatTileTone.AllClear]: "text-gray-900",
  [StatTileTone.NotSetUp]: "text-gray-400",
};

/*
 * The cells sit on a 1px grey grid: the container is grey and every cell is
 * white, so the hairlines between them line up at every breakpoint.
 */
const OverviewStats: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tiles: Array<StatTile> | null = props.counts
    ? getStatTiles(props.counts)
    : null;

  return (
    <div
      data-testid="home-overview-stats"
      className="grid grid-cols-2 gap-px border-t border-gray-200 bg-gray-200 xl:grid-cols-5"
    >
      {STAT_TILE_DEFINITIONS.map(
        (definition: StatTileDefinition, index: number): ReactElement => {
          const tile: StatTile | null = tiles ? tiles[index] || null : null;

          /*
           * Two to a row until the five fit on one: the fifth then spans its
           * row, so no empty grey slot is left beside it.
           */
          const spanClassName: string =
            index === STAT_TILE_DEFINITIONS.length - 1
              ? "col-span-2 xl:col-span-1"
              : "";

          if (props.isLoading || !tile) {
            return (
              <div
                key={definition.key}
                data-testid={`home-stat-${definition.key}-loading`}
                className={`bg-white px-5 py-4 ${spanClassName}`}
              >
                <div className="break-words text-xs font-medium uppercase leading-4 tracking-wide text-gray-500">
                  {translator.translateText(definition.label)}
                </div>
                <div className="mt-2 h-7 w-12 animate-pulse rounded bg-gray-100"></div>
                <div className="mt-2 h-4 w-24 animate-pulse rounded bg-gray-100"></div>
              </div>
            );
          }

          return (
            <AppLink
              key={tile.key}
              to={RouteUtil.populateRouteParams(
                RouteMap[tile.pageMap] as Route,
              )}
              className={`group block bg-white px-5 py-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${spanClassName}`}
            >
              <div
                data-testid={`home-stat-${tile.key}-tile`}
                data-tone={tile.tone}
                className="min-w-0"
              >
                <div className="break-words text-xs font-medium uppercase leading-4 tracking-wide text-gray-500">
                  {translator.translateText(tile.label)}
                </div>
                <div
                  data-testid={`home-stat-${tile.key}`}
                  className={`mt-1 text-2xl font-semibold tabular-nums ${COUNT_CLASS_NAME[tile.tone]}`}
                >
                  {translator.formatNumber(tile.count)}
                </div>
                <div
                  data-testid={`home-stat-${tile.key}-status`}
                  className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${STATUS_CLASS_NAME[tile.tone]}`}
                >
                  <Icon icon={tile.statusIcon} className="h-4 w-4 flex-none" />
                  <span className="truncate">
                    {translator.translateText(tile.statusLabel)}
                  </span>
                </div>
              </div>
            </AppLink>
          );
        },
      )}
    </div>
  );
};

export default OverviewStats;
