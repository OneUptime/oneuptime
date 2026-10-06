import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import MicrosoftTeamsReactionNotesTips from "../../Components/MicrosoftTeams/MicrosoftTeamsReactionNotesTips";
import WorkspaceSummaryTable from "../../Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import WorkspacePlanLeftoverGate from "../../Components/Workspace/WorkspacePlanLeftoverGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const AlertsTeamsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "Alerts",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            eventType={NotificationRuleEventType.Alert}
          />
          <MicrosoftTeamsReactionNotesTips
            resourceName="alert"
            supportsPublicNotes={false}
          />
        </>
      ),
    },
    {
      name: "Alert Episodes",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            eventType={NotificationRuleEventType.AlertEpisode}
          />
          <MicrosoftTeamsReactionNotesTips
            resourceName="alert episode"
            supportsPublicNotes={false}
          />
        </>
      ),
    },
    {
      name: "Summary",
      children: (
        <>
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            summaryType={WorkspaceNotificationSummaryType.Alert}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            summaryType={WorkspaceNotificationSummaryType.AlertEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.MicrosoftTeams}
      eventTypes={[NotificationRuleEventType.Alert, NotificationRuleEventType.AlertEpisode]}
      summaryTypes={[WorkspaceNotificationSummaryType.Alert, WorkspaceNotificationSummaryType.AlertEpisode]}
    >
      <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
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

export default AlertsTeamsPage;
