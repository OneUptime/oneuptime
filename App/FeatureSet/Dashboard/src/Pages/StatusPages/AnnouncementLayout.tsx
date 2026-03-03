import { getStatusPagesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";
import AnnouncementSideMenu from "./AnnouncementSideMenu";

const AnnouncementViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Announcement"
      modelType={StatusPageAnnouncement}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getStatusPagesBreadcrumbs(path)}
      sideMenu={<AnnouncementSideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default AnnouncementViewLayout;
