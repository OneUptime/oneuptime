import CopyTextButton from "../CopyTextButton/CopyTextButton";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE REFERENCE OF A FAILURE THE SERVER COULD NOT EXPLAIN, WITH ITS COPY
 * BUTTON (#6836, #7622).
 *
 * The one place a reference is drawn: the start of the request's id, which
 * a person gives to whoever runs the server, who finds the failure's log
 * lines by it. Drawn as code, left to right in every script, so its eight
 * characters never turn round on an Arabic or a Persian page, with a copy
 * button beside it.
 *
 * Two ways, one look:
 *
 *   - On a line of its own, under the explanation's lines (ErrorExplanation:
 *     a list or a table that did not load, a form's alert, a dialog, a
 *     widget's error, the notes feed). The reference and its button are one
 *     inline box on that line, so the line places it as it places the words
 *     above it: centred under centred lines - ErrorMessage, a table's failed
 *     load (TableEmptyState), the notes feed, a widget's error line, a public
 *     dashboard's placeholder - and at their start where they start, which
 *     is the right on a page read from the right. Nothing has to say which.
 *     It was a row of its own laid out from its start (a block flexbox,
 *     which the line's alignment never reaches), centred only where the page
 *     remembered to say so (isCentered): a table's failed load never did,
 *     and its reference sat about 150px off the centre of the lines above.
 *   - Inside a sentence (ErrorInSentence: a card's own sentence with
 *     {{error}} in it), closing that sentence with its full stop, and a copy
 *     button of its icon alone, whose name ("Copy") and state ("Copied!") a
 *     screen reader hears, so no word of it runs into the card's words.
 */

export const ERROR_REFERENCE_TEST_ID: string = "error-reference";

// The line a reference of its own sits on, under the explanation's lines.
export const ERROR_REFERENCE_LINE_TEST_ID: string = "error-reference-line";

export interface ComponentProps {
  // The reference: eight hex digits (isErrorReference).
  reference: string;
  /*
   * Drawn inside a sentence, which it closes with this full stop - the one
   * of the sentence's language (ErrorInSentenceWords' fullStop). Drawn on a
   * line of its own when not given.
   */
  fullStopInSentence?: string | undefined;
}

const ErrorReference: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.fullStopInSentence !== undefined) {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap align-middle"
        data-testid={ERROR_REFERENCE_TEST_ID}
      >
        <span>
          <code
            dir="ltr"
            className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-900"
          >
            {props.reference}
          </code>
          {props.fullStopInSentence}
        </span>
        <CopyTextButton
          textToBeCopied={props.reference}
          size="xs"
          iconOnly={true}
        />
      </span>
    );
  }

  return (
    /*
     * A block line of its own, whose one inline box the line's alignment
     * places (text-align, inherited from the lines around it): never a flex
     * row, which lays its items out from its own start whatever the lines
     * above do. align-top keeps the line as tall as the box, with no gap
     * under it for letters that hang below the line.
     */
    <span className="mt-2 block" data-testid={ERROR_REFERENCE_LINE_TEST_ID}>
      <span
        className="inline-flex max-w-full flex-wrap items-center gap-2 align-top"
        data-testid={ERROR_REFERENCE_TEST_ID}
      >
        <code
          dir="ltr"
          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-900"
        >
          {props.reference}
        </code>
        <CopyTextButton textToBeCopied={props.reference} size="sm" />
      </span>
    </span>
  );
};

export default ErrorReference;
