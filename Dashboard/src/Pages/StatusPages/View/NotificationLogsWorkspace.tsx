import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceLogsTable from "../../../Components/NotificationLogs/WorkspaceLogsTable";

const StatusPageWorkspaceLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <WorkspaceLogsTable
      id="status-page-workspace-logs-table"
      userPreferencesKey="status-page-workspace-logs-table"
      showViewIdButton
      query={{ statusPageId: modelId }}
      selectMoreFields={{
        statusMessage: true,
        messageSummary: true,
        channelId: true,
      }}
      cardProps={{
        title: "Workspace Logs",
        description: "Messages sent to Slack / Teams for this status page.",
      }}
      noItemsMessage="No Workspace logs for this status page."
    />
  );
};

export default StatusPageWorkspaceLogs;
