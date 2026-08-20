/*
 * Matches "undefined" / "null" as a whole word, which is what a missing value
 * turns into once it is interpolated into a title (`Duplicate ${undefined}`).
 * Case sensitive on purpose: titles are written in Title Case, so a real word
 * like "Null" in a form title is left alone.
 */
const STRINGIFIED_EMPTY_VALUE: RegExp = /\b(undefined|null)\b/;

/*
 * Resolves the human readable name that identifies a form in the
 * "FORM SUBMIT" analytics event.
 *
 * Wrappers around BasicForm pass a chain of candidates - the explicit name
 * first, then whatever title they already render - and the first usable one
 * wins. When no candidate is usable the caller is expected to skip the capture
 * altogether, because an event named after a missing value collapses distinct
 * conversions into one indistinguishable event.
 */
export default class FormAnalyticsName {
  public static resolve(
    ...candidates: Array<string | undefined | null>
  ): string | undefined {
    for (const candidate of candidates) {
      if (typeof candidate !== "string") {
        continue;
      }

      const name: string = candidate.trim();

      if (!name || STRINGIFIED_EMPTY_VALUE.test(name)) {
        continue;
      }

      return name;
    }

    return undefined;
  }
}
