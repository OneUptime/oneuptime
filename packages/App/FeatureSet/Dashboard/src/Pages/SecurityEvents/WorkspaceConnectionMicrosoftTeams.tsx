import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import { SECURITY_EVENTS_WORKSPACE_EVENT_TYPES } from "../../Utils/SecurityEventsNavigation";

/*
 * Security Events > Workspace > Microsoft Teams: the rules that post to the
 * project's Microsoft Teams channels and chats, a card for each kind, one
 * under the other, as the Slack page lays them out - security cases, and
 * what hunts find. Neither a case nor a hunt gets a channel of its own, so
 * each rule names the channels or chats it posts in.
 */
const SecurityEventsWorkspaceConnectionMicrosoftTeams: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.MicrosoftTeams}
      eventTypes={[...SECURITY_EVENTS_WORKSPACE_EVENT_TYPES]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
        <div className="space-y-6">
          {SECURITY_EVENTS_WORKSPACE_EVENT_TYPES.map(
            (eventType: NotificationRuleEventType): ReactElement => {
              return (
                <WorkspaceNotificationRuleTable
                  key={eventType}
                  workspaceType={WorkspaceType.MicrosoftTeams}
                  eventType={eventType}
                />
              );
            },
          )}
        </div>
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default SecurityEventsWorkspaceConnectionMicrosoftTeams;
