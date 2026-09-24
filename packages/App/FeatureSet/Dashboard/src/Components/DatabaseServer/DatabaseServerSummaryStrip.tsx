import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import DatabaseServerDiscoverySource, {
  DATABASE_SERVER_DISCOVERY_SOURCES,
} from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseFleetCounts,
  DatabaseFleetSummaryTile,
  summarizeDatabaseFleet,
} from "../../Pages/Database/Utils/DatabaseServerSummary";
import { DATABASE_SERVER_LIVE_WINDOW_MINUTES } from "../../Pages/Database/Utils/DatabaseServerPresentation";

/*
 * The stat strip above the Databases table: how many databases there are
 * and where they came from, how many were seen recently, and how many have
 * engine metrics connected.
 *
 * Strictly decorative — the table is the source of truth — so it renders
 * nothing while loading, nothing when there is nothing to summarise (the
 * empty state already has the setup guide) and nothing on error.
 */

export interface ComponentProps {
  // Bump to refetch, e.g. after the create modal adds a database.
  refreshToken?: number | null | undefined;
}

interface TileStyle {
  icon: IconProp;
  bg: string;
  ring: string;
  text: string;
}

const TILE_STYLES: ReadonlyArray<TileStyle> = [
  {
    icon: IconProp.Database,
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    text: "text-blue-600",
  },
  {
    icon: IconProp.Clock,
    bg: "bg-sky-50",
    ring: "ring-sky-200",
    text: "text-sky-600",
  },
  {
    icon: IconProp.CheckCircle,
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  {
    icon: IconProp.Info,
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    text: "text-amber-600",
  },
];

const FALLBACK_TILE_STYLE: TileStyle = {
  icon: IconProp.Info,
  bg: "bg-slate-50",
  ring: "ring-slate-200",
  text: "text-slate-600",
};

/*
 * Nine count requests, issued together: the total, the engine-metrics and
 * recently-seen subsets, and one per discovery source (a short, fixed list).
 */
export async function fetchDatabaseFleetCounts(): Promise<DatabaseFleetCounts> {
  const sources: ReadonlyArray<DatabaseServerDiscoverySource> =
    DATABASE_SERVER_DISCOVERY_SOURCES;
  const seenSince: Date = OneUptimeDate.getSomeMinutesAgo(
    DATABASE_SERVER_LIVE_WINDOW_MINUTES,
  );

  const [
    total,
    engineMetricsConnected,
    seenRecently,
    ...sourceCounts
  ]: Array<number> = await Promise.all([
    ModelAPI.count({
      modelType: DatabaseServer,
      query: { isArchived: false },
    }),
    ModelAPI.count({
      modelType: DatabaseServer,
      query: { isArchived: false, otelCollectorStatus: "connected" },
    }),
    ModelAPI.count({
      modelType: DatabaseServer,
      query: {
        isArchived: false,
        lastSeenAt: new GreaterThan<Date>(seenSince),
      },
    }),
    ...sources.map((source: DatabaseServerDiscoverySource): Promise<number> => {
      return ModelAPI.count({
        modelType: DatabaseServer,
        query: { isArchived: false, discoverySource: source },
      });
    }),
  ]);

  const bySource: Record<string, number> = {};
  sources.forEach(
    (source: DatabaseServerDiscoverySource, index: number): void => {
      bySource[source] = sourceCounts[index] || 0;
    },
  );

  const safeTotal: number = total || 0;

  return {
    total: safeTotal,
    engineMetricsConnected: Math.min(safeTotal, engineMetricsConnected || 0),
    seenRecently: Math.min(safeTotal, seenRecently || 0),
    bySource,
  };
}

const DatabaseServerSummaryStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<DatabaseFleetCounts | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    // A superseded fetch must not overwrite the newer one's result.
    let ignore: boolean = false;

    fetchDatabaseFleetCounts()
      .then((result: DatabaseFleetCounts): void => {
        if (ignore) {
          return;
        }
        setCounts(result);
        setFailed(false);
      })
      .catch((): void => {
        if (ignore) {
          return;
        }
        setFailed(true);
      });

    return (): void => {
      ignore = true;
    };
  }, [props.refreshToken]);

  if (failed || !counts || counts.total <= 0) {
    return <></>;
  }

  const tiles: Array<DatabaseFleetSummaryTile> = summarizeDatabaseFleet(counts);

  return (
    <div
      data-testid="database-fleet-summary"
      className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4"
    >
      {tiles.map(
        (tile: DatabaseFleetSummaryTile, index: number): ReactElement => {
          const style: TileStyle = TILE_STYLES[index] || FALLBACK_TILE_STYLE;
          return (
            <div
              key={tile.title}
              data-testid="database-fleet-summary-tile"
              className="h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                  {tile.title}
                </span>
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-md ${style.bg} ring-1 ring-inset ${style.ring}`}
                >
                  <Icon
                    icon={style.icon}
                    className={`h-3.5 w-3.5 ${style.text}`}
                  />
                </div>
              </div>
              <div className="text-2xl font-semibold leading-none text-gray-900">
                {tile.value}
              </div>
              <div className="mt-1 truncate text-xs text-gray-500">
                {tile.sublabel}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
};

export default DatabaseServerSummaryStrip;
