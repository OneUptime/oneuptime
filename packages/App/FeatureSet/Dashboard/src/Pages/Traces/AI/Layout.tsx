import TracesAISideMenu from "./SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Traces → AI: the section's side menu beside its page, as Traces →
 * Settings draws its own - what OneUptime found in the project's traces
 * (Insights), what OneUptime AI did with it (Logs) and what it may do on
 * its own (Settings).
 */
const TracesAILayout: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
      <TracesAISideMenu />
      <div className="space-y-6 flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
};

export default TracesAILayout;
