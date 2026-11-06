import IsolatedText from "./IsolatedText";
import { getLineDirection } from "../../Utils/LineDirection";
import React, { ReactElement } from "react";

/*
 * WORDS ON A LINE OF THE PAGE, READ THE WAY THEY ARE WRITTEN.
 *
 * A help line under a switch, a field or a card's title is looked up in the
 * reader's language, and a sentence the language has not worded yet is the
 * English one. On a Persian page, laid out right to left, that English line
 * put its full stop first (".Turn this on to page the team"), as an answer
 * from the server did (Alert, FieldError, ErrorMessage).
 *
 * Words that read the other way from the page are drawn in an isolate of
 * their own (IsolatedText), which keeps their punctuation where they were
 * written and still starts where the page's lines do. Words in the page's
 * own way - a translated line, an English line on an English page - and a
 * line handed over as an element of its own (links, bold names) are drawn
 * exactly as they always were, with no new element.
 */
export type ReadAsWrittenValue = string | ReactElement | undefined;

export const readAsWritten: (
  words: ReadAsWrittenValue,
  pageLanguage: string | null | undefined,
) => ReadAsWrittenValue = (
  words: ReadAsWrittenValue,
  pageLanguage: string | null | undefined,
): ReadAsWrittenValue => {
  return typeof words === "string" && getLineDirection(words, pageLanguage) ? (
    <IsolatedText text={words} />
  ) : (
    words
  );
};

export default readAsWritten;
