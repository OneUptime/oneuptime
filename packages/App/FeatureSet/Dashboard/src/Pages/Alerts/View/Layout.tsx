import { getAlertsBreadcrumbs } from "../../../Utils/Breadcrumbs/AlertBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import PrivateRecordScopeProvider from "../../../Components/PrivateRecord/PrivateRecordScopeProvider";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const AlertViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Alert"
      modelType={Alert}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getAlertsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      {/*
       * A private alert is changed only with the permissions of the teams
       * that own it: every page of it offers only what the reader may do
       * there (PrivateRecordScopeProvider).
       */}
      <PrivateRecordScopeProvider
        modelType={Alert}
        modelId={modelId}
        ownerTeamModelType={AlertOwnerTeam}
        ownerUserModelType={AlertOwnerUser}
        ownerKey="alertId"
      >
        <Outlet />
      </PrivateRecordScopeProvider>
    </ModelPage>
  );
};

export default AlertViewLayout;
