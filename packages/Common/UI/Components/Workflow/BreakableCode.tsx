import React, { FunctionComponent, ReactElement } from "react";

/*
 * Long machine strings - a reference such as
 * {{local.components.webhook-1.returnValues.request-headers}}, or a webhook
 * URL - shown in a box that can be narrower than they are.
 *
 * Left to the browser they wrap wherever it finds an opportunity, and in these
 * strings that is usually a hyphen inside a name: "request-" ends one line and
 * "headers}}" starts the next, which reads as two different things. Here each
 * part stays whole and a line may only break after a separator, so a reference
 * wraps as "...webhook-1." / "returnValues.request-headers}}".
 */

export type SplitAfterSeparatorFunction = (
  text: string,
  separator: string,
) => Array<string>;

/*
 * Splits after every separator, keeping it on the part before. A run of
 * separators stays together, so "https://" is never split between its slashes.
 */
export const splitAfterSeparator: SplitAfterSeparatorFunction = (
  text: string,
  separator: string,
): Array<string> => {
  const parts: Array<string> = [];
  let current: string = "";

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);
    current += character;

    const isLastCharacter: boolean = index === text.length - 1;
    const nextIsSeparator: boolean = text.charAt(index + 1) === separator;

    if (character === separator && !nextIsSeparator && !isLastCharacter) {
      parts.push(current);
      current = "";
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
};

export interface ComponentProps {
  text: string;
  breakAfter: string;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const BreakableCode: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: Array<string> = splitAfterSeparator(
    props.text,
    props.breakAfter,
  );

  return (
    <code
      className={`font-mono ${props.className || ""}`}
      data-testid={props.dataTestId}
    >
      {parts.map((part: string, index: number) => {
        return (
          <React.Fragment key={index}>
            {/*
             * font-mono on the part itself: every frontend's index.ejs sets
             * `* { font-family: Inter }`, and that rule matches the span
             * directly, so it would win over the font inherited from <code>.
             */}
            <span className="whitespace-nowrap font-mono">{part}</span>
            {index < parts.length - 1 ? <wbr /> : <></>}
          </React.Fragment>
        );
      })}
    </code>
  );
};

export default BreakableCode;
