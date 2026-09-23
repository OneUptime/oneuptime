/*
 * Base64 for the offline outbox, which keeps each frame gzip-compressed in
 * AsyncStorage. AsyncStorage stores strings, and a gzip stream written as a
 * "binary" string would put NUL and high bytes into SQLite TEXT columns on
 * Android; base64 is ASCII, costs a third on top of gzip, and still leaves
 * a frame several times smaller than the JSON it came from.
 *
 * Implemented here rather than with btoa/atob: Hermes only has those from
 * React Native 0.74, and this package supports 0.73.
 */

const ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP: Int16Array = ((): Int16Array => {
  const table: Int16Array = new Int16Array(128).fill(-1);

  for (let index: number = 0; index < ALPHABET.length; index += 1) {
    table[ALPHABET.charCodeAt(index)] = index;
  }

  return table;
})();

export function encodeBase64(bytes: Uint8Array): string {
  const parts: Array<string> = [];

  for (let index: number = 0; index < bytes.length; index += 3) {
    const first: number = bytes[index] as number;
    const second: number | undefined = bytes[index + 1];
    const third: number | undefined = bytes[index + 2];
    const triple: number = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    parts.push(
      ALPHABET.charAt((triple >> 18) & 63) +
        ALPHABET.charAt((triple >> 12) & 63) +
        (second === undefined ? "=" : ALPHABET.charAt((triple >> 6) & 63)) +
        (third === undefined ? "=" : ALPHABET.charAt(triple & 63)),
    );
  }

  return parts.join("");
}

/* Null for anything that is not canonical base64: the input is untrusted. */
export function decodeBase64(text: string): Uint8Array | null {
  if (typeof text !== "string" || text.length % 4 !== 0) {
    return null;
  }

  const padding: number = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes: Uint8Array = new Uint8Array((text.length / 4) * 3 - padding);
  let buffer: number = 0;
  let bits: number = 0;
  let written: number = 0;

  for (let index: number = 0; index < text.length - padding; index += 1) {
    const code: number = text.charCodeAt(index);
    const value: number = code < 128 ? (LOOKUP[code] as number) : -1;

    if (value < 0) {
      return null;
    }

    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
  }

  return written === bytes.length ? bytes : null;
}
