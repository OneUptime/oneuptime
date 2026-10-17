// The character codes of the lower-case hex digits, by value.
const HEX_DIGIT_CODES: ReadonlyArray<number> = Array.from(
  "0123456789abcdef",
  (digit: string) => {
    return digit.charCodeAt(0);
  },
);

const HYPHEN_CODE: number = "-".charCodeAt(0);

/*
 * A time-ordered id carries 10 random bytes (bytes 6..15; the version and
 * variant bits are then written over 6 bits of them).
 */
export const RANDOM_BYTES_PER_TIME_ORDERED_ID: number = 10;

/*
 * How many ids one draw from the random source serves. Analytics rows take
 * one id each, millions a minute on a busy telemetry worker, and asking
 * Web Crypto for 16 bytes per id cost far more than the bytes themselves:
 * each call validates its argument and crosses into the runtime's random
 * source. 512 ids are 5 KiB, well under getRandomValues' 64 KiB limit.
 */
export const TIME_ORDERED_IDS_PER_RANDOM_DRAW: number = 512;

/*
 * Where the random bytes of the next time-ordered ids come from: a block
 * drawn from crypto.getRandomValues (Math.random only where Web Crypto is
 * missing, as before), read once front to back and then drawn again. Each
 * byte goes into exactly one id, so ids are as random as before.
 */
const randomPool: Uint8Array = new Uint8Array(
  RANDOM_BYTES_PER_TIME_ORDERED_ID * TIME_ORDERED_IDS_PER_RANDOM_DRAW,
);
let randomPoolOffset: number = randomPool.length;

/*
 * The 36 character codes of the id being written, turned into the id by one
 * String.fromCharCode: the id comes out as one flat string, where joining
 * pieces would leave a chain of them for the runtime to flatten when the row
 * is sent. The hyphens never move. The first 13 codes are the 48-bit
 * timestamp prefix ("xxxxxxxx-xxxx") of prefixMillisecond, the last
 * millisecond an id was made in: ids of the same millisecond share it, so
 * it is written once per millisecond rather than once per id.
 */
const idCharCodes: Array<number> = new Array<number>(36).fill(HYPHEN_CODE);
let prefixMillisecond: number = Number.NaN;

// Writes one byte as its two hex digits at `position` of idCharCodes.
function writeHexByte(position: number, byte: number): void {
  idCharCodes[position] = HEX_DIGIT_CODES[byte >> 4] as number;
  idCharCodes[position + 1] = HEX_DIGIT_CODES[byte & 0x0f] as number;
}

export default class UUID {
  /**
   * RFC 9562 UUIDv7: 48-bit big-endian unix-millisecond timestamp prefix,
   * then version/variant bits, then 74 random bits. Ids generated later
   * sort lexicographically after ids generated earlier (same-millisecond
   * ids tie on the prefix and order randomly). Used for analytics-row
   * `_id`s: time-ordered ids cluster inserts and compress far better in
   * ClickHouse than fully-random v4 UUIDs. Postgres ids keep using
   * `generate()` (random v4) — do not switch those.
   *
   * Every ingested log, span and metric data point takes one, so this is on
   * the telemetry hot path: the random bytes come from a block drawn once
   * per TIME_ORDERED_IDS_PER_RANDOM_DRAW ids, the hex digits from a table,
   * the timestamp prefix is written once per millisecond and the id is
   * built as one string. The id is the same as it always was, byte for byte
   * in its layout.
   */
  public static generateTimeOrdered(): string {
    const now: number = Date.now();

    if (now !== prefixMillisecond) {
      UUID.writeTimestampPrefix(now);
      prefixMillisecond = now;
    }

    if (
      randomPoolOffset + RANDOM_BYTES_PER_TIME_ORDERED_ID >
      randomPool.length
    ) {
      UUID.fillRandomPool();
    }

    const pool: Uint8Array = randomPool;
    const at: number = randomPoolOffset;
    randomPoolOffset = at + RANDOM_BYTES_PER_TIME_ORDERED_ID;

    // Version 7 in the high nibble of byte 6; RFC 4122 variant on byte 8.
    writeHexByte(14, ((pool[at] as number) & 0x0f) | 0x70);
    writeHexByte(16, pool[at + 1] as number);
    writeHexByte(19, ((pool[at + 2] as number) & 0x3f) | 0x80);
    writeHexByte(21, pool[at + 3] as number);
    writeHexByte(24, pool[at + 4] as number);
    writeHexByte(26, pool[at + 5] as number);
    writeHexByte(28, pool[at + 6] as number);
    writeHexByte(30, pool[at + 7] as number);
    writeHexByte(32, pool[at + 8] as number);
    writeHexByte(34, pool[at + 9] as number);

    return String.fromCharCode(...idCharCodes);
  }

  /*
   * The 48-bit timestamp, big-endian, as bytes 0..5 of the id
   * ("xxxxxxxx-xxxx"). JS bitwise operators truncate to 32 bits, so the
   * bytes are peeled off with division instead of shifts, into a Uint8Array
   * as before (so a value outside 48 bits wraps exactly as it always did).
   */
  private static writeTimestampPrefix(millisecond: number): void {
    const bytes: Uint8Array = new Uint8Array(6);
    let timestamp: number = millisecond;

    for (let i: number = 5; i >= 0; i--) {
      bytes[i] = timestamp % 256;
      timestamp = Math.floor(timestamp / 256);
    }

    writeHexByte(0, bytes[0] as number);
    writeHexByte(2, bytes[1] as number);
    writeHexByte(4, bytes[2] as number);
    writeHexByte(6, bytes[3] as number);
    writeHexByte(9, bytes[4] as number);
    writeHexByte(11, bytes[5] as number);
  }

  private static fillRandomPool(): void {
    const cryptoObj: Crypto | undefined = globalThis.crypto;

    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      cryptoObj.getRandomValues(randomPool);
    } else {
      // Non-cryptographic fallback — uniqueness, not secrecy, is the goal.
      for (let i: number = 0; i < randomPool.length; i++) {
        randomPool[i] = (Math.random() * 256) | 0;
      }
    }

    randomPoolOffset = 0;
  }

  public static generate(): string {
    const cryptoObj: Crypto | undefined = globalThis.crypto;

    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }

    /*
     * crypto.randomUUID() is gated behind a secure context in browsers, so it is
     * missing when the dashboard is served over plain HTTP from a non-localhost
     * origin. crypto.getRandomValues() has no secure-context requirement, so use
     * it to build an RFC 4122 §4.4 v4 UUID.
     */
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      const bytes: Uint8Array = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
      const hex: string = Array.from(bytes, (b: number) => {
        return b.toString(16).padStart(2, "0");
      }).join("");
      return (
        hex.slice(0, 8) +
        "-" +
        hex.slice(8, 12) +
        "-" +
        hex.slice(12, 16) +
        "-" +
        hex.slice(16, 20) +
        "-" +
        hex.slice(20, 32)
      );
    }

    /*
     * Last-resort fallback for environments without any Web Crypto API. Not
     * cryptographically random, but produces a well-formed v4 UUID so callers
     * that only need a unique key (e.g. form rows) keep working.
     */
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      (char: string) => {
        const r: number = (Math.random() * 16) | 0;
        const v: number = char === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  }
}
