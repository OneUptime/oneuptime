import { HomeCounts } from "./HomeOverviewData";
import { getHomeListRoute } from "./HomeListRoute";
import AppLink from "../AppLink/AppLink";
import { getSlosAtRiskQueryParams } from "../Slo/SloListFacetRoute";
import PageMap from "../../Utils/PageMap";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import ProductKey from "Common/Types/Product/ProductKey";
import { getOffProducts } from "Common/Types/Product/ServerProducts";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The five numbers under Home's health headline: what is open right now, one
 * cell per kind, each opening the list it counts - in its own product, with
 * that product's side menu, filters and actions (Alerts > Active Alerts for
 * active alerts). Home is one page and keeps no lists of its own. SLOs have
 * no list of the ones at risk, so that cell opens the SLOs list with its
 * Status and Enabled chips set to them (linkQuery).
 *
 * The counts come in from Home's one parallel batch (HomeOverviewData), which
 * also feeds the headline and the attention list, so the strip makes no
 * request of its own.
 *
 * A cell of a product switched off on the server (#6815) is left out, and
 * the others share the row: a server with Monitoring and status pages shows
 * incidents, monitors and maintenance, not alerts or SLOs.
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
  /*
   * That list's own filters, in its address, when it holds more than the
   * cell counts: the SLOs list showing only the SLOs at risk. None: the
   * whole list.
   */
  linkQuery?: Dictionary<string> | undefined;
}

interface StatTileDefinition {
  key: string;
  label: string;
  pageMap: PageMap;
  /*
   * The list's filters while the count is above zero, so it shows exactly
   * what the cell counts. At zero, or before anything is set up, the cell
   * opens the whole list, where there is something to see.
   */
  attentionLinkQuery?: (() => Dictionary<string>) | undefined;
  count: (counts: HomeCounts) => number;
  // Shown when the count is above zero.
  attentionLabel: string;
  attentionTone: StatTileTone;
  attentionIcon: IconProp;
  // Shown when the count is zero.
  allClearLabel: string;
  // The product the cell counts: left out while it is off on the server.
  product: ProductKey;
  notSetUp?: ((counts: HomeCounts) => NotSetUpState) | undefined;
}

// The copy the cells show, exported so tests read the same strings.
export const NO_MONITORS_YET_LABEL: string = "No monitors yet";
export const NO_SLOS_YET_LABEL: string = "No SLOs yet";

