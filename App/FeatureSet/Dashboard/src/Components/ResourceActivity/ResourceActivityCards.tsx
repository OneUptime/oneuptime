import IncidentStateUtil from "../../Utils/IncidentState";
import AlertStateUtil from "../../Utils/AlertState";
import ScheduledMaintenanceStateUtil from "../../Utils/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Each of the Incident, Alert, and ScheduledMaintenance models exposes
 * the same set of resource-relation fields (`hosts`, `kubernetesClusters`,
 * `dockerHosts`, `podmanHosts`, `proxmoxClusters`, `cephClusters`,
 * `services`). The
 * host/k8s/docker/podman/proxmox/ceph/service overview pages filter their
 * activity tables by populating one of these keys with an `Includes`
 * over the current resource id — this component does the same for the
 * count cards so the numbers match what the filtered pages show.
 */
export type ResourceQueryKey =
  | "hosts"
  | "kubernetesClusters"
  | "dockerHosts"
  | "podmanHosts"
  | "proxmoxClusters"
  | "cephClusters"
  | "services";

export interface ComponentProps {
  modelId: ObjectID;
  resourceQueryKey: ResourceQueryKey;
  incidentsRoute: Route;
  alertsRoute: Route;
  scheduledMaintenanceRoute: Route;
}

interface CardData {
  title: string;
  description: string;
  count: number | null;
  isLoading: boolean;
  hasError: boolean;
  icon: IconProp;
  iconBg: string;
  iconText: string;
  iconRing: string;
  countText: string;
  to: Route;
}

const ResourceActivityCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [incidentCount, setIncidentCount] = useState<number | null>(null);
  const [alertCount, setAlertCount] = useState<number | null>(null);
  const [maintenanceCount, setMaintenanceCount] = useState<number | null>(null);

  const [isIncidentLoading, setIsIncidentLoading] = useState<boolean>(true);
  const [isAlertLoading, setIsAlertLoading] = useState<boolean>(true);
  const [isMaintenanceLoading, setIsMaintenanceLoading] =
    useState<boolean>(true);

  const [hasIncidentError, setHasIncidentError] = useState<boolean>(false);
  const [hasAlertError, setHasAlertError] = useState<boolean>(false);
  const [hasMaintenanceError, setHasMaintenanceError] =
    useState<boolean>(false);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    if (!projectId) {
      return;
    }

    /*
     * Active = unresolved for incidents/alerts, and not-ended / not-resolved
     * for scheduled maintenance. The state utils already encode these rules
     * so the cards match the badge counts on the side menu and the table
     * filters that the linked pages render.
     */
    const incidentPromise: Promise<void> = (async (): Promise<void> => {
      try {
        const states: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);
        const count: number = await ModelAPI.count<Incident>({
          modelType: Incident,
          query: {
            projectId: projectId,
            [props.resourceQueryKey]: new Includes([props.modelId]),
            currentIncidentStateId: new Includes(
              states.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          },
        });
        setIncidentCount(count);
        setHasIncidentError(false);
      } catch {
        setHasIncidentError(true);
      } finally {
        setIsIncidentLoading(false);
      }
    })();

    const alertPromise: Promise<void> = (async (): Promise<void> => {
      try {
        const states: Array<AlertState> =
          await AlertStateUtil.getUnresolvedAlertStates(projectId);
        const count: number = await ModelAPI.count<Alert>({
          modelType: Alert,
          query: {
            projectId: projectId,
            [props.resourceQueryKey]: new Includes([props.modelId]),
            currentAlertStateId: new Includes(
              states.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          },
        });
        setAlertCount(count);
        setHasAlertError(false);
      } catch {
        setHasAlertError(true);
      } finally {
        setIsAlertLoading(false);
      }
    })();

    const maintenancePromise: Promise<void> = (async (): Promise<void> => {
      try {
        const states: Array<ScheduledMaintenanceState> =
          await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
            projectId,
          );
        const count: number = await ModelAPI.count<ScheduledMaintenance>({
          modelType: ScheduledMaintenance,
          query: {
            projectId: projectId,
            [props.resourceQueryKey]: new Includes([props.modelId]),
            currentScheduledMaintenanceStateId: new Includes(
              states.map((state: ScheduledMaintenanceState) => {
                return state.id!;
              }),
            ),
          },
        });
        setMaintenanceCount(count);
        setHasMaintenanceError(false);
      } catch {
        setHasMaintenanceError(true);
      } finally {
        setIsMaintenanceLoading(false);
      }
    })();

    await Promise.all([incidentPromise, alertPromise, maintenancePromise]);
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // individual fetches already record their own error state
    });
    /*
     * modelId is stable for the lifetime of the page (it comes from the
     * route param) but list it as a dep so the cards refresh if the page
     * is ever reused across resources without unmounting.
     */
  }, [props.modelId.toString(), props.resourceQueryKey]);

  const formatCount: (count: number | null) => string = (
    count: number | null,
  ): string => {
    if (count === null) {
      return "—";
    }
    return count.toString();
  };

  const cards: Array<CardData> = [
    {
      title: "Active Incidents",
      description: "Unresolved incidents linked to this resource.",
      count: incidentCount,
      isLoading: isIncidentLoading,
      hasError: hasIncidentError,
      icon: IconProp.Alert,
      iconBg: "bg-red-50",
      iconText: "text-red-600",
      iconRing: "ring-red-200",
      countText:
        incidentCount !== null && incidentCount > 0
          ? "text-red-600"
          : "text-gray-900",
      to: props.incidentsRoute,
    },
    {
      title: "Active Alerts",
      description: "Unresolved alerts linked to this resource.",
      count: alertCount,
      isLoading: isAlertLoading,
      hasError: hasAlertError,
      icon: IconProp.ExclaimationCircle,
      iconBg: "bg-amber-50",
      iconText: "text-amber-600",
      iconRing: "ring-amber-200",
      countText:
        alertCount !== null && alertCount > 0
          ? "text-amber-600"
          : "text-gray-900",
      to: props.alertsRoute,
    },
    {
      title: "Scheduled Maintenance",
      description: "Ongoing or upcoming maintenance for this resource.",
      count: maintenanceCount,
      isLoading: isMaintenanceLoading,
      hasError: hasMaintenanceError,
      icon: IconProp.Clock,
      iconBg: "bg-indigo-50",
      iconText: "text-indigo-600",
      iconRing: "ring-indigo-200",
      countText:
        maintenanceCount !== null && maintenanceCount > 0
          ? "text-indigo-600"
          : "text-gray-900",
      to: props.scheduledMaintenanceRoute,
    },
  ];

  return (
    <div className="mb-6">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
        <p className="text-xs text-gray-500">
          Current incidents, alerts, and scheduled maintenance impacting this
          resource. Click a card to see the full list.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card: CardData, idx: number): ReactElement => {
          return (
            <Link
              key={`activity-card-${idx}`}
              to={card.to}
              className="group block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {card.title}
                </span>
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-md ${card.iconBg} ring-1 ring-inset ${card.iconRing}`}
                >
                  <Icon
                    icon={card.icon}
                    className={`h-3.5 w-3.5 ${card.iconText}`}
                  />
                </div>
              </div>
              <div
                className={`text-2xl font-semibold leading-none ${card.countText}`}
              >
                {card.isLoading ? (
                  <span className="text-gray-300">…</span>
                ) : card.hasError ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  formatCount(card.count)
                )}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {card.description}
              </div>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-indigo-600 group-hover:text-indigo-700">
                <span>View all</span>
                <Icon icon={IconProp.ArrowRight} className="h-3 w-3" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default ResourceActivityCards;
