import Footer from "../Footer/Footer";
import Header from "../Header/Header";
import NavBar from "../NavBar/NavBar";
import MasterPage from "Common/UI/Components/MasterPage/MasterPage";
import ServerSendingTopAlert from "Common/UI/Components/ServerSending/ServerSendingTopAlert";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      {/*
       * No banner saying what this dashboard is: the header's "Admin
       * Dashboard" label and the trail every page starts with say it
       * (#9041). A banner here is only for what a master admin must act on:
       * while the server cannot send email, or its global probes have all
       * stopped reporting, what is not happening and where to fix it.
       */}
      <ServerSendingTopAlert
        emailSettingsLink={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_SMTP] as Route,
        )}
        globalProbesLink={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_PROBES] as Route,
        )}
      />
      <MasterPage
        footer={<Footer />}
        header={<Header />}
        navBar={<NavBar />}
        isLoading={false}
        error={""}
        /*
         * min-h-screen, not h-screen — see the dashboard master page: a fixed
         * 100vh caps the sticky top section's containing block at one viewport
         * and the header scrolls away on longer pages.
         */
        className="flex flex-col min-h-screen"
      >
        {props.children}
      </MasterPage>
    </div>
  );
};

export default DashboardMasterPage;
