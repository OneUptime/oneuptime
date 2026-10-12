import Dictionary from "../Types/Dictionary";

/*
 * THE LINK RESPONSE HEADER, READ AS RFC 8288 WRITES IT.
 *
 * APIs that page their answers (GitHub, Okta, ...) say where the next and
 * the last page are in a Link header:
 *
 *   <https://api.example.com/items?page=2>; rel="next",
 *   <https://api.example.com/items?page=34>; rel="last"
 *
 * Each link is an address between "<" and ">", then parameters, each after a
 * ";": a name, and a value that is a token or a quoted string. Links are
 * separated by commas, and Node joins repeated Link headers with ", ", so a
 * value can hold any number of them. The address is taken whole, up to its
 * ">": a "," or a ";" inside it belongs to it. A quoted value is read to its
 * closing quote, with "\" escaping the character after it, so a "," or a ";"
 * inside it belongs to it too.
 *
 * Read in one pass, with no regular expression. A link that does not start
 * with "<", or whose ">" never comes, is skipped; nothing here throws.
 */

export interface LinkHeaderLink {
  // The address between "<" and ">", with the spaces around it trimmed.
  url: string;
  // The rel parameter's relation types, lowercased, in the order written.
  relations: Array<string>;
  // Each parameter by its lowercased name; the first of a name counts.
  parameters: Dictionary<string>;
}

const LINK_START: string = "<";
const LINK_END: string = ">";
const LINK_SEPARATOR: string = ",";
const PARAMETER_START: string = ";";
const PARAMETER_VALUE_START: string = "=";
const QUOTE: string = '"';
const BACKSLASH: string = "\\";
// What separates the relation types of one rel value: "next prefetch".
const RELATION_SEPARATOR: RegExp = /[ \t]+/;

// Spaces and tabs - the whitespace RFC 9110 allows between the parts.
const isSpace: (character: string | undefined) => boolean = (
  character: string | undefined,
): boolean => {
  return character === " " || character === "\t";
};

// What ends a parameter's name or an unquoted value.
const endsToken: (character: string | undefined) => boolean = (
  character: string | undefined,
): boolean => {
  return (
    character === undefined ||
    isSpace(character) ||
    character === PARAMETER_START ||
    character === LINK_SEPARATOR ||
    character === PARAMETER_VALUE_START ||
    character === LINK_START
  );
};

export type ReadLinkHeaderFunction = (
  value: string | undefined | null,
) => Array<LinkHeaderLink>;

// Every link of a Link header, in the order written.
export const readLinkHeader: ReadLinkHeaderFunction = (
  value: string | undefined | null,
): Array<LinkHeaderLink> => {
  const text: string = typeof value === "string" ? value : "";
  const links: Array<LinkHeaderLink> = [];
  let index: number = 0;

  const skipSpaces: () => void = (): void => {
    while (isSpace(text[index])) {
      index++;
    }
  };

  // Past the next "," that is not inside a quoted value, or to the end.
  const skipToNextLink: () => void = (): void => {
    let quoted: boolean = false;

    while (index < text.length) {
      const character: string = text[index]!;

      if (quoted && character === BACKSLASH) {
        index += 2;
        continue;
      }

      if (character === QUOTE) {
        quoted = !quoted;
      } else if (!quoted && character === LINK_SEPARATOR) {
        index++;
        return;
      }

      index++;
    }
  };

  while (index < text.length) {
    while (
      index < text.length &&
      (isSpace(text[index]) || text[index] === LINK_SEPARATOR)
    ) {
      index++;
    }

    if (index >= text.length) {
      break;
    }

    if (text[index] !== LINK_START) {
      skipToNextLink();
      continue;
    }

    const end: number = text.indexOf(LINK_END, index + 1);

    if (end === -1) {
      break;
    }

    const url: string = text.slice(index + 1, end).trim();
    const parameters: Dictionary<string> = {};
    index = end + 1;

    while (index < text.length) {
      skipSpaces();

      if (text[index] !== PARAMETER_START) {
        break;
      }

      index++;
      skipSpaces();

      const nameStart: number = index;

      while (!endsToken(text[index])) {
        index++;
      }

      const name: string = text.slice(nameStart, index).toLowerCase();
      let parameterValue: string = "";

      skipSpaces();

      if (text[index] === PARAMETER_VALUE_START) {
        index++;
        skipSpaces();

        if (text[index] === QUOTE) {
          index++;

          while (index < text.length && text[index] !== QUOTE) {
            if (text[index] === BACKSLASH && index + 1 < text.length) {
              index++;
            }

            parameterValue += text[index];
            index++;
          }

          // Past the closing quote, when there is one.
          index++;
        } else {
          const valueStart: number = index;

          while (!endsToken(text[index])) {
            index++;
          }

          parameterValue = text.slice(valueStart, index);
        }
      }

      if (name.length > 0 && parameters[name] === undefined) {
        parameters[name] = parameterValue;
      }
    }

    if (url.length > 0) {
      links.push({
        url: url,
        relations: (parameters["rel"] || "")
          .split(RELATION_SEPARATOR)
          .filter((relation: string): boolean => {
            return relation.length > 0;
          })
          .map((relation: string): string => {
            return relation.toLowerCase();
          }),
        parameters: parameters,
      });
    }

    skipSpaces();

    if (text[index] === LINK_SEPARATOR) {
      index++;
    } else if (text[index] !== LINK_START) {
      // Whatever else the link holds, up to the next one.
      skipToNextLink();
    }
  }

  return links;
};

export type LinkHeaderUrlsFunction = (
  value: string | undefined | null,
) => Dictionary<string>;

/*
 * Each relation type of a Link header and the address it names: "next",
 * "last", ... A relation named twice keeps the last address given for it.
 */
export const linkHeaderUrls: LinkHeaderUrlsFunction = (
  value: string | undefined | null,
): Dictionary<string> => {
  const urls: Dictionary<string> = {};

  for (const link of readLinkHeader(value)) {
    for (const relation of link.relations) {
      urls[relation] = link.url;
    }
  }

  return urls;
};
