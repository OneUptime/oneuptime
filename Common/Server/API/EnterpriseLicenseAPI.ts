import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../Models/DatabaseModels/EnterpriseLicenseInstance";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import PartialEntity from "../../Types/Database/PartialEntity";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import EnterpriseLicenseUsageUtil from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
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

export interface LicenseInstanceUpsert {
  licenseId: ObjectID;
  instanceId: string;
  host: string | undefined;
  // Usage fields are only set on report-user-count, not on validate.
  userCount?: number | undefined;
  userEmailHashes?: Array<string> | undefined;
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

          if (instanceId) {
            await this.upsertLicenseInstance({
              licenseId: license.id!,
              instanceId: instanceId,
              host: instanceHost || undefined,
            });
          }

          const instances: Array<EnterpriseLicenseInstance> =
            await this.findLicenseInstances(license.id!);

          const payload: JSONObject = {
            companyName: license.companyName || "",
            expiresAt: license.expiresAt.toISOString(),
            licenseKey: license.licenseKey || "",
            userLimit:
              typeof license.userLimit === "number" ? license.userLimit : null,
          };

          const token: string = JSONWebToken.signJsonPayload(
            payload,
            Math.max(secondsUntilExpiry, 1),
          );

          return Response.sendJsonObjectResponse(req, res, {
            companyName: payload["companyName"] as string,
            expiresAt: payload["expiresAt"] as string,
            licenseKey: payload["licenseKey"] as string,
            userLimit: payload["userLimit"],
            currentUserCount:
              typeof license.currentUserCount === "number"
                ? license.currentUserCount
                : null,
            userCountUpdatedAt: license.userCountUpdatedAt
              ? license.userCountUpdatedAt.toISOString()
              : null,
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
              select: {
                _id: true,
                userLimit: true,
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
          const userEmailHashes: Array<string> =
            EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes(
              req.body["userEmailHashes"],
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
              userCount: userCount,
              userEmailHashes: userEmailHashes,
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

          return Response.sendJsonObjectResponse(req, res, {
            currentUserCount: currentUserCount,
            userCountUpdatedAt: reportedAt.toISOString(),
            userLimit:
              typeof license.userLimit === "number" ? license.userLimit : null,
            instances: this.getInstanceSummaries(instances),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private parseShortText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().substring(0, 100);
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

    if (data.userCount !== undefined) {
      newInstance.userCount = data.userCount;
    }

    if (data.userEmailHashes !== undefined) {
      newInstance.userEmailHashes = data.userEmailHashes;
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

    if (data.userCount !== undefined) {
      updateData.userCount = data.userCount;
    }

    if (data.userEmailHashes !== undefined) {
      updateData.userEmailHashes = data.userEmailHashes;
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
