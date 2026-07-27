import ObjectID from "Common/Types/ObjectID";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Fleet-health strip for the Sites page: how many sites exist, how many
 * are rolling up unhealthy, and how many devices are still unassigned —
 * the number that tells you whether the hierarchy actually covers the
 * fleet.
 */

export interface ComponentProps {
  refreshToggle?: string | undefined;
}

interface SummaryCounts {
  totalSites: number;
  unhealthySites: number;
  sitesWithNoData: number;
  devicesWithoutSite: number;
}

const SiteSummaryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<SummaryCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const [siteResult, devicesWithoutSite]: [
        ListResult<NetworkSite>,
        number,
      ] = await Promise.all([
        ModelAPI.getList<NetworkSite>({
          modelType: NetworkSite,
          query: {
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            currentMonitorStatus: {
              isOperationalState: true,
            },
          },
          sort: {},
        }),
        ModelAPI.count<NetworkDevice>({
          modelType: NetworkDevice,
          query: {
            projectId: projectId,
            isArchived: false,
            siteId: new IsNull(),
          },
        }),
      ]);

      let unhealthySites: number = 0;
      let sitesWithNoData: number = 0;

      for (const site of siteResult.data) {
        if (!site.currentMonitorStatus) {
          sitesWithNoData++;
        } else if (!site.currentMonitorStatus.isOperationalState) {
          unhealthySites++;
        }
      }

      setCounts({
        totalSites: siteResult.count,
        unhealthySites: unhealthySites,
        sitesWithNoData: sitesWithNoData,
        devicesWithoutSite: devicesWithoutSite,
      });
      setHasError(false);
    } catch {
      // The summary row is supplementary — hide it instead of breaking the page.
      setHasError(true);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // handled in fetchCounts.
    });
  }, [props.refreshToggle]);

  if (hasError) {
    return <></>;
  }

  interface SummaryTile {
    key: string;
    label: string;
    count: number;
    attentionClassName: string;
    caption: string;
  }

  const tiles: Array<SummaryTile> = [
    {
      key: "total-sites",
      label: "Sites",
      count: counts?.totalSites || 0,
      attentionClassName: "text-gray-900",
      caption: "Across the whole hierarchy.",
    },
    {
      key: "unhealthy-sites",
      label: "Unhealthy Sites",
      count: counts?.unhealthySites || 0,
      attentionClassName: "text-red-600",
      caption: "Rolling up a non-operational status.",
    },
    {
      key: "sites-no-data",
      label: "Sites Without Data",
      count: counts?.sitesWithNoData || 0,
      attentionClassName: "text-gray-500",
      caption: "No health rollup yet — no monitored devices below.",
    },
    {
      key: "devices-without-site",
      label: "Unassigned Devices",
      count: counts?.devicesWithoutSite || 0,
      attentionClassName: "text-amber-600",
      caption: "Devices not assigned to any site.",
    },
  ];

  return (
    <div
      data-testid="network-site-summary-cards"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile: SummaryTile) => {
        return (
          <InfoCard
            key={tile.key}
            title={tile.label}
            value={
              isLoading ? (
                <div className="mt-1 space-y-2">
                  <div className="h-8 w-14 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              ) : (
                <div className="mt-1">
                  <div
                    data-testid={`network-site-stat-${tile.key}`}
                    className={`text-3xl font-semibold ${
                      tile.count > 0 ? tile.attentionClassName : "text-gray-900"
                    }`}
                  >
                    {tile.count}
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    {tile.caption}
                  </div>
                </div>
              )
            }
          />
        );
      })}
    </div>
  );
};

export default SiteSummaryCards;
