/*
 * Where a probe-collected cloud stands, as OpenStackCloud.collectionStatus stores
 * it. The probe writes one of the last three after every collection, and the server
 * writes Pending whenever the connection changes, so the page says "checking" until
 * the probe has tried the new settings.
 *
 *   Pending -- the probe collects --> Succeeded
 *      ^                 |
 *      |                 +----------> PartiallySucceeded  (a service failed, and the
 *      |                 |                                 others still reported)
 *      |                 +----------> Failed  (nothing could be read)
 *      +-- the connection is changed
 *
 * PartiallySucceeded is what VMware does not have. A cloud is many services, and
 * one failing never affects another, so "it worked" and "it did not" are both wrong
 * while Neutron is down and Nova is fine. The summary says which is which.
 */
enum OpenStackCollectionStatus {
  Pending = "Pending",
  Succeeded = "Succeeded",
  PartiallySucceeded = "PartiallySucceeded",
  Failed = "Failed",
}

export default OpenStackCollectionStatus;

export class OpenStackCollectionStatusUtil {
  public static getAll(): Array<OpenStackCollectionStatus> {
    return [
      OpenStackCollectionStatus.Pending,
      OpenStackCollectionStatus.Succeeded,
      OpenStackCollectionStatus.PartiallySucceeded,
      OpenStackCollectionStatus.Failed,
    ];
  }

  public static isValid(value: unknown): value is OpenStackCollectionStatus {
    return (
      typeof value === "string" &&
      (OpenStackCollectionStatusUtil.getAll() as Array<string>).includes(value)
    );
  }

  // What a probe may report: Pending is only ever the server's own word.
  public static isReportable(
    value: unknown,
  ): value is
    | OpenStackCollectionStatus.Succeeded
    | OpenStackCollectionStatus.PartiallySucceeded
    | OpenStackCollectionStatus.Failed {
    return (
      value === OpenStackCollectionStatus.Succeeded ||
      value === OpenStackCollectionStatus.PartiallySucceeded ||
      value === OpenStackCollectionStatus.Failed
    );
  }
}
