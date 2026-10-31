import { getIncidentsBreadcrumbs } from "../../../Utils/Breadcrumbs/IncidentBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import PrivateRecordScopeProvider from "../../../Components/PrivateRecord/PrivateRecordScopeProvider";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const IncidentViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Incident"
      modelType={Incident}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getIncidentsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      {/*
       * A private incident is changed only with the permissions of the teams
       * that own it: every page of it offers only what the reader may do
       * there (PrivateRecordScopeProvider).
       */}
      <PrivateRecordScopeProvider
        modelType={Incident}
        modelId={modelId}
        ownerTeamModelType={IncidentOwnerTeam}
        ownerUserModelType={IncidentOwnerUser}
        ownerKey="incidentId"
      >
        <Outlet />
      </PrivateRecordScopeProvider>
    </ModelPage>
  );
};

export default IncidentViewLayout;
