import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      {/*
       * Like an incident episode's menu, the episode's members are in
       * Overview, so a page is in the same place on both kinds. An alert
       * episode has no roles or public notes, so its Owners join Overview and
       * its Private Notes join Investigation rather than each taking a
       * section of one entry (#9216).
       */}
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "State Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Timeline}
        />
        {/*
         * The alerts grouped into this episode. It was a section of its own,
         * "Alerts" (#9216); an incident episode has its incidents in the same place.
         */}
        <SideMenuItem
          link={{
            title: "Member Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
        />
        {/*
         * Who owns this episode. It was a section of its own, "Team" (#9216).
         */}
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="Investigation">
        <SideMenuItem
          link={{
            title: "Description",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_DESCRIPTION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Chat}
        />

        <SideMenuItem
          link={{
            title: "Root Cause",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
        />

        <SideMenuItem
          link={{
            title: "Remediation Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_REMEDIATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Wrench}
        />
        {/*
         * Notes only the team sees, beside the rest of the investigation. It was
         * a section of its own, "Notes" (#9216).
         */}
        <SideMenuItem
          link={{
            title: "Private Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: AlertEpisode,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />

        <SideMenuItem
          link={{
            title: "Delete Episode",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_VIEW_DELETE] as Route,
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
