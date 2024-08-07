import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/src/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/src/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
  monitorType: MonitorType;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isProbeableMonitor: boolean = MonitorTypeHelper.isProbableMonitor(
    props.monitorType,
  );

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        {MonitorTypeHelper.doesMonitorTypeHaveCriteria(props.monitorType) ? (
          <SideMenuItem
            link={{
              title: "Criteria",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.Criteria}
          />
        ) : (
          <></>
        )}
        {MonitorTypeHelper.isProbableMonitor(props.monitorType) ? (
          <SideMenuItem
            link={{
              title: "Interval",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_VIEW_INTERVAL] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.Clock}
          />
        ) : (
          <></>
        )}
      </SideMenuSection>

      <SideMenuSection title="Timeline and Incidents">
        <SideMenuItem
          link={{
            title: "Status Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        {MonitorTypeHelper.doesMonitorTypeHaveDocumentation(
          props.monitorType,
        ) ? (
          <SideMenuItem
            link={{
              title: "Documentation",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_VIEW_DOCUMENTATION] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.Book}
          />
        ) : (
          <></>
        )}
        {isProbeableMonitor ? (
          <SideMenuItem
            link={{
              title: "Probes",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.Signal}
          />
        ) : (
          <></>
        )}
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW_CUSTOM_FIELDS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Monitor",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route,
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
