import PageComponentProps from "../PageComponentProps";

export interface SubscribePageProps extends PageComponentProps {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
}
