import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "CommonUI/src/Components/Badge/Badge";
import CountModelSideMenuItem from "CommonUI/src/Components/SideMenu/CountModelSideMenuItem";
import SideMenu from "CommonUI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "CommonUI/src/Components/SideMenu/SideMenuItem";
import SideMenuSection from "CommonUI/src/Components/SideMenu/SideMenuSection";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "All Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS] as Route,
            ),
          }}
          icon={IconProp.List}
        />

        <CountModelSideMenuItem<Monitor>
          link={{
            title: "Inoperational Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_INOPERATIONAL] as Route,
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Monitor}
          countQuery={{
            projectId: props.project?._id,
            currentMonitorStatus: {
              isOperationalState: false,
            },
          }}
        />
      </SideMenuSection>

      {props.project?.isFeatureFlagMonitorGroupsEnabled ? (
        <SideMenuSection title="Monitor Groups">
          <SideMenuItem
            link={{
              title: "All Groups",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_GROUPS] as Route,
              ),
            }}
            icon={IconProp.Squares}
          />
        </SideMenuSection>
      ) : (
        <></>
      )}

      <SideMenuSection title="Not Being Monitored">
        <CountModelSideMenuItem<Monitor>
          link={{
            title: "Disabled Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_DISABLED] as Route,
            ),
          }}
          icon={IconProp.Error}
          badgeType={BadgeType.DANGER}
          modelType={Monitor}
          countQuery={{
            projectId: props.project?._id,
            disableActiveMonitoring: true,
          }}
        />

        <CountModelSideMenuItem<Monitor>
          link={{
            title: "Probe Disconnected",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_PROBE_DISCONNECTED] as Route,
            ),
          }}
          icon={IconProp.NoSignal}
          badgeType={BadgeType.DANGER}
          modelType={Monitor}
          countQuery={{
            projectId: props.project?._id,
            isAllProbesDisconnectedFromThisMonitor: true,
          }}
        />

        <CountModelSideMenuItem<Monitor>
          link={{
            title: "Probe Disabled",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_PROBE_DISABLED] as Route,
            ),
          }}
          icon={IconProp.EyeSlash}
          badgeType={BadgeType.DANGER}
          modelType={Monitor}
          countQuery={{
            projectId: props.project?._id,
            isNoProbeEnabledOnThisMonitor: true,
          }}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
