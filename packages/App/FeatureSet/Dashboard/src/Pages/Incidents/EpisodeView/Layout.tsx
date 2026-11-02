import { getIncidentsBreadcrumbs } from "../../../Utils/Breadcrumbs/IncidentBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
import PrivateRecordScopeProvider from "../../../Components/PrivateRecord/PrivateRecordScopeProvider";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const IncidentEpisodeViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Episode"
      modelType={IncidentEpisode}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getIncidentsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      {/*
       * A private episode is changed only with the permissions of the teams
       * that own it: every page of it offers only what the reader may do
       * there (PrivateRecordScopeProvider).
       */}
      <PrivateRecordScopeProvider
        modelType={IncidentEpisode}
        modelId={modelId}
        ownerTeamModelType={IncidentEpisodeOwnerTeam}
        ownerUserModelType={IncidentEpisodeOwnerUser}
        ownerKey="incidentEpisodeId"
      >
        <Outlet />
      </PrivateRecordScopeProvider>
    </ModelPage>
  );
};

export default IncidentEpisodeViewLayout;
