import { formatUptimePercent } from "./SiteMapViewModel";
import DeviceStatusUtil, {
  DEVICE_STATUS_SELECT,
  NetworkDeviceStatus,
} from "../NetworkDevice/DeviceStatusUtil";
import { Gray500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SiteUptimeUtil, {
  SiteMaintenanceWindow,
  SiteStatusTimelineRow,
  SiteUptimeMeasurement,
} from "Common/Utils/NetworkSite/SiteUptimeUtil";
import fetchSiteMaintenanceWindows from "./SiteMaintenanceWindows";
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
const DAILY_UPTIME_WINDOW_DAYS: number = 1;

/*
 * Status hero for the site Overview: rolled-up health, uptime over the last
 * 24 hours AND the last 30 days from the site's status timeline (same math
 * the map uses — SiteUptimeUtil), device fleet counts, child sites, and
 * endpoints, all in one strip.
 *
 * Both uptime figures exclude any scheduled maintenance window covering this
 * site. The health chip deliberately does NOT — a unit that is off for a
 * planned cutover still reads Offline, with a badge next to it saying the
 * outage was on the calendar.
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
    dailyUptimePercent: number | null;
    isUnderMaintenance: boolean;
  }

  const [data, setData] = useState<HeroData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchHeroData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const windowEnd: Date = OneUptimeDate.getCurrentDate();
      const windowStart: Date =
        OneUptimeDate.getSomeDaysAgo(UPTIME_WINDOW_DAYS);

      const [
        site,
        deviceResult,
        childSiteCount,
        endpointCount,
        timeline,
        maintenanceWindows,
      ]: [
        NetworkSite | null,
        ListResult<NetworkDevice>,
        number,
        number,
        ListResult<NetworkSiteStatusTimeline>,
        Array<SiteMaintenanceWindow>,
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
            ...DEVICE_STATUS_SELECT,
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
        /*
         * Resolved server-side, so this needs nothing from the site row and
         * rides in the same batch. A failure must not blank the whole strip
         * — it degrades to "no windows", which is what the hero showed
         * before maintenance could be attached to a site at all.
         */
        fetchSiteMaintenanceWindows({
          siteId: props.modelId,
          windowStart: windowStart,
          windowEnd: windowEnd,
        }).catch((): Array<SiteMaintenanceWindow> => {
          return [];
        }),
      ]);

      let devicesUp: number = 0;
      let devicesDown: number = 0;

      for (const device of deviceResult.data) {
        const status: NetworkDeviceStatus = DeviceStatusUtil.getStatus(device);
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
      let dailyUptimePercent: number | null = null;
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

        /*
         * measureUptime rather than the scalar form: a period spent entirely
         * inside a maintenance window has nothing to measure, and the scalar
         * has to answer 100 — "100% uptime" on a site that was switched off
         * for the whole month being exactly the misreading this feature
         * exists to remove. Null renders as a dash.
         */
        const monthly: SiteUptimeMeasurement = SiteUptimeUtil.measureUptime(
          rows,
          windowStart,
          windowEnd,
          maintenanceWindows,
        );
        uptimePercent = monthly.measuredInMs > 0 ? monthly.uptimePercent : null;

        /*
         * Exactly 24 hours, not a calendar day — the strip on the Status
         * Timeline page uses fixed buckets and the two must agree.
         */
        const daily: SiteUptimeMeasurement = SiteUptimeUtil.measureUptime(
          rows,
          SiteUptimeUtil.trailingWindowStart(
            windowEnd,
            DAILY_UPTIME_WINDOW_DAYS,
          ),
          windowEnd,
          maintenanceWindows,
        );
        dailyUptimePercent =
          daily.measuredInMs > 0 ? daily.uptimePercent : null;
      }

      setData({
        site: site,
        devicesTotal: deviceResult.count,
        devicesUp: devicesUp,
        devicesDown: devicesDown,
        childSiteCount: childSiteCount,
        endpointCount: endpointCount,
        uptimePercent: uptimePercent,
        dailyUptimePercent: dailyUptimePercent,
        isUnderMaintenance: SiteUptimeUtil.isUnderMaintenanceAt(
          maintenanceWindows,
          windowEnd,
        ),
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
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-7">
          {[0, 1, 2, 3, 4, 5, 6].map((index: number) => {
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-7">
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
            {/*
             * The chip above still reads whatever the rollup says, planned
             * work included, because someone looking at this page needs to
             * know the site is off right now. This badge is what says the
             * outage was scheduled — and that the uptime figures beside it
             * have already discounted it.
             */}
            {data.isUnderMaintenance && (
              <span
                className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                title="A scheduled maintenance window covers this site right now. Its downtime is excluded from the uptime percentages."
              >
                In maintenance
              </span>
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
            Uptime ({DAILY_UPTIME_WINDOW_DAYS * 24}h)
          </div>
          <div
            className="mt-1.5 text-2xl font-semibold text-gray-900"
            data-testid="site-hero-daily-uptime"
          >
            {formatUptimePercent(data.dailyUptimePercent)}
          </div>
          <div className="mt-1.5 text-xs text-gray-500">Last 24 hours</div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">
            Uptime ({UPTIME_WINDOW_DAYS}d)
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-900">
            {formatUptimePercent(data.uptimePercent)}
          </div>
          <div className="mt-1.5 text-xs text-gray-500">
            Maintenance excluded
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
