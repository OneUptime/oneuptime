import {
  translationKey,
  Translator,
} from "../../UI/Utils/TranslateTemplate";

/*
 * THE NAMES ONEUPTIME GIVES EVERY NEW PROJECT'S STATES, SEVERITIES AND
 * STATUSES (ProjectService): incident states, incident severities, monitor
 * statuses and scheduled maintenance states.
 *
 * A status page shows these in its reader's language
 * (StatusPage/src/Utils/StatusTranslation), and so do its notifications to
 * its subscribers (Server/Utils/StatusPage/SubscriberMessageText). A name
 * the project changed is its own, and reads as written in every language.
 */
export const DEFAULT_STATUS_NAMES: ReadonlyArray<string> = [
  translationKey("Identified"),
  translationKey("Acknowledged"),
  translationKey("Resolved"),
  translationKey("Critical Incident"),
  translationKey("Major Incident"),
  translationKey("Minor Incident"),
  translationKey("Operational"),
  translationKey("Degraded"),
  translationKey("Offline"),
  translationKey("Scheduled"),
  translationKey("Ongoing"),
  translationKey("Ended"),
  translationKey("Completed"),
];

// Whether `name` is one of OneUptime's default names, as it gave it.
export const isDefaultStatusName: (name: string | null | undefined) => boolean =
  (name: string | null | undefined): boolean => {
    return typeof name === "string" && DEFAULT_STATUS_NAMES.includes(name.trim());
  };

/*
 * A state's, a severity's or a status's name as `translator`'s reader reads
 * it: OneUptime's own default names in their language, any other name as
 * written.
 */
export const translateStateName: (
  translator: Translator,
  name: string | null | undefined,
) => string = (
  translator: Translator,
  name: string | null | undefined,
): string => {
  if (!name) {
    return "";
  }

  if (!isDefaultStatusName(name)) {
    return name;
  }

  const trimmed: string = name.trim();

  return translator.translateText(trimmed) || name;
};
