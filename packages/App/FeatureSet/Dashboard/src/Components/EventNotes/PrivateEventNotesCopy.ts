import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { getNotesCopy, NotesCopy } from "./EventNotesUtil";

/*
 * What the Dashboard says where a public note would be written on a private
 * incident or episode. A private one takes no public notes
 * (Common/Types/StatusPage/PrivateRecordPublicNotes): it is on no status
 * page and is told to no subscriber, so a public note on it would reach
 * nobody it was written for.
 *
 * The lock is the server's refusal, word for word (getRefusalMessage there;
 * a test holds the two together), so the Dashboard, the API, workflows and
 * the AI all say the same sentence. Each event's sentences are whole keys,
 * not one sentence with the event's name put in: a language words "this
 * incident" and "this episode" each its own way.
 *
 * Everything else the Public Notes page says about its notes stays true on
 * a private event too (getPrivateEventPublicNotesCopy): its description, the
 * audience of a note being edited, and what deleting one does say no status
 * page shows them while it is private - never "Visible on your status page".
 */

export interface PrivateEventNotesCopy {
  // "Add Public Note" locked, and the Public Notes page where its composer was.
  refusal: string;
  /*
   * The same, for a reader who may not add a private note either - on a
   * private record's page, their team that owns it may not: why, without
   * pointing them to a private note they cannot add.
   */
  refusalWithoutPrivateNote: string;
  /*
   * The Public Notes page's description, in place of the status page one:
   * what its notes are, and that no status page shows them while it is
   * private.
   */
  description: string;
  // Who reads a public note being edited, in place of "Visible on your status page".
  audienceHint: string;
}

// The events that can be private: incidents and incident episodes.
export const PRIVATE_EVENT_NOTES_COPY: Record<string, PrivateEventNotesCopy> = {
  incident: {
    refusal: translationKey(
      "This incident is private, so public notes cannot be added to it. Use a private note.",
    ),
    refusalWithoutPrivateNote: translationKey(
      "This incident is private, so public notes cannot be added to it.",
    ),
    description: translationKey(
      "Customer-facing updates about this incident. While it is private, no status page shows them.",
    ),
    audienceHint: translationKey("Not shown while this incident is private"),
  },
  episode: {
    refusal: translationKey(
      "This episode is private, so public notes cannot be added to it. Use a private note.",
    ),
    refusalWithoutPrivateNote: translationKey(
      "This episode is private, so public notes cannot be added to it.",
    ),
    description: translationKey(
      "Customer-facing updates about this episode. While it is private, no status page shows them.",
    ),
    audienceHint: translationKey("Not shown while this episode is private"),
  },
};

// The way to the event's private notes, from where the composer was.
export const PRIVATE_EVENT_PRIVATE_NOTE_ACTION: string =
  translationKey("Add Private Note");

// An event's sentences: an incident's for any noun not listed.
export function getPrivateEventNotesCopy(
  eventNoun: string,
): PrivateEventNotesCopy {
  return (
    PRIVATE_EVENT_NOTES_COPY[eventNoun] || PRIVATE_EVENT_NOTES_COPY["incident"]!
  );
}

// "This incident is private, so public notes cannot be added to it. ..."
/*
 * `isPrivateNoteOffered` false: the reader may not add a private note
 * either, so the refusal does not point them to one (refusalWithoutPrivateNote).
 */
export function getPrivateEventPublicNoteRefusal(
  eventNoun: string,
  translator: Translator = getGlobalTranslator(),
  isPrivateNoteOffered: boolean = true,
): string {
  const copy: PrivateEventNotesCopy = getPrivateEventNotesCopy(eventNoun);
  const refusal: string = isPrivateNoteOffered
    ? copy.refusal
    : copy.refusalWithoutPrivateNote;

  return translator.translateText(refusal) || refusal;
}

/*
 * The Public Notes page's words on a private incident or episode: the page
 * it always is, with every sentence that promised the status page made
 * true.
 *
 *  - description: "Customer-facing updates about this incident. While it is
 *    private, no status page shows them." (translated, as getNotesCopy fills
 *    its sentences);
 *  - audienceHint, beside "Public" while a note is edited: "Not shown while
 *    this incident is private";
 *  - deleteDescription: what deleting a note does, as a private note's says
 *    it - a note on a private event is on no status page to be removed from.
 */
export function getPrivateEventPublicNotesCopy(
  copy: NotesCopy,
  eventNoun: string,
  translator: Translator = getGlobalTranslator(),
): NotesCopy {
  const privateCopy: PrivateEventNotesCopy =
    getPrivateEventNotesCopy(eventNoun);

  return {
    ...copy,
    description:
      translator.translateText(privateCopy.description) ||
      privateCopy.description,
    audienceHint: privateCopy.audienceHint,
    deleteDescription: getNotesCopy("private", eventNoun, translator)
      .deleteDescription,
  };
}
