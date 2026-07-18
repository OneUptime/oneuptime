enum SnmpAuthProtocol {
  MD5 = "MD5",
  SHA = "SHA",
  SHA256 = "SHA256",
  SHA512 = "SHA512",
}

/*
 * Same free-text column problem as SnmpPrivProtocol: snmpV3AuthProtocol has no
 * check constraint, and reading it by casting the raw string to this enum
 * silently drops to the probe's default of MD5 — the weakest digest — when the
 * spelling does not match exactly. "SHA-256" is what the form labels that
 * option, so it is a realistic thing to find in a hand-written row.
 *
 * This protocol also selects the hash used to localize the *privacy* key
 * (RFC 3414 section 2.6), so getting it wrong corrupts the DES/AES key as well
 * as the authentication digest. Both ends then disagree and the device simply
 * stops answering.
 *
 * See SnmpPrivProtocol for why parse() returns undefined instead of a default.
 * SHA here is SHA-1, the original RFC 3414 algorithm.
 */
export class SnmpAuthProtocolUtil {
  public static parse(
    value: string | undefined | null,
  ): SnmpAuthProtocol | undefined {
    switch ((value || "").trim().toLowerCase()) {
      case "md5":
        return SnmpAuthProtocol.MD5;
      case "sha":
      case "sha1":
      case "sha-1":
        return SnmpAuthProtocol.SHA;
      case "sha256":
      case "sha-256":
        return SnmpAuthProtocol.SHA256;
      case "sha512":
      case "sha-512":
        return SnmpAuthProtocol.SHA512;
      default:
        return undefined;
    }
  }

  public static isUnrecognized(value: string | undefined | null): boolean {
    if (!(value || "").trim()) {
      return false;
    }

    return SnmpAuthProtocolUtil.parse(value) === undefined;
  }
}

export default SnmpAuthProtocol;
