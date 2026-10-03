import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import WorkspaceSummaryTable from "../../Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "Incidents",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.Slack}
            eventType={NotificationRuleEventType.Incident}
          />
          <Card
            title="Tips: Using Emoji Reactions"
            description="You can use emoji reactions in Slack to quickly save messages as notes to incidents."
          >
            <MarkdownViewer
              text={`
- 📌 **Pin emoji** (pushpin, round_pushpin) - React with a pin emoji to save the message as a **private note** (visible only to your team).
- **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as the pin emoji.
- 📢 **Megaphone emoji** (mega, loudspeaker, megaphone) - React with a megaphone emoji to save the message as a **public note** (visible on the status page).

When you react with one of these emojis, OneUptime will automatically save the message content as a note to the incident linked to that channel and confirm with a reply in the thread.
              `}
            />
          </Card>
        </>
      ),
    },
    {
      name: "Incident Episodes",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.Slack}
            eventType={NotificationRuleEventType.IncidentEpisode}
          />
          <Card
            title="Tips: Using Emoji Reactions"
            description="You can use emoji reactions in Slack to quickly save messages as notes to incident episodes."
          >
            <MarkdownViewer
              text={`
- 📌 **Pin emoji** (pushpin, round_pushpin) - React with a pin emoji to save the message as a **private note** (visible only to your team).
- **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as the pin emoji.

When you react with a pin emoji, OneUptime will automatically save the message content as a private note to the incident episode linked to that channel and confirm with a reply in the thread.
              `}
            />
          </Card>
        </>
      ),
    },
    {
      name: "Summary",
      children: (
        <>
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Slack}
            summaryType={WorkspaceNotificationSummaryType.Incident}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Slack}
            summaryType={WorkspaceNotificationSummaryType.IncidentEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
      <Tabs
        tabs={tabs}
        onTabChange={() => {
          // Tab changed
        }}
      />
    </WorkspaceConnectionGate>
  );
};

export default IncidentsPage;
