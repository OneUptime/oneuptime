import EnterpriseLicenseUserCountSource from "../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";

/*
 * Usage reported by one self-hosted instance of an enterprise license.
 * Users are counted uniquely across all instances of a license: the same
 * user (identified by the SHA-256 hash of their lowercased email) signed up
 * on staging, production and gov-cloud consumes a single seat.
 */
export interface EnterpriseLicenseInstanceUsage {
  /*
   * Registration is the initial communication until the instance sends its
   * first usage report.
   */
  createdAt?: Date | undefined;
  userCount?: number | undefined;
  userEmailHashes?: Array<string> | undefined;
  lastReportedAt?: Date | undefined;
}

export interface EffectiveEnterpriseLicenseUserCountOptions {
  instances: Array<EnterpriseLicenseInstanceUsage>;
  storedUserCount?: number | null | undefined;
  storedUserCountUpdatedAt?: Date | undefined;
  storedUserCountSource?: EnterpriseLicenseUserCountSource | undefined;
  legacyUserCount?: number | null | undefined;
  legacyUserCountUpdatedAt?: Date | undefined;
  /*
   * Callers that just replaced/deleted modern rows know the stored aggregate
   * came from those rows. They can suppress the one-time compatibility path
   * for license records created before dedicated legacy fields existed.
   */
  allowStoredUserCountAsLegacyFallback?: boolean | undefined;
  now: Date;
}

export interface EffectiveEnterpriseLicenseUserCount {
  userCount: number | null;
  source: EnterpriseLicenseUserCountSource | null;
}

export default class EnterpriseLicenseUsageUtil {
  /*
   * How many days before a license expires that expiry reminder emails
   * start going out, unless overridden in GlobalConfig
   * (enterpriseLicenseExpiryReminderDays).
   */
  public static readonly defaultExpiryReminderDays: number = 45;

  /*
   * Expired licenses keep getting a daily "expired" email for this many
   * days after expiry, then go quiet — an abandoned license should not be
   * emailed forever.
   */
  public static readonly expiredNotificationCutoffDays: number = 30;

  /*
   * License keys are shown/emailed masked — enough to identify the key
   * without exposing it in full.
   */
  public static maskLicenseKey(licenseKey: string): string {
    if (licenseKey.length <= 8) {
      return "••••••••";
    }

    return `${licenseKey.substring(0, 4)}••••${licenseKey.substring(
      licenseKey.length - 4,
    )}`;
  }
  /*
   * An instance is inactive once it has gone this many complete days without
   * communicating with oneuptime.com. Inactive instances stay visible, but
   * their users no longer consume seats.
   */
  public static readonly InstanceUsageFreshnessInDays: number = 7;

  // SHA-256 hex digest.
  private static readonly emailHashRegex: RegExp = /^[a-f0-9]{64}$/;

  public static readonly maxEmailHashesPerInstance: number = 200_000;

  /*
   * Master admin emails are used to contact the customer about license
   * issues — a handful per instance is plenty, and the cap keeps a
   * misbehaving client from storing an unbounded list.
   */
  public static readonly maxMasterAdminEmailsPerInstance: number = 50;

  // Deliberately loose: rejects garbage, accepts anything email-shaped.
  private static readonly emailRegex: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /*
   * Normalizes a client-provided list of master admin emails: keeps only
   * email-shaped strings, lowercases them, removes duplicates and caps the
   * list size. Returns an empty array for anything that is not an array.
   */
  public static sanitizeMasterAdminEmails(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const emails: Set<string> = new Set<string>();

    for (const item of value) {
      if (emails.size >= this.maxMasterAdminEmailsPerInstance) {
        break;
      }

      if (typeof item !== "string") {
        continue;
      }

      const normalized: string = item.trim().toLowerCase();

      if (
        !normalized ||
        normalized.length > 320 ||
        !this.emailRegex.test(normalized)
      ) {
        continue;
      }

      emails.add(normalized);
    }

    return Array.from(emails);
  }

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
    const lastCommunicatedAt: Date | undefined =
      this.getInstanceLastCommunicatedAt(instance);

    if (!lastCommunicatedAt) {
      return false;
    }

    const inactiveAfterInMilliseconds: number =
      this.InstanceUsageFreshnessInDays * 24 * 60 * 60 * 1000;
    const staleBefore: number = now.getTime() - inactiveAfterInMilliseconds;

