import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceLogsTable from "../../../Components/NotificationLogs/WorkspaceLogsTable";

const AlertWorkspaceLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <WorkspaceLogsTable
      id="alert-workspace-logs-table"
      userPreferencesKey="alert-workspace-logs-table"
      showViewIdButton
      query={{ alertId: modelId }}
      selectMoreFields={{ statusMessage: true, messageSummary: true, channelId: true }}
      cardProps={{
        title: "Workspace Logs",
        description: "Messages sent to Slack / Teams for this alert.",
      }}
      noItemsMessage="No Workspace logs for this alert."
    />
  );
};

export default AlertWorkspaceLogs;
