import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceLogsTable from "../../../Components/NotificationLogs/WorkspaceLogsTable";

const IncidentWorkspaceLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <WorkspaceLogsTable
      id="incident-workspace-logs-table"
      userPreferencesKey="incident-workspace-logs-table"
      showViewIdButton
      query={{ incidentId: modelId }}
      selectMoreFields={{ statusMessage: true, messageSummary: true, channelId: true }}
      cardProps={{
        title: "Workspace Logs",
        description: "Messages sent to Slack / Teams for this incident.",
      }}
      noItemsMessage="No Workspace logs for this incident."
    />
  );
};

export default IncidentWorkspaceLogs;
