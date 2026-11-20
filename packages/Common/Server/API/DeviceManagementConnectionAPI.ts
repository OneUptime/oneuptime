import DeviceManagementConnection from "../../Models/DatabaseModels/DeviceManagementConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import { LlmConnectionFailureKind } from "../../Types/LlmObservability/LlmConnectionTest";
import {
  DeviceManagementConfig,
  readEsperTenant,
  readIntuneTenant,
  readSotiServer,
  readWorkspaceOneServer,
  toDeviceManagementConfigJson,
  validateDeviceManagementConfig,
} from "../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider, {
  getDeviceManagementProviderTitle,
  isDeviceManagementProvider,
} from "../../Types/DeviceManagement/DeviceManagementProvider";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import DeviceManagementConnectionService, {
  DeviceManagementSecretValues,
  Service as DeviceManagementConnectionServiceClass,
  getDeviceManagementSecretRules,
} from "../Services/DeviceManagementConnectionService";
import DataSourceHttpFetch from "../Utils/DataSource/HttpFetch";
import DeviceManagementConnectorRegistry from "../Utils/DeviceManagement/DeviceManagementConnectorRegistry";
import DeviceManagementScheduler from "../Utils/DeviceManagement/DeviceManagementScheduler";
import {
  DeviceManagementSecrets,
  DeviceManagementSettings,
  getDeviceManagementSecretValues,
} from "../Utils/DeviceManagement/DeviceManagementTypes";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import LlmProviderError from "../Utils/LlmObservability/LlmProviderError";
import Response from "../Utils/Response";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

// What a test reads with: the service, its settings and its secrets.
type SettingsToTest = DeviceManagementSecrets & {
  provider: DeviceManagementProvider;
  config: DeviceManagementConfig;
};

/*
 * Device management connections (an Esper tenant, a Microsoft Intune
 * tenant, a Workspace ONE UEM or SOTI MobiControl server): the CRUD
 * routes, plus
 *
 *   POST /device-management-connection/test
 *     { provider?, config, secrets }       settings never saved: the tenant
 *                                          and the secret, as the connect
 *                                          dialog has them (Esper when no
 *                                          provider is named);
 *     { connectionId, config?, secrets? }  a saved connection, with the edit
 *                                          form's unsaved values over it (a
 *                                          key left empty keeps the stored
 *                                          one).
 *     -> DeviceManagementTestResult. Two read-only calls; stores nothing.
 *
 *   POST /device-management-connection/:connectionId/read-now
 *     -> queues a read of the connection now.
 *
 * Both are for whoever may edit connections (project owners and admins): a
 * test signs in to the tenant with its key, and a read spends its API
 * budget.
 */
export default class DeviceManagementConnectionAPI extends BaseAPI<
  DeviceManagementConnection,
  DeviceManagementConnectionServiceClass
