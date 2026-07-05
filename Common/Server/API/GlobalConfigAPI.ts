import GlobalConfigService, {
  Service as GlobalConfigServiceType,
} from "../Services/GlobalConfigService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import API from "../../Utils/API";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import PartialEntity from "../../Types/Database/PartialEntity";
import { EnterpriseLicenseValidationUrl, Host } from "../EnvironmentConfig";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import UserMiddleware from "../Middleware/UserAuthorization";

export default class GlobalConfigAPI extends BaseAPI<
  GlobalConfig,
  GlobalConfigServiceType
> {
  public constructor() {
    super(GlobalConfig, GlobalConfigService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/vars`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: ObjectID.getZeroObjectID(),
              select: {
                disableUserProjectCreation: true,
              },
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            disableUserProjectCreation: Boolean(
              globalConfig?.disableUserProjectCreation,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/license`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const config: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: ObjectID.getZeroObjectID(),
              select: {
                enterpriseCompanyName: true,
                enterpriseLicenseExpiresAt: true,
                enterpriseLicenseKey: true,
                enterpriseLicenseToken: true,
                enterpriseLicenseUserLimit: true,
                enterpriseLicenseCurrentUserCount: true,
                enterpriseLicenseUserCountUpdatedAt: true,
                enterpriseLicenseInstances: true,
                instanceId: true,
              },
              props: {
                isRoot: true,
              },
            });

          const responseBody: JSONObject = {
            companyName: config?.enterpriseCompanyName || null,
            expiresAt: config?.enterpriseLicenseExpiresAt
              ? config.enterpriseLicenseExpiresAt.toISOString()
              : null,
            licenseKey: config?.enterpriseLicenseKey || null,
            token: config?.enterpriseLicenseToken || null,
            userLimit:
              typeof config?.enterpriseLicenseUserLimit === "number"
                ? config.enterpriseLicenseUserLimit
                : null,
            currentUserCount:
              typeof config?.enterpriseLicenseCurrentUserCount === "number"
                ? config.enterpriseLicenseCurrentUserCount
                : null,
            userCountUpdatedAt: config?.enterpriseLicenseUserCountUpdatedAt
              ? config.enterpriseLicenseUserCountUpdatedAt.toISOString()
              : null,
            instances: Array.isArray(config?.enterpriseLicenseInstances)
              ? config.enterpriseLicenseInstances
              : [],
            instanceId: config?.instanceId
              ? config.instanceId.toString()
              : null,
          };

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/license`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const licenseKey: string =
            (req.body["licenseKey"] as string | undefined)?.trim() || "";

          if (!licenseKey) {
            throw new BadDataException("License key is required");
          }

          const globalConfigId: ObjectID = ObjectID.getZeroObjectID();

          const existingConfig: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: globalConfigId,
              select: {
                _id: true,
                instanceId: true,
              },
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            });

          /*
           * Send this instance's id and host along with the key so the
           * license server registers this instance against the license and
           * it shows up in the instance list on all instances that share
           * the license.
           */
          const instanceId: ObjectID =
            existingConfig?.instanceId || ObjectID.generate();

          const validationResponse:
            | HTTPResponse<JSONObject>
            | HTTPErrorResponse = await API.post<JSONObject>({
            url: EnterpriseLicenseValidationUrl,
            data: {
              licenseKey,
              instanceId: instanceId.toString(),
              host: Host,
            },
          });

          if (!validationResponse.isSuccess()) {
            const errorMessage: string =
              validationResponse instanceof HTTPErrorResponse
                ? validationResponse.message ||
                  "Failed to validate license key."
                : "Failed to validate license key.";
            throw new BadDataException(errorMessage);
          }

          const payload: JSONObject = validationResponse.data as JSONObject;

          const companyNameRaw: string =
            (payload["companyName"] as string | undefined)?.trim() || "";
          const expiresAtRaw: string =
            (payload["expiresAt"] as string | undefined) || "";
          const licenseKeyRaw: string =
            (payload["licenseKey"] as string | undefined)?.trim() || licenseKey;
          const licenseToken: string =
            (payload["token"] as string | undefined) || "";

          let licenseExpiry: Date | undefined = undefined;
          if (expiresAtRaw) {
            const parsedDate: Date = new Date(expiresAtRaw);

            if (Number.isNaN(parsedDate.getTime())) {
              throw new BadDataException(
                "License expiration returned from server is invalid.",
              );
            }

            licenseExpiry = parsedDate;
          }

          const userLimitRaw: unknown = payload["userLimit"];
          const userLimit: number | null =
            typeof userLimitRaw === "number" && Number.isFinite(userLimitRaw)
              ? userLimitRaw
              : null;

          const currentUserCountRaw: unknown = payload["currentUserCount"];
          const currentUserCount: number | null =
            typeof currentUserCountRaw === "number" &&
            Number.isFinite(currentUserCountRaw)
              ? currentUserCountRaw
              : null;

          const userCountUpdatedAtRaw: string | undefined = payload[
            "userCountUpdatedAt"
          ] as string | undefined;
          let userCountUpdatedAt: Date | null = null;
          if (userCountUpdatedAtRaw) {
            const parsedReportedAt: Date = new Date(userCountUpdatedAtRaw);
            if (!Number.isNaN(parsedReportedAt.getTime())) {
              userCountUpdatedAt = parsedReportedAt;
            }
          }

          const instances: Array<EnterpriseLicenseInstanceSummary> =
            Array.isArray(payload["instances"])
              ? (payload[
                  "instances"
                ] as Array<EnterpriseLicenseInstanceSummary>)
              : [];

          const updatePayload: PartialEntity<GlobalConfig> = {
            enterpriseCompanyName: companyNameRaw || null,
            enterpriseLicenseKey: licenseKeyRaw || null,
            enterpriseLicenseExpiresAt: licenseExpiry || null,
            enterpriseLicenseToken: licenseToken || null,
            enterpriseLicenseUserLimit: userLimit,
            enterpriseLicenseCurrentUserCount: currentUserCount,
            enterpriseLicenseUserCountUpdatedAt: userCountUpdatedAt,
            enterpriseLicenseInstances: instances,
          };

          if (!existingConfig?.instanceId) {
            // Installs that predate instance ids: persist the one we generated.
            updatePayload.instanceId = instanceId;
          }

          if (existingConfig) {
            await GlobalConfigService.updateOneById({
              id: globalConfigId,
              data: updatePayload,
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            });
          } else {
            const newConfig: GlobalConfig = new GlobalConfig();
            newConfig.id = globalConfigId;

            if (companyNameRaw) {
              newConfig.enterpriseCompanyName = companyNameRaw;
            }

            if (licenseKeyRaw) {
              newConfig.enterpriseLicenseKey = licenseKeyRaw;
            }

            if (licenseToken) {
              newConfig.enterpriseLicenseToken = licenseToken;
            }

            if (licenseExpiry) {
              newConfig.enterpriseLicenseExpiresAt = licenseExpiry;
            }

            if (userLimit !== null) {
              newConfig.enterpriseLicenseUserLimit = userLimit;
            }

            if (currentUserCount !== null) {
              newConfig.enterpriseLicenseCurrentUserCount = currentUserCount;
            }

            if (userCountUpdatedAt) {
              newConfig.enterpriseLicenseUserCountUpdatedAt =
                userCountUpdatedAt;
            }

            newConfig.enterpriseLicenseInstances = instances;
            newConfig.instanceId = instanceId;

            await GlobalConfigService.create({
              data: newConfig,
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            companyName: companyNameRaw || null,
            expiresAt: licenseExpiry ? licenseExpiry.toISOString() : null,
            licenseKey: licenseKeyRaw || null,
            token: licenseToken || null,
            userLimit: userLimit,
            currentUserCount: currentUserCount,
            userCountUpdatedAt: userCountUpdatedAt
              ? userCountUpdatedAt.toISOString()
              : null,
            instances: instances,
            instanceId: instanceId.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
