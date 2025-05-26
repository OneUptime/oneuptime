import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import IconProp from "Common/Types/Icon/IconProp";
import WorkspaceConnectionPage from "../../Components/Workspace/WorkspaceConnectionPage"; // Import the new component

const SlackScheduledMaintenanceConnectionPage: FunctionComponent< // Renamed component
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspaceConnectionPage
      workspaceType={WorkspaceType.Slack}
      eventType={NotificationRuleEventType.ScheduledMaintenance} // Using the existing enum value from the original file
      icon={IconProp.Slack}
      workspaceName="Slack"
      eventDisplayName="scheduled maintenance event"
      tableTitle="Slack Notification Rules for {{eventDisplayName}}s"
      tableDescription="Manage notification rules for when a {{eventDisplayName}} is created, its state changes, or notes are added in {{workspaceName}}."
      descriptionWhenNotConnected="Connect your {{workspaceName}} workspace to receive {{eventDisplayName}} notifications. Please go to Project Settings > Integrations > {{workspaceName}} to connect your workspace."
    />
  );
};

export default SlackScheduledMaintenanceConnectionPage;
