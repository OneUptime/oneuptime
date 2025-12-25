import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import ObjectID from "Common/Types/ObjectID";
import { Outlet, useParams } from "react-router-dom";
import { RouteUtil } from "../../../Utils/RouteMap";
import { getAIAgentTasksBreadcrumbs } from "../../../Utils/Breadcrumbs";

const AIAgentTaskViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="AI Agent Task"
      modelType={AIAgentTask}
      modelId={modelId}
      modelNameField="_id"
      breadcrumbLinks={getAIAgentTasksBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default AIAgentTaskViewLayout;
