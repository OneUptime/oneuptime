import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import { SECURITY_EVENTS_WORKSPACE_EVENT_TYPES } from "../../Utils/SecurityEventsNavigation";

/*
 * Security Events > Workspace > Slack: the rules that post to the project's
 * Slack channels, a card for each kind, one under the other -
 *
 *   - Security Case Rules: security cases, when a case opens or rises to a
 *     higher priority, is assigned, or has a playbook step waiting for
 *     approval;
 *   - Hunt Rules: what hunts find, each time a scheduled run of a hunt
 *     finds security events.
 *
 * Neither a case nor a hunt gets a channel of its own, so each rule names
 * the channels it posts in. Both are in sight at once, not behind tabs: a
 * team that sets up one finds the other.
 */
const SecurityEventsWorkspaceConnectionSlack: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Slack}
      eventTypes={[
        NotificationRuleEventType.SecurityCase,
        NotificationRuleEventType.SecurityHunt,
      ]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
        <div className="space-y-6">
          {SECURITY_EVENTS_WORKSPACE_EVENT_TYPES.map(
            (eventType: NotificationRuleEventType): ReactElement => {
              return (
                <WorkspaceNotificationRuleTable
                  key={eventType}
                  workspaceType={WorkspaceType.Slack}
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

export default SecurityEventsWorkspaceConnectionSlack;
