/*
 * WHAT AN ON-CALL LINK SAYS WHEN IT OPENS NO PAGE (#11056).
 *
 * The links in an on-call page's email, SMS, push and call - Acknowledge,
 * "Can't take it? Escalate" and a call's keypad - open pages that name
 * their notification in the address. A link with no notification in it, or
 * one cut short (a mail client that broke a long line, a copy that lost its
 * end), answered "Item ID is required"; one whose notification is not
 * there answered "Invalid item Id". A responder opens these at night, from
 * a phone, and neither said what happened or what to do.
 *
 * Each now says it in a sentence, with what to do next: open the link in the
 * newest message, as a link that cannot act on its page says already
 * (OnCallAcknowledgePage). A notification that is not there reads the same
 * whatever the reason - removed, or an address no notification ever had -
 * so the answer says nothing more about an id than it did. The pages are in
 * English, as the acknowledge pages are (Common/Server/Locales: only the
 * messages themselves are in the person's language).
 */

// The heading over a link with no notification in it, or one cut short.
export const ON_CALL_LINK_INCOMPLETE_TITLE: string =
  "This link is not complete";

export const ON_CALL_LINK_INCOMPLETE_MESSAGE: string =
  "This link is not complete: part of it is missing. Use the link in the newest message you were paged with.";

// The heading over a link whose notification is not there.
export const ON_CALL_LINK_PAGE_NOT_AVAILABLE_TITLE: string =
  "This page is not available";

export const ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE: string =
  "This page is not available: it was removed, or the link is not right. Use the link in the newest message you were paged with, or open OneUptime to see what is paging you.";

// The button under it, to OneUptime itself.
export const ON_CALL_LINK_OPEN_ONEUPTIME_LABEL: string = "Open OneUptime";

/*
 * A page acknowledged from its link whose notification names no record to
 * open - none, or one deleted since it paged: acknowledged, with nothing to
 * open. It answered "Invalid item Id" after acknowledging the page.
 */
export const ON_CALL_LINK_ACKNOWLEDGED_TITLE: string = "Acknowledged";

export const ON_CALL_LINK_ACKNOWLEDGED_MESSAGE: string =
  "You acknowledged this page. There is no record to open for it.";

export enum OnCallLinkRefusal {
  // No notification in the link, or one cut short.
  Incomplete = "incomplete",
  // A notification that is not there.
  NotAvailable = "not-available",
}

// A refusal's heading and sentence.
export const getOnCallLinkRefusalWords: (refusal: OnCallLinkRefusal) => {
  title: string;
  message: string;
} = (refusal: OnCallLinkRefusal): { title: string; message: string } => {
  if (refusal === OnCallLinkRefusal.Incomplete) {
    return {
      title: ON_CALL_LINK_INCOMPLETE_TITLE,
      message: ON_CALL_LINK_INCOMPLETE_MESSAGE,
    };
  }

  return {
    title: ON_CALL_LINK_PAGE_NOT_AVAILABLE_TITLE,
    message: ON_CALL_LINK_PAGE_NOT_AVAILABLE_MESSAGE,
  };
};
