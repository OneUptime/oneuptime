import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Description",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Chat}
        />
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "State Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      <SideMenuSection title="Logs">
        <SideMenuItem
          link={{
            title: "Notification Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bell}
        />
        <SideMenuItem
          link={{
            title: "AI Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bolt}
        />
      </SideMenuSection>

      <SideMenuSection title="Scheduled Maintenance Notes">
        <SideMenuItem
          link={{
            title: "Private Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />
        <SideMenuItem
          link={{
            title: "Public Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Public}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />

        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Delete Event",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE] as Route,
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
