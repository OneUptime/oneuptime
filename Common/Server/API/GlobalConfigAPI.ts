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
  }
}
