import ServiceProviderNotificationRule from "Common/Models/DatabaseModels/ServiceProviderNotificationRule";
import BaseNotificationRule from "Common/Types/ServiceProvider/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";

export interface ComponentProps {
    initialValue?: undefined | BaseNotificationRule;
    onChange?: undefined | ((value: BaseNotificationRule) => void);
    serviceProviderType: ServiceProviderType;
    eventType: NotificationRuleEventType;
  }
  
  const NotificaitonRuleForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
  ): ReactElement => {
  }


  export default NotificaitonRuleForm;