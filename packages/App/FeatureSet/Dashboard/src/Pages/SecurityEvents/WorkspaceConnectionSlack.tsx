import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

/*
 * Security Events > Workspace > Slack: the rules that post security cases to
 * the project's Slack channels - when a case opens or rises to a higher
 * priority, is assigned, or has a playbook step waiting for approval. A case
 * gets no channel of its own, so each rule names the channels it posts in.
 */
const SecurityEventsWorkspaceConnectionSlack: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Slack}
      eventTypes={[NotificationRuleEventType.SecurityCase]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Slack}
          eventType={NotificationRuleEventType.SecurityCase}
        />
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default SecurityEventsWorkspaceConnectionSlack;
