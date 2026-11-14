import {
  TranslatableTerm,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/Types/Translator";

/*
 * THE ARCHIVE CARD'S WORDS, IN THE READER'S LANGUAGE (#7195).
 *
 * Every Settings page that lets you archive something draws the shared
 * ArchiveResourceCard. Its title was built by hand - "Archive " plus the
 * resource's English name - and its telemetry description and confirmation
 * were template literals with that name inside, so no locale ever had a
 * wording of them: a German, Persian or Japanese reader saw the whole card
 * and its dialog in English, all but the Archive button.
 *
 * Each sentence is now one key with the resource's name as a value
 * ({{itemName}}), so each language puts the name where its grammar wants
 * it ("SLO archivieren"), and the name goes in as a term: the reader's
 * word for it ("Dienst", "سرویس"), from the Dashboard's locale, or the
 * English the caller passed where the locale has none.
 *
 * The titles are the very keys the row's ⋯ menu titles its Archive and
 * Unarchive dialogs with (Common's BulkArchiveActions, ROW_ARCHIVE_TITLE),
 * so archiving one thing reads the same from its row and its Settings page.
 *
 * Kept React-free, so App tests can read the words without a renderer.
 */

export const ARCHIVE_CARD_TITLE: string = translationKey(
  "Archive {{itemName}}",
);

export const UNARCHIVE_CARD_TITLE: string = translationKey(
  "Unarchive {{itemName}}",
);

/*
 * The card and its dialog for a telemetry resource, which keeps collecting
 * while it is archived. A resource whose archive does more - an SLO stops
 * being evaluated, a workflow stops running - passes its own sentences.
 */
export const TELEMETRY_ARCHIVE_CARD_DESCRIPTION: string = translationKey(
  "Archive this {{itemName}} to hide it from lists while it keeps collecting telemetry. You can unarchive it anytime.",
);

export const TELEMETRY_UNARCHIVE_CARD_DESCRIPTION: string = translationKey(
  "This {{itemName}} is archived and hidden from lists. It is still collecting telemetry. Unarchive it to make it visible again.",
);

export const TELEMETRY_ARCHIVE_CONFIRM_MESSAGE: string = translationKey(
  "Are you sure you want to archive this {{itemName}}? It will be hidden from the list but will keep collecting telemetry.",
);

export const UNARCHIVE_CONFIRM_MESSAGE: string = translationKey(
  "Are you sure you want to unarchive this {{itemName}}? It will reappear in the main list.",
);

/*
 * A resource's own sentences, each an English key the reader's language
 * words (ResourceArchiveCopy, SloArchiveCopy). Any left out reads as the
 * telemetry one.
 */
export interface ArchiveCardCopy {
  archiveCardDescription?: string | undefined;
  unarchiveCardDescription?: string | undefined;
  archiveConfirmMessage?: string | undefined;
  unarchiveConfirmMessage?: string | undefined;
}

export interface ArchiveCardWordsInput {
  /*
   * The resource's name as the card says it, in English: "service", "SLO",
   * "cloud environment". A key of the Dashboard's locales, so it is said in
   * the reader's language.
   */
  singularName: string;
  isArchived: boolean;
  copy: ArchiveCardCopy;
  translator: Translator;
}

export interface ArchiveCardWords {
  // The card's title, and its dialog's: "Archive service".
  title: string;
  // The card's description: what archiving (or unarchiving) does.
  description: string;
  // The dialog's question before the change is made.
  confirmMessage: string;
}

// "vCenter", "iOS": a word with a capital after its first letter keeps its case.
const INNER_CAPITAL: RegExp = /^.+\p{Lu}/u;

/*
 * A title starts with a capital, as a heading does. A language that puts
 * the name first draws it as a sentence holds it - Dutch's "dienst
 * archiveren" - so its first letter is raised: "Dienst archiveren". A name
 * that keeps its case ("vCenter archiveren") is left as written.
 */
const asHeading: (text: string, language: string) => string = (
  text: string,
  language: string,
): string => {
  const firstWord: string = text.split(/\s/)[0] || "";

  if (!text || INNER_CAPITAL.test(firstWord)) {
    return text;
  }

  const first: string = String.fromCodePoint(text.codePointAt(0)!);
  let raised: string = first;

  try {
    raised = first.toLocaleUpperCase(language);
  } catch {
    raised = first.toUpperCase();
  }

  return raised + text.slice(first.length);
};

/*
 * The card's title, description and confirmation for the state it is in,
 * in the reader's language: each of the resource's own sentences looked up,
 * the telemetry ones filled with its name. An English reader reads them
 * word for word as the card always wrote them.
 */
export const getArchiveCardWords: (
  input: ArchiveCardWordsInput,
) => ArchiveCardWords = (input: ArchiveCardWordsInput): ArchiveCardWords => {
  const translator: Translator = input.translator;

  // As a title says it: "Archive SLO", "{{itemName}} archivieren".
  const name: TranslatableTerm = translatableTerm(input.singularName);

  // As a sentence says it: "Archive this RUM application to ...".
  const nameInSentence: TranslatableTerm = translatableTerm(
    input.singularName,
    { inSentence: true },
  );

  /*
   * `||` rather than `??`: an empty sentence is a caller's mistake, and a
   * blank card or a dialog with no question is worse than the telemetry one.
   */
  const own: (text: string | undefined) => string = (
    text: string | undefined,
  ): string => {
    if (!text) {
      return "";
    }

    return translator.translateText(text) || text;
  };

  if (input.isArchived) {
    return {
      title: asHeading(
        translator.translateTemplate(UNARCHIVE_CARD_TITLE, {
          itemName: name,
        }),
        translator.language,
      ),
      description:
        own(input.copy.unarchiveCardDescription) ||
        translator.translateTemplate(TELEMETRY_UNARCHIVE_CARD_DESCRIPTION, {
          itemName: nameInSentence,
        }),
      confirmMessage:
        own(input.copy.unarchiveConfirmMessage) ||
        translator.translateTemplate(UNARCHIVE_CONFIRM_MESSAGE, {
          itemName: nameInSentence,
        }),
    };
  }

  return {
    title: asHeading(
      translator.translateTemplate(ARCHIVE_CARD_TITLE, {
        itemName: name,
      }),
      translator.language,
    ),
    description:
      own(input.copy.archiveCardDescription) ||
      translator.translateTemplate(TELEMETRY_ARCHIVE_CARD_DESCRIPTION, {
        itemName: nameInSentence,
      }),
    confirmMessage:
      own(input.copy.archiveConfirmMessage) ||
      translator.translateTemplate(TELEMETRY_ARCHIVE_CONFIRM_MESSAGE, {
        itemName: nameInSentence,
      }),
  };
};
