import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import useBulkSwitchActions, {
  UNSUBSCRIBE_SWITCH_ACTION,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";

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
 * The lists name their rows Subscriber(s), as their buttons and dialogs do.
 */
const useSubscriberBulkActions: () => Array<
  BulkActionButtonSchema<StatusPageSubscriber>
> = (): Array<BulkActionButtonSchema<StatusPageSubscriber>> => {
  return useBulkSwitchActions<StatusPageSubscriber>({
    modelType: StatusPageSubscriber,
    column: "isUnsubscribed",
    actions: [UNSUBSCRIBE_SWITCH_ACTION],
    singularName: "Subscriber",
    pluralName: "Subscribers",
  });
};

export default useSubscriberBulkActions;
