import { translatableTerm, Translator } from "./TranslateTemplate";
import { UnexplainedErrorWords } from "../../Types/Exception/UnexplainedError";

/*
 * WHAT A DIALOG WAS DOING, SAID FIRST WHEN IT FAILED IN A WAY NOBODY
 * EXPLAINED (#7680).
 *
 * A failure nobody explained - a 500, a gateway that did not answer - opens
 * with what failed (ErrorExplanation's first line), then why and what to do
 * next. A dialog that did not say what it was doing opened with "This did
 * not finish.": in a dialog about rotating a key, deleting a monitor or
 * testing a connection, a line that names none of them, and that says
 * nothing once it is copied into a message to whoever runs the server.
 *
 * A dialog says what it was doing in a sentence of its own where its page
 * has one ("The verification code was not rotated.", errorWhatFailed), and
 * otherwise names itself by its title, the action the person chose, in the
 * reader's language: "“Rotate Verification Code” did not finish." Modal
 * does that for every dialog; a dialog whose title names no action - an
 * Error dialog, "Test Failed" - says what failed itself
 * (DialogsSayWhatFailedGuard).
 *
 * The title is the one drawn, already in the reader's words, and a title
 * asked as a question ("Regenerate backup codes?") is named without its
 * question mark.
 */

// The marks a question ends with: ? and Arabic's and Persian's ؟, and the full-width ？.
const QUESTION_MARKS_AT_END: RegExp = /[\s?؟？]+$/;

// What a dialog titled `title` was doing, as the first line of its failure.
export const getDialogWhatFailed: (
  translator: Translator,
  title: string | undefined,
) => string | undefined = (
  translator: Translator,
  title: string | undefined,
): string | undefined => {
  const action: string = (title || "")
    .replace(QUESTION_MARKS_AT_END, "")
    .trim();

  if (!action) {
    return undefined;
  }

  return translator.translateTemplate(
    UnexplainedErrorWords.dialogDidNotFinish,
    {
      action: action,
    },
  );
};

/*
 * What a dialog that deleted a record says when the delete failed: "The
 * monitor was not deleted.", the record named as its table or its card
 * names it, in the sentence's case.
 */
export const getDeleteWhatFailed: (
  translator: Translator,
  itemName: string,
) => string = (translator: Translator, itemName: string): string => {
  return translator.translateTemplate(UnexplainedErrorWords.deleteFailed, {
    itemName: translatableTerm(itemName, { inSentence: true }),
  });
};

/*
 * What a dialog that saved a record says when the save failed: "The
 * workflow was not saved."
 */
export const getSaveWhatFailed: (
  translator: Translator,
  itemName: string,
) => string = (translator: Translator, itemName: string): string => {
  return translator.translateTemplate(UnexplainedErrorWords.saveFailed, {
    itemName: translatableTerm(itemName, { inSentence: true }),
  });
};

/*
 * What a dialog that read a record says when the read failed: "The monitor
 * could not be loaded."
 */
export const getLoadWhatFailed: (
  translator: Translator,
  itemName: string,
) => string = (translator: Translator, itemName: string): string => {
  return translator.translateTemplate(UnexplainedErrorWords.loadFailed, {
    itemName: translatableTerm(itemName, { inSentence: true }),
  });
};
