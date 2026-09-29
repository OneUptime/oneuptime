/*
 * Turns a device role's NAME into its stable KEY.
 *
 * Device roles are per-project rows an operator can rename at will, which is
 * exactly why nothing may identify one by its name. The key is what does the
 * identifying: it is what the SNMP classifier's answer is matched against,
 * what a topology payload carries, and what survives the role being renamed.
 *
 * The shape is lowerCamelCase, because the eleven built-in roles seeded into
 * every project already use it ("wirelessAccessPoint", "loadBalancer") and a
 * key derived from the name "Wireless AP" must be able to look like one of
 * them. Anything that is not a letter or a digit is a word boundary, so
 * "PoS Terminal", "pos-terminal" and "POS  terminal!" all derive "posTerminal"
 * - near-duplicates collapse rather than multiplying.
 *
 * Pure and dependency-free: the service derives keys with it on the server and
 * the tests exercise it directly.
 */

// Keys are stored in a ShortText column; nothing sensible is this long.
const MAX_KEY_LENGTH: number = 100;

/*
 * A name of nothing but punctuation ("---") has no letters to build a key
 * from. Rather than returning an empty string - which would fail the column's
 * NOT NULL and surface as a database error - it falls back to this, and the
 * caller's uniqueness suffixing turns the second one into "role2".
 */
export const FALLBACK_DEVICE_ROLE_KEY: string = "role";

export type DeriveDeviceRoleKeyFunction = (name: string) => string;

/**
 * The key for a role named `name`. Deterministic and case-insensitive over
 * word separators: it is safe to call twice and get the same answer.
 */
export const deriveDeviceRoleKey: DeriveDeviceRoleKeyFunction = (
  name: string,
): string => {
  const words: Array<string> = (name || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word: string) => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return FALLBACK_DEVICE_ROLE_KEY;
  }

  /*
   * A ONE-WORD name is only re-cased at its first letter. A MULTI-word name
   * has its first word lowercased whole, and every later word capitalised at
   * the front with its interior left alone.
   *
   * Both halves are load-bearing, and for different reasons.
   *
   * Lowercasing the head of a multi-word name is what makes the key readable.
   * Re-casing only its first letter turns "PoS Terminal" into "poSTerminal"
   * and "IP phone" into "iPPhone", and this key is a column an operator reads
   * on the settings page. Later words keep their interior for the opposite
   * reason: "Wireless AP" should read as "wirelessAP" and "SD-WAN Edge" as
   * "sdWANEdge", because those acronyms are the boundaries a reader navigates
   * by.
   *
   * Leaving a one-word name alone is what makes every derived key a FIXED
   * POINT of this function. A derived key is always a single run of letters
   * and digits, so re-deriving it takes this branch and returns it unchanged -
   * "wirelessAccessPoint" stays "wirelessAccessPoint", and a key that is
   * accidentally fed back in as a name cannot silently move a role's identity.
   * It is also honest: a name with no word boundaries has no boundaries to
   * normalise.
   */
  const key: string =
    words.length === 1
      ? words[0]!.charAt(0).toLowerCase() + words[0]!.slice(1)
      : words
          .map((word: string, index: number): string => {
            if (index === 0) {
              return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
          })
          .join("");

  /*
   * A key starting with a digit ("5gRouter") is still a fine identifier here -
   * it is a lookup key, not a JavaScript name - so only the length is capped.
   */
  return key.slice(0, MAX_KEY_LENGTH);
};

export type BuildUniqueDeviceRoleKeyFunction = (
  name: string,
  takenKeys: ReadonlySet<string>,
) => string;

/**
 * The key for a role named `name` that no other role in the project holds.
 *
 * Two differently-named roles can derive the same key ("PoS Terminal" and
 * "pos_terminal" both give "posTerminal"), and the column is unique per
 * project, so the second one has to move. It gets a numeric suffix rather than
 * a random one so the result stays readable and stable for a given project
 * state - "posTerminal2", not "posTerminal-f3a9".
 *
 * Comparison is case-insensitive because that is how the key is matched when
 * a role is looked up; two keys differing only in case would collide there.
 */
export const buildUniqueDeviceRoleKey: BuildUniqueDeviceRoleKeyFunction = (
  name: string,
  takenKeys: ReadonlySet<string>,
): string => {
  const taken: Set<string> = new Set<string>();
  for (const key of takenKeys) {
    taken.add(key.trim().toLowerCase());
  }

  const base: string = deriveDeviceRoleKey(name);

  if (!taken.has(base.toLowerCase())) {
    return base;
  }

  /*
   * Bounded so a pathological project cannot spin here. Past the bound the
   * caller gets the base key back and the database's unique constraint
   * rejects the create - a loud, correct failure rather than a hang.
   */
  for (let suffix: number = 2; suffix < 1000; suffix++) {
    const candidate: string = `${base}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return base;
};
