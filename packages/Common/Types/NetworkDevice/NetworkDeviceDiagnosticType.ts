/*
 * The kinds of on-demand connectivity check an operator can run against a
 * registered Network Device from the topology map or the device page
 * (OneUptime issue #3745).
 *
 * Stored as the `diagnosticType` column of NetworkDeviceDiagnostic and sent
 * to the probe verbatim, so the values are the persisted strings and must
 * not be renamed.
 */
enum NetworkDeviceDiagnosticType {
  // ICMP echo: reachability, round-trip time, jitter and packet loss.
  Ping = "Ping",
  // Hop-by-hop path from the probe to the device.
  Traceroute = "Traceroute",
}

export default NetworkDeviceDiagnosticType;

export class NetworkDeviceDiagnosticTypeUtil {
  public static getAllTypes(): Array<NetworkDeviceDiagnosticType> {
    return [
      NetworkDeviceDiagnosticType.Ping,
      NetworkDeviceDiagnosticType.Traceroute,
    ];
  }

  /*
   * The enum member for a stored or posted string, or undefined when it is
   * not one. Case-sensitive on purpose: the column holds the enum value
   * exactly, and the probe branches on it.
   */
  public static parse(value: unknown): NetworkDeviceDiagnosticType | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    return NetworkDeviceDiagnosticTypeUtil.getAllTypes().find(
      (type: NetworkDeviceDiagnosticType): boolean => {
        return type === value;
      },
    );
  }

  public static isValid(value: unknown): boolean {
    return NetworkDeviceDiagnosticTypeUtil.parse(value) !== undefined;
  }
}
