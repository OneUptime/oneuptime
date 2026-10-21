import { getWorkflowsBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import ArchivedResourceBanner from "../../../Components/Archive/ArchivedResourceBanner";
import { WORKFLOW_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const WorkflowViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Workflow"
      modelType={Workflow}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getWorkflowsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <ArchivedResourceBanner<Workflow>
        modelType={Workflow}
        modelId={modelId}
        copy={WORKFLOW_ARCHIVE_COPY}
      />
      <Outlet />
    </ModelPage>
  );
};

export default WorkflowViewLayout;
