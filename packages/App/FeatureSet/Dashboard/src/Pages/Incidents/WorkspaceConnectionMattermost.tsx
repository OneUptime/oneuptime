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

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "Incidents",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Mattermost}
          eventType={NotificationRuleEventType.Incident}
        />
      ),
    },
    {
      name: "Incident Episodes",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Mattermost}
          eventType={NotificationRuleEventType.IncidentEpisode}
        />
      ),
    },
    {
      name: "Summary",
      children: (
        <>
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Mattermost}
            summaryType={WorkspaceNotificationSummaryType.Incident}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Mattermost}
            summaryType={WorkspaceNotificationSummaryType.IncidentEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <WorkspacePlanLeftoverGate
      workspaceType={WorkspaceType.Mattermost}
      eventTypes={[
        NotificationRuleEventType.Incident,
        NotificationRuleEventType.IncidentEpisode,
      ]}
      summaryTypes={[
        WorkspaceNotificationSummaryType.Incident,
        WorkspaceNotificationSummaryType.IncidentEpisode,
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

export default IncidentsPage;
