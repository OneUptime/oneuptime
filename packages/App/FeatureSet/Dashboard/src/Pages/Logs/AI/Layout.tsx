import LogsAISideMenu from "./SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Logs → AI: the section's side menu beside its page, as Logs → Settings
 * draws its own - what OneUptime found in the project's logs (Insights),
 * what OneUptime AI did with it (Activity) and what it may do on its own
 * (Settings).
 */
const LogsAILayout: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
      <LogsAISideMenu />
      <div className="space-y-6 flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
};

export default LogsAILayout;
