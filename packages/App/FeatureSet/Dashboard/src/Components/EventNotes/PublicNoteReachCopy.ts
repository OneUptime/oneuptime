import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachResult,
} from "Common/Types/StatusPage/PublicNoteReach";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import SubscriberNotificationPreviewCopy from "../StatusPage/SubscriberNotificationPreviewCopy";
import { getNotesCopy, NotesCopy } from "./EventNotesUtil";

/*
 * WHAT THE NOTE COMPOSER PROMISES (#9735).
 *
 * A public note is on a status page only while a page shows its event, and
 * notifies anyone only when a page that shows it sends notifications
 * (Common/Types/StatusPage/PublicNoteReach, worked out on the server from
 * every page the event reaches). The composer said "Visible on your status
 * page" beside "Public", "Subscribers will be notified about this update as
 * soon as you post it." under the ticked notify box, and "The update will
 * appear on your status page without notifying subscribers." under the
 * unticked one, of every event - also of an incident no status page shows,
 * a maintenance event with no page picked, and an event whose pages send
 * their subscribers nothing.
 *
 * Now each says what is true for this event, once the server has said it:
 *
 *   - a page shows it, and one that does notifies: the sentences above;
 *   - pages show it, and none of them notifies: ticked, the reason ("The
 *     status pages that show this incident do not send notifications to
 *     their subscribers."); unticked, that it shows without notifying;
 *   - no page shows it: "No status page shows this incident yet" beside
 *     "Public", and under the box, ticked or not, why, then where the note
 *     shows later: "Any status page that starts showing this incident shows
 *     this note too, without notifying its subscribers.";
 *   - not known yet, or not answered: no promise either way. "Public" stands
 *     alone, and the box says only why it starts unticked, where it does.
 *
 * An incident's sentences are its notification preview's, word for word
 * (SubscriberNotificationPreviewCopy, #9684): the composer and the preview
 * say one thing. An episode and a maintenance event say the same in their
 * own sentences, each a whole key: a language words "this incident", "this
 * episode" and "this maintenance event" each its own way.
 *
 * English keys, looked up where they are shown (NoteComposer). React-free,
 * so App's tests can read every sentence and check it in every locale.
 */

export interface PublicNoteReachEventCopy {
  // Beside "Public", while no status page shows the event.
  notShownHint: string;
  /*
   * Why a note posted now notifies nobody, a sentence for each reason. A
   * reason the event never has reads as its NoStatusPages: no page shows it.
   */
  nothingSent: Record<PublicNoteNothingSentReason, string>;
  // After a reason that leaves the note on no status page: where it shows later.
  shownLater: string;
}

const EPISODE_NO_STATUS_PAGES: string = translationKey(
  "No status page shows this episode yet.",
);

const MAINTENANCE_EVENT_NO_STATUS_PAGES: string = translationKey(
  "No status page shows this maintenance event yet.",
);

export const PUBLIC_NOTE_REACH_COPY: Record<string, PublicNoteReachEventCopy> =
  {
    incident: {
      notShownHint: translationKey("No status page shows this incident yet"),
      nothingSent: {
        [PublicNoteNothingSentReason.NoMonitors]:
          SubscriberNotificationPreviewCopy.noMonitors,
        [PublicNoteNothingSentReason.HiddenFromStatusPages]:
          SubscriberNotificationPreviewCopy.hiddenIncident,
        [PublicNoteNothingSentReason.NotPublishedYet]:
          SubscriberNotificationPreviewCopy.noStatusPagesForNote,
        [PublicNoteNothingSentReason.NoStatusPages]:
          SubscriberNotificationPreviewCopy.noStatusPagesForNote,
        [PublicNoteNothingSentReason.NotificationsOff]:
          SubscriberNotificationPreviewCopy.notificationsOff,
      },
      shownLater: SubscriberNotificationPreviewCopy.noteShownLater,
    },
    episode: {
      notShownHint: translationKey("No status page shows this episode yet"),
      nothingSent: {
        [PublicNoteNothingSentReason.NoMonitors]: translationKey(
          "No monitors are attached to the incidents in this episode. Subscribers hear about an episode through the monitors their status pages list.",
        ),
        [PublicNoteNothingSentReason.HiddenFromStatusPages]: translationKey(
          "This episode is hidden from status pages.",
        ),
        [PublicNoteNothingSentReason.NotPublishedYet]: EPISODE_NO_STATUS_PAGES,
        [PublicNoteNothingSentReason.NoStatusPages]: EPISODE_NO_STATUS_PAGES,
        [PublicNoteNothingSentReason.NotificationsOff]: translationKey(
          "The status pages that show this episode do not send notifications to their subscribers.",
        ),
      },
      shownLater: translationKey(
        "Any status page that starts showing this episode shows this note too, without notifying its subscribers.",
      ),
    },
    "maintenance event": {
      notShownHint: translationKey(
        "No status page shows this maintenance event yet",
      ),
      nothingSent: {
        [PublicNoteNothingSentReason.NoMonitors]:
          MAINTENANCE_EVENT_NO_STATUS_PAGES,
        [PublicNoteNothingSentReason.HiddenFromStatusPages]: translationKey(
          "This maintenance event is hidden from status pages.",
        ),
        [PublicNoteNothingSentReason.NotPublishedYet]: translationKey(
          "This maintenance event is not published on status pages yet.",
        ),
        [PublicNoteNothingSentReason.NoStatusPages]:
          MAINTENANCE_EVENT_NO_STATUS_PAGES,
        [PublicNoteNothingSentReason.NotificationsOff]: translationKey(
          "The status pages that show this maintenance event do not send notifications to their subscribers.",
        ),
      },
      shownLater: translationKey(
        "Any status page that starts showing this maintenance event shows this note too, without notifying its subscribers.",
      ),
    },
  };

