import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AnnouncementTable from "../../../Components/Announcement/AnnouncementsTable";
import Query from "Common/Types/BaseDatabase/Query";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import ProjectUtil from "Common/UI/Utils/Project";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const statusPage: StatusPage = new StatusPage();
  statusPage.id = modelId;

  const query: Query<StatusPageAnnouncement> = {
    statusPages: [statusPage],
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  return (
    <Fragment>
      <AnnouncementTable
        query={query}
        initialValues={{
          statusPages: [modelId.toString()],
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
