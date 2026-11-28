/*
 * Where probe collection of a storage array connection stands: Pending
 * until a probe tried the current settings, then the outcome of the last
 * collection. Written by the server and the probe only.
 */
enum StorageArrayCollectionStatus {
  Pending = "Pending",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

export default StorageArrayCollectionStatus;

export class StorageArrayCollectionStatusUtil {
  public static getAll(): Array<StorageArrayCollectionStatus> {
    return [
      StorageArrayCollectionStatus.Pending,
      StorageArrayCollectionStatus.Succeeded,
      StorageArrayCollectionStatus.Failed,
    ];
  }

  public static isValid(value: unknown): value is StorageArrayCollectionStatus {
    return (
      typeof value === "string" &&
      (StorageArrayCollectionStatusUtil.getAll() as Array<string>).includes(
        value,
      )
    );
  }

  // What a probe may report: an outcome, never Pending.
  public static isReportable(
    value: unknown,
  ): value is
    | StorageArrayCollectionStatus.Succeeded
    | StorageArrayCollectionStatus.Failed {
    return (
      value === StorageArrayCollectionStatus.Succeeded ||
      value === StorageArrayCollectionStatus.Failed
    );
  }
}
