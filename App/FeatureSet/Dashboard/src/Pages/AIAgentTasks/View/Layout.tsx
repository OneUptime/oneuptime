import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import { Outlet, useParams } from "react-router-dom";
import { RouteUtil } from "../../../Utils/RouteMap";
import { getAIAgentTasksBreadcrumbs } from "../../../Utils/Breadcrumbs";

/*
 * Plain Page (not ModelPage): the Overview below needs the run's event trail
 * alongside the run itself, and events are only reachable through
 * /code-fix-run/get (AIRunEvent has no runType to scope by, so it cannot be
 * opened to the project the way AIRun is). One request there beats a
 * ModelPage title fetch plus a second call for the events.
 */
const AIAgentTaskViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      /*
       * Not "AI Fix Task": a run can also be a regression test, an
       * instrumentation improvement or a performance fix.
       */
      title="AI Task"
      breadcrumbLinks={getAIAgentTasksBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </Page>
  );
};

export default AIAgentTaskViewLayout;
