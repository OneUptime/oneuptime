import {
  SubscriberEmailTemplateChoice,
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
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
  [SubscriberNotificationPreviewNothingSentReason.NotificationsOff]:
    SubscriberNotificationPreviewCopy.notificationsOff,
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

/*
 * The reasons that leave the incident on no status page at all. The others
 * do not: with 'Notify Status Page Subscribers' off, or every page that
 * shows it sending its subscribers nothing, the pages still show it.
 */
const SHOWN_ON_NO_STATUS_PAGE: ReadonlyArray<SubscriberNotificationPreviewNothingSentReason> =
  [
    SubscriberNotificationPreviewNothingSentReason.NoMonitors,
    SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages,
    SubscriberNotificationPreviewNothingSentReason.PrivateIncident,
    SubscriberNotificationPreviewNothingSentReason.NoStatusPages,
  ];

/*
 * Why nothing will be sent. Each reason reads the same for both events but
 * one: with no status page showing the incident, a note is told that none
 * shows it yet, and a declare that none will when it is declared. Neither
 * says "will show" of later: a page that lists one of its monitors then can
 * show it (#9684).
 */
export const describeNothingSent: (
  reason: SubscriberNotificationPreviewNothingSentReason,
  event: SubscriberNotificationPreviewEvent,
  translate: TranslateFunction,
) => string = (
  reason: SubscriberNotificationPreviewNothingSentReason,
  event: SubscriberNotificationPreviewEvent,
  translate: TranslateFunction,
): string => {
  if (
    reason === SubscriberNotificationPreviewNothingSentReason.NoStatusPages &&
    event === SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated
  ) {
    return translate(SubscriberNotificationPreviewCopy.noStatusPagesForNote);
  }

  return translate(NOTHING_SENT_TEXT[reason]);
};

/*
 * What happens to a public note on an incident no status page shows, said
 * after why nothing will be sent: it is posted all the same, and a status
 * page that starts showing the incident shows it too, without notifying
 * anyone. Null for an incident being declared, which has no note, and while
 * a page shows the incident: the note is on it as soon as it is posted.
 */
export const describeNoteShownLater: (
  reason: SubscriberNotificationPreviewNothingSentReason,
  event: SubscriberNotificationPreviewEvent,
  translate: TranslateFunction,
) => string | null = (
  reason: SubscriberNotificationPreviewNothingSentReason,
  event: SubscriberNotificationPreviewEvent,
  translate: TranslateFunction,
): string | null => {
  if (
    event !== SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated ||
    !SHOWN_ON_NO_STATUS_PAGE.includes(reason)
  ) {
    return null;
  }

  return translate(SubscriberNotificationPreviewCopy.noteShownLater);
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
