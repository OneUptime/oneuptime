import SubscriberNotificationStatus from "../StatusPageSubscribers/SubscriberNotificationStatus";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status?: StatusPageSubscriberNotificationStatus | undefined | null;
  message?: string | undefined | null;
  onResendNotification: () => void;
}

/*
 * Under a state change on an incident's or a scheduled maintenance event's
 * status timeline: whether the status page subscribers were told of it,
 * with its message and Retry - what the table's Subscriber Notification
 * Status column showed, named here since there is no column header to name
 * it.
 */
const StateTimelineSubscriberNotification: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="state-timeline-subscriber-notification"
    >
      <span className="text-xs font-medium text-gray-500">
        {translator.translateText("Status page subscribers:")}
      </span>
      <SubscriberNotificationStatus
        status={props.status}
        subscriberNotificationStatusMessage={props.message}
        onResendNotification={() => {
          props.onResendNotification();
        }}
      />
    </div>
  );
};

export default StateTimelineSubscriberNotification;
