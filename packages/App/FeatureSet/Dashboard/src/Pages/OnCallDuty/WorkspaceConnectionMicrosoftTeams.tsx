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
    <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
      <WorkspaceNotificationRuleTable
        workspaceType={WorkspaceType.MicrosoftTeams}
        eventType={NotificationRuleEventType.OnCallDutyPolicy}
      />
    </WorkspaceConnectionGate>
  );
};

export default MonitorsPage;
