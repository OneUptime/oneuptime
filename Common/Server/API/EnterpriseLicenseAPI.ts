import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../Models/DatabaseModels/EnterpriseLicenseInstance";
import BadDataException from "../../Types/Exception/BadDataException";
import PartialEntity from "../../Types/Database/PartialEntity";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import EnterpriseLicenseUsageUtil from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import VersionUtil from "../../Utils/VersionUtil";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
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

          const terms: LicenseTerms = this.getLicenseTerms(license);

          const token: string | null = this.signLicenseToken(license);

          return Response.sendJsonObjectResponse(req, res, {
            companyName: terms.companyName,
            expiresAt: terms.expiresAt,
            licenseKey: terms.licenseKey,
            userLimit: terms.userLimit,
            currentUserCount:
              typeof license.currentUserCount === "number"
                ? license.currentUserCount
                : null,
            userCountUpdatedAt: license.userCountUpdatedAt
              ? license.userCountUpdatedAt.toISOString()
              : null,
            isEvaluationLicense: Boolean(license.isEvaluationLicense),
            instances: this.getInstanceSummaries(instances),
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

          const reportedAt: Date = OneUptimeDate.getCurrentDate();

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

          let currentUserCount: number = userCount;

          if (instances.length > 0) {
            currentUserCount = EnterpriseLicenseUsageUtil.getUniqueUserCount(
              instances,
              reportedAt,
            );
          }

          /*
           * Legacy reports (no instanceId) only drive the license-wide count
           * while no instance has registered — otherwise they would stomp
           * the deduplicated multi-instance count.
           */
          if (instanceId || instances.length === 0) {
            await EnterpriseLicenseService.updateOneById({
              id: license.id!,
              data: {
                currentUserCount: currentUserCount,
                userCountUpdatedAt: reportedAt,
              },
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            });
          }

          const terms: LicenseTerms = this.getLicenseTerms(license);

          return Response.sendJsonObjectResponse(req, res, {
            companyName: terms.companyName,
            expiresAt: terms.expiresAt,
            licenseKey: terms.licenseKey,
            userLimit: terms.userLimit,
            currentUserCount: currentUserCount,
            userCountUpdatedAt: reportedAt.toISOString(),
            isEvaluationLicense: Boolean(license.isEvaluationLicense),
            instances: this.getInstanceSummaries(instances),
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
        instanceId: true,
        host: true,
        userCount: true,
        userEmailHashes: true,
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
