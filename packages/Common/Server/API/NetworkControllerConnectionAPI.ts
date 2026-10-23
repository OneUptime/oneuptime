import NetworkControllerConnection from "../../Models/DatabaseModels/NetworkControllerConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import { LlmConnectionFailureKind } from "../../Types/LlmObservability/LlmConnectionTest";
import {
  NetworkControllerConfig,
  toNetworkControllerConfigJson,
  validateNetworkControllerConfig,
} from "../../Types/NetworkController/NetworkControllerConnectionSettings";
import { NetworkControllerTestResult } from "../../Types/NetworkController/NetworkControllerConnectionTest";
import NetworkControllerProvider from "../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkControllerConnectionService, {
  Service as NetworkControllerConnectionServiceClass,
} from "../Services/NetworkControllerConnectionService";
import DataSourceHttpFetch from "../Utils/DataSource/HttpFetch";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import LlmProviderError from "../Utils/LlmObservability/LlmProviderError";
import NetworkControllerConnectorRegistry from "../Utils/NetworkController/NetworkControllerConnectorRegistry";
import NetworkControllerScheduler from "../Utils/NetworkController/NetworkControllerScheduler";
import { NetworkControllerSettings } from "../Utils/NetworkController/NetworkControllerTypes";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Network controller connections (a Meraki organization): the CRUD routes,
 * plus
 *
 *   POST /network-controller-connection/test
 *     { config, secrets }                  settings never saved: the key and
 *                                          the region, the organization when
 *                                          one is picked - so the connect
 *                                          dialog lists the organizations
 *                                          the key reads, then counts the
 *                                          picked one's networks;
 *     { connectionId, config?, secrets? }  a saved connection, with the edit
 *                                          form's unsaved values over it (a
 *                                          key left empty keeps the stored
 *                                          one).
 *     -> NetworkControllerTestResult. A few read-only calls; stores nothing.
 *
 *   POST /network-controller-connection/:connectionId/read-now
 *     -> queues a read of the connection now.
 *
 * Both are for whoever may edit connections (project owners and admins): a
 * test signs in to the organization with its key, and a read spends its
 * API budget.
 */
export default class NetworkControllerConnectionAPI extends BaseAPI<
  NetworkControllerConnection,
  NetworkControllerConnectionServiceClass
> {
  public constructor() {
    super(NetworkControllerConnection, NetworkControllerConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
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

          let toTest: { apiKey: string; config: NetworkControllerConfig };

          try {
            toTest = await this.readSettingsToTest({ body, projectId, props });
          } catch (error) {
            /*
             * Settings the form can still fix (a key that cannot be one, a
             * region that is not Meraki's) are the test's answer, shown in
             * the form - not a failed request.
             */
            if (!(error instanceof BadDataException)) {
              throw error;
            }

            const result: NetworkControllerTestResult = {
              provider: NetworkControllerProvider.Meraki,
              status: "fail",
              message: error.message,
              failureKind: LlmConnectionFailureKind.Settings,
              organizations: [],
              durationMs: 0,
            };

            return Response.sendJsonObjectResponse(
              req,
              res,
              result as unknown as JSONObject,
            );
          }

          const result: NetworkControllerTestResult =
            await NetworkControllerConnectorRegistry.getConnector(
              NetworkControllerProvider.Meraki,
            )
              .testConnection(toTest, {
                transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
              })
              .catch((error: unknown): NetworkControllerTestResult => {
                // testConnection never throws; this is the belt to its braces.
                const failure: LlmProviderError = LlmProviderError.from({
                  error,
                  step: "test",
                  providerTitle: "Meraki",
                  secretValues: [toTest.apiKey],
                });

                return {
                  provider: NetworkControllerProvider.Meraki,
                  status: "fail",
                  message: failure.message,
                  failureKind: failure.kind,
                  organizations: [],
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

          const connection: NetworkControllerConnection | null =
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

          await NetworkControllerScheduler.enqueue(
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
      allowedPermissions: new NetworkControllerConnection().getUpdatePermissions(),
      errorMessage:
        "Project owners and project administrators can connect, test and read Meraki organizations.",
    });
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
  }): Promise<{ apiKey: string; config: NetworkControllerConfig }> {
    const connectionIdValue: JSONValue | undefined = data.body["connectionId"];

    if (connectionIdValue === undefined || connectionIdValue === null) {
      NetworkControllerConnectionServiceClass.readProvider(
        data.body["provider"],
      );

      const secrets: { apiKey?: string | undefined } =
        NetworkControllerConnectionServiceClass.readSecrets(
          data.body["secrets"],
          { requireApiKey: true },
        );

      return {
        apiKey: secrets.apiKey!,
        config: validateNetworkControllerConfig(
          NetworkControllerConnectionServiceClass.parseJsonObject(
            data.body["config"],
            "Settings",
          ),
          { requireOrganization: false },
        ),
      };
    }

    const connectionId: string = String(connectionIdValue);

    if (!ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException("A valid connection ID is required.");
    }

    const accessible: NetworkControllerConnection | null =
      await this.service.findOneBy({
        query: { _id: connectionId, projectId: data.projectId },
        select: { _id: true, projectId: true },
        props: data.props,
      });
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: accessible?.projectId,
      projectId: data.projectId,
    });

    const stored: NetworkControllerSettings =
      await this.service.getControllerSettings(
        ((): NetworkControllerConnection => {
          const connection: NetworkControllerConnection =
            new NetworkControllerConnection();
          connection.id = new ObjectID(connectionId);
          return connection;
        })(),
      );

    const provided: { apiKey?: string | undefined } =
      data.body["secrets"] !== undefined
        ? NetworkControllerConnectionServiceClass.readSecrets(
            data.body["secrets"],
            { requireApiKey: false },
          )
        : {};

    const config: NetworkControllerConfig =
      data.body["config"] !== undefined
        ? validateNetworkControllerConfig(
            {
              ...toNetworkControllerConfigJson(stored.config),
              ...NetworkControllerConnectionServiceClass.parseJsonObject(
                data.body["config"],
                "Settings",
              ),
            },
            { requireOrganization: true },
          )
        : stored.config;

    return {
      apiKey: provided.apiKey || stored.apiKey,
      config,
    };
  }
}
