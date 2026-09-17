enum SnmpPrivProtocol {
  DES = "DES",
  AES = "AES",
  AES256 = "AES256",
}

/*
 * The snmpV3PrivProtocol column is free text (character varying, no check
 * constraint), so what lands in it is only as good as whoever wrote it. The
 * forms write these enum values, but a direct API call, a hand-edited row or
 * a restored backup can put anything there.
 *
 * parse() is the only correct way to read that column. Reading it by casting
 * the raw string to this enum type compiles fine and then silently misses:
 * an "AES-256" (the label the form shows) or "aes" is not === any member, so
 * the probe's protocol switch falls to its default and encrypts with DES —
 * the weakest option — against a device that expects AES. The poll then fails
 * in a way that looks like a timeout rather than a config error.
 *
 * Returning undefined rather than a default member is deliberate: "unset" and
 * "unreadable" are different problems, and only the caller knows whether it is
 * safe to fall back. isUnrecognized() names the second case so the probe can
 * refuse to poll rather than guess a cipher.
 *
 * The accepted spellings cover case, surrounding whitespace, and the hyphen
 * the UI labels use. AES here is AES-128, per RFC 3826.
 */
export class SnmpPrivProtocolUtil {
  public static parse(
    value: string | undefined | null,
  ): SnmpPrivProtocol | undefined {
    switch ((value || "").trim().toLowerCase()) {
      case "des":
        return SnmpPrivProtocol.DES;
      case "aes":
      case "aes128":
      case "aes-128":
        return SnmpPrivProtocol.AES;
      case "aes256":
      case "aes-256":
        return SnmpPrivProtocol.AES256;
      default:
        return undefined;
    }
  }

  /*
   * True only when something is stored and none of the spellings match — an
   * empty or absent column is "unset", not "unrecognized".
   */
  public static isUnrecognized(value: string | undefined | null): boolean {
    if (!(value || "").trim()) {
      return false;
    }

    return SnmpPrivProtocolUtil.parse(value) === undefined;
  }
}

export default SnmpPrivProtocol;
