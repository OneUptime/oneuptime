/*
 * The text model behind a setting that can hold references.
 *
 * What is stored is a plain string - "Body: {{local.components.webhook-1.
 * returnValues.request-body}}" - exactly as the runner reads it. The editor
 * shows it as runs of text and reference chips; these helpers split it into
 * those runs, edit it by offset, and find the "{{" someone is typing a
 * reference after. Offsets are always offsets into the stored string, so a
 * chip is as long as the reference it stands for.
 *
 * Pure: no DOM.
 */

import { isChipReference } from "./ReferenceDescription";
import {
  TemplateExpression,
  parseTemplateExpressions,
} from "../../../../Types/Workflow/TemplateSyntax";

export enum TemplateSegmentKind {
  Text = "Text",
  Reference = "Reference",
}

export interface TemplateSegment {
  kind: TemplateSegmentKind;
  /** The segment's text in the stored value; a reference with its braces. */
  text: string;
  /** Where the segment starts in the stored value. */
  start: number;
}

export type SplitTemplateTextFunction = (value: string) => Array<TemplateSegment>;

/**
 * The value as runs of text and references. Only a well-formed reference is
 * a reference here (see isChipReference); a loop tag, or a reference with a
 * space in it, stays part of the text around it. Adjacent text is one run.
 */
export const splitTemplateText: SplitTemplateTextFunction = (
  value: string,
): Array<TemplateSegment> => {
  const text: string = typeof value === "string" ? value : "";
  const segments: Array<TemplateSegment> = [];
  let cursor: number = 0;

  type PushTextFunction = (until: number) => void;

  const pushText: PushTextFunction = (until: number): void => {
    if (until <= cursor) {
      return;
    }

    const last: TemplateSegment | undefined = segments[segments.length - 1];
    const slice: string = text.slice(cursor, until);

    if (last && last.kind === TemplateSegmentKind.Text) {
      last.text += slice;
    } else {
      segments.push({
        kind: TemplateSegmentKind.Text,
        text: slice,
        start: cursor,
      });
    }

    cursor = until;
  };

  for (const expression of parseTemplateExpressions(text)) {
    if (!isChipReference(expression.raw)) {
      continue;
    }

    pushText(expression.startIndex);
    segments.push({
      kind: TemplateSegmentKind.Reference,
      text: expression.raw,
      start: expression.startIndex,
    });
    cursor = expression.endIndex;
  }

  pushText(text.length);

  return segments;
};

export interface TextEditResult {
  value: string;
  /** Where the caret goes: just after what was inserted. */
  caret: number;
}

export type ReplaceRangeFunction = (
  value: string,
  start: number,
  end: number,
  insert: string,
) => TextEditResult;

export const replaceRange: ReplaceRangeFunction = (
  value: string,
  start: number,
  end: number,
  insert: string,
): TextEditResult => {
  const from: number = Math.max(0, Math.min(start, end, value.length));
  const to: number = Math.min(value.length, Math.max(start, end, 0));

  return {
    value: value.slice(0, from) + insert + value.slice(to),
    caret: from + insert.length,
  };
};

export interface ReferenceTrigger {
  /** Where the "{{" starts. */
  start: number;
  /** What has been typed after it, e.g. "local.comp" or "body". */
  query: string;
  /**
   * Where the replacement ends: the caret, or past a "}}" that is already
   * there, so picking a value does not leave a stray pair of braces behind.
   */
  end: number;
}

/*
 * What may follow "{{" while a reference is still being typed: a path, or
 * the words being searched for.
 */
const TRIGGER_QUERY_PATTERN: RegExp = /^[A-Za-z0-9_.\-[\] ]*$/;
const MAX_TRIGGER_QUERY_LENGTH: number = 80;

export type FindReferenceTriggerFunction = (
  value: string,
  caret: number,
) => ReferenceTrigger | null;

/**
 * The reference being typed at the caret: "Hello {{web" with the caret at the
 * end is a trigger with the query "web". None once the reference is closed,
 * across a line break, for a loop tag ("{{#each") or past a few words.
 */
