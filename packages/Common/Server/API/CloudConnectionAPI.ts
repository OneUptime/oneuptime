import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudConnectionAwsRoleSetup } from "../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionTestResult } from "../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudConnectionService, {
  Service as CloudConnectionServiceClass,
} from "../Services/CloudConnectionService";
import AwsServerIdentity from "../Utils/CloudConnection/Aws/AwsServerIdentity";
import CloudConnectionScheduler from "../Utils/CloudConnection/CloudConnectionScheduler";
import CloudConnectorRegistry from "../Utils/CloudConnection/CloudConnectorRegistry";
import {
  CloudConnectionSettings,
  getCloudSecretValues,
} from "../Utils/CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../Utils/DataSource/HttpFetch";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import LlmProviderError from "../Utils/LlmObservability/LlmProviderError";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Cloud connections: the CRUD routes, plus
 *
 *   POST /cloud-connection/test
 *     { connectionId, config?, secrets? }   a saved connection, with the
 *                                           edit form's unsaved values over
 *                                           it (a secret left empty keeps
 *                                           the stored one), or
 *     { provider, config, secrets }         settings never saved, so the
 *                                           form can test before a save.
 *     -> CloudConnectionTestResult. Signs in and counts a little of what a
 *        read would find; stores nothing.
 *
 *   POST /cloud-connection/:connectionId/read-now
 *     -> queues a read of the connection now.
 *
 *   GET /cloud-connection/aws-role-setup
 *     -> CloudConnectionAwsRoleSetup: whether this OneUptime can sign in to
 *        an AWS role, the principal a role must trust, and the project's
 *        external id - what the IAM role command is written from.
 *
 * All three are for whoever may edit connections (project owners and
 * admins): a test signs in to a cloud account with its credential, a read
 * imports, and the role setup is the first step of making one.
 */
export default class CloudConnectionAPI extends BaseAPI<
  CloudConnection,
  CloudConnectionServiceClass
> {
  public constructor() {
    super(CloudConnection, CloudConnectionService);

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

          let settings: CloudConnectionSettings;

          try {
            settings = await this.readSettingsToTest({
              body,
              projectId,
              props,
            });
          } catch (error) {
            /*
             * Settings the form could still fix (a role ARN of the wrong
             * shape, a tenant that is not a GUID) are the test's answer,
             * shown next to the field, not a failed request.
             */
            if (!(error instanceof BadDataException)) {
              throw error;
            }

            const result: CloudConnectionTestResult = {
              provider: String(body["provider"] || ""),
              status: "fail",
              message: error.message,
              failureKind:
                "settings" as CloudConnectionTestResult["failureKind"],
              durationMs: 0,
            };

            return Response.sendJsonObjectResponse(
              req,
              res,
              result as unknown as JSONObject,
            );
          }

          const result: CloudConnectionTestResult =
            await CloudConnectorRegistry.getConnector(settings.provider)
              .testConnection(settings, {
                transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
              })
              .catch((error: unknown): CloudConnectionTestResult => {
                // testConnection never throws; this is the belt to its braces.
                const failure: LlmProviderError = LlmProviderError.from({
                  error,
                  step: "test",
                  providerTitle: settings.provider,
                  secretValues: getCloudSecretValues(settings),
                });

                return {
                  provider: settings.provider,
                  status: "fail",
                  message: failure.message,
                  failureKind: failure.kind,
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

          const connection: CloudConnection | null =
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

          await CloudConnectionScheduler.enqueue(
            new ObjectID(connectionId),
            new Date(),
          );

          return Response.sendJsonObjectResponse(req, res, { queued: true });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.get(
      `${basePath}/aws-role-setup`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const setup: CloudConnectionAwsRoleSetup =
            await AwsServerIdentity.getRoleSetup({
              projectId: projectId.toString(),
              transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            setup as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private assertCanOperate(props: DatabaseCommonInteractionProps): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new CloudConnection().getUpdatePermissions(),
      errorMessage:
        "Project owners and project administrators can connect, test and read cloud accounts.",
    });
  }

  /*
   * The settings a test reads with: a saved connection's, with the form's
   * unsaved values merged over them by the rule a save applies, or settings
   * that were never saved. Validated either way, so a test never sends a
   * request a save would refuse.
   */
  private async readSettingsToTest(data: {
    body: JSONObject;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CloudConnectionSettings> {
    const connectionIdValue: JSONValue | undefined = data.body["connectionId"];

    if (connectionIdValue === undefined || connectionIdValue === null) {
      return CloudConnectionServiceClass.validateSettings({
        provider: data.body["provider"],
        projectId: data.projectId,
        config: CloudConnectionServiceClass.parseJsonObject(
          data.body["config"],
          "Settings",
        ),
        secrets: CloudConnectionServiceClass.parseJsonObject(
          data.body["secrets"],
          "Credentials",
        ),
        requireRequiredSecrets: true,
      });
    }

    const connectionId: string = String(connectionIdValue);

    if (!ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException("A valid connection ID is required.");
    }

    const accessible: CloudConnection | null = await this.service.findOneBy({
      query: { _id: connectionId, projectId: data.projectId },
      select: { _id: true, projectId: true },
      props: data.props,
    });
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: accessible?.projectId,
      projectId: data.projectId,
    });

    const stored: CloudConnectionSettings =
      await this.service.getConnectorSettings(
        (() => {
          const connection: CloudConnection = new CloudConnection();
          connection.id = new ObjectID(connectionId);
          return connection;
        })(),
      );

    return CloudConnectionServiceClass.validateSettings({
      provider: stored.provider,
      // Always the connection's own project, never one the body names.
      projectId: stored.projectId,
      config:
        data.body["config"] !== undefined
          ? CloudConnectionServiceClass.parseJsonObject(
              data.body["config"],
              "Settings",
            )
          : stored.config,
      secrets: CloudConnectionServiceClass.mergeSecrets({
        definition: CloudConnectionServiceClass.getDefinitionOrThrow(
          stored.provider,
        ),
        stored: stored.secrets,
        provided:
          data.body["secrets"] !== undefined
            ? CloudConnectionServiceClass.parseJsonObject(
                data.body["secrets"],
                "Credentials",
              )
            : {},
      }),
      requireRequiredSecrets: true,
    });
  }
}
