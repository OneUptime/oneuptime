import React, { FunctionComponent, ReactElement } from "react";

export interface AttemptLinePart {
  text: string;
  className?: string | undefined;
}

export interface ComponentProps {
  parts: Array<AttemptLinePart>;
  testId?: string | undefined;
}

/*
 * One attempt of a check on one line - "Attempt 3/3 — Succeeded — 1,234 ms
 * — HTTP 200" - in a probe's Retry Attempts and a custom code monitor's.
 *
 * Each part in an isolate of its own: on an Arabic or Persian page
 * "1,234 ms" and "HTTP 200" ran together into one left-to-right stretch,
 * drawing "1,234 HTTP 200 — ms", the milliseconds cut from their number.
 * A part never breaks across lines ("HTTP" above its "200" on a phone), and
 * each dash stays with the part before it: a line that wraps ends in a dash
 * and the next one starts with a part, never with a dash. Figures in
 * tabular digits, not a monospace font, which spaced out the Arabic word
 * for "Attempt" letter by letter.
 */
const AttemptLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid={props.testId} className="tabular-nums">
      {props.parts.map((part: AttemptLinePart, index: number): ReactElement => {
        return (
          <React.Fragment key={index}>
            {/* Where the line may wrap: after a dash, before a part. */}
            {index > 0 ? <wbr /> : <></>}
            <span className="whitespace-nowrap">
              <bdi className={part.className}>{part.text}</bdi>
              {index < props.parts.length - 1 ? (
                <span className="mx-2 text-gray-400">—</span>
              ) : (
                <></>
              )}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default AttemptLine;
