enum SnmpVersion {
  V1 = "1",
  V2c = "2c",
  V3 = "3",
}

/*
 * snmpVersion is persisted as free text, so a device can carry either the
 * dropdown's enum keys ("V1"/"V2c"/"V3") or these enum values ("1"/"2c"/"3"),
 * depending on which writer created it. Everything that branches on the
 * version must go through parse() — comparing the raw column against one
 * spelling strands devices written with the other in the wrong branch.
 */
export class SnmpVersionUtil {
  public static parse(value: string | undefined | null): SnmpVersion {
    switch ((value || "").trim().toLowerCase()) {
      case "1":
      case "v1":
        return SnmpVersion.V1;
      case "3":
      case "v3":
        return SnmpVersion.V3;
      default:
        return SnmpVersion.V2c;
    }
  }

  public static isV3(value: string | undefined | null): boolean {
    return SnmpVersionUtil.parse(value) === SnmpVersion.V3;
  }
}

export default SnmpVersion;
