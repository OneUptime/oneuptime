import DatabaseProperty from "../../../Types/Database/DatabaseProperty";

/*
 * Whether a detail field has a value to show, and what its copy button
 * copies. React-free, so the rules are tested on their own.
 */

/*
 * A value, or nothing to show. Nothing is null, undefined, an empty string
 * and false: React draws none of them, so they used to leave the field's
 * name over a blank line. Zero is a value - a balance of 0, 0 retries - and
 * is drawn; it used to fall outside the value's box, as a bare "0".
 */
export const hasDetailValue: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value !== null && value !== undefined && value !== "" && value !== false
  );
};

/*
 * What a copyable field's button copies: the text drawn, or the record's
 * own value under it - never the element drawn for it, whose toString() is
 * "[object Object]". Nothing to copy means no button.
 */
export const getDetailCopyText: (
  drawn: unknown,
  stored: unknown,
) => string | undefined = (
  drawn: unknown,
  stored: unknown,
): string | undefined => {
  if (typeof drawn === "string" && drawn.length > 0) {
    return drawn;
  }

  if (typeof drawn === "number" && Number.isFinite(drawn)) {
    return String(drawn);
  }

  if (stored instanceof DatabaseProperty) {
    const text: string = stored.toString();
    return text.length > 0 ? text : undefined;
  }

  if (typeof stored === "string" && stored.length > 0) {
    return stored;
  }

  if (typeof stored === "number" && Number.isFinite(stored)) {
    return String(stored);
  }

  return undefined;
};
