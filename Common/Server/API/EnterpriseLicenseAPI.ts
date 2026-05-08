import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import EnterpriseLicenseService, {
  Service as EnterpriseLicenseServiceType,
} from "../Services/EnterpriseLicenseService";
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

          await EnterpriseLicenseService.updateOneById({
            id: license.id!,
            data: {
              currentUserCount: userCount,
              userCountUpdatedAt: reportedAt,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            currentUserCount: userCount,
            userCountUpdatedAt: reportedAt.toISOString(),
            userLimit:
              typeof license.userLimit === "number" ? license.userLimit : null,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
