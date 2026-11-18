/*
 * In a module of its own, with no React: the paging ladder's words
 * (ProjectPagingDefaultsWords, PagingLadderMethods) read it, and so do the
 * App's own tests of those words, which compile without the Dashboard's
 * React (Compile's compile-services). It lived in OnCallRulesTable, and
 * importing it from there brought the table and every control it draws in.
 */
/*
 * One pickable notification method, described WITHOUT its underlying row.
 *
 * This is the whole of what the create form needs in order to point a rule at a
 * method: something to render, and the foreign key to submit. It deliberately
 * carries no address, no phone number, no webhook url and no device token —
 * `maskedIdentifier` is already masked by the only code that can mask it
 * (OnCallReadinessService), and nothing here can un-mask it.
 *
 * ReadinessMethodWire satisfies this shape apart from `methodId` being optional
 * there, which is the one difference worth having: a caller has to state that it
 * HAS an id before it can hand a method over, so a method the server could not
 * address is dropped at the call site rather than becoming a dropdown entry that
 * submits nothing and is refused.
 */
export interface NotificationMethodChoice {
  /* One of the eleven channel names: Email, SMS, Call, Push, WhatsApp, Telegram, Slack, Microsoft Teams, Mattermost, Webhook, Custom Channel. */
  methodType: string;
  /* The method row's own id — UserSMS._id and so on — as a plain uuid string. */
  methodId: string;
  /* Already masked. "+1 ••• ••• 4821", never the number. */
  maskedIdentifier: string;
  isVerified: boolean;
}
