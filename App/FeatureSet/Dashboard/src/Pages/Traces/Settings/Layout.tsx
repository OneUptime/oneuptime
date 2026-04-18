import TracesNavTabs from "../../../Components/Traces/TracesNavTabs";
import TracesSettingsSideMenu from "./SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const TracesSettingsLayout: FunctionComponent = (): ReactElement => {
  return (
    <div>
      <TracesNavTabs active="settings" />
      <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
        <TracesSettingsSideMenu />
        <div className="space-y-6 flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default TracesSettingsLayout;
