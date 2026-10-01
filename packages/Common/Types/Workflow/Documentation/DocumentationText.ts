/*
 * The inline markup a step's help text may use, and nothing more:
 *
 *   **Name**               the name of a setting, port, value or button
 *   `literal`              text to type or copy exactly
 *   [label](https://...)   a link out of the product
 *
 * Deliberately not Markdown. The help used to be Markdown, rendered by the
 * full viewer, which drew every "## heading" in the size of a page title and
 * made a few paragraphs look like a manual. Three marks are all the help
 * needs, and parsing only those means a literal can hold anything at all -
 * Slack's own *bold* and _italic_, a {{...}} reference, a JSON document -
 * without being read as formatting.
 *
 * Kept free of React so the tests can read what a piece of help names.
 */

export enum DocumentationTextPartType {
  Text = "Text",
  Name = "Name",
  Literal = "Literal",
  Link = "Link",
}

export interface DocumentationTextPart {
  type: DocumentationTextPartType;
  text: string;
  /** The link's target. Set on Link parts only. */
  url?: string | undefined;
}

// [label](https://...) - an https link only; anything else stays text.
const LINK_PATTERN: RegExp = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/;

export type ParseDocumentationTextFunction = (
  text: string,
) => Array<DocumentationTextPart>;

/**
 * Splits help text into its parts. A mark that is never closed is plain text,
 * so a stray asterisk or backtick shows as itself rather than swallowing the
 * rest of the sentence.
 */
export const parseDocumentationText: ParseDocumentationTextFunction = (
  text: string,
): Array<DocumentationTextPart> => {
  const parts: Array<DocumentationTextPart> = [];
  let plain: string = "";
  let index: number = 0;

  type FlushFunction = () => void;

  const flush: FlushFunction = (): void => {
    if (plain) {
      parts.push({ type: DocumentationTextPartType.Text, text: plain });
      plain = "";
    }
  };

  while (index < text.length) {
    const rest: string = text.slice(index);

    if (rest.startsWith("`")) {
      const end: number = text.indexOf("`", index + 1);

      if (end > index + 1) {
        flush();
        parts.push({
          type: DocumentationTextPartType.Literal,
          text: text.slice(index + 1, end),
        });
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end: number = text.indexOf("**", index + 2);

      if (end > index + 2) {
        flush();
        parts.push({
          type: DocumentationTextPartType.Name,
          text: text.slice(index + 2, end),
        });
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("[")) {
      const match: RegExpMatchArray | null = rest.match(LINK_PATTERN);

      if (match) {
        flush();
        parts.push({
          type: DocumentationTextPartType.Link,
          text: match[1] as string,
          url: match[2] as string,
        });
        index += match[0].length;
        continue;
      }
    }

    plain += text.charAt(index);
    index++;
  }

  flush();

  return parts;
};

export type GetDocumentationTextNamesFunction = (text: string) => Array<string>;

/** Every **Name** the text mentions, in order. */
export const getDocumentationTextNames: GetDocumentationTextNamesFunction = (
  text: string,
): Array<string> => {
  return parseDocumentationText(text)
    .filter((part: DocumentationTextPart): boolean => {
      return part.type === DocumentationTextPartType.Name;
    })
    .map((part: DocumentationTextPart): string => {
      return part.text;
    });
};

export type DocumentationTextToPlainFunction = (text: string) => string;

/** The text as it reads, with the marks removed. */
export const documentationTextToPlain: DocumentationTextToPlainFunction = (
  text: string,
): string => {
  return parseDocumentationText(text)
    .map((part: DocumentationTextPart): string => {
      return part.text;
    })
    .join("");
};
