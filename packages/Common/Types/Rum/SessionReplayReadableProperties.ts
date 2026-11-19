import { normalizeProductAnalyticsUserPropertyKeys } from "./ProductAnalyticsEvents";

/*
 * READABLE EVENT PROPERTIES (issue #7501): the property keys whose short,
 * code-chosen values an application keeps readable under every masking
 * mode.
 *
 * Under Mask all text the recorders mask the VALUE of every track()
 * property and metric() attribute, as they mask page text: a value is
 * page content by another route. That keeps free text out, and it also
 * turned a funnel split by a property ("step", "plan", "variant") into one
 * bucket of placeholders. The application lists the keys whose values its
 * own code chooses, and a listed key keeps its value as written - but only
 * while the value is a short token (SESSION_REPLAY_READABLE_VALUE_PATTERN):
 * letters, digits and _ . : / -, at most 32 characters. A value with a
 * space, an @, or real length is free text, and is masked whatever its key.
 * An unlisted key is masked as before. The list is empty unless someone
 * fills it in, so nothing is readable that was not chosen.
 *
 * Never a trait: identify() traits describe a person, and stay masked.
 *
 * Bundled into the browser recorder; the React Native recorder carries a
 * copy (its ContractParity test holds the two to each other).
 */

/*
 * A short token, not text: the shape the browser recorder keeps a data-*
 * attribute's value in under Mask all text (its layout depends on them),
 * and a URL keeps a path segment in.
 */
export const SESSION_REPLAY_READABLE_VALUE_PATTERN: RegExp =
  /^[A-Za-z0-9_.:/-]{0,32}$/;

// Whether a value is short and plain enough to stay readable under a listed key.
export function isSessionReplayReadableValue(value: string): boolean {
  return SESSION_REPLAY_READABLE_VALUE_PATTERN.test(value);
}

/*
 * The keys, from anything (a stored column, the replay config's field):
 * read as product analytics reads the traits it keeps - trimmed, at most
 * 20 keys of at most 40 characters, a key once - so every key a property
 * can carry is a key the list can name. Absent or not a list: none.
 */
export function normalizeSessionReplayReadablePropertyKeys(
  value: unknown,
): Array<string> {
  return normalizeProductAnalyticsUserPropertyKeys(value);
}

/*
 * A map of property values, masked by `mask` except where its key is
 * listed and its value is a token. Keys are the page's own vocabulary and
 * are never masked.
 */
export function maskSessionReplayProperties(
  map: Record<string, string>,
  readableKeys: ReadonlyArray<string>,
  mask: (value: string) => string,
): Record<string, string> {
  const masked: Record<string, string> = {};

  for (const key of Object.keys(map)) {
    const value: string = map[key] as string;

    masked[key] =
      readableKeys.indexOf(key) !== -1 && isSessionReplayReadableValue(value)
        ? value
        : mask(value);
  }

  return masked;
}
