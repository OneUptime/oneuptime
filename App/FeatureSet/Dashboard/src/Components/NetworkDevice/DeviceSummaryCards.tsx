import { DEVICE_FRESH_WINDOW_MINUTES } from "./DeviceStatusUtil";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface SummaryCounts {
  devicesUp: number;
  devicesDown: number;
  devicesPending: number;
  interfacesDown: number;
}

interface SummaryTile {
  key: string;
  label: string;
  count: number;
  // css class for the count when it needs attention (count > 0).
  attentionClassName: string;
  // css class for the count when everything is fine (count === 0).
  allClearClassName: string;
  caption: string;
}

const DeviceSummaryCards: FunctionComponent = (): ReactElement => {
  const [counts, setCounts] = useState<SummaryCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      // Same freshness window the topology API uses to decide up vs down.
      const freshCutoff: Date = OneUptimeDate.getSomeMinutesAgo(
        DEVICE_FRESH_WINDOW_MINUTES,
      );

      const [
        devicesUp,
        devicesDown,
        devicesPending,
        devicesWithDownInterfaces,
      ]: [number, number, number, ListResult<NetworkDevice>] =
        await Promise.all([
          ModelAPI.count<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              lastSeenAt: new GreaterThanOrEqual(freshCutoff),
            },
          }),
          ModelAPI.count<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              lastSeenAt: new LessThan(freshCutoff),
            },
          }),
          ModelAPI.count<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              lastSeenAt: new IsNull(),
            },
          }),
          ModelAPI.getList<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              interfacesDown: new GreaterThan(0),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              interfacesDown: true,
            },
            sort: {},
          }),
        ]);

      const interfacesDown: number = devicesWithDownInterfaces.data.reduce(
        (total: number, device: NetworkDevice) => {
          return total + ((device.interfacesDown as number) || 0);
        },
        0,
      );

      setCounts({
        devicesUp,
        devicesDown,
        devicesPending,
        interfacesDown,
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
  }, []);

  if (hasError) {
    return <></>;
  }

  const tiles: Array<SummaryTile> = [
    {
      key: "devices-up",
      label: "Devices Up",
      count: counts?.devicesUp || 0,
      attentionClassName: "text-emerald-600",
      allClearClassName: "text-gray-900",
      caption: `Polled within the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`,
    },
    {
      key: "devices-down",
      label: "Devices Down / Stale",
      count: counts?.devicesDown || 0,
      attentionClassName: "text-red-600",
      allClearClassName: "text-gray-900",
      caption: `No successful poll in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`,
    },
    {
      key: "devices-pending",
      label: "Devices Pending",
      count: counts?.devicesPending || 0,
      attentionClassName: "text-gray-500",
      allClearClassName: "text-gray-900",
      caption: "Never polled successfully yet.",
    },
    {
      key: "interfaces-down",
      label: "Total Interfaces Down",
      count: counts?.interfacesDown || 0,
      attentionClassName: "text-red-600",
      allClearClassName: "text-gray-900",
      caption: "Across all devices in this project.",
    },
  ];

  return (
    <div
      data-testid="network-device-summary-cards"
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
                    data-testid={`network-device-stat-${tile.key}`}
                    className={`text-3xl font-semibold ${
                      tile.count > 0
                        ? tile.attentionClassName
                        : tile.allClearClassName
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

export default DeviceSummaryCards;
