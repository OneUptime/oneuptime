import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import Select from "Common/Server/Types/Database/Select";
import PartialEntity from "Common/Types/Database/PartialEntity";
import EnterpriseLicenseInstanceSummary from "Common/Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import {
  classifyLicenseToken,
  LicenseStoredColumns,
  LicenseTokenClassification,
} from "./LicenseToken";
import { getTrustedLicenseKeys } from "./TrustedLicenseKeys";
import {
  ACCEPT_UNVERIFIED_LEGACY_LICENSES,
  LICENSE_GRACE_PERIOD_IN_DAYS,
} from "./LicenseSettings";

/*
 * Everything the license decision depends on, as read from the GlobalConfig
 * row. The license client caches THESE (not the verdict) and classifies them
 * against the current time on every read, so a license expires, enters grace
 * and leaves grace at the exact moment, however long the inputs were cached.
 */
export interface LicenseInputs {
  /*
   * False on a brand-new installation whose GlobalConfig row has not been
   * seeded yet (the AddDefaultGlobalConfig data migration creates it).
   */
  hasConfigRow: boolean;
  // Null for an installation activated offline, which never calls home.
  licenseKey: string | null;
  token: string | null;
  // Read by the classifier: expiry, company, seat limit, evaluation flag, first seen.
  storedColumns: LicenseStoredColumns;
  instanceId: string | null;
  // The license-wide unique user count oneuptime.com last reported.
  currentUserCount: number | null;
  instances: Array<EnterpriseLicenseInstanceSummary>;
}

// The columns LicenseInputs are built from.
export const LICENSE_INPUTS_SELECT: Select<GlobalConfig> = {
  _id: true,
  enterpriseLicenseKey: true,
  enterpriseLicenseToken: true,
  enterpriseLicenseExpiresAt: true,
  enterpriseCompanyName: true,
  enterpriseLicenseUserLimit: true,
  enterpriseLicenseIsEvaluation: true,
  enterpriseEditionFirstSeenAt: true,
  enterpriseLicenseCurrentUserCount: true,
  enterpriseLicenseInstances: true,
  instanceId: true,
};

/*
 * The columns that describe the license terms themselves. The never-downgrade
 * rule keeps or drops them together with the token: a token kept from before
 * must not end up next to the expiry and seat limit of the one refused.
 */
export const LICENSE_TERM_COLUMNS: ReadonlyArray<keyof GlobalConfig> = [
  "enterpriseLicenseToken",
  "enterpriseLicenseExpiresAt",
  "enterpriseLicenseUserLimit",
  "enterpriseLicenseIsEvaluation",
  "enterpriseCompanyName",
];

const toValidDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);

  return Number.isNaN(date.getTime()) ? null : date;
};

const toFiniteNumber: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const toNonEmptyString: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

export default class LicenseInputsUtil {
  public static fromGlobalConfig(config: GlobalConfig | null): LicenseInputs {
    const instances: unknown = config?.enterpriseLicenseInstances;

    return {
      hasConfigRow: Boolean(config),
      licenseKey: toNonEmptyString(config?.enterpriseLicenseKey),
      token: toNonEmptyString(config?.enterpriseLicenseToken),
      storedColumns: {
        expiresAt: toValidDate(config?.enterpriseLicenseExpiresAt),
        companyName: toNonEmptyString(config?.enterpriseCompanyName),
        userLimit: toFiniteNumber(config?.enterpriseLicenseUserLimit),
        isEvaluation: config?.enterpriseLicenseIsEvaluation === true,
        enterpriseEditionFirstSeenAt: toValidDate(
          config?.enterpriseEditionFirstSeenAt,
        ),
      },
      instanceId: config?.instanceId ? config.instanceId.toString() : null,
      currentUserCount: toFiniteNumber(
        config?.enterpriseLicenseCurrentUserCount,
      ),
      instances: Array.isArray(instances)
        ? (instances as Array<EnterpriseLicenseInstanceSummary>)
        : [],
    };
  }

