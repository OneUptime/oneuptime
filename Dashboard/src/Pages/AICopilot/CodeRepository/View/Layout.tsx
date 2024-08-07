import { getCodeRepositoryBreadcrumbs } from "../../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/src/Components/Page/ModelPage";
import Navigation from "Common/UI/src/Utils/Navigation";
import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const CopilotCodeRepositoryViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Repository"
      modelType={CopilotCodeRepository}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getCodeRepositoryBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default CopilotCodeRepositoryViewLayout;
