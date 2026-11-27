/*
 * Where an XCP-ng connection's collection stands, as
 * XcpNgConnection.collectionStatus stores it. The probe writes Succeeded or
 * Failed after every collection; the server writes Pending whenever the
 * connection changes (a new connection, a new address, secret, password,
 * certificate or probe), so the page says "Checking" until the probe has
 * tried the new settings.
 *
 *   Pending ── the probe collects ──> Succeeded
 *      ^                 │
 *      │                 └──────────> Failed  (collectionErrorCode and
 *      │                                       collectionError say why)
 *      └── the connection is changed
 *
 * The same three states as a vCenter's collection (VMwareCollectionStatus).
 */
enum XcpNgCollectionStatus {
  Pending = "Pending",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

export default XcpNgCollectionStatus;

export class XcpNgCollectionStatusUtil {
  public static getAll(): Array<XcpNgCollectionStatus> {
    return [
      XcpNgCollectionStatus.Pending,
      XcpNgCollectionStatus.Succeeded,
      XcpNgCollectionStatus.Failed,
    ];
  }

  public static isValid(value: unknown): value is XcpNgCollectionStatus {
    return (
      typeof value === "string" &&
      (XcpNgCollectionStatusUtil.getAll() as Array<string>).includes(value)
    );
  }
}
