import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  getSubscriberChannel,
  getSubscriberChannelNote,
  SubscriberChannelDefinition,
} from "./SubscriberChannelsCopy";
import StatusPageSwitchRow, {
  getSubscriptionSwitchTestId,
} from "./StatusPageSwitchRow";

/*
 * At the top of a channel's subscriber list (Email Subscribers, SMS
 * Subscribers, ...) while that channel is off for the status page: the
 * channel's own switch, in a quiet panel, where a red "X subscribers are not
 * enabled for this status page. Please enable it in Subscriber Settings"
 * banner used to be. Four of the five channels start off, so that banner was
 * on four of the five lists of every new status page - an error's colour for
 * the state every page starts in, and a pointer to another page for a
 * one-press fix.
 *
 * It says what off means - visitors cannot sign up this way, and the
 * subscribers the team adds below still get updates - and turns the channel
 * on right here, the same switch as the Channels card on Subscriber
 * Settings (permissions, plans and refusals included).
 *
 * Nothing is drawn while the channel is on. Turned on from here, the panel
 * stays until the page is left, saying it is on, so the press shows its
 * result and can be taken back.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  method: StatusPageSubscriberNotificationMethod;
  // Whether the channel was on when the list loaded.
  isEnabled: boolean;
}

export const SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID: string =
  "subscriber-channel-off-panel";

const SubscriberChannelOffPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isChangedHere, setIsChangedHere] = useState<boolean>(false);

  if (props.isEnabled && !isChangedHere) {
    return <></>;
  }

  const channel: SubscriberChannelDefinition = getSubscriberChannel(
    props.method,
  );

  return (
    <div
      className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 md:px-6"
      data-testid={SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID}
    >
      <StatusPageSwitchRow
        statusPageId={props.statusPageId}
        column={channel.column}
        initialValue={props.isEnabled}
        title={channel.listSwitchTitle}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? channel.listSwitchOnDescription
            : channel.listSwitchOffDescription;
        }}
        note={getSubscriberChannelNote(channel.method, {
          isBillingEnabled: BILLING_ENABLED,
        })}
        onSaved={() => {
          setIsChangedHere(true);
        }}
        dataTestId={getSubscriptionSwitchTestId(channel.column)}
      />
    </div>
  );
};

export default SubscriberChannelOffPanel;
