import PageComponentProps from "../../PageComponentProps";
import { formatUptimePercent } from "../../../Components/NetworkSite/SiteMapViewModel";
import { Gray500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SiteUptimeUtil, {
  DailyUptimeEntry,
  SiteMaintenanceWindow,
  SiteStatusTimelineRow,
} from "Common/Utils/NetworkSite/SiteUptimeUtil";
import fetchSiteMaintenanceWindows from "../../../Components/NetworkSite/SiteMaintenanceWindows";
import SiteDailyUptimeStrip from "../../../Components/NetworkSite/SiteDailyUptimeStrip";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteStatusTimeline from "Common/Models/DatabaseModels/NetworkSiteStatusTimeline";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const UPTIME_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30, 90];
const DAILY_STRIP_DAYS: number = 30;

/*
 * Status history for one site: uptime percentages over four windows
 * (computed with the same SiteUptimeUtil the rollup engine's consumers
 * use), a day-by-day strip for the last thirty, then every status change the
 * rollup engine recorded.
 *
 * The one-day window and the strip exist for the same reason: a 30-day
 * average cannot show a bad day. A whole day of outage moves it by 3.3
 * points, which reads as noise next to a genuinely healthy month.
 *
 * Every figure here excludes scheduled maintenance covering this site,
 * whether the window was attached to the site itself or to one of its
 * ancestors.
 */
const NetworkSiteStatusTimelinePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [uptimeByWindow, setUptimeByWindow] = useState<Record<
    number,
    number
  > | null>(null);
  const [dailyEntries, setDailyEntries] = useState<Array<DailyUptimeEntry>>([]);

  const fetchUptime: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const windowEnd: Date = OneUptimeDate.getCurrentDate();
      /*
       * The longest window any figure on this page measures. Both the
       * timeline rows and the maintenance windows are fetched over it once,
       * then each shorter window is computed from the same rows.
       */
      const longestWindowInDays: number = Math.max(
        ...UPTIME_WINDOWS_IN_DAYS,
        DAILY_STRIP_DAYS,
      );
      const windowStart: Date =
        OneUptimeDate.getSomeDaysAgo(longestWindowInDays);

      const [timeline, site]: [
        ListResult<NetworkSiteStatusTimeline>,
        NetworkSite | null,
      ] = await Promise.all([
        ModelAPI.getList<NetworkSiteStatusTimeline>({
          modelType: NetworkSiteStatusTimeline,
          query: {
            siteId: modelId.toString(),
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
         * Only for the materialized path: a maintenance window attached to
         * this site's Region covers it too, and the path is where its
         * ancestors are.
         */
        ModelAPI.getItem<NetworkSite>({
          modelType: NetworkSite,
          id: modelId,
          select: {
            materializedPath: true,
          },
        }),
      ]);

      if (timeline.data.length === 0) {
        // No history yet — leave the stat row and the strip hidden.
        setUptimeByWindow(null);
        setDailyEntries([]);
        return;
      }

      const rows: Array<SiteStatusTimelineRow> = timeline.data.map(
        (row: NetworkSiteStatusTimeline): SiteStatusTimelineRow => {
          return {
            monitorStatusId: row.monitorStatus?._id?.toString() || "",
            startsAt: row.startsAt as Date,
            endsAt: (row.endsAt as Date | undefined) || null,
            priority: (row.monitorStatus?.priority as number) || 0,
            isOperationalState: Boolean(row.monitorStatus?.isOperationalState),
          };
        },
      );

      /*
       * A maintenance lookup that fails must not take the uptime figures
       * with it — degrading to "no windows" reproduces exactly what this
       * page showed before maintenance could be attached to a site.
       */
      let maintenanceWindows: Array<SiteMaintenanceWindow> = [];
      try {
        maintenanceWindows = await fetchSiteMaintenanceWindows({
          siteId: modelId,
          materializedPath: site?.materializedPath,
          windowStart: windowStart,
          windowEnd: windowEnd,
        });
      } catch {
        maintenanceWindows = [];
      }

      const computed: Record<number, number> = {};

      for (const days of UPTIME_WINDOWS_IN_DAYS) {
        computed[days] = SiteUptimeUtil.calculateUptimePercent(
          rows,
          OneUptimeDate.getSomeDaysAgo(days),
          windowEnd,
          maintenanceWindows,
        );
      }

      setUptimeByWindow(computed);
      setDailyEntries(
        SiteUptimeUtil.calculateDailyUptime({
          rows: rows,
          days: DAILY_STRIP_DAYS,
          endDate: windowEnd,
          maintenanceWindows: maintenanceWindows,
        }),
      );
    } catch {
      // The stat row is supplementary — the timeline table still renders.
      setUptimeByWindow(null);
      setDailyEntries([]);
    }
  };

  useEffect(() => {
    fetchUptime().catch(() => {
      // handled in fetchUptime.
    });
  }, []);

  return (
    <Fragment>
      {uptimeByWindow && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {UPTIME_WINDOWS_IN_DAYS.map((days: number): ReactElement => {
            const uptime: number | undefined = uptimeByWindow[days];
            return (
              <InfoCard
                key={days}
                title={
                  days === 1
                    ? "Uptime — Last 24 Hours"
                    : `Uptime — Last ${days} Days`
                }
                value={
                  <div
                    className={`mt-1 text-3xl font-semibold ${
                      uptime !== undefined && uptime < 99
                        ? "text-red-600"
                        : "text-gray-900"
                    }`}
                  >
                    {formatUptimePercent(uptime)}
                  </div>
                }
              />
            );
          })}
        </div>
      )}
      {dailyEntries.length > 0 && (
        <div className="mb-5 rounded-lg bg-white p-6 shadow">
          <div className="mb-1 text-base font-medium text-gray-900">
            Daily Uptime — Last {DAILY_STRIP_DAYS} Days
          </div>
          <p className="mb-4 text-sm text-gray-500">
            One bar per 24 hours, oldest first. A whole day of downtime only
            moves the 30-day figure by 3.3 points, so a bad day is easy to miss
            in the averages above and hard to miss here. Time inside a scheduled
            maintenance window is excluded from every bar.
          </p>
          <SiteDailyUptimeStrip entries={dailyEntries} />
        </div>
      )}
      <ModelTable<NetworkSiteStatusTimeline>
        modelType={NetworkSiteStatusTimeline}
        id="network-site-status-timeline-table"
        userPreferencesKey="network-site-status-timeline-table"
        query={{ siteId: modelId }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        name="Site Status Timeline"
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Status Timeline",
          description:
            "Every health change this site's rollup recorded — when it entered each status and for how long.",
        }}
        noItemsMessage="No status history yet. The timeline fills in as the site's health rollup records changes."
        filters={[
          {
            field: {
              startsAt: true,
            },
            title: "From",
            type: FieldType.Date,
          },
        ]}
        selectMoreFields={{
          endsAt: true,
        }}
        columns={[
          {
            field: {
              monitorStatus: {
                name: true,
                color: true,
              },
            },
            title: "Status",
            type: FieldType.Entity,
            getElement: (item: NetworkSiteStatusTimeline): ReactElement => {
              if (!item.monitorStatus?.name) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <Pill
                  text={item.monitorStatus.name}
                  color={item.monitorStatus.color || Gray500}
                  size={PillSize.Small}
                />
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "From",
            type: FieldType.DateTime,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Until",
            type: FieldType.Element,
            getElement: (item: NetworkSiteStatusTimeline): ReactElement => {
              if (!item.endsAt) {
                return (
                  <span className="text-sm font-medium text-emerald-700">
                    Ongoing
                  </span>
                );
              }
              return (
                <span className="text-sm text-gray-600">
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    OneUptimeDate.fromString(item.endsAt),
                  )}
                </span>
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Duration",
            type: FieldType.Element,
            getElement: (item: NetworkSiteStatusTimeline): ReactElement => {
              if (!item.startsAt) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              const start: Date = OneUptimeDate.fromString(item.startsAt);
              const end: Date = item.endsAt
                ? OneUptimeDate.fromString(item.endsAt)
                : OneUptimeDate.getCurrentDate();

              return (
                <span className="text-sm text-gray-600">
                  {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                    start,
                    end,
                  )}
                </span>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkSiteStatusTimelinePage;
