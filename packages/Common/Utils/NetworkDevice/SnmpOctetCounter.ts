/*
 * Counters carried as OCTET STRINGs.
 *
 * The Fibre Alliance's FCMGMT-MIB, which Brocade Fabric OS implements,
 * reports every port statistic - CRC errors, link failures, loss of sync -
 * as an 8-byte big-endian OCTET STRING rather than a Counter64, because the
 * MIB is SMIv1 and predates Counter64 in it. Many of them are 32-bit
 * counters underneath, zero-extended into the eight bytes.
 *
 * A value read as text is a binary blob ("00:00:00:00:00:00:12:34" once the
 * probe has rendered it) or, all zero, nothing at all - so they are decoded
 * here from the bytes the agent sent, before anything renders them. What
 * comes out is a plain counter: rated like any other, where a value lower
 * than the poll before is a wrap or a reset (`statsclear`) and gives no
 * rate, never a negative one (SnmpInterfaceRateUtil).
 */

// The largest counter an 8-byte string holds: 2^64 - 1.
const MAX_COUNTER64: bigint = BigInt("18446744073709551615");

const EIGHT: bigint = BigInt(8);

/*
 * The hex forms a counter's bytes are written in, and only those: octets
 * joined by colons, spaces or dashes ("00:00:00:00:00:00:12:34"), a 0x
 * prefix ("0x1234"), or all sixteen digits ("0000000000001234"). Plain "12"
 * is not one of them - it could as well be twelve.
 */
const SEPARATED_HEX_OCTETS: RegExp = /^[0-9a-f]{2}(?:[:\s-][0-9a-f]{2}){0,7}$/i;
const PREFIXED_HEX: RegExp = /^0x[0-9a-f]{1,16}$/i;
const SIXTEEN_HEX_DIGITS: RegExp = /^[0-9a-f]{16}$/i;
const HEX_SEPARATOR: RegExp = /[:\s-]/;
const HEX_SEPARATORS: RegExp = /[:\s-]/g;

export default class SnmpOctetCounter {
  /*
   * The counter an OCTET STRING of up to eight big-endian bytes holds, as an
   * unsigned number; undefined for anything that is not one. Longer strings
   * are accepted only when their extra leading bytes are zero (an agent
   * that pads). Numbers (an agent that answers with a real Counter64) pass
   * through when they are a non-negative integer.
   *
   * Above 2^53 a counter loses precision as a JavaScript number. Error
   * counters never get near it; a rate is a difference of two readings, and
   * a counter that large is a byte counter, which this is never used for.
   */
  public static decode(value: unknown): number | undefined {
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    }

    if (typeof value === "bigint") {
      return value >= BigInt(0) && value <= MAX_COUNTER64
        ? Number(value)
        : undefined;
    }

    /*
     * Bytes in any view of them - a Buffer, a Uint8Array - and from any
     * realm: `instanceof Uint8Array` is false for a Buffer made by another
     * context's constructor (a sandbox, a test environment), while
     * ArrayBuffer.isView reads the object itself.
     */
    if (ArrayBuffer.isView(value)) {
      return SnmpOctetCounter.fromBytes(
        Array.from(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        ),
      );
    }

    if (typeof value === "string") {
      return SnmpOctetCounter.fromHexText(value);
    }

    return undefined;
  }

  private static fromBytes(bytes: Array<number>): number | undefined {
    if (bytes.length === 0) {
      return undefined;
    }

    // Leading padding beyond eight bytes must be zero to be a counter.
    const extra: number = Math.max(0, bytes.length - 8);

    for (let index: number = 0; index < extra; index++) {
      if (bytes[index] !== 0) {
        return undefined;
      }
    }

    let accumulator: bigint = BigInt(0);

    for (const byte of bytes.slice(extra)) {
      accumulator = (accumulator << EIGHT) | BigInt(byte);
    }

    return accumulator <= MAX_COUNTER64 ? Number(accumulator) : undefined;
  }

  // The hex an agent or a recording renders the bytes as.
  private static fromHexText(text: string): number | undefined {
    const trimmed: string = text.trim();

    // Two octets at least: a lone "12" could as well be twelve.
    const isSeparated: boolean =
      SEPARATED_HEX_OCTETS.test(trimmed) && HEX_SEPARATOR.test(trimmed);

    if (
      !isSeparated &&
      !PREFIXED_HEX.test(trimmed) &&
      !SIXTEEN_HEX_DIGITS.test(trimmed)
    ) {
      return undefined;
    }

    let hex: string = trimmed.replace(/^0x/i, "").replace(HEX_SEPARATORS, "");

    // A prefixed value may have an odd number of digits: "0x123".
    if (hex.length % 2 !== 0) {
      hex = `0${hex}`;
    }

    if (hex.length === 0 || hex.length > 16) {
      return undefined;
    }

    const bytes: Array<number> = [];

    for (let index: number = 0; index < hex.length; index += 2) {
      bytes.push(parseInt(hex.substring(index, index + 2), 16));
    }

    return SnmpOctetCounter.fromBytes(bytes);
  }
}
