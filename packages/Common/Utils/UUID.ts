/*
 * The two lower-case hex digits of every byte value, so an id is written
 * with one table read per byte instead of a toString(16) and a padStart.
 */
const BYTE_TO_HEX: ReadonlyArray<string> = Array.from(
  { length: 256 },
  (_value: unknown, byte: number) => {
    return byte.toString(16).padStart(2, "0");
  },
);

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
 * The id text of the 48-bit timestamp prefix, for the last millisecond an id
 * was made in. Ids made in the same millisecond share it, so it is written
 * once per millisecond rather than once per id.
 */
let prefixMillisecond: number = Number.NaN;
let prefixText: string = "";

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
   * per TIME_ORDERED_IDS_PER_RANDOM_DRAW ids, the hex is read from a table
   * and the timestamp prefix is written once per millisecond. The id is the
   * same as it always was, byte for byte in its layout.
   */
  public static generateTimeOrdered(): string {
    const now: number = Date.now();

    if (now !== prefixMillisecond) {
      prefixText = UUID.formatTimestampPrefix(now);
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
    return (
      prefixText +
      "-" +
      BYTE_TO_HEX[((pool[at] as number) & 0x0f) | 0x70] +
      BYTE_TO_HEX[pool[at + 1] as number] +
      "-" +
      BYTE_TO_HEX[((pool[at + 2] as number) & 0x3f) | 0x80] +
      BYTE_TO_HEX[pool[at + 3] as number] +
      "-" +
      BYTE_TO_HEX[pool[at + 4] as number] +
      BYTE_TO_HEX[pool[at + 5] as number] +
      BYTE_TO_HEX[pool[at + 6] as number] +
      BYTE_TO_HEX[pool[at + 7] as number] +
      BYTE_TO_HEX[pool[at + 8] as number] +
      BYTE_TO_HEX[pool[at + 9] as number]
    );
  }

  /*
   * "xxxxxxxx-xxxx": the 48-bit timestamp, big-endian, in bytes 0..5. JS
   * bitwise operators truncate to 32 bits, so the bytes are peeled off with
   * division instead of shifts, into a Uint8Array as before (so a value
   * outside 48 bits wraps exactly as it always did).
   */
  private static formatTimestampPrefix(millisecond: number): string {
    const bytes: Uint8Array = new Uint8Array(6);
    let timestamp: number = millisecond;

    for (let i: number = 5; i >= 0; i--) {
      bytes[i] = timestamp % 256;
      timestamp = Math.floor(timestamp / 256);
    }

    return (
      (BYTE_TO_HEX[bytes[0] as number] as string) +
      BYTE_TO_HEX[bytes[1] as number] +
      BYTE_TO_HEX[bytes[2] as number] +
      BYTE_TO_HEX[bytes[3] as number] +
      "-" +
      BYTE_TO_HEX[bytes[4] as number] +
      BYTE_TO_HEX[bytes[5] as number]
    );
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
