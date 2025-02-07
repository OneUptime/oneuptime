import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SlackIntegration from "../../Components/Slack/SlackIntegration";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";
import ServiceProviderNotificationRuleTable from "../../Components/ServiceProvider/ServiceProviderNotificationRulesTable";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <div>
      <SlackIntegration />
      <ServiceProviderNotificationRuleTable
        serviceProviderType={ServiceProviderType.Slack}
        eventType={NotificationRuleEventType.Incident}
      />
    </div>
  );
};

export default Settings;
