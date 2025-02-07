import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SlackIntegration from "../../Components/Slack/SlackIntegration";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";
import ServiceProviderNotificationRuleTable from "../../Components/ServiceProvider/ServiceProviderNotificationRulesTable";

const SlackIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {

  const [isSlackConnected, setIsSlackConnected] = React.useState<boolean>(false);

  return (
    <div>
      <SlackIntegration
        onConnected={() => setIsSlackConnected(true)}
        onDisconnected={() => setIsSlackConnected(false)}
      />
      {isSlackConnected && <ServiceProviderNotificationRuleTable
        serviceProviderType={ServiceProviderType.Slack}
        eventType={NotificationRuleEventType.Incident}
      />}
    </div>
  );
};

export default SlackIntegrationPage;
