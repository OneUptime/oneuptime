import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";
import AnnouncementSideMenu from "./AnnouncementSideMenu";

const AnnouncementViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  return (
    <ModelPage
      title="Announcement"
      modelType={StatusPageAnnouncement}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={[]}
      sideMenu={<AnnouncementSideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default AnnouncementViewLayout;
