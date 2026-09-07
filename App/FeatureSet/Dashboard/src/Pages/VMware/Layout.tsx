import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import Page from "Common/UI/Components/Page/Page";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getVMwareBreadcrumbs } from "../../Utils/Breadcrumbs/VMwareBreadcrumbs";

const VMwareLayout: FunctionComponent = (): ReactElement => {
  return (
    <Page
      title="VMware"
      breadcrumbLinks={getVMwareBreadcrumbs(
        Navigation.getRoutePath(RouteUtil.getRoutes()),
      )}
      sideMenu={
        <SideMenu
          sections={[
            {
              title: "VMware vSphere",
              items: [
                {
                  link: {
                    title: "Sources",
                    to: RouteUtil.populateRouteParams(
                      RouteMap[PageMap.VMWARE_SOURCES] as Route,
                    ),
                  },
                  icon: IconProp.Server,
                },
                {
                  link: {
                    title: "Monitors",
                    to: RouteUtil.populateRouteParams(
                      RouteMap[PageMap.VMWARE_MONITORS] as Route,
                    ),
                  },
                  icon: IconProp.ChartBar,
                },
                {
                  link: {
                    title: "Installation",
                    to: RouteUtil.populateRouteParams(
                      RouteMap[PageMap.VMWARE_DOCUMENTATION] as Route,
                    ),
                  },
                  icon: IconProp.Book,
                },
              ],
            },
          ]}
        />
      }
    >
      <Outlet />
    </Page>
  );
};
export default VMwareLayout;
