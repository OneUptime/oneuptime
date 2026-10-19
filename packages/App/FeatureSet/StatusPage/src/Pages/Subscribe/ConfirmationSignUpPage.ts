import PageMap from "../../Utils/PageMap";

/*
 * Where a visitor whose link to confirm a subscription has expired, or is
 * not valid, signs up again for a new one: the Subscribe page of a channel
 * that confirms by a link - email, then SMS, the order the Subscribe side
 * menu lists them - that the status page offers. A link works for a day
 * after it is sent (StatusPageSubscriberConfirmationCode), and signing the
 * same email address or phone number up again sends a new one once the old
 * one has run out.
 *
 * The Confirm Subscription page shows it with its "expired or not valid"
 * message. Null when the page offers neither channel: there is then no page
 * to send the visitor to, and the message says what to do on its own.
 *
 * React-free, so App's tests can read it.
 */

export interface ConfirmationSignUpChannels {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
}

export function getConfirmationSignUpPage(data: {
  channels: ConfirmationSignUpChannels;
  isPreview: boolean;
}): PageMap | null {
  if (data.channels.enableEmailSubscribers) {
    return data.isPreview
      ? PageMap.PREVIEW_SUBSCRIBE_EMAIL
      : PageMap.SUBSCRIBE_EMAIL;
  }

  if (data.channels.enableSMSSubscribers) {
    return data.isPreview ? PageMap.PREVIEW_SUBSCRIBE_SMS : PageMap.SUBSCRIBE_SMS;
  }

  return null;
}

/*
 * The answers of the confirm route that mean the link itself confirms
 * nothing: 404, no subscription has that id and code; 400, its day is
 * over. Anything else - the server out of reach, an error of its own - is
 * not the link's doing, and is shown as it is.
 */
export const LINK_NOT_VALID_STATUS_CODES: ReadonlyArray<number> = [400, 404];
