import PageComponentProps from '../PageComponentProps';

export interface SubscribePageProps extends PageComponentProps {
    enableEmailSubscribers: boolean;
    enableSMSSubscribers: boolean;
    allowSubscribersToChooseResources: boolean;
}
