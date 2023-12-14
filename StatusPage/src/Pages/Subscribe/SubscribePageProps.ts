import PageComponentProps from "../PageComponentProps";

export default interface SubscribePageProps extends PageComponentProps {
    enableEmailSubscribers: boolean;
    enableSMSSubscribers: boolean;
}