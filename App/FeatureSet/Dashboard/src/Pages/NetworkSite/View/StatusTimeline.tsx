import PageComponentProps from "../../PageComponentProps";
import { formatUptimePercent } from "../../../Components/NetworkSite/SiteMapViewModel";
import { Gray500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SiteUptimeUtil, {
  SiteStatusTimelineRow,
} from "Common/Utils/NetworkSite/SiteUptimeUtil";
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

const UPTIME_WINDOWS_IN_DAYS: Array<number> = [7, 30, 90];

/*
 * Status history for one site: uptime percentages over three windows
 * (computed with the same SiteUptimeUtil the rollup engine's consumers
 * use), then every status change the rollup engine recorded.
 */
const NetworkSiteStatusTimelinePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [uptimeByWindow, setUptimeByWindow] = useState<Record<
    number,
    number
  > | null>(null);

  const fetchUptime: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const timeline: ListResult<NetworkSiteStatusTimeline> =
        await ModelAPI.getList<NetworkSiteStatusTimeline>({
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
        });

      if (timeline.data.length === 0) {
        // No history yet — leave the stat row hidden.
        setUptimeByWindow(null);
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

      const windowEnd: Date = OneUptimeDate.getCurrentDate();
      const computed: Record<number, number> = {};

      for (const days of UPTIME_WINDOWS_IN_DAYS) {
        computed[days] = SiteUptimeUtil.calculateUptimePercent(
          rows,
          OneUptimeDate.getSomeDaysAgo(days),
          windowEnd,
        );
      }

      setUptimeByWindow(computed);
    } catch {
      // The stat row is supplementary — the timeline table still renders.
      setUptimeByWindow(null);
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
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {UPTIME_WINDOWS_IN_DAYS.map((days: number): ReactElement => {
            const uptime: number | undefined = uptimeByWindow[days];
            return (
              <InfoCard
                key={days}
                title={`Uptime — Last ${days} Days`}
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
