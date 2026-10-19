import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";
import {
  SubscriberFormCopy,
  SubscriberTableStatus,
  getSubscriberTableStatus,
} from "./SubscriberFormChoices";

/*
 * The Status of an email or SMS subscriber, as its table shows it
 * (getSubscriberTableStatus): Subscribed, Awaiting Confirmation - with how
 * the link reaches them - while the link we sent them works, Link Expired
 * once it has run out, or Unsubscribed.
 */
export interface ComponentProps {
  subscriber: StatusPageSubscriber;
  // How the link to confirm reaches them: emailed, or texted.
  awaitingConfirmationDescription: string;
}

const SubscriberStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const status: SubscriberTableStatus = getSubscriberTableStatus(
    props.subscriber as unknown as Record<string, unknown>,
  );

  if (status === SubscriberTableStatus.Unsubscribed) {
    return <Pill color={Red} text={"Unsubscribed"} />;
  }

  if (status === SubscriberTableStatus.LinkExpired) {
    return (
      <Pill
        color={Gray500}
        text={SubscriberFormCopy.linkExpiredTitle}
        tooltip={SubscriberFormCopy.linkExpiredDescription}
      />
    );
  }

  if (status === SubscriberTableStatus.AwaitingConfirmation) {
    return (
      <Pill
        color={Yellow}
        text={"Awaiting Confirmation"}
        tooltip={props.awaitingConfirmationDescription}
      />
    );
  }

  return <Pill color={Green} text={"Subscribed"} />;
};

export default SubscriberStatusPill;
