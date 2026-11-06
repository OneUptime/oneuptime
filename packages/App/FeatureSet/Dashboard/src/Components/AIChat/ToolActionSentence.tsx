import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import React, { FunctionComponent, ReactElement } from "react";
import { DrawnActionSentence } from "./ToolActionWords";

export interface ComponentProps {
  sentence: DrawnActionSentence;
  className?: string | undefined;
}

/*
 * ONE SENTENCE OF AN AI ACTION'S CARD, READ THE WAY ITS LANGUAGE IS.
 *
 * Worded in the reader's language (ToolActionWords), a sentence is an
 * isolate that reads its language's way: a Persian title right to left
 * however much of it is an English name, with each value set apart so its
 * punctuation stays where the sentence puts it. The English an action
 * stores - an action saved before its words, a tool's own name - is read
 * the way most of its letters are (IsolatedText), as it always was.
 */
const ToolActionSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.sentence.direction) {
    return (
      <IsolatedText text={props.sentence.text} className={props.className} />
    );
  }

  return (
    <bdi dir={props.sentence.direction} className={props.className}>
      {props.sentence.text}
    </bdi>
  );
};

export interface SentencesProps {
  sentences: Array<DrawnActionSentence>;
}

// The sentences of a line, one after another.
export const ToolActionSentences: FunctionComponent<SentencesProps> = (
  props: SentencesProps,
): ReactElement => {
  return (
    <>
      {props.sentences.map(
        (sentence: DrawnActionSentence, index: number): ReactElement => {
          return (
            <React.Fragment key={index}>
              {sentence.separatorBefore}
              <ToolActionSentence sentence={sentence} />
            </React.Fragment>
          );
        },
      )}
    </>
  );
};

export default ToolActionSentence;
