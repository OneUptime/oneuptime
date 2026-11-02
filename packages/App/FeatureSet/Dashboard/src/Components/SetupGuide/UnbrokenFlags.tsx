import React, { ReactNode } from "react";

/*
 * A sentence that names a command-line flag - "Add --help to any of them
 * for its flags", "Ask for the fields you need with --fields" - with each
 * flag kept on one line. A browser may end a line after a hyphen, and at a
 * phone's width the Developer > CLI page broke "--help" into "--" at the
 * end of one line and "help" at the start of the next. The words are not
 * changed, so the sentence reads, and copies, as it was written.
 */

// --help, --fields, --skip: two dashes and a word, as the CLI's flags are.
const FLAG: RegExp = /(--[a-z][a-z0-9-]*)/;

export const UNBROKEN_FLAG_CLASS_NAME: string = "whitespace-nowrap";

export function withUnbrokenFlags(text: string): ReactNode {
  // With its group, split keeps each flag, at the odd places.
  const parts: Array<string> = text.split(FLAG);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part: string, index: number): ReactNode => {
    return index % 2 === 1 ? (
      <span key={index} className={UNBROKEN_FLAG_CLASS_NAME}>
        {part}
      </span>
    ) : (
      part
    );
  });
}