  /*
   * The inputs as they would be after `update` is written. Used to judge a
   * license the license server returned BEFORE it is stored. A key absent
   * from `update` leaves the input alone; null clears it.
   */
  public static withUpdate(
    inputs: LicenseInputs,
    update: PartialEntity<GlobalConfig>,
  ): LicenseInputs {
    const has: (key: keyof GlobalConfig) => boolean = (
      key: keyof GlobalConfig,
    ): boolean => {
      return (update as Record<string, unknown>)[key as string] !== undefined;
    };

    const value: (key: keyof GlobalConfig) => unknown = (
      key: keyof GlobalConfig,
    ): unknown => {
      return (update as Record<string, unknown>)[key as string];
    };

    return {
      hasConfigRow: inputs.hasConfigRow,
      licenseKey: has("enterpriseLicenseKey")
        ? toNonEmptyString(value("enterpriseLicenseKey"))
        : inputs.licenseKey,
      token: has("enterpriseLicenseToken")
        ? toNonEmptyString(value("enterpriseLicenseToken"))
        : inputs.token,
      storedColumns: {
        expiresAt: has("enterpriseLicenseExpiresAt")
          ? toValidDate(value("enterpriseLicenseExpiresAt"))
          : inputs.storedColumns.expiresAt,
        companyName: has("enterpriseCompanyName")
          ? toNonEmptyString(value("enterpriseCompanyName"))
          : inputs.storedColumns.companyName,
        userLimit: has("enterpriseLicenseUserLimit")
          ? toFiniteNumber(value("enterpriseLicenseUserLimit"))
          : inputs.storedColumns.userLimit,
        isEvaluation: has("enterpriseLicenseIsEvaluation")
          ? value("enterpriseLicenseIsEvaluation") === true
          : inputs.storedColumns.isEvaluation,
        enterpriseEditionFirstSeenAt: has("enterpriseEditionFirstSeenAt")
          ? toValidDate(value("enterpriseEditionFirstSeenAt"))
          : inputs.storedColumns.enterpriseEditionFirstSeenAt,
      },
      instanceId: has("instanceId")
        ? toNonEmptyString(String(value("instanceId") ?? ""))
        : inputs.instanceId,
      currentUserCount: has("enterpriseLicenseCurrentUserCount")
        ? toFiniteNumber(value("enterpriseLicenseCurrentUserCount"))
        : inputs.currentUserCount,
      instances: has("enterpriseLicenseInstances")
        ? Array.isArray(value("enterpriseLicenseInstances"))
          ? (value(
              "enterpriseLicenseInstances",
            ) as Array<EnterpriseLicenseInstanceSummary>)
          : []
        : inputs.instances,
    };
  }

  /*
   * An installation activated by pasting a signed token holds the token but
   * no license key. It has nothing to call home with, so it never does.
   */
  public static isOfflineActivated(inputs: LicenseInputs): boolean {
    return Boolean(inputs.token) && !inputs.licenseKey;
  }

  // Classifies the inputs at `now` with this build's trusted keys and policy.
  public static classify(
    inputs: LicenseInputs,
    now: Date,
  ): LicenseTokenClassification {
    return classifyLicenseToken({
      token: inputs.token,
      storedColumns: inputs.storedColumns,
      now,
      trustedKeys: getTrustedLicenseKeys(),
      localInstanceId: inputs.instanceId,
      graceDays: LICENSE_GRACE_PERIOD_IN_DAYS,
      acceptUnverified: ACCEPT_UNVERIFIED_LEGACY_LICENSES,
    });
  }

  /*
   * The snapshot core reads: the classification without the classifier's own
   * bookkeeping (reason, kid, license id, bound instance).
   */
  public static toSnapshot(
    classification: LicenseTokenClassification,
  ): EnterpriseLicenseSnapshot {
    const snapshot: EnterpriseLicenseSnapshot = {
      status: classification.status,
      verification: classification.verification,
      userLimit: classification.userLimit,
      isEvaluation: classification.isEvaluation,
      features: classification.features,
    };

    if (classification.graceReason) {
      snapshot.graceReason = classification.graceReason;
    }

    if (classification.companyName) {
      snapshot.companyName = classification.companyName;
    }

    if (classification.expiresAt) {
      snapshot.expiresAt = classification.expiresAt;
    }

    if (classification.graceEndsAt) {
      snapshot.graceEndsAt = classification.graceEndsAt;
    }

    if (classification.message) {
      snapshot.message = classification.message;
    }

    return snapshot;
  }
}
