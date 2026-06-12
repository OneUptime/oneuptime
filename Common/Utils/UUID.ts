export default class UUID {
  /**
   * RFC 9562 UUIDv7: 48-bit big-endian unix-millisecond timestamp prefix,
   * then version/variant bits, then 74 random bits. Ids generated later
   * sort lexicographically after ids generated earlier (same-millisecond
   * ids tie on the prefix and order randomly). Used for analytics-row
   * `_id`s: time-ordered ids cluster inserts and compress far better in
   * ClickHouse than fully-random v4 UUIDs. Postgres ids keep using
   * `generate()` (random v4) — do not switch those.
   */
  public static generateTimeOrdered(): string {
    // Uint8Array<ArrayBuffer>: getRandomValues() requires an ArrayBuffer-backed
    // view; the bare Uint8Array annotation widens to ArrayBufferLike, which
    // TypeScript 6 rejects.
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(16);

    const cryptoObj: Crypto | undefined = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      cryptoObj.getRandomValues(bytes);
    } else {
      // Non-cryptographic fallback — uniqueness, not secrecy, is the goal.
      for (let i: number = 0; i < bytes.length; i++) {
        bytes[i] = (Math.random() * 256) | 0;
      }
    }

    /*
     * 48-bit timestamp written big-endian into bytes 0..5. JS bitwise
     * operators truncate to 32 bits, so the bytes are peeled off with
     * division instead of shifts.
     */
    let timestamp: number = Date.now();
    for (let i: number = 5; i >= 0; i--) {
      bytes[i] = timestamp % 256;
      timestamp = Math.floor(timestamp / 256);
    }

    // Version 7 in the high nibble of byte 6; RFC 4122 variant on byte 8.
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

    return UUID.formatBytes(bytes);
  }

  private static formatBytes(bytes: Uint8Array): string {
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
      const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(16);
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
