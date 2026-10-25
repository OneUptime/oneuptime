import DeleteConsequenceParagraph from "./DeleteConsequenceParagraph";
import { getSentenceSeparator, joinSentences } from "./DeleteConsequences";
import NamedSentence from "./NamedSentence";
import {
  getGlobalTranslator,
  translatableTerm,
  translateTemplate,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The sentence every delete confirmation in the product says, naming what is
 * about to be deleted.
 *
 * "Are you sure you want to delete this workflow?" was true of every workflow
 * in the project, so it told the user nothing at the one moment they wanted to
 * be sure which one was going. Now the dialog says "Are you sure you want to
 * delete Notify on-call?", with the name in bold so it reads as the thing and
 * not as part of the sentence; the dialog's title still says what kind of
 * thing it is ("Delete Workflow").
 *
 * The name is a {{placeholder}} in a whole translated sentence, never a word
 * glued between translated pieces, so every language puts it where its own
 * grammar wants it. A record with no name falls back to the sentence about
 * its kind ("this workflow"), which is what the product said before.
 */

// The confirmation itself.
export const DELETE_QUESTION_TEMPLATE: string =
  "Are you sure you want to delete {{name}}?";

// The card the Delete button sits on, before anything is clicked.
export const DELETE_STATEMENT_TEMPLATE: string = "Permanently delete {{name}}.";

export const DELETE_IRREVERSIBLE_SENTENCE: string =
  "This action cannot be undone.";

// The question about a record with no name, about its kind instead.
export const DELETE_THIS_QUESTION_TEMPLATE: string = translationKey(
  "Are you sure you want to delete this {{itemName}}?",
);

export type DeleteConfirmationKind = "question" | "statement";

/*
 * The sentence for a record that has no name, about its kind instead.
 *
 * The question keeps the shape the product has always used, so the
 * translations that exist for it ("Are you sure you want to delete this
 * form?") still apply. The card's statement has no such sentence:
 * its title already says "Delete Form", and a sentence built from an
 * English model name would be the one line of the card left in English - so
 * an unnamed card says only that the delete cannot be undone.
 */
export const getUnnamedDeleteSentence: (data: {
  typeLabel: string;
  kind: DeleteConfirmationKind;
}) => string = (data: {
  typeLabel: string;
  kind: DeleteConfirmationKind;
}): string => {
  if (data.kind === "statement") {
    return "";
  }

  const typeLabel: string = data.typeLabel.trim().toLowerCase() || "item";

  return `Are you sure you want to delete this ${typeLabel}?`;
};

/*
 * getUnnamedDeleteSentence in the reader's language: the whole sentence for
 * the kind if a locale words it specially ("Are you sure you want to delete
 * this form?"), else the template with the kind's name translated into it.
 */
export const translateUnnamedDeleteSentence: (data: {
  typeLabel: string;
  kind: DeleteConfirmationKind;
}) => string = (data: {
  typeLabel: string;
  kind: DeleteConfirmationKind;
}): string => {
  const sentence: string = getUnnamedDeleteSentence(data);

  if (!sentence) {
    return "";
  }

  const translator: Translator = getGlobalTranslator();

  if (translator.hasTranslation(sentence)) {
    return translator.translateText(sentence) || sentence;
  }

  return translator.translateTemplate(DELETE_THIS_QUESTION_TEMPLATE, {
    itemName: translatableTerm(data.typeLabel.trim() || "item", {
      inSentence: true,
    }),
  });
};

export interface DeleteConfirmationTextOptions {
  // The record's name; "" when it has none.
  name: string;
  // What kind of thing it is, for a record with no name: "workflow".
  typeLabel: string;
  kind?: DeleteConfirmationKind | undefined;
  // Ends with "This action cannot be undone." unless false.
  isIrreversible?: boolean | undefined;
  // A further sentence, after everything else.
  warning?: string | undefined;
}

type GetSentencesFunction = (
  options: DeleteConfirmationTextOptions,
) => Array<string>;

// Every sentence after the first: the parts that do not name anything.
const getTrailingSentences: GetSentencesFunction = (
  options: DeleteConfirmationTextOptions,
): Array<string> => {
  const sentences: Array<string> = [];

  if (options.isIrreversible !== false) {
    sentences.push(translateTemplate(DELETE_IRREVERSIBLE_SENTENCE));
  }

  if (options.warning?.trim()) {
    sentences.push(options.warning.trim());
  }

  return sentences;
};

// The first sentence, the one that names the record, in the reader's language.
const getFirstSentenceText: (options: DeleteConfirmationTextOptions) => string = (
  options: DeleteConfirmationTextOptions,
): string => {
  const kind: DeleteConfirmationKind = options.kind || "question";
  const name: string = options.name.trim();

  return name
    ? translateTemplate(
        kind === "statement"
          ? DELETE_STATEMENT_TEMPLATE
          : DELETE_QUESTION_TEMPLATE,
        { name: name },
      )
    : translateUnnamedDeleteSentence({
        typeLabel: options.typeLabel,
        kind: kind,
      });
};

/*
 * The same sentences as plain text, for places that only take a string - an
 * aria-label, a test's expectation. Run together as the reader's script
 * writes them: no space after a full-width stop (joinSentences).
 */
export const getDeleteConfirmationText: (
  options: DeleteConfirmationTextOptions,
) => string = (options: DeleteConfirmationTextOptions): string => {
  return joinSentences([
    getFirstSentenceText(options),
    ...getTrailingSentences(options),
  ]);
};

export interface ComponentProps extends DeleteConfirmationTextOptions {
  // The full name, shown on hover when `name` was shortened to fit.
  fullName?: string | undefined;
  dataTestId?: string | undefined;
}

const DeleteConfirmationMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const kind: DeleteConfirmationKind = props.kind || "question";
  const name: string = props.name.trim();
  const fullName: string = props.fullName?.trim() || "";

  const firstSentence: ReactElement | string = name ? (
    <NamedSentence
      template={
        kind === "statement"
          ? DELETE_STATEMENT_TEMPLATE
          : DELETE_QUESTION_TEMPLATE
      }
      name={name}
      title={fullName && fullName !== name ? fullName : undefined}
    />
  ) : (
    translateUnnamedDeleteSentence({ typeLabel: props.typeLabel, kind: kind })
  );

  // The question's own sentences: that it cannot be undone.
  const trailingSentences: Array<string> = getTrailingSentences({
    name: name,
    typeLabel: props.typeLabel,
    isIrreversible: props.isIrreversible,
  });

  /*
   * Each sentence after the first follows the one before it the way the
   * reader's script writes them: a space, or nothing after a full-width
   * stop - "test01 を削除してもよろしいですか？この操作は元に戻せません。",
   * where a space after the "？" read as a stray gap in Japanese and
   * Chinese. The first sentence is drawn with its name in bold, so its end
   * is read from its text.
   */
  const firstSentenceText: string = getFirstSentenceText({
    name: name,
    typeLabel: props.typeLabel,
    kind: kind,
  });

  /*
   * What goes with it is a paragraph of its own under the question: read
   * together, four sentences were one dense block, and the records that go
   * with this one - the thing most worth noticing - sat in the middle of it.
   */
  const warning: string = props.warning?.trim() || "";

  return (
    <span data-testid={props.dataTestId || "delete-confirmation-message"}>
      {firstSentence}
      {trailingSentences.map((sentence: string, index: number) => {
        // Nothing before the first thing drawn.
        const previous: string =
          index === 0 ? firstSentenceText : trailingSentences[index - 1] || "";

        return (
          <React.Fragment key={index}>
            {previous ? getSentenceSeparator(previous) : ""}
            {sentence}
          </React.Fragment>
        );
      })}
      {warning ? (
        <DeleteConsequenceParagraph
          hasTextBefore={Boolean(firstSentence) || trailingSentences.length > 0}
        >
          {warning}
        </DeleteConsequenceParagraph>
      ) : (
        <></>
      )}
    </span>
  );
};

export default DeleteConfirmationMessage;
