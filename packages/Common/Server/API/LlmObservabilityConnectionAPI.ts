import LlmObservabilityConnection from "../../Models/DatabaseModels/LlmObservabilityConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import { LlmConnectionTestResult } from "../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import LlmObservabilityConnectionService, {
  Service as LlmObservabilityConnectionServiceClass,
} from "../Services/LlmObservabilityConnectionService";
import DataSourceHttpFetch from "../Utils/DataSource/HttpFetch";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import LlmConnectionScheduler from "../Utils/LlmObservability/LlmConnectionScheduler";
import LlmConnectorRegistry from "../Utils/LlmObservability/LlmConnectorRegistry";
import LlmConnectorTestResults from "../Utils/LlmObservability/LlmConnectorTestResults";
import {
  LlmConnectionSettings,
  getSecretValues,
} from "../Utils/LlmObservability/LlmConnectorTypes";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * AI connections: the CRUD routes, plus
 *
 *   POST /llm-observability-connection/test
 *     { connectionId, config?, secrets? }   a saved connection, with the
 *                                           edit form's unsaved values over
 *                                           it (a secret left empty keeps
 *                                           the stored one), or
 *     { provider, config, secrets }         settings never saved, so the
 *                                           form can test before a save.
 *     -> LlmConnectionTestResult. Reads a few days of usage, or counts the
 *        newest chats; imports nothing, stores nothing.
 *
 *   POST /llm-observability-connection/:connectionId/read-now
 *     -> queues a read of the connection now.
 *
 * Both are for whoever may edit connections (project owners and admins):
 * a test reads a provider account with its admin key, and a read imports.
 */
export default class LlmObservabilityConnectionAPI extends BaseAPI<
  LlmObservabilityConnection,
  LlmObservabilityConnectionServiceClass
> {
  public constructor() {
    super(LlmObservabilityConnection, LlmObservabilityConnectionService);

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

          let settings: LlmConnectionSettings;

          try {
            settings = await this.readSettingsToTest({ body, projectId, props });
          } catch (error) {
            /*
             * Settings the form could still fix (a key of the wrong kind, a
             * subscription that is not a GUID) are the test's answer, shown
             * next to the field, not a failed request.
             */
            if (!(error instanceof BadDataException)) {
              throw error;
            }

            return Response.sendJsonObjectResponse(
              req,
              res,
              LlmConnectorTestResults.fromError({
                provider: String(body["provider"] || ""),
                error,
                secretValues: [],
                durationMs: 0,
              }) as unknown as JSONObject,
            );
          }

          const result: LlmConnectionTestResult = await LlmConnectorRegistry.getConnector(
            settings.provider,
          )
            .testConnection(settings, {
              transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
            })
            .catch((error: unknown): LlmConnectionTestResult => {
              // testConnection never throws; this is the belt to its braces.
              return LlmConnectorTestResults.fromError({
                provider: settings.provider,
                error,
                secretValues: getSecretValues(settings),
                durationMs: 0,
              });
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

          const connection: LlmObservabilityConnection | null =
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

          await LlmConnectionScheduler.enqueue(
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
      allowedPermissions: new LlmObservabilityConnection().getUpdatePermissions(),
      errorMessage:
        "Project owners and project administrators can test and read AI connections.",
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
  }): Promise<LlmConnectionSettings> {
    const connectionIdValue: JSONValue | undefined = data.body["connectionId"];

    if (connectionIdValue === undefined || connectionIdValue === null) {
      return LlmObservabilityConnectionServiceClass.validateSettings({
        provider: data.body["provider"],
        config: LlmObservabilityConnectionServiceClass.parseJsonObject(
          data.body["config"],
          "Settings",
        ),
        secrets: LlmObservabilityConnectionServiceClass.parseJsonObject(
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

    const accessible: LlmObservabilityConnection | null =
      await this.service.findOneBy({
        query: { _id: connectionId, projectId: data.projectId },
        select: { _id: true, projectId: true },
        props: data.props,
      });
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: accessible?.projectId,
      projectId: data.projectId,
    });

    const stored: LlmConnectionSettings =
      await this.service.getConnectorSettings(
        (() => {
          const connection: LlmObservabilityConnection =
            new LlmObservabilityConnection();
          connection.id = new ObjectID(connectionId);
          return connection;
        })(),
      );

    return LlmObservabilityConnectionServiceClass.validateSettings({
      provider: stored.provider,
      config:
        data.body["config"] !== undefined
          ? LlmObservabilityConnectionServiceClass.parseJsonObject(
              data.body["config"],
              "Settings",
            )
          : stored.config,
      secrets: LlmObservabilityConnectionServiceClass.mergeSecrets({
        definition: LlmObservabilityConnectionServiceClass.getDefinitionOrThrow(
          stored.provider,
        ),
        stored: stored.secrets,
        provided:
          data.body["secrets"] !== undefined
            ? LlmObservabilityConnectionServiceClass.parseJsonObject(
                data.body["secrets"],
                "Credentials",
              )
            : {},
      }),
      requireRequiredSecrets: true,
    });
  }
}
