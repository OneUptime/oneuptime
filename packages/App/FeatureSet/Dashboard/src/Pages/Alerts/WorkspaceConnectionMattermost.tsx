import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import WorkspaceSummaryTable from "../../Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const AlertsMattermostPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "Alerts",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Mattermost}
          eventType={NotificationRuleEventType.Alert}
        />
      ),
    },
    {
      name: "Alert Episodes",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Mattermost}
          eventType={NotificationRuleEventType.AlertEpisode}
        />
      ),
    },
    {
      name: "Summary",
      children: (
        <>
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Mattermost}
            summaryType={WorkspaceNotificationSummaryType.Alert}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Mattermost}
            summaryType={WorkspaceNotificationSummaryType.AlertEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Mattermost}
      eventTypes={[
        NotificationRuleEventType.Alert,
        NotificationRuleEventType.AlertEpisode,
      ]}
      summaryTypes={[
        WorkspaceNotificationSummaryType.Alert,
        WorkspaceNotificationSummaryType.AlertEpisode,
      ]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.Mattermost}>
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

export default AlertsMattermostPage;
