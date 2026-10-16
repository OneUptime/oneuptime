import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

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
 */

export interface PrivateEventNotesCopy {
  // "Add Public Note" locked, and the Public Notes page where its composer was.
  refusal: string;
  // The Public Notes page's description, in place of the status page one.
  description: string;
}

// The events that can be private: incidents and incident episodes.
export const PRIVATE_EVENT_NOTES_COPY: Record<string, PrivateEventNotesCopy> = {
  incident: {
    refusal: translationKey(
      "This incident is private, so public notes cannot be added to it. Use a private note.",
    ),
    description: translationKey(
      "This incident is private, so no status page shows it or its public notes.",
    ),
  },
  episode: {
    refusal: translationKey(
      "This episode is private, so public notes cannot be added to it. Use a private note.",
    ),
    description: translationKey(
      "This episode is private, so no status page shows it or its public notes.",
    ),
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
export function getPrivateEventPublicNoteRefusal(
  eventNoun: string,
  translator: Translator = getGlobalTranslator(),
): string {
  const refusal: string = getPrivateEventNotesCopy(eventNoun).refusal;

  return translator.translateText(refusal) || refusal;
}

// "This incident is private, so no status page shows it or its public notes."
export function getPrivateEventPublicNotesDescription(
  eventNoun: string,
  translator: Translator = getGlobalTranslator(),
): string {
  const description: string = getPrivateEventNotesCopy(eventNoun).description;

  return translator.translateText(description) || description;
}
