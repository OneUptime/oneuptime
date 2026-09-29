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

const MonitorsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isSlackConnected, setIsSlackConnected] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);
      const isSlackConnected: boolean =
        await WorkspaceUtil.isWorkspaceConnected(WorkspaceType.Slack);

      setIsSlackConnected(isSlackConnected);
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

  return (
    <div>
      {isSlackConnected && (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Slack}
          eventType={NotificationRuleEventType.Monitor}
        />
      )}
      {!isSlackConnected && (
        <div>
          <EmptyState
            id="slack-connection"
            icon={IconProp.Slack}
            title="Slack is not connected yet!"
            description="Connect your slack workspace to receive monitor notifications. Please go to Project Settings > Workspace Connections > Slack to connect your workspace."
          />
        </div>
      )}
    </div>
  );
};

export default MonitorsPage;
