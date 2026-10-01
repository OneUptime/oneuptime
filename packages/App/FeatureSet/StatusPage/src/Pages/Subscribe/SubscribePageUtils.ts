import PageComponentProps from "../PageComponentProps";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

export interface SubscribePageProps extends PageComponentProps {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  enableMicrosoftTeamsSubscribers: boolean;
  enableWebhookSubscribers: boolean;
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
}

// Where updates go: the email, phone number, workspace or webhook.
export const SUBSCRIBE_DETAILS_STEP_ID: string = "details";

// What they are about: the resources and event types.
export const SUBSCRIBE_PREFERENCES_STEP_ID: string = "preferences";

/*
 * A new subscription's steps: where to send updates, then what to send.
 * Only a page that lets subscribers choose resources or event types asks
 * the second question, and only then is the form long enough to walk -
 * otherwise it is a field or two and a Subscribe button, with no steps.
 */
export const getSubscribeFormSteps: (data: {
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
  translate: (key: string) => string;
}) => Array<FormStep<StatusPageSubscriber>> | undefined = (data: {
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
  translate: (key: string) => string;
}): Array<FormStep<StatusPageSubscriber>> | undefined => {
  if (
    !data.allowSubscribersToChooseResources &&
    !data.allowSubscribersToChooseEventTypes
  ) {
    return undefined;
  }

  return [
    {
      title: data.translate("subscribe.steps.details"),
      id: SUBSCRIBE_DETAILS_STEP_ID,
    },
    {
      title: data.translate("subscribe.steps.preferences"),
      id: SUBSCRIBE_PREFERENCES_STEP_ID,
    },
  ];
};
