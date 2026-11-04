import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Mattermost}
      eventTypes={[NotificationRuleEventType.ScheduledMaintenance]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.Mattermost}>
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Mattermost}
          eventType={NotificationRuleEventType.ScheduledMaintenance}
        />
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default IncidentsPage;
