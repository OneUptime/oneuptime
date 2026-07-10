import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import IncidentStateUtil from "../../Utils/IncidentState";
import AlertStateUtil from "../../Utils/AlertState";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  projectId: ObjectID;
}

interface StatTile {
  key: string;
  label: string;
  pageMap: PageMap;
  count: number;
  // shown when count > 0
  attentionLabel: string;
  attentionClassName: string;
  attentionIcon: IconProp;
  // shown when count === 0
  allClearLabel: string;
}

interface StatCounts {
  activeIncidents: number;
  activeAlerts: number;
  inoperationalMonitors: number;
  ongoingMaintenance: number;
}

const OverviewStats: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<StatCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const [unresolvedIncidentStates, unresolvedAlertStates]: [
        Array<IncidentState>,
        Array<AlertState>,
      ] = await Promise.all([
        IncidentStateUtil.getUnresolvedIncidentStates(props.projectId),
        AlertStateUtil.getUnresolvedAlertStates(props.projectId),
      ]);

      const [
        activeIncidents,
        activeAlerts,
        inoperationalMonitors,
        ongoingMaintenance,
      ]: [number, number, number, number] = await Promise.all([
        unresolvedIncidentStates.length > 0
          ? ModelAPI.count<Incident>({
              modelType: Incident,
              query: {
                projectId: props.projectId,
                currentIncidentStateId: new Includes(
                  unresolvedIncidentStates.map((state: IncidentState) => {
                    return state.id!;
                  }),
                ),
              },
            })
          : Promise.resolve(0),
        unresolvedAlertStates.length > 0
          ? ModelAPI.count<Alert>({
              modelType: Alert,
              query: {
                projectId: props.projectId,
                currentAlertStateId: new Includes(
                  unresolvedAlertStates.map((state: AlertState) => {
                    return state.id!;
                  }),
                ),
              },
            })
          : Promise.resolve(0),
        ModelAPI.count<Monitor>({
          modelType: Monitor,
          query: {
            projectId: props.projectId,
            currentMonitorStatus: {
              isOperationalState: false,
            },
          },
        }),
        ModelAPI.count<ScheduledMaintenance>({
          modelType: ScheduledMaintenance,
          query: {
            projectId: props.projectId,
            currentScheduledMaintenanceState: {
              isOngoingState: true,
            },
          },
        }),
      ]);

      setCounts({
        activeIncidents,
        activeAlerts,
        inoperationalMonitors,
        ongoingMaintenance,
      });
      setHasError(false);
    } catch {
      // the stats row is supplementary — hide it instead of breaking the page.
      setHasError(true);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // handled in fetchCounts.
    });
  }, [props.projectId]);

  if (hasError) {
    return <></>;
  }

  const tiles: Array<StatTile> = [
    {
      key: "active-incidents",
      label: "Active incidents",
      pageMap: PageMap.HOME,
      count: counts?.activeIncidents || 0,
      attentionLabel: "Needs attention",
      attentionClassName: "text-red-600",
      attentionIcon: IconProp.Alert,
      allClearLabel: "All clear",
    },
    {
      key: "active-alerts",
      label: "Active alerts",
      pageMap: PageMap.HOME_ACTIVE_ALERTS,
      count: counts?.activeAlerts || 0,
      attentionLabel: "Needs attention",
      attentionClassName: "text-red-600",
      attentionIcon: IconProp.Alert,
      allClearLabel: "All clear",
    },
    {
      key: "inoperational-monitors",
      label: "Inoperational monitors",
      pageMap: PageMap.HOME_NOT_OPERATIONAL_MONITORS,
      count: counts?.inoperationalMonitors || 0,
      attentionLabel: "Needs attention",
      attentionClassName: "text-red-600",
      attentionIcon: IconProp.Error,
      allClearLabel: "All operational",
    },
    {
      key: "ongoing-maintenance",
      label: "Ongoing maintenance",
      pageMap: PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
      count: counts?.ongoingMaintenance || 0,
      attentionLabel: "In progress",
      attentionClassName: "text-amber-600",
      attentionIcon: IconProp.Clock,
      allClearLabel: "None ongoing",
    },
  ];

  return (
    <div
      data-testid="home-overview-stats"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile: StatTile) => {
        const needsAttention: boolean = tile.count > 0;

        return (
          <InfoCard
            key={tile.key}
            title={tile.label}
            onClick={() => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(RouteMap[tile.pageMap] as Route),
              );
            }}
            value={
              isLoading ? (
                <div className="mt-1 space-y-2">
                  <div className="h-8 w-14 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              ) : (
                <div className="mt-1">
                  <div
                    data-testid={`home-stat-${tile.key}`}
                    className="text-3xl font-semibold text-gray-900"
                  >
                    {tile.count}
                  </div>
                  <div
                    className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${
                      needsAttention
                        ? tile.attentionClassName
                        : "text-emerald-600"
                    }`}
                  >
                    <Icon
                      icon={
                        needsAttention
                          ? tile.attentionIcon
                          : IconProp.CheckCircle
                      }
                      className="h-4 w-4"
                    />
                    <span>
                      {needsAttention
                        ? tile.attentionLabel
                        : tile.allClearLabel}
                    </span>
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

export default OverviewStats;
