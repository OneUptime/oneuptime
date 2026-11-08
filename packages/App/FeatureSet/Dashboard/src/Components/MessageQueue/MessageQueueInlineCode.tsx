import React, { Fragment, ReactElement } from "react";

/*
 * Catalog notes and the Broker metrics card's findings spell component
 * names, settings and metric names in backticks; they read as code here
 * rather than as stray punctuation.
 */
export function renderMessageQueueInlineCode(text: string): ReactElement {
  const parts: Array<string> = (text || "").split("`");
  return (
    <Fragment>
      {parts.map((part: string, index: number): ReactElement => {
        return index % 2 === 1 ? (
          <code
            key={`code-${index}`}
            dir="ltr"
            className="rounded bg-gray-100 px-1 font-mono text-xs text-gray-800"
          >
            {part}
          </code>
        ) : (
          <Fragment key={`text-${index}`}>{part}</Fragment>
        );
      })}
    </Fragment>
  );
}
