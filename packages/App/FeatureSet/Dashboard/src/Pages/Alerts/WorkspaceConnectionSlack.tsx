import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import WorkspaceSummaryTable from "../../Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const AlertsSlackPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "Alerts",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.Slack}
            eventType={NotificationRuleEventType.Alert}
          />
          <Card
            title="Tips: Using Emoji Reactions"
            description="You can use emoji reactions in Slack to quickly save messages as notes to alerts."
          >
            <MarkdownViewer
              text={`
- 📌 **Pin emoji** (pushpin, round_pushpin) - React with a pin emoji to save the message as a **private note** (visible only to your team).
- **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as the pin emoji.

When you react with a pin emoji, OneUptime will automatically save the message content as a private note to the alert linked to that channel and confirm with a reply in the thread.
              `}
            />
          </Card>
        </>
      ),
    },
    {
      name: "Alert Episodes",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.Slack}
            eventType={NotificationRuleEventType.AlertEpisode}
          />
          <Card
            title="Tips: Using Emoji Reactions"
            description="You can use emoji reactions in Slack to quickly save messages as notes to alert episodes."
          >
            <MarkdownViewer
              text={`
- 📌 **Pin emoji** (pushpin, round_pushpin) - React with a pin emoji to save the message as a **private note** (visible only to your team).
- **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as the pin emoji.

When you react with a pin emoji, OneUptime will automatically save the message content as a private note to the alert episode linked to that channel and confirm with a reply in the thread.
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
            summaryType={WorkspaceNotificationSummaryType.Alert}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Slack}
            summaryType={WorkspaceNotificationSummaryType.AlertEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Slack}
      eventTypes={[
        NotificationRuleEventType.Alert,
        NotificationRuleEventType.AlertEpisode,
      ]}
      summaryTypes={[
        WorkspaceNotificationSummaryType.Alert,
        WorkspaceNotificationSummaryType.AlertEpisode,
      ]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.Slack}>
        <Tabs
          tabs={tabs}
          onTabChange={() => {
            // Tab changed
          }}
        />
      </WorkspaceConnectionGate>
    </WorkspacePlanLeftoverGate>
  );
};

export default AlertsSlackPage;
