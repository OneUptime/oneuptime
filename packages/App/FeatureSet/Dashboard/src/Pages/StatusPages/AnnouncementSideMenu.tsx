import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import { getDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const AnnouncementSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ANNOUNCEMENT_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
      </SideMenuSection>

      <SideMenuSection title="Notification Logs">
        <SideMenuItem
          link={{
            title: "Notification Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bell}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: StatusPageAnnouncement,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Announcement",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ANNOUNCEMENT_VIEW_DELETE] as Route,
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

export default AnnouncementSideMenu;
