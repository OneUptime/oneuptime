import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A LINE ONEUPTIME WROTE, AS ITS READER READS IT: in their own words, from
 * the code read from it (#7260, #8330), or else as the server wrote it.
 * Words the server wrote - a line OneUptime has no code for, a provider's
 * own error - read the way they are written on a page read the other way
 * (#7182): an English line on an Arabic or Persian page keeps its phone
 * number and its full stop where they were written, and, run onto more
 * lines, each of its lines starts at its own start, at the page's side
 * (IsolatedLine) - not ragged where an English reader starts reading.
 *
 * A test page's result draws its lines with it (TestPageResult), and so do
 * the on-call logs' View Status Message dialogs (OnCallLogLineWords).
 */

export interface ComponentProps {
  // The line as the server wrote it.
  statusMessage: string;
  // The reader's words for it; null for a line they are not given.
  words: string | null;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const ResultLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.words !== null) {
    return (
      <p className={props.className} data-testid={props.dataTestId}>
        {props.words}
      </p>
    );
  }

  return (
    <IsolatedLine
      as="p"
      text={props.statusMessage}
      className={props.className}
      dataTestId={props.dataTestId}
    />
  );
};

export default ResultLine;
