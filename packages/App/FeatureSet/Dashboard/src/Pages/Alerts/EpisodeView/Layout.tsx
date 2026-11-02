import { getAlertsBreadcrumbs } from "../../../Utils/Breadcrumbs/AlertBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerTeam from "Common/Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "Common/Models/DatabaseModels/AlertEpisodeOwnerUser";
import PrivateRecordScopeProvider from "../../../Components/PrivateRecord/PrivateRecordScopeProvider";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const AlertEpisodeViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Episode"
      modelType={AlertEpisode}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getAlertsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      {/*
       * A private episode is changed only with the permissions of the teams
       * that own it: every page of it offers only what the reader may do
       * there (PrivateRecordScopeProvider).
       */}
      <PrivateRecordScopeProvider
        modelType={AlertEpisode}
        modelId={modelId}
        ownerTeamModelType={AlertEpisodeOwnerTeam}
        ownerUserModelType={AlertEpisodeOwnerUser}
        ownerKey="alertEpisodeId"
      >
        <Outlet />
      </PrivateRecordScopeProvider>
    </ModelPage>
  );
};

export default AlertEpisodeViewLayout;
