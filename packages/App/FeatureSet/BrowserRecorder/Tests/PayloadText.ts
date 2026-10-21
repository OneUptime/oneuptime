/*
 * Every string a recorded payload carries, one per line: the text and
 * selectors a page's content could leak into.
 *
 * Tests that prove a value never leaves the page look for it here rather
 * than in JSON.stringify(payload). A payload also carries numbers - the
 * click's atUnixMs is the real clock - and a short digit string such as a
 * card's last four can turn up inside a timestamp by chance, failing the
 * check now and then with nothing leaked. Page text only ever travels as a
 * string, so the strings are what to search.
 */
export default function textOf(value: unknown): string {
  const strings: Array<string> = [];

  const collect: (item: unknown) => void = (item: unknown): void => {
    if (typeof item === "string") {
      strings.push(item);
      return;
    }

    if (Array.isArray(item)) {
      for (const element of item) {
        collect(element);
      }
      return;
    }

    if (item && typeof item === "object") {
      for (const nested of Object.values(item as Record<string, unknown>)) {
        collect(nested);
      }
    }
  };

  collect(value);

  return strings.join("\n");
}

/*
 * The same rule for text that is already JSON - a posted upload body, frames
 * and all, or a serialised event: every JSON number becomes 0 and every
 * string stays as it is, digits included. A string is matched whole before
 * any digit inside it could be, so only numbers outside strings change.
 */
const JSON_STRING_OR_NUMBER: RegExp =
  /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function withoutJsonNumbers(json: string): string {
  return json.replace(JSON_STRING_OR_NUMBER, (token: string): string => {
    return token.startsWith('"') ? token : "0";
  });
}
