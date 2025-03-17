import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceUtil from "../../Utils/Workspace/Workspace";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ComingSoon from "Common/UI/Components/ComingSoon/ComingSoon";

const MonitorsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isMicrosoftTeamsConnected, setIsMicrosoftTeamsConnected] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const [showComingSoon, setShowComingSoon] = React.useState<boolean>(false);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    setShowComingSoon(true);
    try {
      setError(null);
      setIsLoading(true);
      const isMicrosoftTeamsConnected: boolean =
        await WorkspaceUtil.isWorkspaceConnected(WorkspaceType.MicrosoftTeams);

      setIsMicrosoftTeamsConnected(isMicrosoftTeamsConnected);
      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
      setError(API.getFriendlyErrorMessage(error as Exception));
    }
  };

  React.useEffect(() => {
    loadItems().catch(() => {
      // Do nothing
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (showComingSoon) {
    return (
      <ComingSoon
        title="Microsoft Teams Integration is coming soon, but you can still integrate Teams with Workflows!"
        description="We are working hard to bring you the Microsoft Teams integration. In the meantime, you can still integrate with Workflows to receive monitors in Microsoft Teams. Please click on Workflows in the top navigation to get started."
      />
    );
  }

  return (
    <div>
      {isMicrosoftTeamsConnected && (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.MicrosoftTeams}
          eventType={NotificationRuleEventType.Monitor}
        />
      )}
      {!isMicrosoftTeamsConnected && (
        <div>
          <EmptyState
            id="MicrosoftTeams-connection"
            icon={IconProp.MicrosoftTeams}
            title="MicrosoftTeams is not connected yet!"
            description="Connect your Microsoft Teams workspace to receive alert notifications. Please go to Project Settings > Workspace Connections > Microsoft Teams to connect your workspace."
          />
        </div>
      )}
    </div>
  );
};

export default MonitorsPage;
