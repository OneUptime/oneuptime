import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceType,
} from "../Services/SecurityEventConnectionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityEventConnectionRunExecutor from "../Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import SecurityEventConnectionTester from "../Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import { SecurityConnectorSettings } from "../Utils/SecurityEvent/Connectors/Types";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

export default class SecurityEventConnectionAPI extends BaseAPI<
  SecurityEventConnection,
  SecurityEventConnectionServiceType
> {
  public constructor() {
    super(SecurityEventConnection, SecurityEventConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    /*
     * Queue an operation (test, poll, preview, backfill) for the worker.
     * Same gate as editing the connection: whoever may configure it may
     * operate it.
     */
    this.router.post(
      `${basePath}/:connectionId/run`,
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

          const connection: SecurityEventConnection | null =
            await this.service.findOneBy({
              query: { _id: connectionId, projectId },
              select: { _id: true, projectId: true },
              props,
            });
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: connection?.projectId,
            projectId,
          });

          const runId: ObjectID =
            await SecurityEventConnectionRunExecutor.enqueue({
              projectId,
              connectionId: new ObjectID(connectionId),
              options: SecurityEventConnectionRunExecutor.validateOptions(
                req.body,
              ),
              requestedByUserId: props.userId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            runId: runId.toString(),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * Synchronous connection test. Body is either
     *   { connectionId, config?, secrets? }  — a saved connection, optionally
     *     with unsaved edits overlaid by the same rule a save applies (a
     *     secret value replaces the stored one, "" or undefined keeps it,
     *     null removes it, so the edit form can test a cleared optional
     *     credential before saving), or
     *   { provider, config, secrets, alertingOnly? } — settings that were
     *     never saved, so the create form can test before storing anything.
     * Nothing is persisted except a run-history row for a saved connection.
     */
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

          const connectionIdValue: JSONValue | undefined = body["connectionId"];
          let connection: SecurityEventConnection | undefined = undefined;
          let settings: SecurityConnectorSettings;

          if (connectionIdValue !== undefined && connectionIdValue !== null) {
            const connectionId: string = String(connectionIdValue);

            if (!ObjectID.isValidUUID(connectionId)) {
              throw new BadDataException("A valid connection ID is required.");
            }

            const accessible: SecurityEventConnection | null =
              await this.service.findOneBy({
                query: { _id: connectionId, projectId },
                select: { _id: true, projectId: true },
                props,
              });
            CommonAPI.assertResourceBelongsToProject({
              resourceProjectId: accessible?.projectId,
              projectId,
            });

            const loaded: SecurityEventConnection | null =
              await this.service.findOneById({
                id: new ObjectID(connectionId),
                select: {
                  _id: true,
                  projectId: true,
                  name: true,
                  provider: true,
                  config: true,
                  secrets: true,
                  alertingOnly: true,
                  isEnabled: true,
                  pollIntervalInMinutes: true,
                  createdAt: true,
                  lastPolledAt: true,
                  lastSuccessfulPollAt: true,
                  lastEventIngestedAt: true,
                  lastError: true,
                },
                props: { isRoot: true },
              });

            if (!loaded || !loaded.provider) {
              throw new BadDataException("The connection no longer exists.");
            }

            connection = loaded;

            const stored: SecurityConnectorSettings =
              await this.service.getConnectorSettings(loaded);
            const config: JSONObject =
              body["config"] !== undefined
                ? SecurityEventConnectionServiceType.parseJsonObject(
                    body["config"],
                    "Configuration",
                  )
                : stored.config;
            const overlay: JSONObject =
              body["secrets"] !== undefined
                ? SecurityEventConnectionServiceType.parseJsonObject(
                    body["secrets"],
                    "Credentials",
                  )
                : {};
            /*
             * The merge a save would apply. Testing with a different rule
             * would pass settings that cannot be stored, or report a
             * cleared credential as still in use (review finding
             * optional-secret-cannot-be-cleared).
             */
            const secrets: JSONObject =
              SecurityEventConnectionServiceType.mergeSecrets({
                definition:
                  SecurityEventConnectionServiceType.getDefinitionOrThrow(
                    loaded.provider,
                  ),
                stored: stored.secrets,
                provided: overlay,
              });

            settings =
              await SecurityEventConnectionServiceType.validateSettings({
                provider: loaded.provider,
                config,
                secrets,
                alertingOnly:
                  typeof body["alertingOnly"] === "boolean"
                    ? body["alertingOnly"]
                    : stored.alertingOnly,
                requireRequiredSecrets: true,
              });
          } else {
            settings =
              await SecurityEventConnectionServiceType.validateSettings({
                provider: body["provider"],
                config: SecurityEventConnectionServiceType.parseJsonObject(
                  body["config"],
                  "Configuration",
                ),
                secrets: SecurityEventConnectionServiceType.parseJsonObject(
                  body["secrets"],
                  "Credentials",
                ),
                alertingOnly: body["alertingOnly"] !== false,
                requireRequiredSecrets: true,
              });
          }

          const report: SecurityConnectorTestReport =
            await SecurityEventConnectionTester.test({
              settings,
              connection,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            report as unknown as JSONObject,
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
      allowedPermissions: new SecurityEventConnection().getUpdatePermissions(),
      errorMessage:
        "Project owners, project administrators, and security administrators can run connection diagnostics.",
    });
  }
}
