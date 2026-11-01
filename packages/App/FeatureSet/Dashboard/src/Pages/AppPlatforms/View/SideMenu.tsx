import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentStateUtil from "../../../Utils/IncidentState";
import AlertStateUtil from "../../../Utils/AlertState";
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
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { getDetailPageActiveRoute } from "../../../Utils/DetailPageActiveRoute";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * An environment's menu in App Platforms: what runs in it - its apps and
 * the instances running them, as a Kubernetes cluster's menu leads with its
 * workloads - the telemetry they send, its incidents and alerts, and its
 * settings. A resource in a cloud account has a menu of its own, in Cloud
 * (Pages/Cloud/View/SideMenu).
 */
const AppPlatformEnvironmentViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);

  const fetchStates: PromiseVoidFunction = async (): Promise<void> => {
    if (!projectId) {
      return;
    }

    try {
      setUnresolvedIncidentStates(
        await IncidentStateUtil.getUnresolvedIncidentStates(projectId),
      );
    } catch {
      // ignore — the badge simply shows no count
    }

    try {
      setUnresolvedAlertStates(
        await AlertStateUtil.getUnresolvedAlertStates(projectId),
      );
    } catch {
      // ignore — the badge simply shows no count
    }
  };

  useEffect(() => {
    fetchStates().catch(() => {
      // fetchStates reports nothing: the badges stay empty
    });
  }, []);

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      {/*
       * What runs here: the apps (one page each, which keeps Apps lit) and
       * the instances running them.
       */}
      <SideMenuSection title="Workloads">
        <SideMenuItem
          link={{
            title: "Apps",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APPS] as Route,
              { modelId: props.modelId },
            ),
          }}
          activeRoute={getDetailPageActiveRoute({
            detailPage: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP,
            modelId: props.modelId,
          })}
          icon={IconProp.Squares}
        />
        <SideMenuItem
          link={{
            title: "Instances",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Terminal}
        />
        <SideMenuItem
          link={{
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Workflow}
        />
        <SideMenuItem
          link={{
            title: "Feed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_FEED] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      {/*
       * The incidents and alerts linked to this environment - by a person,
       * by the monitor that watches it, or by OneUptime AI.
       */}
      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INCIDENTS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={{
            projectId: projectId!,
            cloudResources: new Includes([props.modelId]),
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
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: projectId!,
            cloudResources: new Includes([props.modelId]),
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          }}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: CloudResource,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
        parentPageKey: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Delete Environment",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE] as Route,
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

export default AppPlatformEnvironmentViewSideMenu;
