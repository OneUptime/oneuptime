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
