import MetricsAISideMenu from "./SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Metrics → AI: the section's side menu beside its page, as Metrics →
 * Settings draws its own - what OneUptime found in the project's metrics
 * (Insights), what OneUptime AI did with it (Logs) and what it may do on
 * its own (Settings).
 */
const MetricsAILayout: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
      <MetricsAISideMenu />
      <div className="space-y-6 flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
};

export default MetricsAILayout;
