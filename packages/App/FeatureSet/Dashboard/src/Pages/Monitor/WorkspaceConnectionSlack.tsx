import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

const MonitorsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
      <WorkspaceNotificationRuleTable
        workspaceType={WorkspaceType.Slack}
        eventType={NotificationRuleEventType.Monitor}
      />
    </WorkspaceConnectionGate>
  );
};

export default MonitorsPage;
