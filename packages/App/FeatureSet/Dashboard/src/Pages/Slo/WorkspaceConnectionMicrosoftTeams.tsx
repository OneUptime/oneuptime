import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

/*
 * SLOs > Workspace > Microsoft Teams: the rules that post the project's
 * SLOs' error budget policy changes to Microsoft Teams - when an SLO enters
 * a tier, recovers to a less severe one or leaves every tier, and when its
 * deployments are frozen or allowed again (SloWorkspaceNotifications). An
 * SLO gets no channel of its own, so each rule names the channels and chats
 * it posts in.
 */
const SloWorkspaceConnectionMicrosoftTeams: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.MicrosoftTeams}
      eventTypes={[NotificationRuleEventType.ServiceLevelObjective]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.MicrosoftTeams}
          eventType={NotificationRuleEventType.ServiceLevelObjective}
        />
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default SloWorkspaceConnectionMicrosoftTeams;
