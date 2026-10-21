import { getMessageQueueBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * The Queues product's own pages — the list, the archived list, the install
 * guide and the owner / label rules. A queue's tabs have their own layout
 * (View/Layout.tsx).
 */
const MessageQueueLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Queues"}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getMessageQueueBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default MessageQueueLayout;
