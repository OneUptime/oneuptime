import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The facts one check of a monitor found - the probe, the status, the
 * response time, when it ran - drawn the same way by every monitor type's
 * summary: on the overview's Monitor Summary card (two thirds of the page),
 * in Test Monitor's result, in Monitoring Logs' View Summary and on the
 * incident and alert pages' snapshots.
 *
 * The views drew them as a flex row of quarter- or fifth-width cards. In
 * the Summary card at 1280 that squeezed every value into a column a word
 * wide ("Sep 21, / 2026, / 12:00 / PM"), and at 390 the row was wider than
 * the phone, so the card scrolled sideways under the reader's thumb. They
 * are a grid now that follows the summary's own width, not the screen's -
 * the same view sits in a narrow card and in wide dialogs at one screen
 * width: two to a row, and four once the summary itself is 64rem wide
 * (the container query ExternalStatusPageMonitorView proved in #5207).
 * A value breaks where it must rather than run out of its card, a fact
 * that reads as a sentence (an address, an error) takes the whole row, and
 * a title too long for its card hyphenates in the reader's language (the
 * grid carries lang).
 */

// The view: its own width decides how its facts lay out.
export const SUMMARY_VIEW_CLASS_NAME: string =
  "space-y-5 [container-type:inline-size]";

// The facts: two to a row, four once the view is 64rem wide.
export const SUMMARY_FACTS_CLASS_NAME: string =
  "grid grid-cols-2 gap-3 [@container(min-width:64rem)]:grid-cols-4";

/*
 * Three facts that belong together - a disk's size, used and free - one
 * under another on a phone, and side by side once the view is 24rem wide.
 */
export const SUMMARY_FACTS_IN_THREES_CLASS_NAME: string =
  "grid grid-cols-1 gap-3 [@container(min-width:24rem)]:grid-cols-3";

/*
 * A fact's card: a grid cell that may shrink below its longest word
 * (min-w-0), with a title that may break inside a word - hyphenated in the
 * reader's language - rather than run past the card.
 */
export const SUMMARY_FACT_CARD_CLASS_NAME: string =
  "w-full min-w-0 shadow-none border-2 border-gray-100 [&_label]:hyphens-auto [&_label]:[overflow-wrap:anywhere]";

// A fact that reads as a sentence: the whole row.
export const SUMMARY_WIDE_FACT_CLASS_NAME: string = "col-span-full";

/*
 * A fact's padding: a stat tile's p-5 once the view is 32rem wide, less on
 * a phone, where two cards to a row left each value a column of 90px.
 */
export const SUMMARY_FACT_PADDING_CLASS_NAME: string =
  "p-4 [@container(min-width:32rem)]:p-5";

/*
 * A fact's value: a size smaller while the view is narrower than 32rem (a
 * phone), and a long word - a URL, an id - broken rather than run out of its
 * card.
 */
export const SUMMARY_FACT_VALUE_CLASS_NAME: string =
  "text-sm text-gray-900 break-words [@container(min-width:32rem)]:text-base";

/*
 * A list a check found - DNS records, OIDs, a query's rows - as a table in
 * a frame. The frame used to hide what did not fit, so a
 * long TXT record or OID value was cut off at the card's edge with no way to
 * read it; a value cell now breaks anywhere it must, so the table fits its
 * frame, and the frame scrolls rather than clips whatever still cannot.
 */
export const SUMMARY_TABLE_FRAME_CLASS_NAME: string =
  "overflow-x-auto rounded-md border";

export const SUMMARY_TABLE_VALUE_CLASS_NAME: string =
  "[overflow-wrap:anywhere]";

/*
 * A row of a phase breakdown (Request Phase Breakdown, Connection Phase
 * Breakdown): the phase, its bar, its time. The name and the time gave the
 * bar what was left of a phone's width after 240px of their own - a bar a
 * few pixels long. They take less while the view is narrow.
 */
export const TIMING_LABEL_CLASS_NAME: string =
  "w-24 shrink-0 text-gray-700 [overflow-wrap:anywhere] [@container(min-width:32rem)]:w-36";

export const TIMING_VALUE_CLASS_NAME: string =
  "w-20 shrink-0 text-right text-gray-700 font-mono [@container(min-width:32rem)]:w-24";

export const SUMMARY_VIEW_TEST_ID: string = "monitor-summary-view";
export const SUMMARY_FACTS_TEST_ID: string = "monitor-summary-facts";
export const SUMMARY_FACT_TEST_ID: string = "monitor-summary-fact";

export interface SummaryViewProps {
  children: ReactNode;
  dataTestId?: string | undefined;
}

// A monitor type's summary: what its facts and lists lay out in.
export const SummaryView: FunctionComponent<SummaryViewProps> = (
  props: SummaryViewProps,
): ReactElement => {
  return (
    <div
      className={SUMMARY_VIEW_CLASS_NAME}
      data-testid={props.dataTestId || SUMMARY_VIEW_TEST_ID}
    >
      {props.children}
    </div>
  );
};

export interface SummaryFactsProps {
  children: ReactNode;
  // Three facts that belong together (SUMMARY_FACTS_IN_THREES_CLASS_NAME).
  isInThrees?: boolean | undefined;
  dataTestId?: string | undefined;
}

// A group of facts, laid out by the view's width.
export const SummaryFacts: FunctionComponent<SummaryFactsProps> = (
  props: SummaryFactsProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className={
        props.isInThrees
          ? SUMMARY_FACTS_IN_THREES_CLASS_NAME
          : SUMMARY_FACTS_CLASS_NAME
      }
      lang={translator.language}
      data-testid={props.dataTestId || SUMMARY_FACTS_TEST_ID}
    >
      {props.children}
    </div>
  );
};

export interface SummaryFactProps {
  // English; looked up when drawn (InfoCard).
  title: string;
  value: string | ReactElement;
  // A fact that reads as a sentence - an address, an error - takes the row.
  isWide?: boolean | undefined;
  // What the value means, in an (i) beside the title.
  tooltip?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * One fact: a cell of its SummaryFacts grid, or the whole row when it is
 * wide.
 */
export const SummaryFact: FunctionComponent<SummaryFactProps> = (
  props: SummaryFactProps,
): ReactElement => {
  return (
    <InfoCard
      className={
        props.isWide
          ? `${SUMMARY_FACT_CARD_CLASS_NAME} ${SUMMARY_WIDE_FACT_CLASS_NAME}`
          : SUMMARY_FACT_CARD_CLASS_NAME
      }
      textClassName={SUMMARY_FACT_VALUE_CLASS_NAME}
      title={props.title}
      value={props.value}
      tooltip={props.tooltip}
      dataTestId={props.dataTestId || SUMMARY_FACT_TEST_ID}
      paddingClassName={SUMMARY_FACT_PADDING_CLASS_NAME}
    />
  );
};
