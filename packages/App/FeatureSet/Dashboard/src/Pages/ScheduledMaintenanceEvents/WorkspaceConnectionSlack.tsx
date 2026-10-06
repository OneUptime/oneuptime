import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";

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
          <Card
            title="Tips: Using Emoji Reactions"
            description="You can use emoji reactions in Slack to quickly save messages as notes to scheduled maintenance events."
          >
            <MarkdownViewer
              text={`
  - 📌 **Pin emoji** (pushpin, round_pushpin) - React with a pin emoji to save the message as a **private note** (visible only to your team).
  - **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as the pin emoji.
  - 📢 **Megaphone emoji** (mega, loudspeaker, megaphone) - React with a megaphone emoji to save the message as a **public note** (visible on the status page).

  When you react with one of these emojis, OneUptime will automatically save the message content as a note to the scheduled maintenance event linked to that channel and confirm with a reply in the thread.
              `}
            />
          </Card>
        </>
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default IncidentsPage;
