/*
 * Where a probe-collected vCenter stands, as VMwareVCenter.collectionStatus
 * stores it. The probe writes Succeeded or Failed after every collection; the
 * server writes Pending whenever the connection changes (a new vCenter, a new
 * address, password, certificate or probe), so the page says "checking" until
 * the probe has tried the new settings.
 *
 *   Pending ── the probe collects ──> Succeeded
 *      ^                 │
 *      │                 └──────────> Failed  (collectionErrorCode and
 *      │                                       collectionError say why)
 *      └── the connection is changed
 */
enum VMwareCollectionStatus {
  Pending = "Pending",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

export default VMwareCollectionStatus;

export class VMwareCollectionStatusUtil {
  public static getAll(): Array<VMwareCollectionStatus> {
    return [
      VMwareCollectionStatus.Pending,
      VMwareCollectionStatus.Succeeded,
      VMwareCollectionStatus.Failed,
    ];
  }

  public static isValid(value: unknown): value is VMwareCollectionStatus {
    return (
      typeof value === "string" &&
      (VMwareCollectionStatusUtil.getAll() as Array<string>).includes(value)
    );
  }
}
