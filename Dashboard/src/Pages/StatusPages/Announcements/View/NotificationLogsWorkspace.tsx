import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceLogsTable from "../../../../Components/NotificationLogs/WorkspaceLogsTable";

const AnnouncementWorkspaceLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <WorkspaceLogsTable
      id="announcement-workspace-logs-table"
      userPreferencesKey="announcement-workspace-logs-table"
      showViewIdButton
      query={{ statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true, messageSummary: true, channelId: true }}
      cardProps={{
        title: "Workspace Logs",
        description: "Messages sent to Slack / Teams for this announcement.",
      }}
      noItemsMessage="No Workspace logs for this announcement."
    />
  );
};

export default AnnouncementWorkspaceLogs;
