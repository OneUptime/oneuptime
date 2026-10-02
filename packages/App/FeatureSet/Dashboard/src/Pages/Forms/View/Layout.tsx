import { getFormsBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormViewSideMenu from "./SideMenu";
import Form from "Common/Models/DatabaseModels/Form";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const FormViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Form"
      modelType={Form}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getFormsBreadcrumbs(path)}
      sideMenu={<FormViewSideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default FormViewLayout;
