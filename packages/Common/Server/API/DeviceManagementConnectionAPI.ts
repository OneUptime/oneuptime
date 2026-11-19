import DeviceManagementConnection from "../../Models/DatabaseModels/DeviceManagementConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import { LlmConnectionFailureKind } from "../../Types/LlmObservability/LlmConnectionTest";
import {
  DeviceManagementConfig,
  readEsperTenant,
  toDeviceManagementConfigJson,
  validateDeviceManagementConfig,
} from "../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../Types/DeviceManagement/DeviceManagementProvider";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import DeviceManagementConnectionService, {
  Service as DeviceManagementConnectionServiceClass,
} from "../Services/DeviceManagementConnectionService";
import DataSourceHttpFetch from "../Utils/DataSource/HttpFetch";
import DeviceManagementConnectorRegistry from "../Utils/DeviceManagement/DeviceManagementConnectorRegistry";
import DeviceManagementScheduler from "../Utils/DeviceManagement/DeviceManagementScheduler";
import { DeviceManagementSettings } from "../Utils/DeviceManagement/DeviceManagementTypes";
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

/*
 * Device management connections (an Esper tenant): the CRUD routes, plus
 *
 *   POST /device-management-connection/test
 *     { config, secrets }                  settings never saved: the tenant
 *                                          and the key, as the connect
 *                                          dialog has them;
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

          let toTest: { apiKey: string; config: DeviceManagementConfig };

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

            const result: DeviceManagementTestResult = {
              provider: DeviceManagementProvider.Esper,
              status: "fail",
              message: error.message,
              failureKind: LlmConnectionFailureKind.Settings,
              tenant: DeviceManagementConnectionAPI.readTenantQuietly(body),
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
              DeviceManagementProvider.Esper,
            )
              .testConnection(toTest, {
                transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
              })
              .catch((error: unknown): DeviceManagementTestResult => {
                // testConnection never throws; this is the belt to its braces.
                const failure: LlmProviderError = LlmProviderError.from({
                  error,
                  step: "test",
                  providerTitle: "Esper",
                  secretValues: [toTest.apiKey],
                });

                return {
                  provider: DeviceManagementProvider.Esper,
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
        "Project Owners and Project Admins can connect, test and read Esper tenants.",
    });
  }

  // The tenant a test asked about, for its answer; "" when there is none.
  private static readTenantQuietly(body: JSONObject): string {
    const config: unknown = body["config"];

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return "";
    }

    try {
      return readEsperTenant((config as JSONObject)["tenant"]);
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
  }): Promise<{ apiKey: string; config: DeviceManagementConfig }> {
    const connectionIdValue: JSONValue | undefined = data.body["connectionId"];

    if (connectionIdValue === undefined || connectionIdValue === null) {
      DeviceManagementConnectionServiceClass.readProvider(
        data.body["provider"],
      );

      const secrets: { apiKey?: string | undefined } =
        DeviceManagementConnectionServiceClass.readSecrets(
          data.body["secrets"],
          { requireApiKey: true },
        );

      return {
        apiKey: secrets.apiKey!,
        config: validateDeviceManagementConfig(
          DeviceManagementConnectionServiceClass.parseJsonObject(
            data.body["config"],
            "Settings",
          ),
          { requireTenant: true },
        ),
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

    const provided: { apiKey?: string | undefined } =
      data.body["secrets"] !== undefined
        ? DeviceManagementConnectionServiceClass.readSecrets(
            data.body["secrets"],
            { requireApiKey: false },
          )
        : {};

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
            { requireTenant: true },
          )
        : stored.config;

    // The rule a save applies: a saved connection's tenant is fixed.
    if (config.tenant !== stored.config.tenant) {
      throw new BadDataException(
        "A saved connection is tested with its own tenant. To try another one, connect it as well.",
      );
    }

    return {
      apiKey: provided.apiKey || stored.apiKey,
      config,
    };
  }
}
