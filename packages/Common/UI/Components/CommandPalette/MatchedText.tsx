import { getHighlightSegments, PaletteHighlightSegment } from "./PaletteFilter";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How a search marks what it matched: a soft yellow ground under the
 * matched letters, the text keeping its own colour. Search (Cmd/Ctrl+K) and
 * the project list's search mark a match alike, so the mark means one thing
 * wherever it is seen; the dark theme gives the ground its own shade
 * (Theme.css).
 *
 * The ground reaches a little past the letters on each side (px-0.5)
 * without moving them (-mx-0.5): a mark that took room of its own split
 * the word it sat in, so with "kube" typed "Kubernetes" read "Kube
 * rnetes", and Search's "Monitors" read "Mon itors" for "mon".
 */
export const MATCHED_TEXT_MARK_CLASS_NAME: string =
  "-mx-0.5 rounded-sm bg-yellow-100 px-0.5 text-inherit";

export interface ComponentProps {
  text: string;
  // What was typed, read the way the search reads it (getHighlightSegments).
  search: string;
}

/*
 * Text with the parts a search matched marked (<mark>): each word typed
 * where it starts a word of the text, and the whole search where it runs
 * across words or sits inside one. A typo, a name's initials and its
 * letters found in order mark nothing - a letter marked here and there
 * reads as noise - and with nothing typed the text is drawn as it is.
 */
const MatchedText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const segments: Array<PaletteHighlightSegment> = getHighlightSegments(
    props.text,
    props.search,
  );

  return (
    <>
      {segments.map((segment: PaletteHighlightSegment, index: number) => {
        if (!segment.isMatch) {
          return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        }

        return (
          <mark key={index} className={MATCHED_TEXT_MARK_CLASS_NAME}>
            {segment.text}
          </mark>
        );
      })}
    </>
  );
};

export default MatchedText;
