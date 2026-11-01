import React, { FunctionComponent, ReactElement } from "react";
import {
  DrawnWords,
  getDrawnWords,
  LongWordHyphenation,
  WordRun,
} from "./LongWords";

/*
 * Text drawn so that only its long words may be hyphenated (LongWords): the
 * runs of getDrawnWords, for the element that holds them, which takes
 * getDrawnWords' className and the words' lang.
 */
export interface ComponentProps {
  // The words as drawn, translated or not.
  text: string | undefined;
  // The language they are drawn in, when it is the reader's (getDrawnLanguage).
  lang: string | undefined;
  rule: LongWordHyphenation;
}

const HyphenatedWords: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const drawn: DrawnWords = getDrawnWords(props);

  return (
    <>
      {drawn.runs.map((run: WordRun, index: number): ReactElement => {
        if (run.mayHyphenate) {
          return (
            <span key={index} className={props.rule.longWordClassName}>
              {run.text}
            </span>
          );
        }

        return <React.Fragment key={index}>{run.text}</React.Fragment>;
      })}
    </>
  );
};

export default HyphenatedWords;
