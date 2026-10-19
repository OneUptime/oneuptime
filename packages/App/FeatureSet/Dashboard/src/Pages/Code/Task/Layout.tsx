import { getCodeBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * A task in Code is a conversation, so its page has no side menu: the
 * conversation takes the width a person reads at. The page inside hands up
 * its own trail once it knows the task's repository (Code > repository >
 * Task #42).
 */
const CodeTaskLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page breadcrumbLinks={getCodeBreadcrumbs(path)}>
      <Outlet />
    </Page>
  );
};

export default CodeTaskLayout;
