import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsSideMenuItem from "../../../Components/Recommendations/RecommendationsSideMenuItem";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

export interface ComponentProps {
  modelId: ObjectID;
}

const RumApplicationViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
        {/*
         * Navigation.isOnThisPage bails when the segment count differs, so
         * this item does not highlight while the player page is open - the
         * same pre-existing behaviour as Host > Processes > ProcessView.
         */}
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
      </SideMenuSection>

      <SideMenuSection title="Settings">
        {/*
         * This application's replay policy - masking, consent, sampling,
         * origins, retention. It lives here rather than on a project-wide
         * settings page because it governs THIS application's recordings
         * and belongs next to them. The project master switch, the
         * installation test and targeted capture are project-shaped and
         * live in Project Settings > Session Replay.
         */}
        <SideMenuItem
          link={{
            title: "Session Replay",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        {/*
         * Deliberately under Advanced rather than beside the player: this
         * is the record of which operators watched a real end user's
         * screen, and it is a governance surface, not a debugging one.
         */}
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
