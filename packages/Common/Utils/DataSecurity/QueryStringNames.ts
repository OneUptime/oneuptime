import { getHintedDataTypeIds } from "./FieldNameHints";
import {
  isRecognizedTestValue,
  normalizeRecognizedValue,
  RecognizedDataTypeId,
} from "./Model/RecognizedEntity";
import PercentDecodedText from "./PercentDecodedText";

/*
 * A PERSON'S NAME IN A URL'S QUERY STRING, BY THE PARAMETER'S NAME (#11034).
 *
 * No pattern tells a person's name from any other word, so Data Security
 * finds a name by the field that holds it - a column, a key, an attribute
 * named customer_name or first_name (FieldNameHints) - or by the
 * names-and-addresses model in free text. A URL holds fields of its own:
 * /profile?full_name=Jos%C3%A9%20Garc%C3%ADa. The model reads such a value
 * with its escapes read where it runs (Server's EntityRecognizer,
 * readingForModel); where it does not - it is off, a probe has none, its
 * time ran out - a query parameter is read as the field it is: one whose
 * name a person's name's field would have (full_name, firstName, surname,
 * cardholder_name), its value read as a query string writes it - its
 * escapes read, a "+" a space - and with a name's shape, is that person's
 * name. Placed on the characters the value is written with, escapes and
 * all, so it is hidden there.
 *
 * A parameter is named as a column is (FieldNameHints): full_name,
 * firstName, filter[last_name], user%5Bsurname%5D alike. Not one named
 * "name" alone: a product's, a file's, a city's name as often as a
 * person's, as a column called "name" is - the model reads those where it
 * runs. Nor a value no one is called: a placeholder ("null", "guest"), a
 * sort's direction (sort[last_name]=desc), a file's name (fname=report.pdf).
 *
 * In time in line with the text's length: one bounded pattern over it, each
 * key and value read once.
 */

export const QUERY_NAME_DATA_TYPE_ID: RecognizedDataTypeId = "person-name";

/*
 * A parameter of a query string - after "?", "&" or ";", or a text's start
 * (a bare query string) - its name and its value. Bounded: a name of 64
 * characters, a value of 256.
 */
const QUERY_PARAMETER: RegExp =
  /(?<=^|[?&;])([A-Za-z0-9_.%[\]-]{1,64})=([^&#\s"'<>;]{1,256})/g;

// Every person's name hint holds these letters: what rules a text, or a key, out at once.
const NAME_LETTERS: RegExp = /name/i;

/*
 * A name's shape: a letter first, then letters, marks and what joins a
 * name's parts - the shape a column's person's name is checked by
 * (FieldClassifier's NAME_VALUE_SHAPES), its accents' marks too.
 */
const NAME_SHAPE: RegExp = /^\p{L}[\p{L}\p{M}' .-]{0,63}$/u;

// A file's name: no space, and an extension after its last dot.
const FILE_NAME: RegExp = /^[^ ]+\.[a-z0-9]{1,5}$/;

// A query string's space, as written or escaped once more (%2B).
const PLUS: RegExp = /\+/g;

// What a form or an API puts where no one's name was given: a placeholder, a sort's direction.
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  "admin",
  "all",
  "anonymous",
  "any",
  "asc",
  "ascending",
  "default",
  "desc",
  "descending",
  "empty",
  "false",
  "guest",
  "me",
  "n/a",
  "na",
  "name",
  "nil",
  "none",
  "null",
  "root",
  "self",
  "string",
  "test",
  "true",
  "undefined",
  "unknown",
  "user",
  "value",
]);

export interface QueryStringName {
  // Where the value is written in the text: [start, end).
  start: number;
  end: number;
  // The name as it reads, its spaces collapsed.
  normalized: string;
  isTestValue: boolean;
}

// The person's names a text's query strings hold, by their parameters' names.
export function findQueryStringNames(text: string): Array<QueryStringName> {
  if (!text || text.indexOf("=") === -1 || !NAME_LETTERS.test(text)) {
    return [];
  }

  const found: Array<QueryStringName> = [];

  QUERY_PARAMETER.lastIndex = 0;

  for (const match of text.matchAll(QUERY_PARAMETER)) {
    const key: string = PercentDecodedText.readableOf(match[1]!);

    // Cheap first: a key without "name" is named for no one's name.
    if (
      !NAME_LETTERS.test(key) ||
      !getHintedDataTypeIds(key).has(QUERY_NAME_DATA_TYPE_ID)
    ) {
      continue;
    }

    const written: string = match[2]!;
    const value: string = PercentDecodedText.readableOf(written)
      .replace(PLUS, " ")
      .trim();

    if (
      !NAME_SHAPE.test(value) ||
      FILE_NAME.test(value) ||
      PLACEHOLDERS.has(value.toLowerCase())
    ) {
      continue;
    }

    const start: number = match.index! + match[0].length - written.length;
    const normalized: string = normalizeRecognizedValue(value);

    found.push({
      start,
      end: start + written.length,
      normalized,
      isTestValue: isRecognizedTestValue(QUERY_NAME_DATA_TYPE_ID, normalized),
    });
  }

  return found;
}
