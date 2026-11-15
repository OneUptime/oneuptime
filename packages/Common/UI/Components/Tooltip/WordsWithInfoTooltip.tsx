import React, { Fragment, FunctionComponent, ReactElement } from "react";
import InfoTooltip from "./InfoTooltip";
import { LongWordHyphenation, WordRun } from "../HyphenatedWords/LongWords";
import {
  INFO_AFTER_WORDS_CLASS_NAME,
  INFO_GLUE_CLASS_NAME,
  WORDS_KEEP_INFO_ROOM_CLASS_NAME,
  WordsBeforeInfo,
  getWordsBeforeInfo,
} from "../HyphenatedWords/WordsBeforeInfo";

/*
 * A title's words with the (i) that explains it after its last word, in the
 * title's own line of text (WordsBeforeInfo): a title that wraps keeps its
 * (i) after the word it ends on - on the left of that word in a language
 * read from the right - and never alone at the start of a line: the words
 * keep the (i)'s room free on every line, so they wrap (or hyphenate) where
 * they must and the (i) always fits after the last of them. Never at the
 * far edge of its tile either, as the flex sibling it used to be (issue
 * #7348).
 *
 * The words are one element (a span) that the caller puts in its own - a
 * tile's title, a section's heading, a definition list's term - so the (i)
 * is always a descendant of the element holding the words. The words stay
 * the text they were. Without a description it draws the words alone, as
 * the (i) draws nothing then.
 *
 * The (i) keeps its own label and focus ring (InfoTooltip): its button is
 * named "About <label>" for screen readers, whatever words it follows.
 */

export interface ComponentProps {
  // The words, as drawn: in the reader's language, or left in English.
  text: string;
  /*
   * What the (i) explains, for its spoken name ("About {{label}}"): the
   * English title InfoTooltip translates, as it always took it.
   */
  label: string;
  // What the (i) says. No (i) without it - only the words.
  description?: string | undefined;
  /*
   * The language the words are drawn in, when it is the reader's
   * (getDrawnLanguage) - set as the element's lang, for a rule to hyphenate
   * in. Left unset for words the page draws in its own language.
   */
  lang?: string | undefined;
  /*
   * How long words may be hyphenated (LongWords, TileTitleWords). Without
   * one the words break between words only, as most titles do.
   */
  rule?: LongWordHyphenation | undefined;
  // The element's own classes, beside the ones that say how its words break.
  className?: string | undefined;
  dataTestId?: string | undefined;
  infoDataTestId?: string | undefined;
  /*
   * The (i)'s own classes, beside the ones that put it after the words: a
   * linked tile lifts it above the link laid over the tile ("relative
   * z-10"), so a press on it never follows the link.
   */
  infoClassName?: string | undefined;
}

// The attribute of the box that holds the (i) after the last word.
export const INFO_GLUE_ATTRIBUTE: string = "data-info-glue";

const WordsWithInfoTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const description: string = (props.description || "").trim();
  const words: WordsBeforeInfo = getWordsBeforeInfo({
    text: props.text,
    lang: props.lang,
    rule: props.rule,
  });

  /*
   * The (i), in a box of its own after the last word. It adds no width to
   * the line: it sits in the room the words keep free for it.
   */
  const info: ReactElement | null = description ? (
    <span className={INFO_GLUE_CLASS_NAME} {...{ [INFO_GLUE_ATTRIBUTE]: "" }}>
      <InfoTooltip
        label={props.label}
        text={description}
        className={[INFO_AFTER_WORDS_CLASS_NAME, props.infoClassName]
          .filter(Boolean)
          .join(" ")}
        dataTestId={props.infoDataTestId}
      />
    </span>
  ) : null;

  // A long word of a rule is drawn in its own box, which may be hyphenated.
  const longWordClassName: string = props.rule?.longWordClassName || "";
  const lastIndex: number = words.runs.length - 1;

  const className: string = [
    props.className,
    words.className,
    info ? WORDS_KEEP_INFO_ROOM_CLASS_NAME : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      lang={props.lang}
      data-testid={props.dataTestId}
    >
      {words.runs.map((run: WordRun, index: number): ReactElement => {
        if (run.mayHyphenate) {
          return (
            <span key={index} className={longWordClassName}>
              {run.text}
              {/* A long word that ends the title holds the (i) in its box. */}
              {index === lastIndex && words.isInfoInLastRun ? info : null}
            </span>
          );
        }

        return <Fragment key={index}>{run.text}</Fragment>;
      })}
      {words.isInfoInLastRun ? null : info}
    </span>
  );
};

export default WordsWithInfoTooltip;
