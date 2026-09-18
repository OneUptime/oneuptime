import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../Models/DatabaseModels/EnterpriseLicenseInstance";
import BadDataException from "../../Types/Exception/BadDataException";
import PartialEntity from "../../Types/Database/PartialEntity";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import EnterpriseLicenseUsageSnapshot from "../../Types/EnterpriseLicense/EnterpriseLicenseUsageSnapshot";
import EnterpriseLicenseUserCountSource from "../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import EnterpriseLicenseUsageUtil from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import VersionUtil from "../../Utils/VersionUtil";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import { JSONObject } from "../../Types/JSON";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import EnterpriseLicenseService, {
  Service as EnterpriseLicenseServiceType,
} from "../Services/EnterpriseLicenseService";
import EnterpriseLicenseInstanceService from "../Services/EnterpriseLicenseInstanceService";
import UserMiddleware from "../Middleware/UserAuthorization";
import JSONWebToken from "../Utils/JsonWebToken";
import OneUptimeDate from "../../Types/Date";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
// import { Host } from "../EnvironmentConfig";

/*
 * The license state every installation of a license key mirrors locally.
 * Returned by both /validate and /report-user-count so that the daily report
 * keeps a self-hosted installation current on its own.
 */
export interface LicenseTerms {
  companyName: string;
  // ISO 8601, or null for a license with no expiry set.
  expiresAt: string | null;
  licenseKey: string;
  // Null means the license carries no seat limit.
  userLimit: number | null;
}

export interface LicenseInstanceUpsert {
  licenseId: ObjectID;
  instanceId: string;
  host: string | undefined;
  // OneUptime version the instance is running. Absent on instances too old to report it.
  oneuptimeVersion?: string | null | undefined;
  // Usage fields are only set on report-user-count, not on validate.
  userCount?: number | undefined;
  userEmailHashes?: Array<string> | undefined;
  masterAdminEmails?: Array<string> | undefined;
  lastReportedAt?: Date | undefined;
}

interface LicenseUsageReportResult {
  reportedAt: Date;
  instances: Array<EnterpriseLicenseInstance>;
  currentUserCount: number;
}

interface LicenseValidationResult {
  instances: Array<EnterpriseLicenseInstance>;
  currentUserCount: number | null;
  userCountUpdatedAt: Date | null;
  calculatedAt: Date;
}

/*
 * Bounds how many instance rows one license key can register. Real customers
 * run a handful of instances; this stops a leaked key from being used to
 * fill the table with junk rows.
 */
const MAX_INSTANCES_PER_LICENSE: number = 100;

export default class EnterpriseLicenseAPI extends BaseAPI<
  EnterpriseLicense,
  EnterpriseLicenseServiceType
