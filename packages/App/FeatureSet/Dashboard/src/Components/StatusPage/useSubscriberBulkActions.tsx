import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import useBulkSwitchActions, {
  BulkSwitchActionsConfig,
  UNSUBSCRIBE_SWITCH_ACTION,
  useSwitchActions,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";

/*
 * What a subscriber is called wherever a list names one - the Unsubscribe
 * and Delete questions, the rows a bulk result lists - by what its list
 * shows first: the address, the phone number, the Slack or Microsoft Teams
 * workspace, or the webhook URL. Only email addresses and phone numbers are
 * names a record is otherwise known by, so on the Slack, Teams and webhook
 * lists every row read "Subscriber" alike. Empty when the row carries none
 * of them.
 */
export const getSubscriberName: (subscriber: StatusPageSubscriber) => string = (
  subscriber: StatusPageSubscriber,
): string => {
  const candidates: Array<{ toString: () => string } | string | undefined> = [
    subscriber.subscriberEmail,
    subscriber.subscriberPhone,
    subscriber.slackWorkspaceName,
    subscriber.microsoftTeamsWorkspaceName,
    subscriber.subscriberWebhook,
  ];

  for (const candidate of candidates) {
    const name: string = candidate ? candidate.toString().trim() : "";

    if (name) {
      return name;
    }
  }

  return "";
};

/*
 * Bulk Actions of a status page's five subscriber lists (email, SMS, Slack,
 * Microsoft Teams, webhook), besides Delete.
 *
 * Unsubscribe: subscribers are managed in numbers - added in bulk, imported,
 * a customer's whole team at once - and cleaning a list up meant deleting
 * rows, which loses who they were and when they subscribed. Unsubscribing
 * keeps the row (Status: Unsubscribed, with its Unsubscribed At) and sends it
 * nothing more, exactly as each subscriber's Edit form does, one update per
 * subscriber, so the server's rules for a subscription apply to each.
 *
 * Subscribing people again stays one at a time, on the Edit form: many
 * unsubscribed themselves, and in bulk it would send updates to people who
 * asked for them to stop (UNSUBSCRIBE_SWITCH_ACTION).
 *
 * The lists name their rows Subscriber(s), as their buttons and dialogs do,
 * and each row by getSubscriberName.
 */
const SUBSCRIBER_SWITCH: BulkSwitchActionsConfig<StatusPageSubscriber> = {
  modelType: StatusPageSubscriber,
  column: "isUnsubscribed",
  actions: [UNSUBSCRIBE_SWITCH_ACTION],
  singularName: "Subscriber",
  pluralName: "Subscribers",
  getItemName: getSubscriberName,
};

const useSubscriberBulkActions: () => Array<
  BulkActionButtonSchema<StatusPageSubscriber>
> = (): Array<BulkActionButtonSchema<StatusPageSubscriber>> => {
  return useBulkSwitchActions<StatusPageSubscriber>(SUBSCRIBER_SWITCH);
};

/*
 * Unsubscribe in each row's ⋯ menu as well, on a subscriber still
 * subscribed: the same switch, asking first with the same sentence, the
 * row named as the list names it.
 */
export const useSubscriberRowActions: () => Array<
  ActionButtonSchema<StatusPageSubscriber>
> = (): Array<ActionButtonSchema<StatusPageSubscriber>> => {
  return useSwitchActions<StatusPageSubscriber>(SUBSCRIBER_SWITCH).rowActions;
};

export default useSubscriberBulkActions;