    /*
     * Strictly greater than: at the exact seven-day boundary the instance has
     * gone a full week without communicating and must already be inactive.
     * Elapsed milliseconds are intentional; a daylight-saving transition
     * must not shorten or extend the week.
     */
    return lastCommunicatedAt.getTime() > staleBefore;
  }

  public static getInstanceLastCommunicatedAt(
    instance: EnterpriseLicenseInstanceUsage,
  ): Date | undefined {
    return instance.lastReportedAt || instance.createdAt;
  }

  /* A registration is active, but only a real report is modern seat data. */
  public static hasActiveReportedInstanceUsage(
    instances: Array<EnterpriseLicenseInstanceUsage>,
    now: Date,
  ): boolean {
    return instances.some(
      (instance: EnterpriseLicenseInstanceUsage): boolean => {
        return (
          Boolean(instance.lastReportedAt) &&
          this.isInstanceCountedTowardsUsage(instance, now)
        );
      },
    );
  }

  public static isTimestampWithinUsageWindow(
    timestamp: Date | undefined,
    now: Date,
  ): boolean {
    return timestamp
      ? this.isInstanceCountedTowardsUsage({ lastReportedAt: timestamp }, now)
      : false;
  }

  public static hasReportedInstanceUsage(
    instances: Array<EnterpriseLicenseInstanceUsage>,
  ): boolean {
    return instances.some(
      (instance: EnterpriseLicenseInstanceUsage): boolean => {
        return Boolean(instance.lastReportedAt);
      },
    );
  }

  /*
   * Choose between modern per-instance reports and a separately persisted
   * legacy license-wide heartbeat. The stored count fallback exists only for
   * records written before those dedicated legacy columns were introduced;
   * seeing any historical modern report proves that aggregate is not legacy.
   * Once every authoritative communication timestamp is a week old, usage is
   * zero.
   */
  public static getEffectiveUserCount(
    options: EffectiveEnterpriseLicenseUserCountOptions,
  ): number | null {
    return this.getEffectiveUserCountAndSource(options).userCount;
  }

  public static getEffectiveUserCountAndSource(
    options: EffectiveEnterpriseLicenseUserCountOptions,
  ): EffectiveEnterpriseLicenseUserCount {
    if (this.hasActiveReportedInstanceUsage(options.instances, options.now)) {
      return {
        userCount: this.getUniqueUserCount(options.instances, options.now),
        source: EnterpriseLicenseUserCountSource.Instance,
      };
    }

    if (
      this.isTimestampWithinUsageWindow(
        options.legacyUserCountUpdatedAt,
        options.now,
      )
    ) {
      return {
        userCount: options.legacyUserCount ?? null,
        source: EnterpriseLicenseUserCountSource.Legacy,
      };
    }

    const hasRecentRegistration: boolean = options.instances.some(
      (instance: EnterpriseLicenseInstanceUsage): boolean => {
        return (
          !instance.lastReportedAt &&
          this.isInstanceCountedTowardsUsage(instance, options.now)
        );
      },
    );
    const hasRecentLegacyReport: boolean = options.storedUserCountUpdatedAt
      ? this.isTimestampWithinUsageWindow(
          options.storedUserCountUpdatedAt,
          options.now,
        )
      : false;
    const isExplicitLegacyFallback: boolean =
      options.storedUserCountSource ===
        EnterpriseLicenseUserCountSource.Legacy &&
      !options.legacyUserCountUpdatedAt &&
      hasRecentLegacyReport;
    const canUseCompatibilityFallback: boolean =
      options.allowStoredUserCountAsLegacyFallback !== false &&
      options.storedUserCountSource !==
        EnterpriseLicenseUserCountSource.Instance &&
      !options.legacyUserCountUpdatedAt &&
      !this.hasReportedInstanceUsage(options.instances);

    if (
      isExplicitLegacyFallback ||
      (canUseCompatibilityFallback &&
        (hasRecentRegistration || hasRecentLegacyReport))
    ) {
      return {
        userCount: options.storedUserCount ?? null,
        source: EnterpriseLicenseUserCountSource.Legacy,
      };
    }

    if (
      options.instances.length === 0 &&
      (options.storedUserCount === undefined ||
        options.storedUserCount === null) &&
      !options.storedUserCountUpdatedAt &&
      (options.legacyUserCount === undefined ||
        options.legacyUserCount === null) &&
      !options.legacyUserCountUpdatedAt &&
      !options.storedUserCountSource
    ) {
      return {
        userCount: null,
        source: null,
      };
    }

    let inactiveUsageSource: EnterpriseLicenseUserCountSource | null =
      options.storedUserCountSource || null;

    if (
      !inactiveUsageSource &&
      this.hasReportedInstanceUsage(options.instances)
    ) {
      inactiveUsageSource = EnterpriseLicenseUserCountSource.Instance;
    } else if (!inactiveUsageSource && options.legacyUserCountUpdatedAt) {
      inactiveUsageSource = EnterpriseLicenseUserCountSource.Legacy;
    }

    return {
      userCount: 0,
      source: inactiveUsageSource,
    };
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
