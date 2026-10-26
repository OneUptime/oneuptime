import { getCloudBreadcrumbs } from "../../../../Utils/Breadcrumbs/CloudBreadcrumbs";
import { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import CloudAccountSideMenu from "./SideMenu";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

// One cloud account's pages: its overview, resources, changes and topology.
const CloudAccountViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Cloud Account"
      modelType={CloudAccount}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getCloudBreadcrumbs(path)}
      sideMenu={<CloudAccountSideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default CloudAccountViewLayout;
