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
import useTranslateValue from "Common/UI/Utils/Translation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  projectId: ObjectID;
}

/*
 * A tile about something the project has not set up yet. "All operational"
 * over zero monitors reads as though monitors were watching and found nothing
 * wrong, which is exactly the wrong impression to give someone who has not
 * created one. Such a tile says so instead, and opens the place to fix it.
 */
interface NotSetUpState {
  isNotSetUp: boolean;
  label: string;
  pageMap: PageMap;
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
  notSetUp?: NotSetUpState | undefined;
}

interface StatCounts {
  activeIncidents: number;
  activeAlerts: number;
  notOperationalMonitors: number;
  ongoingMaintenance: number;
  slosNeedingAttention: number;
  // Every monitor, whatever its state - zero means none was ever created.
  totalMonitors: number;
  // Every SLO that is not archived - zero means none is set up.
  totalSlos: number;
}

// The copy the tiles show, exported so tests read the same strings.
export const NO_MONITORS_YET_LABEL: string = "No monitors yet";
export const NO_SLOS_YET_LABEL: string = "No SLOs yet";

const OverviewStats: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const [counts, setCounts] = useState<StatCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  /*
   * Only the incident and alert tiles need an unresolved-state list before
   * their count can be scoped, so each of these helpers fetches its own list
   * and chains the count off it. Keeping the lists inside the helpers is what
   * lets the three state-independent counts in fetchCounts run in parallel
   * with them instead of waiting behind both lists.
   */
  const fetchActiveIncidentsCount: () => Promise<number> =
    async (): Promise<number> => {
      const unresolvedIncidentStates: Array<IncidentState> =
        await IncidentStateUtil.getUnresolvedIncidentStates(props.projectId);

      if (unresolvedIncidentStates.length === 0) {
        return 0;
      }

      return ModelAPI.count<Incident>({
        modelType: Incident,
        query: {
          projectId: props.projectId,
          currentIncidentStateId: new Includes(
            unresolvedIncidentStates.map((state: IncidentState) => {
              return state.id!;
            }),
          ),
        },
      });
    };

  const fetchActiveAlertsCount: () => Promise<number> =
    async (): Promise<number> => {
      const unresolvedAlertStates: Array<AlertState> =
        await AlertStateUtil.getUnresolvedAlertStates(props.projectId);

      if (unresolvedAlertStates.length === 0) {
        return 0;
      }

      return ModelAPI.count<Alert>({
        modelType: Alert,
        query: {
          projectId: props.projectId,
          currentAlertStateId: new Includes(
            unresolvedAlertStates.map((state: AlertState) => {
              return state.id!;
            }),
          ),
        },
      });
    };

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const [
        activeIncidents,
        activeAlerts,
        notOperationalMonitors,
        ongoingMaintenance,
        slosNeedingAttention,
        totalMonitors,
        totalSlos,
      ]: [number, number, number, number, number, number, number] =
        await Promise.all([
          fetchActiveIncidentsCount(),
          fetchActiveAlertsCount(),
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
          /*
           * At Risk and Budget Exhausted are the two statuses that mean a
           * reliability target is in trouble. Misconfigured and Paused are
           * deliberately excluded: they are a setup problem, not a burning
           * budget, and mixing them in would make the tile impossible to
           * act on.
           *
           * Archived SLOs are excluded for the same reason disabled ones are:
           * the worker no longer evaluates them, so their status is frozen at
           * the moment they were archived, and the SLOs list this tile opens
           * does not show them either.
           */
          ModelAPI.count<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            query: {
              projectId: props.projectId,
              isEnabled: true,
              isArchived: false,
              sloStatus: new Includes([
                SloStatus.AtRisk,
                SloStatus.BudgetExhausted,
              ]),
            },
          }),
          /*
           * The two totals below tell "nothing is wrong" apart from "nothing
           * is set up". They run in the same batch as the rest, so a new
           * project pays for them in parallel, not in a second round trip.
           */
          ModelAPI.count<Monitor>({
            modelType: Monitor,
            query: {
              projectId: props.projectId,
            },
          }),
          /*
           * Disabled SLOs still count as set up (the tile keeps its usual
           * reading for them); archived ones are gone from the SLOs list, so
           * they do not.
           */
          ModelAPI.count<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            query: {
              projectId: props.projectId,
              isArchived: false,
            },
          }),
        ]);

      setCounts({
        activeIncidents,
        activeAlerts,
        notOperationalMonitors,
        ongoingMaintenance,
        slosNeedingAttention,
        totalMonitors,
        totalSlos,
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
    /*
     * Keyed on the string VALUE, not the ObjectID instance: callers that
     * rebuild the id each render (identity churn) must not re-fire these
     * count requests.
     */
  }, [props.projectId.toString()]);

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
      key: "not-operational-monitors",
      label: "Not operational monitors",
      pageMap: PageMap.HOME_NOT_OPERATIONAL_MONITORS,
      count: counts?.notOperationalMonitors || 0,
      attentionLabel: "Needs attention",
      attentionClassName: "text-red-600",
      attentionIcon: IconProp.Error,
      allClearLabel: "All operational",
      notSetUp: {
        isNotSetUp: counts !== null && counts.totalMonitors === 0,
        label: NO_MONITORS_YET_LABEL,
        pageMap: PageMap.MONITOR_CREATE,
      },
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
    {
      key: "slos-needing-attention",
      label: "SLOs at risk",
      pageMap: PageMap.SLOS,
      count: counts?.slosNeedingAttention || 0,
      attentionLabel: "Budget burning",
      attentionClassName: "text-amber-600",
      attentionIcon: IconProp.Gauge,
      allClearLabel: "Budgets healthy",
      notSetUp: {
        isNotSetUp: counts !== null && counts.totalSlos === 0,
        label: NO_SLOS_YET_LABEL,
        pageMap: PageMap.SLOS,
      },
    },
  ];

  return (
    <div
      data-testid="home-overview-stats"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
    >
      {tiles.map((tile: StatTile) => {
        const isNotSetUp: boolean = Boolean(tile.notSetUp?.isNotSetUp);
        const needsAttention: boolean = !isNotSetUp && tile.count > 0;

        let statusClassName: string = "text-emerald-600";
        let statusIcon: IconProp = IconProp.CheckCircle;
        let statusLabel: string = tile.allClearLabel;
        let targetPageMap: PageMap = tile.pageMap;

        if (isNotSetUp && tile.notSetUp) {
          statusClassName = "text-gray-500";
          statusIcon = IconProp.Add;
          statusLabel = tile.notSetUp.label;
          targetPageMap = tile.notSetUp.pageMap;
        } else if (needsAttention) {
          statusClassName = tile.attentionClassName;
          statusIcon = tile.attentionIcon;
          statusLabel = tile.attentionLabel;
        }

        return (
          <InfoCard
            key={tile.key}
            title={tile.label}
            onClick={() => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(RouteMap[targetPageMap] as Route),
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
                    data-testid={`home-stat-${tile.key}-status`}
                    className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${statusClassName}`}
                  >
                    <Icon icon={statusIcon} className="h-4 w-4" />
                    <span>{tx(statusLabel)}</span>
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
