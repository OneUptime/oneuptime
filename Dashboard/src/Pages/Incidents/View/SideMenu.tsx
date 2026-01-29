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
              RouteMap[PageMap.INCIDENT_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Description",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_DESCRIPTION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Chat}
        />

        <SideMenuItem
          link={{
            title: "Root Cause",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_ROOT_CAUSE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
        />

        <SideMenuItem
          link={{
            title: "Remediation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_REMEDIATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Wrench}
        />

        <SideMenuItem
          link={{
            title: "Postmortem",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_POSTMORTEM] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />

        <SideMenuItem
          link={{
            title: "State Timeline",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_STATE_TIMELINE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />

        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />

        <SideMenuItem
          link={{
            title: "Members",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_MEMBERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="On Call">
        <SideMenuItem
          link={{
            title: "On Call Executions",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Call}
        />
      </SideMenuSection>

      <SideMenuSection title="Logs">
        <SideMenuItem
          link={{
            title: "Notification Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bell}
        />
        {/* <SideMenuItem
          link={{
            title: "AI Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_AI_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bolt}
        /> */}
      </SideMenuSection>

      <SideMenuSection title="Incident Notes">
        <SideMenuItem
          link={{
            title: "Private Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_INTERNAL_NOTE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />
        <SideMenuItem
          link={{
            title: "Public Notes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_PUBLIC_NOTE] as Route,
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
              RouteMap[PageMap.INCIDENT_VIEW_CUSTOM_FIELDS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />

        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Delete Incident",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route,
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
