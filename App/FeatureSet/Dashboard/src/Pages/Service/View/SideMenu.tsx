import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentStateUtil from "../../../Utils/IncidentState";
import AlertStateUtil from "../../../Utils/AlertState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ServiceMonitor from "Common/Models/DatabaseModels/ServiceMonitor";
import ListResult from "Common/Types/BaseDatabase/ListResult";
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

  const [monitorIds, setMonitorIds] = useState<Array<ObjectID>>([]);
  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);

  const fetchMonitorIds: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const list: ListResult<ServiceMonitor> =
        await ModelAPI.getList<ServiceMonitor>({
          modelType: ServiceMonitor,
          query: { serviceId: props.modelId },
          select: { monitorId: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {},
        });
      setMonitorIds(
        list.data
          .map((sm: ServiceMonitor) => {
            return sm.monitorId!;
          })
          .filter(Boolean),
      );
    } catch {
      // ignore — badge will simply not show a count
    }
  };

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (projectId) {
        const states: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);
        setUnresolvedIncidentStates(states);
      }
    } catch {
      // ignore
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
      // ignore
    }
  };

  useEffect(() => {
    fetchMonitorIds().catch(() => {
      // do nothing
    });
    fetchIncidentStates().catch(() => {
      // do nothing
    });
    fetchAlertStates().catch(() => {
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

      <SideMenuSection title="Resources">
        <SideMenuItem
          link={{
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_MONITORS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.AltGlobe}
        />

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
      </SideMenuSection>

      <SideMenuSection title="Operations">
        <CountModelSideMenuItem<Alert>
          link={{
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.BellRinging}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: projectId!,
            monitorId: new Includes(monitorIds),
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          }}
        />

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
            monitors: new Includes(monitorIds),
            currentIncidentStateId: new Includes(
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          }}
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

      <SideMenuSection title="Advanced">
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
