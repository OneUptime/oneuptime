import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentStateUtil from "../../../Utils/IncidentState";
import AlertStateUtil from "../../../Utils/AlertState";
import ScheduledMaintenanceStateUtil from "../../../Utils/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import ProjectUtil from "Common/UI/Utils/Project";
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

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);
  const [
    activeScheduledMaintenanceStates,
    setActiveScheduledMaintenanceStates,
  ] = useState<Array<ScheduledMaintenanceState>>([]);

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (projectId) {
        const states: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);
        setUnresolvedIncidentStates(states);
      }
    } catch {
      // ignore — badge will simply not show a count
    }
  };

  const fetchAlertStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (projectId) {
        const states: Array<AlertState> =
          await AlertStateUtil.getUnresolvedAlertStates(projectId);
        setUnresolvedAlertStates(states);
      }
    } catch {
      // ignore — badge will simply not show a count
    }
  };

  const fetchScheduledMaintenanceStates: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        if (projectId) {
          const states: Array<ScheduledMaintenanceState> =
            await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
              projectId,
            );
          setActiveScheduledMaintenanceStates(states);
        }
      } catch {
        // ignore — badge will simply not show a count
      }
    };

  useEffect(() => {
    fetchIncidentStates().catch(() => {
      // do nothing
    });
    fetchAlertStates().catch(() => {
      // do nothing
    });
    fetchScheduledMaintenanceStates().catch(() => {
      // do nothing
    });
  }, []);

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="Telemetry">
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />

        <SideMenuItem
          link={{
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Workflow}
        />

        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Graph}
        />

        <SideMenuItem
          link={{
            title: "Performance Profiles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_PROFILES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Fire}
        />

        <SideMenuItem
          link={{
            title: "Exceptions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_EXCEPTIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Error}
        />
      </SideMenuSection>

      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={{
            projectId: projectId!,
            services: new Includes([props.modelId]),
            currentIncidentStateId: new Includes(
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          }}
        />
        <CountModelSideMenuItem<Alert>
          link={{
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: projectId!,
            services: new Includes([props.modelId]),
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          }}
        />
        <CountModelSideMenuItem<ScheduledMaintenance>
          link={{
            title: "Scheduled Maintenance",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Clock}
          badgeType={BadgeType.WARNING}
          modelType={ScheduledMaintenance}
          countQuery={{
            projectId: projectId!,
            services: new Includes([props.modelId]),
            currentScheduledMaintenanceStateId: new Includes(
              activeScheduledMaintenanceStates.map(
                (state: ScheduledMaintenanceState) => {
                  return state.id!;
                },
              ),
            ),
          }}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Code Repositories",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_CODE_REPOSITORIES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Code}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Service",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
