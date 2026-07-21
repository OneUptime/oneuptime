enum SnmpSecurityLevel {
  NoAuthNoPriv = "noAuthNoPriv",
  AuthNoPriv = "authNoPriv",
  AuthPriv = "authPriv",
}

/*
 * This is the most consequential of the v3 enums to misread, because the
 * fallback is not merely a weaker algorithm — it is no security at all.
 *
 * The snmpV3SecurityLevel column is free text. Casting it straight to this
 * enum and letting an unmatched value fall through to NoAuthNoPriv means a
 * device configured for authPriv gets polled with its authentication and
 * privacy material dropped: the username goes out in cleartext and nothing is
 * encrypted. The device rejects it, so the visible symptom is a dead monitor
 * rather than a config error, and the downgrade itself is invisible.
 *
 * The keys ("AuthPriv") and values ("authPriv") differ only by the case of the
 * first letter, which is exactly the kind of drift a hand-written row or an
 * API caller reading the docs will produce. Lowercasing collapses the two
 * spellings onto each other, so parse() accepts both by construction.
 *
 * See SnmpPrivProtocol for why parse() returns undefined rather than a default.
 */
export class SnmpSecurityLevelUtil {
  public static parse(
    value: string | undefined | null,
  ): SnmpSecurityLevel | undefined {
    switch ((value || "").trim().toLowerCase()) {
      case "noauthnopriv":
        return SnmpSecurityLevel.NoAuthNoPriv;
      case "authnopriv":
        return SnmpSecurityLevel.AuthNoPriv;
      case "authpriv":
        return SnmpSecurityLevel.AuthPriv;
      default:
        return undefined;
    }
  }

  public static isUnrecognized(value: string | undefined | null): boolean {
    if (!(value || "").trim()) {
      return false;
    }

    return SnmpSecurityLevelUtil.parse(value) === undefined;
  }
}

export default SnmpSecurityLevel;
