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
import { EnterpriseLicenseValidationUrl } from "../EnvironmentConfig";
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
          /*
           * const globalConfig: GlobalConfig | null =
           *     await GlobalConfigService.findOneById({
           *         id: ObjectID.getZeroObjectID(),
           *         select: {
           *             useHttps: true,
           *         },
           *         props: {
           *             isRoot: true,
           *         },
           *     });
           */

          return Response.sendJsonObjectResponse(req, res, {
            /*
             * USE_HTTPS:
             *     globalConfig?.useHttps?.toString() || 'false',
             */
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

          const validationResponse:
            | HTTPResponse<JSONObject>
            | HTTPErrorResponse = await API.post<JSONObject>({
            url: EnterpriseLicenseValidationUrl,
            data: {
              licenseKey,
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

          const updatePayload: PartialEntity<GlobalConfig> = {
            enterpriseCompanyName: companyNameRaw || null,
            enterpriseLicenseKey: licenseKeyRaw || null,
            enterpriseLicenseExpiresAt: licenseExpiry || null,
            enterpriseLicenseToken: licenseToken || null,
          };

          const globalConfigId: ObjectID = ObjectID.getZeroObjectID();

          const existingConfig: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: globalConfigId,
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            });

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
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
