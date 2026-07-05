import OneUptimeDate from "../../Types/Date";

/*
 * Usage reported by one self-hosted instance of an enterprise license.
 * Users are counted uniquely across all instances of a license: the same
 * user (identified by the SHA-256 hash of their lowercased email) signed up
 * on staging, production and gov-cloud consumes a single seat.
 */
export interface EnterpriseLicenseInstanceUsage {
  userCount?: number | undefined;
  userEmailHashes?: Array<string> | undefined;
  lastReportedAt?: Date | undefined;
}

export default class EnterpriseLicenseUsageUtil {
  /*
   * Instances that stopped reporting (for example a decommissioned staging
   * environment) stop counting towards the seat total after this many days,
   * but are still listed so the customer can see them.
   */
  public static readonly InstanceUsageFreshnessInDays: number = 30;

  // SHA-256 hex digest.
  private static readonly emailHashRegex: RegExp = /^[a-f0-9]{64}$/;

  public static readonly maxEmailHashesPerInstance: number = 200_000;

  /*
   * Normalizes a client-provided list of email hashes: keeps only valid
   * SHA-256 hex strings, lowercases them, removes duplicates and caps the
   * list size. Returns an empty array for anything that is not an array.
   */
  public static sanitizeUserEmailHashes(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const hashes: Set<string> = new Set<string>();

    for (const item of value) {
      if (hashes.size >= this.maxEmailHashesPerInstance) {
        break;
      }

      if (typeof item !== "string") {
        continue;
      }

      const normalized: string = item.trim().toLowerCase();

      if (!this.emailHashRegex.test(normalized)) {
        continue;
      }

      hashes.add(normalized);
    }

    return Array.from(hashes);
  }

  public static isInstanceCountedTowardsUsage(
    instance: EnterpriseLicenseInstanceUsage,
    now: Date,
  ): boolean {
    if (!instance.lastReportedAt) {
      // Registered (license key validated) but never reported usage yet.
      return false;
    }

    const staleBefore: Date = OneUptimeDate.addRemoveDays(
      now,
      -this.InstanceUsageFreshnessInDays,
    );

    return instance.lastReportedAt.getTime() >= staleBefore.getTime();
  }

  /*
   * Unique users across all instances of a license: the union of email
   * hashes of instances that reported them, plus the plain user count of
   * instances that reported a count without hashes (older installations) —
   * those cannot be deduplicated against the rest.
   */
  public static getUniqueUserCount(
    instances: Array<EnterpriseLicenseInstanceUsage>,
    now: Date,
  ): number {
    const uniqueHashes: Set<string> = new Set<string>();
    let usersWithoutHashes: number = 0;

    for (const instance of instances) {
      if (!this.isInstanceCountedTowardsUsage(instance, now)) {
        continue;
      }

      if (instance.userEmailHashes && instance.userEmailHashes.length > 0) {
        for (const hash of instance.userEmailHashes) {
          uniqueHashes.add(hash);
        }

        /*
         * Hash lists are capped (maxEmailHashesPerInstance). If the
         * instance reported more users than hashes, the overflow cannot be
         * deduplicated — count it as-is so huge instances are not
         * undercounted.
         */
        if (
          typeof instance.userCount === "number" &&
          instance.userCount > instance.userEmailHashes.length
        ) {
          usersWithoutHashes +=
            instance.userCount - instance.userEmailHashes.length;
        }

        continue;
      }

      if (typeof instance.userCount === "number" && instance.userCount > 0) {
        usersWithoutHashes += instance.userCount;
      }
    }

    return uniqueHashes.size + usersWithoutHashes;
  }
}
