import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsSideMenuItem from "../../../Components/Recommendations/RecommendationsSideMenuItem";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import RumApplicationModel from "Common/Models/DatabaseModels/RumApplication";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const RumApplicationViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * A person's page is one of the people Users lists, so Users stays the
   * marked entry there, as Executions does on a runbook's run.
   */
  const personRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_PERSON] as Route,
    { modelId: props.modelId },
  );
  const isOnPersonPage: boolean = Navigation.isOnThisPage(personRoute);

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <RecommendationsSideMenuItem
          link={{
            title: "Recommendations",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_RECOMMENDATIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          resourceType={MonitorRecommendationResourceType.RumApplication}
          resourceId={props.modelId}
          icon={IconProp.Sparkles}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Terminal}
        />
        <SideMenuItem
          link={{
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_TRACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Workflow}
        />
        <SideMenuItem
          link={{
            title: "Clients",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_CLIENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
        />
      </SideMenuSection>

      <SideMenuSection title="Product Analytics">
        <SideMenuItem
          link={{
            title: "Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_USERS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          activeRoute={isOnPersonPage ? personRoute : undefined}
          icon={IconProp.UserCircle}
        />
        <SideMenuItem
          link={{
            title: "Sessions",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_SESSIONS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.PresentationChartLine}
        />
      </SideMenuSection>

      <SideMenuSection title="Session Replay">
        <SideMenuItem
          link={{
            title: "Session Replay",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Film}
        />
        <SideMenuItem
          link={{
            title: "User Flows",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_USER_FLOWS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Share}
        />
        <SideMenuItem
          link={{
            title: "Replay Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.UserGroup}
        />
        <SideMenuItem
          link={{
            title: "Health",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Heartbeat}
        />
        <SideMenuItem
          link={{
            title: "Replay Policy",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Frustration Signals",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_FRUSTRATION_SIGNALS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.FaceFrown}
        />
        <SideMenuItem
          link={{
            title: "Replay Access Log",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Eye}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.BookOpen}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: RumApplicationModel,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Application",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_DELETE] as Route,
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

export default RumApplicationViewSideMenu;