> {
  public constructor() {
    super(DeviceManagementConnection, DeviceManagementConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Inventory),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          let toTest: SettingsToTest;

          try {
            toTest = await this.readSettingsToTest({ body, projectId, props });
          } catch (error) {
            /*
             * Settings the form can still fix (a tenant that cannot be one,
             * a key that is not a key) are the test's answer, shown in the
             * form - not a failed request.
             */
            if (!(error instanceof BadDataException)) {
              throw error;
            }

            const provider: DeviceManagementProvider =
              DeviceManagementConnectionAPI.readProviderQuietly(body);
            const result: DeviceManagementTestResult = {
              provider: provider,
              status: "fail",
              message: error.message,
              failureKind: LlmConnectionFailureKind.Settings,
              tenant: DeviceManagementConnectionAPI.readTenantQuietly(
                body,
                provider,
              ),
              durationMs: 0,
            };

            return Response.sendJsonObjectResponse(
              req,
              res,
              result as unknown as JSONObject,
            );
          }

          const result: DeviceManagementTestResult =
            await DeviceManagementConnectorRegistry.getConnector(
              toTest.provider,
            )
              .testConnection(toTest, {
                transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
              })
              .catch((error: unknown): DeviceManagementTestResult => {
                // testConnection never throws; this is the belt to its braces.
                const failure: LlmProviderError = LlmProviderError.from({
                  error,
                  step: "test",
                  providerTitle: getDeviceManagementProviderTitle(
                    toTest.provider,
                  ),
                  secretValues: getDeviceManagementSecretValues(toTest),
                });

                return {
                  provider: toTest.provider,
                  status: "fail",
                  message: failure.message,
                  failureKind: failure.kind,
                  tenant: toTest.config.tenant,
                  durationMs: 0,
                };
              });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:connectionId/read-now`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Inventory),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const connectionId: string | undefined = req.params["connectionId"];

          if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
            throw new BadDataException("A valid connection ID is required.");
          }

          const connection: DeviceManagementConnection | null =
            await this.service.findOneBy({
              query: { _id: connectionId, projectId },
              select: { _id: true, projectId: true, isEnabled: true },
              props,
            });
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: connection?.projectId,
            projectId,
          });

          if (!connection?.isEnabled) {
            throw new BadDataException(
              "This connection is turned off. Turn it on to read it.",
            );
          }

          await DeviceManagementScheduler.enqueue(
            new ObjectID(connectionId),
            new Date(),
          );

          return Response.sendJsonObjectResponse(req, res, { queued: true });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private assertCanOperate(props: DatabaseCommonInteractionProps): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions:
        new DeviceManagementConnection().getUpdatePermissions(),
      errorMessage:
        "Project Owners and Project Admins can connect, test and read device management connections.",
    });
  }

  // The service a test asked about, for its answer: Esper when it named none it knows.
  private static readProviderQuietly(
    body: JSONObject,
  ): DeviceManagementProvider {
    const provider: unknown = body["provider"];

    return isDeviceManagementProvider(provider)
      ? provider
      : DeviceManagementProvider.Esper;
  }

  // The tenant a test asked about, for its answer; "" when there is none.
  private static readTenantQuietly(
    body: JSONObject,
    provider: DeviceManagementProvider,
  ): string {
    const config: unknown = body["config"];

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return "";
    }

    try {
      const tenant: unknown = (config as JSONObject)["tenant"];

      switch (provider) {
        case DeviceManagementProvider.Intune:
          return readIntuneTenant(tenant);
        case DeviceManagementProvider.WorkspaceOne:
          return readWorkspaceOneServer(tenant);
        case DeviceManagementProvider.Soti:
          return readSotiServer(tenant);
        default:
          return readEsperTenant(tenant);
      }
    } catch {
      return "";
    }
  }

  /*
   * What a test reads with: settings never saved, or a saved connection's
   * with the form's unsaved values merged over them by the rule a save
   * applies. Checked either way, so a test never sends a request a save
   * would refuse.
   */
  private async readSettingsToTest(data: {
    body: JSONObject;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SettingsToTest> {
    const connectionIdValue: JSONValue | undefined = data.body["connectionId"];

    if (connectionIdValue === undefined || connectionIdValue === null) {
      const provider: DeviceManagementProvider =
        DeviceManagementConnectionServiceClass.readProvider(
          data.body["provider"],
        );
      const config: DeviceManagementConfig = validateDeviceManagementConfig(
        DeviceManagementConnectionServiceClass.parseJsonObject(
          data.body["config"],
          "Settings",
        ),
        { requireTenant: true, provider },
      );

      const secrets: DeviceManagementSecretValues =
        DeviceManagementConnectionServiceClass.readSecrets(
          data.body["secrets"],
          { required: true, provider, config },
        );

      return {
        provider,
        apiKey: secrets.apiKey || "",
        ...(secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {}),
        ...(secrets.password ? { password: secrets.password } : {}),
        config,
      };
    }

    const connectionId: string = String(connectionIdValue);

    if (!ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException("A valid connection ID is required.");
    }

    const accessible: DeviceManagementConnection | null =
      await this.service.findOneBy({
        query: { _id: connectionId, projectId: data.projectId },
        select: { _id: true, projectId: true },
        props: data.props,
      });
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: accessible?.projectId,
      projectId: data.projectId,
    });

    const stored: DeviceManagementSettings =
      await this.service.getDeviceManagementSettings(
        ((): DeviceManagementConnection => {
          const connection: DeviceManagementConnection =
            new DeviceManagementConnection();
          connection.id = new ObjectID(connectionId);
          return connection;
        })(),
      );

    const config: DeviceManagementConfig =
      data.body["config"] !== undefined
        ? validateDeviceManagementConfig(
            {
              ...toDeviceManagementConfigJson(stored.config),
              ...DeviceManagementConnectionServiceClass.parseJsonObject(
                data.body["config"],
                "Settings",
              ),
            },
            { requireTenant: true, provider: stored.provider },
          )
        : stored.config;

    // The rule a save applies: a saved connection's tenant (and cloud) is fixed.
    if (
      config.tenant !== stored.config.tenant ||
      (config.cloud || "") !== (stored.config.cloud || "")
    ) {
      throw new BadDataException(
        "A saved connection is tested with its own tenant. To try another one, connect it as well.",
      );
    }

    const provided: DeviceManagementSecretValues =
      data.body["secrets"] !== undefined
        ? DeviceManagementConnectionServiceClass.readSecrets(
            data.body["secrets"],
            { required: false, provider: stored.provider, config },
          )
        : {};

    /*
     * The rule a save applies to the secrets: one left empty keeps the
     * stored one - unless the connection signs in another way now, whose
     * secrets are all new.
     */
    const isSameSignIn: boolean =
      (config.authMethod || "") === (stored.config.authMethod || "");
    const secrets: DeviceManagementSecretValues = {};

    for (const rule of getDeviceManagementSecretRules(
      stored.provider,
      config,
    )) {
      secrets[rule.key] =
        provided[rule.key] ||
        rule.read(isSameSignIn ? stored[rule.key] : undefined);
    }

    return {
      provider: stored.provider,
      apiKey: secrets.apiKey || "",
      ...(secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {}),
      ...(secrets.password ? { password: secrets.password } : {}),
      config,
    };
  }
}