> {
  public constructor() {
    super(EnterpriseLicense, EnterpriseLicenseService);

    /*
     * The dashboard needs a count and instance statuses from one cutoff
     * instant. Calculate both on the server so the per-user hashes used for
     * cross-instance deduplication never have to be sent to the browser.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:enterpriseLicenseId/active-usage`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const licenseId: ObjectID = new ObjectID(
            req.params["enterpriseLicenseId"] as string,
          );
          const snapshot: EnterpriseLicenseUsageSnapshot =
            await EnterpriseLicenseService.runWithUsageAggregationLock({
              licenseId,
              fn: async (): Promise<EnterpriseLicenseUsageSnapshot> => {
                /*
                 * A report updates its instance row and then the license-wide
                 * timestamp. Read both under the same lock so the dashboard
                 * can never combine the new instance state with the previous
                 * license state (or vice versa).
                 */
                const license: EnterpriseLicense | null =
                  await EnterpriseLicenseService.findOneById({
                    id: licenseId,
                    select: {
                      _id: true,
                      currentUserCount: true,
                      userCountUpdatedAt: true,
                      userCountSource: true,
                      legacyUserCount: true,
                      legacyUserCountUpdatedAt: true,
                    },
                    props: {
                      isRoot: true,
                    },
                  });

                if (!license) {
                  throw new BadDataException("Enterprise license not found");
                }

                const instances: Array<EnterpriseLicenseInstance> =
                  await this.findLicenseInstances(licenseId);
                const calculatedAt: Date = OneUptimeDate.getCurrentDate();
                const activeInstances: Array<EnterpriseLicenseInstance> =
                  instances.filter(
                    (instance: EnterpriseLicenseInstance): boolean => {
                      return EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
                        instance,
                        calculatedAt,
                      );
                    },
                  );
                const currentUserCount: number | null =
                  EnterpriseLicenseUsageUtil.getEffectiveUserCount({
                    instances,
                    storedUserCount: license.currentUserCount,
                    storedUserCountUpdatedAt: license.userCountUpdatedAt,
                    storedUserCountSource: license.userCountSource,
                    legacyUserCount: license.legacyUserCount,
                    legacyUserCountUpdatedAt: license.legacyUserCountUpdatedAt,
                    now: calculatedAt,
                  });
                const masterAdminEmailSet: Set<string> = new Set<string>();

                for (const instance of instances) {
                  for (const email of instance.masterAdminEmails || []) {
                    const normalizedEmail: string = email.trim().toLowerCase();

                    if (normalizedEmail) {
                      masterAdminEmailSet.add(normalizedEmail);
                    }
                  }
                }

                const masterAdminEmails: Array<string> =
                  Array.from(masterAdminEmailSet).sort();
                const nextInstanceStatusChangeAt: Date | null =
                  activeInstances.reduce(
                    (
                      earliestChange: Date | null,
                      instance: EnterpriseLicenseInstance,
                    ): Date | null => {
                      const lastCommunicatedAt: Date | undefined =
                        EnterpriseLicenseUsageUtil.getInstanceLastCommunicatedAt(
                          instance,
                        );

                      if (!lastCommunicatedAt) {
                        return earliestChange;
                      }

                      const inactiveAt: Date = new Date(
                        lastCommunicatedAt.getTime() +
                          EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays *
                            24 *
                            60 *
                            60 *
                            1000,
                      );

                      return !earliestChange || inactiveAt < earliestChange
                        ? inactiveAt
                        : earliestChange;
                    },
                    null,
                  );
                const usesActiveModernUsage: boolean =
                  EnterpriseLicenseUsageUtil.hasActiveReportedInstanceUsage(
                    instances,
                    calculatedAt,
                  );
                let activeLegacyUsageUpdatedAt: Date | undefined;

                if (!usesActiveModernUsage) {
                  if (
                    EnterpriseLicenseUsageUtil.isTimestampWithinUsageWindow(
                      license.legacyUserCountUpdatedAt,
                      calculatedAt,
                    )
                  ) {
                    activeLegacyUsageUpdatedAt =
                      license.legacyUserCountUpdatedAt;
                  } else if (
                    !license.legacyUserCountUpdatedAt &&
                    license.userCountSource !==
                      EnterpriseLicenseUserCountSource.Instance &&
                    (license.userCountSource ===
                      EnterpriseLicenseUserCountSource.Legacy ||
                      !EnterpriseLicenseUsageUtil.hasReportedInstanceUsage(
                        instances,
                      )) &&
                    EnterpriseLicenseUsageUtil.isTimestampWithinUsageWindow(
                      license.userCountUpdatedAt,
                      calculatedAt,
                    )
                  ) {
                    /*
                     * Compatibility for rows written before the dedicated
                     * legacy heartbeat columns were introduced.
                     */
                    activeLegacyUsageUpdatedAt = license.userCountUpdatedAt;
                  }
                }

                const legacyUsageChangeAt: Date | null =
                  activeLegacyUsageUpdatedAt
                    ? new Date(
                        activeLegacyUsageUpdatedAt.getTime() +
                          EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays *
                            24 *
                            60 *
                            60 *
                            1000,
                      )
                    : null;
                let nextUsageChangeAt: Date | null = nextInstanceStatusChangeAt;

                if (
                  legacyUsageChangeAt &&
                  (!nextUsageChangeAt ||
                    legacyUsageChangeAt < nextUsageChangeAt)
                ) {
                  nextUsageChangeAt = legacyUsageChangeAt;
                }
                const usageReportTimestamps: Array<Date> = (
                  [
                    license.userCountUpdatedAt,
                    license.legacyUserCountUpdatedAt,
                    ...instances.map(
                      (
                        instance: EnterpriseLicenseInstance,
                      ): Date | undefined => {
                        return instance.lastReportedAt;
                      },
                    ),
                  ] as Array<Date | undefined>
                ).filter((timestamp: Date | undefined): timestamp is Date => {
                  return Boolean(timestamp);
                });
                const lastUsageReportedAt: Date | null =
                  usageReportTimestamps.reduce(
                    (latest: Date | null, timestamp: Date): Date => {
                      return !latest || timestamp > latest ? timestamp : latest;
                    },
                    null,
                  );

                return {
                  currentUserCount,
                  activeInstanceIds: activeInstances.map(
                    (instance: EnterpriseLicenseInstance): string => {
                      return instance.id!.toString();
                    },
                  ),
                  masterAdminEmails,
                  calculatedAt: calculatedAt.toISOString(),
                  lastUsageReportedAt:
                    lastUsageReportedAt?.toISOString() || null,
                  nextInstanceStatusChangeAt:
                    nextUsageChangeAt?.toISOString() || null,
                };
              },
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            snapshot as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/validate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const licenseKey: string | undefined = req.body["licenseKey"];

          if (!licenseKey) {
            throw new BadDataException("License key is required");
          }

          //const serverHost: string = Host.toString();

          /*
           * if (!serverHost.includes("oneuptime.com")) {
           *   throw new BadDataException(
           *     "Enterprise license validation is only available on oneuptime.com",
           *   );
           * }
           */

          const license: EnterpriseLicense | null =
            await EnterpriseLicenseService.findOneBy({
              query: {
                licenseKey: licenseKey,
              },
              select: {
                _id: true,
                companyName: true,
                expiresAt: true,
                licenseKey: true,
                userLimit: true,
                currentUserCount: true,
                userCountUpdatedAt: true,
                isEvaluationLicense: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!license) {
            throw new BadDataException("License key is invalid");
          }

          if (!license.expiresAt) {
            throw new BadDataException("License expiration is not set");
          }

          const now: number = Date.now();
          const expiresAtMs: number = license.expiresAt.getTime();
          const secondsUntilExpiry: number = Math.floor(
            (expiresAtMs - now) / 1000,
          );

          if (secondsUntilExpiry <= 0) {
            throw new BadDataException("License key has expired");
          }

          /*
           * The validating instance sends its instanceId and host so it
           * shows up in the instance list right away (usage is reported
           * later by the daily job on the instance).
           */
          const instanceId: string = this.parseShortText(
            req.body["instanceId"],
          );
          const instanceHost: string = this.parseShortText(req.body["host"]);
          const instanceVersion: string | null | undefined = this.parseVersion(
            req.body["version"],
          );

          const validationResult: LicenseValidationResult =
            await EnterpriseLicenseService.runWithUsageAggregationLock({
              licenseId: license.id!,
              fn: async (): Promise<LicenseValidationResult> => {
                /*
                 * Registration is the instance's first communication and can
                 * keep an upgrade-era count in its grace window. Serialize it
                 * with reporting and reconciliation so a sweep cannot read the
                 * old rows, then overwrite the count after this row appears.
                 */
                if (instanceId) {
                  await this.upsertLicenseInstance({
                    licenseId: license.id!,
                    instanceId: instanceId,
                    host: instanceHost || undefined,
                    oneuptimeVersion: instanceVersion,
                  });
                }

                const instances: Array<EnterpriseLicenseInstance> =
                  await this.findLicenseInstances(license.id!);
                const currentLicense: EnterpriseLicense | null =
                  await EnterpriseLicenseService.findOneById({
                    id: license.id!,
                    select: {
                      currentUserCount: true,
                      userCountUpdatedAt: true,
                      userCountSource: true,
                      legacyUserCount: true,
                      legacyUserCountUpdatedAt: true,
                    },
                    props: {
                      isRoot: true,
                    },
                  });

                if (!currentLicense) {
                  throw new BadDataException("License key is invalid");
                }

                const calculatedAt: Date = OneUptimeDate.getCurrentDate();
                const currentUserCount: number | null =
                  EnterpriseLicenseUsageUtil.getEffectiveUserCount({
                    instances,
                    storedUserCount: currentLicense.currentUserCount,
                    storedUserCountUpdatedAt: currentLicense.userCountUpdatedAt,
                    storedUserCountSource: currentLicense.userCountSource,
                    legacyUserCount: currentLicense.legacyUserCount,
                    legacyUserCountUpdatedAt:
                      currentLicense.legacyUserCountUpdatedAt,
                    now: calculatedAt,
                  });

                return {
                  instances,
                  currentUserCount,
                  userCountUpdatedAt: currentLicense.userCountUpdatedAt || null,
                  calculatedAt,
                };
              },
            });

          const terms: LicenseTerms = this.getLicenseTerms(license);

          const token: string | null = this.signLicenseToken(license);

          return Response.sendJsonObjectResponse(req, res, {
            companyName: terms.companyName,
            expiresAt: terms.expiresAt,
            licenseKey: terms.licenseKey,
            userLimit: terms.userLimit,
            currentUserCount: validationResult.currentUserCount,
            userCountUpdatedAt: validationResult.userCountUpdatedAt
              ? validationResult.userCountUpdatedAt.toISOString()
              : null,
            isEvaluationLicense: Boolean(license.isEvaluationLicense),
            instances: this.getInstanceSummaries(
              validationResult.instances,
              validationResult.calculatedAt,
            ),
            token,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/report-user-count`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const licenseKey: string | undefined = (
            req.body["licenseKey"] as string | undefined
          )?.trim();
          const rawUserCount: unknown = req.body["userCount"];

          if (!licenseKey) {
            throw new BadDataException("License key is required");
          }

          const userCount: number = Number(rawUserCount);

          if (
            !Number.isFinite(userCount) ||
            userCount < 0 ||
            !Number.isInteger(userCount)
          ) {
            throw new BadDataException(
              "userCount must be a non-negative integer",
            );
          }

          const license: EnterpriseLicense | null =
            await EnterpriseLicenseService.findOneBy({
              query: {
                licenseKey: licenseKey,
              },
              /*
               * The full set of terms, not just the usage columns: this
               * response is what a self-hosted installation mirrors into its
               * own GlobalConfig every day, so anything it is missing here is
               * a field the customer keeps the stale value of until somebody
               * re-types the license key by hand. Same indexed lookup either
               * way.
               */
              select: {
                _id: true,
                companyName: true,
                expiresAt: true,
                licenseKey: true,
                userLimit: true,
                isEvaluationLicense: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!license) {
            throw new BadDataException("License key is invalid");
          }

          const instanceId: string = this.parseShortText(
            req.body["instanceId"],
          );
          const instanceHost: string = this.parseShortText(req.body["host"]);
          const instanceVersion: string | null | undefined = this.parseVersion(
            req.body["version"],
          );
          const userEmailHashes: Array<string> =
            EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes(
              req.body["userEmailHashes"],
            );
          const masterAdminEmails: Array<string> =
            EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails(
              req.body["masterAdminEmails"],
            );
          const usageReport: LicenseUsageReportResult =
            await EnterpriseLicenseService.runWithUsageAggregationLock({
              licenseId: license.id!,
              fn: async (): Promise<LicenseUsageReportResult> => {
                /*
                 * Capture this after acquiring the lock. Waiting reports can
                 * never complete later with an earlier timestamp, and the
                 * upsert/read/aggregate/write sequence is one serialized
                 * critical section across every API replica.
                 */
                const reportedAt: Date = OneUptimeDate.getCurrentDate();

                if (instanceId) {
                  /*
                   * Multi-instance report: track usage per instance and count
                   * users uniquely across all instances of this license.
                   */
                  await this.upsertLicenseInstance({
                    licenseId: license.id!,
                    instanceId: instanceId,
                    host: instanceHost || undefined,
                    oneuptimeVersion: instanceVersion,
                    userCount: userCount,
                    userEmailHashes: userEmailHashes,
                    masterAdminEmails: masterAdminEmails,
                    lastReportedAt: reportedAt,
                  });
                }

                const instances: Array<EnterpriseLicenseInstance> =
                  await this.findLicenseInstances(license.id!);
                const hasActiveReportedInstanceUsage: boolean =
                  EnterpriseLicenseUsageUtil.hasActiveReportedInstanceUsage(
                    instances,
                    reportedAt,
                  );
                const currentUserCount: number = hasActiveReportedInstanceUsage
                  ? EnterpriseLicenseUsageUtil.getUniqueUserCount(
                      instances,
                      reportedAt,
                    )
                  : userCount;
                const usageUpdate: PartialEntity<EnterpriseLicense> = {};

                /*
                 * Legacy reports (no instanceId) drive the license-wide count
                 * only while no modern instance is active. Their separate
                 * heartbeat is always retained, though, so a legacy reporter
                 * can take over immediately when the last modern report ages
                 * out instead of disappearing until its next daily call.
                 */
                if (!instanceId) {
                  usageUpdate.legacyUserCount = userCount;
                  usageUpdate.legacyUserCountUpdatedAt = reportedAt;
                }

                if (instanceId || !hasActiveReportedInstanceUsage) {
                  usageUpdate.currentUserCount = currentUserCount;
                  usageUpdate.userCountUpdatedAt = reportedAt;
                  usageUpdate.userCountSource = instanceId
                    ? EnterpriseLicenseUserCountSource.Instance
                    : EnterpriseLicenseUserCountSource.Legacy;
                }

                if (Object.keys(usageUpdate).length > 0) {
                  await EnterpriseLicenseService.updateOneById({
                    id: license.id!,
                    data: usageUpdate,
                    props: {
                      isRoot: true,
                      ignoreHooks: true,
                    },
                  });
                }

                return {
                  reportedAt,
                  instances,
                  currentUserCount,
                };
              },
            });

          const { reportedAt, instances, currentUserCount } = usageReport;

          const terms: LicenseTerms = this.getLicenseTerms(license);

          return Response.sendJsonObjectResponse(req, res, {
            companyName: terms.companyName,
            expiresAt: terms.expiresAt,
            licenseKey: terms.licenseKey,
            userLimit: terms.userLimit,
            currentUserCount: currentUserCount,
            userCountUpdatedAt: reportedAt.toISOString(),
            isEvaluationLicense: Boolean(license.isEvaluationLicense),
            instances: this.getInstanceSummaries(instances, reportedAt),
            /*
             * Null once the license has expired. Unlike /validate this route
             * does not reject an expired license - the instance is still
             * expected to report, and the expiry notification emails are built
             * from what it reports - but it must not keep being handed a fresh
             * token, and the expiresAt above is what tells it the truth.
             */
            token: this.signLicenseToken(license),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * The license terms a self-hosted installation mirrors locally. Built in one
   * place so /validate and /report-user-count cannot drift: the seat limit was
   * missing from what an instance could refresh for exactly as long as the two
   * responses were written out by hand, separately.
   */
  private getLicenseTerms(license: EnterpriseLicense): LicenseTerms {
    return {
      companyName: license.companyName || "",
      expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      licenseKey: license.licenseKey || "",
      userLimit:
        typeof license.userLimit === "number" ? license.userLimit : null,
    };
  }

  /*
   * Signed with the license server's own secret, so it is opaque to the
   * installation holding it - it is the proof that oneuptime.com recognized
   * the key, and the instance only checks that it exists. An expired license
   * gets none, which is why this returns null rather than a short-lived token.
   */
  private signLicenseToken(license: EnterpriseLicense): string | null {
    if (!license.expiresAt) {
      return null;
    }

    const secondsUntilExpiry: number = Math.floor(
      (license.expiresAt.getTime() - Date.now()) / 1000,
    );

    if (secondsUntilExpiry <= 0) {
      return null;
    }

    const terms: LicenseTerms = this.getLicenseTerms(license);

    return JSONWebToken.signJsonPayload(
      {
        companyName: terms.companyName,
        expiresAt: terms.expiresAt,
        licenseKey: terms.licenseKey,
        userLimit: terms.userLimit,
      },
      Math.max(secondsUntilExpiry, 1),
    );
  }

  private parseShortText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().substring(0, 100);
  }

  /*
   * report-user-count is unauthenticated, so the reported version is only
   * stored when it is a version we could actually compare against a release —
   * garbage never reaches the admin dashboard or the customer's modal.
   *
   * Three outcomes, and the callers depend on the distinction:
   *   undefined — the instance sent no version at all (it predates this
   *               field). Leave whatever is stored alone.
   *   null      — it sent something, but not a version. Clear the stored
   *               value, so an instance rolled back to a build with no
   *               APP_VERSION stops advertising the version it used to run.
   *   string    — a valid, canonical version to store.
   */
  private parseVersion(value: unknown): string | null | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    /*
     * Canonicalized rather than passed through, so the stored string is never
     * something the UIs would render with a doubled "v".
     */
    return VersionUtil.canonicalize(value);
  }

  private async findLicenseInstances(
    licenseId: ObjectID,
  ): Promise<Array<EnterpriseLicenseInstance>> {
    return EnterpriseLicenseInstanceService.findBy({
      query: {
        enterpriseLicenseId: licenseId,
      },
      select: {
        _id: true,
        createdAt: true,
        instanceId: true,
        host: true,
        userCount: true,
        userEmailHashes: true,
        masterAdminEmails: true,
        lastReportedAt: true,
        oneuptimeVersion: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
  }

  private getInstanceSummaries(
    instances: Array<EnterpriseLicenseInstance>,
    calculatedAt: Date,
  ): Array<EnterpriseLicenseInstanceSummary> {
    return instances.map(
      (
        instance: EnterpriseLicenseInstance,
      ): EnterpriseLicenseInstanceSummary => {
        return {
          instanceId: instance.instanceId || "",
          host: instance.host || null,
          userCount:
            typeof instance.userCount === "number" ? instance.userCount : null,
          isCountedTowardsUsage:
            EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
              instance,
              calculatedAt,
            ),
          lastReportedAt: instance.lastReportedAt
            ? instance.lastReportedAt.toISOString()
            : null,
          version: instance.oneuptimeVersion || null,
        };
      },
    );
  }

  private async upsertLicenseInstance(
    data: LicenseInstanceUpsert,
  ): Promise<void> {
    const updated: boolean = await this.updateLicenseInstanceIfExists(data);

    if (updated) {
      return;
    }

    const instanceCount: PositiveNumber =
      await EnterpriseLicenseInstanceService.countBy({
        query: {
          enterpriseLicenseId: data.licenseId,
        },
        props: {
          isRoot: true,
        },
      });

    if (instanceCount.toNumber() >= MAX_INSTANCES_PER_LICENSE) {
      throw new BadDataException(
        "Too many instances are registered for this license. Please contact support@oneuptime.com.",
      );
    }

    const newInstance: EnterpriseLicenseInstance =
      new EnterpriseLicenseInstance();
    newInstance.enterpriseLicenseId = data.licenseId;
    newInstance.instanceId = data.instanceId;

    if (data.host !== undefined) {
      newInstance.host = data.host;
    }

    // Null means "reported something that is not a version" — nothing to store.
    if (data.oneuptimeVersion) {
      newInstance.oneuptimeVersion = data.oneuptimeVersion;
    }

    if (data.userCount !== undefined) {
      newInstance.userCount = data.userCount;
    }

    if (data.userEmailHashes !== undefined) {
      newInstance.userEmailHashes = data.userEmailHashes;
    }

    if (data.masterAdminEmails !== undefined) {
      newInstance.masterAdminEmails = data.masterAdminEmails;
    }

    if (data.lastReportedAt !== undefined) {
      newInstance.lastReportedAt = data.lastReportedAt;
    }

    try {
      await EnterpriseLicenseInstanceService.create({
        data: newInstance,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * A concurrent request created the row between our check and this
       * insert — the unique index on (enterpriseLicenseId, instanceId)
       * rejected the duplicate. Apply the report as an update instead.
       */
      const retried: boolean = await this.updateLicenseInstanceIfExists(data);

      if (!retried) {
        throw err;
      }
    }
  }

  private async updateLicenseInstanceIfExists(
    data: LicenseInstanceUpsert,
  ): Promise<boolean> {
    const existingInstance: EnterpriseLicenseInstance | null =
      await EnterpriseLicenseInstanceService.findOneBy({
        query: {
          enterpriseLicenseId: data.licenseId,
          instanceId: data.instanceId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!existingInstance) {
      return false;
    }

    const updateData: PartialEntity<EnterpriseLicenseInstance> = {};

    if (data.host !== undefined) {
      updateData.host = data.host;
    }

    /*
     * Null clears the column: an instance rebuilt onto a build with no
     * APP_VERSION must stop advertising the version it used to run, because
     * lastReportedAt is refreshed on the same request and would otherwise
     * read as "confirmed running v11.5.13 as of today".
     */
    if (data.oneuptimeVersion !== undefined) {
      updateData.oneuptimeVersion = data.oneuptimeVersion;
    }

    if (data.userCount !== undefined) {
      updateData.userCount = data.userCount;
    }

    if (data.userEmailHashes !== undefined) {
      updateData.userEmailHashes = data.userEmailHashes;
    }

    if (data.masterAdminEmails !== undefined) {
      updateData.masterAdminEmails = data.masterAdminEmails;
    }

    if (data.lastReportedAt !== undefined) {
      updateData.lastReportedAt = data.lastReportedAt;
    }

    if (Object.keys(updateData).length > 0) {
      await EnterpriseLicenseInstanceService.updateOneById({
        id: existingInstance.id!,
        data: updateData,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    return true;
  }
}
