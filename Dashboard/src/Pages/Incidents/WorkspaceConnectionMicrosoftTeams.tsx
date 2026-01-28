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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

const IncidentsTeamsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isMicrosoftTeamsConnected, setIsMicrosoftTeamsConnected] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
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

  const tabs: Array<Tab> = [
    {
      name: "Incidents",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.MicrosoftTeams}
          eventType={NotificationRuleEventType.Incident}
        />
      ),
    },
    {
      name: "Incident Episodes",
      children: (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.MicrosoftTeams}
          eventType={NotificationRuleEventType.IncidentEpisode}
        />
      ),
    },
  ];

  return (
    <div>
      {isMicrosoftTeamsConnected && (
        <Tabs
          tabs={tabs}
          onTabChange={() => {
            // Tab changed
          }}
        />
      )}
      {!isMicrosoftTeamsConnected && (
        <div>
          <EmptyState
            id="MicrosoftTeams-connection"
            icon={IconProp.MicrosoftTeams}
            title="Microsoft Teams is not connected yet!"
            description="Connect your Microsoft Teams workspace to receive incident notifications. Please go to Project Settings > Workspace Connections > Microsoft Teams to connect your workspace."
          />
        </div>
      )}
    </div>
  );
};

export default IncidentsTeamsPage;
