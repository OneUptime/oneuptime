import {
  SubscriberEmailTemplateChoice,
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewStatusPage,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";
import SubscriberNotificationPreviewCopy, {
  formatPreviewText,
} from "../StatusPage/SubscriberNotificationPreviewCopy";
import {
  describeNotifiedStatusPage,
  TranslateFunction,
} from "./SubscriberAudienceText";

/*
 * What the 'Preview notification' dialog says, worked out apart from React
 * so it can be tested on its own. `translate` looks a string up in the active
 * locale by its English text; placeholders are filled in after the lookup.
 */

const NOTHING_SENT_TEXT: Record<
  SubscriberNotificationPreviewNothingSentReason,
  string
> = {
  [SubscriberNotificationPreviewNothingSentReason.NoMonitors]:
    SubscriberNotificationPreviewCopy.noMonitors,
  [SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages]:
    SubscriberNotificationPreviewCopy.hiddenIncident,
  [SubscriberNotificationPreviewNothingSentReason.PrivateIncident]:
    SubscriberNotificationPreviewCopy.privateIncident,
  [SubscriberNotificationPreviewNothingSentReason.NotifyOff]:
    SubscriberNotificationPreviewCopy.notifyOff,
  [SubscriberNotificationPreviewNothingSentReason.NoStatusPages]:
    SubscriberNotificationPreviewCopy.noStatusPages,
};

const TEMPLATE_CHOICE_TEXT: Record<
  SubscriberEmailTemplateChoiceReason,
  string
> = {
  [SubscriberEmailTemplateChoiceReason.CustomTemplate]:
    SubscriberNotificationPreviewCopy.customTemplateUsed,
  [SubscriberEmailTemplateChoiceReason.NoCustomTemplate]:
    SubscriberNotificationPreviewCopy.defaultNoCustomTemplate,
  [SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp]:
    SubscriberNotificationPreviewCopy.defaultCustomTemplateNeedsSmtp,
  [SubscriberEmailTemplateChoiceReason.CustomTemplateIsEmpty]:
    SubscriberNotificationPreviewCopy.defaultCustomTemplateEmpty,
};

// Why nothing will be sent.
export const describeNothingSent: (
  reason: SubscriberNotificationPreviewNothingSentReason,
  translate: TranslateFunction,
) => string = (
  reason: SubscriberNotificationPreviewNothingSentReason,
  translate: TranslateFunction,
): string => {
  return translate(NOTHING_SENT_TEXT[reason]);
};

/*
 * Which email the page's subscribers get, and why: "This status page's
 * custom email template "Acme" is used.", or "The default email is used:
 * ...".
 */
export const describeTemplateChoice: (
  choice: SubscriberEmailTemplateChoice,
  translate: TranslateFunction,
) => string = (
  choice: SubscriberEmailTemplateChoice,
  translate: TranslateFunction,
): string => {
  return formatPreviewText(translate(TEMPLATE_CHOICE_TEXT[choice.reason]), {
    name: choice.customTemplateName || "",
  });
};

// A page in the page picker: "Site 03 (up to 41 email, 3 SMS)".
export const describePreviewStatusPage: (
  statusPage: SubscriberNotificationPreviewStatusPage,
  translate: TranslateFunction,
) => string = (
  statusPage: SubscriberNotificationPreviewStatusPage,
  translate: TranslateFunction,
): string => {
  return describeNotifiedStatusPage(
    {
      statusPageId: statusPage.statusPageId,
      name: statusPage.name,
      subscriberCounts: statusPage.subscriberCounts,
    },
    translate,
  );
};

/*
 * Pages that will be sent the notification that the caller cannot see, and
 * so cannot preview; null when there are none.
 */
export const describeHiddenPages: (
  hiddenStatusPageCount: number,
  translate: TranslateFunction,
) => string | null = (
  hiddenStatusPageCount: number,
  translate: TranslateFunction,
): string | null => {
  if (hiddenStatusPageCount <= 0) {
    return null;
  }

  if (hiddenStatusPageCount === 1) {
    return translate(
      SubscriberNotificationPreviewCopy.oneHiddenPageNotPreviewed,
    );
  }

  return formatPreviewText(
    translate(SubscriberNotificationPreviewCopy.hiddenPagesNotPreviewed),
    {
      number: hiddenStatusPageCount,
    },
  );
};
