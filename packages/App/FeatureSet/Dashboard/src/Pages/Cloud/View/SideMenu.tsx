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
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A cloud resource's menu in Cloud. Its metrics are what its provider's
 * monitoring publishes about it, so it has no logs, traces or instances of
 * its own; it has the Changes its account's activity log records. An
 * environment's menu is App Platforms' (Pages/AppPlatforms/View/SideMenu).
 */
const CloudResourceViewSideMenu: FunctionComponent<ComponentProps> = (
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

  const routeTo: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_METRICS),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Feed",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_FEED),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      {/*
       * The incidents and alerts linked to this resource - by a person, by
       * the monitor that watches it, or by OneUptime AI - and what its
       * account's activity log recorded about it.
       */}
      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS),
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
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_ALERTS),
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
        <SideMenuItem
          link={{
            title: "Changes",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_CHANGES),
          }}
          icon={IconProp.Activity}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Settings",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: CloudResource,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
        parentPageKey: PageMap.CLOUD_RESOURCE_VIEW,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Owners",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_OWNERS),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Delete Resource",
            to: routeTo(PageMap.CLOUD_RESOURCE_VIEW_DELETE),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default CloudResourceViewSideMenu;
