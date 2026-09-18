import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudFleetCounts,
  CloudFleetSummaryTile,
  summarizeCloudFleet,
} from "../../Pages/Cloud/Utils/CloudFleetSummary";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../Pages/Cloud/Utils/CloudResourceTelemetryScope";

/*
 * The stat strip above the Cloud Environments table: how many environments
 * there are, how many are reporting, and how many tasks are live right now.
 *
 * It is strictly decorative — the table underneath is the source of truth —
 * so it must never get in the way: it renders nothing while loading, nothing
 * when there is nothing to summarise (the empty state already has the setup
 * guide), and nothing on error rather than a second error banner next to
 * the table's own.
 */

export interface ComponentProps {
  /*
   * Bump to refetch, e.g. after the create modal adds an environment. The
   * strip has no other reason to poll.
   */
  refreshToken?: number | null | undefined;
}

interface TileStyle {
  icon: IconProp;
  bg: string;
  ring: string;
  text: string;
}

/*
 * One entry per tile that summarizeCloudFleet returns, in the same order.
 * The palette matches ResourceOverview's golden-metric tiles so the list
 * page and the environment overview read as one product.
 */
const TILE_STYLES: ReadonlyArray<TileStyle> = [
  {
    icon: IconProp.Cloud,
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    text: "text-blue-600",
  },
  {
    icon: IconProp.CheckCircle,
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  {
    icon: IconProp.Alert,
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    text: "text-amber-600",
  },
  {
    icon: IconProp.Cube,
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
];

const FALLBACK_TILE_STYLE: TileStyle = {
  icon: IconProp.Info,
  bg: "bg-slate-50",
  ring: "ring-slate-200",
  text: "text-slate-600",
};

/*
 * Six count requests, issued together. Providers are enumerated from the
 * shared CloudProvider enum so a new provider shows up here without a
 * dashboard change; the total stays bounded because that enum is short.
 */
export async function fetchCloudFleetCounts(): Promise<CloudFleetCounts> {
  const providers: Array<CloudProvider> = Object.values(CloudProvider);
  const liveSince: Date = OneUptimeDate.getSomeMinutesAgo(
    CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  );

  const [total, connected, liveInstances, ...providerCounts]: Array<number> =
    await Promise.all([
      ModelAPI.count({
        modelType: CloudResource,
        query: { isArchived: false },
      }),
      ModelAPI.count({
        modelType: CloudResource,
        query: { isArchived: false, otelCollectorStatus: "connected" },
      }),
      ModelAPI.count({
        modelType: CloudResourceInstance,
        query: { lastSeenAt: new GreaterThan<Date>(liveSince) },
      }),
      ...providers.map((provider: CloudProvider): Promise<number> => {
        return ModelAPI.count({
          modelType: CloudResource,
          query: { isArchived: false, cloudProvider: provider },
        });
      }),
    ]);

  const byProvider: Record<string, number> = {};
  providers.forEach((provider: CloudProvider, index: number): void => {
    byProvider[provider] = providerCounts[index] || 0;
  });

  const safeTotal: number = total || 0;
  const safeConnected: number = Math.min(safeTotal, connected || 0);

  return {
    total: safeTotal,
    connected: safeConnected,
    disconnected: safeTotal - safeConnected,
    byProvider,
    liveInstances: liveInstances || 0,
  };
}

const CloudFleetSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<CloudFleetCounts | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    /*
     * A refetch triggered by refreshToken can resolve before the one it
     * superseded; the flag keeps the older response from overwriting the
     * newer one.
     */
    let ignore: boolean = false;

    fetchCloudFleetCounts()
      .then((result: CloudFleetCounts): void => {
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

  const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(counts);

  return (
    <div
      data-testid="cloud-fleet-summary"
      className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4"
    >
      {tiles.map((tile: CloudFleetSummaryTile, index: number): ReactElement => {
        const style: TileStyle = TILE_STYLES[index] || FALLBACK_TILE_STYLE;
        return (
          <div
            key={tile.title}
            data-testid="cloud-fleet-summary-tile"
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
      })}
    </div>
  );
};

export default CloudFleetSummary;