const STAT_TILE_DEFINITIONS: Array<StatTileDefinition> = [
  {
    key: "active-incidents",
    label: "Active incidents",
    pageMap: PageMap.UNRESOLVED_INCIDENTS,
    count: (counts: HomeCounts): number => {
      return counts.activeIncidents;
    },
    attentionLabel: "Needs attention",
    attentionTone: StatTileTone.Attention,
    attentionIcon: IconProp.Alert,
    allClearLabel: "All clear",
    product: ProductKey.Incidents,
  },
  {
    key: "active-alerts",
    label: "Active alerts",
    pageMap: PageMap.UNRESOLVED_ALERTS,
    count: (counts: HomeCounts): number => {
      return counts.activeAlerts;
    },
    attentionLabel: "Needs attention",
    attentionTone: StatTileTone.Attention,
    attentionIcon: IconProp.Alert,
    allClearLabel: "All clear",
    product: ProductKey.Alerts,
  },
  {
    key: "not-operational-monitors",
    label: "Not operational monitors",
    pageMap: PageMap.MONITORS_INOPERATIONAL,
    count: (counts: HomeCounts): number => {
      return counts.notOperationalMonitors;
    },
    attentionLabel: "Needs attention",
    attentionTone: StatTileTone.Attention,
    attentionIcon: IconProp.Error,
    allClearLabel: "All operational",
    product: ProductKey.Monitors,
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
    pageMap: PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    count: (counts: HomeCounts): number => {
      return counts.ongoingMaintenance;
    },
    attentionLabel: "In progress",
    attentionTone: StatTileTone.Warning,
    attentionIcon: IconProp.Clock,
    allClearLabel: "None ongoing",
    product: ProductKey.ScheduledMaintenance,
  },
  {
    key: "slos-needing-attention",
    label: "SLOs at risk",
    pageMap: PageMap.SLOS,
    attentionLinkQuery: getSlosAtRiskQueryParams,
    count: (counts: HomeCounts): number => {
      return counts.slosNeedingAttention;
    },
    attentionLabel: "Budget burning",
    attentionTone: StatTileTone.Warning,
    attentionIcon: IconProp.Gauge,
    allClearLabel: "Budgets healthy",
    product: ProductKey.Slos,
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

/*
 * The keys of the cells a server shows: every cell but those of products
 * switched off on it (#6815).
 */
export const getStatTileKeysOnServer: (
  offProducts: ReadonlyArray<ProductKey>,
) => Array<string> = (
  offProducts: ReadonlyArray<ProductKey>,
): Array<string> => {
  return STAT_TILE_DEFINITIONS.filter(
    (definition: StatTileDefinition): boolean => {
      return !offProducts.includes(definition.product);
    },
  ).map((definition: StatTileDefinition): string => {
    return definition.key;
  });
};

// The grid's columns from xl up, for as many cells as are shown.
const XL_COLUMNS_CLASS_NAME: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

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
          linkQuery: definition.attentionLinkQuery?.(),
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
 *
 * Each cell spans three of the grid's rows as a subgrid (CELL_ROWS): title,
 * number, status. A title or status that takes two lines in one cell, as
 * German ones do, makes that row taller for the whole row of cells, so the
 * numbers and statuses still line up across it. Nothing is cut off. The one
 * column is grid-cols-1, minmax(0, 1fr): an auto column would grow to fit a
 * word longer than the cell and push it past the cell's edge.
 */
const CELL_ROWS: string = "row-span-3 grid grid-cols-1 grid-rows-subgrid";

const OverviewStats: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const products: ProjectProductsState = useProjectProducts();
  const shownKeys: Array<string> = getStatTileKeysOnServer(
    getOffProducts(products.answer.offOnServer || {}),
  );
  const definitions: Array<StatTileDefinition> = STAT_TILE_DEFINITIONS.filter(
    (definition: StatTileDefinition): boolean => {
      return shownKeys.includes(definition.key);
    },
  );

  const tiles: Array<StatTile> | null = props.counts
    ? getStatTiles(props.counts)
    : null;

  return (
    <div
      data-testid="home-overview-stats"
      className={`grid grid-cols-2 gap-px border-t border-gray-200 bg-gray-200 ${
        XL_COLUMNS_CLASS_NAME[Math.max(1, definitions.length)] ||
        "xl:grid-cols-5"
      }`}
    >
      {definitions.map(
        (definition: StatTileDefinition, index: number): ReactElement => {
          const tile: StatTile | null = tiles
            ? tiles.find((each: StatTile): boolean => {
                return each.key === definition.key;
              }) || null
            : null;

          /*
           * Two to a row until they all fit on one: an odd last one then
           * spans its row, so no empty grey slot is left beside it.
           */
          const spanClassName: string =
            index === definitions.length - 1 && definitions.length % 2 === 1
              ? "col-span-2 xl:col-span-1"
              : "";

          if (props.isLoading || !tile) {
            return (
              <div
                key={definition.key}
                data-testid={`home-stat-${definition.key}-loading`}
                className={`${CELL_ROWS} bg-white px-5 py-4 ${spanClassName}`}
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
              to={getHomeListRoute(tile.pageMap, tile.linkQuery)}
              className={`group ${CELL_ROWS} bg-white px-5 py-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${spanClassName}`}
            >
              <div
                data-testid={`home-stat-${tile.key}-tile`}
                data-tone={tile.tone}
                className={`${CELL_ROWS} min-w-0`}
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
                  className={`mt-1 flex items-start gap-1.5 text-sm font-medium ${STATUS_CLASS_NAME[tile.tone]}`}
                >
                  <Icon
                    icon={tile.statusIcon}
                    className="mt-0.5 h-4 w-4 flex-none"
                  />
                  <span className="min-w-0 break-words">
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
