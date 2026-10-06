/*
 * What Postgres' jsonb input refuses, checked without a database.
 *
 * The driver binds a jsonb value as JSON.stringify(value), and Postgres
 * refuses two escapes in that text (both verified against Postgres 15):
 *
 *   \u0000                ERROR:  unsupported Unicode escape sequence
 *                         DETAIL: \u0000 cannot be converted to text.
 *   a lone \ud800-\udfff  ERROR:  invalid input syntax for type json
 *                         DETAIL: Unicode low surrogate must follow a high
 *                                 surrogate.
 *
 * JSON.stringify writes a whole surrogate pair as the raw character and
 * only ever escapes a lone half, so in its output ANY surrogate escape is
 * one Postgres refuses.
 */

/*
 * Every escape in a JSON text, in order: `\uXXXX`, or a backslash and the
 * one character it escapes. Consuming `\\` as a whole escape is what keeps
 * the six characters `\u0000` inside a string (written `\\u0000` in JSON)
 * from being read as a NUL.
 */
const JSON_ESCAPE: RegExp = /\\(?:u([0-9a-fA-F]{4})|[\s\S])/g;

export type JsonbRefusal = "nul" | "lone-surrogate";

type FindJsonbRefusalFunction = (value: unknown) => JsonbRefusal | null;

// Why Postgres would refuse this value as jsonb, or null if it would not.
export const findJsonbRefusal: FindJsonbRefusalFunction = (
  value: unknown,
): JsonbRefusal | null => {
  const text: string | undefined = JSON.stringify(value);

  if (text === undefined) {
    return null;
  }

  const escapes: RegExp = new RegExp(JSON_ESCAPE.source, "g");
  let match: RegExpExecArray | null = escapes.exec(text);

  while (match) {
    const hex: string | undefined = match[1];

    if (hex) {
      const codeUnit: number = parseInt(hex, 16);

      if (codeUnit === 0) {
        return "nul";
      }

      if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
        return "lone-surrogate";
      }
    }

    match = escapes.exec(text);
  }

  return null;
};

type JsonbWouldRefuseFunction = (value: unknown) => boolean;

export const jsonbWouldRefuse: JsonbWouldRefuseFunction = (
  value: unknown,
): boolean => {
  return findJsonbRefusal(value) !== null;
};

type AssertJsonbAcceptsFunction = (value: unknown) => void;

/*
 * Throws what Postgres would throw for this value, so a mocked write can
 * fail the way the real one does.
 */
export const assertJsonbAccepts: AssertJsonbAcceptsFunction = (
  value: unknown,
): void => {
  const refusal: JsonbRefusal | null = findJsonbRefusal(value);

  if (refusal === "nul") {
    throw new Error("unsupported Unicode escape sequence");
  }

  if (refusal === "lone-surrogate") {
    throw new Error("invalid input syntax for type json");
  }
};
