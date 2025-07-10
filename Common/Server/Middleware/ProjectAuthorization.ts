import ApiKeyService from "../Services/ApiKeyService";
import GlobalConfigService from "../Services/GlobalConfigService";
import UserService from "../Services/UserService";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../Types/Permission";
import UserType from "../../Types/UserType";
import ApiKey from "../../Models/DatabaseModels/ApiKey";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import User from "../../Models/DatabaseModels/User";
import APIKeyAccessPermission from "../Utils/APIKey/AccessPermission";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class ProjectMiddleware {
  @CaptureSpan()
  public static getProjectId(req: ExpressRequest): ObjectID | null {
    let projectId: ObjectID | null = null;
    if (req.params && req.params["tenantid"]) {
      projectId = new ObjectID(req.params["tenantid"]);
    } else if (req.query && req.query["tenantid"]) {
      projectId = new ObjectID(req.query["tenantid"] as string);
    } else if (req.headers && req.headers["tenantid"]) {
      // Header keys are automatically transformed to lowercase
      projectId = new ObjectID(req.headers["tenantid"] as string);
    } else if (req.headers && req.headers["projectid"]) {
      // Header keys are automatically transformed to lowercase
      projectId = new ObjectID(req.headers["projectid"] as string);
    } else if (req.body && req.body.projectId) {
      projectId = new ObjectID(req.body.projectId as string);
    }

    return projectId;
  }

  @CaptureSpan()
  public static getApiKey(req: ExpressRequest): ObjectID | null {
    if (req.headers && req.headers["apikey"]) {
      return new ObjectID(req.headers["apikey"] as string);
    }

    return null;
  }

  @CaptureSpan()
  public static hasApiKey(req: ExpressRequest): boolean {
    return Boolean(this.getApiKey(req));
  }

  @CaptureSpan()
  public static hasProjectID(req: ExpressRequest): boolean {
    return Boolean(this.getProjectId(req));
  }

  @CaptureSpan()
  public static async isValidProjectIdAndApiKeyMiddleware(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let tenantId: ObjectID | null = this.getProjectId(req);

      const apiKey: ObjectID | null = this.getApiKey(req);

      if (tenantId) {
        (req as OneUptimeRequest).tenantId = tenantId;
      }

      if (!apiKey) {
        throw new BadDataException(
          "API Key not found in the request header. Please provide a valid API Key in the request header.",
        );
      }

      let apiKeyModel: ApiKey | null = null;

      if (apiKey) {
        apiKeyModel = await ApiKeyService.findOneBy({
          query: {
            apiKey: apiKey,
            expiresAt: QueryHelper.greaterThan(OneUptimeDate.getCurrentDate()),
          },
          select: {
            _id: true,
            projectId: true,
          },
          props: { isRoot: true },
        });

        if (apiKeyModel) {
          tenantId = apiKeyModel?.projectId || null;

          if (!tenantId) {
            throw new BadDataException("Invalid API Key");
          }

          (req as OneUptimeRequest).tenantId = tenantId;

          if (apiKeyModel) {
            (req as OneUptimeRequest).userType = UserType.API;
            // TODO: Add API key permissions.
            // (req as OneUptimeRequest).permissions =
            //     apiKeyModel.permissions || [];
            (req as OneUptimeRequest).userGlobalAccessPermission =
              await APIKeyAccessPermission.getDefaultApiGlobalPermission(
                tenantId,
              );

            const userTenantAccessPermission: UserTenantAccessPermission | null =
              await APIKeyAccessPermission.getApiTenantAccessPermission(
                tenantId,
                apiKeyModel.id!,
              );

            if (userTenantAccessPermission) {
              (req as OneUptimeRequest).userTenantAccessPermission = {};
              (
                (req as OneUptimeRequest)
                  .userTenantAccessPermission as Dictionary<UserTenantAccessPermission>
              )[tenantId.toString()] = userTenantAccessPermission;

              return next();
            }
          }
        }
      }

      if (!apiKeyModel) {
        // check master key.
        const masterKeyGlobalConfig: GlobalConfig | null =
          await GlobalConfigService.findOneBy({
            query: {
              _id: ObjectID.getZeroObjectID().toString(),
              isMasterApiKeyEnabled: true,
              masterApiKey: apiKey,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
            },
          });

        if (masterKeyGlobalConfig) {
          (req as OneUptimeRequest).userType = UserType.MasterAdmin;

          // get master admin user

          const user: User | null = await UserService.findOneBy({
            query: {
              isMasterAdmin: true,
            },
            select: {
              _id: true,
              email: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!user) {
            throw new BadDataException(
              "Master Admin user not found. Please make sure you have created a master admin user.",
            );
          }

          (req as OneUptimeRequest).userAuthorization = {
            userId: user.id!,
            isMasterAdmin: true,
            email: user.email!,
            name: user.name!,
            isGlobalLogin: true,
          };

          return next();
        }
      }

      if (apiKey) {
        // If we have an API key but no tenant ID, we throw an error.
        throw new BadDataException("Invalid API Key");
      }

      if (!tenantId) {
        throw new BadDataException(
          "ProjectID not found in the request header.",
        );
      }

      throw new BadDataException("Invalid Project ID or API Key");
    } catch (err) {
      next(err);
    }
  }
}
