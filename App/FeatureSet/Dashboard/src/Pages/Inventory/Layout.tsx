import PageMap from "../../Utils/PageMap";
import { getInventoryBreadcrumbs } from "../../Utils/Breadcrumbs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { Location, matchPath, Outlet, useLocation } from "react-router-dom";

const InventoryLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const location: Location = useLocation();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const isTopology: boolean = Boolean(
    matchPath(
      RouteMap[PageMap.TOPOLOGY_ROOT]?.toString() || "",
      location.pathname,
    ),
  );
  const isInventoryItemView: boolean = Boolean(
    matchPath(
      `${RouteMap[PageMap.INVENTORY_VIEW_ROOT]?.toString() || ""}/*`,
      location.pathname,
    ),
  );

  const content: ReactElement = (
    <Suspense fallback={<PageLoader isVisible={true} />}>
      <Outlet />
    </Suspense>
  );

  // Item detail pages have their own model-specific menu and Page shell.
  if (isInventoryItemView) {
    return content;
  }

  return (
    <Page
      title={isTopology ? "Topology" : "Inventory"}
      description={
        isTopology
          ? "Understand how your services, infrastructure, and network connect."
          : undefined
      }
      sideMenu={<SideMenu />}
      breadcrumbLinks={isTopology ? [] : getInventoryBreadcrumbs(path)}
    >
      {content}
    </Page>
  );
};

export default InventoryLayout;
