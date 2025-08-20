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

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isTeamsConnected, setIsTeamsConnected] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);
      const isTeamsConnected: boolean =
        await WorkspaceUtil.isWorkspaceConnected(WorkspaceType.MicrosoftTeams);

      setIsTeamsConnected(isTeamsConnected);
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

  if (!isTeamsConnected) {
    return (
      <EmptyState
        id="incident-workspace-teams-empty-state"
        icon={IconProp.Slack}
        title={"Microsoft Teams is not connected to this OneUptime project"}
        description={
          "To connect Microsoft Teams to this OneUptime project, please go to Settings > Microsoft Teams Integration and connect your Teams workspace."
        }
      />
    );
  }

  return (
    <WorkspaceNotificationRuleTable
      workspaceType={WorkspaceType.MicrosoftTeams}
      notificationRuleEventType={NotificationRuleEventType.IncidentCreated}
    />
  );
};

export default IncidentsPage;