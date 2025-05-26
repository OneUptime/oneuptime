import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import IconProp from "Common/Types/Icon/IconProp";
import WorkspaceConnectionPage from "../../Components/Workspace/WorkspaceConnectionPage"; // Import the new component

const MicrosoftTeamsScheduledMaintenanceConnectionPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspaceConnectionPage
      workspaceType={WorkspaceType.MicrosoftTeams}
      eventType={NotificationRuleEventType.ScheduledMaintenance} // Using the existing enum value
      icon={IconProp.MicrosoftTeams}
      workspaceName="Microsoft Teams"
      eventDisplayName="scheduled maintenance event"
      tableTitle="Microsoft Teams Notification Rules for {{eventDisplayName}}s"
      tableDescription="Manage notification rules for when a {{eventDisplayName}} is created, its state changes, or notes are added in {{workspaceName}}."
      descriptionWhenNotConnected="Connect your {{workspaceName}} workspace to receive {{eventDisplayName}} notifications. Please go to Project Settings > Integrations > {{workspaceName}} to connect your workspace."
    />
  );
};

export default MicrosoftTeamsScheduledMaintenanceConnectionPage;
