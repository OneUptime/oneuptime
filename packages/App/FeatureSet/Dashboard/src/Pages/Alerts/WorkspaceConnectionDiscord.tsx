import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";
import WorkspaceSummaryTable from "../../Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const AlertsDiscordPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isDiscordConnected, setIsDiscordConnected] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);
      const isDiscordConnected: boolean =
        await WorkspaceUtil.isWorkspaceConnected(WorkspaceType.Discord);

      setIsDiscordConnected(isDiscordConnected);
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

  const tabs: Array<Tab> = [
    {
      name: "Alerts",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Discord}
          eventType={NotificationRuleEventType.Alert}
        />
      ),
    },
    {
      name: "Alert Episodes",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Discord}
          eventType={NotificationRuleEventType.AlertEpisode}
        />
      ),
    },

    {
      name: "Summary",
      children: (
        <>
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Discord}
            summaryType={WorkspaceNotificationSummaryType.Alert}
          />
          <WorkspaceSummaryTable
            workspaceType={WorkspaceType.Discord}
            summaryType={WorkspaceNotificationSummaryType.AlertEpisode}
          />
        </>
      ),
    },
  ];

  return (
    <div>
      {isDiscordConnected && (
        <Tabs
          tabs={tabs}
          onTabChange={() => {
            // Tab changed
          }}
        />
      )}
      {!isDiscordConnected && (
        <div>
          <EmptyState
            id="Discord-connection"
            icon={IconProp.Hashtag}
            title="Discord is not connected yet!"
            description="Connect your Discord server to receive alert notifications. Please go to Project Settings > Workspace Connections > Discord to connect your server."
          />
        </div>
      )}
    </div>
  );
};

export default AlertsDiscordPage;
