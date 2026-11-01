import TextArea from "Common/UI/Components/TextArea/TextArea";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A store's scan exclusions - path prefixes, tables, attribute keys the
 * content scan skips - written one per line. The store keeps them as a
 * list; the box keeps the text as typed, so a blank line being written is
 * not swallowed, and hands the form the list.
 */

// The list a store keeps, from the lines typed: trimmed, without blanks or repeats.
export function parseScanExclusions(text: string): Array<string> {
  const exclusions: Array<string> = [];

  for (const line of text.split("\n")) {
    const exclusion: string = line.trim();

    if (exclusion && !exclusions.includes(exclusion)) {
      exclusions.push(exclusion);
    }
  }

  return exclusions;
}

export function formatScanExclusions(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((entry: unknown): entry is string => {
          return typeof entry === "string";
        })
        .join("\n")
    : "";
}

export interface ComponentProps {
  initialValue: unknown;
  onChange: (exclusions: Array<string>) => void;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  error?: string | undefined;
}

const StoreExclusionsInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [text, setText] = useState<string>(
    formatScanExclusions(props.initialValue),
  );

  return (
    <TextArea
      value={text}
      placeholder={props.placeholder}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      error={props.error}
      autoGrow={true}
      rows={3}
      disableSpellCheck={true}
      onChange={(value: string) => {
        setText(value);
        props.onChange(parseScanExclusions(value));
      }}
    />
  );
};

export default StoreExclusionsInput;
