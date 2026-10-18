/*
 * THE LINE AT THE END OF EVERY EMAIL A STATUS PAGE SENDS ITS SUBSCRIBERS.
 *
 * A status page's own text goes there only while its switch
 * (enableCustomSubscriberEmailNotificationFooterText) is on and the text
 * (subscriberEmailNotificationFooterText) is not empty; otherwise every
 * email ends with the default line. The senders ask
 * StatusPageService.getSubscriberEmailFooterText, which asks this; the
 * dashboard's Email Footer card shows what it answers, so the card says
 * what subscribers read. The default line is English, as the emails are.
 */

export const DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT: string =
  "This is an automated email sent to you because you are subscribed to this Status Page.";

export interface SubscriberEmailFooterColumns {
  enableCustomSubscriberEmailNotificationFooterText?:
    | boolean
    | null
    | undefined;
  subscriberEmailNotificationFooterText?: string | null | undefined;
}

// Whether a status page's emails end with its own footer text.
export const isCustomSubscriberEmailFooterUsed: (
  statusPage: SubscriberEmailFooterColumns,
) => boolean = (statusPage: SubscriberEmailFooterColumns): boolean => {
  return Boolean(
    statusPage.enableCustomSubscriberEmailNotificationFooterText &&
      statusPage.subscriberEmailNotificationFooterText,
  );
};

// The line a status page's subscriber emails end with.
export const getSubscriberEmailFooterText: (
  statusPage: SubscriberEmailFooterColumns,
) => string = (statusPage: SubscriberEmailFooterColumns): string => {
  if (isCustomSubscriberEmailFooterUsed(statusPage)) {
    return statusPage.subscriberEmailNotificationFooterText as string;
  }

  return DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT;
};
