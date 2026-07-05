import React, { FunctionComponent, ReactElement } from "react";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import IconProp from "Common/Types/Icon/IconProp";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { BILLING_ENABLED } from "Common/UI/Config";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "Tasks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS] as Route,
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Agents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENTS_AGENTS] as Route,
            ),
          }}
          icon={IconProp.Automation}
        />
        <SideMenuItem
          link={{
            title: "MCP Server",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENTS_MCP_SERVER] as Route,
            ),
          }}
          icon={IconProp.Terminal}
        />
      </SideMenuSection>
      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "LLM Providers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENTS_LLM_PROVIDERS] as Route,
            ),
          }}
          icon={IconProp.Brain}
        />
        {BILLING_ENABLED ? (
          <SideMenuItem
            link={{
              title: "AI Credits",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.AI_AGENTS_AI_CREDITS] as Route,
              ),
            }}
            icon={IconProp.Billing}
          />
        ) : (
          <></>
        )}
        <SideMenuItem
          link={{
            title: "AI Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENTS_AI_LOGS] as Route,
            ),
          }}
          icon={IconProp.Logs}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