// A new note, ticked, while a page that shows the event notifies.
export const NOTE_NOTIFIES_SUBSCRIBERS: string = translationKey(
  "Subscribers will be notified about this update as soon as you post it.",
);

// A new note, unticked, while a page shows the event.
export const NOTE_SHOWN_WITHOUT_NOTIFYING: string = translationKey(
  "The update will appear on your status page without notifying subscribers.",
);

// An edited note, ticked, while a page that shows the event notifies.
export const EDITED_NOTE_NOTIFIES_SUBSCRIBERS: string = translationKey(
  "Subscribers will receive the edited note, marked as an update.",
);

// An edited note, unticked: advice that holds wherever the note shows.
export const EDITED_NOTE_LEFT_QUIET: string = translationKey(
  "Leave this unticked for small fixes such as typos.",
);

// An event's sentences: an incident's for a noun not listed.
export function getPublicNoteReachCopy(
  eventNoun: string,
): PublicNoteReachEventCopy {
  return (
    PUBLIC_NOTE_REACH_COPY[eventNoun] || PUBLIC_NOTE_REACH_COPY["incident"]!
  );
}

/*
 * Why a note posted now notifies nobody, and - when that leaves it on no
 * status page - where it shows later: the sentences under the notify box.
 * Empty when it notifies.
 */
export function getNothingSentSentences(
  eventNoun: string,
  reach: PublicNoteReachResult,
): Array<string> {
  if (!reach.nothingSentReason) {
    return [];
  }

  const copy: PublicNoteReachEventCopy = getPublicNoteReachCopy(eventNoun);
  const reason: string = copy.nothingSent[reach.nothingSentReason];

  if (PublicNoteReach.isShownOnAStatusPage(reach)) {
    return [reason];
  }

  return [reason, copy.shownLater];
}

/*
 * The public notes' words, with what beside "Public" and in the delete
 * dialog says of the status page made true for this event: a page shows
 * it, none does, or that is not known. While a page shows it the words are
 * getNotesCopy's own. Otherwise "Public" says where the note is only when
 * that is known - "No status page shows this incident yet" - and deleting
 * one says what a private note's does: there is no status page it is
 * removed from (as a private event's, getPrivateEventPublicNotesCopy).
 */
export function getPublicNotesCopyForReach(data: {
  copy: NotesCopy;
  eventNoun: string;
  // Null while it is not known: not loaded yet, or not answered.
  reach: PublicNoteReachResult | null;
  translator?: Translator | undefined;
}): NotesCopy {
  if (data.reach && PublicNoteReach.isShownOnAStatusPage(data.reach)) {
    return data.copy;
  }

  return {
    ...data.copy,
    audienceHint: data.reach
      ? getPublicNoteReachCopy(data.eventNoun).notShownHint
      : "",
    deleteDescription: getNotesCopy(
      "private",
      data.eventNoun,
      data.translator || getGlobalTranslator(),
    ).deleteDescription,
  };
}

export interface NotifyDescriptions {
  // Under the notify box, ticked and unticked: a sentence each, or none.
  checked: Array<string>;
  unchecked: Array<string>;
}

/*
 * What a new note's "Notify status page subscribers" says, ticked and
 * unticked. Why a box starts unticked (the event started without notifying
 * anyone) is said while it shows the event, or while that is not known;
 * where no page shows the event, why not is said instead, ticked or not -
 * the box changes nothing then.
 */
export function getCreateNotifyDescriptions(data: {
  eventNoun: string;
  reach: PublicNoteReachResult | null;
  isNotifyingByDefault: boolean;
  quietDescription: string;
}): NotifyDescriptions {
  const quiet: Array<string> = data.isNotifyingByDefault
    ? []
    : [data.quietDescription];

  if (!data.reach) {
    return { checked: [], unchecked: quiet };
  }

  if (!PublicNoteReach.isShownOnAStatusPage(data.reach)) {
    const notShown: Array<string> = getNothingSentSentences(
      data.eventNoun,
      data.reach,
    );

    return { checked: notShown, unchecked: notShown };
  }

  return {
    checked: PublicNoteReach.isNotifying(data.reach)
      ? [NOTE_NOTIFIES_SUBSCRIBERS]
      : getNothingSentSentences(data.eventNoun, data.reach),
    unchecked: data.isNotifyingByDefault
      ? [NOTE_SHOWN_WITHOUT_NOTIFYING]
      : quiet,
  };
}

/*
 * What an edit's "Notify subscribers about this update" says: ticked, who
 * gets the edited note - or why nobody does; unticked, the advice for a
 * small fix, which holds wherever the note shows.
 */
export function getUpdateNotifyDescriptions(data: {
  eventNoun: string;
  reach: PublicNoteReachResult | null;
}): NotifyDescriptions {
  const unchecked: Array<string> = [EDITED_NOTE_LEFT_QUIET];

  if (!data.reach) {
    return { checked: [], unchecked: unchecked };
  }

  return {
    checked: PublicNoteReach.isNotifying(data.reach)
      ? [EDITED_NOTE_NOTIFIES_SUBSCRIBERS]
      : getNothingSentSentences(data.eventNoun, data.reach),
    unchecked: unchecked,
  };
}
