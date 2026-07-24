import { formatUptimePercent } from "./SiteMapViewModel";
import DeviceStatusUtil, {
  NetworkDeviceStatus,
} from "../NetworkDevice/DeviceStatusUtil";
import { Gray500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SiteUptimeUtil, {
  SiteStatusTimelineRow,
} from "Common/Utils/NetworkSite/SiteUptimeUtil";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteStatusTimeline from "Common/Models/DatabaseModels/NetworkSiteStatusTimeline";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const UPTIME_WINDOW_DAYS: number = 30;

/*
 * Status hero for the site Overview: rolled-up health, 30-day uptime from
 * the site's status timeline (same math the map uses — SiteUptimeUtil),
 * device fleet counts, child sites, and endpoints, all in one strip.
 */
const SiteStatusHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  interface HeroData {
    site: NetworkSite | null;
    devicesTotal: number;
    devicesUp: number;
    devicesDown: number;
    childSiteCount: number;
    endpointCount: number;
    uptimePercent: number | null;
  }

  const [data, setData] = useState<HeroData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchHeroData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const windowEnd: Date = OneUptimeDate.getCurrentDate();
      const windowStart: Date =
        OneUptimeDate.getSomeDaysAgo(UPTIME_WINDOW_DAYS);

      const [site, deviceResult, childSiteCount, endpointCount, timeline]: [
        NetworkSite | null,
        ListResult<NetworkDevice>,
        number,
        number,
        ListResult<NetworkSiteStatusTimeline>,
      ] = await Promise.all([
        ModelAPI.getItem<NetworkSite>({
          modelType: NetworkSite,
          id: props.modelId,
          select: {
            currentMonitorStatus: {
              name: true,
              color: true,
            },
            lastRollupAt: true,
            siteType: true,
          },
        }),
        ModelAPI.getList<NetworkDevice>({
          modelType: NetworkDevice,
          query: {
            siteId: props.modelId.toString(),
            isArchived: false,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            lastSeenAt: true,
          },
          sort: {},
        }),
        ModelAPI.count<NetworkSite>({
          modelType: NetworkSite,
          query: {
            parentSiteId: props.modelId.toString(),
          },
        }),
        ModelAPI.count<NetworkEndpoint>({
          modelType: NetworkEndpoint,
          query: {
            siteId: props.modelId.toString(),
          },
        }),
        ModelAPI.getList<NetworkSiteStatusTimeline>({
          modelType: NetworkSiteStatusTimeline,
          query: {
            siteId: props.modelId.toString(),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            startsAt: true,
            endsAt: true,
            monitorStatus: {
              _id: true,
              priority: true,
              isOperationalState: true,
            },
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
        }),
      ]);

      let devicesUp: number = 0;
      let devicesDown: number = 0;

      for (const device of deviceResult.data) {
        const status: NetworkDeviceStatus = DeviceStatusUtil.getStatus(
          device.lastSeenAt,
        );
        if (status === NetworkDeviceStatus.Up) {
          devicesUp++;
        } else if (status === NetworkDeviceStatus.Down) {
          devicesDown++;
        }
      }

      /*
       * Uptime only means something once the site has rollup history.
       * With zero timeline rows SiteUptimeUtil reports 100%, which would
       * paint an unmonitored site as perfect — show "—" instead.
       */
      let uptimePercent: number | null = null;
      if (timeline.data.length > 0) {
        const rows: Array<SiteStatusTimelineRow> = timeline.data.map(
          (row: NetworkSiteStatusTimeline): SiteStatusTimelineRow => {
            return {
              monitorStatusId: row.monitorStatus?._id?.toString() || "",
              startsAt: row.startsAt as Date,
              endsAt: (row.endsAt as Date | undefined) || null,
              priority: (row.monitorStatus?.priority as number) || 0,
              isOperationalState: Boolean(
                row.monitorStatus?.isOperationalState,
              ),
            };
          },
        );

        uptimePercent = SiteUptimeUtil.calculateUptimePercent(
          rows,
          windowStart,
          windowEnd,
        );
      }

      setData({
        site: site,
        devicesTotal: deviceResult.count,
        devicesUp: devicesUp,
        devicesDown: devicesDown,
        childSiteCount: childSiteCount,
        endpointCount: endpointCount,
        uptimePercent: uptimePercent,
      });
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchHeroData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return (
      <div
        data-testid="site-status-hero-skeleton"
        className="mb-5 rounded-lg bg-white p-6 shadow"
      >
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((index: number) => {
            return (
              <div key={index} className="space-y-2">
                <div className="h-4 w-20 animate-pulse rounded bg-gray-100"></div>
                <div className="h-6 w-24 animate-pulse rounded bg-gray-100"></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error || !data) {
    // The hero is supplementary — the details card below still renders.
    return <></>;
  }

  const lastRollupAt: Date | null = data.site?.lastRollupAt
    ? OneUptimeDate.fromString(data.site.lastRollupAt)
    : null;

  return (
    <div
      data-testid="site-status-hero"
      className="mb-5 rounded-lg bg-white p-6 shadow"
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
        <div>
          <div className="text-sm font-medium text-gray-500">Health</div>
          <div className="mt-1.5">
            {data.site?.currentMonitorStatus?.name ? (
              <Pill
                text={data.site.currentMonitorStatus.name}
                color={data.site.currentMonitorStatus.color || Gray500}
                size={PillSize.Normal}
              />
            ) : (
              <span className="text-sm text-gray-400">No data yet</span>
            )}
          </div>
          {lastRollupAt && (
            <div
              className="mt-1.5 text-xs text-gray-500"
              title={OneUptimeDate.getDateAsLocalFormattedString(lastRollupAt)}
            >
              Rolled up {OneUptimeDate.fromNow(lastRollupAt)}
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">
            Uptime ({UPTIME_WINDOW_DAYS}d)
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-900">
            {formatUptimePercent(data.uptimePercent)}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Devices</div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-900">
            {data.devicesTotal}
          </div>
          {data.devicesTotal > 0 && (
            <div className="mt-1.5 text-xs">
              <span className="font-medium text-emerald-600">
                {data.devicesUp} up
              </span>
              <span className="text-gray-400"> · </span>
              <span
                className={
                  data.devicesDown > 0
                    ? "font-medium text-red-600"
                    : "text-gray-500"
                }
              >
                {data.devicesDown} down
              </span>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Child Sites</div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-900">
            {data.childSiteCount}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Endpoints</div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-900">
            {data.endpointCount}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Site Type</div>
          <div className="mt-1.5 text-sm text-gray-900">
            {data.site?.siteType?.toString() || (
              <span className="text-gray-400">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SiteStatusHero;
