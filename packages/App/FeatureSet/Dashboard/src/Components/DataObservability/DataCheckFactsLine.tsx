import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // What the line says, fact by fact, each in the reader's words.
  facts: Array<string>;
  dataTestId?: string | undefined;
}

/*
 * The line: small and grey under a name, and free to wrap - a table's cell
 * keeps its words on one line (whitespace-nowrap), and the facts would not
 * wrap there.
 */
export const DATA_CHECK_FACTS_LINE_CLASS_NAME: string =
  "block whitespace-normal text-xs text-gray-500";

/*
 * One fact of the line, with the mark that sets it apart from the next one
 * after it: a box of its own, so the line wraps only between two facts - a
 * fact never breaks across lines, and no line starts with a mark - and no
 * wider than the line, so a fact too long for the line alone (a long
 * column's name) ends in "...". Its spaces are kept as written
 * (whitespace-pre): at the end of a box of its own, the space after the
 * mark was dropped, and the next fact stood against it ("Zeilen ·total").
 * At the top of the line, as a box whose words are cut short would
 * otherwise sit on its bottom edge, above the words beside it.
 */
export const DATA_CHECK_FACT_CLASS_NAME: string =
  "inline-block max-w-full overflow-hidden text-ellipsis whitespace-pre align-top";

/*
 * The line under a data check's name: what it measures, then the column it
 * reads, how it is split and where it came from - in the Checks list, and
 * under each of the Suggested Checks. Each fact reads its own way (bdi),
 * set apart the way the reader's language sets facts apart
 * (InlineSeparator).
 *
 * In German the Checks list's line - "Anzahl verwaister Zeilen ·
 * customer_account_reference_id · Aus einer Datei" - was one line cut short
 * with an ellipsis: it lost "Aus einer Datei" (the check is kept in a file)
 * on a phone and at 768px, and at 1280px it held the Name column at its
 * 20rem cap. It wraps now, between two facts.
 */
const DataCheckFactsLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span
      className={DATA_CHECK_FACTS_LINE_CLASS_NAME}
      data-testid={props.dataTestId}
    >
      {props.facts.map((fact: string, index: number): ReactElement => {
        return (
          <React.Fragment key={index}>
            {/* Where the line may wrap: after a mark, before a fact. */}
            {index > 0 ? <wbr /> : <></>}
            <span className={DATA_CHECK_FACT_CLASS_NAME}>
              <bdi>{fact}</bdi>
              {index < props.facts.length - 1 ? <InlineSeparator /> : <></>}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
};

export default DataCheckFactsLine;
