import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import WorkspaceReactionNotesTips from "../../Components/Workspace/WorkspaceReactionNotesTips";
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
      workspaceType={WorkspaceType.MicrosoftTeams}
      eventTypes={[NotificationRuleEventType.ScheduledMaintenance]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            eventType={NotificationRuleEventType.ScheduledMaintenance}
          />
          <WorkspaceReactionNotesTips
            workspaceType={WorkspaceType.MicrosoftTeams}
            resourceName="scheduled maintenance event"
            supportsPublicNotes={true}
          />
        </>
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default IncidentsPage;
