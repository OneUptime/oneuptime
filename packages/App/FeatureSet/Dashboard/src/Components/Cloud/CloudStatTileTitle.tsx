import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  DrawnWords,
  getDrawnWords,
  WordRun,
} from "Common/UI/Components/HyphenatedWords/LongWords";
import { getDrawnLanguage } from "Common/UI/Components/SideMenu/SideMenuEntryState";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  TILE_TITLE_LONG_WORDS,
  TILE_TITLE_WORDS_CLASS_NAME,
} from "../TelemetryResource/TileTitleWords";

/*
 * The title of a tile in Cloud's and App Platforms' stat strips (CloudStatStrip,
 * CloudFleetSummary): small spaced capitals in the reader's language, its long
 * words hyphenated only when they are longer than a line (TileTitleWords), and
 * its (i) right after its last word.
 *
 * The (i) used to be the title's flex sibling, so a title that wrapped took
 * the row's whole width and sent its (i) to a line of its own under it - in
 * German, four tiles beside the side menu each had a third line holding
 * only the (i) (#5646's review). It follows the last word now, and goes to
 * the next line with that word when the line has no room for it: "NEEDS /
 * ATTENTION (i)" on a phone, never "NEEDS ATTENTION / (i)". A long word
 * that ends a title is not held to it - it may need to be hyphenated, which
 * a word held to the (i) cannot be.
 */

/*
 * The tiles of a strip are each three of the strip's rows (title, value,
 * line under it), handed down (grid-rows-subgrid): a title of two lines
 * moves its whole row's values down with it, so the values of a row start
 * on one line in every language. The tile's own rows sit as close as they
 * did (no gap of their own); the strip keeps its gap between tiles.
 */
export const CLOUD_STAT_TILE_ROWS_CLASS_NAME: string =
  "row-span-3 grid grid-rows-subgrid gap-y-0";

/*
 * The row of a tile's title and icon. A tile is no size container: the
 * containment one brings makes a grid lay its rows out on its own, so it
 * would no longer share the strip's. The room is measured on this row
 * instead - as wide as the tile's content - and a tile under 11rem drops
 * its icon, which only decorates.
 */
export const CLOUD_STAT_TILE_HEAD_CLASS_NAME: string =
  "mb-3 flex items-start justify-between gap-2 [container-type:inline-size]";

// The icon beside the title, gone from a tile under 11rem.
export const CLOUD_STAT_TILE_ICON_ROOM_CLASS_NAME: string =
  "[@container(max-width:10.99rem)]:hidden";

export const CLOUD_STAT_TILE_TITLE_CLASS_NAME: string =
  "min-w-0 text-xs font-medium uppercase leading-4 tracking-wider text-gray-500";

// The last word and the (i) after it, which wrap together.
export const CLOUD_STAT_TILE_TITLE_END_CLASS_NAME: string = "whitespace-nowrap";

export interface CloudStatTileTitleWords {
  // How the title's element breaks (TileTitleWords).
  className: string;
  // The words before the one the (i) is held to, in their runs.
  runs: Array<WordRun>;
  // The word the (i) is held to; empty when the (i) is not held to one.
  lastWord: string;
}

/*
 * A title's words as drawn: its runs (LongWords), and the word that ends
 * it set apart, to go with the (i) - only a short word that is never
 * hyphenated (not a long word, nor in a title of long words alone), which
 * a line can always hold beside an (i). A title in a script that writes no
 * spaces is one word: held to the (i) only while it is that short.
 */
export function getCloudStatTileTitleWords(data: {
  text: string;
  lang: string | undefined;
  hasInfo: boolean;
}): CloudStatTileTitleWords {
  const drawn: DrawnWords = getDrawnWords({
    text: data.text,
    lang: data.lang,
    rule: TILE_TITLE_LONG_WORDS,
  });
  const unheld: CloudStatTileTitleWords = {
    className: drawn.className,
    runs: drawn.runs,
    lastWord: "",
  };
  const last: WordRun | undefined = drawn.runs[drawn.runs.length - 1];

  if (
    !data.hasInfo ||
    !last ||
    last.mayHyphenate ||
    drawn.className !== TILE_TITLE_WORDS_CLASS_NAME
  ) {
    return unheld;
  }

  // The words of the last run up to its last space, and the word after it.
  const cut: number = last.text.lastIndexOf(" ") + 1;

  if (
    Array.from(last.text.slice(cut)).length >=
    TILE_TITLE_LONG_WORDS.minimumWordLength
  ) {
    return unheld;
  }

  const runs: Array<WordRun> = drawn.runs.slice(0, -1);

  if (cut > 0) {
    runs.push({ text: last.text.slice(0, cut), mayHyphenate: false });
  }

  return {
    className: drawn.className,
    runs,
    lastWord: last.text.slice(cut),
  };
}

export interface ComponentProps {
  // English, drawn in the reader's language.
  title: string;
  // What the (i) says; no (i) without it.
  description?: string | undefined;
  dataTestId?: string | undefined;
}

const CloudStatTileTitle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string = translator.translateText(props.title) || props.title;
  // The language the title is drawn in, when it is the reader's.
  const titleLanguage: string | undefined = getDrawnLanguage({
    english: props.title,
    drawn: title,
    language: translator.language,
  });
  const words: CloudStatTileTitleWords = getCloudStatTileTitleWords({
    text: title,
    lang: titleLanguage,
    hasInfo: Boolean(props.description),
  });
  const info: ReactElement = props.description ? (
    <InfoTooltip
      label={props.title}
      text={props.description}
      className="ms-1 align-middle"
    />
  ) : (
    <></>
  );

  return (
    <div
      data-testid={props.dataTestId}
      className={CLOUD_STAT_TILE_TITLE_CLASS_NAME}
    >
      <span className={words.className} lang={titleLanguage}>
        {words.runs.map((run: WordRun, index: number): ReactElement => {
          if (run.mayHyphenate) {
            return (
              <span
                key={index}
                className={TILE_TITLE_LONG_WORDS.longWordClassName}
              >
                {run.text}
              </span>
            );
          }

          return <Fragment key={index}>{run.text}</Fragment>;
        })}
        {words.lastWord ? (
          <span className={CLOUD_STAT_TILE_TITLE_END_CLASS_NAME}>
            {words.lastWord}
            {info}
          </span>
        ) : (
          <></>
        )}
      </span>
      {words.lastWord ? <></> : info}
    </div>
  );
};

export default CloudStatTileTitle;
