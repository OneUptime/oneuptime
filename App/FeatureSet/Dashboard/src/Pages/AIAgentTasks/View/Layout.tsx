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
 * Plain Page (not ModelPage): the route param is a CodeFix AIRun id, and
 * system-authored runs are hidden from the generic AIRun CRUD that
 * ModelPage's title fetch would use. The pages below load the run through
 * the dedicated /code-fix-run endpoints instead.
 */
const AIAgentTaskViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="AI Fix Task"
      breadcrumbLinks={getAIAgentTasksBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </Page>
  );
};

export default AIAgentTaskViewLayout;
