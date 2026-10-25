import { DELETE_IRREVERSIBLE_SENTENCE } from "./DeleteConfirmationMessage";
import { getSentenceSeparator } from "./DeleteConsequences";
import {
  getSentenceParts,
  SentencePart,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";

/*
 * A Delete question with some of its values in bold - "Are you sure you want
 * to delete the Resolved state that started 10:42?" - and then "This action
 * cannot be undone.", run together the way the reader's script writes two
 * sentences: a space, or nothing after a full-width stop. The status and
 * state timelines' Delete dialogs drew the two with a space between them,
 * so in Japanese and Chinese a gap followed the "？".
 *
 * The question is a whole translated sentence (TranslatedSentence's
 * template and slots); the separator is read from the sentence as it is
 * drawn, so a translation that lost a slot - drawn in English - is spaced
 * as English.
 */

export interface ComponentProps {
  // English template (the translation key), with {{slot}} placeholders.
  template: string;
  // Placeholder name -> what to draw there.
  slots: Record<string, ReactNode>;
}

const IrreversibleQuestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const parts: Array<SentencePart> = getSentenceParts({
    translator: translator,
    template: props.template,
    slots: Object.keys(props.slots),
  });

  // How the drawn question ends: its last piece of text, or a slot.
  const lastPart: SentencePart | undefined = parts[parts.length - 1];
  const endsWith: string =
    lastPart && lastPart.kind === "text" ? lastPart.text : "";

  return (
    <>
      {parts.map((part: SentencePart, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {part.kind === "slot" ? props.slots[part.slot] : part.text}
          </Fragment>
        );
      })}
      {getSentenceSeparator(endsWith)}
      {translator.translateText(DELETE_IRREVERSIBLE_SENTENCE) ||
        DELETE_IRREVERSIBLE_SENTENCE}
    </>
  );
};

export default IrreversibleQuestion;
