import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SlackIntegration from "../../Components/Slack/SlackIntegration";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRuleTable from "../../Components/Workspace/WorkspaceNotificationRulesTable";

const SlackIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [isSlackConnected, setIsSlackConnected] =
    React.useState<boolean>(false);

  return (
    <div>
      <SlackIntegration
        onConnected={() => {
          return setIsSlackConnected(true);
        }}
        onDisconnected={() => {
          return setIsSlackConnected(false);
        }}
      />
      {isSlackConnected && (
        <WorkspaceNotificationRuleTable
          workspaceType={WorkspaceType.Slack}
          eventType={NotificationRuleEventType.Incident}
        />
      )}
    </div>
  );
};

export default SlackIntegrationPage;
