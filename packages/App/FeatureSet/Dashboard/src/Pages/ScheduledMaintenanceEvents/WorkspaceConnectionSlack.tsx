import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspaceReactionNotesTips from "../../Components/Workspace/WorkspaceReactionNotesTips";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Slack}
      eventTypes={[NotificationRuleEventType.ScheduledMaintenance]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.Slack}
            eventType={NotificationRuleEventType.ScheduledMaintenance}
          />
          <WorkspaceReactionNotesTips
            workspaceType={WorkspaceType.Slack}
            resourceName="scheduled maintenance event"
            supportsPublicNotes={true}
          />
        </>
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default IncidentsPage;
