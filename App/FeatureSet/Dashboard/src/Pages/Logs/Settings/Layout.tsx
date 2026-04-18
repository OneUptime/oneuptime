import LogsNavTabs from "../../../Components/Logs/LogsNavTabs";
import LogsSettingsSideMenu from "./SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const LogsSettingsLayout: FunctionComponent = (): ReactElement => {
  return (
    <div>
      <LogsNavTabs active="settings" />
      <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
        <LogsSettingsSideMenu />
        <div className="space-y-6 flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default LogsSettingsLayout;
