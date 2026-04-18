import MetricsNavTabs from "../../../Components/Metrics/MetricsNavTabs";
import MetricsSettingsSideMenu from "./SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const MetricsSettingsLayout: FunctionComponent = (): ReactElement => {
  return (
    <div>
      <MetricsNavTabs active="settings" />
      <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
        <MetricsSettingsSideMenu />
        <div className="space-y-6 flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default MetricsSettingsLayout;
