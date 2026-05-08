export default class UUID {
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