export const findReferenceTrigger: FindReferenceTriggerFunction = (
  value: string,
  caret: number,
): ReferenceTrigger | null => {
  if (typeof value !== "string" || caret < 2 || caret > value.length) {
    return null;
  }

  const before: string = value.slice(0, caret);
  const start: number = before.lastIndexOf("{{");

  if (start === -1) {
    return null;
  }

  const query: string = before.slice(start + 2);

  if (
    query.length > MAX_TRIGGER_QUERY_LENGTH ||
    query.includes("}") ||
    query.includes("{") ||
    query.includes("\n") ||
    query.startsWith(" ") ||
    !TRIGGER_QUERY_PATTERN.test(query)
  ) {
    return null;
  }

  const after: string = value.slice(caret);
  const closes: number = after.startsWith("}}") ? 2 : 0;

  return {
    start: start,
    query: query,
    end: caret + closes,
  };
};

export type IsInsideJSONStringFunction = (
  text: string,
  offset: number,
  allowSingleQuotes?: boolean,
) => boolean;

/**
 * Whether `offset` is inside a string literal of the JSON document `text`.
 * Escapes are honoured; a single-quoted string counts too when the document is
 * read as JSON5.
 */
export const isInsideJSONString: IsInsideJSONStringFunction = (
  text: string,
  offset: number,
  allowSingleQuotes?: boolean,
): boolean => {
  let quote: string | null = null;

  for (let index: number = 0; index < Math.min(offset, text.length); index++) {
    const character: string = text.charAt(index);

    if (quote) {
      if (character === "\\") {
        // Skip what is escaped, whatever it is.
        index++;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || (allowSingleQuotes && character === "'")) {
      quote = character;
    }
  }

  return quote !== null;
};

export type ReferenceForJSONFunction = (data: {
  text: string;
  start: number;
  end: number;
  reference: string;
  allowJSON5?: boolean | undefined;
}) => string;

/**
 * What to insert for a reference in a JSON document, so the document stays
 * JSON. The runner escapes a resolved value for a JSON string (VMAPI
 * replaceValueInPlace), so a reference belongs inside quotes: where the caret
 * is not already in a string, the quotes come with it. A field that holds
 * nothing else takes the reference bare - then the whole value is replaced by
 * what it resolves to, object and all.
 */
export const referenceForJSON: ReferenceForJSONFunction = (data: {
  text: string;
  start: number;
  end: number;
  reference: string;
  allowJSON5?: boolean | undefined;
}): string => {
  const remaining: string =
    data.text.slice(0, data.start) + data.text.slice(data.end);

  if (remaining.trim() === "") {
    return data.reference;
  }

  if (isInsideJSONString(data.text, data.start, data.allowJSON5)) {
    return data.reference;
  }

  return `"${data.reference}"`;
};

export type ReferencesInFunction = (value: string) => Array<string>;

/** Every chip-worthy reference in a value, in order. */
export const referencesIn: ReferencesInFunction = (
  value: string,
): Array<string> => {
  return parseTemplateExpressions(typeof value === "string" ? value : "")
    .map((expression: TemplateExpression) => {
      return expression.raw;
    })
    .filter((raw: string) => {
      return isChipReference(raw);
    });
};

export type IsSingleReferenceFunction = (value: unknown) => boolean;

/** Whether a value is one reference and nothing else, spaces aside. */
export const isSingleReference: IsSingleReferenceFunction = (
  value: unknown,
): boolean => {
  if (typeof value !== "string") {
    return false;
  }

  return isChipReference(value.trim());
};

export type ContainsReferenceFunction = (value: unknown) => boolean;

/** Whether a value holds a {{...}} expression of any kind. */
export const containsTemplateExpression: ContainsReferenceFunction = (
  value: unknown,
): boolean => {
  return (
    typeof value === "string" && parseTemplateExpressions(value).length > 0
  );
};
