import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The dashboard's text about subscribers unsubscribing themselves: the
 * 'Unsubscribed At' column and filter on the five subscriber lists, the
 * advice about adding a shared address as one subscriber, and the notice of
 * subscribers the team added that have since unsubscribed.
 *
 * Why it matters: every notification carries an unsubscribe link that works
 * without signing in (Common/Types/StatusPage/StatusPageSubscriberUnsubscribe),
 * so anyone who can read a mailbox can unsubscribe it - including a shared
 * one such as a site's mailing list, which then drops the whole site off the
 * page. The team is emailed when that happens
 * (StatusPageSubscriberUnsubscribeNotice); these make it visible on the
 * dashboard too.
 *
 * Kept in one React-free module so the pages render these exact strings and
 * App/Tests can check that every one has an entry in all seventeen Dashboard
 * locale files - the dashboard translates a string by looking up its English
 * text, so a string with no entry silently stays English. Strings with
 * {{placeholders}} are filled in after the lookup (formatScopeText).
 */

export const SubscriberUnsubscribeCopy: {
  unsubscribedAtTitle: string;
  sharedAddressAdvice: string;
  recentlyUnsubscribedTitle: string;
  recentlyUnsubscribedDescription: string;
  recentlyUnsubscribedItem: string;
  recentlyUnsubscribedMore: string;
} = {
  unsubscribedAtTitle: "Unsubscribed At",
  /*
   * One sentence in the email fields' description (one subscriber, and Add
   * in Bulk). It was a three-sentence warning box under the field, there on
   * every visit whatever was typed; the email to the page's owners when a
   * subscriber the team added unsubscribes, and the notice above the list,
   * are unchanged.
   */
  sharedAddressAdvice: translationKey(
    "Use people's own addresses where you can: anyone who reads a shared address, such as a mailing list, can unsubscribe it for everyone.",
  ),
  recentlyUnsubscribedTitle: "Subscribers your team added have unsubscribed",
  recentlyUnsubscribedDescription:
    "These subscribers were added by your team and unsubscribed in the last 30 days, so they no longer receive this status page's notifications. If one was a shared address, such as a mailing list, make sure the people who still need these notifications are subscribed.",
  recentlyUnsubscribedItem: "{{contact}}, unsubscribed {{date}}",
  recentlyUnsubscribedMore:
    "{{count}} more. Filter the list by Unsubscribed At to see them all.",
};

/*
 * How far back the notice looks. Long enough to still be on screen the next
 * time someone opens the list, short enough not to nag about old changes.
 */
export const RECENTLY_UNSUBSCRIBED_WINDOW_IN_DAYS: number = 30;

// How many subscribers the notice names before it summarises the rest.
export const RECENTLY_UNSUBSCRIBED_LIST_LIMIT: number = 10;

export default SubscriberUnsubscribeCopy;
