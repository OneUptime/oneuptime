import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import MicrosoftTeamsReactionNotesTips from "../../Components/MicrosoftTeams/MicrosoftTeamsReactionNotesTips";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
      <>
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.MicrosoftTeams}
          eventType={NotificationRuleEventType.ScheduledMaintenance}
        />
        <MicrosoftTeamsReactionNotesTips
          resourceName="scheduled maintenance event"
          supportsPublicNotes={true}
        />
      </>
    </WorkspaceConnectionGate>
  );
};

export default IncidentsPage;
