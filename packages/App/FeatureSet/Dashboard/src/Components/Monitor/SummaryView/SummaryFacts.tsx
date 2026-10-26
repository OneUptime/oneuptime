import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  createContext,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
} from "react";

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
 * follow the summary's own width now, not the screen's - the same view sits
 * in a narrow card and in wide dialogs at one screen width (the container
 * query ExternalStatusPageMonitorView proved in #5207):
 *
 *   - one fact a row while the summary is narrower than 22rem, as on a
 *     phone. Two to a row there left each value about 100px, and broke
 *     hostnames, dates and error codes mid-word ("ECONNREFUS-ED");
 *   - two to a row from 22rem (the Summary card beside a tablet's side
 *     menu), four from 64rem (a wide dialog);
 *   - a row the facts leave short - the fifth of five, two to a row - is
 *     shared by the facts on it, so no row ends in a hole.
 *
 * A value breaks where it must rather than run out of its card, a fact
 * that reads as a sentence (an address, an error) takes the whole row, and
 * a title too long for its card hyphenates in the reader's language (the
 * facts carry lang).
 */

// The view: its own width decides how its facts lay out.
export const SUMMARY_VIEW_CLASS_NAME: string =
  "space-y-5 [container-type:inline-size]";

/*
 * The facts: rows that wrap. Each fact takes its share of a row and grows
 * into what its row leaves over, which is how a short last row is shared.
 */
export const SUMMARY_FACTS_CLASS_NAME: string = "flex flex-wrap gap-3";

/*
 * A fact's share of a row: the whole row below 22rem, half from 22rem, a
 * quarter from 64rem. Each share leaves out a whole gap (0.75rem), so the
 * facts that should share a row always fit on it; growing takes up the
 * rest.
 */
export const SUMMARY_FACT_SHARE_CLASS_NAME: string =
  "basis-full [@container(min-width:22rem)]:basis-[calc(50%-0.75rem)] [@container(min-width:64rem)]:basis-[calc(25%-0.75rem)]";

/*
 * Three facts that belong together - a disk's size, used and free: one
 * under another below 22rem, side by side from 22rem.
 */
export const SUMMARY_FACT_IN_THREES_SHARE_CLASS_NAME: string =
  "basis-full [@container(min-width:22rem)]:basis-[calc(33.333%-0.75rem)]";

// A fact that reads as a sentence: the whole row at every width.
export const SUMMARY_WIDE_FACT_CLASS_NAME: string = "basis-full";

/*
 * A fact's card: one that may shrink below its longest word (min-w-0) and
 * grows into what its row leaves, with a title that may break inside a
 * word - hyphenated in the reader's language - rather than run past it.
 */
export const SUMMARY_FACT_CARD_CLASS_NAME: string =
  "min-w-0 grow shadow-none border-2 border-gray-100 [&_label]:hyphens-auto [&_label]:[overflow-wrap:anywhere]";

/*
 * A fact's padding: a stat tile's p-5 once the view is 32rem wide, less on
 * a phone.
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
 * a frame. The frame used to hide what did not fit, so a long TXT record or
 * OID value was cut off at the card's edge with no way to read it. Now the
 * frame scrolls rather than clips whatever cannot fit.
 */
export const SUMMARY_TABLE_FRAME_CLASS_NAME: string =
  "overflow-x-auto rounded-md border";

/*
 * The one column of a table that holds long values (a record, an OID's
 * value): it breaks anywhere it must, so it gives way and the table fits
 * its frame.
 */
export const SUMMARY_TABLE_VALUE_CLASS_NAME: string =
  "[overflow-wrap:anywhere]";

/*
 * Any other column of words (a resolver, a name server, an error): it
 * breaks between words, never inside one. A column that could break
 * anywhere could also be squeezed to one letter a line once the table ran
 * out of room, as a DNSSEC check's errors were at 390.
 */
export const SUMMARY_TABLE_TEXT_CLASS_NAME: string = "break-words";

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
  // Three facts that belong together (SUMMARY_FACT_IN_THREES_SHARE_CLASS_NAME).
  isInThrees?: boolean | undefined;
  dataTestId?: string | undefined;
}

// Whether the facts drawn inside go three to a row (SummaryFacts isInThrees).
const SummaryFactsInThreesContext: React.Context<boolean> =
  createContext<boolean>(false);

// A group of facts, laid out by the view's width.
export const SummaryFacts: FunctionComponent<SummaryFactsProps> = (
  props: SummaryFactsProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <SummaryFactsInThreesContext.Provider value={Boolean(props.isInThrees)}>
      <div
        className={SUMMARY_FACTS_CLASS_NAME}
        lang={translator.language}
        data-testid={props.dataTestId || SUMMARY_FACTS_TEST_ID}
      >
        {props.children}
      </div>
    </SummaryFactsInThreesContext.Provider>
  );
};

// The share of a row a fact takes: the whole row, or its group's share.
export const getSummaryFactShareClassName: (data: {
  isWide: boolean;
  isInThrees: boolean;
}) => string = (data: { isWide: boolean; isInThrees: boolean }): string => {
  if (data.isWide) {
    return SUMMARY_WIDE_FACT_CLASS_NAME;
  }

  return data.isInThrees
    ? SUMMARY_FACT_IN_THREES_SHARE_CLASS_NAME
    : SUMMARY_FACT_SHARE_CLASS_NAME;
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

// One fact: its share of a row of its SummaryFacts, or the whole row.
export const SummaryFact: FunctionComponent<SummaryFactProps> = (
  props: SummaryFactProps,
): ReactElement => {
  const isInThrees: boolean = useContext(SummaryFactsInThreesContext);

  return (
    <InfoCard
      className={`${SUMMARY_FACT_CARD_CLASS_NAME} ${getSummaryFactShareClassName(
        {
          isWide: Boolean(props.isWide),
          isInThrees: isInThrees,
        },
      )}`}
      textClassName={SUMMARY_FACT_VALUE_CLASS_NAME}
      title={props.title}
      value={props.value}
      tooltip={props.tooltip}
      dataTestId={props.dataTestId || SUMMARY_FACT_TEST_ID}
      paddingClassName={SUMMARY_FACT_PADDING_CLASS_NAME}
    />
  );
};
