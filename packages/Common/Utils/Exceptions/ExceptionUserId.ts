/*
 * WHO AN EXCEPTION'S OCCURRENCE HAPPENED TO.
 *
 * The exceptions list counts, for each exception, the distinct users its
 * occurrences happened to. OpenTelemetry names the user on the telemetry
 * itself, under one of these attributes:
 *
 *   - user.id            the general semantic conventions' key for the person;
 *   - enduser.id         its older spelling, still a current convention;
 *   - enduser.pseudo.id  a random id an application sends when it may not
 *                        name the person - still one id per person.
 *
 * Ingest keeps the first of them an occurrence carries in the occurrence's
 * own userId column, the one the list counts: on the exception event first,
 * then on its span or log record, then on its resource. An email, a name or
 * a session id is not read: the first two say more about the person than a
 * count needs, and a session is not a person.
 *
 * Read from the attributes as they are STORED: after the project's scrub
 * rules and pipelines, so a rule that removes one of these keys removes the
 * user too.
 */

export const EXCEPTION_USER_ID_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "user.id",
  "enduser.id",
  "enduser.pseudo.id",
];

// How a resource attribute arrives in an attribute bag (TelemetryUtil.getAttributes).
export const RESOURCE_ATTRIBUTE_PREFIX: string = "resource.";

/*
 * The longest user id kept. An id is a handful of characters: a longer value
 * is cut here, so a megabyte-long attribute never reaches the column.
 */
export const MAX_EXCEPTION_USER_ID_LENGTH: number = 256;

export type ExceptionAttributeBag =
  | { [key: string]: unknown }
  | null
  | undefined;

/*
 * One attribute value as a user id: a string, trimmed and cut, or a number
 * as its digits. Anything else (a boolean, an array, an object) names nobody.
 */
export function toExceptionUserId(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value !== "string") {
    return "";
  }

  // Cut before trimming, so a megabyte of text is never copied whole.
  return value
    .slice(0, MAX_EXCEPTION_USER_ID_LENGTH * 2)
    .trim()
    .slice(0, MAX_EXCEPTION_USER_ID_LENGTH);
}

/*
 * The user an occurrence happened to, from its attribute bags in the order
 * they are passed (the exception event's, then its span's or log record's).
 * Each bag's own keys are read before any resource attribute, so a span that
 * names its request's user wins over the user a whole process was started
 * for. "" when none of them names one.
 */
export function readExceptionUserId(
  bags: ReadonlyArray<ExceptionAttributeBag>,
): string {
  for (const prefix of ["", RESOURCE_ATTRIBUTE_PREFIX]) {
    for (const bag of bags) {
      if (!bag || typeof bag !== "object") {
        continue;
      }

      for (const key of EXCEPTION_USER_ID_ATTRIBUTE_KEYS) {
        const userId: string = toExceptionUserId(bag[`${prefix}${key}`]);

        if (userId !== "") {
          return userId;
        }
      }
    }
  }

  return "";
}
