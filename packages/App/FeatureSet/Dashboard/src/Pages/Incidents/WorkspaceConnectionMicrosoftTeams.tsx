import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import MicrosoftTeamsReactionNotesTips from "../../Components/MicrosoftTeams/MicrosoftTeamsReactionNotesTips";
import WorkspaceSummaryTable from "../../Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import PageComponentProps from "../PageComponentProps";
import WorkspaceConnectionGate from "../../Components/Workspace/WorkspaceConnectionGate";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const IncidentsTeamsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "Incidents",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            eventType={NotificationRuleEventType.Incident}
          />
          <MicrosoftTeamsReactionNotesTips
            resourceName="incident"
            supportsPublicNotes={true}
          />
        </>
      ),
    },
    {
      name: "Incident Episodes",
      children: (
        <>
          <WorkspaceNotificationRuleTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            eventType={NotificationRuleEventType.IncidentEpisode}
          />
          <MicrosoftTeamsReactionNotesTips
            resourceName="incident episode"
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
            summaryType={WorkspaceNotificationSummaryType.Incident}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.MicrosoftTeams}
            summaryType={WorkspaceNotificationSummaryType.IncidentEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <WorkspaceConnectionGate workspaceType={WorkspaceType.MicrosoftTeams}>
      <Tabs
        tabs={tabs}
        onTabChange={() => {
          // Tab changed
        }}
      />
    </WorkspaceConnectionGate>
  );
};

export default IncidentsTeamsPage;
