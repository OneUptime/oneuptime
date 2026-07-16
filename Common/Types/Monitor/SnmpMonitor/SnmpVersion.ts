enum SnmpVersion {
  V1 = "1",
  V2c = "2c",
  V3 = "3",
}

/*
 * Two spellings exist, and they belong to two different layers:
 *
 *   - These enum VALUES ("1"/"2c"/"3") are the probe-contract spelling.
 *     MonitorStepSnmpMonitor.snmpVersion is typed as this enum, and
 *     SnmpMonitor branches on it to pick the session type.
 *   - The KEYS ("V1"/"V2c"/"V3") are the stored spelling. The free-text
 *     snmpVersion column on NetworkDevice / NetworkDeviceDiscoveryScan holds
 *     these: it is what every form writes, what the column default is, and
 *     what the public API reference documents as the allowed values.
 *
 * parse() is the conversion at that seam, and it is the only correct way to
 * read the column. Comparing the raw column against an enum member instead
 * silently takes the wrong branch — a stored "V3" is not === SnmpVersion.V3
 * ("3"), so a v3 device reads as v2c and gets polled in cleartext.
 *
 * parse() also accepts the value spelling and mixed case, so a row written by
 * hand (direct API call, manual DB edit) can't strand a device in the wrong
 * branch. No product path writes that spelling — the tolerance is a guard, not
 * a sign that the column is expected to hold both.
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
