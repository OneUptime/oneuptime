import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import IconProp from "Common/Types/Icon/IconProp";
import WorkspaceConnectionPage from "../../Components/Workspace/WorkspaceConnectionPage"; // Import the new component

const MicrosoftTeamsAlertsConnectionPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <WorkspaceConnectionPage
      workspaceType={WorkspaceType.MicrosoftTeams}
      eventType={NotificationRuleEventType.Alert}
      icon={IconProp.MicrosoftTeams}
      workspaceName="Microsoft Teams"
      eventDisplayName="alert"
      tableTitle="Microsoft Teams Notification Rules for {{eventDisplayName}}s"
      tableDescription="Manage notification rules for when an {{eventDisplayName}} is created, updated, or resolved in {{workspaceName}}."
      descriptionWhenNotConnected="Connect your {{workspaceName}} workspace to receive {{eventDisplayName}} notifications. Please go to Project Settings > Integrations > {{workspaceName}} to connect your workspace."
    />
  );
};

export default MicrosoftTeamsAlertsConnectionPage;
